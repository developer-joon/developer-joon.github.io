import rawManifest from '../../public/data/company-benefits/manifest.json'
import rawIndex from '../../public/data/company-benefits/fixture-v1/company-index.json'
import rawRankings from '../../public/data/company-benefits/fixture-v1/rankings.json'
import rawMethod from '../../public/data/company-benefits/fixture-v1/methodology.json'
import {
  manifestSchema,
  indexSchema,
  rankingsSchema,
  detailsSchema,
  methodologySchema,
} from '../types/benefits'
export const manifest = manifestSchema.parse(rawManifest)
export const index = indexSchema.parse(rawIndex)
export const rankings = rankingsSchema.parse(rawRankings)
const rawDetailShards = import.meta.glob(
  '../../public/data/company-benefits/fixture-v1/details/*.json',
  { eager: true, import: 'default' },
)
export const details = detailsSchema.parse({
  data_version: manifest.data_version,
  companies: Object.entries(rawDetailShards)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, shard]) => (shard as { companies: unknown[] }).companies),
})
export const method = methodologySchema.parse(rawMethod)
