document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const totpForm = document.getElementById('totpForm');
    const loginAlert = document.getElementById('loginAlert');
    const totpAlert = document.getElementById('totpAlert');
    const backBtn = document.getElementById('backToLogin');
    const digits = document.querySelectorAll('.totp-digit');

    let savedCredentials = { username: '', password: '' };

    // Step 1: Login Submission
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
            if (res.requires_totp) {
                savedCredentials = { username, password };
                loginForm.style.display = 'none';
                totpForm.style.display = 'block';
                digits[0].focus();
            }
        } catch (err) {
            loginAlert.textContent = err.message || 'Login failed.';
            loginAlert.className = 'alert alert-error';
            btn.disabled = false;
            btn.textContent = 'Continue';
        }
    });

    // TOTP digit auto-focus logic
    digits.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            if (e.inputType === 'deleteContentBackward') return;
            if (input.value && index < digits.length - 1) {
                digits[index + 1].focus();
            }
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !input.value && index > 0) {
                digits[index - 1].focus();
            }
        });
    });

    // Step 2: TOTP Verification
    totpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = totpForm.querySelector('button');
        const code = Array.from(digits).map(d => d.value).join('');

        if (code.length < 6) return;

        totpAlert.className = 'alert alert-hidden';
        btn.disabled = true;
        btn.textContent = 'Signing in...';

        try {
            const data = await window.ordinateApi.admin.totp({
                ...savedCredentials,
                code
            });
            if (data.success) {
                // Store JWT in localStorage as backup (HttpOnly cookie is master)
                if (data.token) localStorage.setItem('ordinate_session', data.token);
                window.location.href = '/admin/dashboard.html';
            }
        } catch (err) {
            totpAlert.textContent = err.message || 'Invalid code.';
            totpAlert.className = 'alert alert-error';
            btn.disabled = false;
            btn.textContent = 'Verify & Sign In';
            // Clear inputs on error
            digits.forEach(d => d.value = '');
            digits[0].focus();
        }
    });

    backBtn.addEventListener('click', () => {
        totpForm.style.display = 'none';
        loginForm.style.display = 'block';
        loginAlert.className = 'alert alert-hidden';
        loginForm.querySelector('button').disabled = false;
        loginForm.querySelector('button').textContent = 'Continue';
    });
});
