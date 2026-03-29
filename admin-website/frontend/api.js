// ── Admin Worker URL ──────────────────────────────────────────────────────────
// Set this to your admin Cloudflare Worker URL after deploying admin-worker.js
const ADMIN_WORKER_URL = 'https://admin-panel.jayanbhadiyadra4561.workers.dev/';

const API_BASE = ADMIN_WORKER_URL.replace(/\/$/, '') + '/api';

function getToken() {
    return localStorage.getItem('ordinate_session');
}

async function apiFetch(path, options = {}) {
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers,
    };

    const config = { ...options, headers };

    try {
        const response = await fetch(`${API_BASE}${path}`, config);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Something went wrong');
        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

const api = {
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
            get: (id) => apiFetch(`/admin/jobs/${id}`),
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
            delete: (id) => apiFetch(`/admin/applications/${id}`, { method: 'DELETE' }),
        },
        contacts: () => apiFetch('/admin/contacts'),
    }
};

window.ordinateApi = api;
window.ordinateApi.BASE = API_BASE;
