import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createApplication } from './application'
vi.mock('./pages/BenefitsExplorerPage', () => ({
  BenefitsExplorerPage: () => <h1>공개 복지 탐색</h1>,
}))
it('opens public artifacts when auth configuration is absent', async () => {
  window.history.replaceState({}, '', '/community/benefits/')
  render(createApplication({}))
  expect(
    await screen.findByRole('heading', { name: '공개 복지 탐색' }),
  ).toBeVisible()
})
it('keeps configuration error for Community routes without auth configuration', () => {
  window.history.replaceState({}, '', '/community/')
  render(createApplication({}))
  expect(
    screen.getByRole('heading', { name: '커뮤니티 설정을 확인해 주세요' }),
  ).toBeVisible()
})
