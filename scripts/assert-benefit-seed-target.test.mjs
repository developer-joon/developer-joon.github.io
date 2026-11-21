import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

const script = path.join(import.meta.dirname, 'assert-benefit-seed-target.mjs')
const ref = 'abcdefghijklmnopqrst'

function run(databaseUrl, targetRef = ref, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl, TARGET_PROJECT_REF: targetRef },
  })
}

test('accepts canonical direct and pooler bindings without output', () => {
  for (const url of [
    `postgresql://postgres:private-password@db.${ref}.supabase.co:5432/postgres`,
    `postgresql://postgres.${ref}:private-password@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`,
    `postgresql://postgres.${ref}:private-password@db.${ref}.supabase.co:5432/postgres`,
  ]) {
    const result = run(url)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
  }
})

test('rejects absent, malformed, ambiguous, and mismatched bindings without disclosing the URL', () => {
  const secret = 'never-print-this-password'
  for (const [label, url, targetRef = ref] of [
    ['absent', `postgresql://postgres:${secret}@database.example.com/postgres`],
    ['malformed direct', `postgresql://postgres:${secret}@db.short.supabase.co/postgres`],
    ['malformed pooler', `postgresql://postgres.short:${secret}@aws-0-us-east-1.pooler.supabase.com/postgres`],
    ['mismatched direct', `postgresql://postgres:${secret}@db.zyxwvutsrqponmlkjihg.supabase.co/postgres`],
    ['mismatched pooler', `postgresql://postgres.zyxwvutsrqponmlkjihg:${secret}@aws-0-us-east-1.pooler.supabase.com/postgres`],
    ['conflicting identifiers', `postgresql://postgres.zyxwvutsrqponmlkjihg:${secret}@db.${ref}.supabase.co/postgres`],
    ['uppercase target', `postgresql://postgres:${secret}@db.${ref}.supabase.co/postgres`, ref.toUpperCase()],
  ]) {
    const result = run(url.replace('***', secret), targetRef)
    assert.notEqual(result.status, 0, label)
    assert.equal(result.stdout, '', label)
    assert.doesNotMatch(result.stderr, new RegExp(secret), label)
    assert.doesNotMatch(result.stderr, /postgres(?:ql)?:\/\//i, label)
  }
  const withArgs = run(`postgresql://postgres:${secret}@db.${ref}.supabase.co/postgres`, ref, ['extra'])
  assert.notEqual(withArgs.status, 0)
  assert.doesNotMatch(withArgs.stderr, new RegExp(secret))
})