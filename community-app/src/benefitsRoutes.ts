export function benefitsRoute(path: string): string | null {
  const normalized = path.replace(/\/+$/, '')
  const routes: Record<string, string> = {
    '/community/benefits': 'heatmap',
    '/community/benefits/rankings': 'rankings',
    '/community/benefits/fit': 'fit',
    '/community/benefits/company': 'company',
    '/community/benefits/methodology': 'methodology',
  }
  return routes[normalized] ?? null
}
