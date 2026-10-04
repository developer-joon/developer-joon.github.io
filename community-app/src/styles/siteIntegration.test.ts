/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const tokens = read('src/styles/tokens.css')
const globalCss = read('src/styles/global.css')
const communityCss = read('src/styles/community.css')
const entryHtml = [
  'index.html',
  'write/index.html',
  'post/index.html',
  'edit/index.html',
  'auth/callback/index.html',
  'admin/reports/index.html',
].map(read)
const shellSources = [
  'src/pages/CommunityHomePage.tsx',
  'src/pages/PostDetailPage.tsx',
  'src/pages/WritePostPage.tsx',
  'src/pages/EditPostPage.tsx',
  'src/pages/AuthCallbackPage.tsx',
  'src/pages/AdminReportsPage.tsx',
].map(read).join('\n')

type CssRule = {
  selectors: string[]
  declarations: Record<string, string>
  minWidth: number
  maxWidth: number
  order: number
}

function parseRules(source: string, inherited = { minWidth: 0, maxWidth: Number.POSITIVE_INFINITY }, rules: CssRule[] = []) {
  let cursor = 0
  while (cursor < source.length) {
    const open = source.indexOf('{', cursor)
    if (open < 0) break
    let depth = 1
    let close = open + 1
    while (close < source.length && depth > 0) {
      if (source[close] === '{') depth += 1
      if (source[close] === '}') depth -= 1
      close += 1
    }
    const header = source.slice(cursor, open).trim()
    const body = source.slice(open + 1, close - 1)
    if (header.startsWith('@media')) {
      const minWidth = Number(header.match(/min-width:\s*(\d+)px/)?.[1] ?? inherited.minWidth)
      const maxWidth = Number(header.match(/max-width:\s*(\d+)px/)?.[1] ?? inherited.maxWidth)
      parseRules(body, { minWidth, maxWidth }, rules)
    } else if (header && !header.startsWith('@')) {
      const declarations = Object.fromEntries(
        [...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
      )
      rules.push({ selectors: header.split(',').map((selector) => selector.trim()), declarations, ...inherited, order: rules.length })
    }
    cursor = close
  }
  return rules
}

const cssRules = parseRules(communityCss)

function specificity(selector: string) {
  return (selector.match(/\.[\w-]+/g)?.length ?? 0) * 100 + (selector.match(/(?:^|\s)main\b/g)?.length ?? 0)
}

function computedDeclarations(classes: string[], tag: string, viewportWidth: number) {
  const resolved: Record<string, { value: string; specificity: number; order: number }> = {}
  for (const rule of cssRules) {
    if (viewportWidth < rule.minWidth || viewportWidth > rule.maxWidth) continue
    for (const selector of rule.selectors) {
      const requiredClasses = [...selector.matchAll(/\.([\w-]+)/g)].map((match) => match[1])
      const requiredTag = selector.match(/(?:^|\s)([a-z][\w-]*)$/)?.[1]
      if (!requiredClasses.every((className) => classes.includes(className)) || (requiredTag && requiredTag !== tag)) continue
      const weight = specificity(selector)
      for (const [property, value] of Object.entries(rule.declarations)) {
        const previous = resolved[property]
        if (!previous || weight > previous.specificity || (weight === previous.specificity && rule.order > previous.order)) {
          resolved[property] = { value, specificity: weight, order: rule.order }
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(resolved).map(([property, result]) => [property, result.value]))
}

describe('Jekyll visual contract', () => {
  it('uses the exact site palette and Muli font tokens without the old editorial palette', () => {
    expect(tokens).toContain('--background: #ffffff;')
    expect(tokens).toContain('--background-alt: #f4f5f6;')
    expect(tokens).toContain('--text-dark: #2A2F36;')
    expect(tokens).toContain('--text-medium: #6C7A89;')
    expect(tokens).toContain('--text-light: #ABB7B7;')
    expect(tokens).toContain('--accent: #3498db;')
    expect(tokens).toContain('--border: #dddddd;')
    expect(tokens).toContain('--font-family: "Muli", sans-serif;')
    expect(`${tokens}\n${globalCss}\n${communityCss}`).not.toMatch(/Georgia|#(?:f4f0e7|e8e1d4|f7f1e6|faf7f0|262824|1e211e|1557b0|0f3f83)/i)
    expect(communityCss).toMatch(/\.markdown-content pre[^}]*background:\s*var\(--text-dark\)[^}]*color:\s*#fff/)
  })

  it('loads the same Muli weights as the Jekyll site', () => {
    expect(entryHtml.every((html) => html.includes('https://fonts.googleapis.com/css?family=Muli:300,400,600,700'))).toBe(true)
  })

  it.each([
    [767, '500px'],
    [768, '680px'],
    [1024, '900px'],
    [1220, '1100px'],
  ])('computes the Jekyll outer wrap at %ipx as %s', (viewportWidth, maxWidth) => {
    for (const pageClass of ['post-detail-page', 'auth-callback-page', 'editor-page']) {
      const computed = computedDeclarations(['community-page', pageClass], 'main', viewportWidth)
      expect(computed.width, `${pageClass} width at ${viewportWidth}px`).toBe('100%')
      expect(computed['max-width'], `${pageClass} max-width at ${viewportWidth}px`).toBe(maxWidth)
    }
  })

  it('matches the desktop navigation breakpoint', () => {
    expect(communityCss).toMatch(/@media \(max-width: 1023px\)[\s\S]*\.global-navigation\s*\{[\s\S]*visibility:\s*hidden/)
    expect(communityCss).toMatch(/@media \(max-width: 1023px\)[\s\S]*\.global-navigation\.is-open\s*\{[\s\S]*visibility:\s*visible/)
    expect(communityCss).toMatch(/@media \(min-width: 1024px\)[\s\S]*\.menu-toggle\s*\{[\s\S]*display:\s*none/)
  })

  it.each([
    [767, '20px', '30px'],
    [768, '25px', '0'],
    [1220, '30px', '0'],
  ])('computes Jekyll header spacing and toggle alignment at %ipx', (viewportWidth, marginTop, toggleRight) => {
    const header = computedDeclarations(['community-header'], 'header', viewportWidth)
    const toggle = computedDeclarations(['menu-toggle'], 'button', viewportWidth)
    expect(header['margin-top']).toBe(marginTop)
    expect(header.position).toBe('relative')
    expect(toggle.position).toBe('absolute')
    expect(toggle.right).toBe(toggleRight)
    expect(toggle['z-index']).toBe('1004')
  })

  it('uses the accent for current navigation and keeps headline scales at 60px or less', () => {
    expect(communityCss).toMatch(/\.global-navigation \.active-link[^}]*color:\s*var\(--accent\)/)
    expect(communityCss).not.toMatch(/(?:font-size:\s*clamp\([^;]*(?:6[1-9]|[7-9]\d|\d{3,})px|font-size:\s*(?:6[1-9]|[7-9]\d|\d{3,})px)/)
  })
})

describe('shared shell contract', () => {
  it('uses a shared site footer on every community shell', () => {
    expect(read('src/components/AppFooter.tsx')).toContain('Build things. Ship fast. Learn always.')
    expect(read('src/components/AppFooter.tsx')).toContain('Ria &amp; Seoa PaPa')
    expect(read('src/components/AppFooter.tsx')).toContain('href="/privacy"')
    expect(read('src/components/AppFooter.tsx')).toContain('개인정보처리방침')
    expect([
      'src/pages/CommunityHomePage.tsx',
      'src/pages/PostDetailPage.tsx',
      'src/pages/WritePostPage.tsx',
      'src/pages/EditPostPage.tsx',
      'src/pages/AuthCallbackPage.tsx',
      'src/pages/AdminReportsPage.tsx',
    ].every((path) => read(path).includes('<AppFooter />'))).toBe(true)
  })

  it('does not present BREADLAB as a separate shell brand', () => {
    expect(shellSources).not.toMatch(/BREADLAB|EDITORIAL DESK/)
    expect(entryHtml.join('\n')).not.toMatch(/Breadlab/i)
    expect(read('src/App.tsx')).not.toMatch(/Breadlab Journal|Breadlab 커뮤니티|Georgia|#f4f0e7/i)
  })
})
