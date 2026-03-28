# Ordinate — Job Portal

A modern, high-performance job portal built with Vanilla HTML/CSS/JS on the frontend and Cloudflare Workers on the backend. This project utilizes Cloudflare D1 for database needs and R2 for secure object storage.

## Features

- **Public Job Board**: Dynamic job listing with search and filtering by department or type.
- **Application Flow**: Multi-step application process with local storage for session persistence and file upload for resumes.
- **Admin Dashboard**: Secure management area (ID + Password + TOTP) to manage jobs, applicants, and contact leads.
- **D1 Database**: Relational data storage for jobs, applications, and logs.
- **R2 Storage**: Private bucket for storing and retrieving applicant resumes.
- **TOTP Auth**: Time-based One-Time Password (RFC 6238) for enhanced security.
- **Rich Aesthetics**: Custom design system derived from the Ordinate logo.

---

## Setup & Deployment

### 1. Prerequisites
- [Cloudflare Account](https://dash.cloudflare.com/) 
- [Node.js & npm](https://nodejs.org/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed globally.

### 2. Backend Configuration
Navigate to the `worker/` directory and perform the following steps:

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Create D1 Database**:
   ```bash
   wrangler d1 create ordinate
   ```
   *Copy the `database_id` from the output and paste it into `worker/wrangler.toml`.*

3. **Initialize Database**:
   ```bash
   # Create schema
   npm run db:init
   # (Optional) Seed with sample jobs
   npm run db:seed
   ```

4. **Create R2 Bucket**:
   ```bash
   wrangler r2 bucket create ordinate-resumes
   ```

5. **Set Secrets**:
   Set the following secrets for your production environment:
   ```bash
   # Current default: 'admin'. Change in wrangler.toml if needed.
   wrangler secret put ADMIN_PASSWORD_HASH # (SHA-256 hex string)
   wrangler secret put JWT_SECRET          # (Random long string)
   wrangler secret put TOTP_SECRET         # (Base32 encoded secret, e.g. JBSWY3DPEHPK3PXP)
   ```

### 3. Local Development
To run the backend locally:
```bash
npm run dev
```

To serve the frontend locally, you can use any static server or `wrangler pages dev`:
```bash
npx wrangler pages dev public/
```

### 4. Admin Final Setup
1. Log in to the admin portal at `/admin/login.html`.
2. First-time login will require you to use the `TOTP_SECRET` you configured.
3. Visit `/admin/totp-setup.html` while logged in to scan the QR code into your authenticator app (Google Authenticator, Authy, etc.).

---

## Technical Stack
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES2022)
- **Backend API**: Cloudflare Workers (TypeScript)
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2
- **Auth**: JWT (Stateless) + TOTP (RFC 6238)
- **Icons**: Emoji & Custom SVG

---

&copy; 2026 Ordinate. Developed by Antigravity.