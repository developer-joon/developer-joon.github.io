import { describe, expect, it, vi } from 'vitest'
import {
  benefitSubmissionDraftKey,
  claimPreAuthBenefitSubmissionDraft,
  clearBenefitSubmissionDraftIfSnapshot,
  createBenefitSubmissionDraft,
  discardClaimedPreAuthBenefitSubmissionIntent,
  loadBenefitSubmissionDraft,
  markBenefitSubmissionLoginIntent,
  resetInvalidBenefitSubmissionDraft,
  restoreClaimedPreAuthBenefitSubmissionDraft,
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
    expect(await loadBenefitSubmissionDraft(scope,invalid,locks())).toMatchObject({state:'invalid',kind:'invalid'})
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

  it.each(['throw','noop'] as const)('keeps a claimed OAuth binding immutable when account persistence %s fails and later resumes only for A', async failure => {
    const lock=locks(),local=memory(),session=memory(),actorB='b'.repeat(64) as BenefitSubmissionAccountScope
    const draft=createBenefitSubmissionDraft('preauth',()=> '11111111-1111-4111-8111-111111111111')
    const saved=await saveBenefitSubmissionDraft('preauth',{...draft,benefitText:'정확히 보존할 초안'},local,lock);if(!saved.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(saved.snapshot,session,lock,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    const realSet=local.setItem
    local.setItem=vi.fn((key:string,value:string)=>{if(key===benefitSubmissionDraftKey(scope)){if(failure==='throw')throw new Error('account storage blocked');return}realSet(key,value)})
    await expect(claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock)).resolves.toEqual({state:'unreadable'})
    expect(local.getItem(benefitSubmissionDraftKey('preauth'))).toBe(saved.snapshot)
    session.setItem.mockClear()
    await expect(markBenefitSubmissionLoginIntent('{invalid current draft',session,lock,()=> '55555555-5555-4555-8555-555555555555')).resolves.toEqual({ok:true,nonce:marked.nonce})
    expect(session.setItem).not.toHaveBeenCalled()
    await expect(claimPreAuthBenefitSubmissionDraft(actorB,marked.nonce,local,session,lock)).resolves.toEqual({state:'denied'})
    expect(local.getItem(benefitSubmissionDraftKey('preauth'))).toBe(saved.snapshot)
    local.setItem=realSet
    await expect(claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock)).resolves.toMatchObject({state:'present',draft:{benefitText:'정확히 보존할 초안'}})
  })

  it('reuses a pending OAuth nonce and updates only its draft snapshot under the intent lock', async () => {
    const lock=locks(),local=memory(),session=memory(),draft=createBenefitSubmissionDraft('preauth')
    const first=await saveBenefitSubmissionDraft('preauth',draft,local,lock);if(!first.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(first.snapshot,session,lock,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    const second=await saveBenefitSubmissionDraft('preauth',{...draft,benefitText:'로그인 직전 수정',updatedAt:new Date().toISOString()},local,lock);if(!second.ok)throw new Error('save')
    await expect(markBenefitSubmissionLoginIntent(second.snapshot,session,lock,()=> '55555555-5555-4555-8555-555555555555')).resolves.toEqual({ok:true,nonce:marked.nonce})
    await expect(claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock)).resolves.toMatchObject({state:'present',draft:{benefitText:'로그인 직전 수정'}})
  })

  it('fails closed without overwriting an invalid login envelope', async () => {
    const session=memory(),raw='{"version":2,"state":"claimed","draft":"secret"}'
    session.values.set('breadlab:benefit-submission:login-intent:v2',raw)
    const draft=JSON.stringify(createBenefitSubmissionDraft('preauth'))
    await expect(markBenefitSubmissionLoginIntent(draft,session,locks())).resolves.toEqual({ok:false,reason:'invalid'})
    expect(session.getItem('breadlab:benefit-submission:login-intent:v2')).toBe(raw)
    expect(session.setItem).not.toHaveBeenCalled()
  })

  it.each([
    ['malformed','{"version":1'],
    ['extra key',JSON.stringify({...createBenefitSubmissionDraft(scope),extra:'do not erase'})],
    ['future version',JSON.stringify({...createBenefitSubmissionDraft(scope),version:2})],
  ])('preserves %s draft bytes and returns only an opaque snapshot identity', async (label,raw) => {
    const local=memory(),key=benefitSubmissionDraftKey(scope);local.values.set(key,raw)
    const loaded=await loadBenefitSubmissionDraft(scope,local,locks())
    expect(loaded).toMatchObject({state:'invalid',kind:label==='future version'?'future_version':'invalid'})
    if(loaded.state!=='invalid')throw new Error('expected invalid')
    expect(loaded.snapshotId).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(loaded)).not.toContain(raw)
    expect(local.getItem(key)).toBe(raw)
    expect(local.setItem).not.toHaveBeenCalled();expect(local.removeItem).not.toHaveBeenCalled()
  })

  it('resets only the exact invalid snapshot and persists a fresh canonical draft', async () => {
    const local=memory(),lock=locks(),key=benefitSubmissionDraftKey(scope),raw='{bad json'
    local.values.set(key,raw)
    const loaded=await loadBenefitSubmissionDraft(scope,local,lock);if(loaded.state!=='invalid')throw new Error('expected invalid')
    const reset=await resetInvalidBenefitSubmissionDraft(scope,loaded.snapshotId,local,lock,()=> '66666666-6666-4666-8666-666666666666',()=> '2026-11-21T00:00:00.000Z')
    expect(reset).toMatchObject({state:'reset',draft:{clientKey:'66666666-6666-4666-8666-666666666666',accountScope:scope}})
    expect(local.getItem(key)).toBe(reset.state==='reset'?reset.snapshot:null)
  })

  it('overwrites atomically without removal and never rolls an interleaved replacement back', async () => {
    const lock=locks(),key=benefitSubmissionDraftKey(scope)
    const changed=memory();changed.values.set(key,'{old');const old=await loadBenefitSubmissionDraft(scope,changed,lock);if(old.state!=='invalid')throw new Error('invalid')
    changed.values.set(key,'{replacement')
    await expect(resetInvalidBenefitSubmissionDraft(scope,old.snapshotId,changed,lock)).resolves.toEqual({state:'changed'})
    expect(changed.getItem(key)).toBe('{replacement')
    const interleaved=memory();interleaved.values.set(key,'{blocked');const interleavedLoaded=await loadBenefitSubmissionDraft(scope,interleaved,lock);if(interleavedLoaded.state!=='invalid')throw new Error('invalid')
    interleaved.setItem=vi.fn(()=>void interleaved.values.set(key,'{replacement during write'))
    await expect(resetInvalidBenefitSubmissionDraft(scope,interleavedLoaded.snapshotId,interleaved,lock)).resolves.toEqual({state:'changed'})
    expect(interleaved.getItem(key)).toBe('{replacement during write')
    expect(interleaved.setItem).toHaveBeenCalledTimes(1)
    expect(interleaved.removeItem).not.toHaveBeenCalled()
    for(const failure of ['throw','noop'] as const){
      const local=memory();local.values.set(key,'{blocked');const loaded=await loadBenefitSubmissionDraft(scope,local,lock);if(loaded.state!=='invalid')throw new Error('invalid')
      local.setItem=failure==='throw'?vi.fn(()=>{throw new Error('blocked')}):vi.fn()
      await expect(resetInvalidBenefitSubmissionDraft(scope,loaded.snapshotId,local,lock)).resolves.toEqual({state:'unavailable'})
      expect(local.getItem(key)).toBe('{blocked')
      expect(local.setItem).toHaveBeenCalledTimes(1)
      expect(local.removeItem).not.toHaveBeenCalled()
    }
  })

  it('reports an opaque claimed account-invalid state and explicitly restores the exact preauth draft', async () => {
    const lock=locks(),local=memory(),session=memory(),key=benefitSubmissionDraftKey(scope),raw='{invalid account',actorB='b'.repeat(64) as BenefitSubmissionAccountScope
    local.values.set(key,raw)
    const preauth=createBenefitSubmissionDraft('preauth',()=> '11111111-1111-4111-8111-111111111111',()=> '2026-11-21T00:00:00.000Z')
    const saved=await saveBenefitSubmissionDraft('preauth',{...preauth,benefitText:'로그인 전 초안'},local,lock);if(!saved.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(saved.snapshot,session,lock,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    const claimed=await claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock)
    expect(claimed).toMatchObject({state:'account_invalid',kind:'invalid'})
    expect(JSON.stringify(claimed)).not.toContain(raw)
    if(claimed.state!=='account_invalid')throw new Error('account invalid expected')
    await expect(restoreClaimedPreAuthBenefitSubmissionDraft(actorB,marked.nonce,claimed.snapshotId,local,session,lock)).resolves.toEqual({state:'denied'})
    const restored=await restoreClaimedPreAuthBenefitSubmissionDraft(scope,marked.nonce,claimed.snapshotId,local,session,lock)
    expect(restored).toMatchObject({state:'restored',draft:{accountScope:scope,clientKey:preauth.clientKey,benefitText:'로그인 전 초안'}})
    const accountRaw=local.getItem(key);expect(accountRaw).toBe(restored.state==='restored'?restored.snapshot:null)
    expect(JSON.parse(accountRaw!).updatedAt).toBe(preauth.updatedAt)
    await expect(discardClaimedPreAuthBenefitSubmissionIntent(scope,marked.nonce,session,lock)).resolves.toEqual({state:'missing'})
  })

  it('preserves changed account bytes before explicit claimed-draft restore', async () => {
    const lock=locks(),local=memory(),session=memory(),key=benefitSubmissionDraftKey(scope);local.values.set(key,'{invalid account')
    const saved=await saveBenefitSubmissionDraft('preauth',createBenefitSubmissionDraft('preauth'),local,lock);if(!saved.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(saved.snapshot,session,lock,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    const claimed=await claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock);if(claimed.state!=='account_invalid')throw new Error('account invalid expected')
    local.values.set(key,'{new account bytes')
    await expect(restoreClaimedPreAuthBenefitSubmissionDraft(scope,marked.nonce,claimed.snapshotId,local,session,lock)).resolves.toEqual({state:'conflict'})
    expect(local.getItem(key)).toBe('{new account bytes')
  })

  it('resumes same-account restore after envelope cleanup no-op without rewriting the restored draft', async () => {
    const lock=locks(),local=memory(),session=memory(),key=benefitSubmissionDraftKey(scope);local.values.set(key,'{invalid account')
    const saved=await saveBenefitSubmissionDraft('preauth',createBenefitSubmissionDraft('preauth'),local,lock);if(!saved.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(saved.snapshot,session,lock,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    const claimed=await claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock);if(claimed.state!=='account_invalid')throw new Error('account invalid expected')
    const remove=session.removeItem;session.removeItem=vi.fn()
    await expect(restoreClaimedPreAuthBenefitSubmissionDraft(scope,marked.nonce,claimed.snapshotId,local,session,lock)).resolves.toMatchObject({state:'cleanup_failed'})
    const restoredRaw=local.getItem(key),writes=local.setItem.mock.calls.filter(([writtenKey])=>writtenKey===key).length
    session.removeItem=remove
    await expect(restoreClaimedPreAuthBenefitSubmissionDraft(scope,marked.nonce,claimed.snapshotId,local,session,lock)).resolves.toMatchObject({state:'restored',snapshot:restoredRaw})
    expect(local.setItem.mock.calls.filter(([writtenKey])=>writtenKey===key)).toHaveLength(writes)
  })

  it('discards only the exact same-account claimed envelope and leaves invalid account bytes untouched', async () => {
    const lock=locks(),local=memory(),session=memory(),key=benefitSubmissionDraftKey(scope),raw='{invalid account',actorB='b'.repeat(64) as BenefitSubmissionAccountScope;local.values.set(key,raw)
    const saved=await saveBenefitSubmissionDraft('preauth',createBenefitSubmissionDraft('preauth'),local,lock);if(!saved.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(saved.snapshot,session,lock,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    const claimed=await claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock);expect(claimed.state).toBe('account_invalid')
    await expect(discardClaimedPreAuthBenefitSubmissionIntent(actorB,marked.nonce,session,lock)).resolves.toEqual({state:'denied'})
    await expect(discardClaimedPreAuthBenefitSubmissionIntent(scope,'55555555-5555-4555-8555-555555555555',session,lock)).resolves.toEqual({state:'missing'})
    await expect(discardClaimedPreAuthBenefitSubmissionIntent(scope,marked.nonce,session,lock)).resolves.toEqual({state:'discarded'})
    expect(local.getItem(key)).toBe(raw)
    expect(local.removeItem).not.toHaveBeenCalledWith(key)
  })

  it.each(['throw','noop'] as const)('keeps exact claimed intent retryable when discard removal is a %s', async failure => {
    const lock=locks(),local=memory(),session=memory(),key=benefitSubmissionDraftKey(scope),raw='{invalid account';local.values.set(key,raw)
    const saved=await saveBenefitSubmissionDraft('preauth',createBenefitSubmissionDraft('preauth'),local,lock);if(!saved.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(saved.snapshot,session,lock,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    const claimed=await claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock);expect(claimed.state).toBe('account_invalid')
    const remove=session.removeItem;session.removeItem=failure==='throw'?vi.fn(()=>{throw new Error('blocked')}):vi.fn()
    await expect(discardClaimedPreAuthBenefitSubmissionIntent(scope,marked.nonce,session,lock)).resolves.toEqual({state:'unavailable'})
    expect(local.getItem(key)).toBe(raw)
    session.removeItem=remove
    await expect(discardClaimedPreAuthBenefitSubmissionIntent(scope,marked.nonce,session,lock)).resolves.toEqual({state:'discarded'})
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