import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuthStore } from '@/stores/authStore';

/**
 * Step 1 of the auth flow: email in, OTP code sent by Supabase (`signInWithOtp` with
 * `shouldCreateUser: false` — accounts are provisioned server-side via Stripe + invite, see
 * ARCHITECTURE.md §4, not created from the app). Supabase emails both a magic link and a 6-digit
 * code from this one call; we only build the code-entry path here (see verify.tsx) since deep-link
 * handling on mobile is comparatively fragile.
 */
export default function LoginScreen() {
  const theme = useTheme();
  const requestOtp = useAuthStore((s) => s.requestOtp);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Entre ton adresse e-mail.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: reqError } = await requestOtp(trimmed);
    setLoading(false);
    if (reqError) {
      setError(reqError);
      return;
    }
    router.push('/(auth)/verify');
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.select({ ios: 'padding', default: undefined })}
          style={styles.form}>
          <ThemedText type="title" style={styles.title}>
            KMM Trade Hub
          </ThemedText>
          <ThemedText type="small" style={styles.subtitle}>
            Connecte-toi avec l&apos;adresse e-mail de ton compte. Tu recevras un code à 6 chiffres.
          </ThemedText>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="ton@email.com"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            style={[
              styles.input,
              { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
            ]}
            editable={!loading}
            onSubmitEditing={handleSubmit}
          />

          {error ? (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          ) : null}

          <Pressable
            onPress={handleSubmit}
            disabled={loading}
            style={[styles.button, { backgroundColor: theme.text, opacity: loading ? 0.6 : 1 }]}>
            {loading ? (
              <ActivityIndicator color={theme.background} />
            ) : (
              <ThemedText type="smallBold" themeColor="background">
                Recevoir le code
              </ThemedText>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four },
  form: { width: '100%', maxWidth: MaxContentWidth, gap: Spacing.three },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center', opacity: 0.7 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  button: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { color: '#e5484d', textAlign: 'center' },
});
