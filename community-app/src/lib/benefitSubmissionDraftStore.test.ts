import { describe, expect, it, vi } from 'vitest'
import {
  benefitSubmissionDraftKey,
  claimPreAuthBenefitSubmissionDraft,
  clearBenefitSubmissionDraftIfSnapshot,
  createBenefitSubmissionDraft,
  loadBenefitSubmissionDraft,
  markBenefitSubmissionLoginIntent,
  saveBenefitSubmissionDraft,
  withVerifiedBenefitSubmissionDraft,
  type BenefitSubmissionLockAdapter,
} from './benefitSubmissionDraftStore'
import type { BenefitSubmissionAccountScope } from '../types/benefitSubmissions'

const scope = 'a'.repeat(64) as BenefitSubmissionAccountScope
function memory() {
  const values = new Map<string,string>()
  return { values, getItem: vi.fn((key:string)=>values.get(key)??null), setItem: vi.fn((key:string,value:string)=>void values.set(key,value)), removeItem: vi.fn((key:string)=>void values.delete(key)) }
}
function locks():BenefitSubmissionLockAdapter {
  const tails=new Map<string,Promise<void>>()
  return {request:<T,>(name:string,callback:()=>Promise<T>|T)=>{const tail=tails.get(name)??Promise.resolve();const run=tail.then(callback,callback);tails.set(name,run.then(()=>undefined,()=>undefined));return run}}
}

describe('benefit submission draft store', () => {
  it('creates one cryptographic idempotency UUID and restores it unchanged', async () => {
    const storage=memory(), lock=locks(); const draft=createBenefitSubmissionDraft(scope,()=> '11111111-1111-4111-8111-111111111111',()=> '2026-11-21T00:00:00.000Z')
    expect(await saveBenefitSubmissionDraft(scope,draft,storage,lock)).toMatchObject({ok:true})
    expect(await loadBenefitSubmissionDraft(scope,storage,lock)).toMatchObject({state:'present',draft:{clientKey:draft.clientKey}})
    expect(benefitSubmissionDraftKey(scope)).not.toContain('user')
  })

  it('distinguishes missing, invalid, unreadable, and unavailable locking without leaking content', async () => {
    expect(await loadBenefitSubmissionDraft(scope,memory(),locks())).toEqual({state:'missing'})
    const invalid=memory(); invalid.values.set(benefitSubmissionDraftKey(scope),'{}')
    expect(await loadBenefitSubmissionDraft(scope,invalid,locks())).toEqual({state:'invalid'})
    const unreadable={getItem(){throw new Error('secret draft')},setItem(){},removeItem(){}}
    expect(await loadBenefitSubmissionDraft(scope,unreadable,locks())).toEqual({state:'unreadable'})
    expect(await loadBenefitSubmissionDraft(scope,memory())).toEqual({state:'unavailable'})
  })

  it('serializes replacement and conditional clear so a newer draft survives', async () => {
    const lock=locks(), storage=memory(), draft=createBenefitSubmissionDraft(scope,()=> '11111111-1111-4111-8111-111111111111')
    const saved=await saveBenefitSubmissionDraft(scope,draft,storage,lock); expect(saved.ok).toBe(true)
    if(!saved.ok) throw new Error('expected snapshot')
    const replacement={...draft,benefitText:'new',updatedAt:new Date().toISOString()}
    const replacing=saveBenefitSubmissionDraft(scope,replacement,storage,lock)
    const clearing=clearBenefitSubmissionDraftIfSnapshot(scope,saved.snapshot,storage,lock)
    expect((await replacing).ok).toBe(true)
    expect(await clearing).toEqual({state:'changed'})
    storage.getItem.mockImplementationOnce(()=>{throw new Error('blocked')})
    expect(await clearBenefitSubmissionDraftIfSnapshot(scope,saved.snapshot,storage,lock)).toEqual({state:'unavailable'})
  })

  it('binds a resumable OAuth intent nonce to the first opaque actor scope', async () => {
    const lock=locks(), local=memory(), session=memory(); const draft=createBenefitSubmissionDraft('preauth',()=> '11111111-1111-4111-8111-111111111111')
    const saved=await saveBenefitSubmissionDraft('preauth',{...draft,benefitText:'식대 지원'},local,lock); expect(saved.ok).toBe(true)
    const marked=await markBenefitSubmissionLoginIntent(saved.ok?saved.snapshot:'',session,lock,()=> '44444444-4444-4444-8444-444444444444')
    expect(marked).toEqual({ok:true,nonce:'44444444-4444-4444-8444-444444444444'})
    const claimed=await claimPreAuthBenefitSubmissionDraft(scope,marked.ok?marked.nonce:'',local,session,lock)
    expect(claimed).toMatchObject({state:'present',draft:{accountScope:scope,benefitText:'식대 지원',clientKey:draft.clientKey}})
    expect(await loadBenefitSubmissionDraft('preauth',local,lock)).toEqual({state:'missing'})
  })

  it('persists claimed ownership before account write and denies B after cleanup failure', async () => {
    const lock=locks(),local=memory(),session=memory(),draft=createBenefitSubmissionDraft('preauth')
    const saved=await saveBenefitSubmissionDraft('preauth',draft,local,lock);if(!saved.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(saved.snapshot,session,lock,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    session.removeItem=vi.fn(()=>{throw new Error('cleanup blocked')})
    await expect(claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock)).resolves.toMatchObject({state:'cleanup_failed'})
    await expect(claimPreAuthBenefitSubmissionDraft('b'.repeat(64) as BenefitSubmissionAccountScope,marked.nonce,local,session,lock)).resolves.toEqual({state:'denied'})
    await expect(claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock)).resolves.toMatchObject({state:'cleanup_failed'})
  })

  it.each(['throw','noop'] as const)('preserves a newer same-intent account edit after claimed-envelope cleanup %s', async failure => {
    const lock=locks(),local=memory(),session=memory(),draft=createBenefitSubmissionDraft('preauth',()=> '11111111-1111-4111-8111-111111111111')
    const saved=await saveBenefitSubmissionDraft('preauth',{...draft,benefitText:'로그인 전 내용'},local,lock);if(!saved.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(saved.snapshot,session,lock,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    const realRemove=session.removeItem
    session.removeItem=failure==='throw'?vi.fn(()=>{throw new Error('cleanup blocked')}):vi.fn()
    await expect(claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock)).resolves.toMatchObject({state:'cleanup_failed'})
    const loaded=await loadBenefitSubmissionDraft(scope,local,lock);if(loaded.state!=='present')throw new Error('account draft missing')
    const newer={...loaded.draft,benefitText:'로그인 뒤 새 내용',updatedAt:new Date().toISOString()}
    const newerSaved=await saveBenefitSubmissionDraft(scope,newer,local,lock);if(!newerSaved.ok)throw new Error('newer save')
    session.removeItem=realRemove
    await expect(claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock)).resolves.toEqual({state:'present',draft:newer,snapshot:newerSaved.snapshot})
    expect((await loadBenefitSubmissionDraft(scope,local,lock))).toEqual({state:'present',draft:newer,snapshot:newerSaved.snapshot})
    await expect(claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock)).resolves.toEqual({state:'missing'})
  })

  it('reports a different-intent conflict without changing either draft', async () => {
    const lock=locks(),local=memory(),session=memory(),preauth=createBenefitSubmissionDraft('preauth',()=> '11111111-1111-4111-8111-111111111111')
    const account=createBenefitSubmissionDraft(scope,()=> '22222222-2222-4222-8222-222222222222')
    const preauthSaved=await saveBenefitSubmissionDraft('preauth',{...preauth,benefitText:'preauth'},local,lock);if(!preauthSaved.ok)throw new Error('save')
    const accountSaved=await saveBenefitSubmissionDraft(scope,{...account,benefitText:'account'},local,lock);if(!accountSaved.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(preauthSaved.snapshot,session,lock,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    await expect(claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock)).resolves.toMatchObject({state:'conflict',accountSnapshot:accountSaved.snapshot,preauthSnapshot:preauthSaved.snapshot})
    expect(local.getItem(benefitSubmissionDraftKey(scope))).toBe(accountSaved.snapshot)
    expect(local.getItem(benefitSubmissionDraftKey('preauth'))).toBe(preauthSaved.snapshot)
    await expect(claimPreAuthBenefitSubmissionDraft('b'.repeat(64) as BenefitSubmissionAccountScope,marked.nonce,local,session,lock)).resolves.toEqual({state:'denied'})
  })

  it('detects silent intent persistence failure and never reports a nonce', async () => {
    const session=memory();session.setItem=vi.fn()
    const raw=JSON.stringify(createBenefitSubmissionDraft('preauth'))
    await expect(markBenefitSubmissionLoginIntent(raw,session,locks())).resolves.toEqual({ok:false,reason:'unavailable'})
  })

  it('holds the account lock across verified remote mutation and exact cleanup', async () => {
    const lock=locks(),local=memory(),draft=createBenefitSubmissionDraft(scope)
    const saved=await saveBenefitSubmissionDraft(scope,draft,local,lock);if(!saved.ok)throw new Error('save')
    let release!:()=>void;const remote=new Promise<void>(resolve=>{release=resolve})
    const mutation=withVerifiedBenefitSubmissionDraft(scope,saved.snapshot,async()=>{await remote;return {ok:true as const,value:'ok'}},local,lock)
    const replacement=saveBenefitSubmissionDraft(scope,{...draft,benefitText:'new',updatedAt:new Date().toISOString()},local,lock)
    release();expect(await mutation).toEqual({state:'mutation_succeeded_cleared',value:'ok'});expect((await replacement).ok).toBe(true)
    expect(await loadBenefitSubmissionDraft(scope,local,lock)).toMatchObject({state:'present',draft:{benefitText:'new'}})
  })

  it('rethrows the exact callback failure instead of converting it to storage unavailable', async () => {
    const lock=locks(),local=memory(),draft=createBenefitSubmissionDraft(scope),failure={code:'auth_required'}
    const saved=await saveBenefitSubmissionDraft(scope,draft,local,lock);if(!saved.ok)throw new Error('save')
    await expect(withVerifiedBenefitSubmissionDraft(scope,saved.snapshot,async()=>{throw failure},local,lock)).rejects.toBe(failure)
    expect(local.getItem(benefitSubmissionDraftKey(scope))).toBe(saved.snapshot)
  })

  it('reports remote success with a silent cleanup no-op and allows cleanup-only retry', async () => {
    const lock=locks(),local=memory(),draft=createBenefitSubmissionDraft(scope)
    const saved=await saveBenefitSubmissionDraft(scope,draft,local,lock);if(!saved.ok)throw new Error('save')
    const realRemove=local.removeItem
    local.removeItem=vi.fn()
    await expect(withVerifiedBenefitSubmissionDraft(scope,saved.snapshot,async()=>({ok:true,value:'accepted'}),local,lock)).resolves.toEqual({state:'mutation_succeeded_cleanup_failed',value:'accepted',snapshot:saved.snapshot})
    local.removeItem=realRemove
    await expect(clearBenefitSubmissionDraftIfSnapshot(scope,saved.snapshot,local,lock)).resolves.toEqual({state:'cleared'})
  })

  it('rejects extra keys and noncanonical fields before persistence', async () => {
    const storage=memory(); const draft=createBenefitSubmissionDraft(scope)
    expect(await saveBenefitSubmissionDraft(scope,{...draft,sourceUrl:'https://127.0.0.1/private'},storage,locks())).toEqual({ok:false,reason:'invalid'})
    expect(await saveBenefitSubmissionDraft(scope,{...draft,extra:'secret'} as never,storage,locks())).toEqual({ok:false,reason:'invalid'})
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})