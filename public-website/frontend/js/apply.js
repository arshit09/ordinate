document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const jobId = urlParams.get('job_id');
    const jobTitleElem = document.getElementById('jobTitle');
    const jobMetaElem = document.getElementById('jobMeta');
    const jobIdInput = document.getElementById('jobId');

    if (!jobId) {
        window.location.href = '/jobs.html';
        return;
    }

    jobIdInput.value = jobId;

    // Load Job Details for the banner
    try {
        const data = await window.ordinateApi.jobs.get(jobId);
        if (data.job) {
            jobTitleElem.textContent = data.job.title;
            jobMetaElem.textContent = `${data.job.department || 'General'} • ${data.job.location || 'Remote'} • ${data.job.type}`;
            document.getElementById('successJobTitle').textContent = data.job.title;
        }
    } catch (err) {
        jobMetaElem.textContent = 'Error loading position details.';
    }

    // File Upload Drag & Drop Logic
    const fileDrop = document.getElementById('fileDrop');
    const fileInput = document.getElementById('resumeFile');
    const fileNameDisplay = document.getElementById('fileNameDisplay');

    fileDrop.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            const fileName = fileInput.files[0].name;
            fileNameDisplay.innerHTML = `Selected file: <strong style="color: var(--primary);">${fileName}</strong>`;
        }
    });

    fileDrop.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileDrop.classList.add('drag-over');
    });

    fileDrop.addEventListener('dragleave', () => {
        fileDrop.classList.remove('drag-over');
    });

    fileDrop.addEventListener('drop', (e) => {
        e.preventDefault();
        fileDrop.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            const fileName = e.dataTransfer.files[0].name;
            fileNameDisplay.innerHTML = `Selected file: <strong style="color: var(--primary);">${fileName}</strong>`;
        }
    });

    // Form Submission Logic
    const applyForm = document.getElementById('applyForm');
    const alert = document.getElementById('applyAlert');
    const applyCard = document.getElementById('applyCard');
    const successView = document.getElementById('successView');

    applyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = applyForm.querySelector('button');
        const formData = new FormData(applyForm);

        alert.className = 'alert alert-hidden';
        btn.disabled = true;
        btn.textContent = 'Submitting Application...';

        try {
            await window.ordinateApi.apply.submit(formData);
            applyCard.style.display = 'none';
            successView.style.display = 'block';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            alert.textContent = err.message || 'Error submitting application. Please try again.';
            alert.className = 'alert alert-error';
            btn.disabled = false;
            btn.textContent = 'Submit Application';
        }
    });
});
