import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, Image, Points, type SkPoint } from '@shopify/react-native-skia';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useTerminalEngine } from '@/engine/TerminalEngineContext';
import type { AnalysisSummary, EventCounts, PollEvent } from '@/engine/marketDataService';
import { MarketLensEngine, PROFILE_W } from '@/engine/marketLensEngine';
import { useTheme } from '@/hooks/use-theme';

const RIBBON_COLOR = '#e8e8e8';
const EVENT_TTL_MS = 15000;

type RenderedWallOverlay = {
  id: string;
  label: string;
  tone: 'bid' | 'ask' | 'neutral';
  top: number;
};

type RenderedEventOverlay = {
  id: string;
  label: string;
  tone: 'bid' | 'ask' | 'neutral';
  top: number;
};

/**
 * Implémentation réelle du canvas Skia de la heatmap Market Lens — premier jalon (voir
 * @/engine/marketLensEngine.ts) : raster de liquidité qui défile + ligne de prix, pas encore les
 * cartes/zones/overlays du terminal web. `MarketLensEngine` reste "headless" (aucune dépendance
 * à une vue montée) : ce composant se contente de le piloter à cadence fixe et d'afficher le
 * dernier instantané (image Skia + points de la ligne de prix) via l'API déclarative de
 * react-native-skia.
 *
 * Ce fichier importe `Skia` de façon statique (via les composants Canvas/Image/Points) : sur
 * natif c'est sans risque (backend JSI dispo immédiatement), mais sur web ce module ne doit être
 * importé qu'une fois CanvasKit (WASM) chargé — d'où le composant `default export` séparé
 * `MarketLensCanvas.web.tsx`, qui ne l'importe dynamiquement qu'après `LoadSkiaWeb()`. Voir
 * @/components/MarketLensCanvas.tsx (natif) / MarketLensCanvas.web.tsx (web).
 */
export default function MarketLensCanvasInner() {
  const { analysis, instrument, service, subscribeAlerts } = useTerminalEngine();
  const theme = useTheme();
  const engineRef = useRef<MarketLensEngine | null>(null);
  const summaryRef = useRef<AnalysisSummary | null>(null);
  const alertEventsRef = useRef<LensAlertOverlay[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState<{
    image: ReturnType<MarketLensEngine['getFrame']>['image'];
    ribbon: SkPoint[];
    profileImage: ReturnType<MarketLensEngine['getFrame']>['profileImage'];
    profileWidth: number;
  }>({
    image: null,
    ribbon: [],
    profileImage: null,
    profileWidth: 0,
  });
  const [summary, setSummary] = useState<AnalysisSummary | null>(null);
  const [counts, setCounts] = useState<EventCounts>(analysis.eventCounts);
  const [wallItems, setWallItems] = useState<RenderedWallOverlay[]>([]);
  const [eventItems, setEventItems] = useState<RenderedEventOverlay[]>([]);

  useEffect(() => {
    const engine = new MarketLensEngine(instrument);
    engineRef.current = engine;
    if (size.width > 0 && size.height > 0) engine.resize(size.width, size.height);
    const onBook = engine.handleBook.bind(engine);
    const onTrade = engine.handleTrade.bind(engine);
    service.on('book', onBook).on('trade', onTrade);
    return () => {
      service.off('book', onBook).off('trade', onTrade);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument, service]);

  useEffect(() => {
    if (size.width > 0 && size.height > 0) engineRef.current?.resize(size.width, size.height);
  }, [size]);

  useEffect(() => {
    const id = setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.pushColumn();
      const f = engine.getFrame();
      setFrame({ image: f.image, ribbon: f.ribbon, profileImage: f.profileImage, profileWidth: f.profileWidth });
      setWallItems(projectWalls(summaryRef.current, engine, size.height));
      setEventItems(projectAlertEvents(alertEventsRef.current, engine, size.height));
    }, 60);
    return () => clearInterval(id);
  }, [size.height]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const nextSummary = analysis.summary(now);
      summaryRef.current = nextSummary;
      startTransition(() => {
        setSummary(nextSummary);
        setCounts(analysis.eventCounts);
        setWallItems(projectWalls(nextSummary, engineRef.current, size.height));
        setEventItems(projectAlertEvents(alertEventsRef.current, engineRef.current, size.height));
      });
    }, 250);
    return () => clearInterval(id);
  }, [analysis, size.height]);

  useEffect(() => {
    startTransition(() => {
      summaryRef.current = null;
      alertEventsRef.current = [];
      setSummary(null);
      setCounts(analysis.eventCounts);
      setWallItems([]);
      setEventItems([]);
    });
  }, [analysis, instrument]);

  useEffect(() => {
    return subscribeAlerts((events) => {
      const now = Date.now();
      const next = [...alertEventsRef.current];
      for (const event of events) {
        const overlay = toLensAlertOverlay(event);
        if (!overlay) continue;
        const existing = next.findIndex((item) => item.kind === overlay.kind && Math.abs(item.price - overlay.price) < instrument.tick * 0.5);
        if (existing >= 0) next[existing] = overlay;
        else next.unshift(overlay);
      }
      alertEventsRef.current = next.filter((event) => now - event.ts <= EVENT_TTL_MS).slice(0, 8);
      startTransition(() => {
        setCounts(analysis.eventCounts);
        setEventItems(projectAlertEvents(alertEventsRef.current, engineRef.current, size.height));
      });
    });
  }, [analysis, instrument.tick, size.height, subscribeAlerts]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  // Callbacks JS (appelés via runOnJS depuis les worklets de geste, jamais depuis le thread UI
  // directement) — `MarketLensEngine` reste "headless", ces callbacks ne font qu'appeler ses
  // méthodes publiques (pan/setZoom/resetView), aucune logique de rendu ici.
  const pinchBaseRowH = useRef(5);
  const handlePanChange = (deltaY: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.pan(deltaY / engine.zoomRowH);
  };
  const handlePinchStart = () => {
    if (engineRef.current) pinchBaseRowH.current = engineRef.current.zoomRowH;
  };
  const handlePinchChange = (scale: number) => {
    engineRef.current?.setZoom(pinchBaseRowH.current * scale);
  };
  const handleReset = () => {
    engineRef.current?.resetView();
  };

  // Construit la composition de gestes une seule fois — les callbacks ci-dessus ne capturent que
  // des refs stables (engineRef, pinchBaseRowH), jamais de props/state, donc pas de fermeture
  // obsolète malgré les deps vides.
  const gesture = useMemo(() => {
    // Un seul doigt uniquement (maxPointers) : un pincement à 2 doigts ne doit jamais être
    // interprété comme un pan, les deux gestes doivent rester mutuellement exclusifs par nombre
    // de doigts plutôt que par une course (Race) plus fragile.
    const pan = Gesture.Pan()
      .minPointers(1)
      .maxPointers(1)
      .minDistance(6)
      .onChange((e) => {
        runOnJS(handlePanChange)(e.changeY);
      });

    const pinch = Gesture.Pinch()
      .onStart(() => {
        runOnJS(handlePinchStart)();
      })
      .onChange((e) => {
        runOnJS(handlePinchChange)(e.scale);
      });

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        runOnJS(handleReset)();
      });

    // Exclusive plutôt que Simultaneous avec le double-tap : essaie doubleTap en premier, ne
    // retombe sur pan/pinch que s'il ne se reconnaît pas (évite qu'un double-tap ne déclenche
    // aussi un micro-pan).
    return Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.container} onLayout={onLayout}>
        {size.width > 0 && size.height > 0 && (
          <>
            <Canvas style={{ width: size.width, height: size.height }}>
              {frame.image && (
                <Image image={frame.image} x={0} y={0} width={size.width} height={size.height} fit="fill" />
              )}
              {frame.ribbon.length > 1 && (
                <Points points={frame.ribbon} mode="polygon" color={RIBBON_COLOR} style="stroke" strokeWidth={1.5} />
              )}
              {frame.profileImage && (
                <Image
                  image={frame.profileImage}
                  x={size.width - frame.profileWidth}
                  y={0}
                  width={frame.profileWidth}
                  height={size.height}
                  fit="fill"
                />
              )}
            </Canvas>
            <View pointerEvents="none" style={styles.overlayLayer}>
              {wallItems.map((wall) => {
                const color = wall.tone === 'bid' ? theme.sideBid : wall.tone === 'ask' ? theme.sideAsk : theme.sideNeutral;
                return (
                  <View key={wall.id} style={[styles.wallOverlay, { top: wall.top }]}>
                    <View style={[styles.wallLine, { backgroundColor: color }]} />
                    <View style={[styles.wallCard, { borderColor: color, backgroundColor: rgba(theme.background, 0.92) }]}>
                      <View style={[styles.sideDot, { backgroundColor: color }]} />
                      <ThemedText type="code" themeColor="textSecondary" numberOfLines={1} style={styles.overlayLabel}>
                        {wall.label}
                      </ThemedText>
                    </View>
                  </View>
                );
              })}
              {eventItems.map((event) => {
                const color = event.tone === 'bid' ? theme.sideBid : event.tone === 'ask' ? theme.sideAsk : theme.sideNeutral;
                return (
                  <View key={event.id} style={[styles.eventOverlay, { top: event.top }]}>
                    <View style={[styles.eventGuide, { borderColor: color }]} />
                    <View style={[styles.eventCard, { borderColor: color, backgroundColor: rgba(theme.background, 0.92) }]}>
                      <ThemedText type="code" themeColor="textSecondary" numberOfLines={1} style={styles.overlayLabel}>
                        {event.label}
                      </ThemedText>
                    </View>
                  </View>
                );
              })}
              <View style={[styles.bottomBar, { backgroundColor: rgba(theme.backgroundElement, 0.9), borderColor: rgba(theme.sideNeutral, 0.45) }]}>
                <Indicator label="BUY" value={summary?.wallsBelow.length ?? 0} color={theme.sideBid} />
                <Indicator label="SELL" value={summary?.wallsAbove.length ?? 0} color={theme.sideAsk} />
                <Indicator label="ABS" value={counts.abs} color={theme.sideNeutral} />
                <Indicator label="ICE" value={counts.ice} color={theme.sideNeutral} />
                <Indicator label="WALL" value={counts.wall} color={theme.sideNeutral} />
              </View>
            </View>
          </>
        )}
      </View>
    </GestureDetector>
  );
}

function Indicator({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <View style={styles.indicator}>
      <View style={[styles.sideDot, { backgroundColor: color }]} />
      <ThemedText type="code" themeColor="textSecondary" style={styles.indicatorLabel}>
        {label} {value}
      </ThemedText>
    </View>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isVisible(value: number | null | undefined, height: number) {
  return value !== null && value !== undefined && value >= -12 && value <= height + 12;
}

function projectWalls(summary: AnalysisSummary | null, engine: MarketLensEngine | null, height: number): RenderedWallOverlay[] {
  if (!summary || !engine) return [];

  const wallItems: Array<{ id: string; label: string; price: number; tone: 'bid' | 'ask' }> = [
    ...summary.wallsAbove.map((wall) => ({
      id: `ask-${wall.price}`,
      label: `SELL WALL ${wall.size} @ ${wall.price} ABOVE`,
      price: Number(wall.price),
      tone: 'ask' as const,
    })),
    ...summary.wallsBelow.map((wall) => ({
      id: `bid-${wall.price}`,
      label: `BUY WALL ${wall.size} @ ${wall.price} BELOW`,
      price: Number(wall.price),
      tone: 'bid' as const,
    })),
  ];

  return wallItems.reduce<RenderedWallOverlay[]>((acc, wall) => {
      const y = engine.projectPrice(wall.price);
      if (!isVisible(y, height)) return acc;
      acc.push({ id: wall.id, label: wall.label, tone: wall.tone, top: clamp(y! - 18, 6, height - 42) });
      return acc;
    }, []);
}

type LensAlertOverlay = {
  id: string;
  kind: 'absorption' | 'iceberg';
  label: string;
  price: number;
  tone: 'bid' | 'ask' | 'neutral';
  ts: number;
};

function toLensAlertOverlay(event: PollEvent): LensAlertOverlay | null {
  if (event.type !== 'ABSORPTION' && event.type !== 'ICEBERG') return null;
  return {
    id: `${event.type}-${event.id}`,
    kind: event.type === 'ABSORPTION' ? 'absorption' : 'iceberg',
    label: event.type === 'ABSORPTION' ? 'ICEBERG ABSORBED' : 'ICEBERG REFRESH',
    price: event.price,
    tone: inferEventTone(event.expl),
    ts: event.ts,
  };
}

function inferEventTone(expl: string): 'bid' | 'ask' | 'neutral' {
  const text = expl.toLowerCase();
  if (text.includes('buyer') || text.includes('buy ') || text.includes('buying') || text.includes('demand')) return 'bid';
  if (text.includes('seller') || text.includes('sell ') || text.includes('selling') || text.includes('supply')) return 'ask';
  return 'neutral';
}

function projectAlertEvents(events: LensAlertOverlay[], engine: MarketLensEngine | null, height: number): RenderedEventOverlay[] {
  if (!engine) return [];
  return events.reduce<RenderedEventOverlay[]>((acc, event) => {
    const y = engine.projectPrice(event.price);
    if (!isVisible(y, height)) return acc;
    acc.push({ id: event.id, label: event.label, tone: event.tone, top: clamp(y! - 14, 6, height - 32) });
    return acc;
  }, []);
}

function rgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '');
  const safe = normalized.length === 3 ? normalized.split('').map((value) => value + value).join('') : normalized;
  const int = Number.parseInt(safe, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07080b',
  },
  overlayLayer: {
    ...StyleSheet.absoluteFill,
  },
  wallOverlay: {
    position: 'absolute',
    left: 0,
    right: PROFILE_W, // laisse la gouttière de profil de volume libre, voir marketLensEngine.ts
    height: 36,
    justifyContent: 'center',
  },
  wallLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    opacity: 0.8,
  },
  wallCard: {
    alignSelf: 'flex-end',
    marginRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: '82%',
  },
  eventOverlay: {
    position: 'absolute',
    left: 0,
    right: PROFILE_W, // idem wallOverlay
    height: 28,
    justifyContent: 'center',
  },
  eventGuide: {
    position: 'absolute',
    right: 116,
    width: 48,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    opacity: 0.85,
  },
  eventCard: {
    alignSelf: 'flex-end',
    marginRight: 8,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: '72%',
  },
  overlayLabel: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    lineHeight: 13,
  },
  sideDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  bottomBar: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  indicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  indicatorLabel: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    lineHeight: 13,
  },
});
