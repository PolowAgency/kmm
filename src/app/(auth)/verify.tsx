import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuthStore } from '@/stores/authStore';

/** Step 2: enter the 6-digit OTP code emailed by `signInWithOtp`, verified via `verifyOtp`. */
export default function VerifyScreen() {
  const theme = useTheme();
  const pendingEmail = useAuthStore((s) => s.pendingEmail);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const requestOtp = useAuthStore((s) => s.requestOtp);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reached directly (e.g. app relaunched mid-flow) without an email pending verification —
  // there's nothing to verify, send back to the start of the flow.
  if (!pendingEmail) {
    return <Redirect href="/(auth)/login" />;
  }

  const handleSubmit = async () => {
    if (code.trim().length < 6) {
      setError('Entre le code à 6 chiffres reçu par e-mail.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error: verifyError } = await verifyOtp(code.trim());
    setLoading(false);
    if (verifyError) {
      setError(verifyError);
    }
    // On success the auth store's accessState moves off 'unauthenticated' and the root layout
    // swaps navigators on its own — no explicit navigation needed here.
  };

  const handleResend = async () => {
    setResending(true);
    setError(null);
    await requestOtp(pendingEmail);
    setResending(false);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.form}>
          <ThemedText type="title" style={styles.title}>
            Code de vérification
          </ThemedText>
          <ThemedText type="small" style={styles.subtitle}>
            Entre le code à 6 chiffres envoyé à {pendingEmail}.
          </ThemedText>

          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            placeholderTextColor={theme.textSecondary}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={6}
            style={[
              styles.input,
              styles.codeInput,
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
                Valider
              </ThemedText>
            )}
          </Pressable>

          <Pressable onPress={handleResend} disabled={resending} style={styles.linkButton}>
            <ThemedText type="link" themeColor="textSecondary">
              {resending ? 'Envoi…' : "Je n'ai pas reçu de code — renvoyer"}
            </ThemedText>
          </Pressable>

          <Pressable onPress={() => router.replace('/(auth)/login')} style={styles.linkButton}>
            <ThemedText type="link" themeColor="textSecondary">
              Changer d&apos;adresse e-mail
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
  codeInput: { textAlign: 'center', fontSize: 28, letterSpacing: 8 },
  button: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkButton: { alignItems: 'center', paddingVertical: Spacing.one },
  error: { color: '#e5484d', textAlign: 'center' },
});
