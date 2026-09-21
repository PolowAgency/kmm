import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InstrumentSwitcher } from '@/components/instrument-switcher';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { DomTapeEngine, type DomRow, type DomHeadStat, type TapeRow } from '@/engine/domTapeEngine';
import { useTerminalEngine } from '@/engine/TerminalEngineContext';

const CY = '#35c8e0'; // acheteurs
const RS = '#e5484d'; // vendeurs
const OR = '#e8822a'; // murs / accent

/**
 * Écran DOM (profondeur de carnet) + Time & Sales — port depuis le terminal web
 * (TERMINAL/app/terminal-v2/components/modules/dom-tape/), qui rend déjà ces deux modules en
 * HTML/CSS classique plutôt qu'en canvas : donc pas de réécriture de rendu ici, juste une
 * traduction View/Text/FlatList du même DomTapeEngine (voir @/engine/domTapeEngine.ts).
 *
 * Cadence de lecture (150ms) proche de la référence (uiTick, ~130ms) — DomTapeEngine.snapshot()
 * ne coûte cher que sur ~20 niveaux de carnet + 32 lignes de tape, donc un re-render React à
 * cette fréquence reste largement dans le budget d'une frame mobile.
 */
export default function TerminalScreen() {
  const { instrument, service } = useTerminalEngine();
  const engineRef = useRef<DomTapeEngine | null>(null);
  const [domRows, setDomRows] = useState<DomRow[]>([]);
  const [domHead, setDomHead] = useState<DomHeadStat[]>([]);
  const [tape, setTape] = useState<TapeRow[]>([]);
  const [tapeCum, setTapeCum] = useState('0');
  const [tapeD1, setTapeD1] = useState('0');

  useEffect(() => {
    const engine = new DomTapeEngine(instrument);
    engineRef.current = engine;
    const onBook = engine.handleBook.bind(engine);
    const onTrade = engine.handleTrade.bind(engine);
    service.on('book', onBook).on('trade', onTrade);
    return () => {
      service.off('book', onBook).off('trade', onTrade);
    };
  }, [instrument, service]);

  useEffect(() => {
    const id = setInterval(() => {
      const snap = engineRef.current?.snapshot('all');
      if (!snap) return;
      setDomRows(snap.domRows);
      setDomHead(snap.domHead);
      setTape(snap.tape);
      setTapeCum(snap.tapeCum);
      setTapeD1(snap.tapeD1);
    }, 150);
    return () => clearInterval(id);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <InstrumentSwitcher />
        <ThemedText type="small" themeColor="textSecondary">
          {instrument.name}
        </ThemedText>
      </View>

      <ThemedView type="backgroundElement" style={styles.headStats}>
        {domHead.map((h) => (
          <View key={h.k} style={styles.headStat}>
            <ThemedText type="small" themeColor="textSecondary">
              {h.k}
            </ThemedText>
            <ThemedText type="code" style={{ color: h.sign > 0 ? CY : h.sign < 0 ? RS : undefined }}>
              {h.v}
            </ThemedText>
          </View>
        ))}
      </ThemedView>

      <View style={styles.domSection}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
          PROFONDEUR
        </ThemedText>
        <FlatList
          data={domRows}
          keyExtractor={(row, i) => `${row.kind}-${row.price}-${i}`}
          renderItem={({ item }) => <DomRowView row={item} />}
          style={styles.domList}
        />
      </View>

      <View style={styles.tapeSection}>
        <View style={styles.tapeHeader}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
            TIME & SALES
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            VOL {tapeCum} · Δ1S{' '}
            <ThemedText type="smallBold" style={{ color: tapeD1.startsWith('+') ? CY : RS }}>
              {tapeD1}
            </ThemedText>
          </ThemedText>
        </View>
        <FlatList
          data={tape}
          keyExtractor={(row, i) => `${row.time}-${i}`}
          renderItem={({ item }) => <TapeRowView row={item} />}
          style={[styles.tapeList, { paddingBottom: BottomTabInset }]}
        />
      </View>
    </SafeAreaView>
  );
}

function DomRowView({ row }: { row: DomRow }) {
  if (row.kind === 'mid') {
    return (
      <View style={[styles.domRow, styles.midRow]}>
        <ThemedText type="code" style={styles.midPrice}>
          {row.price}
        </ThemedText>
      </View>
    );
  }
  const isBid = row.side === 'bid';
  const fillColor = isBid ? 'rgba(53,200,224,0.16)' : 'rgba(229,72,77,0.14)';
  return (
    <View style={[styles.domRow, row.priceIsLast && styles.lastPriceRow]}>
      <View style={[styles.fillBar, { width: `${row.pct}%`, backgroundColor: fillColor, [isBid ? 'right' : 'left']: 0 }]} />
      <ThemedText type="code" style={[styles.domCell, styles.domCellBid, { color: row.wallHeavy && isBid ? '#9fe4f2' : CY }]}>
        {row.bid}
      </ThemedText>
      <ThemedText type="small" style={[styles.domDelta, { color: row.dSign > 0 ? CY : row.dSign < 0 ? RS : 'transparent' }]}>
        {row.db}
      </ThemedText>
      <ThemedText type="code" style={[styles.domPrice, row.priceIsBest && styles.domPriceBest, row.priceIsLast && { color: OR }]}>
        {row.price}
      </ThemedText>
      <ThemedText type="small" style={[styles.domDelta, { color: row.dSign > 0 ? CY : row.dSign < 0 ? RS : 'transparent' }]}>
        {row.da}
      </ThemedText>
      <ThemedText type="code" style={[styles.domCell, styles.domCellAsk, { color: row.wallHeavy && !isBid ? '#f4a6a8' : RS }]}>
        {row.ask}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.domVol}>
        {row.vol}
      </ThemedText>
      <ThemedText type="smallBold" style={[styles.domWall, { color: row.wallHeavy ? OR : 'transparent' }]}>
        {row.wall}
      </ThemedText>
    </View>
  );
}

function TapeRowView({ row }: { row: TapeRow }) {
  const color = row.side === 'B' ? CY : RS;
  return (
    <View style={[styles.tapeRow, row.big && styles.tapeRowBig]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.tapeTime}>
        {row.time}
      </ThemedText>
      <ThemedText type="code" style={[styles.tapePrice, { color, fontWeight: row.big ? '700' : '400' }]}>
        {row.price}
      </ThemedText>
      <ThemedText type="small" style={[styles.tapeSize, { color }]}>
        {row.size}
      </ThemedText>
      {!!row.tag && (
        <ThemedText type="small" style={styles.tapeTag} themeColor="textSecondary">
          {row.tag}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  headStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: Spacing.two,
    marginHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  headStat: {
    alignItems: 'center',
    gap: 2,
  },
  domSection: {
    flex: 1.1,
    paddingTop: Spacing.two,
  },
  tapeSection: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.3)',
    paddingTop: Spacing.two,
  },
  sectionLabel: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
    letterSpacing: 1,
  },
  domList: {
    flex: 1,
    paddingHorizontal: Spacing.three,
  },
  domRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 22,
    overflow: 'hidden',
  },
  midRow: {
    justifyContent: 'center',
    height: 26,
  },
  lastPriceRow: {
    backgroundColor: 'rgba(232,130,42,0.06)',
  },
  midPrice: {
    color: OR,
    fontWeight: '700',
  },
  fillBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  domCell: {
    width: 48,
    textAlign: 'right',
    fontSize: 11,
  },
  domCellBid: {
    marginRight: 4,
  },
  domCellAsk: {
    marginLeft: 4,
  },
  domDelta: {
    width: 32,
    fontSize: 9,
    textAlign: 'center',
  },
  domPrice: {
    width: 66,
    textAlign: 'center',
    fontSize: 11,
  },
  domPriceBest: {
    fontWeight: '700',
  },
  domVol: {
    width: 44,
    textAlign: 'right',
    fontSize: 9,
  },
  domWall: {
    width: 30,
    textAlign: 'right',
    fontSize: 9,
  },
  tapeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
  },
  tapeList: {
    flex: 1,
    paddingHorizontal: Spacing.three,
  },
  tapeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 20,
    gap: Spacing.two,
  },
  tapeRowBig: {
    backgroundColor: 'rgba(232,130,42,0.08)',
  },
  tapeTime: {
    width: 76,
    fontSize: 9,
  },
  tapePrice: {
    width: 64,
    fontSize: 11,
  },
  tapeSize: {
    width: 40,
    textAlign: 'right',
    fontSize: 10,
  },
  tapeTag: {
    fontSize: 8,
    letterSpacing: 0.5,
  },
});
