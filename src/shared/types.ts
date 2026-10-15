export type Book = {
  id: string
  path: string
  title: string | null
  author: string | null
  numPages: number | null
  lastPage: number
  addedAt: number
  lastOpenedAt: number | null
  missing: boolean
  thumbnailUrl: string | null
}

export type LayoutMode = 'auto' | 'spread' | 'single'
export type PageTurnStyle = 'curl' | 'slide' | 'instant'
export type PaperTint = 'white' | 'cream' | 'sepia' | 'dark'
export type Theme = 'system' | 'light' | 'dark'

export type Settings = {
  theme: Theme
  paperTint: PaperTint
  pageTurnStyle: PageTurnStyle
  layout: LayoutMode
  turnSound: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  paperTint: 'cream',
  pageTurnStyle: 'curl',
  layout: 'auto',
  turnSound: false
}
