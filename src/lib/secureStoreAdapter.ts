import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * SecureStore-backed storage adapter for Supabase's `auth.storage`.
 *
 * SecureStore wraps the iOS Keychain / Android Keystore, which historically reject values above
 * roughly 2048 bytes on some iOS versions (no such limit is documented for Android, but we apply
 * the same conservative threshold everywhere for one consistent code path). Supabase's persisted
 * session JSON (access token + refresh token + user object, incl. `user_metadata`) routinely
 * exceeds that — a raw `SecureStore.setItemAsync(key, session)` call will intermittently throw on
 * device once the session grows past the limit, which is exactly the kind of bug that only shows
 * up in production on iOS. Chunking below the limit is the standard workaround (SecureStore has no
 * built-in support for large values, unlike AsyncStorage) and keeps every byte encrypted at rest —
 * unlike the common alternative pattern of storing an AES-encrypted blob in plain AsyncStorage with
 * only the encryption key in SecureStore, chunking needs no extra crypto dependency.
 *
 * Layout for a given `key`:
 *   `${key}__chunks` -> stringified chunk count (absence means "no value stored")
 *   `${key}__0`, `${key}__1`, ... -> the value split into <=CHUNK_SIZE-char slices
 *
 * expo-secure-store has no web implementation at all (`ExpoSecureStore.web.ts` in the package
 * exports an empty object — calling any method throws `TypeError: ... is not a function`). This
 * repo builds for web too (`expo export --platform web`, react-native-web), and this same
 * .tsx/.web split concern already exists elsewhere in the codebase for exactly this reason
 * (Skia canvas), so on web this adapter falls back to `window.localStorage` directly instead of
 * SecureStore — same interface, no extra dependency, and no size limit worth chunking for.
 */

// Comfortably under the ~2048 byte historical iOS ceiling, with headroom for multi-byte UTF-8
// (base64 JWT content is ASCII so 1 char == 1 byte in practice, but stay conservative).
const CHUNK_SIZE = 1800;

const chunkCountKey = (key: string) => `${key}__chunks`;
const chunkKey = (key: string, index: number) => `${key}__${index}`;

async function readChunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(chunkCountKey(key));
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const nativeAdapter = {
  async getItem(key: string): Promise<string | null> {
    const count = await readChunkCount(key);
    if (count === 0) {
      // Backward-compatible fallback in case a previous version wrote an unchunked value directly.
      return SecureStore.getItemAsync(key);
    }
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part == null) {
        // A chunk went missing (e.g. storage cleared partially) — treat the whole value as gone
        // rather than returning corrupt/truncated session data.
        return null;
      }
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const previousCount = await readChunkCount(key);

    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    // An empty value still needs at least one (empty) chunk so getItem's count check round-trips.
    if (chunks.length === 0) chunks.push('');

    await Promise.all(chunks.map((chunk, i) => SecureStore.setItemAsync(chunkKey(key, i), chunk)));
    await SecureStore.setItemAsync(chunkCountKey(key), String(chunks.length));

    // Clean up any leftover chunks from a previous, longer value.
    if (previousCount > chunks.length) {
      await Promise.all(
        Array.from({ length: previousCount - chunks.length }, (_, i) =>
          SecureStore.deleteItemAsync(chunkKey(key, chunks.length + i))
        )
      );
    }
    // Also remove a legacy unchunked value if one exists from before this adapter shipped.
    await SecureStore.deleteItemAsync(key).catch(() => undefined);
  },

  async removeItem(key: string): Promise<void> {
    const count = await readChunkCount(key);
    await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(chunkKey(key, i))));
    await SecureStore.deleteItemAsync(chunkCountKey(key));
    await SecureStore.deleteItemAsync(key).catch(() => undefined);
  },
};

// `typeof window` guard also covers static export's Node-side prerendering pass, where `window`
// doesn't exist at all yet `Platform.OS` still reports `'web'`.
const hasWindowLocalStorage = () => typeof window !== 'undefined' && !!window.localStorage;

const webAdapter = {
  async getItem(key: string): Promise<string | null> {
    if (!hasWindowLocalStorage()) return null;
    return window.localStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!hasWindowLocalStorage()) return;
    window.localStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (!hasWindowLocalStorage()) return;
    window.localStorage.removeItem(key);
  },
};

export const chunkedSecureStoreAdapter = Platform.OS === 'web' ? webAdapter : nativeAdapter;
