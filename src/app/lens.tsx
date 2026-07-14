import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MarketLensCanvas } from '@/components/MarketLensCanvas';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTerminalEngine } from '@/engine/TerminalEngineContext';

/**
 * Écran Market Lens — premier jalon (heatmap de liquidité qui défile + ligne de prix), voir
 * @/components/MarketLensCanvas.tsx et @/engine/marketLensEngine.ts. Zones de contrôle/Auction
 * Engine V9/particules/vue 3D de la référence web viendront dans une passe suivante.
 */
export default function LensScreen() {
  const { instrument } = useTerminalEngine();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <ThemedText type="smallBold">{instrument.code}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          MARKET LENS
        </ThemedText>
      </View>
      <MarketLensCanvas />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
