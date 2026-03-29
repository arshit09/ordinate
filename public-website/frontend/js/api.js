// Auto-detect API base:
//  - Local dev  (Live Server / file://)  → Wrangler dev server on :8787
//  - Production (Cloudflare Pages etc.)  → same-origin /api  (proxied to Worker)
const _host = window.location.hostname;
const API_BASE = (_host === 'localhost' || _host === '127.0.0.1' || _host === '')
    ? 'http://localhost:8787/api'
    : 'https://broken-sound-2f22.jayanbhadiyadra4561.workers.dev/api';

async function apiFetch(path, options = {}) {
    const defaultHeaders = {
        'Content-Type': 'application/json',
    };

    const config = {
        ...options,
        headers: {
            ...defaultHeaders,
            ...options.headers,
        },
    };

    try {
        const response = await fetch(`${API_BASE}${path}`, config);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Something went wrong');
        }

        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

const api = {
    jobs: {
        list: () => apiFetch('/jobs'),
        get: (id) => apiFetch(`/jobs/${id}`),
    },
    contact: {
        send: (data) => apiFetch('/contact', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
    },
    apply: {
        submit: (formData) => fetch(`${API_BASE}/apply`, {
            method: 'POST',
            body: formData, // FormData handles its own multipart/form-data headers
        }).then(res => res.json().then(data => {
            if (!res.ok) throw new Error(data.error || 'Upload failed');
            return data;
        })),
    },
    admin: {
        login: (credentials) => apiFetch('/admin/login', {
            method: 'POST',
            body: JSON.stringify(credentials),
        }),
        totp: (data) => apiFetch('/admin/totp', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
        logout: () => apiFetch('/admin/logout', { method: 'POST' }),
        stats: () => apiFetch('/admin/stats'),
        jobs: {
            list: () => apiFetch('/admin/jobs'),
            create: (data) => apiFetch('/admin/jobs', {
                method: 'POST',
                body: JSON.stringify(data),
            }),
            update: (id, data) => apiFetch(`/admin/jobs/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data),
            }),
            delete: (id) => apiFetch(`/admin/jobs/${id}`, { method: 'DELETE' }),
        },
        applications: {
            list: (jobId) => apiFetch(`/admin/applications${jobId ? `?job_id=${jobId}` : ''}`),
            get: (id) => apiFetch(`/admin/applications/${id}`),
            updateStatus: (id, data) => apiFetch(`/admin/applications/${id}/status`, {
                method: 'PATCH',
                body: JSON.stringify(data),
            }),
        },
        totpSetup: () => apiFetch('/admin/totp-setup'),
    }
};

window.ordinateApi = api;
window.ordinateApi.BASE = API_BASE;
