import { PaintStyle, Skia, StrokeCap, StrokeJoin, TileMode, type SkImage, type SkSurface } from '@shopify/react-native-skia'

import { tfConfig } from './instruments'
import type { BookSnapshot, Trade } from './types'

const BG = '#0a0c0f'
const CY = '#35c8e0' // acheteurs
const RS = '#e5484d' // vendeurs

export interface CvdSample {
  ts: number
  cvd: number
  roll: number
  price: number
}

export interface DivergenceEvent {
  kind: 'BEARISH DIV' | 'BULLISH DIV'
  price: number
  message: string
}

export interface CvdFrame {
  image: SkImage | null
  width: number
  height: number
  cvd: number
  barDelta: number
  hasBar: boolean
  timeframeId: string
  rollS: number
  divergence: DivergenceEvent | null
}

/**
 * Port du module CVD côté web (TERMINAL/app/terminal-v2/components/modules/cvd/cvdEngine.ts) :
 * courbe CVD de session + fenêtre glissante, delta de la barre courante ("BAR Δ"), détection de
 * divergence prix/CVD. Dessin en Skia (comme MarketLensEngine, pour la même raison : un
 * dégradé/ligne lissée est nettement plus simple à obtenir ainsi qu'avec des Views empilées) —
 * les libellés numériques ("CVD SESSION", "BAR Δ") restent en RN Text par-dessus (CvdPanel.tsx),
 * même choix que les cartes murs/événements/Auction Assistant : pas besoin de charger une police
 * dans Skia pour du texte qui ne bouge pas avec le graphique.
 */
export class CvdEngine {
  private getCvd: () => number
  private timeframeId = 'T'
  private hist: CvdSample[] = []
  private lastMid = 0
  private lastDivergenceTs = -1e9
  private lastDivergence: DivergenceEvent | null = null

  private barDelta = 0
  private barStart = 0

  private width = 0
  private height = 0
  private buf: SkSurface | null = null

  constructor(getCvd: () => number) {
    this.getCvd = getCvd
  }

  setTimeframe(id: string) {
    this.timeframeId = id
    this.barStart = 0
    this.barDelta = 0
  }

  resize(width: number, height: number) {
    width = Math.max(1, Math.round(width))
    height = Math.max(1, Math.round(height))
    if (width === this.width && height === this.height && this.buf) return
    this.width = width
    this.height = height
    this.buf = Skia.Surface.Make(width, height)
  }

  handleBook(book: BookSnapshot) {
    this.lastMid = (book.bids[0][0] + book.asks[0][0]) / 2
  }

  handleTrade(trade: Trade) {
    const barMs = tfConfig(this.timeframeId).fp * 1000
    if (!this.barStart || trade.ts - this.barStart > barMs) {
      this.barStart = trade.ts
      this.barDelta = 0
    }
    this.barDelta += trade.side === 'B' ? trade.size : -trade.size
  }

  /** À appeler à cadence régulière (~350ms, comme la référence) : échantillonne puis redessine
   * entièrement (contrairement à la heatmap, cette courbe n'est pas un raster qui défile — un
   * plein redessin à cette cadence reste largement dans le budget d'une frame mobile). */
  tick(now: number) {
    if (!this.lastMid) return
    const rollS = tfConfig(this.timeframeId).roll
    const cut = now - rollS * 1000
    const hs = this.hist
    const cvd = this.getCvd()
    let baseCvd = hs.length ? hs[0].cvd : cvd
    for (let i = hs.length - 1; i >= 0; i--) {
      if (hs[i].ts <= cut) {
        baseCvd = hs[i].cvd
        break
      }
    }
    hs.push({ ts: now, cvd, roll: cvd - baseCvd, price: this.lastMid })
    if (hs.length > 10800) hs.shift()

    this.lastDivergence = this.detectDivergence(now)
    this.draw()
  }

  private detectDivergence(now: number): DivergenceEvent | null {
    const win = this.hist.filter((s) => now - s.ts < 40000)
    if (win.length <= 20) return null
    let pMaxI = 0
    let cMaxI = 0
    let pMinI = 0
    let cMinI = 0
    for (let i = 0; i < win.length; i++) {
      if (win[i].price > win[pMaxI].price) pMaxI = i
      if (win[i].cvd > win[cMaxI].cvd) cMaxI = i
      if (win[i].price < win[pMinI].price) pMinI = i
      if (win[i].cvd < win[cMinI].cvd) cMinI = i
    }
    const recent = win.length - 5
    const last = win[win.length - 1]
    let div: DivergenceEvent | null = null
    if (pMaxI >= recent && cMaxI < win.length - 25) {
      div = { kind: 'BEARISH DIV', price: last.price, message: 'Price at new highs but CVD is not confirming — buyers thinning out' }
    } else if (pMinI >= recent && cMinI < win.length - 25) {
      div = { kind: 'BULLISH DIV', price: last.price, message: 'Price at new lows but CVD is not confirming — sellers thinning out' }
    }
    if (!div) return this.lastDivergenceTs > now - 25000 ? this.lastDivergence : null
    if (now - this.lastDivergenceTs > 25000) this.lastDivergenceTs = now
    return div
  }

  private draw() {
    if (!this.buf) return
    const canvas = this.buf.getCanvas()
    const W = this.width
    const H = this.height
    const bg = Skia.Paint()
    bg.setColor(Skia.Color(BG))
    canvas.drawRect(Skia.XYWHRect(0, 0, W, H), bg)
    if (this.hist.length < 3) return

    const hs = this.hist.slice(-260)
    let mn = Infinity
    let mx = -Infinity
    for (const s of hs) {
      if (s.cvd < mn) mn = s.cvd
      if (s.cvd > mx) mx = s.cvd
      if (s.roll < mn) mn = s.roll
      if (s.roll > mx) mx = s.roll
    }
    if (mx - mn < 10) {
      mx += 5
      mn -= 5
    }
    const pad = 10
    const X = (i: number) => (W * i) / (hs.length - 1)
    const Y = (v: number) => pad + (H - 2 * pad) * (1 - (v - mn) / (mx - mn))

    if (mn < 0 && mx > 0) {
      const zeroPaint = Skia.Paint()
      zeroPaint.setColor(Skia.Color('#22282f'))
      zeroPaint.setStyle(PaintStyle.Stroke)
      zeroPaint.setStrokeWidth(1)
      const zeroPath = Skia.Path.Make()
      zeroPath.moveTo(0, Y(0) + 0.5)
      zeroPath.lineTo(W, Y(0) + 0.5)
      canvas.drawPath(zeroPath, zeroPaint)
    }

    // CVD glissant (fenêtre du timeframe courant) — secondaire, discret.
    const rollPath = Skia.Path.Make()
    for (let i = 0; i < hs.length; i++) {
      const x = X(i)
      const y = Y(hs[i].roll)
      if (i === 0) rollPath.moveTo(x, y)
      else rollPath.lineTo(x, y)
    }
    const rollPaint = Skia.Paint()
    rollPaint.setColor(Skia.Color('rgba(125,135,148,0.45)'))
    rollPaint.setStyle(PaintStyle.Stroke)
    rollPaint.setStrokeWidth(1)
    canvas.drawPath(rollPath, rollPaint)

    // CVD session — primaire.
    const last = hs[hs.length - 1]
    const ccS = last.cvd >= hs[0].cvd ? CY : RS
    const sessionPath = Skia.Path.Make()
    for (let i = 0; i < hs.length; i++) {
      const x = X(i)
      const y = Y(hs[i].cvd)
      if (i === 0) sessionPath.moveTo(x, y)
      else sessionPath.lineTo(x, y)
    }
    const sessionPaint = Skia.Paint()
    sessionPaint.setColor(Skia.Color(ccS))
    sessionPaint.setStyle(PaintStyle.Stroke)
    sessionPaint.setStrokeWidth(1.5)
    sessionPaint.setStrokeCap(StrokeCap.Round)
    sessionPaint.setStrokeJoin(StrokeJoin.Round)
    sessionPaint.setAntiAlias(true)
    canvas.drawPath(sessionPath, sessionPaint)

    // Remplissage dégradé sous la courbe session.
    const fillPath = Skia.Path.Make()
    for (let i = 0; i < hs.length; i++) {
      const x = X(i)
      const y = Y(hs[i].cvd)
      if (i === 0) fillPath.moveTo(x, y)
      else fillPath.lineTo(x, y)
    }
    const yZero = Y(Math.max(mn, Math.min(mx, 0)))
    fillPath.lineTo(W, yZero)
    fillPath.lineTo(0, yZero)
    fillPath.close()
    const fillRgb = last.cvd >= hs[0].cvd ? '53,200,224' : '229,72,77'
    const fillPaint = Skia.Paint()
    const shader = Skia.Shader.MakeLinearGradient(
      Skia.Point(0, 0),
      Skia.Point(0, H),
      [Skia.Color(`rgba(${fillRgb},0.15)`), Skia.Color(`rgba(${fillRgb},0.02)`)],
      [0, 1],
      TileMode.Clamp,
    )
    fillPaint.setShader(shader)
    canvas.drawPath(fillPath, fillPaint)
  }

  getFrame(): CvdFrame {
    const hs = this.hist
    const last = hs[hs.length - 1]
    return {
      image: this.buf ? this.buf.makeImageSnapshot() : null,
      width: this.width,
      height: this.height,
      cvd: last ? last.cvd : 0,
      barDelta: this.barDelta,
      hasBar: this.barStart > 0,
      timeframeId: this.timeframeId,
      rollS: tfConfig(this.timeframeId).roll,
      divergence: this.lastDivergence,
    }
  }
}
