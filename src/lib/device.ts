import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Stable, app-generated device identity used for the `devices` table / `register_device` RPC.
 *
 * We deliberately do NOT rely on OS-provided identifiers (IDFV, Android ID, etc.) — they behave
 * inconsistently across iOS/Android and Expo Go vs. dev/production builds (IDFV resets when all of
 * a vendor's apps are uninstalled, Android ID can differ per signing key, neither exists the same
 * way under Expo Go). A SecureStore-persisted, generated-once UUID is the simplest thing that is
 * actually stable across app restarts and reliable across every one of those environments.
 */

const DEVICE_ID_KEY = 'kmm_device_id';

// The device id itself is a single short UUID string, always well under SecureStore's ~2KB limit —
// no need to route it through the chunking adapter used for the (much larger) Supabase session.
async function getSecureItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(key) : null;
  }
  return SecureStore.getItemAsync(key);
}

async function setSecureItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

let cachedDeviceId: string | null = null;

/** Get the persisted device UUID, generating and persisting one on first call. */
export async function getOrCreateDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  const existing = await getSecureItem(DEVICE_ID_KEY);
  if (existing) {
    cachedDeviceId = existing;
    return existing;
  }

  const generated = Crypto.randomUUID();
  await setSecureItem(DEVICE_ID_KEY, generated);
  cachedDeviceId = generated;
  return generated;
}

export interface DeviceIdentity {
  deviceId: string;
  deviceName: string;
  os: string;
  osVersion: string;
  appVersion: string;
}

/** Collects everything `register_device` needs, generating the persisted device id if needed. */
export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  const deviceId = await getOrCreateDeviceId();

  const deviceName = Device.modelName ?? Device.deviceName ?? 'Appareil inconnu';
  const os = Device.osName ?? Platform.OS;
  const osVersion = Device.osVersion ?? String(Platform.Version ?? 'inconnue');
  const appVersion =
    Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0';

  return { deviceId, deviceName, os, osVersion, appVersion };
}
