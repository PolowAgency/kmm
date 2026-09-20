import { PaintStyle, Skia, type SkImage, type SkSurface } from '@shopify/react-native-skia'

import type { ControlSnapshot } from './controlEngine'
import { tfConfig } from './instruments'
import type { Instrument, Trade } from './types'

const BG = '#0a0c0f'
const CY = '#35c8e0' // acheteurs
const RS = '#e5484d' // vendeurs
const GY = '#6b7683' // neutre

/** Voir footprintEngine.ts côté web : même dérive flottante sur les tailles de trade réelles
 * (BTC notamment) sommées cellule par cellule, même correctif d'affichage. */
function fmtVol(v: number): string {
  const r = Math.round(v * 1e6) / 1e6
  if (Number.isInteger(r)) return String(r)
  return r.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

interface FootprintCell {
  b: number // volume au bid (vente agressive)
  a: number // volume à l'ask (achat agressif)
}

interface FootprintBar {
  start: number
  label: string
  cells: Map<number, FootprintCell>
  vol: number
  delta: number
  hi: number
  lo: number
}

export interface FootprintTextItem {
  x: number
  y: number
  width: number
  text: string
  color: string
  bold: boolean
  align: 'left' | 'center' | 'right'
  size: number
}

const BAR_W = 96
const GUT = 56

/**
 * Port scopé de FootprintEngine côté web
 * (TERMINAL/app/terminal-v2/components/modules/footprint/footprintEngine.ts) : grille bid×ask par
 * barre de temps, POC de barre, mise en évidence des déséquilibres (askImb/bidImb), footer
 * delta/volume/heure, axe de prix. Fonds/rects/lignes en Skia (comme les autres moteurs) mais le
 * TEXTE en overlays RN Text (FootprintPanelInner.tsx), pas en `canvas.drawText()` : essayé d'abord
 * avec `matchFont`/`Skia.FontMgr.System()`, qui plante au runtime sur le backend web de
 * react-native-skia ("Not implemented on React Native Web" — `matchFamilyStyle` n'existe tout
 * simplement pas côté CanvasKit-web, seul un `useFonts()` avec un fichier de police embarqué
 * fonctionnerait, ce qu'aucun module de ce projet ne fait aujourd'hui). `getFrame()` renvoie donc
 * aussi `textItems` : la position/couleur/alignement de chaque libellé, calculés ici exactement
 * comme pour le dessin Skia, à charge du composant de les rendre en <Text> positionnés dessus.
 *
 * Ligne de lecture synthétique WINNING/ABS/AGGR (setControlSnapshot) : maintenant reliée
 * (controlEngine.ts a été porté séparément) — 3 blocs de largeur fixe plutôt que le empilement à
 * largeur variable de la référence (`ctx.measureText` cumulatif) : sans mesure de texte
 * disponible ici (le texte n'est plus dessiné dans ce canvas, voir plus haut), une largeur fixe
 * par segment est la façon la plus simple de rester aligné à droite sans deviner la largeur réelle
 * de chaque valeur.
 *
 * Largeur du canvas dynamique (pas fixée au conteneur) : contrairement au web où seules les barres
 * qui tiennent dans la largeur visible sont dessinées (le reste de l'historique est juste perdu),
 * ici le canvas fait `bars.length * BAR_W + GUT` et le composant l'enveloppe dans un ScrollView
 * horizontal — l'historique des barres reste consultable en scrollant, rien n'est jeté.
 */
export class FootprintEngine {
  private instrument: Instrument
  private timeframeId = 'T'
  private bars: FootprintBar[] = []

  private containerHeight = 0
  private width = 0
  private height = 0
  private buf: SkSurface | null = null
  private textItems: FootprintTextItem[] = []
  private control: ControlSnapshot | null = null

  constructor(instrument: Instrument) {
    this.instrument = instrument
  }

  setTimeframe(id: string) {
    if (id === this.timeframeId) return
    this.timeframeId = id
    this.bars = []
  }

  setControlSnapshot(snap: ControlSnapshot | null) {
    this.control = snap
  }

  /** Hauteur du conteneur (fixe, vient du layout RN) — la largeur du buffer Skia est recalculée
   * à chaque tick() en fonction du nombre de barres actuelles, voir resizeToContent(). */
  setContainerHeight(height: number) {
    this.containerHeight = Math.max(1, Math.round(height))
  }

  handleTrade(trade: Trade) {
    const tick = this.instrument.tick
    const t = Math.round(trade.price / tick)
    const barMs = tfConfig(this.timeframeId).fp * 1000

    let bar = this.bars[this.bars.length - 1]
    if (!bar || trade.ts - bar.start > barMs) {
      bar = { start: trade.ts, label: new Date().toTimeString().slice(0, 8), cells: new Map(), vol: 0, delta: 0, hi: t, lo: t }
      this.bars.push(bar)
      if (this.bars.length > 40) this.bars.shift()
    }

    let cell = bar.cells.get(t)
    if (!cell) {
      cell = { b: 0, a: 0 }
      bar.cells.set(t, cell)
    }
    if (trade.side === 'B') {
      cell.a += trade.size
      bar.delta += trade.size
    } else {
      cell.b += trade.size
      bar.delta -= trade.size
    }
    bar.vol += trade.size
    if (t > bar.hi) bar.hi = t
    if (t < bar.lo) bar.lo = t
  }

  private resizeToContent() {
    const width = Math.max(1, this.bars.length * BAR_W + GUT)
    const height = this.containerHeight
    if (width === this.width && height === this.height && this.buf) return
    this.width = width
    this.height = height
    this.buf = Skia.Surface.Make(width, height)
  }

  /** À appeler à cadence régulière (~250ms, comme la référence) — pas de rAF, le footprint ne
   * s'anime pas en continu. */
  tick() {
    this.resizeToContent()
    this.draw()
  }

  private pushText(text: string, x: number, y: number, width: number, color: string, align: FootprintTextItem['align'], size: number, bold = false) {
    this.textItems.push({ x, y, width, text, color, bold, align, size })
  }

  private draw() {
    this.textItems = []
    if (!this.buf) return
    const canvas = this.buf.getCanvas()
    const W = this.width
    const H = this.height
    const bg = Skia.Paint()
    bg.setColor(Skia.Color(BG))
    canvas.drawRect(Skia.XYWHRect(0, 0, W, H), bg)
    if (!this.bars.length) return

    const bars = this.bars
    let hi = -Infinity
    let lo = Infinity
    let maxCell = 1
    for (const b of bars) {
      if (b.hi > hi) hi = b.hi
      if (b.lo < lo) lo = b.lo
      for (const c of b.cells.values()) {
        const v = c.b + c.a
        if (v > maxCell) maxCell = v
      }
    }
    hi += 1
    lo -= 1
    const nRows = Math.min(30, hi - lo + 1)
    hi = lo + nRows - 1
    const footH = 34
    const rowH = Math.max(11, Math.min(18, (H - footH - 14) / nRows))
    const dec = this.instrument.dec
    const tick = this.instrument.tick
    const lot = this.instrument.lot

    for (let t = hi; t >= lo; t -= 2) {
      const y = 12 + (hi - t) * rowH + rowH / 2
      if (y > H - footH) break
      this.pushText((t * tick).toFixed(dec), W - GUT + 6, y, GUT - 8, '#6b7683', 'left', 8.5)
    }
    const axisLine = Skia.Paint()
    axisLine.setColor(Skia.Color('#191d23'))
    const axisPath = Skia.Path.Make()
    axisPath.moveTo(W - GUT + 0.5, 0)
    axisPath.lineTo(W - GUT + 0.5, H)
    canvas.drawPath(axisPath, axisLine)

    for (let i = 0; i < bars.length; i++) {
      const b = bars[i]
      const x0 = W - GUT - (bars.length - i) * BAR_W
      if (x0 < 0) continue

      let pocT = 0
      let pocV = -1
      for (const [t, c] of b.cells) {
        const v = c.b + c.a
        if (v > pocV) {
          pocV = v
          pocT = t
        }
      }

      for (const [t, c] of b.cells) {
        if (t > hi || t < lo) continue
        const y = 12 + (hi - t) * rowH
        if (y + rowH > H - footH) continue
        const v = c.b + c.a
        const heat = Math.pow(v / maxCell, 0.7)
        const cellBg = Skia.Paint()
        cellBg.setColor(Skia.Color(`rgba(${(18 + 60 * heat) | 0},${(20 + 38 * heat) | 0},${(22 + 20 * heat) | 0},1)`))
        canvas.drawRect(Skia.XYWHRect(x0 + 1, y, BAR_W - 2, rowH - 1), cellBg)

        const below = b.cells.get(t - 1)
        const above = b.cells.get(t + 1)
        const askImb = !!below && c.a >= 3 * Math.max(1, below.b) && c.a > 8 * lot
        const bidImb = !!above && c.b >= 3 * Math.max(1, above.a) && c.b > 8 * lot

        if (askImb) {
          const fill = Skia.Paint()
          fill.setColor(Skia.Color('rgba(53,200,224,0.2)'))
          canvas.drawRect(Skia.XYWHRect(x0 + BAR_W / 2, y, BAR_W / 2 - 1, rowH - 1), fill)
          const accent = Skia.Paint()
          accent.setColor(Skia.Color(CY))
          canvas.drawRect(Skia.XYWHRect(x0 + BAR_W - 3, y, 2, rowH - 1), accent)
        }
        if (bidImb) {
          const fill = Skia.Paint()
          fill.setColor(Skia.Color('rgba(229,72,77,0.2)'))
          canvas.drawRect(Skia.XYWHRect(x0 + 1, y, BAR_W / 2 - 1, rowH - 1), fill)
          const accent = Skia.Paint()
          accent.setColor(Skia.Color(RS))
          canvas.drawRect(Skia.XYWHRect(x0 + 1, y, 2, rowH - 1), accent)
        }

        const yMid = y + rowH / 2
        this.pushText(fmtVol(c.b), x0 + 2, yMid, BAR_W / 2 - 7, bidImb ? RS : '#8b95a1', 'right', 8.5, bidImb)
        this.pushText(fmtVol(c.a), x0 + BAR_W / 2 + 5, yMid, BAR_W / 2 - 7, askImb ? CY : '#8b95a1', 'left', 8.5, askImb)
        this.pushText('×', x0, yMid, BAR_W, '#3a424c', 'center', 8.5)

        if (t === pocT) {
          const pocPaint = Skia.Paint()
          pocPaint.setColor(Skia.Color('rgba(232,130,42,0.85)'))
          pocPaint.setStyle(PaintStyle.Stroke)
          pocPaint.setStrokeWidth(1)
          canvas.drawRect(Skia.XYWHRect(x0 + 1.5, y + 0.5, BAR_W - 3, rowH - 2), pocPaint)
        }
      }

      const fy = H - footH + 6
      const dCol = b.delta > 0 ? CY : b.delta < 0 ? RS : '#7d8794'
      this.pushText((b.delta > 0 ? '+' : '') + fmtVol(b.delta), x0, fy, BAR_W, dCol, 'center', 9.5, true)
      this.pushText(fmtVol(b.vol), x0, fy + 12, BAR_W, '#6b7683', 'center', 8.5)
      this.pushText(b.label, x0, fy + 23, BAR_W, '#4d5763', 'center', 8.5)

      const sep = Skia.Paint()
      sep.setColor(Skia.Color('#14181d'))
      const sepPath = Skia.Path.Make()
      sepPath.moveTo(x0 + 0.5, 12)
      sepPath.lineTo(x0 + 0.5, H - 6)
      canvas.drawPath(sepPath, sep)
    }
  }

  getFrame(): { image: SkImage | null; width: number; height: number; textItems: FootprintTextItem[] } {
    return { image: this.buf ? this.buf.makeImageSnapshot() : null, width: this.width, height: this.height, textItems: this.textItems }
  }

  /**
   * Titre + lecture synthétique WINNING/ABS/AGGR — voir setControlSnapshot. Volontairement HORS
   * de getFrame()/draw() : ce sont des éléments de titre fixes (comme un en-tête de tableau), pas
   * partie du contenu qui défile. Positionnés en coordonnées canvas comme le reste du texte
   * (voir pushText plus haut), ils dérivaient hors champ au fil du temps quand le ScrollView
   * suit automatiquement les barres les plus récentes — constaté à l'écran : au bout de quelques
   * dizaines de secondes, le titre (ancré à l'extrémité GAUCHE, x=10, de tout l'historique)
   * sortait du cadre pour de bon pendant que le canvas s'élargit vers la droite. Rendu par
   * FootprintPanelInner comme une rangée fixe AU-DESSUS du ScrollView plutôt que dans le canvas
   * qui défile.
   */
  getHeader(): { title: string; segments: { label: string; color: string }[] } {
    const cfg = tfConfig(this.timeframeId)
    const title = `FOOTPRINT — BID × ASK · ${cfg.fp >= 60 ? cfg.fp / 60 + 'M' : cfg.fp + 'S'} BARS`
    if (!this.control) return { title, segments: [] }
    const mc = this.control
    const sTx = (v: number) => (v > 0.1 ? 'BUYERS' : v < -0.1 ? 'SELLERS' : '—')
    const sCl = (v: number) => (v > 0.1 ? CY : v < -0.1 ? RS : GY)
    const win = mc.regime === 'buyers' ? 'BUYERS' : mc.regime === 'sellers' ? 'SELLERS' : 'BALANCED'
    const winC = mc.regime === 'buyers' ? CY : mc.regime === 'sellers' ? RS : GY
    return {
      title,
      segments: [
        { label: `AGGR ${sTx(mc.comp.tape)}`, color: sCl(mc.comp.tape) },
        { label: `ABS ${sTx(mc.comp.abs)}`, color: sCl(mc.comp.abs) },
        { label: `WINNING ${win}`, color: winC },
      ],
    }
  }
}
