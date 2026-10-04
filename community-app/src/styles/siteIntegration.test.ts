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
    expect(`${tokens}\n${globalCss}\n${communityCss}`).not.toMatch(/Georgia|#f4f0e7|#e8e1d4|#1557b0|#0f3f83/i)
  })

  it('loads the same Muli weights as the Jekyll site', () => {
    expect(entryHtml.every((html) => html.includes('https://fonts.googleapis.com/css?family=Muli:300,400,600,700'))).toBe(true)
  })

  it('matches the site wrap widths and desktop navigation breakpoint', () => {
    expect(communityCss).toContain('max-width: 500px')
    expect(communityCss).toMatch(/@media \(min-width: 768px\)[\s\S]*max-width: 680px/)
    expect(communityCss).toMatch(/@media \(min-width: 1024px\)[\s\S]*max-width: 900px/)
    expect(communityCss).toMatch(/@media \(min-width: 1220px\)[\s\S]*max-width: 1100px/)
    expect(communityCss).toMatch(/@media \(max-width: 1023px\)[\s\S]*\.global-navigation\s*\{[\s\S]*visibility:\s*hidden/)
    expect(communityCss).toMatch(/@media \(max-width: 1023px\)[\s\S]*\.global-navigation\.is-open\s*\{[\s\S]*visibility:\s*visible/)
    expect(communityCss).toMatch(/@media \(min-width: 1024px\)[\s\S]*\.menu-toggle\s*\{[\s\S]*display:\s*none/)
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
    expect(read('src/components/AppFooter.tsx')).toContain('href="/privacy/"')
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
