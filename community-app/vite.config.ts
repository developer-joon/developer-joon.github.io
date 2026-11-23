import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const canonicalBenefitsShells = new Set(['/benefits-root/index.html', '/benefits-root/company/index.html'])
const builtModuleScript = /<script type="module" crossorigin src="\/community\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.js"><\/script>\s*/g
const benefitsEntryScript = /src="\/community\/assets\/benefits-main-[A-Za-z0-9_-]{8,}\.js"/

export const canonicalBenefitsEntryOnly = {
  name: 'canonical-benefits-entry-only',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(html, context) {
      if (!canonicalBenefitsShells.has(context.path)) return html
      const scripts = [...html.matchAll(builtModuleScript)]
      const entries = scripts.filter(match => benefitsEntryScript.test(match[0]))
      if (entries.length !== 1) throw new Error(`canonical benefits shell must emit one benefits-main entry: ${context.path}`)
      return html.replace(builtModuleScript, script => benefitsEntryScript.test(script) ? script : '')
    },
  },
} satisfies Plugin

export default defineConfig({
  base: '/community/',
  plugins: [react(), canonicalBenefitsEntryOnly],
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        home: page('./index.html'),
        benefitsRoot: page('./benefits-root/index.html'),
        benefitsRootCompany: page('./benefits-root/company/index.html'),
        benefits: page('./benefits/index.html'),
        benefitsDirectory: page('./benefits/directory/index.html'),
        benefitsFit: page('./benefits/fit/index.html'),
        benefitsCompany: page('./benefits/company/index.html'),
        benefitsMethodology: page('./benefits/methodology/index.html'),
        benefitsCorrection: page('./benefits/correction/index.html'),
        benefitsMyCorrections: page('./benefits/my-corrections/index.html'),
        benefitsSubmit: page('./benefits/submit/index.html'),
        benefitsMySubmissions: page('./benefits/my-submissions/index.html'),
        benefitsCompanyRequest: page('./benefits/company-request/index.html'),
        benefitsClaim: page('./benefits/claim/index.html'),
        write: page('./write/index.html'),
        post: page('./post/index.html'),
        edit: page('./edit/index.html'),
        adminReports: page('./admin/reports/index.html'),
        adminBenefitCorrections: page('./admin/benefit-corrections/index.html'),
        adminBenefitSubmissions: page('./admin/benefit-submissions/index.html'),
        authCallback: page('./auth/callback/index.html'),
      },
    },
  },
})
