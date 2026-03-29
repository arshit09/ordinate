document.addEventListener('DOMContentLoaded', async () => {
    // ── Check Auth ────────────────────────────────────────────────────────────
    const session = localStorage.getItem('ordinate_session');
    if (!session) {
        try {
            await window.ordinateApi.admin.stats();
        } catch {
            window.location.href = 'login.html';
            return;
        }
    }

    // ── Tab Management ────────────────────────────────────────────────────────
    const tabBtns = document.querySelectorAll('.admin-nav-item[data-tab]');
    const tabContents = document.querySelectorAll('.admin-tab-content');
    const tabTitle = document.getElementById('tabTitle');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tabContents.forEach(c => c.style.display = 'none');
            const target = document.getElementById(`${id}Tab`);
            if (target) target.style.display = 'block';
            tabTitle.textContent = btn.textContent.trim();
            loadTabData(id);

            // Close sidebar on mobile after selection
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('open');
            }
        });
    });

    // ── Sidebar Management ──────────────────────────────────────────────────
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');

    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('open');
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !sidebarToggle.contains(e.target)) {
                sidebar.classList.remove('open');
            }
        });
    }

    async function loadTabData(tab) {
        switch (tab) {
            case 'overview': await loadOverview(); break;
            case 'jobs': await loadJobs(); break;
            case 'applicants': await loadApplicants(); break;
            case 'contacts': await loadContacts(); break;
        }
    }

    // ── Overview ──────────────────────────────────────────────────────────────
    async function loadOverview() {
        try {
            const stats = await window.ordinateApi.admin.stats();
            document.getElementById('statTotalJobs').textContent = stats.totalJobs;
            document.getElementById('statActiveJobs').textContent = stats.activeJobs;
            document.getElementById('statTotalApps').textContent = stats.totalApplications;
            document.getElementById('statPendingApps').textContent = stats.pendingApplications;

            const appData = await window.ordinateApi.admin.applications.list();
            renderAppsTable('recentAppsTable', appData.applications.slice(0, 10));
        } catch (err) {
            showToast('Error loading overview', 'error');
        }
    }

    // ── Jobs ──────────────────────────────────────────────────────────────────
    async function loadJobs() {
        try {
            const data = await window.ordinateApi.admin.jobs.list();
            const table = document.getElementById('jobsTable');
            table.innerHTML = data.jobs.map(job => `
                <tr>
                    <td><strong>${job.title}</strong></td>
                    <td>${job.department || '-'}</td>
                    <td>${job.location || '-'}</td>
                    <td><span class="badge ${job.is_active ? 'badge-green' : 'badge-gray'}">${job.is_active ? 'Active' : 'Draft'}</span></td>
                    <td class="actions">
                        <button onclick="editJob(${job.id})">Edit</button>
                        <button class="btn-danger" onclick="deleteJob(${job.id})">Delete</button>
                    </td>
                </tr>
            `).join('');

            const filter = document.getElementById('appJobFilter');
            filter.innerHTML = '<option value="">All Job Positions</option>' +
                data.jobs.map(j => `<option value="${j.id}">${j.title}</option>`).join('');
            
            if (window.lucide) {
                lucide.createIcons();
            }
        } catch (err) {
            showToast('Error loading jobs', 'error');
        }
    }

    // ── Applicants ────────────────────────────────────────────────────────────
    async function loadApplicants(jobId) {
        try {
            const data = await window.ordinateApi.admin.applications.list(jobId);
            renderAppsTable('applicantsTable', data.applications);
        } catch (err) {
            showToast('Error loading applicants', 'error');
        }
    }

    function renderAppsTable(targetId, apps) {
        const table = document.getElementById(targetId);
        if (apps.length === 0) {
            table.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No applicants found.</td></tr>';
            return;
        }
        table.innerHTML = apps.map(app => `
            <tr>
                <td><strong>${app.first_name} ${app.last_name}</strong></td>
                <td>${app.job_title || 'Deleted Job'}</td>
                <td>${app.years_of_experience} yrs</td>
                <td>${new Date(app.applied_at).toLocaleDateString()}</td>
                <td><span class="badge ${getStatusBadge(app.status)}">${app.status}</span></td>
                <td class="actions">
                    <button onclick="viewApplicant(${app.id})">View Details</button>
                </td>
            </tr>
        `).join('');
        
        if (window.lucide) {
            lucide.createIcons();
        }
    }

    // ── Contacts ──────────────────────────────────────────────────────────────
    async function loadContacts() {
        try {
            const data = await window.ordinateApi.admin.contacts();
            const table = document.getElementById('contactsTable');
            table.innerHTML = data.contacts.map(c => `
                <tr>
                    <td><strong>${c.name}</strong></td>
                    <td>${c.email}</td>
                    <td class="text-muted">${c.message.substring(0, 40)}${c.message.length > 40 ? '...' : ''}</td>
                    <td>${new Date(c.received_at).toLocaleDateString()}</td>
                </tr>
            `).join('');
            
            if (window.lucide) {
                lucide.createIcons();
            }
        } catch (err) {
            showToast('Error loading contacts', 'error');
        }
    }

    // ── Shared UI ─────────────────────────────────────────────────────────────
    function getStatusBadge(s) {
        if (s === 'pending') return 'badge-orange';
        if (s === 'reviewed') return 'badge-blue';
        if (s === 'shortlisted') return 'badge-green';
        if (s === 'rejected') return 'badge-red';
        return 'badge-gray';
    }

    function showToast(msg, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    window.showToast = showToast;
    window.loadOverview = loadOverview;
    window.loadJobs = loadJobs;
    window.loadApplicants = loadApplicants;

    loadOverview();

    // ── Logout ────────────────────────────────────────────────────────────────
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            await window.ordinateApi.admin.logout();
            localStorage.removeItem('ordinate_session');
            window.location.href = 'login.html';
        } catch {
            window.location.href = 'login.html';
        }
    });

    document.getElementById('appJobFilter').addEventListener('change', (e) => {
        loadApplicants(e.target.value);
    });
});

// ── Global Admin Actions ──────────────────────────────────────────────────────

async function viewApplicant(id) {
    const app = await window.ordinateApi.admin.applications.get(id);
    const panel = document.getElementById('slidePanel');
    const body = document.getElementById('panelBody');
    document.getElementById('panelTitle').textContent = `Applicant: ${app.application.first_name}`;

    body.innerHTML = `
        <div class="detail-field">
            <label>Name</label>
            <p>${app.application.first_name} ${app.application.last_name}</p>
        </div>
        <div class="detail-field">
            <label>Email / Phone</label>
            <p>${app.application.email} • ${app.application.phone || 'N/A'}</p>
        </div>
        <div class="detail-field">
            <label>Applied For</label>
            <p>${app.application.job_title}</p>
        </div>
        <div class="detail-field">
            <label>Experience</label>
            <p>${app.application.years_of_experience} Years</p>
        </div>
        <div class="detail-field">
            <label>Status</label>
            <select id="appStatusSelect" onchange="updateAppStatus(${id}, this.value)" class="form-control mt-8">
                <option value="pending" ${app.application.status === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="reviewed" ${app.application.status === 'reviewed' ? 'selected' : ''}>Reviewed</option>
                <option value="shortlisted" ${app.application.status === 'shortlisted' ? 'selected' : ''}>Shortlisted</option>
                <option value="rejected" ${app.application.status === 'rejected' ? 'selected' : ''}>Rejected</option>
            </select>
        </div>
        <div class="mt-24">
            <a href="${window.ordinateApi.BASE}/admin/resume/${encodeURIComponent(app.application.resume_key)}?token=${encodeURIComponent(localStorage.getItem('ordinate_session') || '')}" target="_blank" class="btn btn-primary btn-full">
                Open Resume
            </a>
        </div>
    `;

    if (window.lucide) {
        lucide.createIcons();
    }

    if (window.CustomSelect) {
        new CustomSelect(document.getElementById('appStatusSelect'));
    }

    panel.classList.add('open');
}

async function updateAppStatus(id, status) {
    try {
        await window.ordinateApi.admin.applications.updateStatus(id, { status });
        window.showToast('Status updated');
        window.loadApplicants();
    } catch {
        window.showToast('Failed to update status', 'error');
    }
}

function openJobForm(jobId = null) {
    const modal = document.getElementById('jobAdminModal');
    const form = document.getElementById('jobForm');
    document.getElementById('jobModalTitle').textContent = jobId ? 'Edit Job' : 'Create New Job';
    form.reset();
    document.getElementById('adminJobId').value = jobId;
    modal.classList.add('open');
}

function closeJobModal() { document.getElementById('jobAdminModal').classList.remove('open'); }
function closeSlidePanel() { document.getElementById('slidePanel').classList.remove('open'); }

document.getElementById('jobForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('adminJobId').value;
    const data = {
        title: document.getElementById('adminJobTitle').value,
        department: document.getElementById('adminJobDept').value,
        location: document.getElementById('adminJobLoc').value,
        type: document.getElementById('adminJobType').value,
        salary_range: document.getElementById('adminJobSalary').value,
        description: document.getElementById('adminJobDesc').value,
    };

    try {
        if (id) await window.ordinateApi.admin.jobs.update(id, data);
        else await window.ordinateApi.admin.jobs.create(data);
        window.showToast('Job saved successfully');
        closeJobModal();
        window.loadJobs();
    } catch {
        window.showToast('Error saving job', 'error');
    }
});

async function deleteJob(id) {
    if (!confirm('Are you sure? This will remove the job and potentially break application links.')) return;
    try {
        await window.ordinateApi.admin.jobs.delete(id);
        window.showToast('Job deleted');
        window.loadJobs();
    } catch {
        window.showToast('Error deleting job', 'error');
    }
}
