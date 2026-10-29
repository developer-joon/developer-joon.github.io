import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { App } from '../App'
import { benefitsClient } from '../data/benefitsArtifactClient'
it('serves local methodology with shared shell even when artifact service fails', async () => {
  const request = vi
    .spyOn(benefitsClient, 'loadManifest')
    .mockRejectedValue(Error('offline'))
  render(<App pathname="/community/benefits/methodology/" />)
  expect(
    await screen.findByRole('heading', { name: '조사 기준·정정 이력' }),
  ).toBeVisible()
  expect(screen.getByRole('banner')).toBeVisible()
  expect(screen.getByRole('contentinfo')).toBeVisible()
  expect(screen.getByText('예시 데이터')).toBeVisible()
  expect(request).not.toHaveBeenCalled()
})

it('preserves a normalized shared query through methodology and back to explorer tabs', async () => {
  render(
    <App
      pathname="/community/benefits/methodology/"
      search="?scope=domestic&q=%20%EA%B2%BD%EA%B3%84%20&categories=family&compare=example-001&page=2&preset=custom&weights=family:5&evil=drop"
    />,
  )

  await screen.findByRole('heading', { name: '조사 기준·정정 이력' })
  const heatmap = screen.getByRole('link', { name: '복지 히트맵' })
  const methodology = screen.getByRole('link', {
    name: '조사 기준·정정 이력',
  })
  for (const link of [heatmap, methodology]) {
    const url = new URL(link.getAttribute('href')!, 'https://example.test')
    expect(url.searchParams.get('scope')).toBe('domestic')
    expect(url.searchParams.get('q')).toBe('경계')
    expect(url.searchParams.get('categories')).toBe('family')
    expect(url.searchParams.get('compare')).toBe('example-001')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('weights')).toBe('family:5')
    expect(url.searchParams.has('evil')).toBe(false)
  }
})
