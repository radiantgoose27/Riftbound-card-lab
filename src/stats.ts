/**
 * Viewer-selectable confidence level. Intervals are computed client-side so
 * the level can change without regenerating data.
 */
export const LEVELS = [0.8, 0.85, 0.9, 0.95] as const
export type Level = (typeof LEVELS)[number]
export const DEFAULT_LEVEL: Level = 0.9

/** Two-sided normal critical values. */
const Z: Record<Level, number> = { 0.8: 1.2816, 0.85: 1.4395, 0.9: 1.6449, 0.95: 1.96 }

const STORAGE_KEY = 'ci-level'

function readStored(): Level {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY))
    return (LEVELS as readonly number[]).includes(v) ? (v as Level) : DEFAULT_LEVEL
  } catch {
    return DEFAULT_LEVEL
  }
}

let level: Level = readStored()

export const getLevel = () => level
export const z = () => Z[level]
export const levelLabel = (l: Level = level) => `${Math.round(l * 100)}%`

export function setLevel(l: Level) {
  level = l
  try {
    localStorage.setItem(STORAGE_KEY, String(l))
  } catch {
    /* storage unavailable: setting lasts for this visit only */
  }
}

/** Wilson score interval for a proportion at the current level. */
export function wilson(p: number, n: number): [number, number] | null {
  if (!n) return null
  const zz = z()
  const denom = 1 + (zz * zz) / n
  const centre = (p + (zz * zz) / (2 * n)) / denom
  const half = (zz * Math.sqrt((p * (1 - p)) / n + (zz * zz) / (4 * n * n))) / denom
  return [centre - half, centre + half]
}

/** Normal interval around a regression estimate at the current level. */
export function normalInterval(est: number, se: number): [number, number] {
  return [est - z() * se, est + z() * se]
}

export type Tone = 'pos' | 'neg' | 'neutral'

/** Colored only when the whole interval sits on one side of the reference. */
export function toneOf(ci: [number, number] | null, ref: number): Tone {
  if (!ci) return 'neutral'
  if (ci[0] > ref) return 'pos'
  if (ci[1] < ref) return 'neg'
  return 'neutral'
}
