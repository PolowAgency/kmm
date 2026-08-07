import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDevices, useRevokeDevice, type RevokeDeviceError } from '@/hooks/useDevices';
import { useAuthStore } from '@/stores/authStore';
import type { DeviceRow } from '@/types/devices';

const dateFormatter = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

function formatAvailableAt(iso: string | undefined): string {
  if (!iso) return 'bientôt';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'bientôt';
  return dateFormatter.format(date);
}

/**
 * Device management: lists this user's `devices` rows (RLS-scoped to the caller) and lets them
 * revoke one. Reached automatically when `register_device` returns `'device_limit_reached'` — in
 * that case the banner below explains why a 3rd device got blocked. There's currently no manual
 * entry point into this screen from within the signed-in app (the existing tabs/home screen are
 * out of scope for this change), so today it's only reachable via that automatic gate.
 */
export default function DevicesScreen() {
  const theme = useTheme();
  const accessState = useAuthStore((s) => s.accessState);
  const signOut = useAuthStore((s) => s.signOut);
  const { data: devices, isLoading, isError, refetch, isFetching } = useDevices();
  const revokeDevice = useRevokeDevice();
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const handleRevoke = async (device: DeviceRow) => {
    setRevokingId(device.id);
    setBanner(null);
    try {
      await revokeDevice.mutateAsync(device.device_id);
    } catch (err) {
      const revokeError = err as RevokeDeviceError;
      if (revokeError.message === 'cooldown') {
        setBanner(`Tu pourras révoquer un appareil à partir du ${formatAvailableAt(revokeError.availableAt)}.`);
      } else {
        setBanner(revokeError.message || "La révocation a échoué. Réessaie plus tard.");
      }
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>
          Tes appareils
        </ThemedText>

        {accessState === 'device_limit' ? (
          <ThemedView type="backgroundElement" style={styles.banner}>
            <ThemedText type="small">
              Ce nouvel appareil a été bloqué : tu as déjà atteint la limite d&apos;appareils actifs.
              Révoque un appareil ci-dessous pour libérer une place.
            </ThemedText>
          </ThemedView>
        ) : null}

        {banner ? (
          <ThemedView type="backgroundElement" style={styles.banner}>
            <ThemedText type="small">{banner}</ThemedText>
          </ThemedView>
        ) : null}

        {isLoading ? (
          <ActivityIndicator style={styles.spinner} />
        ) : isError ? (
          <ThemedView style={styles.card}>
            <ThemedText type="small">
              Impossible de charger la liste des appareils pour le moment.
            </ThemedText>
            <Pressable onPress={() => refetch()} style={styles.linkButton}>
              <ThemedText type="linkPrimary">Réessayer</ThemedText>
            </Pressable>
          </ThemedView>
        ) : (
          <FlatList
            data={devices ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshing={isFetching}
            onRefresh={refetch}
            ListEmptyComponent={
              <ThemedText type="small" style={styles.empty}>
                Aucun appareil enregistré pour le moment.
              </ThemedText>
            }
            renderItem={({ item }) => {
              const isRevoked = item.status !== 'active';
              return (
                <ThemedView type="backgroundElement" style={[styles.deviceCard, isRevoked && styles.deviceCardRevoked]}>
                  <View style={styles.deviceInfo}>
                    <ThemedText type="smallBold">{item.device_name ?? 'Appareil'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {[item.os, item.os_version].filter(Boolean).join(' ')}
                      {item.app_version ? ` · v${item.app_version}` : ''}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {isRevoked ? 'Révoqué' : 'Actif'}
                    </ThemedText>
                  </View>
                  {!isRevoked ? (
                    <Pressable
                      onPress={() => handleRevoke(item)}
                      disabled={revokingId === item.id}
                      style={[styles.revokeButton, { borderColor: theme.textSecondary }]}>
                      {revokingId === item.id ? (
                        <ActivityIndicator size="small" color={theme.text} />
                      ) : (
                        <ThemedText type="small" style={styles.revokeLabel}>
                          Révoquer
                        </ThemedText>
                      )}
                    </Pressable>
                  ) : null}
                </ThemedView>
              );
            }}
          />
        )}

        {accessState === 'device_limit' ? (
          <Pressable onPress={() => signOut()} style={styles.linkButton}>
            <ThemedText type="link" themeColor="textSecondary">
              Se déconnecter
            </ThemedText>
          </Pressable>
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.four, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  title: { paddingTop: Spacing.three },
  banner: { padding: Spacing.three, borderRadius: Spacing.two },
  spinner: { marginTop: Spacing.four },
  card: { gap: Spacing.two, alignItems: 'center' },
  empty: { textAlign: 'center', opacity: 0.6, paddingTop: Spacing.four },
  list: { gap: Spacing.two, paddingBottom: Spacing.four },
  deviceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.two,
  },
  deviceCardRevoked: { opacity: 0.5 },
  deviceInfo: { gap: 2, flexShrink: 1 },
  revokeButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  revokeLabel: { color: '#e5484d' },
  linkButton: { alignItems: 'center', paddingVertical: Spacing.two },
});
