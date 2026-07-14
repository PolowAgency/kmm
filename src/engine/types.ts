/**
 * Types partagés du moteur de marché — port verbatim depuis le terminal web
 * (TERMINAL/app/terminal-v2/engine/types.ts), mêmes noms de champs pour que la maintenance
 * croisée web/mobile reste facile (un changement de contrat backend se répercute pareil).
 */

export interface Instrument {
  code: string
  name: string
  /** Groupe d'affichage dans le sélecteur complet (EQUITY INDEX, ENERGY, ...) */
  grp: string
  exch: string
  /** Incrément de prix minimal */
  tick: number
  /** Décimales affichées */
  dec: number
  /** Prix de base utilisé pour amorcer la simulation */
  base: number
  /** Taille de lot minimale */
  lot: number
  /** Valeur en $ d'un tick */
  tickVal: number
  /**
   * true si le backend Databento (server/src/config.js DEFAULT_SYMBOL_TABLE) route ce code
   * vers un symbole live par défaut. false = catalogue affiché pour parité, mais données en
   * simulation tant que le mapping serveur n'existe pas.
   */
  live: boolean
}

export type Side = 'B' | 'S'

/** Niveau de carnet : tuple [prix, taille] */
export type BookLevel = [price: number, size: number]

export interface BookSnapshot {
  bids: BookLevel[]
  asks: BookLevel[]
  ts: number
}

export interface Trade {
  price: number
  size: number
  side: Side
  ts: number
}

export interface TimeframeConfig {
  id: string
  /** Nombre de colonnes de base (60ms) fusionnées par colonne affichée */
  n: number
  /** Durée d'une barre de footprint, en secondes */
  fp: number
  /** Fenêtre glissante du CVD secondaire, en secondes */
  roll: number
}

export interface NewsItem {
  cat: string
  title: string
  imp: 'low' | 'med' | 'high'
  phase: 'upcoming' | 'release'
  time: string
  expected?: string
  actual?: string
  deviation?: number
}

export interface ServiceStatus {
  mode: 'SIM' | 'CONNECTING' | 'LIVE' | 'RECONNECTING' | 'REPLAY'
  rate: number
  latencyMs: number
  bufferSec: number
  replaying: boolean
  progress: number
}
