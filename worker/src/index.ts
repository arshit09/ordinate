import type { Env } from './types';
import { verifyPassword, signJWT, requireAuth } from './lib/auth';
import { verifyTOTP, generateTOTPUri } from './lib/totp';
import {
  getActiveJobs, getAllJobs, getJobById, createJob, updateJob, deleteJob,
  createApplication, getApplications, getApplicationById, updateApplicationStatus,
  createContact, getContacts, getStats,
} from './lib/db';
import { uploadResume, getResume } from './lib/r2';

// ── Helpers ───────────────────────────────────────────────────────────────────

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

function json(data: unknown, status = 200, origin = '*'): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function err(msg: string, status = 400, origin = '*'): Response {
  return json({ error: msg }, status, origin);
}

function match(path: string, pattern: RegExp) { return pattern.test(path); }
function seg(path: string, n: number) { return path.split('/').filter(Boolean)[n]; }

// ── Main handler ──────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;
    const origin = env.CORS_ORIGIN || '*';

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

    try {
      // ── Public: list active jobs ─────────────────────────────────────────
      if (method === 'GET' && (path === '/api/jobs' || path === '/api/jobs/')) {
        return json({ jobs: await getActiveJobs(env.DB) }, 200, origin);
      }

      if (method === 'GET' && match(path, /^\/api\/jobs\/\d+$/)) {
        const job = await getJobById(env.DB, +seg(path, 2));
        if (!job || !job.is_active) return err('Not found', 404, origin);
        return json({ job }, 200, origin);
      }

      // ── Public: apply ────────────────────────────────────────────────────
      if (method === 'POST' && path === '/api/apply') {
        const fd  = await request.formData();
        const jobId = parseInt(fd.get('job_id') as string);
        const firstName = (fd.get('first_name') as string)?.trim();
        const lastName  = (fd.get('last_name')  as string)?.trim();
        const email     = (fd.get('email')       as string)?.trim();
        const phone     = (fd.get('phone')       as string)?.trim();
        const yoe       = parseInt(fd.get('years_of_experience') as string) || 0;
        const file      = fd.get('resume') as File | null;

        if (!jobId || !firstName || !lastName || !email)
          return err('Missing required fields', 400, origin);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          return err('Invalid email', 400, origin);

        let resumeKey: string | undefined, resumeFilename: string | undefined;
        if (file && file.size > 0) {
          const allowed = ['application/pdf','application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
          if (!allowed.includes(file.type) && !/\.(pdf|doc|docx)$/i.test(file.name))
            return err('Resume must be PDF or Word (.doc/.docx)', 400, origin);
          if (file.size > 5 * 1024 * 1024)
            return err('Resume must be under 5 MB', 400, origin);
          const up = await uploadResume(env.RESUME_BUCKET, file);
          resumeKey = up.key; resumeFilename = up.filename;
        }

        const id = await createApplication(env.DB, {
          job_id: jobId, first_name: firstName, last_name: lastName,
          email, phone, years_of_experience: yoe,
          resume_key: resumeKey, resume_filename: resumeFilename,
        });
        return json({ success: true, application_id: id }, 201, origin);
      }

      // ── Public: contact form ─────────────────────────────────────────────
      if (method === 'POST' && path === '/api/contact') {
        const b = await request.json() as { name: string; email: string; message: string };
        if (!b.name || !b.email || !b.message) return err('Missing fields', 400, origin);
        await createContact(env.DB, b);
        return json({ success: true }, 201, origin);
      }

      // ── Admin auth: step 1 — credentials ────────────────────────────────
      if (method === 'POST' && path === '/api/admin/login') {
        const b = await request.json() as { username: string; password: string };
        if (!b.username || !b.password) return err('Missing credentials', 400, origin);
        if (b.username !== env.ADMIN_USERNAME) return err('Invalid credentials', 401, origin);
        if (!(await verifyPassword(b.password, env.ADMIN_PASSWORD_HASH)))
          return err('Invalid credentials', 401, origin);
        return json({ requires_totp: true }, 200, origin);
      }

      // ── Admin auth: step 2 — TOTP → JWT ─────────────────────────────────
      if (method === 'POST' && path === '/api/admin/totp') {
        const b = await request.json() as { username: string; password: string; code: string };
        if (!b.username || !b.password || !b.code) return err('Missing fields', 400, origin);
        if (b.username !== env.ADMIN_USERNAME) return err('Invalid credentials', 401, origin);
        if (!(await verifyPassword(b.password, env.ADMIN_PASSWORD_HASH)))
          return err('Invalid credentials', 401, origin);
        if (!(await verifyTOTP(b.code, env.TOTP_SECRET)))
          return err('Invalid TOTP code', 401, origin);

        const now   = Math.floor(Date.now() / 1000);
        const token = await signJWT(
          { sub: b.username, iat: now, exp: now + 8 * 3600, authenticated: true },
          env.JWT_SECRET
        );
        const headers = new Headers({ 'Content-Type': 'application/json', ...corsHeaders(origin) });
        headers.append('Set-Cookie',
          `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${8 * 3600}`);
        return new Response(JSON.stringify({ success: true, token }), { status: 200, headers });
      }

      // ── Admin logout ─────────────────────────────────────────────────────
      if (method === 'POST' && path === '/api/admin/logout') {
        const headers = new Headers({ 'Content-Type': 'application/json', ...corsHeaders(origin) });
        headers.append('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return new Response(JSON.stringify({ success: true }), { status: 200, headers });
      }

      // ── All remaining /api/admin/* require JWT ───────────────────────────
      if (path.startsWith('/api/admin/')) {
        const payload = await requireAuth(request, env.JWT_SECRET);
        if (!payload) return err('Unauthorized', 401, origin);

        // TOTP setup (show secret + otpauth URI)
        if (method === 'GET' && path === '/api/admin/totp-setup') {
          const uri = generateTOTPUri(env.TOTP_SECRET, 'Ordinate', env.ADMIN_USERNAME);
          return json({ uri, secret: env.TOTP_SECRET }, 200, origin);
        }

        // Stats
        if (method === 'GET' && path === '/api/admin/stats')
          return json(await getStats(env.DB), 200, origin);

        // Jobs CRUD
        if (method === 'GET' && path === '/api/admin/jobs')
          return json({ jobs: await getAllJobs(env.DB) }, 200, origin);

        if (method === 'POST' && path === '/api/admin/jobs') {
          const b = await request.json() as { title: string };
          if (!b.title) return err('Title required', 400, origin);
          const id = await createJob(env.DB, b as Parameters<typeof createJob>[1]);
          return json({ job: await getJobById(env.DB, id) }, 201, origin);
        }

        if (method === 'PUT' && match(path, /^\/api\/admin\/jobs\/\d+$/)) {
          const id = +seg(path, 3);
          await updateJob(env.DB, id, await request.json() as Parameters<typeof updateJob>[2]);
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
          const b  = await request.json() as { status: string; notes?: string };
          const ok = ['pending','reviewed','shortlisted','rejected'];
          if (!ok.includes(b.status)) return err('Invalid status', 400, origin);
          await updateApplicationStatus(env.DB, id, b.status, b.notes);
          return json({ success: true }, 200, origin);
        }

        // Resume proxy
        if (method === 'GET' && path.startsWith('/api/admin/resume/')) {
          const key = decodeURIComponent(path.slice('/api/admin/resume/'.length));
          const obj = await getResume(env.RESUME_BUCKET, key);
          if (!obj) return err('Resume not found', 404, origin);
          const h = new Headers(corsHeaders(origin));
          h.set('Content-Type', obj.httpMetadata?.contentType ?? 'application/octet-stream');
          h.set('Content-Disposition', obj.httpMetadata?.contentDisposition ?? 'attachment');
          return new Response(obj.body, { headers: h });
        }

        // Contacts
        if (method === 'GET' && path === '/api/admin/contacts')
          return json({ contacts: await getContacts(env.DB) }, 200, origin);
      }

      if (path.startsWith('/api/')) {
        return err('Not found', 404, origin);
      }

      // ── Static assets ──────────────────────────────────────────────────
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return err('Internal server error', 500, origin);
    }
  },
} satisfies ExportedHandler<Env>;
