import type { Job, Application, Contact } from '../types';

// ── Jobs ──────────────────────────────────────────────────────────────────────

export async function getActiveJobs(db: D1Database): Promise<Job[]> {
  return (await db.prepare('SELECT * FROM jobs WHERE is_active=1 ORDER BY created_at DESC').all<Job>()).results;
}

export async function getAllJobs(db: D1Database): Promise<Job[]> {
  return (await db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all<Job>()).results;
}

export async function getJobById(db: D1Database, id: number): Promise<Job | null> {
  return db.prepare('SELECT * FROM jobs WHERE id=?').bind(id).first<Job>();
}

export async function createJob(db: D1Database, d: Partial<Job>): Promise<number> {
  const r = await db.prepare(
    'INSERT INTO jobs (title,department,location,type,description,requirements,salary_range) VALUES (?,?,?,?,?,?,?)'
  ).bind(d.title, d.department ?? null, d.location ?? null, d.type ?? 'Full-time',
         d.description ?? null, d.requirements ?? null, d.salary_range ?? null).run();
  return r.meta.last_row_id as number;
}

export async function updateJob(db: D1Database, id: number, d: Partial<Job>): Promise<void> {
  await db.prepare(
    `UPDATE jobs SET title=?,department=?,location=?,type=?,description=?,requirements=?,salary_range=?,is_active=?,updated_at=datetime('now') WHERE id=?`
  ).bind(d.title, d.department ?? null, d.location ?? null, d.type ?? 'Full-time',
         d.description ?? null, d.requirements ?? null, d.salary_range ?? null,
         d.is_active ?? 1, id).run();
}

export async function deleteJob(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM jobs WHERE id=?').bind(id).run();
}

// ── Applications ──────────────────────────────────────────────────────────────

export async function createApplication(
  db: D1Database,
  d: { job_id: number; first_name: string; last_name: string; email: string;
       phone?: string | null; years_of_experience?: number | null;
       resume_key?: string | null; resume_filename?: string | null }
): Promise<number> {
  const r = await db.prepare(
    'INSERT INTO applications (job_id,first_name,last_name,email,phone,years_of_experience,resume_key,resume_filename) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(d.job_id, d.first_name, d.last_name, d.email,
         d.phone ?? null, d.years_of_experience ?? null,
         d.resume_key ?? null, d.resume_filename ?? null).run();
  return r.meta.last_row_id as number;
}

export async function getApplications(db: D1Database, jobId?: number): Promise<Application[]> {
  const base = 'SELECT a.*,j.title as job_title FROM applications a LEFT JOIN jobs j ON a.job_id=j.id';
  if (jobId) {
    return (await db.prepare(`${base} WHERE a.job_id=? ORDER BY a.applied_at DESC`).bind(jobId).all<Application>()).results;
  }
  return (await db.prepare(`${base} ORDER BY a.applied_at DESC`).all<Application>()).results;
}

export async function getApplicationById(db: D1Database, id: number): Promise<Application | null> {
  return db.prepare(
    'SELECT a.*,j.title as job_title FROM applications a LEFT JOIN jobs j ON a.job_id=j.id WHERE a.id=?'
  ).bind(id).first<Application>();
}

export async function updateApplicationStatus(db: D1Database, id: number, status: string, notes?: string | null): Promise<void> {
  await db.prepare(`UPDATE applications SET status=?,notes=?,updated_at=datetime('now') WHERE id=?`)
    .bind(status, notes ?? null, id).run();
}

// ── Contacts ──────────────────────────────────────────────────────────────────

export async function createContact(db: D1Database, d: { name: string; email: string; message: string }): Promise<void> {
  await db.prepare('INSERT INTO contacts (name,email,message) VALUES (?,?,?)').bind(d.name, d.email, d.message).run();
}

export async function getContacts(db: D1Database): Promise<Contact[]> {
  return (await db.prepare('SELECT * FROM contacts ORDER BY received_at DESC').all<Contact>()).results;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getStats(db: D1Database) {
  const [tj, aj, ta, pa] = await Promise.all([
    db.prepare('SELECT COUNT(*) c FROM jobs').first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) c FROM jobs WHERE is_active=1').first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) c FROM applications').first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) c FROM applications WHERE status='pending'").first<{ c: number }>(),
  ]);
  return { totalJobs: tj?.c ?? 0, activeJobs: aj?.c ?? 0, totalApplications: ta?.c ?? 0, pendingApplications: pa?.c ?? 0 };
}
