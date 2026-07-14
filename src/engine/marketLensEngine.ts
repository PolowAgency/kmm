import { Skia, TileMode, type SkImage, type SkPoint, type SkSurface } from '@shopify/react-native-skia'

import type { BookSnapshot, Instrument, Trade } from './types'

const SPAN = 161
const HALF = 80
// Diviseur taille carnet → intensité couleur — même valeur et même raison que le web
// (TERMINAL/app/terminal-v2/components/modules/lens/lensEngine.ts) : calibré pour un flux live où
// les murs de carnet pèsent plus lourd que la taille moyenne d'un trade.
const DENSITY_DIV = 5.5
const BG = '#07080b'

interface BookMeta {
  size: number
  pull: number
}

interface HeatColumn {
  base: number
  midT: number
  sizes: Float32Array
}

export interface LensFrame {
  image: SkImage | null
  width: number
  height: number
  ribbon: SkPoint[]
}

/**
 * Port scopé (premier jalon) du raster de liquidité de MarketLensEngine côté web — voir la
 * décision utilisateur "La Market Lens (heatmap) d'abord" : uniquement la heatmap qui défile +
 * la ligne de prix (ribbon). Zones de contrôle / Auction Engine V9 / particules / vue 3D restent
 * pour une passe suivante, une fois ce socle validé.
 *
 * Contrairement au web (un seul HTMLCanvasElement 2D, double-buffer via deux <canvas> hors-DOM),
 * ici les deux buffers sont deux SkSurface CPU (Skia.Surface.Make) : pas de vue montée requise,
 * ce qui permet de garder le moteur "headless" comme DomTapeEngine/PressureEngine (créé dans un
 * effet, piloté par un intervalle, snapshoté par un composant Canvas Skia séparé).
 *
 * Simplification assumée par rapport à la référence : pas d'agrégation multi-timeframe (tfAcc/
 * mergeInto/cfg.n) — chaque colonne (60ms) est rastérisée immédiatement, comme si cfg.n valait
 * toujours 1. Le sélecteur de timeframe du terminal web n'a pas encore d'équivalent mobile.
 */
export class MarketLensEngine {
  private instrument: Instrument
  private sizes = new Map<number, number>()
  private meta = new Map<number, BookMeta>()
  private avgSize = 1
  private center = 0
  private latestBook: BookSnapshot | null = null

  private colW = 3
  private rowH = 5
  private width = 0
  private height = 0
  private buf: SkSurface | null = null
  private buf2: SkSurface | null = null
  private lut = new Uint8Array(256 * 3)

  private ribbon: { x: number; y: number }[] = []

  constructor(instrument: Instrument) {
    this.instrument = instrument
    this.buildLut()
  }

  resize(width: number, height: number) {
    width = Math.max(1, Math.round(width))
    height = Math.max(1, Math.round(height))
    if (width === this.width && height === this.height && this.buf) return
    this.width = width
    this.height = height
    this.buf = Skia.Surface.Make(width, height)
    this.buf2 = Skia.Surface.Make(width, height)
    this.ribbon = []
    if (this.buf) {
      const canvas = this.buf.getCanvas()
      const paint = Skia.Paint()
      paint.setColor(Skia.Color(BG))
      canvas.drawRect(Skia.XYWHRect(0, 0, width, height), paint)
    }
  }

  handleBook(book: BookSnapshot) {
    this.latestBook = book
    const tick = this.instrument.tick
    const lot = this.instrument.lot
    const upd = (price: number, size: number) => {
      const t = Math.round(price / tick)
      let m = this.meta.get(t)
      if (!m) {
        m = { size, pull: 0 }
        this.meta.set(t, m)
      }
      const d = size - m.size
      if (Math.abs(d) > Math.max(3 * lot, 0.35 * this.avgSize)) {
        if (-d > 1.7 * this.avgSize && m.size > 3 * this.avgSize) m.pull = 1
      }
      m.size = size
      this.sizes.set(t, size)
    }
    for (const [p, s] of book.bids) upd(p, s)
    for (const [p, s] of book.asks) upd(p, s)
    if (!this.center) this.center = Math.round((book.bids[0][0] + book.asks[0][0]) / 2 / tick)
    if (this.sizes.size > 900) {
      for (const k of this.sizes.keys()) {
        if (Math.abs(k - this.center) > 200) {
          this.sizes.delete(k)
          this.meta.delete(k)
        }
      }
    }
  }

  handleTrade(trade: Trade) {
    this.avgSize = this.avgSize * 0.985 + trade.size * 0.015
  }

  /** À appeler à cadence régulière (~60ms, comme la référence) pour faire avancer le raster. */
  pushColumn() {
    const book = this.latestBook
    if (!book || !this.center || !this.buf || !this.buf2) return
    const tick = this.instrument.tick
    const avg = Math.max(1, this.avgSize)
    const midT = (book.bids[0][0] + book.asks[0][0]) / 2 / tick
    const base = Math.round(midT) - HALF
    const sizes = new Float32Array(SPAN)
    for (let i = 0; i < SPAN; i++) {
      const t = base + i
      const s = this.sizes.get(t) ?? 0
      let v = Math.min(1, s / (avg * DENSITY_DIV))
      const m = this.meta.get(t)
      if (m && m.pull > 0.12) {
        v = -Math.min(1, m.pull)
        m.pull *= 0.45
      }
      sizes[i] = v
    }
    this.advanceRaster({ base, midT, sizes })
  }

  private advanceRaster(col: HeatColumn) {
    if (!this.buf || !this.buf2) return
    const rows = Math.floor(this.height / this.rowH)
    const half = rows >> 1
    let dy = 0
    if (Math.abs(col.midT - this.center) > rows * 0.16) {
      const shift = Math.round(col.midT - this.center)
      this.center += shift
      dy = shift * this.rowH
    }

    const prevImage = this.buf.makeImageSnapshot()
    const nextCanvas = this.buf2.getCanvas()
    const bgPaint = Skia.Paint()
    bgPaint.setColor(Skia.Color(BG))
    nextCanvas.drawRect(Skia.XYWHRect(0, 0, this.width, this.height), bgPaint)
    nextCanvas.drawImage(prevImage, -this.colW, dy)

    const tmp = this.buf
    this.buf = this.buf2
    this.buf2 = tmp

    const x = this.width - this.colW
    this.paintCol(x, col, rows, half)

    const yNow = (half - (col.midT - this.center)) * this.rowH
    if (dy) for (const p of this.ribbon) p.y += dy
    for (const p of this.ribbon) p.x -= this.colW
    this.ribbon.push({ x: x + this.colW / 2, y: yNow })
    const maxPoints = Math.ceil(this.width / this.colW) + 2
    while (this.ribbon.length > maxPoints) this.ribbon.shift()
  }

  /**
   * Colonne de densité continue (dégradé vertical unique par colonne) — port de paintCol() côté
   * web, adapté à l'API Skia : au lieu de `ctx.createLinearGradient().addColorStop()` appelé en
   * boucle, on accumule colors[]/positions[] puis un seul `Skia.Shader.MakeLinearGradient()`.
   */
  private paintCol(x: number, col: HeatColumn, rows: number, half: number) {
    if (!this.buf) return
    const canvas = this.buf.getCanvas()
    const val = (i: number) => (i >= 0 && i < SPAN ? col.sizes[i] : 0)
    const colors: ReturnType<typeof Skia.Color>[] = []
    const positions: number[] = []
    for (let r = 0; r < rows; r++) {
      const i = this.center + (half - r) - col.base
      const pos = Math.min(1, (r + 0.5) / rows)
      const v = val(i)
      if (v < -0.1) {
        const rv = Math.min(1, -v)
        colors.push(Skia.Color(`rgb(${(110 + 100 * rv) | 0},${(36 + 14 * rv) | 0},${(44 + 20 * rv) | 0})`))
        positions.push(pos)
        continue
      }
      const vv = Math.max(0, v) * 0.42 + Math.max(0, val(i - 1)) * 0.16 + Math.max(0, val(i + 1)) * 0.16
      const li = Math.min(255, Math.round(Math.pow(vv, 0.85) * 255))
      colors.push(Skia.Color(`rgb(${this.lut[li * 3]},${this.lut[li * 3 + 1]},${this.lut[li * 3 + 2]})`))
      positions.push(pos)
    }
    if (!colors.length) return
    const shader = Skia.Shader.MakeLinearGradient(Skia.Point(0, 0), Skia.Point(0, this.height), colors, positions, TileMode.Clamp)
    const paint = Skia.Paint()
    paint.setShader(shader)
    canvas.drawRect(Skia.XYWHRect(x, 0, this.colW, this.height), paint)
  }

  private buildLut() {
    const stops: [number, number, number, number][] = [
      [0, 13, 15, 19],
      [0.13, 30, 44, 78],
      [0.27, 38, 118, 152],
      [0.41, 46, 148, 92],
      [0.55, 176, 168, 58],
      [0.69, 226, 134, 44],
      [0.83, 222, 74, 52],
      [0.93, 255, 168, 130],
      [1, 255, 246, 238],
    ]
    for (let i = 0; i < 256; i++) {
      const v = i / 255
      let j = 0
      while (j < stops.length - 2 && stops[j + 1][0] < v) j++
      const a = stops[j]
      const b = stops[j + 1]
      const f = Math.max(0, Math.min(1, (v - a[0]) / (b[0] - a[0] || 1)))
      this.lut[i * 3] = a[1] + (b[1] - a[1]) * f
      this.lut[i * 3 + 1] = a[2] + (b[2] - a[2]) * f
      this.lut[i * 3 + 2] = a[3] + (b[3] - a[3]) * f
    }
  }

  getFrame(): LensFrame {
    return {
      image: this.buf ? this.buf.makeImageSnapshot() : null,
      width: this.width,
      height: this.height,
      ribbon: this.ribbon.map((p) => Skia.Point(p.x, p.y)),
    }
  }
}
