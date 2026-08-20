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
  assetClass: 'future' | 'crypto'
  marketType: 'centralized' | 'spot'
  /** Incrément de prix minimal */
  tick: number
  /** Alias explicite pour les nouveaux call-sites. */
  tickSize: number
  /** Décimales affichées */
  dec: number
  /** Alias explicite pour les nouveaux call-sites. */
  pricePrecision: number
  /** Prix de base utilisé pour amorcer la simulation */
  base: number
  /** Taille de lot minimale */
  lot: number
  /** Valeur en $ d'un tick */
  tickVal: number
  /** Contrat temporel natif du provider live avant normalisation interne. */
  liveTimestampUnit: MarketTimestampUnit
  /**
   * true si le backend Databento (server/src/config.js DEFAULT_SYMBOL_TABLE) route ce code
   * vers un symbole live par défaut. false = catalogue affiché pour parité, mais données en
   * simulation tant que le mapping serveur n'existe pas.
   */
  live: boolean
}

export type MarketTimestampUnit = 'milliseconds' | 'nanoseconds'

export type MarketDataSource = 'simulation' | 'databento' | 'crypto-exchange'

export type Side = 'B' | 'S'

/** Niveau de carnet : tuple [prix, taille] */
export type BookLevel = [price: number, size: number]

export interface BookSnapshot {
  bids: BookLevel[]
  asks: BookLevel[]
  /** Unité interne unique pour tout le moteur. */
  timestampMs: number
  /** Alias rétrocompatible ; même valeur que timestampMs. */
  ts: number
  source: MarketDataSource
  rawTimestamp: number | string
}

export interface Trade {
  price: number
  size: number
  side: Side
  /** Unité interne unique pour tout le moteur. */
  timestampMs: number
  /** Alias rétrocompatible ; même valeur que timestampMs. */
  ts: number
  source: MarketDataSource
  rawTimestamp: number | string
  tradeId?: string
  dedupeKey?: string
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
