import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createApplication } from './application'
import './styles/global.css'
import './styles/community.css'
import './styles/benefits.css'

const rootElement = document.getElementById('app')

if (!rootElement) {
  throw new Error('React root를 찾을 수 없습니다.')
}

createRoot(rootElement).render(
  <StrictMode>{createApplication(import.meta.env)}</StrictMode>,
)
