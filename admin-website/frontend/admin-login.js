document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const totpForm = document.getElementById('totpForm');
    const loginAlert = document.getElementById('loginAlert');
    const totpAlert = document.getElementById('totpAlert');
    const backBtn = document.getElementById('backToLogin');
    const digits = document.querySelectorAll('.totp-digit');

    let savedCredentials = { username: '', password: '' };

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = loginForm.querySelector('button');
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        loginAlert.className = 'alert alert-hidden';
        btn.disabled = true;
        btn.textContent = 'Verifying...';

        try {
            const res = await window.ordinateApi.admin.login({ username, password });
            if (res.success && res.token) {
                localStorage.setItem('ordinate_session', res.token);
                window.location.href = 'dashboard.html';
            }
        } catch (err) {
            loginAlert.textContent = err.message || 'Login failed.';
            loginAlert.className = 'alert alert-error';
            btn.disabled = false;
            btn.textContent = 'Continue';
        }
    });
});
