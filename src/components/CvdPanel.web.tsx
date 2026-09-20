import { WithSkiaWeb } from '@shopify/react-native-skia/src/web';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Point d'entrée web — voir MarketLensCanvas.web.tsx pour le détail complet de ce pattern
 * (CanvasKit/WASM se charge de façon asynchrone sur web ; CvdEngine importe `Skia` de façon
 * statique, donc CvdPanelInner ne doit être chargé qu'après LoadSkiaWeb()). Fallback silencieux
 * (juste le fond sombre) plutôt qu'un message : ce panneau est petit et sous la heatmap, qui a
 * déjà son propre message de chargement.
 */
export default function CvdPanel() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return Fallback;

  return <WithSkiaWeb getComponent={() => import('./CvdPanelInner')} fallback={Fallback} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0c0f',
  },
});

const Fallback = <View style={styles.container} />;
