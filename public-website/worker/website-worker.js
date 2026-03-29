// Public Cloudflare Worker — serves job listings, applications, and contact form.
// Admin API is handled by a separate admin-worker.js deployment.
// Required bindings: DB (D1), RESUME_BUCKET (R2), ASSETS
// Required vars: CORS_ORIGIN

// ── D1 helpers ────────────────────────────────────────────────────────────────

async function getActiveJobs(db) {
  return (await db.prepare('SELECT * FROM jobs WHERE is_active=1 ORDER BY created_at DESC').all()).results;
}

async function getJobById(db, id) {
  return db.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first();
}

async function createApplication(db, d) {
  const r = await db.prepare(
    'INSERT INTO applications (job_id,first_name,last_name,email,phone,years_of_experience,resume_key,resume_filename) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(d.job_id, d.first_name, d.last_name, d.email,
         d.phone ?? null, d.years_of_experience ?? null,
         d.resume_key ?? null, d.resume_filename ?? null).run();
  return r.meta.last_row_id;
}

async function createContact(db, d) {
  await db.prepare('INSERT INTO contacts (name,email,message,entry_time,exit_time) VALUES (?,?,?,?,?)')
    .bind(d.name, d.email, d.message, d.entry_time ?? null, d.exit_time ?? null).run();
}

// ── R2 helpers ────────────────────────────────────────────────────────────────

async function uploadResume(bucket, file, prefix = 'resumes') {
  const ts       = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key      = `${prefix}/${ts}_${safeName}`;
  await bucket.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type || 'application/octet-stream',
      contentDisposition: `inline; filename="${file.name}"`,
    },
    customMetadata: { originalName: file.name, uploadedAt: new Date().toISOString() },
  });
  return { key, filename: file.name };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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
      // Public: list active jobs
      if (method === 'GET' && (path === '/api/jobs' || path === '/api/jobs/')) {
        return json({ jobs: await getActiveJobs(env.DB) }, 200, origin);
      }

      if (method === 'GET' && match(path, /^\/api\/jobs\/\d+$/)) {
        const job = await getJobById(env.DB, +seg(path, 2));
        if (!job || !job.is_active) return err('Not found', 404, origin);
        return json({ job }, 200, origin);
      }

      // Public: apply
      if (method === 'POST' && path === '/api/apply') {
        const fd  = await request.formData();
        const jobId = parseInt(fd.get('job_id'));
        const firstName = fd.get('first_name')?.trim();
        const lastName  = fd.get('last_name')?.trim();
        const email     = fd.get('email')?.trim();
        const phone     = fd.get('phone')?.trim();
        const yoe       = parseInt(fd.get('years_of_experience')) || 0;
        const file      = fd.get('resume');

        if (!jobId || !firstName || !lastName || !email)
          return err('Missing required fields', 400, origin);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          return err('Invalid email', 400, origin);

        let resumeKey, resumeFilename;
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

      // Public: contact form
      if (method === 'POST' && path === '/api/contact') {
        const b = await request.json();
        if (!b.name || !b.email || !b.message) return err('Missing fields', 400, origin);
        await createContact(env.DB, b);
        return json({ success: true }, 201, origin);
      }

      if (path.startsWith('/api/')) {
        return err('Not found', 404, origin);
      }

      // Static assets
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return err('Internal server error', 500, origin);
    }
  },
};
