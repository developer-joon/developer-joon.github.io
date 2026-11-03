/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

const extractScssBlock = (source: string, marker: string): string => {
  const markerIndex = source.indexOf(marker)
  if (markerIndex === -1) throw new Error(`Missing SCSS marker: ${marker}`)

  const openingBrace = source.indexOf('{', markerIndex + marker.length)
  if (openingBrace === -1) throw new Error(`Missing SCSS block for: ${marker}`)

  let depth = 1
  for (let index = openingBrace + 1; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(openingBrace + 1, index)
  }

  throw new Error(`Unclosed SCSS block for: ${marker}`)
}

const tokens = read('src/styles/tokens.css')
const globalCss = read('src/styles/global.css')
const communityCss = read('src/styles/community.css')
const benefitsCss = read('src/styles/benefits.css')
const jekyllHeaderScss = read('../_sass/_includes/_header.scss')
const jekyllSettings = read('../_data/settings.yml')
const entryHtml = [
  'index.html',
  'write/index.html',
  'post/index.html',
  'edit/index.html',
  'auth/callback/index.html',
  'admin/reports/index.html',
  'benefits/correction/index.html',
  'benefits/my-corrections/index.html',
  'admin/benefit-corrections/index.html',
].map(read)
const benefitsExplorerEntries = [
  ['benefits/index.html', '복지 현황'],
  ['benefits/fit/index.html', '조건 탐색'],
  ['benefits/company/index.html', '기업 근거 상세'],
  ['benefits/methodology/index.html', '조사 기준·정정 이력'],
] as const
const benefitCorrectionSources = [
  'src/components/benefits/BenefitsCorrectionLink.tsx',
  'src/pages/BenefitCorrectionPage.tsx',
  'src/pages/BenefitsCompanyPage.tsx',
  'src/pages/BenefitsMethodologyPage.tsx',
].map(read).join('\n')
const shellSources = [
  'src/pages/CommunityHomePage.tsx',
  'src/pages/PostDetailPage.tsx',
  'src/pages/WritePostPage.tsx',
  'src/pages/EditPostPage.tsx',
  'src/pages/AuthCallbackPage.tsx',
  'src/pages/AdminReportsPage.tsx',
  'src/pages/AdminBenefitCorrectionsPage.tsx',
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

function tokenValue(name: string) {
  return tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, 'i'))?.[1]
}

function relativeLuminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)!.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(foreground: string, background: string) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

const allowedSvgAttributes: Record<string, readonly string[]> = {
  svg: ['xmlns', 'viewBox', 'fill'],
  rect: ['width', 'height', 'rx', 'ry', 'fill'],
  path: ['d', 'stroke', 'stroke-width'],
  polyline: ['points', 'stroke', 'stroke-width', 'opacity'],
  line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'opacity'],
  circle: ['cx', 'cy', 'r', 'fill', 'opacity'],
}

const requiredSvgAttributes: Record<string, readonly string[]> = {
  svg: ['xmlns', 'viewBox'],
  rect: ['width', 'height'],
  path: ['d'],
  polyline: ['points'],
  line: ['x1', 'y1', 'x2', 'y2'],
  circle: ['cx', 'cy', 'r'],
}

const svgDecimalSource = '-?(?:0|[1-9]\\d*)(?:\\.\\d+)?'
const safeSvgDecimal = new RegExp(`^${svgDecimalSource}$`)
const safeSvgPaintValue = /^(?:none|#[0-9a-f]{6})$/i
const safeSvgOpacityValue = /^(?:0(?:\.\d{1,2})?|1(?:\.0{1,2})?)$/
const maxSvgCoordinate = 10_000
const maxSvgStrokeWidth = 10

function isBoundedSvgDecimal(value: string, minimum: number, maximum: number, minimumIsExclusive = false) {
  if (!safeSvgDecimal.test(value)) return false
  const number = Number(value)
  return Number.isFinite(number) && (minimumIsExclusive ? number > minimum : number >= minimum) && number <= maximum
}

function isSafeSvgViewBox(value: string) {
  const match = value.match(new RegExp(`^(${svgDecimalSource}) +(${svgDecimalSource}) +(${svgDecimalSource}) +(${svgDecimalSource})$`))
  return Boolean(match
    && isBoundedSvgDecimal(match[1], -maxSvgCoordinate, maxSvgCoordinate)
    && isBoundedSvgDecimal(match[2], -maxSvgCoordinate, maxSvgCoordinate)
    && isBoundedSvgDecimal(match[3], 0, maxSvgCoordinate, true)
    && isBoundedSvgDecimal(match[4], 0, maxSvgCoordinate, true))
}

function isSafeSvgPoints(value: string) {
  const pointList = new RegExp(`^${svgDecimalSource},${svgDecimalSource}(?: +${svgDecimalSource},${svgDecimalSource})*$`)
  return pointList.test(value)
    && [...value.matchAll(new RegExp(svgDecimalSource, 'g'))]
      .every((match) => isBoundedSvgDecimal(match[0], -maxSvgCoordinate, maxSvgCoordinate))
}

function isSafeSvgPath(value: string) {
  const decimalAtCursor = new RegExp(svgDecimalSource, 'y')
  let cursor = 0

  const skipSpaces = () => {
    while (value[cursor] === ' ') cursor += 1
  }
  const readDecimal = () => {
    decimalAtCursor.lastIndex = cursor
    const match = decimalAtCursor.exec(value)
    if (!match || !isBoundedSvgDecimal(match[0], -maxSvgCoordinate, maxSvgCoordinate)) return false
    cursor = decimalAtCursor.lastIndex
    return true
  }
  const readSeparator = () => {
    const start = cursor
    skipSpaces()
    if (value[cursor] === ',') {
      cursor += 1
      skipSpaces()
      return true
    }
    return cursor > start
  }
  const readCoordinate = (separatorRequired = false) => {
    if (separatorRequired) {
      if (!readSeparator()) return false
    } else {
      skipSpaces()
    }
    return readDecimal()
  }

  skipSpaces()
  if (value[cursor] !== 'M') return false
  cursor += 1
  if (!readCoordinate() || !readCoordinate(true)) return false
  skipSpaces()

  let cubicSegments = 0
  while (cursor < value.length) {
    if (value[cursor] !== 'C') return false
    cursor += 1
    if (!readCoordinate()) return false
    for (let coordinate = 1; coordinate < 6; coordinate += 1) {
      if (!readCoordinate(true)) return false
    }
    cubicSegments += 1
    skipSpaces()
  }

  return cubicSegments > 0
}

function isSafeSvgAttributeValue(attribute: string, value: string) {
  if (attribute === 'xmlns') return value === 'http://www.w3.org/2000/svg'
  if (attribute === 'viewBox') return isSafeSvgViewBox(value)
  if (attribute === 'fill' || attribute === 'stroke') return safeSvgPaintValue.test(value)
  if (attribute === 'opacity') return safeSvgOpacityValue.test(value)
  if (attribute === 'stroke-width') return isBoundedSvgDecimal(value, 0, maxSvgStrokeWidth, true)
  if (attribute === 'width' || attribute === 'height' || attribute === 'r') {
    return isBoundedSvgDecimal(value, 0, maxSvgCoordinate, true)
  }
  if (attribute === 'rx' || attribute === 'ry') return isBoundedSvgDecimal(value, 0, maxSvgCoordinate)
  if (['x1', 'y1', 'x2', 'y2', 'cx', 'cy'].includes(attribute)) {
    return isBoundedSvgDecimal(value, -maxSvgCoordinate, maxSvgCoordinate)
  }
  if (attribute === 'points') return isSafeSvgPoints(value)
  if (attribute === 'd') return isSafeSvgPath(value)
  return false
}

function validateDecorativeSvg(svg: string) {
  const errors: string[] = []
  const svgWithoutNamespace = svg.replace(/\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '')
  const tagPattern = /<\/?[a-z][\w-]*(?:\s+[a-z][\w-]*\s*=\s*"[^"]*")*\s*\/?>/gi
  const tags = [...svg.matchAll(tagPattern)].map((match) => match[0])
  const openElements: string[] = []
  let rootCount = 0

  if (!/^<svg\b/.test(svg)) errors.push('missing svg root')
  if (/<style\b|\sstyle\s*=|@import\b|url\s*\(/i.test(svg)) errors.push('forbidden CSS construct')
  if (/<script\b|\son[a-z]+\s*=|<foreignObject\b|<text\b|&(?:#\d+|#x[\da-f]+|[a-z][\w.-]*);/i.test(svg)) {
    errors.push('forbidden active content')
  }
  if (/(?:href|src)\s*=|(?:https?:)?\/\/|data:/i.test(svgWithoutNamespace)) errors.push('external resource reference')
  if (svg.replace(tagPattern, '').trim()) errors.push('non-element content or malformed markup')

  for (const tag of tags) {
    const element = tag.match(/^<\/?([a-z][\w-]*)/i)?.[1]
    if (!element || !allowedSvgAttributes[element]) {
      errors.push(`element not allowed: ${element ?? tag}`)
      continue
    }

    if (tag.startsWith('</')) {
      if (tag !== `</${element}>` || openElements.pop() !== element) errors.push(`invalid closing element: ${element}`)
      continue
    }

    if (element === 'svg') {
      rootCount += 1
      if (openElements.length > 0) errors.push('nested svg root')
    } else if (openElements.length === 0) {
      errors.push(`element outside svg root: ${element}`)
    }

    const seenAttributes = new Set<string>()
    for (const attributeMatch of tag.matchAll(/\s+([a-z][\w-]*)\s*=\s*"([^"]*)"/gi)) {
      const attribute = attributeMatch[1]
      const value = attributeMatch[2]
      if (!allowedSvgAttributes[element].includes(attribute)) errors.push(`attribute not allowed on ${element}: ${attribute}`)
      if (!isSafeSvgAttributeValue(attribute, value)) errors.push(`attribute value not allowed for ${attribute}: ${value}`)
      if (seenAttributes.has(attribute)) errors.push(`duplicate attribute on ${element}: ${attribute}`)
      seenAttributes.add(attribute)
    }

    for (const requiredAttribute of requiredSvgAttributes[element]) {
      if (!seenAttributes.has(requiredAttribute)) errors.push(`missing required attribute on ${element}: ${requiredAttribute}`)
    }

    if (!tag.endsWith('/>')) openElements.push(element)
  }

  if (rootCount !== 1) errors.push('expected exactly one svg root')
  if (openElements.length > 0) errors.push(`unclosed element: ${openElements.at(-1)}`)

  return errors
}

describe('Jekyll visual contract', () => {
  it('keeps the recognizable site palette while assigning accessible functional colors', () => {
    expect(tokens).toContain('--background: #ffffff;')
    expect(tokens).toContain('--background-alt: #f4f5f6;')
    expect(tokens).toContain('--text-dark: #2A2F36;')
    expect(tokens).toContain('--text-medium: #5d6875;')
    expect(tokens).toContain('--text-light: #6c757d;')
    expect(tokens).toContain('--accent: #2176ad;')
    expect(tokens).toContain('--accent-legacy: #3498db;')
    expect(tokens).toContain('--border: #dddddd;')
    expect(tokens).toContain('--error: #c53531;')
    expect(tokens).toContain('--font-family: "Muli", sans-serif;')
    expect(`${tokens}\n${globalCss}\n${communityCss}`).not.toMatch(/Georgia|#(?:f4f0e7|e8e1d4|f7f1e6|faf7f0|262824|1e211e|1557b0|0f3f83)/i)
    expect(communityCss).toMatch(/\.markdown-content pre[^}]*background:\s*var\(--text-dark\)[^}]*color:\s*#fff/)
  })

  it('meets WCAG AA contrast for representative normal text, links, controls, metadata, and errors', () => {
    const usages = [
      ['body text', 'text-medium', 'background'],
      ['ordinary links', 'text-dark', 'background'],
      ['accent links and outlined controls', 'accent', 'background'],
      ['accent button labels', 'background', 'accent'],
      ['footer metadata', 'text-light', 'background'],
      ['errors', 'error', 'background'],
    ] as const

    for (const [usage, foregroundToken, backgroundToken] of usages) {
      const foreground = tokenValue(foregroundToken)
      const background = tokenValue(backgroundToken)
      expect(foreground, `${usage} foreground token`).toBeDefined()
      expect(background, `${usage} background token`).toBeDefined()
      expect(contrastRatio(foreground!, background!), `${usage} contrast`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('loads the same Muli weights as the Jekyll site', () => {
    expect(entryHtml.every((html) => html.includes('https://fonts.googleapis.com/css?family=Muli:300,400,600,700'))).toBe(true)
  })

  it('loads the same favicon as the Jekyll site in every Community entry shell', () => {
    expect(entryHtml.every((html) => html.includes('<link rel="shortcut icon" href="/images/favicon.ico" />'))).toBe(true)
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
    [767, '20px', undefined],
    [768, '40px 0 0', '70%'],
  ])('matches the Jekyll mobile menu-list geometry at %ipx', (viewportWidth, padding, maxWidth) => {
    const menuList = computedDeclarations(['global-navigation__list'], 'ul', viewportWidth)
    expect(menuList.padding).toBe(padding)
    expect(menuList['max-width']).toBe(maxWidth)
    expect(menuList.margin).toBe('0 auto')
  })

  it.each([390, 768])('keeps the mobile menu above the brand and below its toggle at %ipx', (viewportWidth) => {
    const navigation = computedDeclarations(['global-navigation', 'is-open'], 'nav', viewportWidth)
    const brand = computedDeclarations(['community-brand'], 'a', viewportWidth)
    const toggle = computedDeclarations(['menu-toggle'], 'button', viewportWidth)

    expect(navigation.position).toBe('fixed')
    expect(navigation.inset).toBe('0')
    expect(Number(navigation['z-index'])).toBeGreaterThan(Number(brand['z-index'] ?? 0))
    expect(Number(toggle['z-index'])).toBeGreaterThan(Number(navigation['z-index']))
  })

  it('bounds the mobile menu to a 390px viewport without changing the Jekyll 20px inset', () => {
    const viewportWidth = 390
    const navigation = computedDeclarations(['global-navigation', 'is-open'], 'nav', viewportWidth)
    const menuList = computedDeclarations(['global-navigation__list'], 'ul', viewportWidth)

    expect(navigation['min-width']).toBe('0')
    expect(navigation['overflow-y']).toBe('auto')
    expect(menuList.width).toBe('100%')
    expect(menuList['min-width']).toBe('0')
    expect(menuList.padding).toBe('20px')
  })

  it.each([
    [767, '20px', '25px', '500px', '30px'],
    [768, '25px', '30px', '680px', '0'],
    [1024, '25px', '30px', '900px', '0'],
    [1220, '30px', '35px', '1100px', '0'],
  ])('computes the explicit Jekyll header contract at %ipx', (viewportWidth, marginTop, brandSize, maxWidth, toggleRight) => {
    const header = computedDeclarations(['community-header'], 'header', viewportWidth)
    const headerWrap = computedDeclarations(['community-wrap', 'community-header__wrap'], 'div', viewportWidth)
    const brand = computedDeclarations(['community-brand'], 'a', viewportWidth)
    const toggle = computedDeclarations(['menu-toggle'], 'button', viewportWidth)
    expect(header['margin-top']).toBe(marginTop)
    expect(header.width).toBe('100%')
    expect(headerWrap['max-width']).toBe(maxWidth)
    expect(headerWrap.position).toBe('relative')
    expect(brand['font-size']).toBe(brandSize)
    expect(brand['font-weight']).toBe('700')
    expect(brand['letter-spacing']).toBe('-.02em')
    expect(brand['line-height']).toBe('1')
    expect(toggle.position).toBe('absolute')
    expect(toggle.right).toBe(toggleRight)
    expect(toggle['z-index']).toBe('1004')
  })

  it.each([
    [1024, '15px'],
    [1220, '17px'],
  ])('right-aligns desktop navigation exactly like Jekyll at %ipx', (viewportWidth, fontSize) => {
    const navigation = computedDeclarations(['global-navigation'], 'nav', viewportWidth)
    const menuList = computedDeclarations(['global-navigation__list'], 'ul', viewportWidth)
    expect(navigation.position).toBe('absolute')
    expect(navigation.top).toBe('50%')
    expect(navigation.right).toBe('20px')
    expect(navigation.transform).toBe('translateY(-50%)')
    expect(menuList.gap).toBe('20px')
    expect(menuList['font-size']).toBe(fontSize)
    expect(menuList['font-weight']).toBe('600')
  })

  it('matches Jekyll mobile line boxes and hamburger alignment', () => {
    const mobileMenuList = computedDeclarations(['global-navigation__list'], 'ul', 390)
    const tabletMenuList = computedDeclarations(['global-navigation__list'], 'ul', 768)
    const mobileMenuLink = computedDeclarations(['global-navigation'], 'a', 390)
    const mobileToggle = computedDeclarations(['menu-toggle'], 'button', 390)
    const tabletToggle = computedDeclarations(['menu-toggle'], 'button', 768)
    const toggleIcon = computedDeclarations(['menu-toggle__icon'], 'span', 390)

    expect(mobileMenuList['font-size']).toBe('18px')
    expect(mobileMenuList['line-height']).toBe('1.6')
    expect(tabletMenuList['font-size']).toBe('20px')
    expect(tabletMenuList['line-height']).toBe('1.6')
    expect(mobileMenuLink['font-size']).toBe('30px')
    expect(mobileMenuLink['font-weight']).toBe('600')
    expect(mobileToggle.width).toBe('32px')
    expect(mobileToggle.height).toBe('38px')
    expect(mobileToggle.padding).toBe('9px 0')
    expect(mobileToggle.right).toBe('30px')
    expect(tabletToggle.right).toBe('0')
    expect(toggleIcon['margin-left']).toBe('8px')
  })

  it('uses matching 56px mobile tap targets and compact desktop link boxes in both shells', () => {
    const mobileNavigationLink = computedDeclarations(['global-navigation'], 'a', 390)
    const desktopNavigationLink = computedDeclarations(['global-navigation'], 'a', 1024)
    const largeDesktopNavigationLink = computedDeclarations(['global-navigation'], 'a', 1220)
    const menuLinkBlock = extractScssBlock(jekyllHeaderScss, '.menu__list__item__link')
    const baseMenuLinkBlock = menuLinkBlock.split('@include mq(tabletl)')[0]
    const desktopMenuLinkBlock = extractScssBlock(menuLinkBlock, '@include mq(tabletl)')

    expect(mobileNavigationLink.display).toBe('flex')
    expect(mobileNavigationLink['min-height']).toBe('56px')
    expect(mobileNavigationLink['align-items']).toBe('center')
    expect(baseMenuLinkBlock).toMatch(/display:\s*flex;/)
    expect(baseMenuLinkBlock).toMatch(/min-height:\s*56px;/)
    expect(baseMenuLinkBlock).toMatch(/align-items:\s*center;/)
    expect(desktopNavigationLink.display).toBe('block')
    expect(desktopNavigationLink['min-height']).toBe('0')
    expect(desktopNavigationLink['font-size']).toBe('15px')
    expect(largeDesktopNavigationLink['font-size']).toBe('17px')
    expect(desktopMenuLinkBlock).toMatch(/display:\s*block;/)
  })

  it('uses one explicit 20px menu gap and matching link line-height in both shells', () => {
    const navigationLink = computedDeclarations(['global-navigation'], 'a', 1220)
    const menuListBlock = extractScssBlock(jekyllHeaderScss, '.menu__list')
    const desktopMenuListBlock = extractScssBlock(menuListBlock, '@include mq(tabletl)')
    const mobileMenuListBlock = menuListBlock.slice(0, menuListBlock.indexOf('@include mq(tabletl)'))
    const menuLinkBlock = extractScssBlock(jekyllHeaderScss, '.menu__list__item__link')
    const baseMenuLinkBlock = menuLinkBlock.split('@include mq(tabletl)')[0]

    expect(navigationLink['line-height']).toBe('1')
    expect(desktopMenuListBlock).toMatch(/display:\s*flex;/)
    expect(desktopMenuListBlock).toMatch(/gap:\s*20px;/)
    expect(mobileMenuListBlock).not.toMatch(/display:\s*flex;|gap:/)
    expect(jekyllHeaderScss).not.toContain('.menu__list__item {')
    expect(baseMenuLinkBlock).toMatch(/line-height:\s*1\.2;/)
  })

  it('uses a stable scrollbar gutter and changes only color for current navigation', () => {
    expect(globalCss).toMatch(/html\s*\{[^}]*scrollbar-gutter:\s*stable/)
    expect(communityCss).toMatch(/\.global-navigation \.active-link[^}]*color:\s*var\(--accent\)/)
    const activeRules = cssRules.filter((rule) => rule.selectors.includes('.global-navigation .active-link'))
    expect(activeRules).toHaveLength(1)
    expect(activeRules[0].declarations).toEqual({ color: 'var(--accent)' })
  })

  it('keeps headline scales at 60px or less', () => {
    expect(communityCss).not.toMatch(/(?:font-size:\s*clamp\([^;]*(?:6[1-9]|[7-9]\d|\d{3,})px|font-size:\s*(?:6[1-9]|[7-9]\d|\d{3,})px)/)
  })
})

describe('shared shell contract', () => {
  it('keeps Benefit Atlas correction CTAs on the internal workflow only', () => {
    const companyPage = read('src/pages/BenefitsCompanyPage.tsx')
    const methodologyPage = read('src/pages/BenefitsMethodologyPage.tsx')
    const correctionLink = read('src/components/benefits/BenefitsCorrectionLink.tsx')

    expect(companyPage).toContain('<BenefitsCorrectionLink')
    expect(methodologyPage).toContain('<BenefitsCorrectionLink')
    expect(correctionLink).toContain('정보 수정 요청')
    expect(correctionLink).toContain('/community/benefits/correction/')
    expect(benefitCorrectionSources).not.toMatch(/github(?:\.com)?|issues?\/new|issue template|template=/i)
  })

  it('keeps correction actions at the existing 56px touch target', () => {
    expect(benefitsCss).toMatch(/\.benefits-correction-link\s*\{[^}]*min-height:\s*56px;/)
    expect(benefitsCss).toMatch(/\.benefit-correction-form button,[\s\S]*\.benefit-corrections-list button\s*\{[^}]*min-height:\s*56px;/)
  })

  it('uses the Benefit Atlas brand in every explorer document title', () => {
    for (const [path, pageTitle] of benefitsExplorerEntries) {
      const html = read(path)

      expect(html).toContain(`<title>${pageTitle} · Benefit Atlas</title>`)
      expect(html).not.toContain('기업 복지 탐색기')
    }
  })

  it('exposes the benefits explorer in the Jekyll menu with full-document navigation', () => {
    expect(jekyllSettings).toMatch(/- title: "Benefit Atlas"\s+url: "\/community\/benefits\/"\s+no_ajax: true/)
    expect(jekyllSettings).not.toContain('- title: "기업 복지 탐색기"')
  })

  it('keeps the Benefit Atlas hero full bleed with the shared responsive inner wrap', () => {
    const shellSource = read('src/components/benefits/BenefitsExplorerShell.tsx')

    expect(shellSource).toMatch(/<main className="benefits-main">\s*<section className="benefit-atlas-hero"/)
    expect(shellSource).toMatch(/<section className="benefit-atlas-hero"[^>]*>\s*<div className="benefit-atlas-hero__inner community-wrap">/)
    expect(shellSource).toMatch(/<\/section>\s*<div className="benefits-workspace community-wrap">/)
    expect(shellSource.match(/<h1\b/g)).toHaveLength(1)
    expect(benefitsCss).toMatch(/\.community-page\.benefits-page main\.benefits-main\s*\{[^}]*max-width:\s*none;[^}]*padding-inline:\s*0;/)
    expect(benefitsCss).toContain("url('/images/community/benefit-atlas.svg')")
    expect(benefitsCss).toMatch(/\.benefit-atlas-hero\s*\{[^}]*overflow:\s*hidden;/)
    expect(benefitsCss).toMatch(/\.benefit-atlas-hero h1\s*\{[^}]*font-size:\s*clamp\([^;]+\);[^}]*word-break:\s*keep-all;/)
    expect(benefitsCss).toMatch(/\.benefit-atlas-hero__copy\s*\{[^}]*word-break:\s*keep-all;/)
    expect(benefitsCss).toMatch(/@media \(max-width:\s*699px\)[\s\S]*\.benefits-tabs a\s*\{[^}]*min-height:\s*56px;/)
  })

  it('uses a safe local decorative SVG for the Benefit Atlas field', () => {
    const svg = read('../images/community/benefit-atlas.svg')

    expect(svg).toMatch(/^<svg\b/)
    expect(svg).toMatch(/<(?:path|circle|line|polyline)\b/)
    expect(validateDecorativeSvg(svg)).toEqual([])
    expect(svg).not.toMatch(/Benefit Atlas|BREADLAB|기업 복지/i)
  })

  it.each([
    ['style element', '<svg xmlns="http://www.w3.org/2000/svg"><style>path{fill:red}</style><path d="M0 0"/></svg>'],
    ['inline style attribute', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" style="fill:url(/paint.svg#x)"/></svg>'],
    ['CSS import', '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "/track.css";</style><path d="M0 0"/></svg>'],
    ['CSS resource URL', '<svg xmlns="http://www.w3.org/2000/svg"><style>path{fill:url(/paint.svg#x)}</style><path d="M0 0"/></svg>'],
    ['comment-obfuscated paint URL', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="u/**/rl(/paint.svg#x)"/></svg>'],
    ['escape-obfuscated paint URL', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="u\\72 l(/paint.svg#x)"/></svg>'],
    ['paint variable', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="var(--paint)"/></svg>'],
    ['paint function', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="rgb(0 0 0)"/></svg>'],
    ['arbitrary paint token', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="red"/></svg>'],
    ['paint control character', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="#071725\u0001"/></svg>'],
  ])('rejects decorative SVG mutations containing %s', (_label, mutation) => {
    expect(validateDecorativeSvg(mutation)).not.toEqual([])
  })

  it.each([
    ['missing M coordinate', 'M0'],
    ['truncated C segment', 'M0 0 C1 2 3'],
    ['coordinates after Z', 'Z 1 2'],
    ['arc with an invalid flag', 'M0 0 A1 1 0 2 0 3 3'],
    ['unsupported L command', 'M0 0 L1 1'],
    ['unsupported A command', 'M0 0 A1 1 0 0 0 3 3'],
    ['unsupported Z command', 'M0 0 C1 2 3 4 5 6 Z'],
    ['missing all M coordinates', 'M C1 2 3 4 5 6'],
    ['extra number after C segment', 'M0 0 C1 2 3 4 5 6 7'],
    ['multiple M commands', 'M0 0 C1 2 3 4 5 6 M7 8 C9 10 11 12 13 14'],
    ['M command after C', 'C1 2 3 4 5 6 M0 0'],
    ['empty C segment', 'M0 0 C'],
    ['repeated comma separator', 'M0,,0 C1 2 3 4 5 6'],
    ['comma before C command', 'M0 0,C1 2 3 4 5 6'],
    ['missing numeric separator', 'M0 0 C1 2 3 4 5-6'],
  ])('rejects decorative SVG path grammar mutation: %s', (_label, path) => {
    const mutation = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="${path}"/></svg>`
    expect(validateDecorativeSvg(mutation)).not.toEqual([])
  })

  it('accepts the local M-plus-cubic-C path grammar with comma or space separators', () => {
    expect(isSafeSvgPath('M0,0 C1,2 3,4 5,6 C7 8 9 10 11 12')).toBe(true)
  })

  it.each([
    ['missing xmlns', '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>'],
    ['wrong xmlns', '<svg xmlns="https://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0"/></svg>'],
    ['duplicate xmlns', '<svg xmlns="http://www.w3.org/2000/svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0"/></svg>'],
    ['missing viewBox', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'],
    ['malformed viewBox', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="not a viewbox"><path d="M0 0"/></svg>'],
    ['zero viewBox width', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 10"><path d="M0 0"/></svg>'],
    ['negative viewBox height', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 -1"><path d="M0 0"/></svg>'],
    ['negative width', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="-1" height="1"/></svg>'],
    ['zero height', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="1" height="0"/></svg>'],
    ['non-finite height', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="1" height="Infinity"/></svg>'],
    ['functional width', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="calc(1)" height="1"/></svg>'],
    ['negative rx', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="1" height="1" rx="-1"/></svg>'],
    ['functional ry', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="1" height="1" ry="var(--r)"/></svg>'],
    ['out-of-bounds coordinate', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><line x1="10001" y1="0" x2="1" y2="1"/></svg>'],
    ['non-finite coordinate', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><line x1="NaN" y1="0" x2="1" y2="1"/></svg>'],
    ['functional coordinate', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="var(--x)" cy="1" r="1"/></svg>'],
    ['negative radius', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="1" cy="1" r="-1"/></svg>'],
    ['non-finite radius', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="1" cy="1" r="Infinity"/></svg>'],
    ['functional radius', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="1" cy="1" r="calc(1)"/></svg>'],
    ['empty points', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><polyline points=""/></svg>'],
    ['unpaired points', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><polyline points="0,0 1"/></svg>'],
    ['functional points', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><polyline points="0,0 calc(1),1"/></svg>'],
    ['path prose', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="not path data"/></svg>'],
    ['path function', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="Mcalc(1) 0"/></svg>'],
    ['path illegal character', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0@"/></svg>'],
    ['path control character', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0\u0001"/></svg>'],
    ['rect missing width', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect height="1"/></svg>'],
    ['rect missing height', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="1"/></svg>'],
    ['path missing d', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path/></svg>'],
    ['polyline missing points', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><polyline/></svg>'],
    ['line missing x1', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><line y1="0" x2="1" y2="1"/></svg>'],
    ['line missing y1', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><line x1="0" x2="1" y2="1"/></svg>'],
    ['line missing x2', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><line x1="0" y1="0" y2="1"/></svg>'],
    ['line missing y2', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><line x1="0" y1="0" x2="1"/></svg>'],
    ['circle missing cx', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cy="1" r="1"/></svg>'],
    ['circle missing cy', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="1" r="1"/></svg>'],
    ['circle missing r', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="1" cy="1"/></svg>'],
  ])('rejects decorative SVG root or geometry mutation: %s', (_label, mutation) => {
    expect(validateDecorativeSvg(mutation)).not.toEqual([])
  })

  it('does not retain the removed benefits heading selector', () => {
    expect(benefitsCss).not.toMatch(/\.benefits-heading\b/)
  })

  it('keeps the Community banner full width while wrapping its title and listing content', () => {
    const homeSource = read('src/pages/CommunityHomePage.tsx')

    expect(homeSource).toContain('className="community-page community-home-page"')
    expect(homeSource).toMatch(/<section className="community-network-hero"[^>]*>\s*<div className="community-wrap">\s*<h1/)
    expect(homeSource).toMatch(/<div className="community-main-content community-wrap">/)
    expect(homeSource.match(/<h1\b/g)).toHaveLength(1)
    expect(homeSource).not.toContain('PUBLIC DESK')
    expect(homeSource).toMatch(/<\/section>\s*<CommunityActions \/>/)

    for (const [viewportWidth, maxWidth, paddingInline] of [
      [767, '500px', '20px'],
      [768, '680px', '0'],
      [1024, '900px', '0'],
      [1220, '1100px', '0'],
    ] as const) {
      const main = computedDeclarations(['community-page', 'community-home-page'], 'main', viewportWidth)
      const wrap = computedDeclarations(['community-wrap'], 'div', viewportWidth)

      expect(main.width, `home main width at ${viewportWidth}px`).toBe('100%')
      expect(main['max-width'], `home main max-width at ${viewportWidth}px`).toBe('none')
      expect(main['padding-inline'], `home main padding at ${viewportWidth}px`).toBe('0')
      expect(wrap.width, `inner wrap width at ${viewportWidth}px`).toBe('100%')
      expect(wrap['max-width'], `inner wrap max-width at ${viewportWidth}px`).toBe(maxWidth)
      expect(wrap['padding-inline'], `inner wrap padding at ${viewportWidth}px`).toBe(paddingInline)
    }
  })

  it.each([
    [767, '40px', '18px', '22px'],
    [768, '50px', '20px', '30px'],
    [1024, '60px', '20px', '30px'],
    [1220, '80px', '22px', '35px'],
  ])('uses Jekyll body rhythm at %ipx', (viewportWidth, sectionSpacing, bodySize, headingSize) => {
    const content = computedDeclarations(['community-main-content'], 'div', viewportWidth)
    const tools = computedDeclarations(['community-tools'], 'section', viewportWidth)
    const heading = computedDeclarations(['list-heading'], 'h2', viewportWidth)
    expect(content['font-size']).toBe(bodySize)
    expect(content['line-height']).toBe('1.6')
    expect(tools['padding-top']).toBe(sectionSpacing)
    expect(heading['font-size']).toBe(headingSize)
    expect(heading['font-weight']).toBe('700')
    expect(heading['line-height']).toBe('1.2')
    expect(heading['letter-spacing']).toBe('-.02em')
  })

  it('matches the Blog hero dimensions and heading typography at each breakpoint', () => {
    expect(read('src/pages/CommunityHomePage.tsx')).toContain('className="community-network-hero"')

    const cases = [
      [767, '20px', '60px 0 100px', '35px'],
      [768, '25px', '120px 0 180px', '45px'],
      [1220, '30px', '160px 0 220px', '60px'],
    ] as const

    for (const [viewportWidth, marginTop, padding, fontSize] of cases) {
      const hero = computedDeclarations(['community-network-hero'], 'section', viewportWidth)
      const heading = computedDeclarations(['community-network-hero'], 'h1', viewportWidth)
      const paragraph = computedDeclarations(['community-network-hero'], 'p', viewportWidth)
      expect(hero['margin-top'], `hero margin at ${viewportWidth}px`).toBe(marginTop)
      expect(hero.padding, `hero padding at ${viewportWidth}px`).toBe(padding)
      expect(heading['font-size'], `heading size at ${viewportWidth}px`).toBe(fontSize)
      expect(heading['font-weight']).toBe('700')
      expect(heading['line-height']).toBe('1.2')
      expect(heading['letter-spacing']).toBe('-.03em')
      expect(heading.color).toBe('#fff')
      expect(paragraph['font-size']).toBe(viewportWidth < 768 ? '18px' : viewportWidth < 1220 ? '20px' : '22px')
      expect(paragraph['line-height']).toBe('1.6')
      expect(paragraph['margin-top']).toBe(viewportWidth < 768 ? '15px' : viewportWidth < 1220 ? '25px' : '30px')
      expect(paragraph['word-break']).toBe('keep-all')
    }
  })

  it('keeps listing actions together without narrow-screen overflow', () => {
    const mobileHeading = computedDeclarations(['list-heading'], 'div', 767)
    const mobileControls = computedDeclarations(['list-heading-controls'], 'div', 767)
    const desktopControls = computedDeclarations(['list-heading-controls'], 'div', 1024)

    expect(mobileHeading['flex-direction']).toBe('column')
    expect(mobileControls.width).toBe('100%')
    expect(mobileControls['min-width']).toBe('0')
    expect(mobileControls['justify-content']).toBe('space-between')
    expect(mobileControls['flex-wrap']).toBe('wrap')
    expect(desktopControls['margin-left']).toBe('auto')
  })

  it('uses a local decorative network SVG with the Blog overlay treatment', () => {
    const svg = read('../images/community/community-network.svg')

    expect(communityCss).toContain("url('/images/community/community-network.svg')")
    expect(communityCss).toMatch(/\.community-network-hero::before[^}]*background:\s*rgb\(19 41 48 \/ 80%\)/)
    expect(svg).toMatch(/^<svg\b/)
    expect(svg).toMatch(/<(?:path|line|polyline)\b/)
    expect(svg).toMatch(/<circle\b/)
    expect(svg).not.toMatch(/<(?:text|title|desc)\b|(?:href|src)\s*=/i)
  })

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
      'src/pages/AdminBenefitCorrectionsPage.tsx',
    ].every((path) => read(path).includes('<AppFooter />'))).toBe(true)
  })

  it.each([
    [767, '40px', '20px', '18px'],
    [768, '50px', '0', '20px'],
    [1024, '60px', '0', '20px'],
    [1220, '80px', '0', '22px'],
  ])('matches Jekyll footer spacing and tagline typography at %ipx', (viewportWidth, paddingBlock, paddingInline, fontSize) => {
    const footer = computedDeclarations(['community-footer'], 'footer', viewportWidth)
    const tagline = computedDeclarations(['community-footer', 'footer-tagline'], 'p', viewportWidth)
    expect(communityCss).not.toMatch(/\.community-footer\s*\{[^}]*\bpadding\s*:/)
    expect(footer['padding-block']).toBe(paddingBlock)
    expect(footer['padding-inline']).toBe(paddingInline)
    expect(footer.display).toBe('block')
    expect(tagline['font-size']).toBe(fontSize)
    expect(tagline['line-height']).toBe('1.6')
  })

  it('does not present BREADLAB as a separate shell brand', () => {
    expect(shellSources).not.toMatch(/BREADLAB|EDITORIAL DESK/)
    expect(entryHtml.join('\n')).not.toMatch(/Breadlab/i)
    expect(read('src/App.tsx')).not.toMatch(/Breadlab Journal|Breadlab 커뮤니티|Georgia|#f4f0e7/i)
  })
})
