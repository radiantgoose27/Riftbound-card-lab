const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])

export const pct = (x: number | null | undefined, digits = 1) =>
  x == null ? '–' : `${(x * 100).toFixed(digits)}%`

/** Signed percentage-point change, e.g. "+3.2 pts". Uses a true minus sign. */
export const pts = (x: number | null | undefined, digits = 1) => {
  if (x == null) return '–'
  const v = x * 100
  const s = Math.abs(v).toFixed(digits)
  if (s === (0).toFixed(digits)) return `0.0 pts`
  return `${v > 0 ? '+' : '−'}${s} pts`
}

export const num = (n: number) => n.toLocaleString('en-US')

export const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })

/** Legend names are "Champion, Title"; the champion part is the short name. */
export const shortLegend = (name: string) => name.split(',')[0]

export type Evidence = 'strong' | 'suggestive' | 'inconclusive' | 'low-sample'

export function evidence(q: number | null, fit: boolean): Evidence {
  if (!fit || q == null) return 'low-sample'
  if (q < 0.05) return 'strong'
  if (q < 0.2) return 'suggestive'
  return 'inconclusive'
}

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  strong: 'Strong evidence',
  suggestive: 'Suggestive',
  inconclusive: 'Inconclusive',
  'low-sample': 'Too few games',
}
