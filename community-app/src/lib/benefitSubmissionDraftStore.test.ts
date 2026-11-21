import { describe, expect, it, vi } from 'vitest'
import {
  benefitSubmissionDraftKey,
  claimPreAuthBenefitSubmissionDraft,
  clearBenefitSubmissionDraftIfSnapshot,
  createBenefitSubmissionDraft,
  loadBenefitSubmissionDraft,
  markBenefitSubmissionLoginIntent,
  saveBenefitSubmissionDraft,
} from './benefitSubmissionDraftStore'
import type { BenefitSubmissionAccountScope } from '../types/benefitSubmissions'

const scope = 'a'.repeat(64) as BenefitSubmissionAccountScope
function memory() {
  const values = new Map<string,string>()
  return { values, getItem: vi.fn((key:string)=>values.get(key)??null), setItem: vi.fn((key:string,value:string)=>void values.set(key,value)), removeItem: vi.fn((key:string)=>void values.delete(key)) }
}

describe('benefit submission draft store', () => {
  it('creates one cryptographic idempotency UUID and restores it unchanged', () => {
    const storage=memory(); const draft=createBenefitSubmissionDraft(scope,()=> '11111111-1111-4111-8111-111111111111',()=> '2026-11-21T00:00:00.000Z')
    expect(saveBenefitSubmissionDraft(scope,draft,storage)).toMatchObject({ok:true})
    expect(loadBenefitSubmissionDraft(scope,storage)).toMatchObject({state:'present',draft:{clientKey:draft.clientKey}})
    expect(benefitSubmissionDraftKey(scope)).not.toContain('user')
  })

  it('distinguishes missing, invalid, and unreadable storage without leaking content', () => {
    expect(loadBenefitSubmissionDraft(scope,memory())).toEqual({state:'missing'})
    const invalid=memory(); invalid.values.set(benefitSubmissionDraftKey(scope),'{}')
    expect(loadBenefitSubmissionDraft(scope,invalid)).toEqual({state:'invalid'})
    const unreadable={getItem(){throw new Error('secret draft')},setItem(){},removeItem(){}}
    expect(loadBenefitSubmissionDraft(scope,unreadable)).toEqual({state:'unreadable'})
  })

  it('conditionally clears only the exact still-readable submitted snapshot', () => {
    const storage=memory(); const draft=createBenefitSubmissionDraft(scope,()=> '11111111-1111-4111-8111-111111111111')
    const saved=saveBenefitSubmissionDraft(scope,draft,storage); expect(saved.ok).toBe(true)
    if(!saved.ok) throw new Error('expected snapshot')
    storage.values.set(benefitSubmissionDraftKey(scope),storage.values.get(benefitSubmissionDraftKey(scope))!.replace('"benefitText":""','"benefitText":"new"'))
    expect(clearBenefitSubmissionDraftIfSnapshot(scope,saved.snapshot,storage)).toBe(false)
    expect(storage.removeItem).not.toHaveBeenCalled()
    storage.getItem.mockImplementationOnce(()=>{throw new Error('blocked')})
    expect(clearBenefitSubmissionDraftIfSnapshot(scope,saved.snapshot,storage)).toBe(false)
  })

  it('claims a signed-out draft once only after an exact explicit login intent', async () => {
    const local=memory(), session=memory(); const draft=createBenefitSubmissionDraft('preauth',()=> '11111111-1111-4111-8111-111111111111')
    const saved=saveBenefitSubmissionDraft('preauth',{...draft,benefitText:'식대 지원'},local); expect(saved.ok).toBe(true)
    await markBenefitSubmissionLoginIntent(saved.ok?saved.snapshot:'',session)
    const claimed=await claimPreAuthBenefitSubmissionDraft(scope,local,session)
    expect(claimed).toMatchObject({state:'present',draft:{accountScope:scope,benefitText:'식대 지원',clientKey:draft.clientKey}})
    expect(loadBenefitSubmissionDraft('preauth',local)).toEqual({state:'missing'})
    await expect(claimPreAuthBenefitSubmissionDraft('b'.repeat(64) as BenefitSubmissionAccountScope,local,session)).resolves.toEqual({state:'missing'})
  })

  it('rejects extra keys and oversized or noncanonical fields before persistence', () => {
    const storage=memory(); const draft=createBenefitSubmissionDraft(scope)
    expect(saveBenefitSubmissionDraft(scope,{...draft,sourceUrl:'https://127.0.0.1/private'},storage)).toEqual({ok:false,reason:'invalid'})
    expect(saveBenefitSubmissionDraft(scope,{...draft,extra:'secret'} as never,storage)).toEqual({ok:false,reason:'invalid'})
    expect(storage.setItem).not.toHaveBeenCalled()
  })
})
