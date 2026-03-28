# Cloudflare GUI Setup Guide for Ordinate

This guide provides step-by-step instructions for setting up the Ordinate job portal using the Cloudflare Dashboard (GUI).

---

## 1. Database (Cloudflare D1)
D1 is the serverless SQL database used to store jobs, applications, and contact messages.

1.  Log in to the **Cloudflare Dashboard**.
2.  Navigate to **Workers & Pages** > **D1**.
3.  Click **Create Database**.
4.  **Name**: `ordinate`
5.  Once created, click on the database and go to the **Console** tab.
6.  **Run the following initialization query** (copies from `worker/schema.sql` and `worker/seed.sql`):

```sql
-- Create Tables
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  department TEXT,
  location TEXT,
  type TEXT DEFAULT 'Full-time',
  description TEXT,
  requirements TEXT,
  salary_range TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  years_of_experience INTEGER,
  resume_key TEXT,
  resume_filename TEXT,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  applied_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  received_at TEXT DEFAULT (datetime('now'))
);

-- (Optional) Seed Initial Jobs
INSERT INTO jobs (title, department, location, type, description, requirements, salary_range, is_active) VALUES
('Senior Software Engineer', 'Engineering', 'Toronto, ON (Hybrid)', 'Full-time', 'Architecture and scalable web apps.', '5+ years, TypeScript, Cloud.', '$110k – $140k', 1),
('Product Manager', 'Product', 'Toronto, ON (On-site)', 'Full-time', 'Product roadmap and customer voice.', '3+ years PM experience.', '$90k – $115k', 1);
```

---

## 2. Object Storage (Cloudflare R2)
R2 is used to store uploaded resumes.

1.  Navigate to **R2** in the sidebar.
2.  Click **Create Bucket**.
3.  **Bucket Name**: `ordinate-resumes`
4.  Leave other settings as default and click **Create bucket**.

---

## 3. Backend & Frontend (Cloudflare Workers & Pages)
Since the project uses a single Worker to serve both the API and the static assets (via `[assets]` in `wrangler.toml`), you should deploy it as a **Worker**.

1.  Navigate to **Workers & Pages** > **Overview**.
2.  Click **Create Application** > **Workers** > **Create Worker**.
3.  **Name**: `ordinate-worker`
4.  Click **Deploy**.
5.  Once deployed, go to the **Settings** tab of your new worker.

### A. Bindings (Crucial Step)
You must link your Worker to the D1 database and R2 bucket you just created.

1.  Go to **Settings** > **Variables**.
2.  Scroll down to **D1 Database Bindings**:
    - Click **Add binding**.
    - **Variable Name**: `DB`
    - **D1 Database**: Select `ordinate`.
3.  Scroll down to **R2 Bucket Bindings**:
    - Click **Add binding**.
    - **Variable Name**: `RESUME_BUCKET`
    - **R2 Bucket**: Select `ordinate-resumes`.

### B. Environment Variables & Secrets
1.  In **Settings** > **Variables**, click **Add variable** under **Environment Variables**:
    - **Variable Name**: `ADMIN_USERNAME` | **Value**: `admin`
    - **Variable Name**: `CORS_ORIGIN` | **Value**: `*` (or your specific domain)
2.  Click **Add secret** for sensitive data:
    - **Secret Name**: `ADMIN_PASSWORD_HASH` | **Value**: (See below)
    - **Secret Name**: `JWT_SECRET` | **Value**: [A random long string]
    - **Secret Name**: `TOTP_SECRET` | **Value**: [Your 32-character Base32 secret for 2FA]

### How to generate `ADMIN_PASSWORD_HASH`
For the initial setup, you can use a simple SHA-256 hash.
1. Pick a strong password.
2. Generate its SHA-256 hash (you can use an online tool or a terminal).
3. Set the secret value as: `sha256:YOUR_HASH_HERE` (include the `sha256:` prefix).

Example for password `password123`:
`sha256:ef92b778ba7158395a487677a8693c0bc5894a4c16d5ba9446d654ed2831876e`

---

## 4. Hosting the Frontend (Cloudflare Pages)
If you prefer to host the `public` folder separately on Cloudflare Pages (recommended for performance and simplicity):

1.  Go to **Workers & Pages** > **Create Application** > **Pages**.
2.  Connect your GitHub repository.
3.  **Project Name**: `ordinate`
4.  **Framework Preset**: `None` (Static HTML).
5.  **Build Command**: (Leave blank).
6.  **Build Output Directory**: `/public`
7.  Click **Save and Deploy**.

> [!NOTE]
> If you host the frontend on Pages, ensure your JavaScript files point to the **Worker URL** for API calls (e.g., in `jobs.js` or `admin-dashboard.js`).

---

## Summary of Bound Names
| Resource | Variable Name (Binding) | Cloudflare Resource Name |
| :--- | :--- | :--- |
| **D1 Database** | `DB` | `ordinate` |
| **R2 Bucket** | `RESUME_BUCKET` | `ordinate-resumes` |
| **Admin User** | `ADMIN_USERNAME` | `admin` |
| **API Secret** | `JWT_SECRET` | (Set as Secret) |
| **Auth Secret** | `TOTP_SECRET` | (Set as Secret) |
