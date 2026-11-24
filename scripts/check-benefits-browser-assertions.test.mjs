import assert from 'node:assert/strict'
import test from 'node:test'
import { assertClaimFixture } from './check-benefits-browser-assertions.mjs'

const valid = () => {
  const cards = [
    { kind: 'official', category: 'health', id: 'claim-a', metadata: true, reactionHref: '/community/benefits/claim-reaction/?claim=a' },
    { kind: 'community', category: 'meals', id: 'claim-b', metadata: true, reactionHref: '/community/benefits/claim-reaction/?claim=b' },
    { kind: 'submitted', category: 'health', id: 'claim-c', metadata: true, reactionHref: '/community/benefits/claim-reaction/?claim=c' },
    { kind: 'disputed', category: 'meals', id: 'claim-d', metadata: true, reactionHref: '/community/benefits/claim-reaction/?claim=d' },
  ]
  return {
    rpc: { officialCount: 1, communityCount: 1, categories: ['health', 'meals'] },
    cards,
    expected: { officialCount: 1, communityCount: 1, categories: ['health', 'meals'], cards: structuredClone(cards) },
  }
}

test('accepts a deterministic non-vacuous claim fixture', () => assert.equal(assertClaimFixture(valid()).coverage, 'claim_fixture'))

for (const [name, mutate] of [
  ['zero cards', value => { value.cards = [] }],
  ['count mismatch', value => { value.rpc.communityCount = 2 }],
  ['category mismatch', value => { value.rpc.categories = ['health'] }],
  ['missing metadata', value => { value.cards[0].metadata = false }],
  ['missing reaction link', value => { value.cards[1].reactionHref = null }],
  ['duplicate promoted card', value => { value.cards.push({ ...value.cards[1] }) }],
]) test(`fixture mode rejects ${name}`, () => {
  const value = valid(); mutate(value)
  assert.throws(() => assertClaimFixture(value))
})