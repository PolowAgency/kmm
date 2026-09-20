import { Skia, TileMode, type SkImage, type SkPoint, type SkSurface } from '@shopify/react-native-skia'

import type { AnalysisSummary } from './marketDataService'
import type { BookSnapshot, Instrument, Trade } from './types'

const SPAN = 161
const HALF = 80
const MAX_HEATMAP_ROWS = 600
// Diviseur taille carnet → intensité couleur — même valeur et même raison que le web
// (TERMINAL/app/terminal-v2/components/modules/lens/lensEngine.ts) : calibré pour un flux live où
// les murs de carnet pèsent plus lourd que la taille moyenne d'un trade.
const DENSITY_DIV = 5.5
const BG = '#07080b'
// Gouttière de profil de volume (bord droit) — largeur ~identique à la référence web (`prof = 92`
// moins la marge de la ligne de gutter, ici simplifié à une seule constante).
export const PROFILE_W = 64
const POC_COLOR = '#e8822a'
const VALUE_AREA_COLOR = '#6e7987'
const OUTSIDE_COLOR = '#3d454f'

interface BookMeta {
  size: number
  pull: number
}

interface HeatColumn {
  base: number
  midT: number
  sizes: Float32Array
}

// ============================================================================
// Auction Engine — port scopé de auctionTick() côté web
// (TERMINAL/app/terminal-v2/components/modules/lens/lensEngine.ts, section "Auction Engine V9") :
// zones HVN (nœuds de haute acceptation), LVN (corridors de transit rapide), zones d'inefficacité,
// force/migration du POC, projection de destination, score de confluence, timeline, carte
// "AUCTION ASSISTANT". Port verbatim de la logique d'état (auctionTick) ; le rendu "Nodes V2"
// (bandes peintes sur la heatmap elle-même, drawAuctionStructures côté web) n'est PAS porté ici —
// c'est un second gros morceau de rendu, indépendant de l'état ci-dessous, délibérément laissé
// pour une passe suivante plutôt que bâclé. `A.activeZone` (qui dépend normalement de ce rendu
// pour son tri de priorité) est donc recalculé ici par une règle plus simple mais équivalente en
// pratique : le premier HVN puis, à défaut, le premier LVN dans lequel le prix se trouve — voir
// le commentaire sur activeZone dans auctionTick().
// ============================================================================
type HvnState = 'building' | 'accept' | 'balance' | 'aband' | 'reject'
interface ZoneBase {
  lo: number
  hi: number
  c: number
  conf: number
  born: number
  last: number
  touches: number
  in: boolean
}
interface HvnZone extends ZoneBase {
  vol: number
  state: HvnState
  stars: number
  rejN?: number
  accN?: number
  enterTs?: number
}
type LvnZone = ZoneBase
interface IneffZone {
  lo: number
  hi: number
  dir: 1 | -1
  born: number
  fillLo: number | null
  fillHi: number | null
  state: 0 | 1 | 2
  done: number
}
interface AuctionDest {
  t: number
  dir: 1 | -1
  dist: number
  obst: { t: number; size: number } | null
  from: number
}
interface AuctionMsg {
  ts: number
  t: number
  key: string
}
interface AuctionTimelineEvent {
  ts: number
  key: string
  time: string
}
interface AuctionConfluence {
  score: number
  parts: [string, string][]
}
type Migration = 'up' | 'down' | 'bal'
export interface AuctionState {
  hvns: HvnZone[]
  lvns: LvnZone[]
  ineff: IneffZone[]
  pocHist: { ts: number; poc: number }[]
  msgs: AuctionMsg[]
  conf: AuctionConfluence | null
  dest: AuctionDest | null
  migration: Migration
  migPrev: Migration
  pocState: '' | 'test' | 'above' | 'below'
  psPrev: '' | 'test' | 'above' | 'below'
  pocStrength: number
  inLvnNow: boolean
  wasLvn: boolean
  poc: number
  pocV: number
  pocPrev: number
  pocBorn: number
  contra: 'contraSell' | 'contraBuy' | null
  tl: AuctionTimelineEvent[]
  disp: { conf: number; buy: number; day: number; pc: number }
  buyPct: number
  dayGauge: number
  mktConf: number
  pCont: number
  ctl: 'buyers' | 'sellers' | 'rot'
  ctlPrev: 'buyers' | 'sellers' | 'rot' | ''
  ctlTl: AuctionTimelineEvent[]
  risks: [string, string][]
  nextLvl: { t: number; key: string; stars: number; d: number } | null
  sumKey: string
  activeZone: { lvn: boolean; state: HvnState } | null
}

export const AUC_DICT: Record<string, string> = {
  lvnIn: 'LVN ENTRY — POSSIBLE ACCELERATION',
  migUp: 'VALUE MIGRATION ▲',
  migDn: 'VALUE MIGRATION ▼',
  migBal: 'VALUE BALANCED',
  pocTest: 'POC TEST',
  ineffNew: 'INEFFICIENCY — FAST CORRIDOR',
  ineffFill: 'INEFFICIENCY FILLED',
  title: 'AUCTION ASSISTANT',
  mconf: 'CONFIDENCE',
  ctlNow: 'CURRENT CONTROL',
  ctlDay: 'DAY CONTEXT',
  stateK: 'MARKET STATE',
  buyersW: 'Buyers dominant',
  sellersW: 'Sellers dominant',
  rotW: 'Rotation',
  probK: 'PROBABILITY',
  probCont: 'continuation',
  probRev: 'reversal',
  cpK: 'COUNTERPARTY',
  cpDayK: 'DAY COUNTERPARTY',
  nextK: 'CRITICAL LEVEL',
  distK: 'ticks',
  fastZone: 'Fast zone (LVN) — acceleration likely',
  slowZone: 'Slow zone (HVN) — slowdown likely',
  risksK: 'RISKS',
  rkCvd: 'CVD not confirming',
  rkWall: 'Opposing wall nearby',
  rkThin: 'Thin volume in zone',
  rkMigDn: 'Value migrating down',
  okMigUp: 'Value migrating up',
  okPoc: 'POC tested / defended',
  sumBuy: 'Buyers control the flow and the session confirms. Watch for acceptance above the value area.',
  sumBuyVsDay:
    'Buyers control short-term flow but the session remains under selling pressure. A value-area break would confirm the recovery.',
  sumSell: 'Sellers control the flow and the session confirms. Watch how the walls below the price hold.',
  sumSellVsDay: 'Sellers dominate short-term but the session remains buyer-controlled. Risk of a rotation back to the POC.',
  sumRot: 'Rotation inside the value area. Neither side truly controls the market — wait for the extremes.',
  inLvnT: 'Price inside an LVN',
  inHvnT: 'Price inside an HVN',
}

export interface LensFrame {
  image: SkImage | null
  width: number
  height: number
  ribbon: SkPoint[]
  profileImage: SkImage | null
  profileWidth: number
}

export interface LensViewport {
  width: number
  height: number
  rowH: number
  rows: number
  half: number
  center: number
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
  private readonly defaultRowH = 5
  private readonly minRowH = 2
  private readonly maxRowH = 12
  // Décalage utilisateur (pan vertical, en lignes de prix) appliqué uniquement à l'affichage —
  // `this.center` reste l'ancre de l'auto-suivi du marché (utilisée par advanceRaster() pour
  // décider quand recentrer le raster), jamais modifiée par les gestes : voir viewCenter() plus
  // bas, seul point où les deux se combinent pour le rendu (paintCol/ruban).
  private userCenterOffset = 0
  private width = 0
  private height = 0
  private buf: SkSurface | null = null
  private buf2: SkSurface | null = null
  private lut = new Uint8Array(256 * 3)

  private ribbon: { x: number; y: number }[] = []

  // Volume échangé par tick de prix, cumulé sur toute la session (jamais purgé, comme
  // sessionVol côté web) — sert au profil de volume (POC/VAH/VAL) peint dans profileBuf.
  private sessionVol = new Map<number, number>()
  private profileBuf: SkSurface | null = null

  // ---- Auction Engine : état + entrées poussées de l'extérieur (React), voir setAnalysisSnapshot
  // / setPressureScore / setSessionStats plus bas — même principe que setAnalysisSnapshot côté web. ----
  private auction: AuctionState | null = null
  private lastAuctionTick = 0
  // Historique court des positions du prix (en ticks), alimenté à chaque pushColumn() — équivalent
  // réduit de `this.cols` côté web (qui garde ~4200 colonnes pour la reconstruction de la heatmap) :
  // auctionTick() n'a besoin que des ~15 dernières pour la détection d'inefficacité/destination.
  private colHistory: { ts: number; midT: number }[] = []
  private lastSummary: AnalysisSummary | null = null
  private lastCvd = 0
  private lastPressureScore = 0
  // Équivalent de vwapV/openPrice/lastTradePrice côté web : plutôt que de dupliquer ce suivi ici,
  // on reçoit ces valeurs déjà calculées par AnalysisEngine.sessionStats() (vol/openPrice/price).
  private lastSessionStats: { vol: number; openPrice: number; price: number } | null = null

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
    this.profileBuf = Skia.Surface.Make(PROFILE_W, height)
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
    const t = Math.round(trade.price / this.instrument.tick)
    this.sessionVol.set(t, (this.sessionVol.get(t) ?? 0) + trade.size)
  }

  /** Pan vertical (geste 1 doigt) — deltaRows en lignes de prix, positif = vers le passé/haut. */
  pan(deltaRows: number) {
    this.userCenterOffset += deltaRows
  }

  /** Zoom (pinch 2 doigts) — rowH cible en px, borné. Plus rowH est petit, plus de niveaux de
   * prix tiennent à l'écran (zoom arrière) ; plus il est grand, moins il y en a (zoom avant). */
  setZoom(rowH: number) {
    this.rowH = Math.max(this.minRowH, Math.min(this.maxRowH, rowH))
  }

  get zoomRowH() {
    return this.rowH
  }

  /** Double-tap — revient au suivi live centré, zoom par défaut. */
  resetView() {
    this.userCenterOffset = 0
    this.rowH = this.defaultRowH
  }

  /** Centre effectif utilisé pour le rendu (paintCol/ruban) — combine l'ancre d'auto-suivi
   * (this.center, jamais touchée par les gestes) et le décalage utilisateur (pan). */
  private viewCenter() {
    return this.center + this.userCenterOffset
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

    const now = Date.now()
    this.colHistory.push({ ts: now, midT })
    if (this.colHistory.length > 20) this.colHistory.shift()
    // Recalcul au maximum 1x/2s, comme la référence web (voir le docstring d'auctionTick) —
    // c'est une lecture de contexte de marché, pas un flux à rafraîchir à 60ms.
    if (now - this.lastAuctionTick >= 2000) {
      this.lastAuctionTick = now
      this.auctionTick(now)
    }
  }

  /** Snapshot AnalysisEngine (summary/cvd) — voir setAnalysisSnapshot côté web, poussé ici par
   * MarketLensCanvasInner sur la même cadence que le reste de l'UI (~250ms). */
  setAnalysisSnapshot(summary: AnalysisSummary | null, cvd: number) {
    this.lastSummary = summary
    this.lastCvd = cvd
  }

  /** Dernier score Pressure composite connu (-100..100). */
  setPressureScore(score: number) {
    this.lastPressureScore = score
  }

  /** Sert de substitut à vwapV/openPrice/lastTradePrice côté web (déjà calculés par
   * AnalysisEngine.sessionStats(), pas besoin de les recalculer ici). */
  setSessionStats(stats: { vol: number; openPrice: number; price: number }) {
    this.lastSessionStats = stats
  }

  getAuctionState(): AuctionState | null {
    return this.auction
  }

  private advanceRaster(col: HeatColumn) {
    if (!this.buf || !this.buf2) return
    const rows = Math.min(MAX_HEATMAP_ROWS, Math.floor(this.height / this.rowH))
    if (rows <= 0) return
    const half = rows >> 1
    let dy = 0
    if (Math.abs(col.midT - this.center) > rows * 0.16) {
      // Rattrapage PROPORTIONNEL (fraction constante de l'écart par colonne), pas un saut plein
      // d'un coup — port du fix web (TERMINAL/lensEngine.ts, commits 2244b58/640801e) : sur un
      // instrument au tick très fin face à sa volatilité (BTC : tick 0.1$, mouvements de
      // plusieurs $/s), un rattrapage complet en un seul bond fait "sauter" la ligne de prix et
      // le raster se redessine par saccades ("part dans tous les sens"). Une fraction constante
      // converge exponentiellement vite (~90% résorbé en ~5 colonnes) tout en restant fluide.
      const gap = col.midT - this.center
      let shift = Math.round(gap * 0.4)
      if (shift === 0) shift = Math.sign(gap)
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
    const viewCenter = this.viewCenter()
    this.paintCol(x, col, rows, half, viewCenter)
    this.paintProfile(rows, half, viewCenter)

    const yNow = (half - (col.midT - viewCenter)) * this.rowH
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
  private paintCol(x: number, col: HeatColumn, rows: number, half: number, viewCenter: number) {
    if (!this.buf) return
    const canvas = this.buf.getCanvas()
    const val = (i: number) => (i >= 0 && i < SPAN ? col.sizes[i] : 0)
    const colors: ReturnType<typeof Skia.Color>[] = []
    const positions: number[] = []
    // viewCenter peut être fractionnaire (le pan accumule des deltas au pixel près) — arrondi ici
    // uniquement, car c'est un index de tableau (col.sizes), contrairement au ruban (coordonnée
    // de dessin, où le sous-pixel donne un mouvement plus fluide).
    const viewCenterInt = Math.round(viewCenter)
    for (let r = 0; r < rows; r++) {
      const i = viewCenterInt + (half - r) - col.base
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

  /**
   * Profil de volume (POC/VAH/VAL) — port de computeProfile() côté web (lensEngine.ts), verbatim :
   * POC = tick au volume le plus fort, value area = plage contiguë autour du POC qui concentre 70%
   * du volume total, étendue tick par tick vers le côté (haut/bas) le plus chargé.
   */
  private computeProfile(): { poc: number; vah: number; val: number } | null {
    if (this.sessionVol.size < 5) return null
    let poc = 0
    let pocV = 0
    let tot = 0
    for (const [t, v] of this.sessionVol) {
      tot += v
      if (v > pocV) {
        pocV = v
        poc = t
      }
    }
    let acc = pocV
    let lo = poc
    let hi = poc
    while (acc < tot * 0.7) {
      const up = this.sessionVol.get(hi + 1) ?? 0
      const dn = this.sessionVol.get(lo - 1) ?? 0
      if (up === 0 && dn === 0) {
        hi++
        lo--
        acc += 1e-9
        if (hi - lo > 400) break
        continue
      }
      if (up >= dn) {
        hi++
        acc += up
      } else {
        lo--
        acc += dn
      }
    }
    return { poc, vah: hi, val: lo }
  }

  /**
   * Gouttière de profil de volume — redessinée entièrement à chaque colonne (contrairement au
   * raster de la heatmap, elle ne défile pas : c'est un histogramme du volume cumulé de session
   * sur les lignes de prix ACTUELLEMENT visibles, donc rien à faire scroller). Port simplifié de
   * la référence web (même histogramme + coloration POC/value-area/hors-VA) : les rails HVN/LVN
   * du web dépendent de l'Auction Engine (zones de contrôle), pas encore porté ici — délibérément
   * omis plutôt que bâclé, voir le docstring de la classe.
   */
  private paintProfile(rows: number, half: number, viewCenter: number) {
    if (!this.profileBuf) return
    const canvas = this.profileBuf.getCanvas()
    const bgPaint = Skia.Paint()
    bgPaint.setColor(Skia.Color(BG))
    canvas.drawRect(Skia.XYWHRect(0, 0, PROFILE_W, this.height), bgPaint)

    const profile = this.computeProfile()
    if (!profile) return

    const viewCenterInt = Math.round(viewCenter)
    let maxV = 0
    for (let r = 0; r < rows; r++) {
      const t = viewCenterInt + (half - r)
      maxV = Math.max(maxV, this.sessionVol.get(t) ?? 0)
    }
    if (maxV <= 0) return

    const barH = Math.max(1, Math.round(this.rowH) - 1)
    const paint = Skia.Paint()
    for (let r = 0; r < rows; r++) {
      const t = viewCenterInt + (half - r)
      const v = this.sessionVol.get(t) ?? 0
      if (!v) continue
      const y = Math.round((r + 0.5) * this.rowH - barH / 2)
      const w = Math.max(1, Math.round((PROFILE_W - 8) * (v / maxV)))
      const inVA = t >= profile.val && t <= profile.vah
      paint.setColor(Skia.Color(t === profile.poc ? POC_COLOR : inVA ? VALUE_AREA_COLOR : OUTSIDE_COLOR))
      canvas.drawRect(Skia.XYWHRect(PROFILE_W - w, y, w, barH), paint)
    }
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

  private aucMsg(t: number, key: string) {
    const A = this.auction
    if (!A) return
    A.msgs.push({ ts: Date.now(), t, key })
    if (A.msgs.length > 8) A.msgs.shift()
  }

  /**
   * Port fidèle de auctionTick() côté web (voir le commentaire de section "Auction Engine" plus
   * haut) — zones HVN/LVN à hystérésis (confiance qui monte/descend au lieu d'un simple seuil
   * binaire), zones d'inefficacité (déplacement rapide + volume creux), force/migration du POC,
   * projection de destination, détecteur de contradiction (flux court terme vs CVD de session),
   * score de confluence, contrôle acheteurs/vendeurs, probabilité de continuation, risques.
   */
  private auctionTick(now: number) {
    let A = this.auction
    if (!A) {
      A = this.auction = {
        hvns: [],
        lvns: [],
        ineff: [],
        pocHist: [],
        msgs: [],
        conf: null,
        dest: null,
        migration: 'bal',
        migPrev: 'bal',
        pocState: '',
        psPrev: '',
        pocStrength: 0,
        inLvnNow: false,
        wasLvn: false,
        poc: 0,
        pocV: 0,
        pocPrev: 0,
        pocBorn: now,
        contra: null,
        tl: [],
        disp: { conf: 50, buy: 50, day: 0, pc: 50 },
        buyPct: 50,
        dayGauge: 0,
        mktConf: 50,
        pCont: 50,
        ctl: 'rot',
        ctlPrev: '',
        ctlTl: [],
        risks: [],
        nextLvl: null,
        sumKey: 'sumRot',
        activeZone: null,
      }
    }
    const sv = this.sessionVol
    if (sv.size < 15 || !this.center) return
    const ks: number[] = []
    for (const k of sv.keys()) ks.push(k)
    ks.sort((a, b) => a - b)
    const lo = ks[0]
    const hi = ks[ks.length - 1]
    if (hi - lo < 10) return
    const vol = (t: number) => sv.get(t) ?? 0
    let tot = 0
    let pocV = 0
    let poc = 0
    let second = 0
    for (const k of ks) {
      const v = sv.get(k)!
      tot += v
      if (v > pocV) {
        second = pocV
        pocV = v
        poc = k
      } else if (v > second) second = v
    }
    const avg = tot / (hi - lo + 1)
    const smv = (t: number) => (vol(t - 1) + 2 * vol(t) + vol(t + 1)) / 4
    const cand = (test: (t: number) => boolean): [number, number][] => {
      const runs: [number, number][] = []
      let s0: number | null = null
      for (let t = lo; t <= hi; t++) {
        if (test(t)) {
          if (s0 === null) s0 = t
        } else if (s0 !== null) {
          runs.push([s0, t - 1])
          s0 = null
        }
      }
      if (s0 !== null) runs.push([s0, hi])
      return runs.filter((r) => r[1] - r[0] >= 1)
    }
    const mergeZones = <Z extends ZoneBase>(list: Z[], candList: [number, number][], make: (lo: number, hi: number, c: number) => Z) => {
      const seen = new Set<Z>()
      for (const c2 of candList) {
        const cc = (c2[0] + c2[1]) / 2
        let zz: Z | null = null
        for (const z of list) {
          if (Math.abs(z.c - cc) <= 4) {
            zz = z
            break
          }
        }
        if (zz) {
          zz.lo += (c2[0] - zz.lo) * 0.3
          zz.hi += (c2[1] - zz.hi) * 0.3
          zz.c = (zz.lo + zz.hi) / 2
          zz.conf = Math.min(6, zz.conf + 1)
          zz.last = now
          seen.add(zz)
        } else {
          const nz = make(c2[0], c2[1], cc)
          list.push(nz)
          seen.add(nz)
        }
      }
      for (let i = list.length - 1; i >= 0; i--) {
        if (!seen.has(list[i])) list[i].conf -= 0.5
        if (list[i].conf <= 0) list.splice(i, 1)
      }
      if (list.length > 6) {
        list.sort((x, y) => y.conf - x.conf)
        list.length = 6
      }
    }
    mergeZones<HvnZone>(A.hvns, cand((t) => smv(t) > 1.7 * avg), (zlo, zhi, c) => ({
      lo: zlo,
      hi: zhi,
      c,
      conf: 1,
      born: now,
      last: now,
      touches: 0,
      in: false,
      vol: 0,
      state: 'building',
      stars: 1,
    }))
    for (const z of A.hvns) {
      z.vol = 0
      for (let t = Math.round(z.lo); t <= Math.round(z.hi); t++) z.vol += vol(t)
      const vN = Math.min(1, z.vol / (avg * Math.max(1, z.hi - z.lo) * 3.2))
      const tN = Math.min(1, (now - z.born) / 240000)
      const rN = Math.min(1, z.touches / 4)
      const cN = z.conf / 6
      z.stars = Math.max(1, Math.min(5, Math.round(1 + vN * 1.6 + tN * 1.1 + rN * 0.8 + cN * 0.8)))
    }
    mergeZones<LvnZone>(
      A.lvns,
      cand((t) => smv(t) < 0.38 * avg).filter((r) => r[0] > lo + 2 && r[1] < hi - 2),
      (zlo, zhi, c) => ({ lo: zlo, hi: zhi, c, conf: 1, born: now, last: now, touches: 0, in: false }),
    )

    const midT = this.colHistory.length ? this.colHistory[this.colHistory.length - 1].midT : poc
    for (const z of A.hvns) {
      const inside = midT >= z.lo - 1 && midT <= z.hi + 1
      if (inside && !z.in) {
        z.touches++
        z.enterTs = now
      }
      if (!inside && z.in) {
        const dwell = now - (z.enterTs || now)
        if (dwell < 5000) z.rejN = (z.rejN || 0) + 1
        else z.accN = (z.accN || 0) + 1
      }
      z.in = inside
      const rejZone = (z.rejN || 0) >= 2 && (z.rejN || 0) > (z.accN || 0)
      z.state = z.conf < 3 ? 'building' : inside && !rejZone ? 'accept' : now - z.last > 60000 ? 'aband' : rejZone ? 'reject' : 'balance'
    }
    let inLvn: LvnZone | null = null
    for (const z of A.lvns) {
      const inside = midT >= z.lo && midT <= z.hi && z.conf >= 2
      if (inside && !z.in) {
        z.touches++
        this.aucMsg(z.c, 'lvnIn')
      }
      z.in = inside
      if (inside) inLvn = z
    }
    A.inLvnNow = !!inLvn

    A.pocHist.push({ ts: now, poc })
    while (A.pocHist.length && now - A.pocHist[0].ts > 90000) A.pocHist.shift()
    const old = A.pocHist[0]
    const mig: Migration = old && now - old.ts > 45000 ? (poc - old.poc > 2 ? 'up' : poc - old.poc < -2 ? 'down' : 'bal') : A.migration
    if (mig !== A.migration) {
      A.migration = mig
      if (mig !== 'bal') this.aucMsg(poc, mig === 'up' ? 'migUp' : 'migDn')
    }
    if (A.pocPrev !== poc) {
      A.pocBorn = now
      A.pocPrev = poc
    }
    A.poc = poc
    A.pocV = pocV
    A.pocStrength = Math.round(
      Math.min(
        100,
        55 * Math.min(1, pocV / (4.5 * avg)) + 30 * Math.max(0, Math.min(1, pocV / Math.max(1, second) - 1)) + 15 * Math.min(1, (now - (A.pocBorn || now)) / 120000),
      ),
    )
    const ps: AuctionState['pocState'] = Math.abs(midT - poc) <= 2 ? 'test' : midT > poc ? 'above' : 'below'
    if (ps !== A.pocState) {
      A.pocState = ps
      if (ps === 'test') this.aucMsg(poc, 'pocTest')
    }

    // Zones d'inefficacité — équivalent réduit de `this.cols` côté web (colHistory ne garde que
    // les ~20 dernières colonnes, largement assez pour ces deux fenêtres de 10-15 colonnes).
    if (this.colHistory.length > 12) {
      const cN = this.colHistory[this.colHistory.length - 1]
      const cO = this.colHistory[this.colHistory.length - 11]
      const dT = cN.midT - cO.midT
      if (Math.abs(dT) >= 7) {
        const a3 = Math.min(cN.midT, cO.midT) + 1
        const b3 = Math.max(cN.midT, cO.midT) - 1
        let vz = 0
        for (let t = Math.ceil(a3); t <= Math.floor(b3); t++) vz += vol(t)
        if (vz / Math.max(1, b3 - a3) < 0.45 * avg) {
          const ex = A.ineff.find((z) => Math.min(z.hi, b3) - Math.max(z.lo, a3) > 0)
          if (!ex) {
            A.ineff.push({ lo: a3, hi: b3, dir: dT > 0 ? 1 : -1, born: now, fillLo: null, fillHi: null, state: 0, done: 0 })
            if (A.ineff.length > 4) A.ineff.shift()
            this.aucMsg((a3 + b3) / 2, 'ineffNew')
          }
        }
      }
      for (let i = A.ineff.length - 1; i >= 0; i--) {
        const z = A.ineff[i]
        if (now - z.born < 4000) continue
        if (midT >= z.lo && midT <= z.hi) {
          z.fillLo = z.fillLo === null ? midT : Math.min(z.fillLo, midT)
          z.fillHi = z.fillHi === null ? midT : Math.max(z.fillHi, midT)
        }
        const fr = z.fillLo === null ? 0 : (z.fillHi! - z.fillLo) / Math.max(1, z.hi - z.lo)
        const st2: 0 | 1 | 2 = fr > 0.85 ? 2 : fr > 0.2 ? 1 : 0
        if (st2 !== z.state) {
          z.state = st2
          if (st2 === 2) {
            z.done = now
            this.aucMsg((z.lo + z.hi) / 2, 'ineffFill')
          }
        }
        if (z.done && now - z.done > 60000) A.ineff.splice(i, 1)
      }
    }

    const s = this.lastSummary

    // Projection de destination : en sortie de LVN, le prochain HVN dans le sens du mouvement
    // devient l'aimant logique — obstacle = premier mur du carnet entre le prix et la destination.
    A.dest = null
    if (inLvn && this.colHistory.length > 16) {
      const n = this.colHistory.length
      const dir = (Math.sign(this.colHistory[n - 1].midT - this.colHistory[n - 15].midT) || 1) as 1 | -1
      let best: HvnZone | null = null
      for (const z of A.hvns) {
        if (z.conf < 2) continue
        if (dir > 0 && z.lo > midT && (!best || z.lo < best.lo)) best = z
        if (dir < 0 && z.hi < midT && (!best || z.hi > best.hi)) best = z
      }
      if (best) {
        let obst: { t: number; size: number } | null = null
        if (s) {
          const wl = dir > 0 ? s.wallsAbove : s.wallsBelow
          if (wl.length) {
            const wp = parseFloat(wl[0].price) / this.instrument.tick
            if ((dir > 0 && wp < best.c) || (dir < 0 && wp > best.c)) obst = { t: wp, size: wl[0].size }
          }
        }
        A.dest = { t: best.c, dir, dist: Math.abs(Math.round(best.c - midT)), obst, from: dir > 0 ? inLvn.lo : inLvn.hi }
      }
    }

    // Timeline d'événements structurels.
    const tlPush = (key: string) => {
      const lastEv = A!.tl[A!.tl.length - 1]
      if (lastEv && lastEv.key === key && now - lastEv.ts < 30000) return
      A!.tl.push({ ts: now, key, time: new Date().toTimeString().slice(0, 5) })
      if (A!.tl.length > 7) A!.tl.shift()
    }
    if (A.inLvnNow && !A.wasLvn) tlPush('lvnIn')
    A.wasLvn = A.inLvnNow
    if (A.pocState === 'test' && A.psPrev !== 'test') tlPush('pocTest')
    A.psPrev = A.pocState
    if (A.migration !== A.migPrev && A.migration !== 'bal') tlPush(A.migration === 'up' ? 'migUp' : 'migDn')
    A.migPrev = A.migration

    // Détecteur de contradiction : flux court terme vs CVD de session.
    A.contra = null
    if (s) {
      const cvdS = this.lastCvd
      if (s.control === 'sellers' && cvdS > 0) A.contra = 'contraSell'
      else if (s.control === 'buyers' && cvdS < 0) A.contra = 'contraBuy'
    }

    // Score de confluence — composition interne, jamais présenté comme une probabilité de gain.
    let score = 35
    const parts: [string, string][] = []
    if (inLvn) {
      score += 15
      parts.push(['Active LVN', '+15'])
    }
    if (A.dest) {
      score += 12
      parts.push(['HVN destination', '+12'])
    }
    if (s) {
      const mv = s.move30ticks || 0
      const d30 = s.delta30 || 0
      if (Math.abs(d30) > 15) {
        score += 10
        parts.push(['Directional delta', '+10'])
      }
      if ((mv > 0 && this.lastCvd > 0) || (mv < 0 && this.lastCvd < 0)) {
        score += 9
        parts.push(['CVD aligned', '+9'])
      }
      if ((A.migration === 'up' && mv > 0) || (A.migration === 'down' && mv < 0)) {
        score += 8
        parts.push(['Migration aligned', '+8'])
      }
      if ((mv > 0 && s.wallsAbove.length) || (mv < 0 && s.wallsBelow.length)) {
        score -= 8
        parts.push(['Wall in the path', '−8'])
      }
    }
    A.conf = { score: Math.max(0, Math.min(100, score)), parts }

    // Lecture institutionnelle : qui contrôle, probabilités, risques, prochain niveau.
    const stats = this.lastSessionStats
    const prs = this.lastPressureScore
    const cvdN = Math.max(-1, Math.min(1, this.lastCvd / Math.max(60, (stats?.vol ?? 0) * 0.08)))
    let buy = 50 + prs * 0.22 + cvdN * 14
    if (s) buy += s.control === 'buyers' ? 8 : s.control === 'sellers' ? -8 : 0
    A.buyPct = Math.max(5, Math.min(95, Math.round(buy)))
    A.dayGauge = Math.max(
      -100,
      Math.min(
        100,
        Math.round(
          cvdN * 70 + (stats?.openPrice && stats?.price ? Math.max(-30, Math.min(30, (stats.price - stats.openPrice) / this.instrument.tick)) : 0),
        ),
      ),
    )
    const agree = (Math.sign(A.buyPct - 50) === Math.sign(A.dayGauge || 1) ? 22 : 0) + (A.contra ? -14 : 8)
    A.mktConf = Math.max(5, Math.min(98, Math.round(A.conf.score * 0.5 + Math.abs(A.buyPct - 50) * 0.9 + agree)))
    const bias = (A.buyPct - 50) / 50
    A.pCont = Math.max(20, Math.min(80, Math.round(50 + bias * 28 + (A.dest ? 5 : 0))))
    const ctl: 'buyers' | 'sellers' | 'rot' = A.buyPct >= 58 ? 'buyers' : A.buyPct <= 42 ? 'sellers' : 'rot'
    if (ctl !== A.ctlPrev) {
      A.ctlPrev = ctl
      const lastC = A.ctlTl[A.ctlTl.length - 1]
      if (!lastC || now - lastC.ts > 45000) {
        A.ctlTl.push({ ts: now, key: ctl, time: new Date().toTimeString().slice(0, 5) })
        if (A.ctlTl.length > 5) A.ctlTl.shift()
      }
    }
    A.ctl = ctl
    const rk: [string, string][] = []
    if (A.contra) rk.push(['w', 'rkCvd'])
    if (s && ((ctl === 'buyers' && s.wallsAbove.length) || (ctl === 'sellers' && s.wallsBelow.length))) rk.push(['w', 'rkWall'])
    if (A.inLvnNow) rk.push(['w', 'rkThin'])
    if (A.migration === 'up') rk.push(['g', 'okMigUp'])
    else if (A.migration === 'down') rk.push(['w', 'rkMigDn'])
    if (A.pocState === 'test') rk.push(['g', 'okPoc'])
    A.risks = rk.slice(0, 5)
    const candL: { t: number; key: string; stars: number }[] = []
    if (A.poc) candL.push({ t: A.poc, key: 'POC', stars: Math.max(1, Math.min(5, Math.round(A.pocStrength / 20))) })
    if (s && s.wallsAbove.length) candL.push({ t: parseFloat(s.wallsAbove[0].price) / this.instrument.tick, key: 'WALL', stars: 4 })
    if (s && s.wallsBelow.length) candL.push({ t: parseFloat(s.wallsBelow[0].price) / this.instrument.tick, key: 'WALL', stars: 4 })
    for (const z of A.hvns) if (z.conf >= 2) candL.push({ t: midT > z.c ? z.hi : z.lo, key: 'HVN', stars: z.stars || 3 })
    let bestL: { t: number; key: string; stars: number; d: number } | null = null
    for (const L of candL) {
      const dL = Math.abs(L.t - midT)
      if (dL > 0.5 && (!bestL || dL < bestL.d)) bestL = { t: L.t, key: L.key, stars: L.stars, d: dL }
    }
    A.nextLvl = bestL
    A.sumKey = ctl === 'rot' ? 'sumRot' : ctl === 'buyers' ? (A.dayGauge < -10 ? 'sumBuyVsDay' : 'sumBuy') : A.dayGauge > 10 ? 'sumSellVsDay' : 'sumSell'

    // activeZone : voir le commentaire de section plus haut — règle simplifiée (premier HVN, puis
    // à défaut premier LVN, où le prix se trouve actuellement), équivalente en pratique à la
    // référence pour ce que la carte AUCTION ASSISTANT en fait (une seule ligne "ZONE").
    A.activeZone = null
    for (const z of A.hvns) {
      if (z.in && z.conf >= 2) {
        A.activeZone = { lvn: false, state: z.state }
        break
      }
    }
    if (!A.activeZone) {
      for (const z of A.lvns) {
        if (z.in && z.conf >= 2) {
          A.activeZone = { lvn: true, state: 'building' }
          break
        }
      }
    }
  }

  getFrame(): LensFrame {
    return {
      image: this.buf ? this.buf.makeImageSnapshot() : null,
      width: this.width,
      height: this.height,
      ribbon: this.ribbon.map((p) => Skia.Point(p.x, p.y)),
      profileImage: this.profileBuf ? this.profileBuf.makeImageSnapshot() : null,
      profileWidth: PROFILE_W,
    }
  }

  getViewport(): LensViewport | null {
    if (!this.width || !this.height) return null
    const rows = Math.min(MAX_HEATMAP_ROWS, Math.floor(this.height / this.rowH))
    if (rows <= 0) return null
    return {
      width: this.width,
      height: this.height,
      rowH: this.rowH,
      rows,
      half: rows >> 1,
      center: this.viewCenter(),
    }
  }

  projectPrice(price: number): number | null {
    const viewport = this.getViewport()
    if (!viewport) return null
    const tick = Math.round(price / this.instrument.tick)
    return (viewport.half - (tick - viewport.center)) * viewport.rowH
  }
}
