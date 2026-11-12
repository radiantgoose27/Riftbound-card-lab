import type { Meta } from './types.ts'

/**
 * Hash routes:
 *   #/<period>                legend overview
 *   #/<period>/legend/<slug>  card effects for one legend
 *   #/<period>/matchups       matchup grid
 *   #/about                   methodology
 */
export interface Route {
  period: string
  view: 'legends' | 'cards' | 'matchups' | 'about'
  legend?: string
}

export function parseRoute(meta: Meta): Route {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'about') return { period: meta.default_period, view: 'about' }
  const period = meta.periods.some((p) => p.id === parts[0]) ? parts[0] : meta.default_period
  if (parts[1] === 'legend' && parts[2]) return { period, view: 'cards', legend: parts[2] }
  if (parts[1] === 'matchups') return { period, view: 'matchups' }
  return { period, view: 'legends' }
}

export function href(r: Partial<Route> & { period: string }): string {
  if (r.view === 'about') return '#/about'
  if (r.view === 'cards' && r.legend) return `#/${r.period}/legend/${r.legend}`
  if (r.view === 'matchups') return `#/${r.period}/matchups`
  return `#/${r.period}`
}
