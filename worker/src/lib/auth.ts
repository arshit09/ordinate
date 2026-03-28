import type { JWTPayload } from '../types';

// ── Base64url helpers ──────────────────────────────────────────────────────────

function b64urlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlEncodeStr(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padding));
  return new Uint8Array([...binary].map(c => c.charCodeAt(0)));
}

// ── Password hashing (PBKDF2-SHA256) ──────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256
  );
  const saltHex = [...salt].map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  // sha256:<hex> — simple format for initial bootstrap
  if (stored.startsWith('sha256:')) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    return hex === stored.slice(7);
  }
  if (!stored.startsWith('pbkdf2:')) return false;
  const [, saltHex, hashHex] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256
  );
  const derived = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  return derived === hashHex;
}

// ── JWT HS256 ──────────────────────────────────────────────────────────────────

export async function signJWT(payload: JWTPayload, secret: string): Promise<string> {
  const header = b64urlEncodeStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64urlEncodeStr(JSON.stringify(payload));
  const data   = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return `${data}.${b64urlEncode(sig)}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const data = `${header}.${body}`;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify(
      'HMAC', key, b64urlDecode(sig), new TextEncoder().encode(data)
    );
    if (!valid) return null;
    const padded = body.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (padded.length % 4)) % 4;
    const payload = JSON.parse(decodeURIComponent(escape(atob(padded + '='.repeat(padding))))) as JWTPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.authenticated) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function requireAuth(request: Request, secret: string): Promise<JWTPayload | null> {
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return verifyJWT(auth.slice(7), secret);
  const cookie = request.headers.get('Cookie') ?? '';
  const m = cookie.match(/session=([^;]+)/);
  if (m) return verifyJWT(m[1], secret);
  return null;
}
