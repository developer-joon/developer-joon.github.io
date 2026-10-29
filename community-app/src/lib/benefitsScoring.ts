import type { Category } from '../types/benefits'
export function fitScore(weights: Partial<Record<Category,number>>, scores: Partial<Record<Category,number>>) {
 const wanted=(Object.keys(weights) as Category[]).filter(k=>(weights[k]??0)>0)
 const available=wanted.filter(k=>scores[k]!==undefined)
 const denominator=available.reduce((sum,k)=>sum+weights[k]!,0)
 return {score:available.length*2<wanted.length||!denominator?null:Math.round(available.reduce((sum,k)=>sum+scores[k]!*weights[k]!,0)/denominator),comparable:available.length,requested:wanted.length}
}
export function rankOrder(a:{company_id:string;score:number;components:{freshness:number;applicability:number}}, b:typeof a) {
 return b.score-a.score||b.components.freshness-a.components.freshness||b.components.applicability-a.components.applicability||(a.company_id<b.company_id?-1:a.company_id>b.company_id?1:0)
}
