import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTerminalEngine } from '@/engine/TerminalEngineContext';
import type { PressureSample } from '@/engine/pressureEngine';
import type { SessionStats } from '@/engine/marketDataService';

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <ThemedView style={styles.row}>
      <ThemedText type="small" style={styles.rowLabel}>
        {label}
      </ThemedText>
      <ThemedText type="code" style={color ? { color } : undefined}>
        {value}
      </ThemedText>
    </ThemedView>
  );
}

/**
 * Écran de vérification du moteur temps réel (MarketDataService/AnalysisEngine/PressureEngine)
 * — pas encore l'UI finale du terminal (Market Lens/DOM/Time & Sales viendront comme écrans
 * dédiés), juste la preuve que le portage depuis le terminal web fonctionne réellement une fois
 * branché à un vrai cycle de vie React Native, au-delà du smoke test Node exécuté pendant le
 * portage. Les compteurs (books/trades) et le prix sont relus à cadence modeste (500ms) plutôt
 * que sur chaque tick book/trade — mêmes principes que StatsPanel côté web (voir
 * TerminalEngineContext, qui documente pourquoi les événements haute fréquence ne passent pas
 * par le state React).
 */
export default function HomeScreen() {
  const { instrument, symbol, status, service, analysis, subscribePressure } = useTerminalEngine();
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [pressure, setPressure] = useState<PressureSample | null>(null);
  const [bookCount, setBookCount] = useState(0);
  const [tradeCount, setTradeCount] = useState(0);

  useEffect(() => {
    const onBook = () => setBookCount((n) => n + 1);
    const onTrade = () => setTradeCount((n) => n + 1);
    service.on('book', onBook).on('trade', onTrade);
    return () => {
      service.off('book', onBook).off('trade', onTrade);
    };
  }, [service]);

  useEffect(() => {
    const id = setInterval(() => setStats(analysis.sessionStats()), 500);
    return () => clearInterval(id);
  }, [analysis]);

  useEffect(() => subscribePressure(setPressure), [subscribePressure]);

  const dec = instrument.dec;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.heroSection}>
          <ThemedText type="title" style={styles.title}>
            KMM Terminal
          </ThemedText>
          <ThemedText type="small">Vérification du moteur temps réel — {symbol}</ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          <Row label="STATUT" value={status.mode} color={status.mode === 'SIM' ? '#43b04a' : '#e8822a'} />
          <Row label="DÉBIT" value={`${status.rate} msg/s`} />
          <Row label="BOOKS REÇUS" value={String(bookCount)} />
          <Row label="TRADES REÇUS" value={String(tradeCount)} />
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          <Row label="PRIX" value={stats ? stats.price.toFixed(dec) : '—'} color={stats?.priceUp ? '#35c8e0' : '#e5484d'} />
          <Row label="CVD SESSION" value={stats ? String(Math.round(stats.cvd)) : '—'} color={stats && stats.cvd >= 0 ? '#35c8e0' : '#e5484d'} />
          <Row label="VWAP" value={stats && stats.vwap ? stats.vwap.toFixed(dec) : '—'} />
          <Row label="VOLUME" value={stats ? String(Math.round(stats.vol)) : '—'} />
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          <Row
            label="PRESSION"
            value={pressure ? `${pressure.score > 0 ? '+' : ''}${Math.round(pressure.score)}` : '—'}
            color={pressure && pressure.score >= 0 ? '#35c8e0' : '#e5484d'}
          />
          <Row label="CONFIANCE" value={pressure ? `${pressure.conf}%` : '—'} />
          <Row label="TENDANCE" value={pressure ? pressure.trend : '—'} />
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    alignItems: 'stretch',
    gap: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
  },
  heroSection: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.four,
  },
  title: {
    textAlign: 'center',
  },
  card: {
    gap: Spacing.two,
    alignSelf: 'stretch',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    opacity: 0.6,
  },
});
