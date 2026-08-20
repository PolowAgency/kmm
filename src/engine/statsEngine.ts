import type { AnalysisEngine, AnalysisSummary, EventCounts, LiquidityLevels, SessionStats } from './marketDataService'
import type { PressureSample } from './pressureEngine'
import type { ServiceStatus } from './types'

export interface StatRow {
  section?: string
  k: string
  v: string
  c: string
}

const CY = '#35c8e0'
const RS = '#e5484d'
const OR = '#e8822a'
const GN = '#43b04a'
const GREY = '#aeb8c2'

/**
 * Onglet STATS — port depuis le terminal web (TERMINAL/app/terminal-v2/components/modules/
 * signals/statsEngine.ts), fonction pure, aucun changement nécessaire pour React Native. Plus
 * courte que la version complète de la référence originale : certaines lignes viennent de
 * données jamais câblées dans ce port (FPS de rendu, POC/VAH/VAL — internes au futur canvas
 * Market Lens) — omises plutôt que remplies avec des valeurs inventées.
 */
export function buildStatsRows(
  session: SessionStats | null,
  summary: AnalysisSummary | null,
  counts: EventCounts,
  liquidity: LiquidityLevels,
  pressure: PressureSample | null,
  status: ServiceStatus,
  bookImbalance: number | null,
  analysis: AnalysisEngine,
  dec: number,
): StatRow[] {
  if (!session) return []
  const rows: StatRow[] = []
  const H2 = (k: string) => rows.push({ section: k, k, v: '', c: GREY })
  const R2 = (k: string, v: string, c = GREY) => rows.push({ k, v, c })

  const fmtOi = (v: number) => (Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(2) + 'M' : Math.round(Math.abs(v) / 1e3) + 'K')

  H2('SESSION')
  R2('Session volume', String(Math.round(session.vol)))
  R2('Session delta (CVD)', (session.cvd > 0 ? '+' : '') + Math.round(session.cvd), session.cvd >= 0 ? CY : RS)
  R2('VWAP', session.vwap ? session.vwap.toFixed(dec) : '—')
  R2('Open interest', fmtOi(session.oi))
  {
    const dOi = session.oi - session.oiOpen
    R2('OI Δ session', (dOi >= 0 ? '+' : '-') + fmtOi(dOi), dOi >= 0 ? CY : RS)
  }
  R2('Opening price', session.openPrice ? session.openPrice.toFixed(dec) : '—')
  R2('Session range', session.sessionHi > session.sessionLo ? (session.sessionHi - session.sessionLo).toFixed(dec) : '—')
  R2('Session high / low', `${session.sessionHi.toFixed(dec)} / ${session.sessionLo.toFixed(dec)}`)
  if (summary) R2('Market pace', summary.tradeRate.toFixed(1) + '/S', summary.tradeRate > 8 ? OR : GREY)
  R2('Auction status', Math.abs(session.cvd) > session.vol * 0.12 ? 'IMBALANCED' : 'BALANCED')

  H2('ORDER FLOW')
  R2('Buy volume', String(Math.round(session.buyVol)), CY)
  R2('Sell volume', String(Math.round(session.sellVol)), RS)
  if (summary) {
    const buyPct = summary.vol30 > 0 ? Math.round((100 * (summary.vol30 + summary.delta30)) / 2 / summary.vol30) : 50
    R2('Buy aggression 30S', buyPct + '%', buyPct > 55 ? CY : buyPct < 45 ? RS : GREY)
  }
  const now = Date.now()
  let d10 = 0
  for (const t of analysis.recentTrades) if (now - t.timestampMs < 10000) d10 += t.side === 'B' ? t.size : -t.size
  R2('Delta velocity', (d10 >= 0 ? '+' : '') + (d10 / 10).toFixed(1) + '/S', d10 >= 0 ? CY : RS)
  R2('Icebergs', String(counts.ice), counts.ice ? CY : GREY)
  R2('Absorptions', String(counts.abs))
  R2('Sweeps', String(counts.sweep))
  R2('Block trades', String(session.blockCount))
  R2('Spoof warnings', String(counts.spoof), counts.spoof ? OR : GREY)

  H2('ORDER BOOK')
  if (bookImbalance !== null) R2('Book imbalance', bookImbalance.toFixed(2), bookImbalance > 1.4 ? CY : bookImbalance < 0.7 ? RS : GREY)
  R2('Largest bid wall', liquidity.largestBid ? `${Math.round(liquidity.largestBid.size)} @ ${liquidity.largestBid.price.toFixed(dec)}` : '—', CY)
  R2('Largest ask wall', liquidity.largestAsk ? `${Math.round(liquidity.largestAsk.size)} @ ${liquidity.largestAsk.price.toFixed(dec)}` : '—', RS)
  if (pressure) R2('Stacking / pulling', (pressure.comps.bookDyn.v > 0 ? '+' : '') + Math.round(pressure.comps.bookDyn.v))

  if (pressure) {
    const p = pressure
    H2('SMART MONEY')
    const smart = Math.max(4, Math.min(96, 50 + (p.comps.largeOrders.v + p.comps.icebergs.v) * 0.45))
    const cont = Math.max(6, Math.min(94, 50 + p.score * 0.32))
    const trap = Math.min(95, counts.spoof * 10 + (p.trend === 'REVERSING' ? 25 : 0) + (Math.abs(p.score) > 55 && p.conf < 40 ? 20 : 0))
    const grade = p.conf > 75 ? 'A' : p.conf > 60 ? 'B' : p.conf > 45 ? 'C' : p.conf > 30 ? 'D' : 'E'
    R2('Institutional bias', p.score > 15 ? 'BUY SIDE' : p.score < -15 ? 'SELL SIDE' : 'NEUTRAL', p.score > 15 ? CY : p.score < -15 ? RS : GREY)
    R2('Smart money score', String(Math.round(smart)), smart > 60 ? OR : GREY)
    R2('Continuation prob', Math.round(cont) + '%', cont > 55 ? CY : cont < 45 ? RS : GREY)
    R2('Reversal prob', Math.round(100 - cont) + '%')
    R2('Trap probability', trap + '%', trap > 50 ? RS : GREY)
    R2('Trend health', p.trend, p.trend === 'RISING' ? CY : p.trend === 'FALLING' ? RS : GREY)
    R2('Confidence', p.conf + '%', p.conf > 60 ? GN : GREY)
    R2('Trade grade', grade, grade <= 'B' ? GN : grade === 'C' ? OR : RS)
  }

  H2('PERFORMANCE')
  R2('Feed latency', status.latencyMs + ' MS')
  R2('Messages / S', String(status.rate))
  if (summary) R2('Ticks / S', summary.tradeRate.toFixed(1))

  return rows
}
