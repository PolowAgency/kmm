import type { Instrument, MarketTimestampUnit, TimeframeConfig } from './types'

type InstrumentSeed = Omit<Instrument, 'assetClass' | 'marketType' | 'tickSize' | 'pricePrecision' | 'liveTimestampUnit'>

function inferAssetClass(code: string, grp: string): Instrument['assetClass'] {
  return grp === 'CRYPTO' || code === 'BTC' || code === 'ETH' || code === 'MBT' ? 'crypto' : 'future'
}

function instrument(seed: InstrumentSeed): Instrument {
  const assetClass = inferAssetClass(seed.code, seed.grp)
  const liveTimestampUnit: MarketTimestampUnit = assetClass === 'crypto' ? 'milliseconds' : 'nanoseconds'
  return {
    ...seed,
    assetClass,
    marketType: assetClass === 'crypto' ? 'spot' : 'centralized',
    tickSize: seed.tick,
    pricePrecision: seed.dec,
    liveTimestampUnit,
  }
}

/**
 * Roster d'instruments — port verbatim depuis le terminal web
 * (TERMINAL/app/terminal-v2/engine/instruments.ts), aligné sur server/src/config.js
 * (DEFAULT_SYMBOL_TABLE) côté backend Databento partagé entre web et mobile.
 *
 * "GC" pointe côté backend vers le contrat Micro Gold (MGC.c.0), pas le Gold standard
 * (GC.c.0). Le sous-jacent reste le prix de l'once d'or ; seule la valeur du tick diffère.
 */
export const INSTRUMENTS: Record<string, Instrument> = {
  ES: instrument({ code: 'ES', name: 'E-mini S&P 500', grp: 'EQUITY INDEX', exch: 'CME', tick: 0.25, dec: 2, base: 5825, lot: 1, tickVal: 12.5, live: true }),
  NQ: instrument({ code: 'NQ', name: 'E-mini Nasdaq 100', grp: 'EQUITY INDEX', exch: 'CME', tick: 0.25, dec: 2, base: 20650, lot: 1, tickVal: 5, live: true }),
  YM: instrument({ code: 'YM', name: 'E-mini Dow', grp: 'EQUITY INDEX', exch: 'CBOT', tick: 1, dec: 0, base: 43200, lot: 1, tickVal: 5, live: true }),
  RTY: instrument({ code: 'RTY', name: 'E-mini Russell 2000', grp: 'EQUITY INDEX', exch: 'CME', tick: 0.1, dec: 1, base: 2210, lot: 1, tickVal: 5, live: true }),
  CL: instrument({ code: 'CL', name: 'Crude Oil', grp: 'ENERGY', exch: 'NYMEX', tick: 0.01, dec: 2, base: 71.5, lot: 1, tickVal: 10, live: true }),
  GC: instrument({ code: 'GC', name: 'Micro Gold (MGC)', grp: 'METALS', exch: 'COMEX', tick: 0.1, dec: 1, base: 2650, lot: 0.3, tickVal: 1, live: true }),
  '6E': instrument({ code: '6E', name: 'Euro FX', grp: 'FX', exch: 'CME', tick: 0.00005, dec: 5, base: 1.085, lot: 1, tickVal: 6.25, live: true }),
  ZN: instrument({ code: 'ZN', name: '10-Year T-Note', grp: 'RATES', exch: 'CBOT', tick: 0.015625, dec: 4, base: 110.5, lot: 1, tickVal: 15.625, live: true }),

  // ---- Catalogue étendu (mapping backend ajouté — entitlement Databento non vérifié) ----
  NKD: instrument({ code: 'NKD', name: 'Nikkei 225 (USD)', grp: 'EQUITY INDEX', exch: 'CME', tick: 5, dec: 0, base: 39000, lot: 0.3, tickVal: 25, live: true }),
  MES: instrument({ code: 'MES', name: 'Micro E-mini S&P', grp: 'EQUITY INDEX', exch: 'CME', tick: 0.25, dec: 2, base: 5825, lot: 0.8, tickVal: 1.25, live: true }),
  MNQ: instrument({ code: 'MNQ', name: 'Micro E-mini Nasdaq', grp: 'EQUITY INDEX', exch: 'CME', tick: 0.25, dec: 2, base: 20650, lot: 0.5, tickVal: 0.5, live: true }),
  MYM: instrument({ code: 'MYM', name: 'Micro E-mini Dow', grp: 'EQUITY INDEX', exch: 'CBOT', tick: 1, dec: 0, base: 43200, lot: 0.4, tickVal: 0.5, live: true }),
  M2K: instrument({ code: 'M2K', name: 'Micro Russell 2000', grp: 'EQUITY INDEX', exch: 'CME', tick: 0.1, dec: 2, base: 2210, lot: 0.4, tickVal: 0.5, live: true }),

  MCL: instrument({ code: 'MCL', name: 'Micro Crude Oil', grp: 'ENERGY', exch: 'NYMEX', tick: 0.01, dec: 2, base: 71.5, lot: 0.4, tickVal: 1, live: true }),
  NG: instrument({ code: 'NG', name: 'Natural Gas', grp: 'ENERGY', exch: 'NYMEX', tick: 0.001, dec: 3, base: 2.85, lot: 0.5, tickVal: 10, live: true }),
  RB: instrument({ code: 'RB', name: 'RBOB Gasoline', grp: 'ENERGY', exch: 'NYMEX', tick: 0.0001, dec: 4, base: 2.45, lot: 0.3, tickVal: 4.2, live: true }),
  HO: instrument({ code: 'HO', name: 'NY Harbor ULSD', grp: 'ENERGY', exch: 'NYMEX', tick: 0.0001, dec: 4, base: 2.55, lot: 0.3, tickVal: 4.2, live: true }),

  MGC: instrument({ code: 'MGC', name: 'Micro Gold', grp: 'METALS', exch: 'COMEX', tick: 0.1, dec: 1, base: 2650, lot: 0.3, tickVal: 1, live: true }),
  SI: instrument({ code: 'SI', name: 'Silver', grp: 'METALS', exch: 'COMEX', tick: 0.005, dec: 3, base: 29.5, lot: 0.4, tickVal: 25, live: true }),
  HG: instrument({ code: 'HG', name: 'Copper', grp: 'METALS', exch: 'COMEX', tick: 0.0005, dec: 4, base: 4.25, lot: 0.3, tickVal: 12.5, live: true }),
  PL: instrument({ code: 'PL', name: 'Platinum', grp: 'METALS', exch: 'NYMEX', tick: 0.1, dec: 1, base: 980, lot: 0.25, tickVal: 5, live: true }),

  '6J': instrument({ code: '6J', name: 'Japanese Yen', grp: 'FX', exch: 'CME', tick: 0.0000005, dec: 7, base: 0.00665, lot: 0.5, tickVal: 6.25, live: true }),
  '6B': instrument({ code: '6B', name: 'British Pound', grp: 'FX', exch: 'CME', tick: 0.0001, dec: 4, base: 1.27, lot: 0.5, tickVal: 6.25, live: true }),
  '6A': instrument({ code: '6A', name: 'Australian Dollar', grp: 'FX', exch: 'CME', tick: 0.00005, dec: 5, base: 0.665, lot: 0.4, tickVal: 5, live: true }),
  '6C': instrument({ code: '6C', name: 'Canadian Dollar', grp: 'FX', exch: 'CME', tick: 0.00005, dec: 5, base: 0.73, lot: 0.4, tickVal: 5, live: true }),
  '6S': instrument({ code: '6S', name: 'Swiss Franc', grp: 'FX', exch: 'CME', tick: 0.0001, dec: 4, base: 1.11, lot: 0.35, tickVal: 12.5, live: true }),
  '6N': instrument({ code: '6N', name: 'New Zealand Dollar', grp: 'FX', exch: 'CME', tick: 0.00005, dec: 5, base: 0.605, lot: 0.3, tickVal: 5, live: true }),

  ZT: instrument({ code: 'ZT', name: '2-Year T-Note', grp: 'RATES', exch: 'CBOT', tick: 0.0078125, dec: 4, base: 102.125, lot: 0.8, tickVal: 15.625, live: true }),
  ZF: instrument({ code: 'ZF', name: '5-Year T-Note', grp: 'RATES', exch: 'CBOT', tick: 0.0078125, dec: 4, base: 106.5, lot: 0.8, tickVal: 7.8125, live: true }),
  TN: instrument({ code: 'TN', name: 'Ultra 10-Year Note', grp: 'RATES', exch: 'CBOT', tick: 0.015625, dec: 4, base: 112.5, lot: 0.5, tickVal: 15.625, live: true }),
  ZB: instrument({ code: 'ZB', name: '30-Year T-Bond', grp: 'RATES', exch: 'CBOT', tick: 0.03125, dec: 4, base: 118, lot: 0.6, tickVal: 31.25, live: true }),
  UB: instrument({ code: 'UB', name: 'Ultra T-Bond', grp: 'RATES', exch: 'CBOT', tick: 0.03125, dec: 4, base: 124, lot: 0.5, tickVal: 31.25, live: true }),
  SR3: instrument({ code: 'SR3', name: '3-Month SOFR', grp: 'RATES', exch: 'CME', tick: 0.0025, dec: 4, base: 95.6, lot: 0.9, tickVal: 6.25, live: true }),

  ZC: instrument({ code: 'ZC', name: 'Corn', grp: 'AGRICULTURE', exch: 'CBOT', tick: 0.25, dec: 2, base: 450, lot: 0.6, tickVal: 12.5, live: true }),
  ZS: instrument({ code: 'ZS', name: 'Soybeans', grp: 'AGRICULTURE', exch: 'CBOT', tick: 0.25, dec: 2, base: 1050, lot: 0.5, tickVal: 12.5, live: true }),
  ZW: instrument({ code: 'ZW', name: 'Chicago Wheat', grp: 'AGRICULTURE', exch: 'CBOT', tick: 0.25, dec: 2, base: 580, lot: 0.4, tickVal: 12.5, live: true }),
  ZL: instrument({ code: 'ZL', name: 'Soybean Oil', grp: 'AGRICULTURE', exch: 'CBOT', tick: 0.01, dec: 2, base: 45, lot: 0.3, tickVal: 6, live: true }),
  ZM: instrument({ code: 'ZM', name: 'Soybean Meal', grp: 'AGRICULTURE', exch: 'CBOT', tick: 0.1, dec: 1, base: 340, lot: 0.3, tickVal: 10, live: true }),
  LE: instrument({ code: 'LE', name: 'Live Cattle', grp: 'AGRICULTURE', exch: 'CME', tick: 0.025, dec: 3, base: 185, lot: 0.3, tickVal: 10, live: true }),
  HE: instrument({ code: 'HE', name: 'Lean Hogs', grp: 'AGRICULTURE', exch: 'CME', tick: 0.025, dec: 3, base: 95, lot: 0.3, tickVal: 10, live: true }),

  BTC: instrument({ code: 'BTC', name: 'Bitcoin', grp: 'CRYPTO', exch: 'CRYPTO', tick: 0.1, dec: 1, base: 65000, lot: 0.001, tickVal: 0.1, live: true }),
  MBT: instrument({ code: 'MBT', name: 'Micro Bitcoin', grp: 'CRYPTO', exch: 'CRYPTO', tick: 0.1, dec: 1, base: 65000, lot: 0.001, tickVal: 0.1, live: true }),
  ETH: instrument({ code: 'ETH', name: 'Ether', grp: 'CRYPTO', exch: 'CRYPTO', tick: 0.01, dec: 2, base: 3400, lot: 0.01, tickVal: 0.01, live: true }),
}

/** Ordre d'affichage du sélecteur rapide — les 8 historiquement confirmés en direct. */
export const INSTRUMENT_QUICKLIST = ['ES', 'NQ', 'YM', 'RTY', 'CL', 'GC', '6E', 'ZN']

/**
 * Presets multi-timeframe. `n` = nb de colonnes de base (60ms) fusionnées, `fp` = durée d'une
 * barre footprint (s), `roll` = fenêtre glissante du CVD secondaire (s).
 */
export const TIMEFRAMES: TimeframeConfig[] = [
  { id: 'T', n: 1, fp: 5, roll: 60 },
  { id: '1S', n: 17, fp: 15, roll: 120 },
  { id: '5S', n: 83, fp: 30, roll: 300 },
  { id: '15S', n: 250, fp: 60, roll: 600 },
  { id: '1M', n: 1000, fp: 300, roll: 1800 },
  { id: '5M', n: 5000, fp: 900, roll: 3600 },
]

export function tfConfig(id: string): TimeframeConfig {
  return TIMEFRAMES.find((t) => t.id === id) ?? TIMEFRAMES[0]
}
