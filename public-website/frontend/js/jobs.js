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
    
    // Inject Structured Data for SEO/AI
    updateJobSchema(jobs);

    if (window.lucide) {
        lucide.createIcons();
    }
}

/**
 * Injects JSON-LD structured data for the listed jobs.
 * This helps Google Jobs and AI tools understand the openings.
 */
function updateJobSchema(jobs) {
    let script = document.getElementById('jobs-schema');
    if (!script) {
        script = document.createElement('script');
        script.id = 'jobs-schema';
        script.type = 'application/ld+json';
        document.head.appendChild(script);
    }

    const schemaData = jobs.slice(0, 10).map(job => ({
        "@context": "https://schema.org/",
        "@type": "JobPosting",
        "title": job.title,
        "description": job.description || 'Join the Ordinate team.',
        "datePosted": job.created_at || new Date().toISOString(),
        "validThrough": new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        "employmentType": job.type === 'Full-time' ? 'FULL_TIME' : (job.type === 'Contract' ? 'CONTRACTOR' : 'OTHER'),
        "hiringOrganization": {
            "@type": "Organization",
            "name": "Ordinate Ltd.",
            "sameAs": "https://ordinate.io",
            "logo": "https://ordinate.io/assets/images/logo.svg"
        },
        "jobLocation": {
            "@type": "Place",
            "address": {
                "@type": "PostalAddress",
                "streetAddress": "123 Innovation Drive",
                "addressLocality": "Toronto",
                "addressRegion": "ON",
                "postalCode": "M5V 3M2",
                "addressCountry": "CA"
            }
        },
        "baseSalary": {
            "@type": "MonetaryAmount",
            "currency": "USD",
            "value": {
                "@type": "QuantitativeValue",
                "value": job.salary_min || 100000,
                "unitText": "YEAR"
            }
        }
    }));

    script.textContent = JSON.stringify(schemaData);
}

function formatDate(dateStr) {
    if (!dateStr) return 'Recently';
    
    // SQLite/D1 returns 'YYYY-MM-DD HH:MM:SS' in UTC. 
    // We convert to ISO 'YYYY-MM-DDTHH:MM:SSZ' to ensure UTC parsing across browsers.
    const date = new Date(dateStr.replace(' ', 'T') + 'Z');
    const now = new Date();
    const diffMs = now - date;
    
    // Handle small clock drift or future dates
    if (diffMs < 0) return 'Just now';
    
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 60) {
        if (diffMins <= 1) return 'Just now';
        return `${diffMins}m ago`;
    }
    
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHrs < 24) {
        return `${diffHrs}h ago`;
    }
    
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
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
    
    // Sync custom dropdowns if they exist
    const selects = ['deptFilter', 'typeFilter'];
    selects.forEach(id => {
        const customEl = document.getElementById('custom-' + id);
        if (customEl && customEl._customSelect) {
            customEl._customSelect.refresh();
        }
    });

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
