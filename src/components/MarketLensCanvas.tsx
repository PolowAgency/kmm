import MarketLensCanvasInner from './MarketLensCanvasInner';

/**
 * Point d'entrée natif (iOS/Android) — Skia est prêt de façon synchrone (backend JSI), donc pas
 * besoin d'attendre quoi que ce soit avant de monter l'implémentation réelle. Voir
 * MarketLensCanvas.web.tsx pour l'équivalent web (chargement asynchrone de CanvasKit/WASM).
 */
export function MarketLensCanvas() {
  return <MarketLensCanvasInner />;
}
