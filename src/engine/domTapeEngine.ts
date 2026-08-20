import type { BookSnapshot, Instrument, Side, Trade } from './types'

export interface DomRow {
  kind: 'level' | 'mid'
  side?: 'bid' | 'ask'
  price: string
  priceIsLast: boolean
  priceIsBest: boolean
  bid: string
  ask: string
  db: string
  da: string
  dSign: -1 | 0 | 1
  vol: string
  wall: string
  wallHeavy: boolean
  flash: number // 0..1, decays over ~480ms after a trade at this price
  pct: number // 0..100, remplissage relatif du fond (taille vs. le plus gros niveau visible)
}

export interface DomHeadStat {
  k: string
  v: string
  sign: -1 | 0 | 1
}

export interface TapeRow {
  time: string
  price: string
  size: string
  side: Side
  big: boolean
  tag: '' | 'LARGE' | 'BLOCK' | 'HIGH IMPACT'
}

export type TapeFilter = 'all' | 'big' | 'block'

interface TapeEntry {
  time: string
  price: number
  size: number
  side: Side
  big: boolean
  ts: number
}

/**
 * Moteur (sans canvas) du module DOM + Time & Sales — port depuis le terminal web
 * (TERMINAL/app/terminal-v2/engine/domTapeEngine.ts). Le DOM et le tape sont du texte/listes
 * classiques (pas de canvas) : ce moteur ne fait que calculer des view-models de lignes ; le
 * rendu (View/Text/FlatList, styles) vit dans l'écran React Native qui l'utilise.
 *
 * Seule différence avec l'original : `performance.now()` (décroissance du flash d'exécution,
 * voir execFlash) est remplacé par `Date.now()` — même rationale que marketDataService.ts
 * (Hermes n'expose pas forcément `performance.now()` selon la version).
 *
 * Indépendant des autres modules par conception : conserve son propre avgSize/volume de
 * session plutôt que de dépendre d'AnalysisEngine, pour rester démontable sans effets de bord
 * sur les autres écrans.
 */
export class DomTapeEngine {
  private instrument: Instrument
  private latestBook: BookSnapshot | null = null
  private domPrev = new Map<number, number>()
  private execFlash = new Map<number, number>() // tick -> Date.now() du dernier trade
  private sessionVol = new Map<number, number>()
  private lastTradePrice = 0
  private tapeBuf: TapeEntry[] = []
  private recentTrades: Trade[] = []
  private tradeSizes: number[] = []
  private sessionVolTotal = 0

  constructor(instrument: Instrument) {
    this.instrument = instrument
  }

  handleBook(book: BookSnapshot) {
    this.latestBook = book
  }

  handleTrade(trade: Trade) {
    const tick = this.instrument.tick
    const t = Math.round(trade.price / tick)
    this.lastTradePrice = trade.price
    this.execFlash.set(t, Date.now())
    this.sessionVol.set(t, (this.sessionVol.get(t) ?? 0) + trade.size)
    this.sessionVolTotal += trade.size

    this.recentTrades.push(trade)
    if (this.recentTrades.length > 600) this.recentTrades.shift()
    this.tradeSizes.push(trade.size)
    if (this.tradeSizes.length > 400) this.tradeSizes.shift()

    const big = trade.size > 25 * this.instrument.lot
    const d = new Date(trade.timestampMs)
    this.tapeBuf.unshift({
      time: d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0').slice(0, 2),
      price: trade.price,
      size: trade.size,
      side: trade.side,
      big,
      ts: trade.timestampMs,
    })
    if (this.tapeBuf.length > 60) this.tapeBuf.length = 60
  }

  private get avgSize(): number {
    if (!this.tradeSizes.length) return Math.max(1, this.instrument.lot)
    return Math.max(1, this.tradeSizes.reduce((a, b) => a + b, 0) / this.tradeSizes.length)
  }

  snapshot(tapeFilter: TapeFilter): { domRows: DomRow[]; domHead: DomHeadStat[]; tape: TapeRow[]; tapeCum: string; tapeD1: string } {
    const book = this.latestBook
    if (!book) return { domRows: [], domHead: [], tape: [], tapeCum: '0', tapeD1: '0' }

    const now = Date.now()
    const tick = this.instrument.tick
    const dec = this.instrument.dec
    const avg = this.avgSize
    // Profondeur affichée — 20 niveaux par côté (doit rester ≤ MarketDataService.BOOK_DEPTH côté
    // simulation ; en LIVE le backend peut envoyer plus ou moins de niveaux, on prend juste ce
    // qu'il y a).
    const nL = 20

    let maxS = 1
    for (let i = 0; i < nL; i++) maxS = Math.max(maxS, book.bids[i]?.[1] ?? 0, book.asks[i]?.[1] ?? 0)

    const mkRow = (price: number, size: number, side: 'bid' | 'ask'): DomRow => {
      const t = Math.round(price / tick)
      const prev = this.domPrev.get(t)
      const dd = prev === undefined ? 0 : size - prev
      this.domPrev.set(t, size)
      const isLast = Math.abs(price - this.lastTradePrice) < tick / 2
      const flashTs = this.execFlash.get(t)
      const flash = flashTs && now - flashTs < 480 ? 1 - (now - flashTs) / 480 : 0
      const wallScore = size / avg
      const isBest = side === 'bid' ? Math.abs(price - book.bids[0][0]) < tick / 2 : Math.abs(price - book.asks[0][0]) < tick / 2
      const dShown = Math.abs(dd) >= Math.max(2, avg * 0.12) ? Math.round(dd) : 0
      return {
        kind: 'level',
        side,
        bid: side === 'bid' ? String(size) : '',
        ask: side === 'ask' ? String(size) : '',
        db: side === 'bid' && dShown ? (dShown > 0 ? '+' : '') + dShown : '',
        da: side === 'ask' && dShown ? (dShown > 0 ? '+' : '') + dShown : '',
        dSign: dShown > 0 ? 1 : dShown < 0 ? -1 : 0,
        price: price.toFixed(dec),
        priceIsLast: isLast,
        priceIsBest: isBest,
        vol: String(Math.round(this.sessionVol.get(t) ?? 0) || ''),
        wall: wallScore >= 2 ? wallScore.toFixed(1) : '',
        wallHeavy: wallScore >= 3.1,
        flash,
        pct: Math.round((100 * size) / maxS),
      }
    }

    const domRows: DomRow[] = []
    for (let i = nL - 1; i >= 0; i--) if (book.asks[i]) domRows.push(mkRow(book.asks[i][0], book.asks[i][1], 'ask'))
    const mid = (book.bids[0][0] + book.asks[0][0]) / 2
    const spread = book.asks[0][0] - book.bids[0][0]
    domRows.push({
      kind: 'mid',
      price: mid.toFixed(dec),
      priceIsLast: false,
      priceIsBest: false,
      bid: '',
      ask: '',
      db: '',
      da: '',
      dSign: 0,
      vol: '',
      wall: '',
      wallHeavy: false,
      flash: 0,
      pct: 0,
    })
    for (let i = 0; i < nL; i++) if (book.bids[i]) domRows.push(mkRow(book.bids[i][0], book.bids[i][1], 'bid'))

    let tb = 0
    let ta = 0
    for (let i = 0; i < 10; i++) {
      tb += book.bids[i]?.[1] ?? 0
      ta += book.asks[i]?.[1] ?? 0
    }
    const imb = tb / Math.max(1, ta)
    let d10 = 0
    for (const t of this.recentTrades) if (now - t.timestampMs < 10000) d10 += t.side === 'B' ? t.size : -t.size
    const domHead: DomHeadStat[] = [
      { k: 'SPRD', v: spread.toFixed(dec), sign: 0 },
      { k: 'IMB', v: imb.toFixed(2), sign: imb > 1.4 ? 1 : imb < 0.7 ? -1 : 0 },
      { k: 'Δ10S', v: (d10 > 0 ? '+' : '') + d10, sign: d10 > 0 ? 1 : d10 < 0 ? -1 : 0 },
    ]

    const lot = this.instrument.lot
    const filtered = this.tapeBuf.filter((t) => (tapeFilter === 'all' ? true : tapeFilter === 'big' ? t.size >= 25 * lot : t.big))
    const tape: TapeRow[] = filtered.slice(0, 32).map((t) => {
      let tag: TapeRow['tag'] = ''
      if (t.size >= 60 * lot) tag = 'HIGH IMPACT'
      else if (t.size >= 40 * lot) tag = 'BLOCK'
      else if (t.size >= 25 * lot) tag = 'LARGE'
      return { time: t.time, price: t.price.toFixed(dec), size: String(t.size), side: t.side, big: t.big, tag }
    })

    let d1 = 0
    for (const t of this.tapeBuf) {
      if (now - t.ts < 1000) d1 += t.side === 'B' ? t.size : -t.size
      else break
    }

    return { domRows, domHead, tape, tapeCum: String(Math.round(this.sessionVolTotal)), tapeD1: (d1 > 0 ? '+' : '') + d1 }
  }
}
