import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { AUC_DICT, type AuctionState } from '@/engine/marketLensEngine';

const GREEN = '#38d296'; // acceptation / acheteurs — voir LENS.green côté web (distinct de sideBid)
const RED = '#e5484d';
const YELLOW = '#e8b23a';
// Carte à fond sombre fixe (comme la référence web, voir LENS.ink) quel que soit le thème clair/
// sombre de l'OS — pas de theme.text ici : sur thème clair, theme.text est noir et devient
// invisible sur ce fond, contrairement aux couleurs GREEN/RED/YELLOW ci-dessus qui restent
// lisibles dans les deux cas.
const VALUE_TEXT = '#c6cfd8'; // LENS.value côté web

function controlColor(v: number): string {
  return v >= 70 ? GREEN : v >= 40 ? YELLOW : RED;
}

/**
 * Carte "AUCTION ASSISTANT" — port du panneau homonyme côté web
 * (TERMINAL/app/terminal-v2/components/modules/lens/lensEngine.ts, drawAuctionAssistant()), lui
 * aussi retravaillé cette semaine côté web pour rester lisible sur petit écran. Ici en
 * View/Text plutôt qu'en canvas (même choix que les cartes murs/événements de
 * MarketLensCanvasInner) : le panneau est presque entièrement textuel, la mise en page RN gère le
 * retour à la ligne bien mieux qu'un layout canvas à largeur fixe.
 *
 * Volontairement plus condensé que la référence : pas de résumé en clair (sumKey), pas de
 * timeline — l'écran est plus contraint qu'un desktop, et ces deux blocs sont les moins
 * actionnables des lignes du panneau (voir l'équivalent narrow3/compact3 côté web, qui les
 * masque déjà en dessous d'une certaine taille).
 */
export function AuctionAssistantCard({ state }: { state: AuctionState | null }) {
  if (!state || !state.conf) return null;

  const ctlColor = state.ctl === 'buyers' ? GREEN : state.ctl === 'sellers' ? RED : YELLOW;
  const ctlLabel = state.ctl === 'buyers' ? AUC_DICT.buyersW : state.ctl === 'sellers' ? AUC_DICT.sellersW : AUC_DICT.rotW;
  const dayCtl = state.dayGauge > 10 ? 'buyers' : state.dayGauge < -10 ? 'sellers' : 'rot';
  const dayColor = dayCtl === 'buyers' ? GREEN : dayCtl === 'sellers' ? RED : YELLOW;
  const dayLabel = dayCtl === 'buyers' ? AUC_DICT.buyersW : dayCtl === 'sellers' ? AUC_DICT.sellersW : AUC_DICT.rotW;

  const stateLabel = state.inLvnNow ? AUC_DICT.inLvnT : state.activeZone && !state.activeZone.lvn ? AUC_DICT.inHvnT : ctlLabel;

  return (
    <View style={[styles.card, { backgroundColor: 'rgba(7,8,11,0.94)', borderColor: 'rgba(255,255,255,0.08)' }]}>
      <View style={styles.headerRow}>
        <ThemedText type="code" style={styles.title}>
          {AUC_DICT.title}
        </ThemedText>
        <ThemedText type="code" style={{ color: controlColor(state.mktConf), fontSize: 10 }}>
          {AUC_DICT.mconf} {state.mktConf}/100
        </ThemedText>
      </View>
      <View style={[styles.confBarTrack, { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
        <View style={[styles.confBarFill, { width: `${state.mktConf}%`, backgroundColor: controlColor(state.mktConf) }]} />
      </View>

      <Row k={AUC_DICT.ctlNow} v={ctlLabel} color={ctlColor} />
      <Row k={AUC_DICT.ctlDay} v={dayLabel} color={dayColor} />
      <Row k={AUC_DICT.stateK} v={stateLabel} color={VALUE_TEXT} />

      <Row
        k={AUC_DICT.probK}
        v={`${state.pCont}% ${AUC_DICT.probCont} · ${100 - state.pCont}% ${AUC_DICT.probRev}`}
        color={state.pCont >= 58 ? GREEN : state.pCont <= 42 ? RED : YELLOW}
      />

      <View style={styles.gaugeRow}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.gaugeLabel}>
          {AUC_DICT.cpK}
        </ThemedText>
        <ThemedText type="code" style={{ color: GREEN, fontSize: 10 }}>
          {state.buyPct}%
        </ThemedText>
        <View style={styles.gaugeTrack}>
          <View style={[styles.gaugeFill, { width: `${state.buyPct}%`, backgroundColor: GREEN }]} />
        </View>
        <ThemedText type="code" style={{ color: RED, fontSize: 10 }}>
          {100 - state.buyPct}%
        </ThemedText>
      </View>

      {state.nextLvl && (
        <Row
          k={AUC_DICT.nextK}
          v={`${state.nextLvl.key} · ${Math.round(state.nextLvl.d)} ${AUC_DICT.distK} · ${'★'.repeat(state.nextLvl.stars)}${'☆'.repeat(5 - state.nextLvl.stars)}`}
          color={YELLOW}
        />
      )}

      {(state.inLvnNow || (state.activeZone && !state.activeZone.lvn)) && (
        <Row k="" v={state.inLvnNow ? AUC_DICT.fastZone : AUC_DICT.slowZone} color={state.inLvnNow ? '#af91e6' : '#7391b9'} />
      )}

      {state.risks.length > 0 && (
        <View style={styles.risksBlock}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.risksLabel}>
            {AUC_DICT.risksK}
          </ThemedText>
          {state.risks.slice(0, 3).map(([tone, key], i) => (
            <ThemedText key={`${key}-${i}`} type="small" style={{ color: tone === 'g' ? GREEN : YELLOW, fontSize: 10 }}>
              {tone === 'g' ? '✓ ' : '⚠ '}
              {AUC_DICT[key] || key}
            </ThemedText>
          ))}
        </View>
      )}
    </View>
  );
}

function Row({ k, v, color }: { k: string; v: string; color: string }) {
  return (
    <View style={styles.row}>
      {!!k && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.rowKey}>
          {k}
        </ThemedText>
      )}
      <ThemedText type="code" style={[styles.rowValue, { color }]}>
        {v}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    gap: 4,
    maxWidth: 240,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    fontFamily: Fonts.mono,
  },
  confBarTrack: {
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
  },
  confBarFill: {
    height: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  rowKey: {
    fontSize: 9,
    flexShrink: 0,
  },
  rowValue: {
    fontSize: 10,
    flexShrink: 1,
    textAlign: 'right',
  },
  gaugeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  gaugeLabel: {
    fontSize: 9,
    flexShrink: 0,
  },
  gaugeTrack: {
    flex: 1,
    height: 3,
    borderRadius: 1.5,
    overflow: 'hidden',
    backgroundColor: 'rgba(229,72,77,0.35)',
  },
  gaugeFill: {
    height: 3,
  },
  risksBlock: {
    marginTop: 2,
    gap: 1,
  },
  risksLabel: {
    fontSize: 9,
    letterSpacing: 0.5,
  },
});
