import { axisCaption, shareBar, whiskerCell } from '../charts.ts'
import { getCards, getLegends } from '../data.ts'
import { esc, EVIDENCE_LABEL, evidence, num, pct, pts } from '../format.ts'
import { href, type Route } from '../route.ts'
import { getLevel, levelLabel, normalInterval, toneOf, wilson } from '../stats.ts'
import type { CardRow, Meta } from '../types.ts'

/** Adjusted-effect interval at the viewer's confidence level. */
const ciOf = (c: CardRow): [number, number] | null =>
  c.fit && c.adj_delta != null && c.adj_se != null ? normalInterval(c.adj_delta, c.adj_se) : null
const flagged = (c: CardRow) => toneOf(ciOf(c), 0) !== 'neutral'
const estimated = (c: CardRow) => ciOf(c) !== null

type SortKey = 'adj_delta' | 'raw_delta' | 'play_rate' | 'card'
const state = {
  sortKey: 'adj_delta' as SortKey,
  query: '',
  section: 'all',
  showLowSample: false,
  onlyFlagged: false,
  expanded: new Set<string>(),
}

const key = (c: CardRow) => `${c.section}|${c.card}`

export async function renderCards(view: HTMLElement, meta: Meta, route: Route) {
  const legends = await getLegends(route.period)
  const legend = legends.find((l) => l.slug === route.legend)
  const picker = legendPicker(legends.filter((l) => l.card_analysis), route)

  if (!legend || !legend.card_analysis) {
    view.innerHTML = `${picker}<p class="empty">${
      legend
        ? `${esc(legend.legend)} has only ${legend.decklists} decklists in this period, fewer than the
           ${meta.thresholds.min_legend_decks} needed for card analysis. Try “All time”.`
        : 'This legend has no data in the selected period.'
    }</p>`
    wirePicker(view, route)
    return
  }

  const file = await getCards(route.period, legend.slug)

  const draw = () => {
    const q = state.query.trim().toLowerCase()
    const rows = file.cards
      .filter((c) => state.showLowSample || estimated(c))
      .filter((c) => !state.onlyFlagged || flagged(c))
      .filter((c) => state.section === 'all' || c.section === state.section)
      .filter((c) => !q || c.card.toLowerCase().includes(q))
      .sort(compare)
    const fitted = file.cards.filter(estimated)
    const lowSample = file.cards.length - fitted.length

    // Shared scale for the effect column: wide enough for most intervals,
    // capped so one huge interval doesn't flatten everything else.
    const extent = Math.max(
      0.1,
      ...fitted.map((c) => {
        const ci = ciOf(c)!
        return Math.max(Math.abs(ci[0]), Math.abs(ci[1]))
      }),
    )
    const d = Math.min(0.3, Math.ceil(extent * 20) / 20)
    const domain: [number, number] = [-d, d]

    const sortBtn = (k: SortKey, label: string, cls = '') =>
      `<th scope="col" class="${cls}" aria-sort="${state.sortKey === k ? (k === 'card' ? 'ascending' : 'descending') : 'none'}">
        <button class="sort${state.sortKey === k ? ' active' : ''}" data-sort="${k}">${label}</button></th>`

    view.innerHTML = `
      ${picker}
      <section class="intro">
        <h2>${esc(legend.legend)}</h2>
        <p>${num(file.decklists)} decklists · win rate ${pct(legend.win_rate)} over ${num(legend.matches)} matches.
        <strong>Effect</strong> is the change in match win rate when a deck includes the card, after
        adjusting for opponent legend, player skill and top-cut rounds. Blue means the card is linked to
        winning more, red to winning less, and gray means the ${levelLabel()} interval includes zero.
        Colored cards are the ones worth a closer look or more testing.</p>
      </section>
      ${highlights(fitted)}
      <div class="controls">
        <label class="search"><span class="sr-only">Search cards</span>
          <input type="search" id="card-search" placeholder="Search cards" value="${esc(state.query)}"></label>
        <label><span class="sr-only">Section</span>
          <select id="section-filter">
            ${['all', 'Mainboard', 'Champion', 'Battlefields']
              .map((s) => `<option value="${s}" ${state.section === s ? 'selected' : ''}>${s === 'all' ? 'All sections' : s}</option>`)
              .join('')}
          </select></label>
        <label class="check"><input type="checkbox" id="only-flagged" ${state.onlyFlagged ? 'checked' : ''}>
          Only cards whose ${levelLabel()} interval excludes zero</label>
        <label class="check"><input type="checkbox" id="low-sample" ${state.showLowSample ? 'checked' : ''}>
          Include ${lowSample} cards with too few games to estimate</label>
      </div>
      <div class="table-wrap">
        <table class="data cards">
          <thead><tr>
            ${sortBtn('card', 'Card')}
            ${sortBtn('play_rate', 'Played in')}
            <th scope="col" class="num hide-sm">Win rate with</th>
            <th scope="col" class="num hide-sm">Without</th>
            ${sortBtn('raw_delta', 'Raw diff', 'num hide-sm')}
            ${sortBtn('adj_delta', 'Effect', 'num')}
            <th scope="col" class="col-chart">${axisCaption(domain, (x) => (x === 0 ? '0' : pts(x, 0).replace(' pts', '')), 0)}</th>
            <th scope="col" class="hide-sm">Evidence</th>
          </tr></thead>
          <tbody>${rows.length ? rows.map((c) => cardRow(c, domain)).join('') : `<tr><td colspan="8" class="empty">No cards match.</td></tr>`}</tbody>
        </table>
      </div>
      <p class="note">Effects are associations, not proof the card causes the change: a card can mark a
      stronger build or a stronger pilot in ways the adjustment doesn't capture. See <a href="${href({ period: route.period, view: 'about' })}">Method</a>.</p>`

    wirePicker(view, route)
    view.querySelectorAll<HTMLButtonElement>('button[data-sort]').forEach((b) =>
      b.addEventListener('click', () => {
        state.sortKey = b.dataset.sort as SortKey
        draw()
      }),
    )
    const search = view.querySelector<HTMLInputElement>('#card-search')!
    search.addEventListener('input', () => {
      state.query = search.value
      const pos = search.selectionStart
      draw()
      const s = view.querySelector<HTMLInputElement>('#card-search')!
      s.focus()
      s.setSelectionRange(pos, pos)
    })
    view.querySelector<HTMLSelectElement>('#section-filter')!.addEventListener('change', (e) => {
      state.section = (e.target as HTMLSelectElement).value
      draw()
    })
    view.querySelector<HTMLInputElement>('#only-flagged')!.addEventListener('change', (e) => {
      state.onlyFlagged = (e.target as HTMLInputElement).checked
      draw()
    })
    view.querySelector<HTMLInputElement>('#low-sample')!.addEventListener('change', (e) => {
      state.showLowSample = (e.target as HTMLInputElement).checked
      draw()
    })
    view.querySelectorAll<HTMLButtonElement>('button[data-expand]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.expand!
        if (state.expanded.has(k)) state.expanded.delete(k)
        else state.expanded.add(k)
        draw()
      }),
    )
  }
  draw()
}

function compare(a: CardRow, b: CardRow): number {
  const k = state.sortKey
  if (k === 'card') return a.card.localeCompare(b.card)
  const av = a[k] ?? -Infinity
  const bv = b[k] ?? -Infinity
  return (bv as number) - (av as number)
}

function legendPicker(legends: { legend: string; slug: string }[], route: Route): string {
  const opts = [...legends]
    .sort((a, b) => a.legend.localeCompare(b.legend))
    .map((l) => `<option value="${l.slug}" ${l.slug === route.legend ? 'selected' : ''}>${esc(l.legend)}</option>`)
    .join('')
  return `<div class="legend-bar">
    <a class="back" href="${href({ period: route.period })}">← All legends</a>
    <label><span class="sr-only">Legend</span><select id="legend-select">${opts}</select></label>
  </div>`
}

function wirePicker(view: HTMLElement, route: Route) {
  view.querySelector<HTMLSelectElement>('#legend-select')?.addEventListener('change', (e) => {
    location.hash = href({ period: route.period, view: 'cards', legend: (e.target as HTMLSelectElement).value })
  })
}

function highlights(fitted: CardRow[]): string {
  const credible = fitted.filter(flagged)
  const best = credible.filter((c) => c.adj_delta! > 0).sort((a, b) => b.adj_delta! - a.adj_delta!)[0]
  const worst = credible.filter((c) => c.adj_delta! < 0).sort((a, b) => a.adj_delta! - b.adj_delta!)[0]
  const tile = (label: string, c: CardRow | undefined) =>
    c
      ? `<div class="tile"><span class="tile-label">${label}</span>
          <span class="tile-value">${esc(c.card)}</span>
          <span class="tile-delta">${pts(c.adj_delta)} · ${levelLabel()} interval ${pts(ciOf(c)![0])} to ${pts(ciOf(c)![1])}</span></div>`
      : `<div class="tile"><span class="tile-label">${label}</span>
          <span class="tile-value muted">None stands out</span>
          <span class="tile-delta">no ${levelLabel()} interval clears zero</span></div>`
  return `<div class="tiles">
    ${tile('Biggest boost', best)}
    ${tile('Biggest drag', worst)}
    <div class="tile"><span class="tile-label">Cards with enough games</span>
      <span class="tile-value">${fitted.length}</span>
      <span class="tile-delta">${credible.length} flagged at ${levelLabel()} · about
        ${Math.round(fitted.length * (1 - getLevel()))} would be flagged by chance alone</span></div>
  </div>`
}

function cardRow(c: CardRow, domain: [number, number]): string {
  const ev = evidence(c.q, c.fit)
  const k = key(c)
  const open = state.expanded.has(k)
  const ci = ciOf(c)
  const tone = toneOf(ci, 0)
  const tip = ci
    ? `<strong>${esc(c.card)}</strong><br>Adjusted effect ${pts(c.adj_delta)}<br>${levelLabel()} CI ${pts(ci![0])} to ${pts(ci![1])}<br>q = ${c.q?.toFixed(3)} · ${EVIDENCE_LABEL[ev]}`
    : ''
  const chart = ci
    ? whiskerCell({ value: c.adj_delta!, lo: ci![0], hi: ci![1], tone, tip }, domain, 0)
    : `<span class="muted small">Not estimated</span>`

  const main = `<tr class="${open ? 'open' : ''}">
    <th scope="row">
      <button class="expand" data-expand="${esc(k)}" aria-expanded="${open}" aria-label="Details for ${esc(c.card)}">
        <span class="caret" aria-hidden="true">${open ? '▾' : '▸'}</span>${esc(c.card)}</button>
      ${c.section !== 'Mainboard' ? `<span class="tag">${c.section === 'Battlefields' ? 'Battlefield' : 'Champion'}</span>` : ''}
    </th>
    <td>${shareBar(c.play_rate, `${pct(c.play_rate, 0)} <span class="muted">(${num(c.decks_with)})</span>`)}</td>
    <td class="num hide-sm">${pct(c.wr_with)}</td>
    <td class="num hide-sm">${pct(c.wr_without)}</td>
    <td class="num hide-sm">${pts(c.raw_delta)}</td>
    <td class="num strong">${ci ? pts(c.adj_delta) : '–'}</td>
    <td class="col-chart">${chart}</td>
    <td class="hide-sm"><span class="evidence ev-${ev}">${EVIDENCE_LABEL[ev]}</span></td>
  </tr>`
  if (!open) return main

  const copies = Object.entries(c.by_copies)
    .map(
      ([n, s]) =>
        `<tr><td>${n} ${n === '1' ? 'copy' : 'copies'}</td><td class="num">${num(s.decks)}</td>
         <td class="num">${num(s.matches)}</td><td class="num">${pct(s.wr)}</td></tr>`,
    )
    .join('')
  const ciW = wilson(c.wr_with ?? 0, c.matches_with)
  const ciWo = wilson(c.wr_without ?? 0, c.matches_without)
  const range = (r: [number, number] | null) => (r ? `${pct(r[0])}–${pct(r[1])}` : '–')
  return `${main}<tr class="detail"><td colspan="8">
    <div class="detail-grid">
      <dl>
        <div><dt>Decks with / without</dt><dd>${num(c.decks_with)} / ${num(c.decks_without)}</dd></div>
        <div><dt>Matches with / without</dt><dd>${num(c.matches_with)} / ${num(c.matches_without)}</dd></div>
        <div><dt>Win rate with</dt><dd>${pct(c.wr_with)} <span class="muted">(${range(ciW)})</span></dd></div>
        <div><dt>Win rate without</dt><dd>${pct(c.wr_without)} <span class="muted">(${range(ciWo)})</span></dd></div>
        <div><dt>Adjusted effect</dt><dd>${ci ? `${pts(c.adj_delta)} <span class="muted">(${levelLabel()} CI ${pts(ci![0])} to ${pts(ci![1])})</span>` : 'Not enough games on both sides'}</dd></div>
        <div><dt>p / q value</dt><dd>${c.p != null ? `${c.p.toFixed(3)} / ${c.q!.toFixed(3)}` : '–'}</dd></div>
      </dl>
      <table class="mini">
        <caption>Win rate by copies played</caption>
        <thead><tr><th scope="col">Copies</th><th scope="col" class="num">Decks</th><th scope="col" class="num">Matches</th><th scope="col" class="num">Win rate</th></tr></thead>
        <tbody>${copies}<tr class="muted"><td>0 (not played)</td><td class="num">${num(c.decks_without)}</td><td class="num">${num(c.matches_without)}</td><td class="num">${pct(c.wr_without)}</td></tr></tbody>
      </table>
    </div>
  </td></tr>`
}
