import { useEffect, useRef, useState } from 'react';
import { Canvas, Image, Points, type SkPoint } from '@shopify/react-native-skia';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';

import { useTerminalEngine } from '@/engine/TerminalEngineContext';
import { MarketLensEngine } from '@/engine/marketLensEngine';

const RIBBON_COLOR = '#e8e8e8';

/**
 * Canvas Skia de la heatmap Market Lens — premier jalon (voir @/engine/marketLensEngine.ts) :
 * raster de liquidité qui défile + ligne de prix, pas encore les cartes/zones/overlays du
 * terminal web. `MarketLensEngine` reste "headless" (aucune dépendance à une vue montée) :
 * ce composant se contente de le piloter à cadence fixe et d'afficher le dernier instantané
 * (image Skia + points de la ligne de prix) via l'API déclarative de react-native-skia.
 */
export function MarketLensCanvas() {
  const { instrument, service } = useTerminalEngine();
  const engineRef = useRef<MarketLensEngine | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState<{ image: ReturnType<MarketLensEngine['getFrame']>['image']; ribbon: SkPoint[] }>({
    image: null,
    ribbon: [],
  });

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
      setFrame({ image: f.image, ribbon: f.ribbon });
    }, 60);
    return () => clearInterval(id);
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  return (
    <View style={styles.container} onLayout={onLayout}>
      {size.width > 0 && size.height > 0 && (
        <Canvas style={{ width: size.width, height: size.height }}>
          {frame.image && (
            <Image image={frame.image} x={0} y={0} width={size.width} height={size.height} fit="fill" />
          )}
          {frame.ribbon.length > 1 && (
            <Points points={frame.ribbon} mode="polygon" color={RIBBON_COLOR} style="stroke" strokeWidth={1.5} />
          )}
        </Canvas>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07080b',
  },
});
