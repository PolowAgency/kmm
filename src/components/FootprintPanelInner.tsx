import { useEffect, useRef, useState } from 'react';
import { Canvas, Image } from '@shopify/react-native-skia';
import { LayoutChangeEvent, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Fonts } from '@/constants/theme';
import { FootprintEngine, type FootprintTextItem } from '@/engine/footprintEngine';
import { useTerminalEngine } from '@/engine/TerminalEngineContext';

/**
 * Panneau Footprint — port de FootprintPanel.tsx côté web (module footprint/), voir
 * @/engine/footprintEngine.ts pour le détail du port et ce qui n'est délibérément pas repris
 * (ligne de lecture WINNING/ABS/AGGR, Market Control Engine). Enveloppé dans un ScrollView
 * horizontal plutôt que de ne dessiner que les barres qui tiennent dans la largeur visible comme
 * le web : sur un écran mobile étroit, ça aurait réduit l'historique visible à 3-4 barres sans
 * aucun moyen de voir le reste, alors qu'un simple scroll le garde consultable.
 */
export default function FootprintPanelInner() {
  const { instrument, timeframe, service } = useTerminalEngine();
  const engineRef = useRef<FootprintEngine | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const lastWidthRef = useRef(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const [frame, setFrame] = useState<ReturnType<FootprintEngine['getFrame']>>({
    image: null,
    width: 0,
    height: 0,
    textItems: [],
  });

  useEffect(() => {
    const engine = new FootprintEngine(instrument);
    engineRef.current = engine;
    if (containerHeight > 0) engine.setContainerHeight(containerHeight);
    const onTrade = engine.handleTrade.bind(engine);
    service.on('trade', onTrade);
    return () => {
      service.off('trade', onTrade);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument, service]);

  useEffect(() => {
    engineRef.current?.setTimeframe(timeframe);
  }, [timeframe]);

  useEffect(() => {
    if (containerHeight > 0) engineRef.current?.setContainerHeight(containerHeight);
  }, [containerHeight]);

  useEffect(() => {
    const id = setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.tick();
      const next = engine.getFrame();
      setFrame(next);
      // Nouvelle barre ajoutée (canvas élargi) : suit automatiquement, comme le desktop qui
      // affiche toujours les barres les plus récentes contre la gouttière de prix — sans ça, le
      // ScrollView resterait scrollé sur une position de plus en plus ancienne au fil du temps.
      if (next.width > lastWidthRef.current) {
        lastWidthRef.current = next.width;
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
      }
    }, 250);
    return () => clearInterval(id);
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    setContainerHeight(e.nativeEvent.layout.height);
  };

  return (
    <View style={styles.container} onLayout={onLayout}>
      {containerHeight > 0 && (
        <ScrollView ref={scrollRef} horizontal contentContainerStyle={styles.scrollContent} showsHorizontalScrollIndicator={false}>
          {frame.image && frame.width > 0 && (
            <View style={{ width: frame.width, height: containerHeight }}>
              <Canvas style={StyleSheet.absoluteFill}>
                <Image image={frame.image} x={0} y={0} width={frame.width} height={containerHeight} fit="fill" />
              </Canvas>
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                {frame.textItems.map((item, i) => (
                  <FootprintText key={i} item={item} />
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

/** Un <Text> par libellé, positionné à la même place que canvas.drawText() dans
 * footprintEngine.ts — voir le docstring de la classe pour pourquoi le texte n'est pas dessiné
 * directement dans le canvas Skia. */
function FootprintText({ item }: { item: FootprintTextItem }) {
  return (
    <Text
      style={[
        styles.text,
        {
          left: item.x,
          top: item.y - item.size * 0.75,
          width: item.width,
          textAlign: item.align,
          color: item.color,
          fontSize: item.size,
          fontWeight: item.bold ? '700' : '400',
        },
      ]}
      numberOfLines={1}
    >
      {item.text}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0c0f',
  },
  scrollContent: {
    flexGrow: 1,
  },
  text: {
    position: 'absolute',
    fontFamily: Fonts.mono,
  },
});
