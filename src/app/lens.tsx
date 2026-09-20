import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import CvdPanel from '@/components/CvdPanel';
import { MarketLensCanvas } from '@/components/MarketLensCanvas';
import { InstrumentSwitcher } from '@/components/instrument-switcher';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/**
 * Écran Market Lens — heatmap de liquidité qui défile + ligne de prix + Auction Assistant, puis
 * CVD en dessous (voir @/components/MarketLensCanvas.tsx, @/engine/marketLensEngine.ts,
 * @/components/CvdPanel.tsx) — même empilement Market Lens → CVD que la colonne centrale du
 * desktop. Zones "Nodes V2"/particules/vue 3D de la référence web viendront dans une passe
 * suivante.
 */
export default function LensScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <InstrumentSwitcher />
        <ThemedText type="small" themeColor="textSecondary">
          MARKET LENS
        </ThemedText>
      </View>
      <View style={styles.lensSection}>
        <MarketLensCanvas />
      </View>
      <View style={styles.cvdSection}>
        <CvdPanel />
      </View>
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
  lensSection: {
    flex: 1,
    minHeight: 0,
  },
  cvdSection: {
    height: 120,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.3)',
  },
});
