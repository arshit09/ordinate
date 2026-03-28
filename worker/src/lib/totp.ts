// RFC 6238 TOTP implementation using Web Crypto (HMAC-SHA1)
// No external dependencies.

function base32Decode(input: string): Uint8Array {
  const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ABC.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function hotp(secretBytes: Uint8Array, counter: number): Promise<string> {
  const buf = new ArrayBuffer(8);
  const dv  = new DataView(buf);
  dv.setUint32(0, Math.floor(counter / 0x100000000), false);
  dv.setUint32(4, counter >>> 0, false);
  const key = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const sig    = await crypto.subtle.sign('HMAC', key, buf);
  const hmac   = new Uint8Array(sig);
  const offset = hmac[19] & 0x0f;
  const code   = ((hmac[offset]     & 0x7f) << 24) |
                 ((hmac[offset + 1] & 0xff) << 16) |
                 ((hmac[offset + 2] & 0xff) <<  8) |
                  (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, '0');
}

export async function verifyTOTP(code: string, secret: string): Promise<boolean> {
  const bytes = base32Decode(secret);
  const step  = Math.floor(Date.now() / 1000 / 30);
  for (let d = -1; d <= 1; d++) {
    if ((await hotp(bytes, step + d)) === code) return true;
  }
  return false;
}

export function generateTOTPUri(secret: string, issuer: string, account: string): string {
  const p = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${p}`;
}
