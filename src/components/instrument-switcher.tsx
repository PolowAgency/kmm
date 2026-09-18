import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTerminalEngine } from '@/engine/TerminalEngineContext';
import { INSTRUMENTS } from '@/engine/instruments';
import { useTheme } from '@/hooks/use-theme';

type InstrumentOption = { code: string; name: string; grp: string };
type InstrumentGroup = { grp: string; items: InstrumentOption[] };

/**
 * Sélecteur d'instrument plein catalogue — jusqu'ici il n'existait tout simplement AUCUN moyen de
 * changer d'instrument dans l'app (chaque écran affichait `instrument.code` en texte statique, et
 * `TerminalEngineContext.setSymbol` n'était appelé nulle part). `useState('GC')` figeait l'app sur
 * Micro Gold en permanence. Port du même besoin déjà comblé côté web mobile (voir
 * TERMINAL/app/terminal-v2/components/chrome/TopBar.tsx, MobileTopBar) : accès à tout le
 * catalogue (`INSTRUMENTS`), pas seulement aux 8 symboles d'`INSTRUMENT_QUICKLIST`.
 *
 * Un simple Pressable + Modal plutôt qu'un <select> natif (qui n'existe pas en React Native) :
 * liste groupée par classe d'actif (grp), avec `useTerminalEngine().symbol` déjà en surbrillance.
 */
export function InstrumentSwitcher() {
  const { symbol, setSymbol } = useTerminalEngine();
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const groups = useMemo<InstrumentGroup[]>(() => {
    const byGrp = new Map<string, InstrumentOption[]>();
    for (const ins of Object.values(INSTRUMENTS)) {
      const list = byGrp.get(ins.grp) ?? [];
      list.push({ code: ins.code, name: ins.name, grp: ins.grp });
      byGrp.set(ins.grp, list);
    }
    return Array.from(byGrp.entries()).map(([grp, items]) => ({ grp, items }));
  }, []);

  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={8} style={styles.trigger}>
        <ThemedText type="smallBold">{symbol}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          ▾
        </ThemedText>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={styles.sheetHeader}>
            <ThemedText type="smallBold">Choisir un instrument</ThemedText>
            <Pressable onPress={() => setOpen(false)} hitSlop={8}>
              <ThemedText type="small" themeColor="textSecondary">
                Fermer
              </ThemedText>
            </Pressable>
          </View>
          <FlatList
            data={groups}
            keyExtractor={(g) => g.grp}
            contentContainerStyle={styles.listContent}
            renderItem={({ item: group }) => (
              <View style={styles.group}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.groupLabel}>
                  {group.grp}
                </ThemedText>
                {group.items.map((ins) => {
                  const active = ins.code === symbol;
                  return (
                    <Pressable
                      key={ins.code}
                      onPress={() => {
                        setSymbol(ins.code);
                        setOpen(false);
                      }}
                      style={[styles.row, active && { backgroundColor: theme.backgroundElement }]}
                    >
                      <ThemedText type="smallBold" style={active ? { color: theme.sideBid } : undefined}>
                        {ins.code}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {ins.name}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            )}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    maxHeight: '75%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  listContent: {
    paddingBottom: Spacing.four,
  },
  group: {
    paddingTop: Spacing.two,
  },
  groupLabel: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.one,
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    marginHorizontal: Spacing.two,
  },
});
