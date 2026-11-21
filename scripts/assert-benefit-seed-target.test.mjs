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

test('accepts only canonical direct and real-shaped pooler bindings without output', () => {
  for (const url of [
    `postgresql://postgres:p%40ss@DB.${ref.toUpperCase()}.SUPABASE.CO:5432/postgres?sslmode=require`,
    `postgres://postgres.${ref}:p%40ss@aws-0-us-west-1.pooler.supabase.com:6543/postgres?sslmode=require`,
    `postgresql://postgres.${ref}:p%40ss@db.${ref}.supabase.co:5432/postgres`,
  ]) {
    const result = run(url)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
  }
})

test('rejects encoded or noncanonical pooler usernames', () => {
  for (const [label, username] of [
    ['percent-encoded project character', `postgres.%61bcdefghijklmnopqrst`],
    ['percent-encoded separator', `postgres%2e${ref}`],
    ['mixed-case username', `Postgres.${ref}`],
  ]) {
    for (const host of [`aws-0-us-west-1.pooler.supabase.com`, `db.${ref}.supabase.co`]) {
      const result = run(`postgresql://${username}:secret@${host}/postgres`)
      assert.notEqual(result.status, 0, `${label} on ${host}`)
    }
  }
})

test('rejects noncanonical pooler host labels', () => {
  const labels = [
    '-aws-0-us-west-1',
    'aws-0-us-west-1-',
    'a'.repeat(64),
    'aws_0_us_west_1',
    'extra.aws-0-us-west-1',
    'bücher',
    'xn--bcher-kva',
  ]
  for (const label of labels) {
    const result = run(`postgresql://postgres.${ref}:secret@${label}.pooler.supabase.com/postgres`)
    assert.notEqual(result.status, 0, label)
  }
})

test('rejects malformed, absent, conflicting, and mismatched identifiers', () => {
  for (const [label, url, targetRef = ref] of [
    ['no identifier', 'postgresql://postgres:secret@database.example.com/postgres'],
    ['malformed direct', 'postgresql://postgres:secret@db.short.supabase.co/postgres'],
    ['malformed pooler username', 'postgresql://postgres.short:secret@aws-0-us-west-1.pooler.supabase.com/postgres'],
    ['repeated pooler dot', `postgresql://postgres.${ref}:secret@aws-0..pooler.supabase.com/postgres`],
    ['direct percent encoding', `postgresql://postgres:secret@db.%61bcdefghijklmnopqrst.supabase.co/postgres`],
    ['direct extra label', `postgresql://postgres:secret@db.extra.${ref}.supabase.co/postgres`],
    ['mismatched direct', 'postgresql://postgres:secret@db.zyxwvutsrqponmlkjihg.supabase.co/postgres'],
    ['mismatched pooler', 'postgresql://postgres.zyxwvutsrqponmlkjihg:secret@aws-0-us-west-1.pooler.supabase.com/postgres'],
    ['conflicting direct and username', `postgresql://postgres.zyxwvutsrqponmlkjihg:secret@db.${ref}.supabase.co/postgres`],
    ['uppercase target', `postgresql://postgres:secret@db.${ref}.supabase.co/postgres`, ref.toUpperCase()],
  ]) {
    const result = run(url, targetRef)
    assert.notEqual(result.status, 0, label)
  }
})

test('rejects non-PostgreSQL URLs, whitespace or controls, and fragments', () => {
  for (const [label, url] of [
    ['wrong protocol', `https://postgres:secret@db.${ref}.supabase.co/postgres`],
    ['leading whitespace', ` postgresql://postgres:secret@db.${ref}.supabase.co/postgres`],
    ['embedded control', `postgresql://postgres:secret@db.${ref}.supabase.co/post\tgres`],
    ['fragment', `postgresql://postgres:secret@db.${ref}.supabase.co/postgres#ignored`],
  ]) {
    const result = run(url)
    assert.notEqual(result.status, 0, label)
  }
})

test('failures are category-only and never disclose the URL, username, or password', () => {
  const sentinel = 'never-print-this-sentinel'
  const fullUrl = `postgresql://postgres.${ref}:${sentinel}@-bad.pooler.supabase.com/postgres`
  for (const result of [
    run(fullUrl),
    run(`postgresql://${sentinel}:password@aws-0-us-west-1.pooler.supabase.com/postgres`),
    run(`postgresql://postgres:password@db.${ref}.supabase.co/postgres`, ref, [sentinel]),
  ]) {
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.doesNotMatch(result.stderr, new RegExp(sentinel))
    assert.doesNotMatch(result.stderr, /postgres(?:ql)?:\/\//i)
  }
})
