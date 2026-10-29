import { App, ConfigurationErrorScreen } from './App'
import { parseEnv } from './config/env'
import { benefitsRoute } from './benefitsRoutes'
import { AuthProvider } from './auth/AuthProvider'
export function createApplication(env: Record<string, unknown>) {
  try {
    parseEnv(env)
    return (
      <AuthProvider>
        <App />
      </AuthProvider>
    )
  } catch {
    return benefitsRoute(window.location.pathname) ? (
      <App />
    ) : (
      <ConfigurationErrorScreen />
    )
  }
}
