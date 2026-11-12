import './style.css'
import { installTooltip } from './charts.ts'
import { getMeta } from './data.ts'
import { esc, fmtDate, num } from './format.ts'
import type { Meta } from './types.ts'
import { href, parseRoute, type Route } from './route.ts'
import { getLevel, LEVELS, levelLabel, setLevel, type Level } from './stats.ts'
import { renderAbout } from './views/about.ts'
import { renderCards } from './views/cards.ts'
import { renderLegends } from './views/legends.ts'
import { renderMatchups } from './views/matchups.ts'

const app = document.querySelector<HTMLDivElement>('#app')!

function shell(meta: Meta, route: Route): string {
  const period = meta.periods.find((p) => p.id === route.period)!
  const tab = (view: Route['view'], label: string) => {
    const active = route.view === view || (view === 'legends' && route.view === 'cards')
    return `<a class="tab${active ? ' active' : ''}" href="${href({ ...route, view })}"
      ${active ? 'aria-current="page"' : ''}>${label}</a>`
  }
  const periodOptions = meta.periods
    .map(
      (p) =>
        `<option value="${p.id}" ${p.id === route.period ? 'selected' : ''}>${esc(p.name)}${
          p.id === meta.default_period ? ' (current)' : ''
        }</option>`,
    )
    .join('')
  const range = `${fmtDate(period.start)} – ${period.end ? fmtDate(period.end) : 'today'}`
  return `
    <header class="top">
      <div class="brand">
        <h1><a href="${href({ period: route.period })}">Riftbound Card Lab</a></h1>
        <p class="tagline">Which cards actually win games for each legend</p>
      </div>
      <div class="pickers">
        <label class="period-picker">
          <span>Meta period</span>
          <select id="period-select" ${route.view === 'about' ? 'disabled' : ''}>${periodOptions}</select>
        </label>
        <label class="period-picker">
          <span>Confidence</span>
          <select id="level-select">${LEVELS.map(
            (l) => `<option value="${l}" ${l === getLevel() ? 'selected' : ''}>${levelLabel(l)}</option>`,
          ).join('')}</select>
        </label>
      </div>
    </header>
    <nav class="tabs" aria-label="Views">
      ${tab('legends', 'Legends')}
      ${tab('matchups', 'Matchups')}
      ${tab('about', 'Method')}
    </nav>
    ${
      route.view === 'about'
        ? ''
        : `<p class="period-summary">${esc(period.name)} · ${range} · ${num(period.events)} events ·
           ${num(period.decklists)} decklists · ${num(period.matches)} matches</p>`
    }
    <main id="view" aria-live="polite"></main>
    <footer class="foot">
      <p>Data provided by <a href="https://topdeck.gg" target="_blank" rel="noopener">TopDeck.gg</a>.
      Unofficial fan project, not affiliated with or endorsed by Riot Games.
      Updated ${fmtDate(meta.generated_at.slice(0, 10))}.</p>
    </footer>`
}

let meta: Meta

async function render() {
  const route = parseRoute(meta)
  app.innerHTML = shell(meta, route)
  document.getElementById('period-select')?.addEventListener('change', (e) => {
    const period = (e.target as HTMLSelectElement).value
    location.hash = href({ ...route, period })
  })
  document.getElementById('level-select')?.addEventListener('change', (e) => {
    setLevel(Number((e.target as HTMLSelectElement).value) as Level)
    void render()
  })
  const view = document.getElementById('view')!
  view.innerHTML = '<p class="loading">Loading…</p>'
  try {
    if (route.view === 'about') renderAbout(view, meta)
    else if (route.view === 'cards') await renderCards(view, meta, route)
    else if (route.view === 'matchups') await renderMatchups(view, route)
    else await renderLegends(view, route)
  } catch (err) {
    view.innerHTML = `<p class="error">Couldn't load this view. ${esc(String((err as Error).message ?? err))}</p>`
  }
  const title =
    route.view === 'cards' ? document.querySelector('#view h2')?.textContent : null
  document.title = title ? `${title} · Riftbound Card Lab` : 'Riftbound Card Lab'
}

async function start() {
  installTooltip(document.body)
  try {
    meta = await getMeta()
  } catch {
    app.innerHTML = '<p class="error">No data found. Run the pipeline to generate public/data.</p>'
    return
  }
  window.addEventListener('hashchange', () => {
    void render()
    window.scrollTo({ top: 0 })
  })
  void render()
}

void start()
