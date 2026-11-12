import type { CardFile, LegendRow, Matchups, Meta } from './types.ts'

const cache = new Map<string, Promise<unknown>>()

function load<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const p = fetch(`/data/${path}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`)
      return r.json()
    })
    p.catch(() => cache.delete(path))
    cache.set(path, p)
  }
  return cache.get(path) as Promise<T>
}

export const getMeta = () => load<Meta>('meta.json')
export const getLegends = (period: string) => load<LegendRow[]>(`${period}/legends.json`)
export const getMatchups = (period: string) => load<Matchups>(`${period}/matchups.json`)
export const getCards = (period: string, slug: string) =>
  load<CardFile>(`${period}/cards/${slug}.json`)
