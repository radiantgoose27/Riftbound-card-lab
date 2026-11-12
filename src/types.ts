export interface Period {
  id: string
  name: string
  start: string
  end: string | null
  events: number
  decklists: number
  matches: number
  legends_with_cards: number
}

export interface Meta {
  generated_at: string
  default_period: string
  periods: Period[]
  thresholds: {
    min_legend_decks: number
    min_card_decks: number
    min_side_decks: number
    min_side_matches: number
  }
}

export interface LegendRow {
  legend: string
  slug: string
  matches: number
  win_rate: number
  ci: [number, number]
  decklists: number
  deck_share: number
  appearances: number
  card_analysis: boolean
}

export interface Matchups {
  legends: string[]
  cells: Record<string, Record<string, { n: number; wr: number }>>
}

export interface CopiesStat {
  decks: number
  matches: number
  wr: number
}

export interface CardRow {
  card: string
  section: 'Mainboard' | 'Champion' | 'Battlefields'
  decks_with: number
  decks_without: number
  play_rate: number
  avg_copies: number
  matches_with: number
  matches_without: number
  wr_with: number | null
  wr_without: number | null
  ci_with: [number | null, number | null]
  ci_without: [number | null, number | null]
  raw_delta: number | null
  by_copies: Record<string, CopiesStat>
  adj_delta: number | null
  adj_ci: [number, number] | null
  p: number | null
  q: number | null
  fit: boolean
}

export interface CardFile {
  legend: string
  decklists: number
  cards: CardRow[]
}
