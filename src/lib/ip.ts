/**
 * Best-effort public IP lookup for `register_device`'s `p_ip` argument.
 *
 * There's no reliable client-side-only way to get the device's public IP on native (no
 * equivalent of a server-side `req.ip`), so we ask a free IP-echo endpoint. This must never block
 * or fail the login flow — a short timeout and any error both resolve to `null`, and the caller
 * passes that straight through to the RPC (the server can still record `null` and move on).
 */
export async function fetchPublicIp(timeoutMs = 2000): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    if (!response.ok) return null;
    const data = (await response.json()) as { ip?: string };
    return data.ip ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
