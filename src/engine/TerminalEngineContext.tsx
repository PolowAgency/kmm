import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { INSTRUMENTS, TIMEFRAMES } from './instruments'
import { AnalysisEngine, MarketDataService, type PollEvent } from './marketDataService'
import { PressureEngine, type PressureSample } from './pressureEngine'
import type { Instrument, NewsItem, ServiceStatus } from './types'

interface TerminalEngineValue {
  symbol: string
  instrument: Instrument
  timeframe: string
  service: MarketDataService
  analysis: AnalysisEngine
  pressure: PressureEngine
  status: ServiceStatus
  setSymbol: (sym: string) => void
  setTimeframe: (id: string) => void
  sound: boolean
  setSound: (on: boolean) => void
  /** Force le repli simulation même sur un instrument live (voir MarketDataService.setForceSim()). */
  forceSim: boolean
  setForceSim: (on: boolean) => void
  /** S'abonne aux échantillons Pressure (~250ms, horloge Date.now()) — un seul sampler partagé
   * par tous les écrans qui en ont besoin. Retourne la fonction de désabonnement. */
  subscribePressure: (cb: (sample: PressureSample) => void) => () => void
  /** Dernier échantillon Pressure connu, ou null tant que le moteur n'a pas assez de données. */
  getPressureSnapshot: () => PressureSample | null
  /** S'abonne aux lots d'événements AnalysisEngine.poll() (~400ms) — un seul détecteur partagé.
   * Le callback reçoit uniquement les événements NOUVEAUX de ce tick, pas tout l'historique. */
  subscribeAlerts: (cb: (events: PollEvent[]) => void) => () => void
  /** true si une news simulée à fort impact a été publiée dans les 60 dernières secondes. Le
   * flux `news` lui-même (pour un écran News) reste consommé directement via
   * `service.on('news', ...)`, pas de plomberie contexte nécessaire ici. */
  isNewsRecent: () => boolean
}

const TerminalEngineContext = createContext<TerminalEngineValue | null>(null)

/**
 * Port depuis le terminal web (TERMINAL/app/terminal-v2/engine/TerminalEngineContext.tsx) —
 * porte le cycle de vie du flux marché (MarketDataService) et de l'analyse (AnalysisEngine/
 * PressureEngine) pour l'instrument/timeframe courant, et les rend disponibles à tous les
 * écrans de l'app. Code React pur (pas de JSX propre au DOM), donc identique mot pour mot à la
 * version web — seule la source de `wsUrl` change (variable d'environnement Expo plutôt que
 * lue côté serveur Next.js).
 *
 * Les événements book/trade à haute fréquence ne transitent PAS par le state React (ça
 * déclencherait un re-render par tick) : les écrans qui en ont besoin (DOM, Time & Sales, futur
 * canvas Market Lens) s'abonnent directement à `service.on(...)` dans leur propre effet. Seul
 * `status` (mis à jour ~2x/s) vit en state.
 *
 * `wsUrl` : `EXPO_PUBLIC_MARKET_DATA_WS_URL` est inlinée au build par Expo (préfixe
 * `EXPO_PUBLIC_` obligatoire pour qu'une variable d'environnement soit accessible côté client) —
 * même URL publique wss:// que côté web, aucun secret dedans. `null` = repli simulation.
 */
export function TerminalEngineProvider({
  children,
  wsUrl = process.env.EXPO_PUBLIC_MARKET_DATA_WS_URL ?? null,
}: {
  children: React.ReactNode
  wsUrl?: string | null
}) {
  const [symbol, setSymbolState] = useState('GC')
  const [timeframe, setTimeframeState] = useState(TIMEFRAMES[0].id)
  const [sound, setSound] = useState(false)
  const [forceSim, setForceSimState] = useState(false)
  const [status, setStatus] = useState<ServiceStatus>({
    mode: wsUrl ? 'CONNECTING' : 'SIM',
    rate: 0,
    latencyMs: 0,
    bufferSec: 0,
    replaying: false,
    progress: 0,
  })

  const serviceRef = useRef<MarketDataService | null>(null)
  if (!serviceRef.current) serviceRef.current = new MarketDataService({ updatesPerSec: 200, wsUrl })

  const instrument = INSTRUMENTS[symbol]
  const analysisRef = useRef<AnalysisEngine | null>(null)
  if (!analysisRef.current || analysisRef.current.instrument !== instrument) {
    analysisRef.current = new AnalysisEngine(instrument)
  }

  // Même schéma que analysisRef : une instance par instrument, recréée à la volée. Un seul
  // sampler (l'effet ci-dessous) alimente tous les abonnés via subscribePressure() — évite le
  // double-échantillonnage qu'aurait provoqué une instance PressureEngine + un setInterval
  // propres à chaque écran consommateur.
  const pressureRef = useRef<PressureEngine | null>(null)
  if (!pressureRef.current || pressureRef.current.instrument !== instrument) {
    pressureRef.current = new PressureEngine(instrument)
  }
  const latestPressureRef = useRef<PressureSample | null>(null)
  const pressureSubscribersRef = useRef(new Set<(s: PressureSample) => void>())
  const alertSubscribersRef = useRef(new Set<(events: PollEvent[]) => void>())
  const lastHighImpactNewsRef = useRef(0)

  // Transport : monté une seule fois, fermé uniquement au démontage réel du provider. Les
  // wrappers lisent analysisRef.current/pressureRef.current dynamiquement — pas besoin de se
  // réabonner quand l'instrument (et donc les instances) change.
  useEffect(() => {
    const service = serviceRef.current!
    const onTrade = (t: Parameters<AnalysisEngine['onTrade']>[0]) => {
      analysisRef.current?.onTrade(t)
      pressureRef.current?.onTrade(t)
    }
    const onBook = (b: Parameters<AnalysisEngine['onBook']>[0]) => {
      analysisRef.current?.onBook(b)
      pressureRef.current?.onBook(b)
    }
    const onStatus = (s: ServiceStatus) => setStatus(s)
    const onNews = (n: NewsItem) => {
      if (n.phase === 'release' && n.imp === 'high') lastHighImpactNewsRef.current = Date.now()
    }
    service.on('trade', onTrade).on('book', onBook).on('service', onStatus).on('news', onNews)
    return () => {
      service.off('trade', onTrade).off('book', onBook).off('service', onStatus).off('news', onNews)
      service.disconnect()
    }
  }, [])

  // Abonnement à l'instrument courant : (re)connecte au montage, resouscrit au changement.
  useEffect(() => {
    serviceRef.current!.connect(instrument)
  }, [instrument])

  // Sampler Pressure partagé (~250ms, horloge Date.now()). Monté une seule fois ; lit
  // pressureRef.current dynamiquement pour survivre aux changements d'instrument sans
  // redémarrer l'intervalle.
  useEffect(() => {
    const id = setInterval(() => {
      const sample = pressureRef.current?.sample(Date.now())
      if (sample) {
        latestPressureRef.current = sample
        for (const cb of pressureSubscribersRef.current) cb(sample)
      }
    }, 250)
    return () => clearInterval(id)
  }, [])

  // Détecteur d'événements (alertes) partagé, même cadence que la référence (400ms). Monté une
  // seule fois ; lit analysisRef.current dynamiquement (survit aux changements d'instrument).
  // poll() vide son buffer interne à chaque appel, donc un seul appelant.
  useEffect(() => {
    const id = setInterval(() => {
      const events = analysisRef.current?.poll(Date.now())
      if (events && events.length) {
        for (const cb of alertSubscribersRef.current) cb(events)
      }
    }, 400)
    return () => clearInterval(id)
  }, [])

  // Toutes les fonctions exposées ci-dessous sont stabilisées via useCallback (deps []) même
  // si elles referment sur des refs "vivantes" (xxxRef.current, lu au moment de l'appel, jamais
  // au moment du render) : sans ça, elles seraient redéfinies à chaque recalcul de `value`
  // (déclenché par `status`, mis à jour ~1-2x/s) et casseraient l'identité stable dont dépendent
  // les useEffect des écrans consommateurs — chacun se désabonnerait/réabonnerait en boucle à
  // chaque tick de statut, avec pour symptôme visible des alertes/graphiques qui clignotent.
  const setSymbol = useCallback((sym: string) => {
    if (INSTRUMENTS[sym]) setSymbolState(sym)
  }, [])
  const setTimeframe = useCallback((id: string) => {
    if (TIMEFRAMES.some((t) => t.id === id)) setTimeframeState(id)
  }, [])
  const subscribePressure = useCallback((cb: (sample: PressureSample) => void) => {
    pressureSubscribersRef.current.add(cb)
    return () => {
      pressureSubscribersRef.current.delete(cb)
    }
  }, [])
  const getPressureSnapshot = useCallback(() => latestPressureRef.current, [])
  const subscribeAlerts = useCallback((cb: (events: PollEvent[]) => void) => {
    alertSubscribersRef.current.add(cb)
    return () => {
      alertSubscribersRef.current.delete(cb)
    }
  }, [])
  const isNewsRecent = useCallback(() => Date.now() - lastHighImpactNewsRef.current < 60000, [])
  const setForceSim = useCallback((on: boolean) => {
    setForceSimState(on)
    serviceRef.current?.setForceSim(on)
  }, [])

  const value = useMemo<TerminalEngineValue>(
    () => ({
      symbol,
      instrument,
      timeframe,
      service: serviceRef.current!,
      analysis: analysisRef.current!,
      pressure: pressureRef.current!,
      status,
      setSymbol,
      setTimeframe,
      subscribePressure,
      getPressureSnapshot,
      subscribeAlerts,
      isNewsRecent,
      sound,
      setSound,
      forceSim,
      setForceSim,
    }),
    [symbol, instrument, timeframe, status, sound, forceSim, setSymbol, setTimeframe, subscribePressure, getPressureSnapshot, subscribeAlerts, isNewsRecent, setForceSim],
  )

  return <TerminalEngineContext.Provider value={value}>{children}</TerminalEngineContext.Provider>
}

export function useTerminalEngine(): TerminalEngineValue {
  const ctx = useContext(TerminalEngineContext)
  if (!ctx) throw new Error('useTerminalEngine doit être utilisé sous TerminalEngineProvider')
  return ctx
}
