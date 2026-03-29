document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const totpForm = document.getElementById('totpForm');
    const loginAlert = document.getElementById('loginAlert');
    const totpAlert = document.getElementById('totpAlert');
    const backBtn = document.getElementById('backToLogin');
    const digits = document.querySelectorAll('.totp-digit');
    const step1 = document.getElementById('step-1');
    const step2 = document.getElementById('step-2');

    let tempToken = '';

    // Handle initial credentials
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
            
            if (res.mfa_required) {
                // Show TOTP step
                tempToken = res.token;
                loginForm.classList.add('alert-hidden');
                totpForm.classList.remove('alert-hidden');
                step1.className = 'step-dot done';
                step2.className = 'step-dot active';
                digits[0].focus();
            } else if (res.success && res.token) {
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

    // Handle TOTP submission
    totpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = totpForm.querySelector('button');
        const code = Array.from(digits).map(d => d.value).join('');

        if (code.length !== 6) {
            totpAlert.textContent = 'Please enter all 6 digits.';
            totpAlert.className = 'alert alert-error mt-24';
            return;
        }

        totpAlert.className = 'alert alert-hidden';
        btn.disabled = true;
        btn.textContent = 'Verifying...';

        try {
            // Include both the token and the code
            const res = await window.ordinateApi.admin.totp({ code, token: tempToken });
            
            if (res.success && res.token) {
                localStorage.setItem('ordinate_session', res.token);
                window.location.href = 'dashboard.html';
            }
        } catch (err) {
            totpAlert.textContent = err.message || 'Invalid code.';
            totpAlert.className = 'alert alert-error mt-24';
            btn.disabled = false;
            btn.textContent = 'Verify & Sign In';
            
            // Clear digits on error
            digits.forEach(d => d.value = '');
            digits[0].focus();
        }
    });

    // Back to credentials
    backBtn.addEventListener('click', () => {
        totpForm.classList.add('alert-hidden');
        loginForm.classList.remove('alert-hidden');
        step1.className = 'step-dot active';
        step2.className = 'step-dot';
        const btn = loginForm.querySelector('button');
        btn.disabled = false;
        btn.textContent = 'Continue';
    });

    // Handle digit auto-focus and navigation
    digits.forEach((digit, i) => {
        digit.addEventListener('input', (e) => {
            if (e.data && i < digits.length - 1) {
                digits[i + 1].focus();
            }
        });

        digit.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !digit.value && i > 0) {
                digits[i - 1].focus();
            }
        });

        // Paste support
        digit.addEventListener('paste', (e) => {
            const data = e.clipboardData.getData('text').slice(0, 6);
            if (/^\d+$/.test(data)) {
                data.split('').forEach((v, j) => {
                    if (digits[i + j]) digits[i + j].value = v;
                });
                if (digits[i + data.length - 1]) digits[i + data.length - 1].focus();
                e.preventDefault();
            }
        });
    });
});
