// Admin-only Cloudflare Worker
// Deploy this as a separate Worker from the main public worker.
// Required bindings: DB (D1), RESUME_BUCKET (R2)
// Required secrets: ADMIN_PASSWORD_HASH, JWT_SECRET, TOTP_SECRET
// Required vars: ADMIN_USERNAME, CORS_ORIGIN

// ── Base64url helpers ─────────────────────────────────────────────────────────

function b64urlEncode(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlEncodeStr(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padding));
  return new Uint8Array([...binary].map(c => c.charCodeAt(0)));
}

// ── Password hashing (PBKDF2-SHA256) ─────────────────────────────────────────

async function verifyPassword(password, stored) {
  if (stored.startsWith('sha256:')) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    return hex === stored.slice(7);
  }
  if (!stored.startsWith('pbkdf2:')) return false;
  const [, saltHex, hashHex] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256
  );
  const derived = [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  return derived === hashHex;
}

// ── JWT HS256 ─────────────────────────────────────────────────────────────────

async function signJWT(payload, secret) {
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

async function verifyJWT(token, secret) {
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
    const payload = JSON.parse(decodeURIComponent(escape(atob(padded + '='.repeat(padding)))));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.authenticated) return null;
    return payload;
  } catch {
    return null;
  }
}

async function requireAuth(request, secret) {
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return verifyJWT(auth.slice(7), secret);
  
  const cookie = request.headers.get('Cookie') ?? '';
  const m = cookie.match(/session=([^;]+)/);
  if (m) return verifyJWT(m[1], secret);

  const url = new URL(request.url);
  const tokenParam = url.searchParams.get('token');
  if (tokenParam) return verifyJWT(tokenParam, secret);

  return null;
}

// ── TOTP (RFC 6238) ───────────────────────────────────────────────────────────

function base32Decode(input) {
  const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ABC.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function hotp(secretBytes, counter) {
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

async function verifyTOTP(code, secret) {
  const bytes = base32Decode(secret);
  const step  = Math.floor(Date.now() / 1000 / 30);
  for (let d = -1; d <= 1; d++) {
    if ((await hotp(bytes, step + d)) === code) return true;
  }
  return false;
}

function generateTOTPUri(secret, issuer, account) {
  const p = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${p}`;
}

// ── D1 helpers ────────────────────────────────────────────────────────────────

async function getAllJobs(db) {
  return (await db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all()).results;
}

async function getJobById(db, id) {
  return db.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first();
}

async function createJob(db, d) {
  const r = await db.prepare(
    'INSERT INTO jobs (title,department,location,type,description,requirements,salary_range) VALUES (?,?,?,?,?,?,?)'
  ).bind(d.title, d.department ?? null, d.location ?? null, d.type ?? 'Full-time',
         d.description ?? null, d.requirements ?? null, d.salary_range ?? null).run();
  return r.meta.last_row_id;
}

async function updateJob(db, id, d) {
  await db.prepare(
    `UPDATE jobs SET title=?,department=?,location=?,type=?,description=?,requirements=?,salary_range=?,is_active=?,updated_at=datetime('now') WHERE id=?`
  ).bind(d.title, d.department ?? null, d.location ?? null, d.type ?? 'Full-time',
         d.description ?? null, d.requirements ?? null, d.salary_range ?? null,
         d.is_active ?? 1, id).run();
}

async function deleteJob(db, id) {
  await db.prepare('DELETE FROM jobs WHERE id=?').bind(id).run();
}

async function getApplications(db, jobId) {
  const base = 'SELECT a.*,j.title as job_title FROM applications a LEFT JOIN jobs j ON a.job_id=j.id';
  if (jobId) {
    return (await db.prepare(`${base} WHERE a.job_id=? ORDER BY a.applied_at DESC`).bind(jobId).all()).results;
  }
  return (await db.prepare(`${base} ORDER BY a.applied_at DESC`).all()).results;
}

async function getApplicationById(db, id) {
  return db.prepare(
    'SELECT a.*,j.title as job_title FROM applications a LEFT JOIN jobs j ON a.job_id=j.id WHERE a.id=?'
  ).bind(id).first();
}

async function updateApplicationStatus(db, id, status, notes) {
  await db.prepare(`UPDATE applications SET status=?,notes=?,updated_at=datetime('now') WHERE id=?`)
    .bind(status, notes ?? null, id).run();
}

async function deleteApplication(db, bucket, id) {
  const app = await db.prepare('SELECT resume_key FROM applications WHERE id=?').bind(id).first();
  if (app && app.resume_key) {
    try {
      await bucket.delete(app.resume_key);
    } catch (e) {
      console.error('Failed to delete resume from R2:', e);
    }
  }
  await db.prepare('DELETE FROM applications WHERE id=?').bind(id).run();
}

async function getContacts(db) {
  return (await db.prepare('SELECT * FROM contacts ORDER BY received_at DESC').all()).results;
}

async function getStats(db) {
  const [tj, aj, ta, pa] = await Promise.all([
    db.prepare('SELECT COUNT(*) c FROM jobs').first(),
    db.prepare('SELECT COUNT(*) c FROM jobs WHERE is_active=1').first(),
    db.prepare('SELECT COUNT(*) c FROM applications').first(),
    db.prepare("SELECT COUNT(*) c FROM applications WHERE status='pending'").first(),
  ]);
  return { totalJobs: tj?.c ?? 0, activeJobs: aj?.c ?? 0, totalApplications: ta?.c ?? 0, pendingApplications: pa?.c ?? 0 };
}

async function getResume(bucket, key) {
  return bucket.get(key);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function json(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function err(msg, status = 400, origin = '*') {
  return json({ error: msg }, status, origin);
}

function match(path, pattern) { return pattern.test(path); }
function seg(path, n) { return path.split('/').filter(Boolean)[n]; }

// ── Main handler ──────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;
    const origin = env.CORS_ORIGIN || '*';

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

    try {
      // Auth: Single-step credentials → JWT
      if (method === 'POST' && path === '/api/admin/login') {
        const b = await request.json();
        if (!b.username || !b.password) return err('Missing credentials', 400, origin);
        if (b.username !== env.ADMIN_USERNAME) return err('Invalid credentials', 401, origin);
        if (!(await verifyPassword(b.password, env.ADMIN_PASSWORD_HASH)))
          return err('Invalid credentials', 401, origin);

        const now   = Math.floor(Date.now() / 1000);
        const token = await signJWT(
          { sub: b.username, iat: now, exp: now + 8 * 3600, authenticated: true },
          env.JWT_SECRET
        );
        const headers = new Headers({ 'Content-Type': 'application/json', ...corsHeaders(origin) });
        headers.append('Set-Cookie',
          `session=${token}; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=${8 * 3600}`);
        return new Response(JSON.stringify({ success: true, token }), { status: 200, headers });
      }

      // Logout
      if (method === 'POST' && path === '/api/admin/logout') {
        const headers = new Headers({ 'Content-Type': 'application/json', ...corsHeaders(origin) });
        headers.append('Set-Cookie', 'session=; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=0');
        return new Response(JSON.stringify({ success: true }), { status: 200, headers });
      }

      // All other admin routes require JWT
      if (path.startsWith('/api/admin/')) {
        const payload = await requireAuth(request, env.JWT_SECRET);
        if (!payload) return err('Unauthorized', 401, origin);


        // Stats
        if (method === 'GET' && path === '/api/admin/stats')
          return json(await getStats(env.DB), 200, origin);

        // Jobs CRUD
        if (method === 'GET' && path === '/api/admin/jobs')
          return json({ jobs: await getAllJobs(env.DB) }, 200, origin);

        if (method === 'GET' && match(path, /^\/api\/admin\/jobs\/\d+$/)) {
          const id = +seg(path, 3);
          const job = await getJobById(env.DB, id);
          if (!job) return err('Job not found', 404, origin);
          return json({ job }, 200, origin);
        }

        if (method === 'POST' && path === '/api/admin/jobs') {
          const b = await request.json();
          if (!b.title) return err('Title required', 400, origin);
          const id = await createJob(env.DB, b);
          return json({ job: await getJobById(env.DB, id) }, 201, origin);
        }

        if (method === 'PUT' && match(path, /^\/api\/admin\/jobs\/\d+$/)) {
          const id = +seg(path, 3);
          await updateJob(env.DB, id, await request.json());
          return json({ job: await getJobById(env.DB, id) }, 200, origin);
        }

        if (method === 'DELETE' && match(path, /^\/api\/admin\/jobs\/\d+$/)) {
          await deleteJob(env.DB, +seg(path, 3));
          return json({ success: true }, 200, origin);
        }

        // Applications
        if (method === 'GET' && path === '/api/admin/applications') {
          const jid = url.searchParams.get('job_id');
          return json({ applications: await getApplications(env.DB, jid ? +jid : undefined) }, 200, origin);
        }

        if (method === 'GET' && match(path, /^\/api\/admin\/applications\/\d+$/)) {
          const app = await getApplicationById(env.DB, +seg(path, 3));
          if (!app) return err('Not found', 404, origin);
          return json({ application: app }, 200, origin);
        }

        if (method === 'PATCH' && match(path, /^\/api\/admin\/applications\/\d+\/status$/)) {
          const id = +path.split('/')[4];
          const b  = await request.json();
          const ok = ['pending','reviewed','shortlisted','rejected'];
          if (!ok.includes(b.status)) return err('Invalid status', 400, origin);
          await updateApplicationStatus(env.DB, id, b.status, b.notes);
          return json({ success: true }, 200, origin);
        }

        if (method === 'DELETE' && match(path, /^\/api\/admin\/applications\/\d+$/)) {
          await deleteApplication(env.DB, env.RESUME_BUCKET, +seg(path, 3));
          return json({ success: true }, 200, origin);
        }

        // Resume proxy
        if (method === 'GET' && path.startsWith('/api/admin/resume/')) {
          const key = decodeURIComponent(path.slice('/api/admin/resume/'.length));
          const obj = await getResume(env.RESUME_BUCKET, key);
          if (!obj) return err('Resume not found', 404, origin);
          const h = new Headers(corsHeaders(origin));
          const disp = obj.httpMetadata?.contentDisposition || 'inline';
          h.set('Content-Type', obj.httpMetadata?.contentType || 'application/pdf');
          h.set('Content-Disposition', disp.replace('attachment', 'inline'));
          return new Response(obj.body, { headers: h });
        }

        // Contacts
        if (method === 'GET' && path === '/api/admin/contacts')
          return json({ contacts: await getContacts(env.DB) }, 200, origin);
      }

      return err('Not found', 404, origin);
    } catch (e) {
      console.error(e);
      return err('Internal server error', 500, origin);
    }
  },
};
