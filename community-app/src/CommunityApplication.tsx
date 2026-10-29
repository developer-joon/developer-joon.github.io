import { App } from './App'
import { AuthProvider } from './auth/AuthProvider'

export default function CommunityApplication() {
  return (
    <AuthProvider>
      <App />
    </AuthProvider>
  )
}
