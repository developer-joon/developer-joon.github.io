import assert from 'node:assert/strict'

const kinds = ['official', 'community', 'submitted', 'disputed']
const sorted = values => [...values].sort()

export function assertClaimFixture({ rpc, cards, expected }) {
  assert.ok(Number.isSafeInteger(expected.officialCount) && expected.officialCount >= 1, 'fixture expected official count must be positive')
  assert.ok(Number.isSafeInteger(expected.communityCount) && expected.communityCount >= 1, 'fixture expected community count must be positive')
  assert.ok(Array.isArray(expected.categories) && expected.categories.length > 0, 'fixture expected categories must be nonempty')
  assert.ok(Array.isArray(expected.cards) && expected.cards.length >= 4, 'fixture expected cards must be explicit')
  assert.ok(Array.isArray(cards) && cards.length > 0, 'claim fixture requires cards before universal assertions')
  assert.equal(rpc.officialCount, expected.officialCount, 'official count mismatch')
  assert.equal(rpc.communityCount, expected.communityCount, 'community count mismatch')
  assert.deepEqual(sorted(rpc.categories), sorted(expected.categories), 'category mismatch')
  for (const kind of kinds) assert.ok(cards.some(card => card.kind === kind), `missing ${kind} claim section card`)
  assert.ok(cards.every(card => card.metadata === true), 'card metadata missing')
  assert.ok(cards.every(card => typeof card.reactionHref === 'string' && card.reactionHref.includes('/community/benefits/claim-reaction/')), 'reaction link missing')
  const ids = cards.map(card => card.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate promoted card or DOM id')
  assert.equal(cards.filter(card => card.kind === 'official').length, expected.officialCount, 'official card count mismatch')
  assert.equal(cards.filter(card => card.kind === 'community').length, expected.communityCount, 'community card count mismatch')
  assert.deepEqual(cards, expected.cards, 'exact claim card metadata or reaction link mismatch')
  return { coverage: 'claim_fixture' }
}