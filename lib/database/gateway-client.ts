import crypto from 'crypto';

/**
 * Talks to the PHP gateway hosted on cPanel (see /php-gateway in the repo
 * root) instead of connecting to Postgres directly. Every call is one
 * named "action" — e.g. 'auth.findUserByEmail', 'sales.create' — with a
 * params object, matching whatever the PHP action expects.
 *
 * Every request is HMAC-signed with DB_GATEWAY_SECRET so the PHP side can
 * verify it actually came from this server (see php-gateway/lib/auth.php).
 * That secret must never be exposed to the browser — this file is only
 * ever imported from server-side code (API routes, services), never from
 * a 'use client' component.
 */

const GATEWAY_URL = process.env.DB_GATEWAY_URL;
const GATEWAY_SECRET = process.env.DB_GATEWAY_SECRET;

export class GatewayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
  }
}

export async function callGateway<T = unknown>(
  action: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  if (!GATEWAY_URL || !GATEWAY_SECRET) {
    throw new Error('DB_GATEWAY_URL / DB_GATEWAY_SECRET are not configured');
  }

  const body = JSON.stringify({ action, params });
  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac('sha256', GATEWAY_SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  const res = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gateway-Timestamp': timestamp,
      'X-Gateway-Signature': signature,
    },
    body,
    // This is server-to-server traffic carrying live data — never cache it.
    cache: 'no-store',
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    throw new GatewayError(res.status, data?.error ?? `Gateway request failed (${res.status})`);
  }

  return data.result as T;
}
