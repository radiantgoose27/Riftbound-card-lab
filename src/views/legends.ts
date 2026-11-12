import { axisCaption, shareBar, whiskerCell } from '../charts.ts'
import { getLegends } from '../data.ts'
import { esc, num, pct } from '../format.ts'
import { href, type Route } from '../route.ts'
import { levelLabel, toneOf, wilson } from '../stats.ts'
import type { LegendRow } from '../types.ts'

type SortKey = 'win_rate' | 'matches' | 'deck_share' | 'legend'
let sortKey: SortKey = 'matches'
let showAll = false

const MIN_MATCHES = 30

export async function renderLegends(view: HTMLElement, route: Route) {
  const rows = await getLegends(route.period)

  const draw = () => {
    const visible = rows
      .filter((r) => showAll || r.matches >= MIN_MATCHES)
      .sort((a, b) =>
        sortKey === 'legend' ? a.legend.localeCompare(b.legend) : (b[sortKey] as number) - (a[sortKey] as number),
      )
    const hidden = rows.length - rows.filter((r) => r.matches >= MIN_MATCHES).length
    const domain: [number, number] = [0.3, 0.7]
    const maxShare = Math.max(...rows.map((r) => r.deck_share), 0.01)

    const sortBtn = (key: SortKey, label: string) =>
      `<th scope="col" aria-sort="${sortKey === key ? 'descending' : 'none'}">
        <button class="sort${sortKey === key ? ' active' : ''}" data-sort="${key}">${label}</button></th>`

    view.innerHTML = `
      <section class="intro">
        <h2>Legend overview</h2>
        <p>Match win rate for each legend, mirror matches excluded. Bars show a ${levelLabel()} confidence
        interval. Pick a legend to see which cards help or hurt it.</p>
      </section>
      <div class="controls">
        <label class="check"><input type="checkbox" id="show-all" ${showAll ? 'checked' : ''}>
          Show legends with fewer than ${MIN_MATCHES} matches${hidden ? ` (${hidden})` : ''}</label>
      </div>
      <div class="table-wrap">
        <table class="data legends">
          <thead><tr>
            ${sortBtn('legend', 'Legend')}
            ${sortBtn('win_rate', 'Win rate')}
            <th scope="col" class="col-chart">${axisCaption(domain, (x) => pct(x, 0), 0.5)}</th>
            ${sortBtn('matches', 'Matches')}
            ${sortBtn('deck_share', 'Share of decklists')}
            <th scope="col"><span class="sr-only">Card analysis</span></th>
          </tr></thead>
          <tbody>${visible.map((r) => row(r, domain, maxShare, route)).join('')}</tbody>
        </table>
      </div>`

    view.querySelectorAll<HTMLButtonElement>('button[data-sort]').forEach((b) =>
      b.addEventListener('click', () => {
        sortKey = b.dataset.sort as SortKey
        draw()
      }),
    )
    view.querySelector<HTMLInputElement>('#show-all')!.addEventListener('change', (e) => {
      showAll = (e.target as HTMLInputElement).checked
      draw()
    })
  }
  draw()
}

function row(r: LegendRow, domain: [number, number], maxShare: number, route: Route): string {
  const ci = wilson(r.win_rate, r.matches) ?? [r.win_rate, r.win_rate]
  const tone = toneOf(ci, 0.5)
  const tip = `<strong>${esc(r.legend)}</strong><br>Win rate ${pct(r.win_rate)}
    (${levelLabel()} CI ${pct(ci[0])}–${pct(ci[1])})<br>${num(r.matches)} matches · ${num(r.decklists)} decklists`
  const link = href({ period: route.period, view: 'cards', legend: r.slug })
  return `<tr>
    <th scope="row">${r.card_analysis ? `<a href="${link}">${esc(r.legend)}</a>` : esc(r.legend)}</th>
    <td class="num">${pct(r.win_rate)}</td>
    <td class="col-chart">${whiskerCell({ value: r.win_rate, lo: ci[0], hi: ci[1], tone, tip }, domain, 0.5)}</td>
    <td class="num">${num(r.matches)}</td>
    <td>${shareBar(r.deck_share / maxShare, `${pct(r.deck_share)} <span class="muted">(${num(r.decklists)})</span>`)}</td>
    <td class="action">${
      r.card_analysis
        ? `<a class="pill" href="${link}">Cards →</a>`
        : `<span class="muted small" title="Needs at least 25 decklists">Too few lists</span>`
    }</td>
  </tr>`
}
