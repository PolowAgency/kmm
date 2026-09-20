import { WithSkiaWeb } from '@shopify/react-native-skia/src/web';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

/** Point d'entrée web — voir CvdPanel.web.tsx / MarketLensCanvas.web.tsx pour le détail complet de
 * ce pattern (CanvasKit/WASM charge de façon asynchrone sur web). */
export default function FootprintPanel() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return Fallback;

  return <WithSkiaWeb getComponent={() => import('./FootprintPanelInner')} fallback={Fallback} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0c0f',
  },
});

const Fallback = <View style={styles.container} />;
