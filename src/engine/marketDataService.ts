import type { BookLevel, BookSnapshot, Instrument, NewsItem, ServiceStatus, Side, Trade } from './types'

type Listener<T> = (payload: T) => void

interface EventMap {
  book: BookSnapshot
  trade: Trade
  service: ServiceStatus
  news: NewsItem
}

interface NewsCatalogEntry {
  cat: string
  title: string
  imp: 'low' | 'med' | 'high'
  unit?: string
  exp?: [number, number]
}

/** Calendrier macro simulé — indépendant du mode SIM/LIVE (aucune vraie donnée de news n'est
 * câblée ; c'est un contexte de trading, pas un flux Databento). */
const NEWS_CATALOG: NewsCatalogEntry[] = [
  { cat: 'FED', title: 'Fed speaker remarks', imp: 'med' },
  { cat: 'CPI', title: 'CPI YoY', imp: 'high', unit: '%', exp: [2.6, 3.4] },
  { cat: 'PPI', title: 'PPI MoM', imp: 'med', unit: '%', exp: [0.0, 0.5] },
  { cat: 'NFP', title: 'Nonfarm Payrolls', imp: 'high', unit: 'K', exp: [140, 220] },
  { cat: 'CLAIMS', title: 'Initial Jobless Claims', imp: 'med', unit: 'K', exp: [210, 250] },
  { cat: 'PMI', title: 'ISM Manufacturing PMI', imp: 'med', unit: '', exp: [47, 53] },
  { cat: 'EIA', title: 'Crude Oil Inventories', imp: 'med', unit: 'M', exp: [-3, 3] },
  { cat: 'BONDS', title: '10Y auction tails', imp: 'low' },
  { cat: 'GEO', title: 'Geopolitical headline', imp: 'high' },
]

/**
 * Flux de marché — port depuis le terminal web (TERMINAL/app/terminal-v2/engine/
 * marketDataService.ts). Seule différence volontaire par rapport à l'original : les deux usages
 * de `performance.now()` (mesure du débit de la simulation, non comparés aux timestamps du flux
 * marché) sont remplacés par `Date.now()` — Hermes/React Native n'expose pas forcément
 * `performance.now()` selon la version, alors que `Date.now()` est garanti partout. `WebSocket`
 * est en revanche un global natif de React Native (pas de polyfill nécessaire), donc le
 * transport LIVE est inchangé.
 *
 * Deux transports, même interface publique (on/off/connect/disconnect/setSpeed/setPaused) :
 *
 *  - LIVE : si `wsUrl` est fourni. Se connecte à server/src/wsHub.js (`${wsUrl}?symbol=CODE`),
 *    reconnexion avec backoff exponentiel (1s→30s) si la socket tombe, changement d'instrument
 *    par simple message `{"type":"subscribe","symbol":...}` sur la même connexion (pas de
 *    nouveau handshake) — voir server/README.md pour le contrat exact des messages
 *    `status`/`trade`/`book`/`service`.
 *  - SIM : repli si `wsUrl` est absent. Aucun appel réseau.
 *
 * setSpeed()/setPaused() ne pilotent que la simulation — un flux réel ne se met pas en pause ni
 * en accéléré ; ils sont no-op en mode live.
 */
export class MarketDataService {
  private listeners: { [K in keyof EventMap]: Set<Listener<EventMap[K]>> } = {
    book: new Set(),
    trade: new Set(),
    service: new Set(),
    news: new Set(),
  }

  private updatesPerSec: number
  private wsUrl: string | null
  private forceSim = false

  constructor(opts: { updatesPerSec?: number; wsUrl?: string | null } = {}) {
    this.updatesPerSec = opts.updatesPerSec ?? 200
    this.wsUrl = opts.wsUrl || null
  }

  on<K extends keyof EventMap>(event: K, cb: Listener<EventMap[K]>): this {
    this.listeners[event].add(cb)
    return this
  }

  off<K extends keyof EventMap>(event: K, cb: Listener<EventMap[K]>): this {
    this.listeners[event].delete(cb)
    return this
  }

  private emit<K extends keyof EventMap>(event: K, payload: EventMap[K]) {
    for (const cb of this.listeners[event]) cb(payload)
  }

  connect(instrument: Instrument) {
    this.instrument = instrument
    // instrument.live=false = code hors DEFAULT_SYMBOL_TABLE côté backend (catalogue étendu,
    // voir instruments.ts) : même si wsUrl est configurée, ces instruments n'ont jamais de
    // données live à recevoir — sans ce garde-fou, la connexion reste bloquée en CONNECTING
    // indéfiniment au lieu de retomber en simulation. `forceSim` permet en plus de basculer
    // manuellement en simulation même sur un instrument live.
    if (this.wsUrl && instrument.live && !this.forceSim) {
      this.stopSim()
      this.closedByClient = false
      this.wsSymbol = instrument.code
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.liveMode = 'CONNECTING'
        this.emitLiveStatus()
        this.sendSubscribe(instrument.code)
      } else if (!this.wsConnecting) {
        this.openLiveSocket(instrument.code)
      }
    } else {
      this.closeLiveSocket()
      this.startSim(instrument)
    }
    this.scheduleNews()
  }

  /** Arrêt complet — à n'appeler qu'au vrai démontage du provider, pas à chaque changement d'instrument. */
  disconnect() {
    this.closedByClient = true
    this.stopSim()
    this.closeLiveSocket()
    if (this.newsTimer) clearTimeout(this.newsTimer)
    if (this.newsReleaseTimer) clearTimeout(this.newsReleaseTimer)
  }

  // ---- Calendrier macro simulé (indépendant SIM/LIVE) ------------------------

  private newsTimer: ReturnType<typeof setTimeout> | null = null
  private newsReleaseTimer: ReturnType<typeof setTimeout> | null = null

  private scheduleNews() {
    if (this.newsTimer) clearTimeout(this.newsTimer)
    this.newsTimer = setTimeout(
      () => {
        this.fireNews()
        this.scheduleNews()
      },
      60000 + Math.random() * 120000,
    )
  }

  /** Déclenche immédiatement une news à fort impact. */
  fireNewsShock() {
    this.fireNews(true)
  }

  private fireNews(forceHigh = false) {
    const pool = forceHigh ? NEWS_CATALOG.filter((n) => n.imp === 'high') : NEWS_CATALOG
    const c = pool[Math.floor(Math.random() * pool.length)]
    this.emit('news', { cat: c.cat, title: c.title, imp: c.imp, phase: 'upcoming', time: new Date().toTimeString().slice(0, 8) })
    if (this.newsReleaseTimer) clearTimeout(this.newsReleaseTimer)
    this.newsReleaseTimer = setTimeout(() => {
      let expected = ''
      let actual = ''
      let deviation = 0
      if (c.exp) {
        const e = c.exp[0] + Math.random() * (c.exp[1] - c.exp[0])
        const a = e + (Math.random() - 0.5) * (c.exp[1] - c.exp[0]) * 0.7
        expected = e.toFixed(1) + (c.unit ?? '')
        actual = a.toFixed(1) + (c.unit ?? '')
        deviation = +(a - e).toFixed(2)
      }
      this.emit('news', { cat: c.cat, title: c.title, imp: c.imp, phase: 'release', time: new Date().toTimeString().slice(0, 8), expected, actual, deviation })
    }, 15000)
  }

  setSpeed(n: number) {
    this.speed = n
  }

  setPaused(p: boolean) {
    this.paused = p
  }

  /**
   * Force le repli simulation même sur un instrument live — reconnecte immédiatement avec le
   * nouvel état si un instrument est déjà actif.
   */
  setForceSim(on: boolean) {
    this.forceSim = on
    if (this.instrument) this.connect(this.instrument)
  }

  /**
   * Scénarios de simulation — déclenche un effet transitoire sur le moteur SIM interne (voir
   * tick()) : mur/iceberg/spoof injecté dans le carnet, sweep forcé, ou biais de tendance/
   * volatilité temporaire. No-op en mode LIVE — retourne false dans ce cas.
   */
  command(name: string): boolean {
    if (this.wsUrl && this.instrument?.live && !this.forceSim) return false
    if (!this.instrument) return false
    const lot = this.instrument.lot
    const tick = this.instrument.tick
    const side = Math.random() < 0.5 ? -1 : 1
    const now = Date.now()
    const place = (off: number, size: number, life: number) => {
      const t = Math.round(this.mid / tick) + off
      this.walls.push({ t, size, life })
      if (this.walls.length > 8) this.walls.shift()
    }
    switch (name) {
      case 'sweepUp':
        this.sweep = { dir: 1, until: now + 900 }
        return true
      case 'sweepDown':
        this.sweep = { dir: -1, until: now + 900 }
        return true
      case 'iceberg':
        place(side * (2 + Math.floor(Math.random() * 4)), 26 * lot, 14000)
        return true
      case 'spoof':
        place(side * (4 + Math.floor(Math.random() * 5)), 90 * lot, 6000)
        return true
      case 'wall':
        place(side * (5 + Math.floor(Math.random() * 8)), 140 * lot, 40000)
        return true
      case 'absorption': {
        const d: 1 | -1 = Math.random() < 0.5 ? 1 : -1
        place(d * 3, 160 * lot, 20000)
        this.sweep = { dir: d, until: now + 900 }
        return true
      }
      case 'volUp':
        this.volMult = 2.4
        this.volMultUntil = now + 6000
        return true
      case 'volDown':
        this.volMult = 0.3
        this.volMultUntil = now + 6000
        return true
      case 'trendUp':
        this.regimeBoost = 0.35
        this.regimeUntil = now + 6000
        return true
      case 'trendDown':
        this.regimeBoost = -0.35
        this.regimeUntil = now + 6000
        return true
      case 'chop':
        this.regimeBoost = 0
        this.driftBias = 0
        this.regimeUntil = now + 6000
        return true
      default:
        return false
    }
  }

  // ---- Transport live (server/src/wsHub.js) --------------------------------

  private instrument: Instrument | null = null
  private ws: WebSocket | null = null
  private wsSymbol: string | null = null
  private wsConnecting = false
  private closedByClient = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private liveMode: ServiceStatus['mode'] = 'CONNECTING'
  private liveRate = 0
  private liveLatency = 0

  private openLiveSocket(symbol: string) {
    if (!this.wsUrl) return
    this.wsConnecting = true
    this.liveMode = 'CONNECTING'
    this.emitLiveStatus()
    const sep = this.wsUrl.includes('?') ? '&' : '?'
    let socket: WebSocket
    try {
      socket = new WebSocket(`${this.wsUrl}${sep}symbol=${encodeURIComponent(symbol)}`)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = socket
    socket.addEventListener('open', () => {
      this.wsConnecting = false
      this.reconnectDelay = 1000
    })
    socket.addEventListener('message', (ev) => this.handleLiveMessage(String(ev.data)))
    socket.addEventListener('close', () => {
      this.ws = null
      this.wsConnecting = false
      if (!this.closedByClient) this.scheduleReconnect()
    })
    // 'close' suit toujours 'error' sur WebSocket — la reconnexion est gérée par le handler close ci-dessus.
    socket.addEventListener('error', () => {})
  }

  private scheduleReconnect() {
    if (this.closedByClient || !this.wsSymbol || this.reconnectTimer) return
    this.liveMode = 'RECONNECTING'
    this.emitLiveStatus()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.closedByClient && this.wsSymbol) this.openLiveSocket(this.wsSymbol)
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(30000, this.reconnectDelay * 2)
  }

  private closeLiveSocket() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.wsConnecting = false
    this.reconnectDelay = 1000
  }

  private sendSubscribe(symbol: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', symbol }))
    }
    // Sinon : envoyé par openLiveSocket() lui-même via ?symbol=... à l'ouverture — voir connect().
  }

  private handleLiveMessage(raw: string) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    // Ignore les messages en vol pour un symbole qu'on vient de quitter (race lors d'un
    // changement d'instrument sur la même connexion) — les messages "service" n'ont pas de
    // champ "symbol" (broadcast global) et passent toujours.
    if (typeof msg.symbol === 'string' && msg.symbol !== this.wsSymbol) return

    if (msg.type === 'trade') {
      const side: Side = msg.side === 'buy' ? 'B' : msg.side === 'sell' ? 'S' : 'B'
      this.emit('trade', { price: Number(msg.price), size: Number(msg.size), side, ts: Number(msg.timestamp) })
    } else if (msg.type === 'book') {
      // Backend peut envoyer un carnet vide/à sens unique (feed thin, ex. contrats Micro) —
      // tous les consommateurs (AnalysisEngine/PressureEngine) supposent bids[0]/asks[0] non
      // vides ; on ignore le tick plutôt que de propager un snapshot invalide.
      const bids = msg.bids as [number, number][] | undefined
      const asks = msg.asks as [number, number][] | undefined
      if (!bids?.length || !asks?.length) return
      this.emit('book', { bids, asks, ts: Number(msg.timestamp) })
    } else if (msg.type === 'status') {
      this.liveMode = msg.status === 'live' ? 'LIVE' : msg.status === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING'
      this.emitLiveStatus()
    } else if (msg.type === 'service') {
      this.liveRate = Number(msg.rate ?? 0)
      this.liveLatency = Number(msg.latencyMs ?? 0)
      this.emitLiveStatus()
    }
  }

  private emitLiveStatus() {
    this.emit('service', {
      mode: this.liveMode,
      rate: this.liveRate,
      latencyMs: this.liveLatency,
      bufferSec: 0,
      replaying: false,
      progress: 0,
    })
  }

  // ---- Simulation interne --------------------------------------------------

  private speed = 1
  private paused = false
  // État des scénarios de simulation déclenchables via command().
  private walls: { t: number; size: number; life: number }[] = []
  private sweep: { dir: 1 | -1; until: number } | null = null
  private regimeBoost = 0
  private regimeUntil = 0
  private volMult = 1
  private volMultUntil = 0
  private simTimer: ReturnType<typeof setInterval> | null = null
  private simStatusTimer: ReturnType<typeof setInterval> | null = null
  private mid = 0
  private bids: [number, number][] = []
  private asks: [number, number][] = []
  private lastMsgCount = 0
  private rateWindowStart = Date.now()

  private startSim(instrument: Instrument) {
    this.stopSim()
    this.mid = instrument.base
    this.seedBook()

    const baseIntervalMs = 1000 / this.updatesPerSec
    this.simTimer = setInterval(() => {
      if (this.paused) return
      const steps = Math.max(1, Math.round(this.speed))
      for (let i = 0; i < steps; i++) this.tick()
    }, baseIntervalMs)

    this.simStatusTimer = setInterval(() => this.emitSimStatus(), 500)
    this.emitSimStatus()
  }

  private stopSim() {
    if (this.simTimer) clearInterval(this.simTimer)
    if (this.simStatusTimer) clearInterval(this.simStatusTimer)
    this.simTimer = null
    this.simStatusTimer = null
  }

  // Profondeur du carnet simulé — 20 niveaux par côté.
  private static readonly BOOK_DEPTH = 20

  private seedBook() {
    if (!this.instrument) return
    const { tick } = this.instrument
    this.bids = []
    this.asks = []
    for (let i = 0; i < MarketDataService.BOOK_DEPTH; i++) {
      this.bids.push([this.round(this.mid - (i + 1) * tick), this.randSize()])
      this.asks.push([this.round(this.mid + (i + 1) * tick), this.randSize()])
    }
  }

  // Distribution du bruit de carnet ambiant — resserrée pour que le heatmap reste
  // majoritairement dans les tons froids (gris/bleu/cyan/vert), avec des murs chauds
  // occasionnels plutôt que des plages orange/rouge dominantes en continu. Les tailles
  // injectées par les Simulation Scenarios (wall/spoof/iceberg) restent volontairement
  // spectaculaires — seul le bruit par défaut est recalibré ici.
  private randSize(): number {
    const r = Math.random()
    if (r > 0.99) return Math.round(45 + Math.random() * 105) // mur institutionnel occasionnel
    if (r > 0.94) return Math.round(16 + Math.random() * 29)
    return Math.round(2 + Math.random() * 14)
  }

  private round(p: number): number {
    if (!this.instrument) return p
    const t = this.instrument.tick
    return Math.round(p / t) * t
  }

  private tick() {
    if (!this.instrument) return
    const { tick } = this.instrument
    const now = Date.now()

    if (this.regimeUntil && now > this.regimeUntil) {
      this.regimeBoost = 0
      this.regimeUntil = 0
    }
    if (this.volMultUntil && now > this.volMultUntil) {
      this.volMult = 1
      this.volMultUntil = 0
    }
    const sweepActive = this.sweep !== null && now < this.sweep.until
    if (this.sweep && now >= this.sweep.until) this.sweep = null
    if (this.walls.length) {
      for (let i = this.walls.length - 1; i >= 0; i--) {
        this.walls[i].life -= 1000 / this.updatesPerSec
        if (this.walls[i].life <= 0) this.walls.splice(i, 1)
      }
    }

    // Marche aléatoire légèrement corrélée à un biais de flux (drift lent) + biais de régime
    // temporaire (trendUp/trendDown/chop, voir command()). Un sweep actif force la direction.
    this.driftBias = (this.driftBias ?? 0) * 0.985 + (Math.random() - 0.5) * 0.06 + this.regimeBoost * 0.02
    if (sweepActive) {
      this.mid = this.round(this.mid + (this.sweep!.dir > 0 ? tick : -tick))
    } else if (Math.random() < 0.5 + this.driftBias * 0.3) {
      this.mid = this.round(this.mid + tick)
    } else {
      this.mid = this.round(this.mid - tick)
    }

    // Renouvelle une partie des niveaux à chaque tick pour donner un carnet vivant — sauf les
    // niveaux couverts par un mur injecté (iceberg/spoof/wall/absorption), qui convergent vers
    // la taille du mur plutôt que vers une taille aléatoire.
    const wallAt = (t: number) => this.walls.find((w) => w.t === t)
    for (let i = 0; i < this.bids.length; i++) {
      const t = Math.round((this.mid - (i + 1) * tick) / tick)
      const p = this.round(this.mid - (i + 1) * tick)
      const w = wallAt(t)
      if (w) {
        const prevSize = this.bids[i][1]
        this.bids[i] = [p, Math.max(1, Math.round(prevSize + (w.size - prevSize) * 0.3))]
        continue
      }
      const prevSize = this.bids[i][1]
      const decay = Math.random() < 0.12
      this.bids[i] = [p, decay ? this.randSize() : Math.max(1, Math.round(prevSize * (0.9 + Math.random() * 0.22)))]
    }
    for (let i = 0; i < this.asks.length; i++) {
      const t = Math.round((this.mid + (i + 1) * tick) / tick)
      const p = this.round(this.mid + (i + 1) * tick)
      const w = wallAt(t)
      if (w) {
        const prevSize = this.asks[i][1]
        this.asks[i] = [p, Math.max(1, Math.round(prevSize + (w.size - prevSize) * 0.3))]
        continue
      }
      const prevSize = this.asks[i][1]
      const decay = Math.random() < 0.12
      this.asks[i] = [p, decay ? this.randSize() : Math.max(1, Math.round(prevSize * (0.9 + Math.random() * 0.22)))]
    }

    const book: BookSnapshot = { bids: [...this.bids], asks: [...this.asks], ts: now }
    this.emit('book', book)
    this.lastMsgCount++

    // Trades : cadence plus faible que les mises à jour de carnet, biaisée par le drift ; un
    // sweep actif force une tape agressive et volumineuse dans sa direction (volUp/volDown
    // modulent simplement la cadence de base).
    const tradeProb = sweepActive ? 0.92 : 0.35 * this.volMult
    if (Math.random() < tradeProb) {
      const side: Side = sweepActive ? (this.sweep!.dir > 0 ? 'B' : 'S') : Math.random() < 0.5 + this.driftBias * 0.4 ? 'B' : 'S'
      const price = side === 'B' ? this.asks[0][0] : this.bids[0][0]
      const size = sweepActive
        ? Math.round((25 + Math.random() * 90) * this.instrument.lot)
        : Math.random() > 0.985
          ? Math.round(40 + Math.random() * 150)
          : Math.round(1 + Math.random() * 14)
      const trade: Trade = { price, size, side, ts: now }
      this.emit('trade', trade)
      this.lastMsgCount++
    }
  }

  private driftBias = 0

  private emitSimStatus() {
    const now = Date.now()
    const elapsedS = (now - this.rateWindowStart) / 1000
    const rate = elapsedS > 0 ? Math.round(this.lastMsgCount / elapsedS) : 0
    this.lastMsgCount = 0
    this.rateWindowStart = now
    this.emit('service', {
      mode: 'SIM',
      rate,
      latencyMs: 1,
      bufferSec: 0,
      replaying: false,
      progress: 0,
    })
  }
}

export interface WallLevel {
  price: string
  size: number
}

export interface AnalysisSummary {
  control: 'contested' | 'buyers' | 'sellers'
  oneSided: boolean
  delta30: number
  vol30: number
  move30ticks: number
  tradeRate: number
  price: number
  wallsAbove: WallLevel[]
  wallsBelow: WallLevel[]
}

export interface SessionStats {
  price: number
  priceUp: boolean
  sessionDelta: number
  cvd: number
  vwap: number
  vol: number
  openPrice: number
  sessionHi: number
  sessionLo: number
  buyVol: number
  sellVol: number
  blockCount: number
  /** Open interest — simulé (aucun vrai flux OI n'est câblé) : seedé à la connexion, puis marche
   * aléatoire corrélée à la taille de chaque trade (voir onTrade()). Purement indicatif, ne
   * doit jamais être présenté comme une donnée de marché réelle. */
  oi: number
  oiOpen: number
}

export type PollEventType =
  | 'WALL'
  | 'SPOOF'
  | 'ICEBERG'
  | 'ABSORPTION'
  | 'SWEEP'
  | 'BUY PRESSURE'
  | 'SELL PRESSURE'
  | 'ACCELERATION'
  | 'SLOWDOWN'
  | 'BOOK IMBALANCE'
  | 'BREAKOUT'
  | 'FAKE BREAKOUT'
  | 'REGIME CHANGE'

export type PollImportance = 'low' | 'med' | 'high'

export interface PollEvent {
  id: number
  ts: number
  type: PollEventType
  price: number
  score: number
  importance: PollImportance
  expl: string
}

export interface EventCounts {
  sweep: number
  abs: number
  spoof: number
  ice: number
  wall: number
  alerts: number
}

export interface LiquidityLevels {
  avg: number
  target: { price: number; size: number; distTicks: number } | null
  largest: { price: number; size: number } | null
  largestBid: { price: number; size: number } | null
  largestAsk: { price: number; size: number } | null
}

interface LevelRecord {
  size: number
  maxSize: number
  traded: number
  tradedAtMax: number
  dwellStart: number
  tradedAtDwell: number
  wallSeen: boolean
  lastIce: number
  lastAbs: number
}

/**
 * Analyse incrémentale du flux (delta cumulé, taille moyenne des trades, historique court).
 * summary() calcule un instantané lisible par un narrateur (règles ou IA) à partir des mêmes
 * champs bruts que consomment déjà les autres modules (avgSize, trades) plus le carnet le plus
 * récent — volontairement plus simple que PressureEngine (pas de détection d'événements, pas de
 * multi-timeframe) : c'est un résumé de contexte, pas un moteur de scoring.
 */
export class AnalysisEngine {
  readonly instrument: Instrument
  private tradeSizes: number[] = []
  private trades: Trade[] = []
  private priceHist: { ts: number; price: number }[] = []
  private latestBook: BookSnapshot | null = null
  private _cvd = 0
  private vwapPV = 0
  private vwapV = 0
  private openPrice = 0
  private lastPrice = 0
  private lastUpTick = true
  private sesHi = -Infinity
  private sesLo = Infinity
  private buyVol = 0
  private sellVol = 0
  private blockCount = 0
  // Open interest — seedé une fois au premier trade de l'instance (une instance par instrument).
  private oi = 0
  private oiOpen = 0

  // ---- État dédié à poll() (détecteur d'événements SIGNALS) ------------------
  private levels = new Map<number, LevelRecord>()
  private mids: { ts: number; mid: number }[] = []
  private bookAvgSize = 1
  private thr: Record<string, number> = {}
  private pendingBreak: { dir: 1 | -1; level: number; ts: number } | null = null
  private pollEvents: PollEvent[] = []
  private pollEventSeq = 0
  private rate5Prev = 0
  private rate5Ts = 0
  private counts: EventCounts = { sweep: 0, abs: 0, spoof: 0, ice: 0, wall: 0, alerts: 0 }

  constructor(instrument: Instrument) {
    this.instrument = instrument
  }

  onBook(book: BookSnapshot) {
    this.latestBook = book
    const tick = this.instrument.tick
    const mid = (book.bids[0][0] + book.asks[0][0]) / 2
    this.mids.push({ ts: book.ts, mid })
    while (this.mids.length && book.ts - this.mids[0].ts > 150000) this.mids.shift()

    let sum = 0
    let n = 0
    const scan = (arr: readonly BookLevel[]) => {
      for (const [p, s] of arr) {
        const t = Math.round(p / tick)
        const r = this.level(t)
        r.size = s
        if (s > r.maxSize) {
          r.maxSize = s
          r.tradedAtMax = r.traded
        }
        sum += s
        n++
      }
    }
    scan(book.bids)
    scan(book.asks)
    this.bookAvgSize = Math.max(1, sum / Math.max(1, n))

    if (this.levels.size > 600) {
      const mt = Math.round(mid / tick)
      for (const k of this.levels.keys()) if (Math.abs(k - mt) > 120) this.levels.delete(k)
    }
  }

  private level(t: number): LevelRecord {
    let r = this.levels.get(t)
    if (!r) {
      r = { size: 0, maxSize: 0, traded: 0, tradedAtMax: 0, dwellStart: 0, tradedAtDwell: 0, wallSeen: false, lastIce: 0, lastAbs: 0 }
      this.levels.set(t, r)
    }
    return r
  }

  onTrade(trade: Trade) {
    this._cvd += trade.side === 'B' ? trade.size : -trade.size
    this.trades.push(trade)
    if (this.trades.length > 1200) this.trades.shift()
    this.tradeSizes.push(trade.size)
    if (this.tradeSizes.length > 300) this.tradeSizes.shift()
    this.priceHist.push({ ts: trade.ts, price: trade.price })
    if (this.priceHist.length > 1200) this.priceHist.shift()
    this.vwapPV += trade.price * trade.size
    this.vwapV += trade.size
    if (!this.openPrice) {
      this.openPrice = trade.price
      this.oi = Math.round((0.4 + this.instrument.lot) * 1400000)
      this.oiOpen = this.oi
    }
    this.lastUpTick = trade.price >= this.lastPrice
    this.lastPrice = trade.price
    if (trade.price > this.sesHi) this.sesHi = trade.price
    if (trade.price < this.sesLo) this.sesLo = trade.price
    if (trade.side === 'B') this.buyVol += trade.size
    else this.sellVol += trade.size
    if (trade.size >= 40 * this.instrument.lot) this.blockCount++
    this.oi += (Math.random() < 0.5 ? -1 : 1) * Math.round(trade.size * Math.random() * 0.8)
    this.level(Math.round(trade.price / this.instrument.tick)).traded += trade.size
  }

  /** Lecture rapide pour la top bar (prix/Δ session/CVD/VWAP/VOL) — pas de fenêtre glissante, juste un instantané cumulé depuis le connect(). */
  sessionStats(): SessionStats | null {
    if (!this.lastPrice) return null
    return {
      price: this.lastPrice,
      priceUp: this.lastUpTick,
      sessionDelta: this.lastPrice - this.openPrice,
      cvd: this._cvd,
      vwap: this.vwapV > 0 ? this.vwapPV / this.vwapV : 0,
      vol: this.vwapV,
      openPrice: this.openPrice,
      sessionHi: this.sesHi > -Infinity ? this.sesHi : this.lastPrice,
      sessionLo: this.sesLo < Infinity ? this.sesLo : this.lastPrice,
      buyVol: this.buyVol,
      sellVol: this.sellVol,
      blockCount: this.blockCount,
      oi: this.oi,
      oiOpen: this.oiOpen,
    }
  }

  get eventCounts(): EventCounts {
    return { ...this.counts }
  }

  /** Déséquilibre du carnet sur les 10 meilleurs niveaux (bid/ask). */
  bookImbalance(): number | null {
    if (!this.latestBook) return null
    let tb = 0
    let ta = 0
    for (let i = 0; i < 10; i++) {
      tb += this.latestBook.bids[i]?.[1] ?? 0
      ta += this.latestBook.asks[i]?.[1] ?? 0
    }
    return tb / Math.max(1, ta)
  }

  /** Mur le plus proche du prix (LIQUIDITY TARGET) et mur le plus gros toutes distances
   * confondues (LARGEST WALL). Réutilise `levels` (déjà maintenu par onBook()/poll()) plutôt
   * que de dupliquer un troisième relevé de carnet. */
  liquidityLevels(): LiquidityLevels {
    if (!this.latestBook) return { avg: this.bookAvgSize, target: null, largest: null, largestBid: null, largestAsk: null }
    const tick = this.instrument.tick
    const mid = (this.latestBook.bids[0][0] + this.latestBook.asks[0][0]) / 2
    const midT = Math.round(mid / tick)
    const wallTh = this.bookAvgSize * 3
    let targetT = 0
    let targetD = Infinity
    let bigT = 0
    let bigS = 0
    let bigBidT = 0
    let bigBidS = 0
    let bigAskT = 0
    let bigAskS = 0
    for (const [t, r] of this.levels) {
      if (r.size > bigS) {
        bigS = r.size
        bigT = t
      }
      if (t < midT && r.size > bigBidS) {
        bigBidS = r.size
        bigBidT = t
      }
      if (t > midT && r.size > bigAskS) {
        bigAskS = r.size
        bigAskT = t
      }
      if (r.size >= wallTh) {
        const d = Math.abs(t - midT)
        if (d < targetD) {
          targetD = d
          targetT = t
        }
      }
    }
    return {
      avg: this.bookAvgSize,
      target: targetT ? { price: targetT * tick, size: this.levels.get(targetT)!.size, distTicks: targetD } : null,
      largest: bigS ? { price: bigT * tick, size: bigS } : null,
      largestBid: bigBidS ? { price: bigBidT * tick, size: bigBidS } : null,
      largestAsk: bigAskS ? { price: bigAskT * tick, size: bigAskS } : null,
    }
  }

  private ok(key: string, ms: number, now: number): boolean {
    const last = this.thr[key]
    if (last !== undefined && now - last < ms) return false
    this.thr[key] = now
    return true
  }

  private pushPollEvent(now: number, type: PollEventType, price: number, score: number, expl: string) {
    const clamped = Math.max(20, Math.min(99, Math.round(score)))
    const importance: PollImportance = clamped > 80 ? 'high' : clamped > 55 ? 'med' : 'low'
    this.pollEvents.push({ id: ++this.pollEventSeq, ts: now, type, price, score: clamped, importance, expl })
    if (type === 'SWEEP') this.counts.sweep++
    else if (type === 'ABSORPTION') this.counts.abs++
    else if (type === 'SPOOF') this.counts.spoof++
    else if (type === 'ICEBERG') this.counts.ice++
    else if (type === 'WALL') this.counts.wall++
    this.counts.alerts++
  }

  private midAt(now: number, agoMs: number): number {
    const target = now - agoMs
    for (let i = this.mids.length - 1; i >= 0; i--) if (this.mids[i].ts <= target) return this.mids[i].mid
    return this.mids.length ? this.mids[0].mid : 0
  }

  /**
   * Détecteur d'événements microstructure (WALL/SPOOF/ICEBERG/ABSORPTION/SWEEP/BUY-SELL
   * PRESSURE/ACCELERATION/SLOWDOWN/BOOK IMBALANCE/BREAKOUT/FAKE BREAKOUT/REGIME CHANGE) —
   * alimente le panneau SIGNALS et les compteurs de session (eventCounts).
   *
   * IMPORTANT : `now` doit être Date.now() (horloge murale), même contrat que summary()/
   * PressureEngine.sample() — thr/pushPollEvent/mids comparent tous des timestamps wall-clock.
   *
   * À appeler à cadence fixe depuis un seul endroit (contexte partagé, comme
   * PressureEngine.sample()) : chaque appel VIDE les événements accumulés — un deuxième
   * appelant perdrait la moitié des événements.
   */
  poll(now: number = Date.now()): PollEvent[] {
    if (!this.latestBook) return []
    const b = this.latestBook
    const tick = this.instrument.tick
    const dec = this.instrument.dec
    const lot = this.instrument.lot
    const mid = this.mids.length ? this.mids[this.mids.length - 1].mid : (b.bids[0][0] + b.asks[0][0]) / 2
    const midT = mid / tick
    const avg = this.bookAvgSize
    const wallTh = avg * 3.4
    const fmt = (p: number) => p.toFixed(dec)

    for (const [t, r] of this.levels) {
      const price = t * tick
      const d = Math.abs(t - midT)
      if (d > 45) continue

      if (r.size > wallTh && !r.wallSeen) {
        r.wallSeen = true
        if (d < 30 && this.ok('wall' + t, 20000, now)) {
          this.pushPollEvent(now, 'WALL', price, 45 + 40 * Math.min(1, r.size / (wallTh * 2.5)), `${Math.round(r.size)} resting — ${t > midT ? 'supply overhead' : 'demand below'}, ${Math.round(d)} ticks away`)
        }
      }
      if (r.size < wallTh * 0.5) r.wallSeen = false

      if (r.maxSize > wallTh && r.size < 0.18 * r.maxSize && d <= 8) {
        const tradedSince = r.traded - r.tradedAtMax
        if (tradedSince < 0.25 * r.maxSize && this.ok('spf' + t, 9000, now)) {
          this.pushPollEvent(now, 'SPOOF', price, 60 + 35 * Math.min(1, r.maxSize / (wallTh * 2)), `${Math.round(r.maxSize)} pulled untraded as price approached — likely fake ${t > midT ? 'supply' : 'demand'}`)
        }
        r.maxSize = r.size
        r.tradedAtMax = r.traded
      }

      if (r.traded > 3 * Math.max(r.maxSize, 8 * lot) && r.maxSize < wallTh * 0.7 && r.traded > 60 * lot && d < 6 && now - r.lastIce > 10000) {
        r.lastIce = now
        this.pushPollEvent(now, 'ICEBERG', price, 55 + 40 * Math.min(1, r.traded / (r.maxSize * 8)), `${Math.round(r.traded)} filled vs ~${Math.round(r.maxSize)} shown — hidden ${t > midT ? 'seller' : 'buyer'} refreshing`)
      }

      if (d <= 2) {
        if (!r.dwellStart) {
          r.dwellStart = now
          r.tradedAtDwell = r.traded
        } else if (now - r.dwellStart > 2500) {
          const absVol = r.traded - r.tradedAtDwell
          if (absVol > 120 * lot && r.size > wallTh * 0.6 && now - r.lastAbs > 12000) {
            r.lastAbs = now
            this.pushPollEvent(now, 'ABSORPTION', price, 62 + 35 * Math.min(1, absVol / (400 * lot)), `${Math.round(absVol)} absorbed at ${fmt(price)} — passive ${t >= midT ? 'seller' : 'buyer'} holding the level`)
          }
          r.dwellStart = now
          r.tradedAtDwell = r.traded
        }
      } else {
        r.dwellStart = 0
      }
    }

    const w700 = this.trades.filter((t) => now - t.ts < 700)
    let bv = 0
    let sv = 0
    for (const t of w700) (t.side === 'B' ? (bv += t.size) : (sv += t.size))
    const move = (mid - this.midAt(now, 700)) / tick
    if (Math.abs(move) >= 4 && this.ok('sweep', 3500, now)) {
      const av = move > 0 ? bv : sv
      if (av > 80 * lot) {
        this.pushPollEvent(now, 'SWEEP', mid, 65 + 30 * Math.min(1, av / (300 * lot)), `${Math.round(av)} aggressive ${move > 0 ? 'buys swept ' : 'sells swept '}${Math.abs(Math.round(move))} ticks of book`)
      }
    }

    const w10 = this.trades.filter((t) => now - t.ts < 10000)
    let d10 = 0
    let v10 = 0
    for (const t of w10) {
      v10 += t.size
      d10 += t.side === 'B' ? t.size : -t.size
    }
    if (v10 > 150 * lot && Math.abs(d10) / v10 > 0.55 && this.ok('press', 20000, now)) {
      this.pushPollEvent(now, d10 > 0 ? 'BUY PRESSURE' : 'SELL PRESSURE', mid, 50 + 45 * (Math.abs(d10) / v10), `${Math.round(Math.abs(d10))} net ${d10 > 0 ? 'buying' : 'selling'} over 10s (${Math.round((100 * Math.abs(d10)) / v10)}% one-sided)`)
    }

    if (now - this.rate5Ts > 5000) {
      const r5 = this.trades.filter((t) => now - t.ts < 5000).length
      if (this.rate5Prev > 4) {
        const ratio = r5 / Math.max(1, this.rate5Prev)
        if (ratio > 2.4 && this.ok('accel', 15000, now)) this.pushPollEvent(now, 'ACCELERATION', mid, 45 + 30 * Math.min(1, ratio / 4), `Tape speed ×${ratio.toFixed(1)} — participation expanding`)
        if (ratio < 0.35 && r5 < 8 && this.ok('slow', 15000, now)) this.pushPollEvent(now, 'SLOWDOWN', mid, 40, `Tape drying up — ${r5} prints/5s vs ${this.rate5Prev}`)
      }
      this.rate5Prev = r5
      this.rate5Ts = now
    }

    let tb = 0
    let ta = 0
    for (let i = 0; i < 10; i++) {
      tb += b.bids[i]?.[1] ?? 0
      ta += b.asks[i]?.[1] ?? 0
    }
    const ratio = tb / Math.max(1, ta)
    if ((ratio > 2.3 || ratio < 0.43) && this.ok('imb', 18000, now)) {
      this.pushPollEvent(now, 'BOOK IMBALANCE', mid, 45 + 30 * Math.min(1, Math.abs(Math.log(ratio))), `Top-10 depth ${ratio > 1 ? ratio.toFixed(1) + ':1 bid-heavy' : (1 / ratio).toFixed(1) + ':1 ask-heavy'}`)
    }

    let hi = -Infinity
    let lo = Infinity
    for (const m of this.mids) {
      if (now - m.ts > 4000 && now - m.ts < 90000) {
        if (m.mid > hi) hi = m.mid
        if (m.mid < lo) lo = m.mid
      }
    }
    if (hi > -Infinity) {
      if (!this.pendingBreak) {
        if (mid > hi + 2 * tick && this.ok('brk', 8000, now)) {
          this.pendingBreak = { dir: 1, level: hi, ts: now }
          this.pushPollEvent(now, 'BREAKOUT', mid, 60, `Cleared 90s high ${fmt(hi)} with displacement`)
        } else if (mid < lo - 2 * tick && this.ok('brk', 8000, now)) {
          this.pendingBreak = { dir: -1, level: lo, ts: now }
          this.pushPollEvent(now, 'BREAKOUT', mid, 60, `Broke 90s low ${fmt(lo)} with displacement`)
        }
      } else {
        const pb = this.pendingBreak
        if (now - pb.ts > 12000) {
          this.pendingBreak = null
        } else if ((pb.dir > 0 && mid < pb.level - tick) || (pb.dir < 0 && mid > pb.level + tick)) {
          this.pushPollEvent(now, 'FAKE BREAKOUT', mid, 78, `${pb.dir > 0 ? 'Upside' : 'Downside'} break of ${fmt(pb.level)} failed and snapped back — trapped ${pb.dir > 0 ? 'longs' : 'shorts'}`)
          this.pendingBreak = null
        }
      }
    }

    const rv = (ms0: number, ms1: number): number | null => {
      let s = 0
      let n = 0
      let prev: number | null = null
      for (const m of this.mids) {
        if (now - m.ts > ms1 || now - m.ts < ms0) continue
        if (prev !== null) {
          const dd = (m.mid - prev) / tick
          s += dd * dd
          n++
        }
        prev = m.mid
      }
      return n > 5 ? Math.sqrt(s / n) : null
    }
    const vNow = rv(0, 30000)
    const vPrev = rv(30000, 60000)
    if (vNow !== null && vPrev !== null && vPrev > 0.02) {
      const vr = vNow / vPrev
      if ((vr > 2.2 || vr < 0.4) && this.ok('regime', 25000, now)) {
        this.pushPollEvent(
          now,
          'REGIME CHANGE',
          mid,
          55 + 25 * Math.min(1, Math.abs(Math.log(vr))),
          vr > 1 ? `Volatility expanding ×${vr.toFixed(1)} — range trading invalidated` : 'Volatility compressing — expect balance / rotation',
        )
      }
    }

    const out = this.pollEvents
    this.pollEvents = []
    return out
  }

  get avgSize(): number {
    if (!this.tradeSizes.length) return Math.max(1, this.instrument.lot)
    const sum = this.tradeSizes.reduce((a, b) => a + b, 0)
    return Math.max(1, sum / this.tradeSizes.length)
  }

  get cvd(): number {
    return this._cvd
  }

  get recentTrades(): readonly Trade[] {
    return this.trades
  }

  /**
   * IMPORTANT : `now` doit être `Date.now()` (horloge murale) — trade.ts/priceHist viennent du
   * flux marché en horloge murale (voir PressureEngine.sample() pour le même contrat).
   */
  summary(now: number = Date.now()): AnalysisSummary | null {
    if (!this.latestBook || this.trades.length < 3) return null
    const tick = this.instrument.tick
    const dec = this.instrument.dec
    const avg = this.avgSize

    let buy30 = 0
    let sell30 = 0
    for (const t of this.trades) if (now - t.ts <= 30000) (t.side === 'B' ? (buy30 += t.size) : (sell30 += t.size))
    const vol30 = buy30 + sell30
    const delta30 = buy30 - sell30

    let buy12 = 0
    let sell12 = 0
    for (const t of this.trades) if (now - t.ts <= 12000) (t.side === 'B' ? (buy12 += t.size) : (sell12 += t.size))
    const tot12 = buy12 + sell12
    const buyRatio = tot12 ? buy12 / tot12 : 0.5
    const hasFlow = tot12 >= avg * 3
    const control: AnalysisSummary['control'] = !hasFlow ? 'contested' : buyRatio > 0.6 ? 'buyers' : buyRatio < 0.4 ? 'sellers' : 'contested'
    const oneSided = hasFlow && (buyRatio > 0.78 || buyRatio < 0.22)

    const priceNow = this.priceHist.length ? this.priceHist[this.priceHist.length - 1].price : (this.latestBook.bids[0][0] + this.latestBook.asks[0][0]) / 2
    let priceThen = priceNow
    for (const p of this.priceHist) {
      if (now - p.ts <= 30000) {
        priceThen = p.price
        break
      }
    }
    const move30ticks = Math.round((priceNow - priceThen) / tick)

    let count10 = 0
    for (const t of this.trades) if (now - t.ts <= 10000) count10++
    const tradeRate = count10 / 10

    const wallThreshold = avg * 3
    const wallsAbove: WallLevel[] = []
    const wallsBelow: WallLevel[] = []
    for (const [p, s] of this.latestBook.asks) if (s >= wallThreshold) wallsAbove.push({ price: p.toFixed(dec), size: Math.round(s) })
    for (const [p, s] of this.latestBook.bids) if (s >= wallThreshold) wallsBelow.push({ price: p.toFixed(dec), size: Math.round(s) })

    return {
      control,
      oneSided,
      delta30,
      vol30,
      move30ticks,
      tradeRate,
      price: priceNow,
      wallsAbove: wallsAbove.slice(0, 3),
      wallsBelow: wallsBelow.slice(0, 3),
    }
  }
}
