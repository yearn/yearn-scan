import type { Env } from './env.ts';
import { HttpError } from './http.ts';

const encoder = new TextEncoder();
export async function digest(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(value));
}
export function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}
export interface Publisher { client: string; fingerprint: string }

export async function authenticatePublisher(request: Request, env: Env): Promise<Publisher> {
  const entries = (env.PUBLISH_KEYS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!entries.length || entries.some(x => !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}__[a-zA-Z0-9_-]{32,256}$/.test(x)) || new Set(entries).size !== entries.length) {
    throw new HttpError(503, 'Publishing is not configured');
  }
  const header = request.headers.get('Authorization') || '';
  const token = /^Bearer ([^\s]+)$/i.exec(header)?.[1] || '';
  const supplied = await digest(token);
  const hashes = await Promise.all(entries.map(digest));
  let match = -1;
  // Compare every fixed-length digest, even after finding a match. Never compare
  // plaintext keys or return early based on where a matching key appears.
  for (let i = 0; i < hashes.length; i++) {
    const equal = crypto.subtle.timingSafeEqual(supplied, hashes[i]!);
    if (equal) match = i;
  }
  if (match < 0) throw new HttpError(401, 'Invalid publishing key');
  return { client: entries[match]!.split('__')[0]!, fingerprint: hex(hashes[match]!) };
}

type SigningKey = JsonWebKey & { kid: string };
const certCache = new Map<string, { keys: SigningKey[]; expires: number; refreshed: number }>();
const pending = new Map<string, Promise<SigningKey[]>>();

async function signingKeys(issuer: string, kid: string): Promise<SigningKey[]> {
  const cached = certCache.get(issuer);
  const now = Date.now();
  if (cached && cached.expires > now && (cached.keys.some(x => x.kid === kid) || now - cached.refreshed < 30_000)) return cached.keys;
  const inFlight = pending.get(issuer);
  if (inFlight) return inFlight;
  const task = (async () => {
    const response = await fetch(`${issuer}/cdn-cgi/access/certs`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Certificates unavailable');
    const data = await response.json() as { keys?: SigningKey[] };
    if (!Array.isArray(data.keys) || data.keys.length > 20) throw new Error('Invalid certificates');
    const keys = data.keys.filter(x => x.kty === 'RSA' && typeof x.kid === 'string' && (!x.alg || x.alg === 'RS256') && (!x.use || x.use === 'sig'));
    certCache.set(issuer, { keys, expires: now + 300_000, refreshed: now });
    return keys;
  })();
  pending.set(issuer, task);
  try { return await task; } finally { pending.delete(issuer); }
}

function decode(segment: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('Invalid encoding');
  return Uint8Array.from(atob(segment.replace(/-/g, '+').replace(/_/g, '/')), x => x.charCodeAt(0));
}
function parse(segment: string): Record<string, unknown> {
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(decode(segment)));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid claims');
  return value;
}

export async function authenticateReader(request: Request, env: Env): Promise<void> {
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER) || !env.ACCESS_AUD || env.ACCESS_AUD === 'configure-me') {
    throw new HttpError(503, 'Reader access is not configured');
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16_384) throw new HttpError(401, 'Cloudflare Access authentication required');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT');
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const header = parse(headerPart);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit !== undefined) throw new Error('Invalid JWT header');
    const claims = parse(payloadPart);
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== env.ACCESS_ISSUER || !Array.isArray(claims.aud) || !claims.aud.includes(env.ACCESS_AUD) || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now || typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.iat > now || (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > now)) || claims.type !== 'app' || typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string' || !claims.email) throw new Error('Invalid JWT claims');
    const keys = await signingKeys(env.ACCESS_ISSUER, header.kid);
    const jwk = keys.find(x => x.kid === header.kid);
    if (!jwk) throw new Error('Unknown signing key');
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(signaturePart), encoder.encode(`${headerPart}.${payloadPart}`))) throw new Error('Invalid signature');
  } catch {
    throw new HttpError(401, 'Invalid Cloudflare Access token');
  }
}
