# Cloudflare GUI Setup Guide for Ordinate

This guide covers everything needed to deploy the Ordinate job portal on Cloudflare — two Workers, one D1 database, one R2 bucket, and static Pages — entirely through the Cloudflare Dashboard (no CLI tooling required).

---

## Architecture Overview

Ordinate is split into three deployable units:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER                               │
│                                                                     │
│   public/index.html          admin-panel/dashboard.html            │
│   public/jobs.html           admin-panel/login.html                │
│   public/js/api.js           admin-panel/api.js                    │
└────────┬──────────────────────────────┬────────────────────────────┘
         │ HTTPS requests               │ HTTPS requests
         ▼                              ▼
┌────────────────────┐       ┌──────────────────────┐
│   ordinate-worker  │       │  ordinate-admin-worker│
│   (worker.js)      │       │  (admin-worker.js)    │
│                    │       │                        │
│  GET  /api/jobs    │       │  POST /api/admin/login │
│  GET  /api/jobs/:id│       │  POST /api/admin/totp  │
│  POST /api/apply   │       │  GET  /api/admin/stats │
│  POST /api/contact │       │  CRUD /api/admin/jobs  │
│  *    → ASSETS     │       │  GET  /api/admin/apps  │
└────┬──────────┬────┘       └────┬──────────────────┘
     │          │                 │
     │ D1 reads │                 │ D1 reads/writes
     │          │ R2 writes       │ R2 reads (resume proxy)
     ▼          ▼                 ▼
┌──────────┐  ┌────────────────────────────────────────┐
│  D1 DB   │  │           R2 Bucket                    │
│(ordinate)│  │       (ordinate-resumes)               │
│          │  │                                        │
│  jobs    │  │  resumes/1714000000000_cv_john.pdf     │
│  apps    │  │  resumes/1714000001234_portfolio.docx  │
│  contacts│  │                                        │
└──────────┘  └────────────────────────────────────────┘
```

---

## Data Flow: End-to-End Examples

### Example A — Candidate applies for a job

```
Browser (public/apply.html)
  │
  │  1. GET https://ordinate-worker.workers.dev/api/jobs/3
  ▼
ordinate-worker (worker.js)
  │  worker.js:87 → getJobById(env.DB, 3)
  │  SELECT * FROM jobs WHERE id=3
  ▼
D1 Database
  │  returns { id:3, title:"Senior Engineer", is_active:1, ... }
  ▼
ordinate-worker → 200 JSON { job: {...} }
  ▼
Browser renders job details + application form

  2. User fills form, attaches resume.pdf, submits

  POST https://ordinate-worker.workers.dev/api/apply
  Body: multipart/form-data
    job_id=3, first_name=Jane, last_name=Doe,
    email=jane@example.com, resume=resume.pdf

  ▼
ordinate-worker (worker.js:94)
  │  validates fields + MIME type + size ≤ 5 MB
  │  uploadResume(env.RESUME_BUCKET, file)
  │    → key = "resumes/1714012345678_resume.pdf"
  │    → R2 PUT with contentType, contentDisposition
  │  createApplication(env.DB, { job_id:3, ..., resume_key })
  │    → INSERT INTO applications (...)
  ▼
D1 stores application row
R2 stores resume binary
  ▼
Browser ← 201 { success: true, application_id: 42 }
```

### Example B — Admin reviews applications

```
Browser (admin-panel/login.html)
  │
  │  1. POST https://ordinate-admin-worker.workers.dev/api/admin/login
  │     Body: { username:"admin", password:"mypassword" }
  ▼
admin-worker.js:246
  │  verifyPassword("mypassword", env.ADMIN_PASSWORD_HASH)
  │  SHA-256("mypassword") → hex → matches stored hash?
  │  YES → return { requires_totp: true }
  ▼
Browser shows TOTP input

  2. POST /api/admin/totp
     Body: { username, password, code:"123456" }
  ▼
admin-worker.js:256
  │  verifyPassword() again
  │  verifyTOTP("123456", env.TOTP_SECRET)
  │    → HOTP(base32Decode(secret), step±1)
  │  VALID → signJWT({ sub:"admin", exp: now+8h, authenticated:true })
  │  Set-Cookie: session=<JWT>; HttpOnly; SameSite=None; Secure
  ▼
Browser stores JWT in cookie

  3. GET /api/admin/applications?job_id=3
     Cookie: session=<JWT>
  ▼
admin-worker.js:284
  │  requireAuth() → verifyJWT(token, env.JWT_SECRET)
  │  VALID → getApplications(env.DB, 3)
  │    SELECT a.*, j.title FROM applications a
  │    LEFT JOIN jobs j ON a.job_id=j.id
  │    WHERE a.job_id=3 ORDER BY applied_at DESC
  ▼
Browser displays application list with resume download links

  4. Admin clicks "Download Resume"
     GET /api/admin/resume/resumes%2F1714012345678_resume.pdf
  ▼
admin-worker.js:342
  │  requireAuth() → valid
  │  RESUME_BUCKET.get("resumes/1714012345678_resume.pdf")
  ▼
R2 → streams binary PDF back to browser
```

---

## Step 1 — D1 Database

1. Log in to the **Cloudflare Dashboard**.
2. Navigate to **Workers & Pages** > **D1**.
3. Click **Create Database** → **Name**: `ordinate` → **Create**.
4. Click the database → **Console** tab.
5. Paste and run the full SQL below:

```sql
-- Tables
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

-- Optional: seed a couple of starter jobs
INSERT INTO jobs (title, department, location, type, description, requirements, salary_range, is_active) VALUES
('Senior Software Engineer', 'Engineering', 'Toronto, ON (Hybrid)', 'Full-time',
 'Architect and build scalable web applications.', '5+ years, TypeScript, Cloud.', '$110k – $140k', 1),
('Product Manager', 'Product', 'Toronto, ON (On-site)', 'Full-time',
 'Own product roadmap and represent the customer.', '3+ years PM experience.', '$90k – $115k', 1);
```

---

## Step 2 — R2 Bucket

1. Navigate to **R2** in the left sidebar.
2. Click **Create Bucket**.
3. **Bucket Name**: `ordinate-resumes`
4. Leave all other settings as default → **Create Bucket**.

> Resumes are stored under the key pattern `resumes/<timestamp>_<filename>`.
> The bucket is **private** — the admin worker proxies downloads rather than using public URLs.

---

## Step 3 — Public Worker (`worker.js`)

This worker handles all public-facing traffic: job listings, job applications, the contact form, and serving the static `public/` assets.

### 3A. Create the Worker

1. Navigate to **Workers & Pages** > **Overview**.
2. Click **Create** > **Create Worker**.
3. **Name**: `ordinate-worker`
4. Click **Deploy** (the placeholder code doesn't matter — you'll replace it).
5. After deploying, click **Edit Code**.
6. Delete all placeholder code, paste the full contents of [worker.js](worker.js), then click **Deploy**.

### 3B. Upload Static Assets

The worker serves the `public/` folder as static assets via the `ASSETS` binding. To attach them:

1. On the worker's **Settings** tab, scroll to **Static Assets**.
2. Click **Manage Assets** > **Upload assets**.
3. Upload every file from your `public/` directory, preserving the directory structure:
   ```
   index.html
   about.html
   contact.html
   jobs.html
   apply.html
   css/
   js/
   assets/
   admin/ (the public/admin/ subfolder if present)
   ```
4. Click **Save**.

> Requests that don't match an `/api/` route fall through to `env.ASSETS.fetch(request)` (worker.js:142), which serves the uploaded files.

### 3C. Bindings for the Public Worker

Navigate to **Workers & Pages** > `ordinate-worker` > **Settings** > **Variables and Secrets**.

#### D1 Database Binding
| Variable Name | D1 Database |
|:---|:---|
| `DB` | `ordinate` |

*Path: scroll to **D1 Database Bindings** → Add binding → fill in table above → Save.*

#### R2 Bucket Binding
| Variable Name | R2 Bucket |
|:---|:---|
| `RESUME_BUCKET` | `ordinate-resumes` |

*Path: scroll to **R2 Bucket Bindings** → Add binding → fill in table above → Save.*

#### Environment Variable
| Variable Name | Value |
|:---|:---|
| `CORS_ORIGIN` | `*` or your Pages domain (e.g. `https://ordinate.pages.dev`) |

*Path: **Environment Variables** → Add variable → Save.*

---

## Step 4 — Admin Worker (`admin-worker.js`)

This is a **separate Worker** for all authenticated admin operations: login (password + TOTP), job CRUD, reviewing applications, downloading resumes, and viewing contact messages.

### 4A. Create the Worker

1. **Workers & Pages** > **Overview** > **Create** > **Create Worker**.
2. **Name**: `ordinate-admin-worker`
3. **Deploy** → **Edit Code** → paste the full contents of [admin-worker.js](admin-worker.js) → **Deploy**.

> This worker has **no** static asset binding — it only serves JSON from `/api/admin/*` routes.

### 4B. Bindings for the Admin Worker

Navigate to `ordinate-admin-worker` > **Settings** > **Variables and Secrets**.

#### D1 Database Binding
| Variable Name | D1 Database |
|:---|:---|
| `DB` | `ordinate` *(same database as the public worker)* |

#### R2 Bucket Binding
| Variable Name | R2 Bucket |
|:---|:---|
| `RESUME_BUCKET` | `ordinate-resumes` *(same bucket)* |

#### Environment Variables
| Variable Name | Value |
|:---|:---|
| `ADMIN_USERNAME` | `admin` |
| `CORS_ORIGIN` | `*` or your admin panel domain |

#### Secrets
| Secret Name | Value | Notes |
|:---|:---|:---|
| `ADMIN_PASSWORD_HASH` | `sha256:<hex>` | See generation steps below |
| `JWT_SECRET` | Random 64-char string | Signs session tokens (8 h expiry) |
| `TOTP_SECRET` | 32-char Base32 string | TOTP seed; scan QR in admin panel |

*Path for secrets: **Variables and Secrets** → **Add secret** → enter name & value → Save.*

### How to generate `ADMIN_PASSWORD_HASH`

Run this snippet in your browser's DevTools console (F12 → Console) or in Node.js 18+:

```js
async function hashPassword(password) {
  const encoded = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hashHex}`;
}

hashPassword("your-strong-password-here").then(console.log);
// Output: sha256:a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3
```

Paste the full `sha256:...` string (including the prefix) as the `ADMIN_PASSWORD_HASH` secret.

> The `sha256:` prefix is required. The admin worker checks for it in `verifyPassword()` (admin-worker.js:29).

### How to generate `JWT_SECRET`

Run this in your browser's DevTools console (F12 → Console):

```js
// Method 1 — cryptographically random 64-char hex string (recommended)
console.log(
  Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
);
// Output example: 3f9a2c1e8b7d4f0a6e5c3b2d1a9f8e7c4b3a2d1e0f9c8b7a6d5e4f3c2b1a0d9e

// Method 2 — two UUIDs joined (simpler, slightly less entropy)
console.log(crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,''));
// Output example: 550e8400e29b41d4a716446655440000f47ac10b58cc4372a5670e02b2c3d479
```

Paste the output directly as the `JWT_SECRET` secret value. Either method produces a string well above the 32-character minimum. Keep it secret — every admin session token is signed with it and a leaked secret allows forging valid JWTs.

### How to generate `TOTP_SECRET`

#### Step 1 — Generate the secret

Run this in your browser's DevTools console (F12 → Console):

```js
// Generates a valid 32-character Base32 TOTP secret
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const secret = Array.from(crypto.getRandomValues(new Uint8Array(20)))
  .map(b => chars[b % 32]).join('');
console.log(secret); // e.g. "JBSWY3DPEHPK3PXP5QCOTGZABC23456"
```

Paste this value as the `TOTP_SECRET` secret in the admin worker.

#### Step 2 — Add to your authenticator app (first-time, manual entry)

> **Important:** The QR code page (`/totp-setup.html`) requires you to already be logged in,
> so for first-time setup you must add the secret **manually** to your app.

Open **Google Authenticator**, **Authy**, or any RFC 6238-compatible app and add an account using **manual/text entry**:

| Field | Value |
|:---|:---|
| Account name | `Ordinate: admin` (or anything you like) |
| Secret key | the Base32 string you generated above |
| Type | Time-based |
| Digits | 6 |
| Period | 30 seconds |

Your app will immediately start generating 6-digit codes. Use one of those codes in the next login attempt.

#### Step 3 — Re-scan QR code later (after first login)

Once you are fully logged in, visit:

```
https://your-admin-panel.pages.dev/totp-setup.html
```

This page calls `GET /api/admin/totp-setup` (requires JWT) and renders:
- A **scannable QR code** generated from your `TOTP_SECRET` via `otpauth://totp/...`
- A **copy button** for the raw Base32 secret

Use this page whenever you need to link a new phone or authenticator app. Never share the QR code or secret with anyone.

---

## Step 5 — Admin Panel (Cloudflare Pages)

The `admin-panel/` folder is a standalone static site that talks to `ordinate-admin-worker`.

### 5A. Deploy

1. **Workers & Pages** > **Create Application** > **Pages**.
2. Connect your GitHub repository.
3. **Project Name**: `ordinate-admin`
4. **Framework Preset**: `None`
5. **Build Command**: *(leave blank)*
6. **Build Output Directory**: `admin-panel`
7. Click **Save and Deploy**.

### 5B. Update the Admin API Base URL

In [admin-panel/api.js](admin-panel/api.js), the `API_BASE` constant must point to your admin worker's URL.
After deploying the admin worker, note its URL (e.g. `https://ordinate-admin-worker.your-subdomain.workers.dev`) and update the file:

```js
// admin-panel/api.js  (line 6-7 equivalent)
const API_BASE = (_host === 'localhost' || _host === '127.0.0.1' || _host === '')
    ? 'http://localhost:8787/api'
    : 'https://ordinate-admin-worker.YOUR-SUBDOMAIN.workers.dev/api';
```

Commit and push — Pages will redeploy automatically.

---

## Step 6 — Update the Public API URL

In [public/js/api.js](public/js/api.js), update the production URL to your public worker:

```js
// public/js/api.js (line 6-7)
const API_BASE = (_host === 'localhost' || _host === '127.0.0.1' || _host === '')
    ? 'http://localhost:8787/api'
    : 'https://ordinate-worker.YOUR-SUBDOMAIN.workers.dev/api';
```

---

## Step 7 — Custom Domains (Optional)

To use `api.yourcompany.com` instead of `*.workers.dev`:

1. Go to the Worker > **Settings** > **Triggers** > **Custom Domains**.
2. Add your domain (e.g. `api.yourcompany.com`).
3. Cloudflare automatically provisions SSL and routes traffic.
4. Update the `API_BASE` strings in both `api.js` files to use your custom domain.

---

## API Reference

### Public Worker (`ordinate-worker`)

| Method | Path | Description |
|:---|:---|:---|
| `GET` | `/api/jobs` | List all active jobs |
| `GET` | `/api/jobs/:id` | Get a single active job |
| `POST` | `/api/apply` | Submit a job application (multipart/form-data) |
| `POST` | `/api/contact` | Submit a contact message (JSON) |
| `*` | `/*` | Serve static assets from `public/` |

**POST `/api/apply` fields:**

| Field | Type | Required |
|:---|:---|:---|
| `job_id` | integer | yes |
| `first_name` | string | yes |
| `last_name` | string | yes |
| `email` | string (email) | yes |
| `phone` | string | no |
| `years_of_experience` | integer | no |
| `resume` | file (PDF/DOC/DOCX, ≤ 5 MB) | no |

### Admin Worker (`ordinate-admin-worker`)

| Method | Path | Auth | Description |
|:---|:---|:---|:---|
| `POST` | `/api/admin/login` | — | Step 1: verify username + password |
| `POST` | `/api/admin/totp` | — | Step 2: verify TOTP → returns JWT |
| `POST` | `/api/admin/logout` | — | Clear session cookie |
| `GET` | `/api/admin/stats` | JWT | Dashboard counts |
| `GET` | `/api/admin/totp-setup` | JWT | Returns `otpauth://` URI for QR |
| `GET` | `/api/admin/jobs` | JWT | All jobs (including inactive) |
| `POST` | `/api/admin/jobs` | JWT | Create a job |
| `PUT` | `/api/admin/jobs/:id` | JWT | Update a job |
| `DELETE` | `/api/admin/jobs/:id` | JWT | Delete a job |
| `GET` | `/api/admin/applications` | JWT | All applications (`?job_id=` filter) |
| `GET` | `/api/admin/applications/:id` | JWT | Single application |
| `PATCH` | `/api/admin/applications/:id/status` | JWT | Update status + notes |
| `GET` | `/api/admin/resume/:key` | JWT | Proxy-download resume from R2 |
| `GET` | `/api/admin/contacts` | JWT | All contact messages |

**Application statuses:** `pending` → `reviewed` → `shortlisted` → `rejected`

**Auth flow:** Pass the JWT in the `Authorization: Bearer <token>` header, or it will be read automatically from the `session` cookie set at login.

---

## Complete Bindings Reference

### `ordinate-worker` (public)

| Type | Binding Name | Resource Name | File Reference |
|:---|:---|:---|:---|
| D1 Database | `DB` | `ordinate` | worker.js:3 |
| R2 Bucket | `RESUME_BUCKET` | `ordinate-resumes` | worker.js:3 |
| Static Assets | `ASSETS` | *(auto from asset upload)* | worker.js:142 |
| Env Var | `CORS_ORIGIN` | your domain or `*` | worker.js:77 |

### `ordinate-admin-worker` (admin)

| Type | Binding Name | Resource Name | File Reference |
|:---|:---|:---|:---|
| D1 Database | `DB` | `ordinate` | admin-worker.js:4 |
| R2 Bucket | `RESUME_BUCKET` | `ordinate-resumes` | admin-worker.js:4 |
| Env Var | `ADMIN_USERNAME` | `admin` | admin-worker.js:249 |
| Env Var | `CORS_ORIGIN` | your domain or `*` | admin-worker.js:5 |
| Secret | `ADMIN_PASSWORD_HASH` | `sha256:<hex>` | admin-worker.js:29 |
| Secret | `JWT_SECRET` | random 64-char string | admin-worker.js:49 |
| Secret | `TOTP_SECRET` | 32-char Base32 | admin-worker.js:127 |

---

## Deployment Checklist

- [ ] D1 database `ordinate` created and SQL schema executed
- [ ] R2 bucket `ordinate-resumes` created
- [ ] `ordinate-worker` deployed with `worker.js` code
- [ ] Static assets from `public/` uploaded to `ordinate-worker`
- [ ] `ordinate-worker` → `DB` binding set
- [ ] `ordinate-worker` → `RESUME_BUCKET` binding set
- [ ] `ordinate-worker` → `CORS_ORIGIN` variable set
- [ ] `ordinate-admin-worker` deployed with `admin-worker.js` code
- [ ] `ordinate-admin-worker` → `DB` binding set
- [ ] `ordinate-admin-worker` → `RESUME_BUCKET` binding set
- [ ] `ordinate-admin-worker` → `ADMIN_USERNAME` variable set
- [ ] `ordinate-admin-worker` → `CORS_ORIGIN` variable set
- [ ] `ordinate-admin-worker` → `ADMIN_PASSWORD_HASH` secret set
- [ ] `ordinate-admin-worker` → `JWT_SECRET` secret set
- [ ] `ordinate-admin-worker` → `TOTP_SECRET` secret set
- [ ] `admin-panel/api.js` updated with admin worker URL
- [ ] `public/js/api.js` updated with public worker URL
- [ ] Admin panel deployed to Cloudflare Pages
- [ ] TOTP app (Google Authenticator / Authy) configured via `/totp-setup.html`
