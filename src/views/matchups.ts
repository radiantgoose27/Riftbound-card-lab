import { getMatchups } from '../data.ts'
import { esc, num, pct, shortLegend } from '../format.ts'
import type { Route } from '../route.ts'

const MIN_CELL = 15
let limit = 16

/**
 * Diverging fill: gray midpoint at 50%, blue when the row legend is favored,
 * red when it is unfavored. Saturates at ±15 points so text stays legible.
 */
function fill(wr: number): string {
  const t = Math.min(Math.abs(wr - 0.5) / 0.15, 1)
  const pole = wr >= 0.5 ? 'var(--pos)' : 'var(--neg)'
  return `color-mix(in oklab, ${pole} ${Math.round(t * 60)}%, var(--mid))`
}

export async function renderMatchups(view: HTMLElement, route: Route) {
  const data = await getMatchups(route.period)

  const draw = () => {
    const legends = data.legends.slice(0, limit)
    if (legends.length < 2) {
      view.innerHTML = `<p class="empty">Not enough matches in this period for a matchup grid.</p>`
      return
    }
    const head = legends
      .map((l) => `<th scope="col" class="mx-col"><span title="${esc(l)}">${esc(shortLegend(l))}</span></th>`)
      .join('')
    const body = legends
      .map((a) => {
        const cells = legends
          .map((b) => {
            if (a === b) return `<td class="mx-cell mx-mirror" aria-label="Mirror match"></td>`
            const c = data.cells[a]?.[b]
            if (!c) return `<td class="mx-cell mx-none" aria-label="No matches"></td>`
            const tip = `<strong>${esc(shortLegend(a))}</strong> vs <strong>${esc(shortLegend(b))}</strong><br>
              ${pct(c.wr)} win rate over ${num(c.n)} matches${c.n < MIN_CELL ? '<br><em>Small sample</em>' : ''}`
            if (c.n < MIN_CELL)
              return `<td class="mx-cell mx-thin" data-tip="${esc(tip)}" tabindex="0"
                aria-label="${esc(`${a} vs ${b}: ${pct(c.wr)} over ${c.n} matches (small sample)`)}">·</td>`
            return `<td class="mx-cell" style="background:${fill(c.wr)}" data-tip="${esc(tip)}" tabindex="0"
              aria-label="${esc(`${a} vs ${b}: ${pct(c.wr)} over ${c.n} matches`)}">${Math.round(c.wr * 100)}</td>`
          })
          .join('')
        return `<tr><th scope="row" class="mx-row" title="${esc(a)}">${esc(shortLegend(a))}</th>${cells}</tr>`
      })
      .join('')

    view.innerHTML = `
      <section class="intro">
        <h2>Matchups</h2>
        <p>Row legend's match win rate against the column legend. Blue cells favor the row legend,
        red cells favor the column. Cells with fewer than ${MIN_CELL} matches show a dot instead of a number.
        Hover a cell for the sample size.</p>
      </section>
      <div class="controls">
        <label>Show the
          <select id="mx-limit">
            ${[10, 16, 24, data.legends.length]
              .filter((n, i, arr) => n <= data.legends.length && arr.indexOf(n) === i)
              .map((n) => `<option value="${n}" ${n === Math.min(limit, data.legends.length) ? 'selected' : ''}>${n === data.legends.length ? `all ${n}` : n}</option>`)
              .join('')}
          </select> most-played legends</label>
        <div class="legend-key" aria-hidden="true">
          <span>Unfavored</span>
          <span class="key-ramp"></span>
          <span>Favored</span>
        </div>
      </div>
      <div class="table-wrap">
        <table class="matrix">
          <thead><tr><th scope="col" class="mx-corner">Row vs column</th>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`

    view.querySelector<HTMLSelectElement>('#mx-limit')!.addEventListener('change', (e) => {
      limit = Number((e.target as HTMLSelectElement).value)
      draw()
    })
  }
  draw()
}
