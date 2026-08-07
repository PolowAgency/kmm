import { supabase } from '@/lib/supabase';
import { getDeviceIdentity } from '@/lib/device';
import { fetchPublicIp } from '@/lib/ip';

export type RegisterDeviceStatus = 'ok' | 'no_active_subscription' | 'device_limit_reached';

export interface RegisterDeviceResult {
  status: RegisterDeviceStatus;
  raw: unknown;
}

/**
 * Calls the `register_device` RPC with this device's identity + a best-effort public IP.
 *
 * Until the kmmtradehub migrations that create `register_device` are applied to the live
 * database, this RPC does not exist and every call fails with a Postgres "function not found"
 * error — that's expected for this phase (see ARCHITECTURE.md). We surface that as
 * `'no_active_subscription'` rather than throwing, because from the user's point of view "we
 * couldn't confirm you have access" should land on the same neutral "no active access" screen as
 * a genuinely expired subscription would, not crash the app.
 */
export async function registerCurrentDevice(): Promise<RegisterDeviceResult> {
  const identity = await getDeviceIdentity();
  const ip = await fetchPublicIp();

  const { data, error } = await supabase.rpc('register_device', {
    p_device_id: identity.deviceId,
    p_device_name: identity.deviceName,
    p_os: identity.os,
    p_os_version: identity.osVersion,
    p_app_version: identity.appVersion,
    p_ip: ip,
  });

  if (error) {
    console.warn('[registerDevice] register_device RPC failed (expected until migrations are applied live):', error.message);
    return { status: 'no_active_subscription', raw: error };
  }

  const status = (data as { status?: string } | null)?.status;
  if (status === 'ok' || status === 'no_active_subscription' || status === 'device_limit_reached') {
    return { status, raw: data };
  }

  console.warn('[registerDevice] unexpected register_device response shape:', data);
  return { status: 'no_active_subscription', raw: data };
}
