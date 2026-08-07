import { WithSkiaWeb } from '@shopify/react-native-skia/src/web';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';

/**
 * Point d'entrée web — pris par Metro à la place de MarketLensCanvas.tsx sur cette plateforme
 * (suffixe .web.tsx prioritaire). Sur web, le backend CanvasKit (WASM) se charge de façon
 * asynchrone : contrairement à un simple `useEffect` (qui retarde la logique mais pas
 * l'évaluation du module — `MarketLensCanvasInner.tsx` importe `Skia` de façon statique dès son
 * premier `import()`), `WithSkiaWeb` reporte l'`import()` du composant lui-même après la
 * résolution de `LoadSkiaWeb()`, donc `Skia` n'est jamais évalué avant que CanvasKit soit prêt.
 *
 * Le rendu côté serveur (Expo Router web fait du SSR/prerendering en Node — voir `expo export`)
 * exécute `LoadSkiaWeb()` lui aussi, qui tente alors de lire le .wasm en tant que fichier
 * (résolution relative au bundle serveur, pas au navigateur) → ENOENT côté Node. `mounted`
 * garde ce composant à un simple rendu statique identique jusqu'au premier effet client (après
 * hydratation), moment où `<WithSkiaWeb>` n'est monté que dans un vrai navigateur.
 */
export function MarketLensCanvas() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return Fallback;

  return <WithSkiaWeb getComponent={() => import('./MarketLensCanvasInner')} fallback={Fallback} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07080b',
  },
  loading: {
    margin: 'auto',
  },
});

const Fallback = (
  <View style={styles.container}>
    <ThemedText type="small" themeColor="textSecondary" style={styles.loading}>
      Chargement du moteur graphique…
    </ThemedText>
  </View>
);
