#!/usr/bin/env node
// Local, ephemeral Chromium acceptance. No package installation or persistent server.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
const root = path.resolve(process.argv[2] ?? 'community-app/dist')
const chrome = process.env.BENEFITS_CHROMIUM
if (!chrome) throw Error('Set BENEFITS_CHROMIUM to a local Chromium executable')
const profile = await mkdtemp(path.join(tmpdir(), 'benefits-browser-'))
let performanceFixture
const server = createServer(async (req, res) => {
  try {
    let name = new URL(req.url, 'http://localhost').pathname
    if (!name.startsWith('/community/')) {
      res.writeHead(404).end()
      return
    }
    name = name.slice('/community/'.length)
    if (!name || name.endsWith('/')) name += 'index.html'
    const filename = path.resolve(root, name)
    if (!filename.startsWith(root + path.sep)) throw Error('path')
    const body = performanceFixture?.[name] ?? (await readFile(filename))
    res.setHeader(
      'Content-Type',
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
      }[path.extname(filename)] ?? 'application/octet-stream',
    )
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = spawn(
  chrome,
  [
    '--headless',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-extensions',
    '--no-first-run',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let socket
try {
  let port
  for (let n = 0; n < 100; n++) {
    try {
      port = (
        await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
      ).split('\n')[0]
      break
    } catch {
      await sleep(100)
    }
  }
  if (!port) throw Error('Chromium did not start')
  const { webSocketDebuggerUrl } = await (
    await fetch(`http://127.0.0.1:${port}/json/version`)
  ).json()
  socket = new WebSocket(webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  let sequence = 0
  const pending = new Map(),
    requests = [],
    errors = []
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const callbacks = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) callbacks.reject(Error(message.error.message))
      else callbacks.resolve(message.result)
    } else if (message.method === 'Network.requestWillBeSent')
      requests.push(message.params.request.url)
    else if (message.method === 'Runtime.exceptionThrown')
      errors.push(
        message.params.exceptionDetails.exception?.description ??
          message.params.exceptionDetails.text,
      )
  }
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', {
    targetId,
    flatten: true,
  })
  const call = (method, params) => send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Network.enable')
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text)
    return result.result.value
  }
  const wait = async (expression) => {
    for (let n = 0; n < 150; n++) {
      try {
        if (await evaluate(`Boolean(${expression})`)) return
      } catch {}
      await sleep(100)
    }
    throw Error(
      `Timed out: ${expression}; body=${await evaluate('document.body.innerText.slice(0,1600)')}; exceptions=${JSON.stringify(errors)}; requests=${JSON.stringify(requests)}`,
    )
  }
  const navigate = async (suffix) => {
    await call('Page.navigate', {
      url: origin + '/community/benefits/' + suffix,
    })
  }
  await call('Page.navigate', { url: origin + '/community/' })
  await wait(`document.querySelector('.community-brand')`)
  const sharedHeaderStyles = await evaluate(
    `JSON.stringify([getComputedStyle(document.querySelector('.community-brand')).color,getComputedStyle(document.querySelector('.menu-toggle')).backgroundColor])`,
  )
  const findings = []
  for (const [label, width, height] of [
    ['desktop', 1440, 1000],
    ['tablet', 900, 1000],
    ['mobile', 390, 844],
  ]) {
    await call('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 700,
    })
    requests.length = 0
    await navigate('')
    await wait(`document.querySelector('.benefits-heatmap tbody tr')`)
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.benefits-heatmap tbody tr').length`,
      ),
      50,
    )
    assert.equal(
      await evaluate(
        `JSON.stringify([getComputedStyle(document.querySelector('.community-brand')).color,getComputedStyle(document.querySelector('.menu-toggle')).backgroundColor])`,
      ),
      sharedHeaderStyles,
      'explorer changed shared header styling',
    )
    assert.equal(
      await evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`),
      true,
      `${label} body overflow`,
    )
    assert.equal(
      await evaluate(
        `(()=>{const area=document.querySelector('.benefits-table-scroll');return area.scrollWidth>area.clientWidth})()`,
      ),
      true,
      'heatmap does not expose horizontal scrolling',
    )
    assert.equal(
      requests.some((url) => url.includes('/details/')),
      false,
      'heatmap fetched detail sources',
    )
    assert.equal(
      requests.some((url) => url.endsWith('/rankings.json')),
      false,
      'unselected heatmap fetched rankings',
    )
    if (width < 700) {
      await evaluate(
        `document.querySelector('.benefits-layout button').click()`,
      )
      await wait(`document.querySelector('dialog[open]')`)
      await call('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      })
      await call('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      })
      await wait(`!document.querySelector('dialog[open]')`)
      assert.equal(
        await evaluate(`document.activeElement.textContent`),
        '필터 열기',
      )
    }
    const checks = `[...document.querySelectorAll('.benefits-heatmap input[type=checkbox]')]`
    await evaluate(`${checks}.slice(0,4).forEach(c=>c.click())`)
    assert.equal(await evaluate(`${checks}[4].disabled`), true)
    assert.equal(
      await evaluate(
        `new URLSearchParams(location.search).get('compare').split(',').length`,
      ),
      4,
    )
    if (width >= 700) {
      const count = requests.length
      await evaluate(`document.querySelector('input[type=search]').focus()`)
      await call('Input.insertText', { text: '없는기업' })
      await wait(
        `document.querySelector('.benefits-results').textContent.includes('검색 결과가 없습니다')`,
      )
      assert.equal(requests.length, count, 'filter refetched artifacts')
    }
    await navigate('')
    await wait(`document.querySelector('.benefits-heatmap tbody tr')`)
    await evaluate('scrollTo(0,1000)')
    assert.equal(
      await evaluate(
        `(()=>{const r=document.querySelector('.fixture-badge').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`,
      ),
      true,
      'fixture badge must remain visible while scrolling',
    )
    await evaluate('scrollTo(0,0)')
    const shot = await call('Page.captureScreenshot', { format: 'png' })
    await writeFile(
      path.join(tmpdir(), `benefits-${label}.png`),
      Buffer.from(shot.data, 'base64'),
    )
    if (label === 'desktop') {
      await evaluate(`document.querySelector('.benefits-heatmap td a').focus()`)
      await call('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      })
      await call('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      })
      await wait(
        `location.pathname==='/community/benefits/company/'&&document.activeElement.id==='leave'`,
      )
    }
    findings.push(
      `${label} ${width}×${height}: 50 rows, table scrolling, comparison limit, fixture badge, no body overflow; mobile Escape and focus checked`,
    )
  }
  await navigate('rankings/')
  await wait(
    `document.body.textContent.includes('순위를 볼 복지 분야 하나를 선택하세요.')`,
  )
  await evaluate(
    `(()=>{const s=[...document.querySelectorAll('select')].find(s=>s.parentElement.textContent.includes('순위 분야'));s.value='family';s.dispatchEvent(new Event('change',{bubbles:true}))})()`,
  )
  await wait(`document.querySelector('[aria-label="분야별 평가 결과"]')`)
  assert.equal(
    await evaluate(`document.body.textContent.includes('평가 근거 부족')`),
    true,
  )
  await navigate('fit/?preset=custom&weights=family:5')
  await wait(`document.querySelector('.benefits-result')`)
  assert.equal(
    await evaluate(
      `document.body.textContent.includes('조건 일치 기업')&&document.body.textContent.includes('판단 자료 부족')`,
    ),
    true,
  )
  await navigate('company/?id=example-001#family')
  await wait(`document.activeElement.id==='family'`)
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('a[target="_blank"]')].every(a=>a.href.startsWith('https://example.org/')&&a.rel==='noopener noreferrer')`,
    ),
    true,
  )
  await navigate('methodology/')
  await wait(`document.body.textContent.includes('정정 제보')`)
  assert.equal(
    await evaluate(
      `!!document.querySelector('.community-header')&&!!document.querySelector('.community-footer')`,
    ),
    true,
  )
  // Synthetic capacity fixture stays in this ephemeral server, never on disk.
  const index = JSON.parse(
    await readFile(
      path.join(root, 'data/company-benefits/fixture-v1/company-index.json'),
      'utf8',
    ),
  )
  const manifest = JSON.parse(
    await readFile(
      path.join(root, 'data/company-benefits/manifest.json'),
      'utf8',
    ),
  )
  const rankings = JSON.parse(
    await readFile(
      path.join(root, 'data/company-benefits/fixture-v1/rankings.json'),
      'utf8',
    ),
  )
  const details = JSON.parse(
    await readFile(
      path.join(
        root,
        'data/company-benefits/fixture-v1/details/companies.json',
      ),
      'utf8',
    ),
  )
  const companies = Array.from({ length: 2000 }, (_, i) => ({
    ...index.companies[i % index.companies.length],
    company_id: `example-${String(i + 1).padStart(3, '0')}`,
    display_name: `예시 성능기업 ${i + 1}`,
  }))
  const rankingRows = companies.flatMap((company, i) =>
    rankings.rows
      .filter(
        (row) =>
          row.company_id ===
          index.companies[i % index.companies.length].company_id,
      )
      .map((row) => ({ ...row, company_id: company.company_id })),
  )
  const detailCompanies = companies.map((company, i) => ({
    ...details.companies.find(
      (detail) =>
        detail.company_id ===
        index.companies[i % index.companies.length].company_id,
    ),
    company_id: company.company_id,
  }))
  const indexBytes = JSON.stringify({ ...index, companies }) + '\n'
  const rankingsBytes = JSON.stringify({ ...rankings, rows: rankingRows }) + '\n'
  const detailsBytes =
    JSON.stringify({ ...details, companies: detailCompanies }) + '\n'
  manifest.company_count = 2000
  manifest.detail_shards = Object.fromEntries(
    companies.map((c) => [c.company_id, manifest.detail_shards['example-001']]),
  )
  manifest.artifact_sha256[manifest.index_url] = {
    sha256: createHash('sha256').update(indexBytes).digest('hex'),
    record_count: 2000,
  }
  manifest.artifact_sha256[manifest.rankings_url] = {
    sha256: createHash('sha256').update(rankingsBytes).digest('hex'),
    record_count: rankingRows.length,
  }
  const detailsUrl = manifest.detail_shards['example-001']
  manifest.artifact_sha256[detailsUrl] = {
    sha256: createHash('sha256').update(detailsBytes).digest('hex'),
    record_count: detailCompanies.length,
  }
  performanceFixture = {
    'data/company-benefits/manifest.json': JSON.stringify(manifest),
    'data/company-benefits/fixture-v1/company-index.json': indexBytes,
    'data/company-benefits/fixture-v1/rankings.json': rankingsBytes,
    'data/company-benefits/fixture-v1/details/companies.json': detailsBytes,
  }
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  })
  requests.length = 0
  await navigate('')
  await wait(
    `document.querySelector('.benefits-results h2 small')?.textContent==='2000개 기업'`,
  )
  assert.equal(
    await evaluate(
      `document.querySelectorAll('.benefits-heatmap tbody tr').length`,
    ),
    50,
  )
  const networkCount = requests.length
  await evaluate(
    `(()=>{window.__pageStart=performance.now();const observer=new MutationObserver(()=>{if(document.querySelector('.benefits-heatmap tbody th a')?.textContent==='예시 성능기업 51'){window.__pageMs=performance.now()-window.__pageStart;observer.disconnect()}});observer.observe(document.querySelector('.benefits-results'),{childList:true,subtree:true});[...document.querySelectorAll('button')].find(b=>b.textContent==='다음 페이지').click()})()`,
  )
  await wait(`typeof window.__pageMs==='number'`)
  await evaluate(
    `(()=>{document.querySelector('input[type=search]').focus();window.__searchStart=performance.now();const observer=new MutationObserver(()=>{if(document.querySelectorAll('.benefits-heatmap tbody tr').length===1&&document.querySelector('.benefits-heatmap tbody th a')?.textContent==='예시 성능기업 1999'){window.__searchMs=performance.now()-window.__searchStart;observer.disconnect()}});observer.observe(document.querySelector('.benefits-results'),{childList:true,subtree:true})})()`,
  )
  await call('Input.insertText', { text: '1999' })
  await wait(`typeof window.__searchMs==='number'`)
  assert.equal(
    requests.length,
    networkCount,
    '2000-company filtering/pagination refetched artifacts',
  )
  findings.push(
    await evaluate(
      '`2000-company browser fixture: search ${window.__searchMs.toFixed(2)} ms; page change ${window.__pageMs.toFixed(2)} ms; 50-row cap; no refetch.`',
    ),
  )
  requests.length = 0
  await navigate('rankings/?categories=family')
  await wait(`document.querySelector('[aria-label="순위 페이지"]')`)
  assert.equal(
    await evaluate(
      `document.querySelectorAll('[aria-label="분야별 평가 결과"] > ol > li,[aria-label="평가 근거 부족"] > ul > li').length`,
    ),
    50,
    '2000-company rankings must keep a 50-row cap',
  )
  const rankingFirstPage = await evaluate(
    `document.querySelector('[aria-label="분야별 평가 결과"] li a,[aria-label="평가 근거 부족"] li a').textContent`,
  )
  await evaluate(
    `[...document.querySelectorAll('[aria-label="순위 페이지"] button')].find(button=>button.textContent==='다음 페이지').click()`,
  )
  await wait(`new URLSearchParams(location.search).get('page')==='2'`)
  assert.notEqual(
    await evaluate(
      `document.querySelector('[aria-label="분야별 평가 결과"] li a,[aria-label="평가 근거 부족"] li a').textContent`,
    ),
    rankingFirstPage,
    '2000-company rankings did not preserve URL-owned page order',
  )
  findings.push('2000-company rankings: ordered URL pagination; 50-row cap.')

  requests.length = 0
  await navigate('fit/?preset=custom&weights=family:5')
  await wait(
    `document.querySelectorAll('article.benefits-result').length===50&&document.querySelector('.benefits-applicability')`,
  )
  assert.equal(
    await evaluate(`document.querySelectorAll('article.benefits-result').length`),
    50,
    '2000-company fit must keep a 50-result cap',
  )
  assert.equal(
    requests.filter((url) => url.includes('/details/')).length,
    1,
    '2000-company fit should load detail only for the displayed candidate set',
  )
  findings.push(
    '2000-company fit: 50-result cap; displayed-candidate detail loading verified.',
  )
  assert.deepEqual(errors, [])
  console.log(findings.join('\n'))
  console.log(
    'Direct rankings/fit/company/methodology URLs, insufficient evidence, safe sources, category focus and shared shell passed. No browser exceptions.',
  )
} finally {
  socket?.close()
  browser.kill('SIGTERM')
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await new Promise((resolve) =>
    browser.exitCode !== null || browser.signalCode !== null
      ? resolve()
      : browser.once('exit', resolve),
  )
  await rm(profile, { recursive: true, force: true })
}
