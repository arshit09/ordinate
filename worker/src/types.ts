export interface Env {
  DB: D1Database;
  RESUME_BUCKET: R2Bucket;
  ADMIN_USERNAME: string;
  ADMIN_PASSWORD_HASH: string;
  JWT_SECRET: string;
  TOTP_SECRET: string;
  CORS_ORIGIN: string;
  ASSETS: Fetcher;
}

export interface Job {
  id: number;
  title: string;
  department: string | null;
  location: string | null;
  type: string;
  description: string | null;
  requirements: string | null;
  salary_range: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Application {
  id: number;
  job_id: number | null;
  job_title?: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  years_of_experience: number | null;
  resume_key: string | null;
  resume_filename: string | null;
  status: string;
  notes: string | null;
  applied_at: string;
  updated_at: string;
}

export interface Contact {
  id: number;
  name: string;
  email: string;
  message: string;
  is_read: number;
  received_at: string;
}

export interface JWTPayload {
  sub: string;
  exp: number;
  iat: number;
  authenticated: boolean;
}
