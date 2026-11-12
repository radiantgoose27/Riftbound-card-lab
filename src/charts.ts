/**
 * Small HTML chart primitives. Everything is positioned with percentages so it
 * scales with the table column, and every mark carries a data-tip for hover.
 */
import { esc } from './format.ts'

export interface Whisker {
  value: number
  lo: number
  hi: number
  /** 'pos' | 'neg' colors the mark; 'neutral' when the interval spans the reference. */
  tone: 'pos' | 'neg' | 'neutral'
  tip: string
  label?: string
}

/**
 * A dot with a confidence whisker on a fixed domain, with a reference line
 * (0 for effects, 0.5 for win rates). Ends past the domain get a chevron.
 */
export function whiskerCell(w: Whisker, domain: [number, number], ref: number): string {
  const [d0, d1] = domain
  const pos = (x: number) => ((Math.min(Math.max(x, d0), d1) - d0) / (d1 - d0)) * 100
  const lo = pos(w.lo)
  const hi = pos(w.hi)
  const clipL = w.lo < d0
  const clipR = w.hi > d1
  return `
    <div class="whisker" data-tip="${esc(w.tip)}" tabindex="0" aria-label="${esc(w.tip.replace(/<[^>]+>/g, ' '))}">
      <span class="whisker-ref" style="left:${pos(ref)}%"></span>
      <span class="whisker-ci tone-${w.tone}" style="left:${lo}%;width:${Math.max(hi - lo, 0.5)}%"></span>
      ${clipL ? `<span class="whisker-clip clip-l tone-${w.tone}" style="left:${lo}%"></span>` : ''}
      ${clipR ? `<span class="whisker-clip clip-r tone-${w.tone}" style="left:${hi}%"></span>` : ''}
      <span class="whisker-dot tone-${w.tone}" style="left:${pos(w.value)}%"></span>
    </div>
    ${w.label != null ? `<span class="whisker-label">${w.label}</span>` : ''}`
}

/** Thin proportion bar (play rate, deck share) with the value printed beside it. */
export function shareBar(x: number, label: string): string {
  return `<div class="share"><span class="share-track"><span class="share-fill" style="width:${Math.max(
    x * 100,
    1,
  )}%"></span></span><span class="share-label">${label}</span></div>`
}

/** Axis caption row for a whisker column: min / reference / max. */
export function axisCaption(domain: [number, number], fmt: (x: number) => string, ref: number) {
  const refPos = ((ref - domain[0]) / (domain[1] - domain[0])) * 100
  return `<div class="axis-caption" aria-hidden="true">
    <span style="left:0">${fmt(domain[0])}</span>
    <span style="left:${refPos}%;transform:translateX(-50%)">${fmt(ref)}</span>
    <span style="right:0">${fmt(domain[1])}</span>
  </div>`
}

// ---------------------------------------------------------------- tooltip

let tipEl: HTMLDivElement | null = null

export function installTooltip(root: HTMLElement) {
  tipEl = document.createElement('div')
  tipEl.className = 'tooltip'
  tipEl.setAttribute('role', 'tooltip')
  document.body.appendChild(tipEl)

  const show = (target: HTMLElement, x: number, y: number) => {
    if (!tipEl) return
    tipEl.innerHTML = target.dataset.tip ?? ''
    tipEl.style.display = 'block'
    const pad = 12
    const { width, height } = tipEl.getBoundingClientRect()
    let left = x + pad
    let top = y + pad
    if (left + width > window.innerWidth - 8) left = x - width - pad
    if (top + height > window.innerHeight - 8) top = y - height - pad
    tipEl.style.left = `${Math.max(8, left)}px`
    tipEl.style.top = `${Math.max(8, top)}px`
  }
  const hide = () => {
    if (tipEl) tipEl.style.display = 'none'
  }

  root.addEventListener('pointermove', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]')
    if (t) show(t, e.clientX, e.clientY)
    else hide()
  })
  root.addEventListener('pointerleave', hide)
  root.addEventListener('focusin', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]')
    if (!t) return
    const r = t.getBoundingClientRect()
    show(t, r.left + r.width / 2, r.bottom)
  })
  root.addEventListener('focusout', hide)
  window.addEventListener('scroll', hide, { passive: true })
}
