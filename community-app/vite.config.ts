import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  base: '/community/',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        home: page('./index.html'),
        write: page('./write/index.html'),
        post: page('./post/index.html'),
        edit: page('./edit/index.html'),
        adminReports: page('./admin/reports/index.html'),
        authCallback: page('./auth/callback/index.html'),
      },
    },
  },
})
