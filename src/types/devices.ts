/** Mirrors the `devices` table shape from the kmmtradehub migrations (device-binding security). */
export interface DeviceRow {
  id: string;
  user_id: string;
  device_id: string;
  device_name: string | null;
  os: string | null;
  os_version: string | null;
  app_version: string | null;
  status: 'active' | 'revoked' | string;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export type RevokeDeviceStatus = 'ok' | 'cooldown';

export interface RevokeDeviceResult {
  status: RevokeDeviceStatus;
  available_at?: string;
}
