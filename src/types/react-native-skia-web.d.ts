/**
 * @shopify/react-native-skia n'exporte LoadSkiaWeb/WithSkiaWeb que depuis un sous-chemin
 * `src/web` (code source brut, pas de .d.ts pré-compilé pour ce sous-chemin) — voir
 * @/components/MarketLensCanvas.web.tsx pour pourquoi ce sous-chemin précis (et pas
 * `lib/module/web`) est nécessaire. Ce module source référence le typage Node global (`global`),
 * absent du contexte de compilation de ce projet (tsconfig RN/Expo, pas Node) : la déclaration
 * ambiante `global` ci-dessous couvre ce fichier vendor (les déclarations ambiantes s'appliquent
 * à tout le programme, pas seulement à ce fichier), le `declare module` réutilise juste notre
 * propre signature plutôt que de laisser tsc inférer celle du fichier source vendor.
 */
declare var global: typeof globalThis

declare module '@shopify/react-native-skia/src/web' {
  import type { ComponentType } from 'react'
  import type { CanvasKitInitOptions } from 'canvaskit-wasm'

  export function LoadSkiaWeb(opts?: CanvasKitInitOptions): Promise<void>

  export function WithSkiaWeb<TProps extends object>(props: {
    getComponent: () => Promise<{ default: ComponentType<TProps> }>
    fallback?: React.ReactNode
    opts?: CanvasKitInitOptions
    componentProps?: TProps
  }): React.JSX.Element
}
