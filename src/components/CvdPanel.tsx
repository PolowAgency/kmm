import CvdPanelInner from './CvdPanelInner';

/**
 * Point d'entrée natif (iOS/Android) — voir MarketLensCanvas.tsx pour le même choix de séparation
 * (Skia est prêt de façon synchrone sur natif, pas besoin d'attendre CanvasKit comme sur web).
 */
export default function CvdPanel() {
  return <CvdPanelInner />;
}
