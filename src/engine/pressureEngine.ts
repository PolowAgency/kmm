import type { BookSnapshot, Instrument, Side, Trade } from './types'

/**
 * Pressure Engine — moteur de scoring microstructure. Port verbatim depuis le terminal web
 * (TERMINAL/app/terminal-v2/engine/pressureEngine.ts) : aucune API web ici (que du calcul sur
 * des tableaux + Date.now()), donc réutilisable tel quel côté React Native.
 *
 * Composition du score : 10 composants pondérés (WEIGHTS), chacun avec une valeur signée
 * -100..100 et une confiance 0..1 (basée sur la quantité de données disponibles). Le score
 * composite pondère chaque composant par son propre poids ET sa confiance — un composant sans
 * assez de données ne peut pas faire basculer le score à lui seul. La confiance globale est la
 * moyenne pondérée des confiances individuelles.
 *
 * Multi-timeframe (tf.s5/s30/m1/m5/m15/struct) : moyennes mobiles exponentielles du score
 * composite à 6 constantes de temps (5s → 30min), pas 6 calculs indépendants.
 */

export interface PressureComponent {
  /** Valeur signée, -100 (vendeur) .. 100 (acheteur) */
  v: number
  /** Confiance 0..1, basée sur le volume/l'historique disponible pour ce composant */
  c: number
}

export type PressureEventType = 'SWEEP' | 'ABSORPTION' | 'ICEBERG' | 'LARGE_ORDER'
export type PressureImportance = 'low' | 'med' | 'high'

export interface PressureEvent {
  ts: number
  type: PressureEventType
  /** 1 = acheteur, -1 = vendeur, 0 = neutre */
  side: 1 | -1 | 0
  score: number
  importance: PressureImportance
  expl: string
  label: string
  /** Niveau de prix (en ticks) où l'événement s'est produit. */
  priceTick: number
}

export type PressureTrend = 'RISING' | 'FALLING' | 'STABLE' | 'EXHAUSTED' | 'REVERSING'

export interface PressureComponents {
  orderFlow: PressureComponent
  dom: PressureComponent
  delta: PressureComponent
  momentum: PressureComponent
  sweeps: PressureComponent
  icebergs: PressureComponent
  absorption: PressureComponent
  bookDyn: PressureComponent
  vwap: PressureComponent
  largeOrders: PressureComponent
}

export interface PressureSample {
  score: number
  conf: number
  trend: PressureTrend
  mid: number
  comps: PressureComponents
  tf: { s5: number; s30: number; m1: number; m5: number; m15: number; struct: number }
  newEvents: PressureEvent[]
}

const WEIGHTS: Record<keyof PressureComponents, number> = {
  orderFlow: 0.16,
  dom: 0.09,
  delta: 0.13,
  momentum: 0.11,
  sweeps: 0.11,
  icebergs: 0.08,
  absorption: 0.12,
  bookDyn: 0.08,
  vwap: 0.06,
  largeOrders: 0.06,
}
const WEIGHT_KEYS = Object.keys(WEIGHTS) as (keyof PressureComponents)[]

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function emaStep(prev: number, value: number, halfLifeMs: number, dtMs: number): number {
  const alpha = 1 - Math.pow(0.5, dtMs / halfLifeMs)
  return prev + (value - prev) * alpha
}

interface LevelExec {
  vol: number
  lastTs: number
}

interface LevelDisplay {
  size: number
  firstSeenSize: number
  firstSeenTs: number
}

export class PressureEngine {
  readonly instrument: Instrument

  private trades: Trade[] = []
  private tradeSizes: number[] = []
  private latestBook: BookSnapshot | null = null
  private depthHist: { ts: number; bidDepth: number; askDepth: number }[] = []
  private priceHist: { ts: number; price: number }[] = []
  private levelExec = new Map<number, LevelExec>()
  private levelDisplay = new Map<number, LevelDisplay>()
  private vwapPV = 0
  private vwapV = 0

  private scoreHist: { ts: number; score: number }[] = []
  private emaS5 = 0
  private emaS30 = 0
  private emaM1 = 0
  private emaM5 = 0
  private emaM15 = 0
  private emaStruct = 0
  private lastSampleTs = 0

  private pendingEvents: PressureEvent[] = []
  private recentSweepTrades: Trade[] = []
  private lastAbsorptionSide: 1 | -1 | 0 = 0
  private icebergCooldown = new Map<number, number>() // tick -> ts du dernier événement émis

  constructor(instrument: Instrument) {
    this.instrument = instrument
  }

  // ---- Entrées marché --------------------------------------------------------

  onBook(book: BookSnapshot) {
    this.latestBook = book
    let bidDepth = 0
    let askDepth = 0
    for (const [, s] of book.bids) bidDepth += s
    for (const [, s] of book.asks) askDepth += s
    this.depthHist.push({ ts: book.ts, bidDepth, askDepth })
    if (this.depthHist.length > 600) this.depthHist.shift()

    const tick = this.instrument.tick
    const midT = Math.round((book.bids[0][0] + book.asks[0][0]) / 2 / tick)
    for (const [p, s] of book.bids) this.trackLevel(Math.round(p / tick), s)
    for (const [p, s] of book.asks) this.trackLevel(Math.round(p / tick), s)
    if (this.levelDisplay.size > 400) {
      for (const k of this.levelDisplay.keys()) if (Math.abs(k - midT) > 150) this.levelDisplay.delete(k)
    }
  }

  private trackLevel(t: number, size: number) {
    const prev = this.levelDisplay.get(t)
    if (!prev) this.levelDisplay.set(t, { size, firstSeenSize: size, firstSeenTs: Date.now() })
    else prev.size = size
  }

  onTrade(trade: Trade) {
    this.trades.push(trade)
    if (this.trades.length > 3000) this.trades.shift()
    this.tradeSizes.push(trade.size)
    if (this.tradeSizes.length > 400) this.tradeSizes.shift()
    this.vwapPV += trade.price * trade.size
    this.vwapV += trade.size
    this.priceHist.push({ ts: trade.ts, price: trade.price })
    if (this.priceHist.length > 2000) this.priceHist.shift()

    const tick = this.instrument.tick
    const t = Math.round(trade.price / tick)
    const lv = this.levelExec.get(t) ?? { vol: 0, lastTs: trade.ts }
    lv.vol += trade.size
    lv.lastTs = trade.ts
    this.levelExec.set(t, lv)

    this.detectSweep(trade)
  }

  /** Canal externe pour un futur détecteur d'événements (module Signals). */
  onEvent(e: { type: string; price: number; score: number; importance: PressureImportance; expl: string }) {
    this.pendingEvents.push({
      ts: Date.now(),
      type: 'LARGE_ORDER',
      side: 0,
      score: e.score,
      importance: e.importance,
      expl: e.expl,
      label: e.type,
      priceTick: Math.round(e.price / this.instrument.tick),
    })
  }

  get avgSize(): number {
    if (!this.tradeSizes.length) return Math.max(1, this.instrument.lot)
    return Math.max(1, this.tradeSizes.reduce((a, b) => a + b, 0) / this.tradeSizes.length)
  }

  private tradesSince(now: number, windowMs: number): Trade[] {
    const cut = now - windowMs
    const out: Trade[] = []
    for (let i = this.trades.length - 1; i >= 0; i--) {
      if (this.trades[i].ts < cut) break
      out.push(this.trades[i])
    }
    return out
  }

  private priceAt(now: number, windowMs: number): number | null {
    const cut = now - windowMs
    for (const p of this.priceHist) if (p.ts >= cut) return p.price
    return this.priceHist.length ? this.priceHist[0].price : null
  }

  private depthAt(now: number, windowMs: number): { bidDepth: number; askDepth: number } | null {
    const cut = now - windowMs
    for (const d of this.depthHist) if (d.ts >= cut) return d
    return this.depthHist.length ? this.depthHist[0] : null
  }

  // ---- Composants --------------------------------------------------------

  private calcOrderFlow(now: number): PressureComponent {
    const w = this.tradesSince(now, 12000)
    let buy = 0
    let sell = 0
    for (const t of w) (t.side === 'B' ? (buy += t.size) : (sell += t.size))
    const tot = buy + sell
    return { v: tot ? clamp((100 * (buy - sell)) / tot, -100, 100) : 0, c: clamp(tot / (this.avgSize * 20), 0, 1) }
  }

  private calcDelta(now: number): PressureComponent {
    const recent = this.tradesSince(now, 30000)
    const prior = this.tradesSince(now, 60000).filter((t) => now - t.ts >= 30000)
    const sum = (arr: Trade[]) => arr.reduce((a, t) => a + (t.side === 'B' ? t.size : -t.size), 0)
    const accel = sum(recent) - sum(prior)
    return { v: clamp((100 * accel) / (this.avgSize * 15), -100, 100), c: clamp((recent.length + prior.length) / 40, 0, 1) }
  }

  private calcMomentum(now: number): PressureComponent {
    const then = this.priceAt(now, 30000)
    const nowP = this.priceAt(now, 0)
    if (then === null || nowP === null) return { v: 0, c: 0 }
    const ticks = (nowP - then) / this.instrument.tick
    return { v: clamp((100 * ticks) / 20, -100, 100), c: clamp(this.priceHist.length / 20, 0, 1) }
  }

  private calcDom(): PressureComponent {
    if (!this.latestBook) return { v: 0, c: 0 }
    let bidDepth = 0
    let askDepth = 0
    for (const [, s] of this.latestBook.bids) bidDepth += s
    for (const [, s] of this.latestBook.asks) askDepth += s
    const tot = bidDepth + askDepth
    return { v: tot ? clamp((100 * (bidDepth - askDepth)) / tot, -100, 100) : 0, c: clamp(tot / (this.avgSize * 60), 0, 1) }
  }

  private calcBookDyn(now: number): PressureComponent {
    const latest = this.depthAt(now, 0)
    const old = this.depthAt(now, 4000)
    if (!latest || !old) return { v: 0, c: 0 }
    const dBid = latest.bidDepth - old.bidDepth
    const dAsk = latest.askDepth - old.askDepth
    return { v: clamp((100 * (dBid - dAsk)) / (this.avgSize * 30), -100, 100), c: this.depthHist.length >= 5 ? 0.6 : 0.2 }
  }

  private calcVwap(): PressureComponent {
    if (!this.latestBook || this.vwapV <= 0) return { v: 0, c: 0 }
    const mid = (this.latestBook.bids[0][0] + this.latestBook.asks[0][0]) / 2
    const vwap = this.vwapPV / this.vwapV
    const scale = this.instrument.tick * 40
    return { v: clamp((100 * (mid - vwap)) / scale, -100, 100), c: clamp(this.vwapV / (this.avgSize * 100), 0, 1) }
  }

  private calcAbsorption(now: number): PressureComponent {
    if (!this.latestBook) return { v: 0, c: 0 }
    const tick = this.instrument.tick
    const bestBidT = Math.round(this.latestBook.bids[0][0] / tick)
    const bestAskT = Math.round(this.latestBook.asks[0][0] / tick)
    const w = this.tradesSince(now, 8000)
    let sellAtBid = 0
    let buyAtAsk = 0
    for (const t of w) {
      const tt = Math.round(t.price / tick)
      if (t.side === 'S' && tt === bestBidT) sellAtBid += t.size
      if (t.side === 'B' && tt === bestAskT) buyAtAsk += t.size
    }
    const then = this.priceAt(now, 8000)
    const nowP = this.priceAt(now, 0)
    const movedTicks = then !== null && nowP !== null ? Math.abs((nowP - then) / tick) : 99
    const thr = 6 * this.avgSize
    let v = 0
    let side: 1 | -1 | 0 = 0
    if (movedTicks <= 1) {
      if (sellAtBid > thr && sellAtBid >= buyAtAsk) {
        v = clamp((100 * sellAtBid) / (thr * 2), 0, 100) // bid défendu malgré la vente = haussier
        side = 1
      } else if (buyAtAsk > thr) {
        v = -clamp((100 * buyAtAsk) / (thr * 2), 0, 100) // ask défendu malgré l'achat = baissier
        side = -1
      }
    }
    if (side !== 0 && side !== this.lastAbsorptionSide && Math.abs(v) > 40) {
      this.pushEvent(
        'ABSORPTION',
        side,
        Math.abs(v),
        Math.abs(v) > 70 ? 'high' : 'med',
        side > 0 ? `Vente agressive absorbée au bid (${Math.round(sellAtBid)}) sans repli de prix` : `Achat agressif absorbé à l'ask (${Math.round(buyAtAsk)}) sans avancée de prix`,
        'ABSORPTION',
        side > 0 ? bestBidT : bestAskT,
      )
    }
    this.lastAbsorptionSide = side
    return { v, c: clamp(Math.max(sellAtBid, buyAtAsk) / (this.avgSize * 10), 0, 1) }
  }

  private calcIcebergs(now: number): PressureComponent {
    if (!this.latestBook) return { v: 0, c: 0 }
    const tick = this.instrument.tick
    const mid = Math.round((this.latestBook.bids[0][0] + this.latestBook.asks[0][0]) / 2 / tick)
    let best = 0
    let bestT = 0
    for (let t = mid - 3; t <= mid + 3; t++) {
      const disp = this.levelDisplay.get(t)
      const exec = this.levelExec.get(t)
      if (!disp || !exec) continue
      const age = now - disp.firstSeenTs
      if (age < 4000) continue
      const stable = disp.size > 0 && Math.abs(disp.size - disp.firstSeenSize) / disp.firstSeenSize < 0.35
      if (!stable) continue
      const ratio = exec.vol / Math.max(1, disp.size)
      if (ratio > best) {
        best = ratio
        bestT = t
      }
    }
    if (best > 4) {
      const lastEvent = this.icebergCooldown.get(bestT) ?? -1e9
      if (now - lastEvent > 20000) {
        this.icebergCooldown.set(bestT, now)
        this.pushEvent('ICEBERG', bestT < mid ? 1 : -1, clamp(best * 10, 0, 100), 'med', `Taille cachée détectée à ${(bestT * tick).toFixed(this.instrument.dec)} — volume tradé ${best.toFixed(1)}x la taille affichée`, 'ICEBERG', bestT)
      }
    }
    const v = clamp(best * 8, 0, 100) * (bestT < mid ? 1 : bestT > mid ? -1 : 0)
    return { v, c: clamp(best / 8, 0, 1) }
  }

  private detectSweep(trade: Trade) {
    this.recentSweepTrades.push(trade)
    if (this.recentSweepTrades.length > 6) this.recentSweepTrades.shift()
    const w = this.recentSweepTrades
    if (w.length < 4) return
    const last4 = w.slice(-4)
    const sameSide = last4.every((t) => t.side === last4[0].side)
    if (!sameSide) return
    const span = last4[last4.length - 1].ts - last4[0].ts
    if (span > 1500) return
    const tick = this.instrument.tick
    const priceMove = (last4[last4.length - 1].price - last4[0].price) / tick
    const movedEnough = last4[0].side === 'B' ? priceMove >= 3 : priceMove <= -3
    if (!movedEnough) return
    const size = last4.reduce((a, t) => a + t.size, 0)
    this.pushEvent(
      'SWEEP',
      last4[0].side === 'B' ? 1 : -1,
      clamp(Math.abs(priceMove) * 12, 0, 100),
      Math.abs(priceMove) >= 5 ? 'high' : 'med',
      `Sweep ${last4[0].side === 'B' ? 'acheteur' : 'vendeur'} — ${Math.abs(priceMove)} ticks en ${span}ms, ${Math.round(size)} contrats`,
      'SWEEP',
      Math.round(last4[last4.length - 1].price / tick),
    )
    this.recentSweepTrades = []
  }

  private calcSweeps(now: number): PressureComponent {
    const w = this.tradesSince(now, 15000)
    let signed = 0
    let mag = 0
    for (const e of this.pendingEvents) {
      if (e.type === 'SWEEP' && now - e.ts < 15000) {
        signed += e.side * e.score
        mag += e.score
      }
    }
    void w
    return { v: clamp(signed / 2, -100, 100), c: clamp(mag / 150, 0, 1) }
  }

  private calcLargeOrders(now: number): PressureComponent {
    const w = this.tradesSince(now, 20000)
    const thr = 25 * this.instrument.lot
    let signed = 0
    let count = 0
    for (const t of w) {
      if (t.size >= thr) {
        signed += t.side === 'B' ? t.size : -t.size
        count++
        if (count <= 3) this.pushEvent('LARGE_ORDER', t.side === 'B' ? 1 : -1, clamp((100 * t.size) / (thr * 3), 0, 100), t.size >= thr * 2 ? 'high' : 'med', `Trade bloc ${t.side === 'B' ? 'acheteur' : 'vendeur'} de ${t.size} contrats`, 'BLOCK', Math.round(t.price / this.instrument.tick))
      }
    }
    return { v: clamp((100 * signed) / (this.avgSize * 40), -100, 100), c: clamp(count / 3, 0, 1) }
  }

  private pushEvent(type: PressureEventType, side: 1 | -1 | 0, score: number, importance: PressureImportance, expl: string, label: string, priceTick: number) {
    this.pendingEvents.push({ ts: Date.now(), type, side, score, importance, expl, label, priceTick })
    if (this.pendingEvents.length > 200) this.pendingEvents.shift()
  }

  private computeTrend(now: number, score: number, conf: number): PressureTrend {
    this.scoreHist.push({ ts: now, score })
    while (this.scoreHist.length && now - this.scoreHist[0].ts > 90000) this.scoreHist.shift()
    let prevScore = score
    for (const s of this.scoreHist) {
      if (now - s.ts >= 15000) prevScore = s.score
    }
    const delta = score - prevScore
    if (conf < 20) return 'STABLE'
    if (Math.sign(score) !== Math.sign(prevScore) && Math.abs(prevScore) > 15 && Math.abs(score) > 10) return 'REVERSING'
    if (Math.abs(score) > 55 && Math.abs(delta) < 6) return 'EXHAUSTED'
    if (delta > 8) return 'RISING'
    if (delta < -8) return 'FALLING'
    return 'STABLE'
  }

  // ---- Échantillonnage --------------------------------------------------------

  /**
   * À appeler à cadence régulière (~250ms). Retourne null tant qu'il n'y a pas assez de
   * données.
   *
   * IMPORTANT : `now` doit être `Date.now()` (horloge murale, ms) — tous les timestamps
   * comparés ici (trade.ts, book.ts, priceHist/depthHist/levelExec) viennent du flux marché en
   * horloge murale. Passer un autre référentiel de temps casserait silencieusement toute la
   * détection (sweeps, absorption, icebergs, momentum, delta) sans erreur visible.
   */
  sample(now: number): PressureSample | null {
    if (!this.latestBook || this.trades.length < 5) return null
    const dt = this.lastSampleTs ? now - this.lastSampleTs : 1000
    this.lastSampleTs = now

    const comps: PressureComponents = {
      orderFlow: this.calcOrderFlow(now),
      dom: this.calcDom(),
      delta: this.calcDelta(now),
      momentum: this.calcMomentum(now),
      absorption: this.calcAbsorption(now),
      icebergs: this.calcIcebergs(now),
      bookDyn: this.calcBookDyn(now),
      vwap: this.calcVwap(),
      largeOrders: this.calcLargeOrders(now),
      sweeps: this.calcSweeps(now),
    }

    let score = 0
    let conf = 0
    for (const k of WEIGHT_KEYS) {
      score += WEIGHTS[k] * comps[k].v * Math.max(0.25, comps[k].c)
      conf += WEIGHTS[k] * comps[k].c * 100
    }
    score = clamp(score, -100, 100)
    conf = clamp(Math.round(conf), 0, 100)

    const trend = this.computeTrend(now, score, conf)

    this.emaS5 = emaStep(this.emaS5, score, 5000, dt)
    this.emaS30 = emaStep(this.emaS30, score, 30000, dt)
    this.emaM1 = emaStep(this.emaM1, score, 60000, dt)
    this.emaM5 = emaStep(this.emaM5, score, 300000, dt)
    this.emaM15 = emaStep(this.emaM15, score, 900000, dt)
    this.emaStruct = emaStep(this.emaStruct, score, 1800000, dt)

    const newEvents = this.pendingEvents.splice(0, this.pendingEvents.length)

    return {
      score,
      conf,
      trend,
      mid: (this.latestBook.bids[0][0] + this.latestBook.asks[0][0]) / 2,
      comps,
      tf: { s5: this.emaS5, s30: this.emaS30, m1: this.emaM1, m5: this.emaM5, m15: this.emaM15, struct: this.emaStruct },
      newEvents,
    }
  }
}
