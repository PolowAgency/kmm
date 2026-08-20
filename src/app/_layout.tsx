import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, type ColorSchemeName } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { ThemedView } from '@/components/themed-view';
import { TerminalEngineProvider } from '@/engine/TerminalEngineContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { queryClient } from '@/lib/queryClient';
import { useAuthStore } from '@/stores/authStore';

SplashScreen.preventAutoHideAsync();

/**
 * Root navigation gate.
 *
 * The existing app (4 tabs — Accueil/Terminal/Signals/Lens, out of scope for this change) is
 * rendered exactly as before via `<AppTabs />`, but only once `accessState === 'ready'`. Every
 * other state renders a completely separate `<Stack>` of auth/gating screens instead — there is no
 * shared navigator between the two, so the tabs are structurally unreachable (no route, no deep
 * link, no back-button path) until access has been confirmed. `Stack.Protected` picks which of the
 * gating screens is mounted based on `accessState`; see docs.expo.dev/versions/v57.0.0 (Protected
 * Routes) for the pattern this follows.
 */
function AccessGate({
  accessState,
  colorScheme,
}: {
  accessState: 'unauthenticated' | 'no_subscription' | 'device_limit';
  colorScheme: ColorSchemeName;
}) {
  const theme = colorScheme === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <ThemeProvider value={theme}>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Each guard is mutually exclusive with accessState, so exactly one group is ever
            registered as navigable — the others are excluded from the route table entirely
            (expo-router's Stack.Protected), not just visually hidden. */}
        <Stack.Protected guard={accessState === 'unauthenticated'}>
          <Stack.Screen name="(auth)/login" />
          <Stack.Screen name="(auth)/verify" />
        </Stack.Protected>
        <Stack.Protected guard={accessState === 'no_subscription'}>
          <Stack.Screen name="no-access" />
        </Stack.Protected>
        <Stack.Protected guard={accessState === 'device_limit'}>
          <Stack.Screen name="devices" />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

function LoadingGate() {
  return (
    <ThemedView style={styles.loading}>
      <ActivityIndicator />
    </ThemedView>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const accessState = useAuthStore((s) => s.accessState);
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    // Racine requise par react-native-gesture-handler (sinon les gestes ne fonctionnent pas du
    // tout sur Android, et de façon inconstante sur iOS) — ajouté pour les gestes du Market Lens
    // (voir MarketLensCanvasInner.tsx), mais doit englober toute l'app par convention de la lib,
    // pas juste l'écran concerné.
    <GestureHandlerRootView style={styles.root}>
      <QueryClientProvider client={queryClient}>
        <AnimatedSplashOverlay />
        {accessState === 'loading' ? (
          <LoadingGate />
        ) : accessState === 'ready' ? (
          <TerminalEngineProvider>
            <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
              <AppTabs />
            </ThemeProvider>
          </TerminalEngineProvider>
        ) : (
          <AccessGate accessState={accessState} colorScheme={colorScheme} />
        )}
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
