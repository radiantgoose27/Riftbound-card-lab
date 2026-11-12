import type { CardFile, LegendRow, Matchups, Meta } from './types.ts'

const cache = new Map<string, Promise<unknown>>()

/**
 * Every data file is fetched with ?v=<meta.generated_at>, so a new pipeline
 * run invalidates browser and CDN caches. meta.json itself is always
 * revalidated so the version stamp is never stale.
 */
let version = ''

function load<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `/data/${path}${version ? `?v=${encodeURIComponent(version)}` : ''}`
  if (!cache.has(url)) {
    const p = fetch(url, init).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`)
      return r.json()
    })
    p.catch(() => cache.delete(url))
    cache.set(url, p)
  }
  return cache.get(url) as Promise<T>
}

export async function getMeta(): Promise<Meta> {
  const meta = await load<Meta>('meta.json', { cache: 'no-cache' })
  version = meta.generated_at
  return meta
}

export const getLegends = (period: string) => load<LegendRow[]>(`${period}/legends.json`)
export const getMatchups = (period: string) => load<Matchups>(`${period}/matchups.json`)
export const getCards = (period: string, slug: string) =>
  load<CardFile>(`${period}/cards/${slug}.json`)
