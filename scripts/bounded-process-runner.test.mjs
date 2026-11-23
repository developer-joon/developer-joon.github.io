import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'
import { runBoundedProcess } from './bounded-process-runner.mjs'

const shell = await realpath('/bin/sh')
const exists = pid => { try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error } }
const waitGone = async pid => { const end=Date.now()+1500; while(Date.now()<end && exists(pid)) await new Promise(r=>setTimeout(r,25)); assert.equal(exists(pid),false,`process ${pid} survived`) }
const options = { executable:shell, env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'}, stdin:'ignore', timeoutMs:250, termGraceMs:100, pipeDrainMs:100, stdoutLimitBytes:4096, stderrLimitBytes:4096, combinedLimitBytes:6144, diagnosticBytes:512, sensitiveValues:['very-secret'] }
const baselineSignalListeners={SIGINT:process.listenerCount('SIGINT'),SIGTERM:process.listenerCount('SIGTERM')}

async function rejectedRun(script, overrides={}) {
  const root=await mkdtemp(path.join(tmpdir(),'bounded-runner-test-')); const pidFile=path.join(root,'pid')
  const started=Date.now()
  try {
    let rejection
    try { await runBoundedProcess({...options,args:['-c',`echo $$ > '${pidFile}'; ${script}`],...overrides}); assert.fail('bounded process unexpectedly succeeded') }
    catch (error) { rejection=error }
    const elapsed=Date.now()-started
    const pid=Number(await readFile(pidFile,'utf8'))
    assert.ok(elapsed<2000,`elapsed ${elapsed}ms`)
    await waitGone(pid)
    return {rejection,elapsed,root}
  } finally { await rm(root,{recursive:true,force:true}) }
}

async function lingeringGroupRun({redirected=false}={}) {
  const root=await mkdtemp(path.join(tmpdir(),'bounded-lingering-group-')); const descendantFile=path.join(root,'descendant')
  const redirect=redirected?' >/dev/null 2>&1':''; const started=Date.now()
  try {
    let rejection
    try { await runBoundedProcess({...options,args:['-c',`sleep 30${redirect} & echo $! > '${descendantFile}'; exit 0`],timeoutMs:1500,label:'successful child fixture'}); assert.fail('bounded process unexpectedly succeeded') }
    catch (error) { rejection=error }
    const elapsed=Date.now()-started; const descendantPid=Number(await readFile(descendantFile,'utf8'))
    assert.ok(elapsed<2000,`elapsed ${elapsed}ms`)
    assert.equal(rejection.code,'lingering_process_group')
    assert.match(rejection.message,/lingering_process_group/)
    await waitGone(descendantPid)
  } finally { await rm(root,{recursive:true,force:true}) }
}

test('production runner rejects and reaps a successful child with an inherited-pipe descendant',async()=>{
  await lingeringGroupRun()
})

test('production runner rejects and reaps a successful child with a closed-pipe descendant',async()=>{
  await lingeringGroupRun({redirected:true})
})

test('production runner preserves ordinary success across repeated runs',async()=>{
  for(let iteration=0;iteration<3;iteration++){
    const result=await runBoundedProcess({...options,args:['-c',"printf 'ok'"]})
    assert.equal(result.stdout,'ok')
    assert.equal(result.code,0)
  }
  assert.deepEqual({SIGINT:process.listenerCount('SIGINT'),SIGTERM:process.listenerCount('SIGTERM')},baselineSignalListeners)
})

test('production runner bounds a TERM-ignoring version probe and redacts diagnostics', async()=>{
  const {rejection}=await rejectedRun("trap '' TERM; echo very-secret >&2; while :; do sleep 1; done",{label:'psql version probe'})
  assert.match(rejection.message,/version probe.*timed out/i)
  assert.doesNotMatch(rejection.message,/very-secret/)
  assert.match(rejection.message,/<redacted>/)
})

test('production runner independently terminates stdout overflow', async()=>{
  const {rejection}=await rejectedRun("trap '' TERM; while :; do printf 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; done",{stdoutLimitBytes:1024,combinedLimitBytes:8192,timeoutMs:1500})
  assert.match(rejection.message,/stdout.*limit/i)
})

test('production runner independently terminates stderr overflow', async()=>{
  const {rejection}=await rejectedRun("trap '' TERM; while :; do printf 'very-secretxxxxxxxxxxxxxxxxxxxx' >&2; done",{stderrLimitBytes:1024,combinedLimitBytes:8192,timeoutMs:1500})
  assert.match(rejection.message,/stderr.*limit/i)
  assert.doesNotMatch(rejection.message,/very-secret/)
})

test('production runner bounds a TERM-ignoring import timeout', async()=>{
  const {rejection}=await rejectedRun("trap '' TERM; while :; do sleep 1; done",{label:'psql OpenDART import'})
  assert.match(rejection.message,/OpenDART import.*timed out/i)
})

test('production runner cannot bypass the parent-signal lifecycle with a public option', async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'bounded-parent-signal-')); const groupFile=path.join(root,'group'); const helper=path.join(root,'helper.mjs')
  await writeFile(helper,`import {realpath} from 'node:fs/promises'; import {runBoundedProcess} from ${JSON.stringify(new URL('./bounded-process-runner.mjs',import.meta.url).href)}; const sh=await realpath('/bin/sh'); try { await runBoundedProcess({executable:sh,args:['-c',"echo $$ > '${groupFile}'; trap '' TERM; while :; do sleep 1; done"],env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},stdin:'ignore',timeoutMs:5000,termGraceMs:100,pipeDrainMs:100,stdoutLimitBytes:4096,stderrLimitBytes:4096,combinedLimitBytes:6144,label:'parent signal fixture',parentSignals:false}); } catch(e) { console.error(e.message); process.exit(process.exitCode||1) }`)
  const child=spawn(process.execPath,[helper],{stdio:['ignore','ignore','pipe']}); let diagnostics=''; child.stderr.on('data',c=>diagnostics+=c)
  try {
    const end=Date.now()+1500; while(Date.now()<end){try{await readFile(groupFile);break}catch{await new Promise(r=>setTimeout(r,20))}}
    const groupPid=Number(await readFile(groupFile,'utf8')); const started=Date.now(); child.kill('SIGTERM')
    const result=await new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})))
    assert.ok(Date.now()-started<2000)
    assert.deepEqual(result,{code:143,signal:null})
    assert.match(diagnostics,/interrupted by SIGTERM/)
    await waitGone(groupPid)
  } finally { if(child.exitCode===null) child.kill('SIGKILL'); await rm(root,{recursive:true,force:true}) }
})

test('production runner leaves no parent signal listeners',()=>{
  assert.deepEqual({SIGINT:process.listenerCount('SIGINT'),SIGTERM:process.listenerCount('SIGTERM')},baselineSignalListeners)
})
