import { spawn } from 'node:child_process'
import path from 'node:path'

const SIGNAL_EXIT = Object.freeze({ SIGINT: 130, SIGTERM: 143 })

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw Error(`${label} must be a positive integer`)
  return value
}

function appendTail(current, chunk, maximum) {
  if (chunk.length >= maximum) return Buffer.from(chunk.subarray(chunk.length - maximum))
  if (current.length + chunk.length <= maximum) return Buffer.concat([current, chunk], current.length + chunk.length)
  const keep = maximum - chunk.length
  return Buffer.concat([current.subarray(current.length - keep), chunk], maximum)
}

function redact(value, sensitiveValues, maximum) {
  let text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? '')
  for (const secret of sensitiveValues) if (typeof secret === 'string' && secret) text = text.replaceAll(secret, '<redacted>')
  text = text.replaceAll(/postgres(?:ql)?:\/\/[^\s]+/giu, 'postgresql://<redacted>')
  return text.slice(-maximum)
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function waitUntil(check, maximumMs) {
  const deadline = Date.now() + maximumMs
  do {
    if (check()) return true
    await delay(Math.min(10, Math.max(1, deadline - Date.now())))
  } while (Date.now() < deadline)
  return check()
}

export async function runBoundedProcess({
  executable, args = [], env = {}, stdin = 'ignore', timeoutMs, termGraceMs = 1000,
  pipeDrainMs = 250, stdoutLimitBytes, stderrLimitBytes, combinedLimitBytes,
  diagnosticBytes = 12_000, sensitiveValues = [], label = 'child process',
}) {
  if (typeof executable !== 'string' || !path.isAbsolute(executable)) throw Error('bounded process executable must be absolute')
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) throw Error('bounded process arguments invalid')
  if (!env || typeof env !== 'object' || Array.isArray(env) || Object.values(env).some(value => typeof value !== 'string')) throw Error('bounded process environment invalid')
  if (stdin !== 'ignore') throw Error('bounded process stdin must be explicitly ignored')
  for (const [name,value] of Object.entries({timeoutMs,termGraceMs,pipeDrainMs,stdoutLimitBytes,stderrLimitBytes,combinedLimitBytes,diagnosticBytes})) positiveInteger(value,name)
  if (combinedLimitBytes < Math.max(stdoutLimitBytes, stderrLimitBytes)) throw Error('combined output limit is impractical')

  const child = spawn(executable,args,{env,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']})
  const processGroupId = child.pid
  let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),stdoutBytes=0,stderrBytes=0
  let reason=null,parentSignal=null,termTimer=null,timeoutTimer=null,spawnError=null,terminationStarted=false
  let stdoutEnded=false,stderrEnded=false,groupIdentityLost=false

  // On Linux the detached group ID is the direct child's PID. We only probe or
  // signal it while this invocation retains that child handle. ESRCH permanently
  // ends our authority, avoiding a later signal to a reused PGID. This assumes a
  // cooperative child does not deliberately leave and recycle its launched group.
  const groupAlive = () => {
    if (!processGroupId || groupIdentityLost) return false
    if (process.platform === 'win32') return child.exitCode === null && child.signalCode === null
    try { process.kill(-processGroupId,0); return true }
    catch (error) {
      if (error.code === 'ESRCH') { groupIdentityLost=true; return false }
      if (error.code === 'EPERM') return true
      throw error
    }
  }
  const killGroup = signal => {
    if (!processGroupId || groupIdentityLost) return
    try { process.kill(process.platform==='win32'?processGroupId:-processGroupId,signal) }
    catch (error) {
      if (error.code === 'ESRCH') groupIdentityLost=true
      else throw error
    }
  }
  const terminate = (why, signal=null) => {
    if (terminationStarted) return
    terminationStarted=true; reason=why; parentSignal=signal
    try { killGroup('SIGTERM') } catch {}
    termTimer=setTimeout(()=>{ try { killGroup('SIGKILL') } catch {} },termGraceMs)
  }
  const consume = (stream, chunk) => {
    if (stream==='stdout') { stdoutBytes+=chunk.length; stdout=appendTail(stdout,chunk,diagnosticBytes) }
    else { stderrBytes+=chunk.length; stderr=appendTail(stderr,chunk,diagnosticBytes) }
    if (!terminationStarted && stdoutBytes>stdoutLimitBytes) terminate(`stdout byte limit ${stdoutLimitBytes} exceeded`)
    else if (!terminationStarted && stderrBytes>stderrLimitBytes) terminate(`stderr byte limit ${stderrLimitBytes} exceeded`)
    else if (!terminationStarted && stdoutBytes+stderrBytes>combinedLimitBytes) terminate(`combined output byte limit ${combinedLimitBytes} exceeded`)
  }
  child.stdout.on('data',chunk=>consume('stdout',chunk))
  child.stderr.on('data',chunk=>consume('stderr',chunk))
  child.stdout.once('end',()=>{stdoutEnded=true})
  child.stderr.once('end',()=>{stderrEnded=true})
  child.stdout.once('close',()=>{stdoutEnded=true})
  child.stderr.once('close',()=>{stderrEnded=true})
  child.once('error',error=>{spawnError=error})
  const handlers=new Map()
  for (const signal of Object.keys(SIGNAL_EXIT)) {
    const handler=()=>{ process.exitCode=SIGNAL_EXIT[signal]; terminate(`interrupted by ${signal}`,signal) }
    handlers.set(signal,handler); process.once(signal,handler)
  }
  timeoutTimer=setTimeout(()=>terminate(`timed out after ${timeoutMs}ms`),timeoutMs)

  try {
    const result=await new Promise(resolve=>{
      let settled=false
      const finish=(code,signal)=>{if(settled)return;settled=true;resolve({code,signal})}
      child.once('exit',(code,signal)=>finish(code,signal))
      child.once('error',()=>finish(null,null))
    })
    clearTimeout(timeoutTimer)

    if (!terminationStarted) {
      const clean=await waitUntil(()=>{
        const alive=groupAlive()
        return stdoutEnded&&stderrEnded&&!alive
      },pipeDrainMs)
      if (!clean) terminate('lingering_process_group')
    }
    if (terminationStarted) {
      const gone=await waitUntil(()=>!groupAlive(),termGraceMs)
      if (!gone) { try { killGroup('SIGKILL') } catch {} }
      await waitUntil(()=>!groupAlive(),pipeDrainMs)
      await waitUntil(()=>stdoutEnded&&stderrEnded,pipeDrainMs)
    }
    if(termTimer!==null) clearTimeout(termTimer)
    child.stdout.destroy(); child.stderr.destroy()
    const detail=redact(stderr.length?stderr:stdout,sensitiveValues,diagnosticBytes).trim()
    if (spawnError) throw Error(`${label} failed to start: ${redact(spawnError.message,sensitiveValues,diagnosticBytes)}`,{cause:spawnError})
    if (reason!==null) {
      const error=Error(`${label} ${reason}${detail?`: ${detail}`:''}`)
      if(reason==='lingering_process_group') error.code=reason
      throw error
    }
    if (result.code!==0) throw Error(`${label} failed exit ${result.code ?? `signal ${result.signal ?? 'unknown'}`}${detail?`: ${detail}`:''}`)
    return {code:result.code,signal:result.signal,stdout:stdout.toString('utf8'),stderr:stderr.toString('utf8'),stdoutBytes,stderrBytes}
  } finally {
    clearTimeout(timeoutTimer); if(termTimer!==null) clearTimeout(termTimer)
    for(const [signal,handler] of handlers) process.removeListener(signal,handler)
    child.stdout.destroy(); child.stderr.destroy()
    if(parentSignal!==null) process.exitCode=SIGNAL_EXIT[parentSignal]
  }
}
