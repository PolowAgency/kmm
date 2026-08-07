import { Linking, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuthStore } from '@/stores/authStore';

const SUPPORT_EMAIL = 'contact@kmmtradehub.com';

/**
 * Shown when `register_device` returns `'no_active_subscription'`.
 *
 * App Store / Play Store compliance: this screen must never mention price, show a subscribe
 * button, or link to any purchase flow — access here is provisioned server-side (Stripe on the
 * web, ARCHITECTURE.md §4/§7), never sold in-app. Just a neutral message + a support contact.
 */
export default function NoAccessScreen() {
  const theme = useTheme();
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.card}>
          <ThemedText type="title" style={styles.title}>
            Aucun accès actif
          </ThemedText>
          <ThemedText type="default" style={styles.body}>
            Ton compte n&apos;a pas d&apos;accès actif pour le moment. Si tu penses qu&apos;il
            s&apos;agit d&apos;une erreur, contacte le support — on regarde ça avec toi.
          </ThemedText>

          <Pressable
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
            style={[styles.button, { backgroundColor: theme.text }]}>
            <ThemedText type="smallBold" themeColor="background">
              Contacter le support
            </ThemedText>
          </Pressable>

          <Pressable onPress={() => signOut()} style={styles.linkButton}>
            <ThemedText type="link" themeColor="textSecondary">
              Se déconnecter
            </ThemedText>
          </Pressable>
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four },
  card: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', opacity: 0.8 },
  button: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkButton: { alignItems: 'center', paddingVertical: Spacing.one },
});
