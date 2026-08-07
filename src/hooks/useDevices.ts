import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import type { DeviceRow, RevokeDeviceResult } from '@/types/devices';

const DEVICES_QUERY_KEY = ['devices'] as const;

/**
 * Lists the current user's `devices` rows. RLS scopes this to the caller's own rows, so no extra
 * `user_id` filter is needed client-side — it's already enforced server-side.
 *
 * Ordered active-first (then most recently seen) so the list reads naturally without the caller
 * having to think about revoked entries burying the ones that matter.
 */
export function useDevices() {
  return useQuery({
    queryKey: DEVICES_QUERY_KEY,
    queryFn: async (): Promise<DeviceRow[]> => {
      const { data, error } = await supabase
        .from('devices')
        .select('*')
        .order('status', { ascending: true })
        .order('last_seen_at', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

interface RevokeDeviceError {
  message: string;
  availableAt?: string;
}

/**
 * Calls `revoke_device`. On success, invalidates the devices list AND re-runs `register_device`
 * for the current device — if revoking freed a slot, this device should get in immediately rather
 * than making the user relaunch the app.
 */
export function useRevokeDevice() {
  const queryClient = useQueryClient();
  const runDeviceGate = useAuthStore((s) => s.runDeviceGate);

  return useMutation({
    mutationFn: async (deviceId: string): Promise<void> => {
      const { data, error } = await supabase.rpc('revoke_device', { p_device_id: deviceId });
      if (error) {
        const err: RevokeDeviceError = { message: error.message };
        throw err;
      }

      const result = data as RevokeDeviceResult | null;
      if (result?.status === 'cooldown') {
        const err: RevokeDeviceError = {
          message: 'cooldown',
          availableAt: result.available_at,
        };
        throw err;
      }
      // status === 'ok' (or an unrecognized shape we choose not to hard-fail on) falls through.
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: DEVICES_QUERY_KEY });
      await runDeviceGate();
    },
  });
}

export type { RevokeDeviceError };
