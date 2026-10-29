import { expect, it } from 'vitest'
import { fitScore, rankOrder } from './benefitsScoring'
it('unknown categories are unscored and insufficient coverage hides number', () => {
 expect(fitScore({family:5,health:5}, {family:80})).toEqual({score:80, comparable:1, requested:2})
 expect(fitScore({family:5,health:5,growth:5}, {family:80})).toEqual({score:null,comparable:1,requested:3})
 expect(fitScore({family:0}, {} ).score).toBeNull()
})
it('breaks ties by freshness, scope, canonical id', () => {
 const row=(company_id:string,freshness:number,applicability:number)=>({company_id,score:80,components:{freshness,applicability}})
 expect([row('c',10,20),row('b',15,20),row('a',15,20)].sort(rankOrder).map(r=>r.company_id)).toEqual(['a','b','c'])
})
