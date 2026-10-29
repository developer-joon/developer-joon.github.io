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
