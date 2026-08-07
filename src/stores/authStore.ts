import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

import { registerCurrentDevice } from '@/lib/registerDevice';
import { supabase } from '@/lib/supabase';

export type AccessState = 'loading' | 'unauthenticated' | 'no_subscription' | 'device_limit' | 'ready';

interface AuthStoreState {
  session: Session | null;
  user: User | null;
  accessState: AccessState;
  /** Email currently mid-flow in the OTP code screen (set by `requestOtp`, read by the verify screen). */
  pendingEmail: string | null;
  /** True while `register_device` is in flight, so screens can show a spinner instead of double-firing. */
  deviceGateLoading: boolean;

  /** Wires `supabase.auth.onAuthStateChange` and resolves the initial session. Call once at app boot. */
  initialize: () => void;
  requestOtp: (email: string) => Promise<{ error: string | null }>;
  verifyOtp: (token: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** Re-runs `register_device` for the current session (e.g. after revoking a device frees a slot). */
  runDeviceGate: () => Promise<void>;
}

let initialized = false;
// Guards against overlapping register_device calls (e.g. INITIAL_SESSION and a manual retry racing).
let deviceGateInFlight: Promise<void> | null = null;

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  session: null,
  user: null,
  accessState: 'loading',
  pendingEmail: null,
  deviceGateLoading: false,

  initialize: () => {
    if (initialized) return;
    initialized = true;

    supabase.auth.onAuthStateChange((event, session) => {
      set({ session, user: session?.user ?? null });

      if (event === 'SIGNED_OUT') {
        set({ accessState: 'unauthenticated' });
        return;
      }

      if (!session) {
        set({ accessState: 'unauthenticated' });
        return;
      }

      // Only gate on the events that represent "a session just became active": cold start with an
      // existing session, and a fresh sign-in. TOKEN_REFRESHED/USER_UPDATED etc. fire far more often
      // (every ~55min, on every profile update) and must not re-trigger register_device each time —
      // that's the debounce the spec asks for.
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        void get().runDeviceGate();
      }
    });
  },

  requestOtp: async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (error) return { error: error.message };
    set({ pendingEmail: email });
    return { error: null };
  },

  verifyOtp: async (token: string) => {
    const email = get().pendingEmail;
    if (!email) return { error: "Aucune adresse e-mail en attente de vérification." };

    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) return { error: error.message };

    // onAuthStateChange's SIGNED_IN handler runs the device gate; nothing else to do here.
    set({ pendingEmail: null });
    return { error: null };
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, accessState: 'unauthenticated', pendingEmail: null });
  },

  runDeviceGate: async () => {
    if (deviceGateInFlight) return deviceGateInFlight;

    const run = (async () => {
      set({ deviceGateLoading: true });
      try {
        const result = await registerCurrentDevice();
        if (result.status === 'ok') {
          set({ accessState: 'ready' });
        } else if (result.status === 'device_limit_reached') {
          set({ accessState: 'device_limit' });
        } else {
          set({ accessState: 'no_subscription' });
        }
      } finally {
        set({ deviceGateLoading: false });
      }
    })();

    deviceGateInFlight = run;
    try {
      await run;
    } finally {
      deviceGateInFlight = null;
    }
  },
}));
