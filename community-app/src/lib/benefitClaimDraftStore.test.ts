import { describe, expect, it } from 'vitest'
import { createBenefitClaimDraftStore, type DraftLock } from './benefitClaimDraftStore'

const actor = 'A1000000-0000-4000-8000-000000000001'
const other = 'a1000000-0000-4000-8000-000000000002'
const clientKey = 'b1000000-0000-4000-8000-000000000001'
const revision1 = 'd1000000-0000-4000-8000-000000000001'
const revision2 = 'd1000000-0000-4000-8000-000000000002'
const revision3 = 'd1000000-0000-4000-8000-000000000003'
const requestKey = 'c1000000-0000-4000-8000-000000000001'
const canonical = 'KR-BIZ-1234567890'
const fields = { categoryId:'health' as const,title:'검진',description:'매년 검진',eligibilityText:'재직자',conditionText:'연 1회',observedOn:'2026-11-23',sourceUrl:'https://example.com/policy' }

class MemoryStorage implements Pick<Storage,'getItem'|'setItem'|'removeItem'> {
  values=new Map<string,string>(); writes:string[]=[]; getFailure=false; setMode:'ok'|'throw'|'noop'|'change'='ok'; removeMode:'ok'|'throw-before'|'delete-throw'|'change'='ok'
  getItem(k:string){if(this.getFailure)throw Error('get SENSITIVE-GET');return this.values.get(k)??null}
  setItem(k:string,v:string){this.writes.push(v);if(this.setMode==='throw')throw Error('set SENSITIVE-SET');if(this.setMode==='noop')return;if(this.setMode==='change'){this.values.set(k,v+' ');return}this.values.set(k,v)}
  removeItem(k:string){if(this.removeMode==='throw-before')throw Error('remove SENSITIVE-BEFORE');if(this.removeMode==='delete-throw'){this.values.delete(k);throw Error('remove SENSITIVE-AFTER')}if(this.removeMode==='change'){this.values.set(k,'changed-by-newer-tab');return}this.values.delete(k)}
}
class Mutex implements DraftLock {
  tail=Promise.resolve(); names:string[]=[]; entered=0; gate:Promise<void>|null=null
  async runExclusive<T>(name:string,fn:()=>T|Promise<T>):Promise<T>{this.names.push(name);const previous=this.tail;let release!:()=>void;this.tail=new Promise<void>(r=>{release=r});await previous;this.entered+=1;try{if(this.gate)await this.gate;return await fn()}finally{release()}}
}
const sequence=(...values:string[])=>()=>{const value=values.shift();if(!value)throw Error('identity exhausted');return value}
const make=(storage=new MemoryStorage(),randomUUID=sequence(clientKey,revision1,revision2,revision3),lock:DraftLock=new Mutex())=>({storage,lock,store:createBenefitClaimDraftStore({storage,randomUUID,lock,now:()=>new Date('2026-11-24T00:00:00.000Z')})})

async function saved(store:ReturnType<typeof createBenefitClaimDraftStore>){const result=await store.create(actor,{kind:'canonical',companyId:canonical});if(result.state!=='saved')throw Error(`not saved: ${result.state}`);return result}

describe('benefit claim draft store',()=>{
  it('creates, updates, reloads and retains client identity',async()=>{const {storage,lock,store}=make();const made=await saved(store);expect(made.draft.clientKey).toBe(clientKey);const updated=await store.update(actor,made.token,fields);expect(updated).toMatchObject({state:'saved',draft:fields});const reload=createBenefitClaimDraftStore({storage,lock,randomUUID:()=>{throw Error('must not rotate')},now:()=>new Date('2026-11-24T00:01:00.000Z')});expect(await reload.load(actor)).toMatchObject({state:'present',draft:{clientKey, ...fields}})})
  it('uses one deterministic actor-only exclusive lock name',async()=>{const {lock,store}=make();await saved(store);expect((lock as Mutex).names).toEqual([`breadlab:benefit-claim:draft-lock:v1:${actor.toLowerCase()}`]);expect((lock as Mutex).names[0]).not.toContain(clientKey)})
  it('fails closed when locking is unavailable or rejects',async()=>{const unavailable={runExclusive:async()=>{throw Error('LOCK SENSITIVE')}} as DraftLock;const {storage,store}=make(new MemoryStorage(),sequence(clientKey,revision1),unavailable);expect(await store.create(actor,{kind:'canonical',companyId:canonical})).toEqual({state:'locking_unavailable'});expect(storage.writes).toHaveLength(0);expect(await store.load(actor)).toEqual({state:'locking_unavailable'})})
  it('serializes two tabs so a stale writer cannot overwrite a newer draft',async()=>{const storage=new MemoryStorage(),lock=new Mutex();const one=make(storage,sequence(clientKey,revision1,revision2),lock).store;const two=make(storage,sequence(revision3),lock).store;const made=await saved(one);let release!:()=>void;lock.gate=new Promise<void>(r=>{release=r});const first=one.update(actor,made.token,{title:'newer'});await Promise.resolve();expect(lock.entered).toBe(2);const stale=two.update(actor,made.token,{title:'stale'});release();lock.gate=null;expect((await first).state).toBe('saved');expect(await stale).toEqual({state:'changed'});expect(await one.load(actor)).toMatchObject({state:'present',draft:{title:'newer'}})})
  it('serializes two tabs so a stale clear cannot delete a newer draft',async()=>{const storage=new MemoryStorage(),lock=new Mutex();const one=make(storage,sequence(clientKey,revision1,revision2),lock).store;const two=make(storage,sequence(revision3),lock).store;const made=await saved(one);const update=one.update(actor,made.token,{title:'newer'});const clear=two.clearAfterSuccess(actor,made.token,clientKey);expect((await update).state).toBe('saved');expect(await clear).toEqual({state:'changed'});expect(await one.load(actor)).toMatchObject({state:'present',draft:{title:'newer'}})})
  it.each(['noop','change'] as const)('does not report saved after a silent %s write',async mode=>{const {storage,store}=make();storage.setMode=mode;expect((await store.create(actor,{kind:'canonical',companyId:canonical})).state).not.toBe('saved')})
  it('classifies write/read storage failures without leaking messages',async()=>{const {storage,store}=make();storage.setMode='throw';expect(await store.create(actor,{kind:'canonical',companyId:canonical})).toEqual({state:'storage_error'});storage.setMode='ok';storage.getFailure=true;const result=await store.create(actor,{kind:'canonical',companyId:canonical});expect(result).toEqual({state:'storage_error'});expect(JSON.stringify(result)).not.toContain('SENSITIVE')})
  it.each([['ok','cleared'],['delete-throw','cleared'],['throw-before','not_cleared'],['change','changed']] as const)('truthfully reads back remove mode %s',async(mode,state)=>{const {storage,store}=make();const made=await saved(store);storage.removeMode=mode;expect(await store.clearAfterSuccess(actor,made.token,clientKey)).toEqual({state})})
  it('reports unknown remove outcome when readback fails',async()=>{const {storage,store}=make();const made=await saved(store);storage.removeMode='delete-throw';storage.getFailure=true;expect(await store.clearAfterSuccess(actor,made.token,clientKey)).toEqual({state:'storage_error'})})
  it('isolates actors and rejects noncanonical actor UUIDs',async()=>{const {store}=make();const made=await saved(store);expect(await store.load(other)).toEqual({state:'missing'});expect(await store.update(other,made.token,{title:'x'})).toEqual({state:'account_mismatch'});expect(await store.create('not-a-uuid',{kind:'canonical',companyId:canonical})).toEqual({state:'invalid'})})
  it('rejects duplicate/noncryptographic identities before writing',async()=>{for(const randomUUID of [sequence(clientKey,clientKey),sequence('weak',revision1)]){const {storage,store}=make(new MemoryStorage(),randomUUID);expect(await store.create(actor,{kind:'canonical',companyId:canonical})).toEqual({state:'identity_unavailable'});expect(storage.writes).toHaveLength(0)}})
  it('atomically replaces only the expected temporary reference after durable readback',async()=>{const {storage,store}=make(new MemoryStorage(),sequence(clientKey,revision1,revision2,revision3));const made=await store.create(actor,{kind:'temporary',requestClientKey:requestKey});if(made.state!=='saved')throw Error();storage.setMode='noop';expect(await store.replaceTemporaryCompany(actor,made.token,requestKey,canonical)).toEqual({state:'not_ready'});storage.setMode='ok';expect(await store.replaceTemporaryCompany(actor,made.token,requestKey,canonical)).toMatchObject({state:'navigation_ready',draft:{clientKey,companyReference:{kind:'canonical',companyId:canonical}}})})
  it.each([
    ['percent-encoded authority','https://%65xample.com/policy'],
    ['raw Unicode authority','https://예시.한국/policy'],
    ['userinfo','https://user@example.com/policy'],
    ['malformed percent','https://example.com/?x=%ZZ'],
    ['encoded control','https://example.com/?x=%00'],
    ['semicolon query','https://example.com/?a=1;b=2'],
    ['nested sensitive query','https://example.com/?auth[token]=x'],
    ['fragment','https://example.com/policy#part'],
    ['local host','https://localhost/path'],
    ['IP host','https://127.0.0.1/path'],
  ])('rejects repository-invalid source URL: %s',async(_name,sourceUrl)=>{const {storage,store}=make();const made=await saved(store);storage.writes=[];expect((await store.update(actor,made.token,{sourceUrl})).state).toBe('invalid');expect(storage.writes).toHaveLength(0)})
  it('accepts the same safe ASCII FQDN source URL as the repository',async()=>{const {store}=make();const made=await saved(store);expect(await store.update(actor,made.token,{sourceUrl:'https://docs.example.com/policy?locale=ko'})).toMatchObject({state:'saved',draft:{sourceUrl:'https://docs.example.com/policy?locale=ko'}})})
  it('rejects impossible and future dates',async()=>{for(const observedOn of ['2026-02-30','2026-11-25']){const {store}=make();const made=await saved(store);expect((await store.update(actor,made.token,{observedOn})).state).toBe('invalid')}})
  it('rejects corrupt recursive schemas, invalid timestamps, future versions and oversize data',async()=>{const {storage,store}=make();const k=store.storageKey(actor);const base={version:1,actorId:actor.toLowerCase(),clientKey,revisionToken:revision1,companyReference:{kind:'canonical',companyId:canonical},categoryId:'',title:'',description:'',eligibilityText:null,conditionText:null,observedOn:'',sourceUrl:null,updatedAt:'2026-11-24T00:00:00.000Z'};for(const value of [{...base,extra:true},{...base,companyReference:{...base.companyReference,extra:true}},{...base,updatedAt:'2026-02-30T00:00:00.000Z'},{...base,updatedAt:'2026-11-24T00:00:00Z'},{version:2}]){storage.values.set(k,JSON.stringify(value));expect(await store.load(actor)).toEqual({state:'incompatible_or_corrupt'})}storage.values.set(k,'x'.repeat(40_001));expect(await store.load(actor)).toEqual({state:'incompatible_or_corrupt'})})
  it('returns isolated snapshots and reset uses truthful remove outcomes',async()=>{const {storage,store}=make();const made=await saved(store);made.draft.title='mutated';expect(await store.load(actor)).toMatchObject({state:'present',draft:{title:''}});storage.removeMode='throw-before';expect(await store.reset(actor)).toEqual({state:'not_cleared'});storage.removeMode='delete-throw';expect(await store.reset(actor)).toEqual({state:'reset'})})
})
