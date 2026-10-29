import rawManifest from '../../public/data/company-benefits/manifest.json'
import rawIndex from '../../public/data/company-benefits/fixture-v1/company-index.json'
import rawRankings from '../../public/data/company-benefits/fixture-v1/rankings.json'
import rawDetails from '../../public/data/company-benefits/fixture-v1/details/companies.json'
import rawMethod from '../../public/data/company-benefits/fixture-v1/methodology.json'
import { manifestSchema, indexSchema, rankingsSchema, detailsSchema, methodologySchema } from '../types/benefits'
export const manifest = manifestSchema.parse(rawManifest)
export const index = indexSchema.parse(rawIndex)
export const rankings = rankingsSchema.parse(rawRankings)
export const details = detailsSchema.parse(rawDetails)
export const method = methodologySchema.parse(rawMethod)
