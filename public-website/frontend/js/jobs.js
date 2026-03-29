let allJobs = [];

async function loadJobs() {
    const list = document.getElementById('jobsList');
    const empty = document.getElementById('noJobs');

    try {
        const data = await window.ordinateApi.jobs.list();
        allJobs = data.jobs || [];
        renderJobs(allJobs);
    } catch (err) {
        list.innerHTML = `<div class="alert alert-error">Error loading jobs: ${err.message}</div>`;
    }
}

function renderJobs(jobs) {
    const list = document.getElementById('jobsList');
    const empty = document.getElementById('noJobs');

    if (jobs.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('alert-hidden');
        return;
    }

    empty.classList.add('alert-hidden');
    list.innerHTML = jobs.map(job => `
        <div class="job-card" onclick="openJobModal(${job.id})">
            <div class="job-card-header">
                <div>
                    <h3 class="job-card-title">${job.title}</h3>
                    <p class="job-card-dept">${job.department || 'General'} • ${job.type}</p>
                </div>
                <span class="badge badge-blue">New</span>
            </div>
            <div class="job-card-meta">
                    <span>${job.location || 'Remote'}</span>
                    <span>${job.salary_range || 'Competitive'}</span>
            </div>
            <div class="job-card-footer">
                <span class="job-card-date">Posted ${formatDate(job.created_at)}</span>
                <button class="btn btn-outline btn-sm">View Details</button>
            </div>
        </div>
    `).join('');
}

function formatDate(dateStr) {
    if (!dateStr) return 'Recently';
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return `${diffDays}d ago`;
}

function openJobModal(jobId) {
    const job = allJobs.find(j => j.id === jobId);
    if (!job) return;

    document.getElementById('modalTitle').textContent = job.title;
    document.getElementById('modalDept').textContent = `${job.department || 'General'} • ${job.location || 'Remote'} • ${job.type}`;
    document.getElementById('modalDesc').textContent = job.description || 'No description provided.';
    document.getElementById('modalReq').textContent = job.requirements || 'No specific requirements listed.';
    document.getElementById('modalSalary').textContent = job.salary_range || 'Competitive';
    document.getElementById('modalApplyBtn').href = `apply.html?job_id=${job.id}`;

    const overlay = document.getElementById('jobModalOverlay');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeJobModal() {
    const overlay = document.getElementById('jobModalOverlay');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
}

function filterJobs() {
    const search = document.getElementById('jobSearch').value.toLowerCase();
    const dept = document.getElementById('deptFilter').value;
    const type = document.getElementById('typeFilter').value;

    const filtered = allJobs.filter(job => {
        const matchesSearch = job.title.toLowerCase().includes(search) || 
                             (job.department && job.department.toLowerCase().includes(search));
        const matchesDept = !dept || job.department === dept;
        const matchesType = !type || job.type === type;
        return matchesSearch && matchesDept && matchesType;
    });

    renderJobs(filtered);
}

function resetFilters() {
    document.getElementById('jobSearch').value = '';
    document.getElementById('deptFilter').value = '';
    document.getElementById('typeFilter').value = '';
    filterJobs();
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    loadJobs();

    document.getElementById('jobSearch').addEventListener('input', filterJobs);
    document.getElementById('deptFilter').addEventListener('change', filterJobs);
    document.getElementById('typeFilter').addEventListener('change', filterJobs);

    // Close modal on click outside
    document.getElementById('jobModalOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'jobModalOverlay') closeJobModal();
    });
});
