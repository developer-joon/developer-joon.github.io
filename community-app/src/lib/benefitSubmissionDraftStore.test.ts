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
    expect(await clearing).toBe(false)
    storage.getItem.mockImplementationOnce(()=>{throw new Error('blocked')})
    expect(await clearBenefitSubmissionDraftIfSnapshot(scope,saved.snapshot,storage,lock)).toBe(false)
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
    await expect(claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock)).resolves.toMatchObject({state:'present'})
    await expect(claimPreAuthBenefitSubmissionDraft('b'.repeat(64) as BenefitSubmissionAccountScope,marked.nonce,local,session,lock)).resolves.toEqual({state:'denied'})
    await expect(claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock)).resolves.toMatchObject({state:'present'})
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
    const mutation=withVerifiedBenefitSubmissionDraft(scope,saved.snapshot,async()=>{await remote;return 'ok'},local,lock)
    const replacement=saveBenefitSubmissionDraft(scope,{...draft,benefitText:'new',updatedAt:new Date().toISOString()},local,lock)
    release();expect(await mutation).toEqual({ok:true,value:'ok',cleared:true});expect((await replacement).ok).toBe(true)
    expect(await loadBenefitSubmissionDraft(scope,local,lock)).toMatchObject({state:'present',draft:{benefitText:'new'}})
  })

  it('rejects extra keys and noncanonical fields before persistence', async () => {
    const storage=memory(); const draft=createBenefitSubmissionDraft(scope)
    expect(await saveBenefitSubmissionDraft(scope,{...draft,sourceUrl:'https://127.0.0.1/private'},storage,locks())).toEqual({ok:false,reason:'invalid'})
    expect(await saveBenefitSubmissionDraft(scope,{...draft,extra:'secret'} as never,storage,locks())).toEqual({ok:false,reason:'invalid'})
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})