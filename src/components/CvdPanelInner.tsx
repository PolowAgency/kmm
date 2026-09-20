import { useEffect, useRef, useState } from 'react';
import { Canvas, Image } from '@shopify/react-native-skia';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { CvdEngine, type CvdFrame } from '@/engine/cvdEngine';
import { useTerminalEngine } from '@/engine/TerminalEngineContext';

const CY = '#35c8e0';
const RS = '#e5484d';

function fmtVol(v: number): string {
  const r = Math.round(v * 1e6) / 1e6;
  if (Number.isInteger(r)) return String(r);
  return r.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

const EMPTY_FRAME: CvdFrame = { image: null, width: 0, height: 0, cvd: 0, barDelta: 0, hasBar: false, timeframeId: 'T', rollS: 60, divergence: null };

/**
 * Panneau CVD — port de CvdPanel.tsx côté web (module cvd/), voir @/engine/cvdEngine.ts pour le
 * détail du port. Placé sous le Market Lens sur l'écran Lens, comme sur le desktop (MarketLensPanel
 * puis CvdPanel empilés dans la même colonne).
 */
export default function CvdPanelInner() {
  const { analysis, timeframe, service } = useTerminalEngine();
  const engineRef = useRef<CvdEngine | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState<CvdFrame>(EMPTY_FRAME);

  useEffect(() => {
    const engine = new CvdEngine(() => analysis.cvd);
    engineRef.current = engine;
    if (size.width > 0 && size.height > 0) engine.resize(size.width, size.height);
    const onBook = engine.handleBook.bind(engine);
    const onTrade = engine.handleTrade.bind(engine);
    service.on('book', onBook).on('trade', onTrade);
    return () => {
      service.off('book', onBook).off('trade', onTrade);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service]);

  useEffect(() => {
    engineRef.current?.setTimeframe(timeframe);
  }, [timeframe]);

  useEffect(() => {
    if (size.width > 0 && size.height > 0) engineRef.current?.resize(size.width, size.height);
  }, [size]);

  useEffect(() => {
    const id = setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.tick(Date.now());
      setFrame(engine.getFrame());
    }, 350);
    return () => clearInterval(id);
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  const cvdColor = frame.cvd >= 0 ? CY : RS;
  const barColor = frame.barDelta >= 0 ? CY : RS;

  return (
    <View style={styles.container} onLayout={onLayout}>
      {size.width > 0 && size.height > 0 && (
        <Canvas style={{ width: size.width, height: size.height }}>
          {frame.image && <Image image={frame.image} x={0} y={0} width={size.width} height={size.height} fit="fill" />}
        </Canvas>
      )}
      <View pointerEvents="none" style={styles.overlay}>
        {frame.divergence && (
          <ThemedText type="code" style={[styles.divergence, { color: frame.divergence.kind === 'BEARISH DIV' ? RS : CY }]}>
            · {frame.divergence.kind}
          </ThemedText>
        )}
        <View style={styles.readouts}>
          <View style={styles.readout}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.readoutLabel}>
              CVD SESSION
            </ThemedText>
            <ThemedText type="code" style={[styles.readoutValue, { color: cvdColor }]}>
              {frame.cvd > 0 ? '+' : ''}
              {Math.round(frame.cvd)}
            </ThemedText>
          </View>
          <View style={styles.readout}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.readoutLabel}>
              BAR Δ
            </ThemedText>
            {frame.hasBar && (
              <ThemedText type="code" style={[styles.readoutValue, { color: barColor }]}>
                {frame.barDelta > 0 ? '+' : ''}
                {fmtVol(frame.barDelta)}
              </ThemedText>
            )}
          </View>
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={styles.caption}>
          CVD · SESSION + ROLLING {frame.rollS}S · TF {frame.timeframeId}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0c0f',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    padding: 8,
    justifyContent: 'space-between',
  },
  divergence: {
    position: 'absolute',
    top: 4,
    left: 8,
    fontSize: 9,
    fontWeight: '700',
  },
  readouts: {
    position: 'absolute',
    top: 4,
    right: 8,
    alignItems: 'flex-end',
    gap: 10,
  },
  readout: {
    alignItems: 'flex-end',
  },
  readoutLabel: {
    fontSize: 8,
    letterSpacing: 0.5,
  },
  readoutValue: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Fonts.mono,
  },
  caption: {
    fontSize: 8,
    letterSpacing: 0.3,
  },
});
