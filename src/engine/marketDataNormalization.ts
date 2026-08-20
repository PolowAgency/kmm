import type { Instrument, MarketDataSource, MarketTimestampUnit } from './types'

const MIN_REASONABLE_MS = Date.UTC(2020, 0, 1)
const MAX_REASONABLE_MS = Date.UTC(2100, 0, 1)

export interface NormalizedTimestamp {
  rawTimestamp: number | string
  timestampMs: number
  unitUsed: MarketTimestampUnit
}

function convertToMs(rawTimestamp: number | string, unit: MarketTimestampUnit): number {
  if (typeof rawTimestamp === 'string' && rawTimestamp.trim() === '') return NaN
  const numeric = typeof rawTimestamp === 'number' ? rawTimestamp : Number(rawTimestamp)
  if (!Number.isFinite(numeric)) return NaN
  return unit === 'nanoseconds' ? Math.trunc(numeric / 1_000_000) : Math.trunc(numeric)
}

function isReasonableTimestampMs(timestampMs: number): boolean {
  return Number.isFinite(timestampMs) && timestampMs >= MIN_REASONABLE_MS && timestampMs <= MAX_REASONABLE_MS
}

export function normalizeMarketTimestamp(
  rawTimestamp: number | string,
  preferredUnit: MarketTimestampUnit,
): NormalizedTimestamp | null {
  const timestampMs = convertToMs(rawTimestamp, preferredUnit)
  if (isReasonableTimestampMs(timestampMs)) {
    return { rawTimestamp, timestampMs, unitUsed: preferredUnit }
  }

  const fallbackUnit: MarketTimestampUnit = preferredUnit === 'nanoseconds' ? 'milliseconds' : 'nanoseconds'
  const fallbackTimestampMs = convertToMs(rawTimestamp, fallbackUnit)
  if (isReasonableTimestampMs(fallbackTimestampMs)) {
    console.warn('MARKET DATA TIMESTAMP UNIT FALLBACK', {
      rawTimestamp,
      preferredUnit,
      fallbackUnit,
      normalizedTimestampMs: fallbackTimestampMs,
      isoDate: new Date(fallbackTimestampMs).toISOString(),
    })
    return { rawTimestamp, timestampMs: fallbackTimestampMs, unitUsed: fallbackUnit }
  }

  console.warn('MARKET DATA TIMESTAMP INVALID', {
    rawTimestamp,
    preferredUnit,
    normalizedTimestampMs: timestampMs,
  })
  return null
}

export function inferMarketDataSource(instrument: Instrument): MarketDataSource {
  return instrument.assetClass === 'crypto' ? 'crypto-exchange' : 'databento'
}

export function logNormalizedTimestamp(
  source: MarketDataSource,
  rawTimestamp: number | string,
  timestampMs: number,
  context: string,
) {
  console.info('MARKET DATA TIMESTAMP', {
    context,
    source,
    rawTimestamp,
    normalizedTimestampMs: timestampMs,
    isoDate: new Date(timestampMs).toISOString(),
  })
}
