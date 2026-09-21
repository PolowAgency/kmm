import type { BookSnapshot, Instrument, Side, Trade } from './types'

export type ControlRegime = 'buyers' | 'sellers' | 'balanced'
export type ControlState = 'strengthening' | 'stable' | 'weakening' | 'transition'
export type TapeSpeed = 'SLOW' | 'NORMAL' | 'FAST' | 'VERY FAST'

export interface ControlComponents {
  foot: number
  tape: number
  depth: number
  abs: number
  resp: number
  lg: number
  persB: number
  persA: number
}

export interface ControlWhy {
  k: string
  v: string
  c: string
}

export interface ControlSnapshot {
  regime: ControlRegime
  /** Libellé prêt à afficher (ex. "STRONG BUYERS", "CONTROL SHIFT BUYERS → SELLERS") */
  label: string
  /** 0..100, orienté régime (ex. 74 si BUYERS à 74%) — port de `mcPct` */
  pct: number
  color: string
  /** 0..100, toujours acheteur-centré — port de `mcBar` (largeur de la barre bicolore) */
  barPct: number
  state: ControlState
  stateLabel: string
  stateColor: string
  conf: number
  confLabel: string
  confColor: string
  durationMs: number
  comp: ControlComponents
  why: ControlWhy[]
  vdBidPct: number
  vdAskPct: number
  vdLabel: string
  vdColor: string
  vdConf: string
  /** Volume brut (non lissé) sur les 10 meilleurs niveaux — pour la liquidité notionnelle du Copilot. */
  vdBidQty: number
  vdAskQty: number
  /** Niveaux "mur" (taille/moyenne ≥ 3.1) par côté sur les 20 meilleurs niveaux. */
  wallCountBid: number
  wallCountAsk: number
  ts60Net: number
  ts60LgB: number
  ts60LgS: number
  speed: TapeSpeed
  speedTrend: -1 | 0 | 1
}

const GR = '#38d296'
const RD = '#e5484d'
const YL = '#e8a64a'
const GY = '#6b7683'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

interface McTrade {
  ts: number
  side: Side
  size: number
  price: number
  big: boolean
}
interface LevelMeta {
  size: number
  stableTs: number
}

/**
 * Market Control Engine — port verbatim de controlEngine.ts côté web
 * (TERMINAL/app/terminal-v2/engine/controlEngine.ts) : fenêtre glissante 5 min de trades pour le
 * RAW DATA, régime acheteur/vendeur lissé en EMA et protégé par hystérésis (un flip doit tenir
 * 14-20s avant d'être confirmé) pour l'INTERPRÉTATION. Alimente la ligne de lecture synthétique
 * WINNING/ABS/AGGR du Footprint (voir FootprintEngine.setControlSnapshot côté web, pas encore
 * reliée ici — voir footprintEngine.ts) et pourra plus tard alimenter un Copilot/DOM-Tape mobile,
 * exactement comme côté web.
 *
 * Déjà indépendant des autres moteurs par conception côté web (voir le docstring de la référence :
 * tient son propre buffer de trades `fpWin` et sa propre Map `levelMeta` plutôt que de lire l'état
 * interne de FootprintEngine/MarketLensEngine) — porté ici tel quel, aucune adaptation
 * supplémentaire nécessaire pour cette indépendance.
 *
 * `now` doit être `Date.now()` (horloge murale, comme PressureEngine.sample()) — tous les
 * timestamps comparés ici (trade.ts, book.ts) viennent du flux marché en horloge murale.
 */
export class ControlEngine {
  readonly instrument: Instrument

  private latestBook: BookSnapshot | null = null
  private mcT: McTrade[] = []
  private fpWin: { ts: number; side: Side; size: number }[] = []
  private levelMeta = new Map<number, LevelMeta>()
  private tradeSizes: number[] = []

  private pct = 50
  private vdEma = 0.5
  private hist: { ts: number; pct: number }[] = []
  private regime: ControlRegime = 'balanced'
  private since: number
  private cand: ControlRegime | null = null
  private candSince = 0
  private shiftTs = 0
  private shiftLabel = ''
  private state: ControlState = 'stable'
  private conf = 50
  private comp: ControlComponents = { foot: 0, tape: 0, depth: 0, abs: 0, resp: 0, lg: 0, persB: 0, persA: 0 }
  private speed: TapeSpeed = 'NORMAL'
  private speedTrend: -1 | 0 | 1 = 0
  private ts60 = { net: 0, lgB: 0, lgS: 0 }
  private bookQty = { bid: 0, ask: 0 }
  private wallCount = { bid: 0, ask: 0 }

  constructor(instrument: Instrument) {
    this.instrument = instrument
    this.since = Date.now()
  }

  onBook(book: BookSnapshot) {
    this.latestBook = book
    const tick = this.instrument.tick
    const avg = this.avgSize
    const upd = (price: number, size: number) => {
      const t = Math.round(price / tick)
      let m = this.levelMeta.get(t)
      if (!m) {
        m = { size, stableTs: book.ts }
        this.levelMeta.set(t, m)
      }
      if (Math.abs(size - m.size) > Math.max(3 * this.instrument.lot, 0.35 * avg)) m.stableTs = book.ts
      m.size = size
    }
    for (let i = 0; i < Math.min(10, book.bids.length); i++) upd(book.bids[i][0], book.bids[i][1])
    for (let i = 0; i < Math.min(10, book.asks.length); i++) upd(book.asks[i][0], book.asks[i][1])
    if (this.levelMeta.size > 400 && book.bids[0] && book.asks[0]) {
      const mid = Math.round((book.bids[0][0] + book.asks[0][0]) / 2 / tick)
      for (const k of this.levelMeta.keys()) if (Math.abs(k - mid) > 150) this.levelMeta.delete(k)
    }
  }

  onTrade(trade: Trade) {
    this.tradeSizes.push(trade.size)
    if (this.tradeSizes.length > 400) this.tradeSizes.shift()
    const big = trade.size > 25 * this.instrument.lot
    this.mcT.push({ ts: trade.ts, side: trade.side, size: trade.size, price: trade.price, big })
    while (this.mcT.length && trade.ts - this.mcT[0].ts > 300000) this.mcT.shift()
    if (this.mcT.length > 6000) this.mcT.shift()
    this.fpWin.push({ ts: trade.ts, side: trade.side, size: trade.size })
    while (this.fpWin.length && trade.ts - this.fpWin[0].ts > 900000) this.fpWin.shift()
  }

  private get avgSize(): number {
    if (!this.tradeSizes.length) return Math.max(1, this.instrument.lot)
    return Math.max(1, this.tradeSizes.reduce((a, b) => a + b, 0) / this.tradeSizes.length)
  }

  /**
   * À appeler à cadence ~1Hz (comme la référence, throttle `_mcTs`/uiTick() côté web). Retourne
   * null tant qu'il n'y a ni carnet ni trade (même contrat que PressureEngine.sample()).
   */
  tick(now: number): ControlSnapshot | null {
    const b = this.latestBook
    if (!b || !this.mcT.length || !b.bids[0] || !b.asks[0]) return null
    const tick = this.instrument.tick
    const W = (ms: number) => this.mcT.filter((x) => now - x.ts < ms)
    const w60 = W(60000)

    let bV = 0
    let sV = 0
    let lgB = 0
    let lgS = 0
    for (const x of w60) {
      if (x.side === 'B') {
        bV += x.size
        if (x.big) lgB++
      } else {
        sV += x.size
        if (x.big) lgS++
      }
    }
    const tot = bV + sV
    const tape = tot > 0 ? (bV - sV) / tot : 0

    let fpD = 0
    let fpV = 0
    for (const x of this.fpWin) {
      fpD += x.side === 'B' ? x.size : -x.size
      fpV += x.size
    }
    const foot = fpV > 0 ? clamp(fpD / (fpV * 0.4), -1, 1) : 0

    const avg = this.avgSize
    let tb = 0
    let ta = 0
    let bOld = 0
    let bAll = 0
    let aOld = 0
    let aAll = 0
    // Murs par côté (score taille/moyenne ≥ 3.1, même seuil que DomTapeEngine.mkRow) — pour un
    // futur résumé WALLS type Market Copilot. Fenêtre 20 niveaux, plus large que les 10 niveaux
    // du reste de ce bloc (tb/ta/persistance), pour rester représentatif même quand le book est
    // profond.
    let wallCountBid = 0
    let wallCountAsk = 0
    for (let i = 0; i < 20; i++) {
      const bid = b.bids[i]
      const ask = b.asks[i]
      if (bid) {
        if (i < 10) tb += bid[1]
        if (bid[1] / avg >= 3.1) wallCountBid++
      }
      if (ask) {
        if (i < 10) ta += ask[1]
        if (ask[1] / avg >= 3.1) wallCountAsk++
      }
      if (i < 10) {
        if (bid) {
          const mB = this.levelMeta.get(Math.round(bid[0] / tick))
          if (mB) {
            bAll++
            if (now - mB.stableTs > 10000) bOld++
          }
        }
        if (ask) {
          const mA = this.levelMeta.get(Math.round(ask[0] / tick))
          if (mA) {
            aAll++
            if (now - mA.stableTs > 10000) aOld++
          }
        }
      }
    }
    const vdRaw = tb + ta > 0 ? tb / (tb + ta) : 0.5
    this.vdEma += (vdRaw - this.vdEma) * 0.08
    const depth = (this.vdEma - 0.5) * 2
    const persB = bAll ? bOld / bAll : 0
    const persA = aAll ? aOld / aAll : 0

    const p60 = w60.length ? (w60[w60.length - 1].price - w60[0].price) / tick : 0
    const resp = Math.tanh(p60 / 12)

    // absorption : agression forte et unilatérale + prix qui ne bouge pas = le camp opposé absorbe
    let abs = 0
    if (Math.abs(tape) > 0.3 && Math.abs(resp) < 0.15 && tot > 30 * this.instrument.lot) {
      abs = -Math.sign(tape) * Math.min(1, Math.abs(tape))
    }
    const lg = lgB + lgS > 0 ? (lgB - lgS) / (lgB + lgS) : 0
    this.comp = { foot, tape, depth, abs, resp, lg, persB, persA }

    // score composite pondéré → % acheteurs lissé
    const raw = foot * 0.22 + tape * 0.22 + depth * 0.16 + resp * 0.22 + abs * 0.1 + lg * 0.08
    const pctT = 50 + 50 * clamp(raw * 1.4, -1, 1)
    this.pct += (pctT - this.pct) * 0.15
    this.hist.push({ ts: now, pct: this.pct })
    while (this.hist.length && now - this.hist[0].ts > 120000) this.hist.shift()

    // hystérésis : un flip doit tenir 14s (retour à balanced) ou 20s (vers un camp) avant de se confirmer
    const desired: ControlRegime = this.pct >= 57 ? 'buyers' : this.pct <= 43 ? 'sellers' : 'balanced'
    if (desired !== this.regime) {
      if (this.cand !== desired) {
        this.cand = desired
        this.candSince = now
      }
      const need = desired === 'balanced' ? 14000 : 20000
      if (now - this.candSince >= need) {
        const oldR = this.regime
        this.regime = desired
        this.since = now
        this.cand = null
        if (oldR !== 'balanced' && desired !== 'balanced') {
          this.shiftTs = now
          this.shiftLabel = `${oldR === 'buyers' ? 'BUYERS' : 'SELLERS'} → ${desired === 'buyers' ? 'BUYERS' : 'SELLERS'}`
        }
      }
    } else {
      this.cand = null
    }

    // état : pente sur 30s, "transition" tant qu'un flip opposé est en cours de confirmation
    const old30 = this.hist.find((x) => now - x.ts < 32000)
    const slope = old30 ? this.pct - old30.pct : 0
    const dir = this.regime === 'buyers' ? 1 : this.regime === 'sellers' ? -1 : 0
    const pendingOpp = this.cand !== null && this.cand !== 'balanced' && this.cand !== this.regime
    this.state = pendingOpp ? 'transition' : dir === 0 ? 'stable' : slope * dir > 3 ? 'strengthening' : slope * dir < -3 ? 'weakening' : 'stable'

    // confiance : accord entre composants et régime courant
    if (dir !== 0) {
      let ag = 0
      const vals = [foot, tape, depth, resp]
      for (const v of vals) if (v * dir > 0.08) ag++
      this.conf = Math.round(35 + 55 * (ag / vals.length) - (abs * dir < -0.2 ? 10 : 0))
    } else {
      this.conf = Math.round(40 + 20 * (1 - Math.abs(this.pct - 50) / 10))
    }
    this.conf = clamp(this.conf, 15, 96)

    // vitesse du tape : taux sur 10s vs. la baseline 60s
    const w10 = W(10000)
    const r10 = w10.length / 10
    const r60 = Math.max(0.1, w60.length / 60)
    this.speed = r10 < r60 * 0.5 ? 'SLOW' : r10 > r60 * 2.2 ? 'VERY FAST' : r10 > r60 * 1.4 ? 'FAST' : 'NORMAL'
    this.speedTrend = r10 > r60 * 1.25 ? 1 : r10 < r60 * 0.75 ? -1 : 0
    this.ts60 = { net: Math.round(bV - sV), lgB, lgS }
    this.bookQty = { bid: tb, ask: ta }
    this.wallCount = { bid: wallCountBid, ask: wallCountAsk }

    return this.buildSnapshot(now)
  }

  private buildSnapshot(now: number): ControlSnapshot {
    const shift = this.shiftTs > 0 && now - this.shiftTs < 30000
    const buyers = this.regime === 'buyers'
    const sellers = this.regime === 'sellers'
    const pctS = buyers ? this.pct : sellers ? 100 - this.pct : this.pct
    const color = shift ? YL : buyers ? GR : sellers ? RD : this.state === 'transition' ? YL : GY
    const lvl = (v: number) => (v >= 70 ? 'STRONG ' : v >= 60 ? '' : 'SLIGHT ')
    let label: string
    if (shift) label = `CONTROL SHIFT ${this.shiftLabel}`
    else if (buyers) label = `${lvl(this.pct)}BUYERS`
    else if (sellers) label = `${lvl(100 - this.pct)}SELLERS`
    else label = 'BALANCED'

    const stateLabelMap: Record<ControlState, string> = {
      strengthening: 'STRENGTHENING ↑',
      stable: 'STABLE',
      weakening: 'WEAKENING ↓',
      transition: 'TRANSITION',
    }
    const stateColor = this.state === 'strengthening' ? GR : this.state === 'weakening' || this.state === 'transition' ? YL : GY

    const side = (v: number): { v: string; c: string } => (v > 0.1 ? { v: 'BUY', c: GR } : v < -0.1 ? { v: 'SELL', c: RD } : { v: '—', c: GY })
    const why: ControlWhy[] = [
      { k: 'FP', ...side(this.comp.foot) },
      { k: 'TAPE', ...side(this.comp.tape) },
      { k: 'DEPTH', ...side(this.comp.depth) },
      { k: 'ABS', ...side(this.comp.abs) },
      { k: 'RESP', ...side(this.comp.resp) },
    ]

    const confLabel = this.conf >= 70 ? 'HIGH' : this.conf >= 45 ? 'MEDIUM' : 'LOW'
    const confColor = this.conf >= 70 ? GR : this.conf >= 45 ? YL : RD

    const bidPct = Math.round(this.vdEma * 100)
    const vdDom = bidPct >= 58 ? { v: '● BUYERS', c: GR } : bidPct <= 42 ? { v: '● SELLERS', c: RD } : { v: '● BALANCED', c: GY }
    const persOk = (bidPct >= 50 ? this.comp.persB : this.comp.persA) > 0.4

    return {
      regime: this.regime,
      label,
      pct: Math.round(pctS),
      color,
      barPct: Math.round(this.pct),
      state: this.state,
      stateLabel: stateLabelMap[this.state],
      stateColor,
      conf: this.conf,
      confLabel,
      confColor,
      durationMs: now - this.since,
      comp: this.comp,
      why,
      vdBidPct: bidPct,
      vdAskPct: 100 - bidPct,
      vdLabel: vdDom.v,
      vdColor: vdDom.c,
      vdConf: `PERS ${persOk ? 'HIGH' : 'LOW'}`,
      vdBidQty: Math.round(this.bookQty.bid),
      vdAskQty: Math.round(this.bookQty.ask),
      wallCountBid: this.wallCount.bid,
      wallCountAsk: this.wallCount.ask,
      ts60Net: this.ts60.net,
      ts60LgB: this.ts60.lgB,
      ts60LgS: this.ts60.lgS,
      speed: this.speed,
      speedTrend: this.speedTrend,
    }
  }
}
