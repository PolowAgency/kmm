import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTerminalEngine } from '@/engine/TerminalEngineContext';
import type { PollEvent } from '@/engine/marketDataService';
import { buildStatsRows, type StatRow } from '@/engine/statsEngine';
import type { NewsItem } from '@/engine/types';
import { useTheme } from '@/hooks/use-theme';

const CY = '#35c8e0';
const RS = '#e5484d';
const OR = '#e8822a';
const GREY = '#6b7683';

type Tab = 'signals' | 'news' | 'stats';

const SCENARIOS: { label: string; cmd: string }[] = [
  { label: 'SWEEP ▲', cmd: 'sweepUp' },
  { label: 'SWEEP ▼', cmd: 'sweepDown' },
  { label: 'ICEBERG', cmd: 'iceberg' },
  { label: 'SPOOF', cmd: 'spoof' },
  { label: 'GROS MUR', cmd: 'wall' },
  { label: 'ABSORPTION', cmd: 'absorption' },
  { label: 'VOL +', cmd: 'volUp' },
  { label: 'VOL −', cmd: 'volDown' },
  { label: 'TENDANCE ▲', cmd: 'trendUp' },
  { label: 'TENDANCE ▼', cmd: 'trendDown' },
  { label: 'RANGE', cmd: 'chop' },
];

/**
 * Écran SIGNALS / NEWS / STATS + scénarios de simulation — port depuis le terminal web
 * (TERMINAL/app/terminal-v2/components/modules/signals/), qui a le même découpage en onglets
 * dans LeftPanel.tsx. Contrairement au DOM/Tape, ces trois vues sont assez légères pour
 * partager un seul écran mobile avec un sélecteur d'onglet local plutôt que 3 onglets de
 * navigation séparés — l'espace écran mobile est plus contraint que le panneau gauche desktop.
 */
export default function SignalsScreen() {
  const { instrument, service, analysis, status, subscribeAlerts, getPressureSnapshot } = useTerminalEngine();
  const [tab, setTab] = useState<Tab>('signals');
  const [alerts, setAlerts] = useState<PollEvent[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [statRows, setStatRows] = useState<StatRow[]>([]);

  useEffect(() => subscribeAlerts((events) => setAlerts((prev) => [...events, ...prev].slice(0, 60))), [subscribeAlerts]);

  useEffect(() => {
    const onNews = (n: NewsItem) => setNews((prev) => [n, ...prev].slice(0, 40));
    service.on('news', onNews);
    return () => {
      service.off('news', onNews);
    };
  }, [service]);

  useEffect(() => {
    if (tab !== 'stats') return;
    const id = setInterval(() => {
      const rows = buildStatsRows(
        analysis.sessionStats(),
        analysis.summary(),
        analysis.eventCounts,
        analysis.liquidityLevels(),
        getPressureSnapshot(),
        status,
        analysis.bookImbalance(),
        analysis,
        instrument.dec,
      );
      setStatRows(rows);
    }, 500);
    return () => clearInterval(id);
  }, [tab, analysis, status, getPressureSnapshot, instrument.dec]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.tabBar}>
        {(['signals', 'news', 'stats'] as Tab[]).map((t) => (
          <TabButton key={t} active={tab === t} label={t.toUpperCase()} onPress={() => setTab(t)} />
        ))}
      </View>

      {tab === 'signals' && (
        <FlatList
          data={alerts}
          keyExtractor={(a) => String(a.id)}
          renderItem={({ item }) => <AlertRow event={item} />}
          style={styles.list}
          ListEmptyComponent={<EmptyHint text="En attente d'événements (icebergs, sweeps, absorptions, murs...)" />}
        />
      )}

      {tab === 'news' && (
        <FlatList
          data={news}
          keyExtractor={(n, i) => `${n.cat}-${n.time}-${i}`}
          renderItem={({ item }) => <NewsRow item={item} />}
          style={styles.list}
          ListEmptyComponent={<EmptyHint text="En attente de la prochaine news simulée (1-3 min)" />}
        />
      )}

      {tab === 'stats' && (
        <FlatList
          data={statRows}
          keyExtractor={(r, i) => `${r.k}-${i}`}
          renderItem={({ item }) => <StatRowView row={item} />}
          style={styles.list}
          ListEmptyComponent={<EmptyHint text="En attente de données de session" />}
        />
      )}

      <View style={styles.scenarios}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.scenariosLabel}>
          SCÉNARIOS DE SIMULATION
        </ThemedText>
        <View style={[styles.scenarioGrid, { paddingBottom: BottomTabInset }]}>
          {SCENARIOS.map((s) => (
            <Pressable key={s.cmd} onPress={() => service.command(s.cmd)} style={styles.scenarioBtn}>
              <ThemedText type="small">{s.label}</ThemedText>
            </Pressable>
          ))}
          <Pressable onPress={() => service.fireNewsShock()} style={[styles.scenarioBtn, styles.newsShockBtn]}>
            <ThemedText type="small" style={{ color: RS }}>
              CHOC NEWS
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function TabButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.tabBtn, active && { borderBottomColor: OR }]}>
      <ThemedText type="smallBold" style={{ color: active ? theme.text : GREY }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <View style={styles.emptyHint}>
      <ThemedText type="small" themeColor="textSecondary">
        {text}
      </ThemedText>
    </View>
  );
}

function AlertRow({ event }: { event: PollEvent }) {
  const color = event.importance === 'high' ? RS : event.importance === 'med' ? OR : GREY;
  return (
    <View style={[styles.rowCard, { borderLeftColor: color }]}>
      <View style={styles.rowHeader}>
        <ThemedText type="smallBold" style={{ color }}>
          {event.type}
        </ThemedText>
        <ThemedText type="smallBold" style={{ color }}>
          {event.score}
        </ThemedText>
      </View>
      <ThemedText type="small">{event.expl}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {event.price} · {new Date(event.ts).toTimeString().slice(0, 8)}
      </ThemedText>
    </View>
  );
}

function NewsRow({ item }: { item: NewsItem }) {
  const color = item.imp === 'high' ? RS : item.imp === 'med' ? OR : GREY;
  return (
    <View style={[styles.rowCard, { borderLeftColor: color }]}>
      <View style={styles.rowHeader}>
        <ThemedText type="smallBold" style={{ color }}>
          {item.cat}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {item.phase.toUpperCase()}
        </ThemedText>
      </View>
      <ThemedText type="small">{item.title}</ThemedText>
      {item.phase === 'release' && (
        <ThemedText type="small" themeColor="textSecondary">
          att {item.expected} · réel {item.actual}
        </ThemedText>
      )}
      <ThemedText type="small" themeColor="textSecondary">
        {item.time}
      </ThemedText>
    </View>
  );
}

function StatRowView({ row }: { row: StatRow }) {
  if (row.section) {
    return (
      <ThemedView type="backgroundElement" style={styles.statSection}>
        <ThemedText type="smallBold" style={{ color: OR, letterSpacing: 1 }}>
          {row.section}
        </ThemedText>
      </ThemedView>
    );
  }
  return (
    <View style={styles.statRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {row.k}
      </ThemedText>
      <ThemedText type="code" style={{ color: row.c }}>
        {row.v}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  list: {
    flex: 1,
  },
  emptyHint: {
    padding: Spacing.four,
    alignItems: 'center',
  },
  rowCard: {
    borderLeftWidth: 2,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: 2,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statSection: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.15)',
  },
  scenarios: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.3)',
    paddingTop: Spacing.two,
  },
  scenariosLabel: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
    letterSpacing: 1,
  },
  scenarioGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.two,
    gap: Spacing.one,
  },
  scenarioBtn: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.3)',
    borderRadius: Spacing.one,
  },
  newsShockBtn: {
    borderColor: RS,
  },
});
