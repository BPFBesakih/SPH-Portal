// This browser only receives an account summary and opaque cookies, never Auth keys/tokens.
(() => {
  'use strict';
  const element = (id) => document.getElementById(id);
  const views = ['login', 'password', 'account'];
  const loginForm = element('login-form');
  const passwordForm = element('password-form');
  const notice = element('notice');
  const controls = document.querySelectorAll('form input, button');
  const passwordInputs = document.querySelectorAll('input[autocomplete$="password"]');
  const messages = {
    INVALID_CREDENTIALS: 'Username atau password salah, atau akun belum dapat digunakan.',
    LOGIN_LIMITED: 'Terlalu banyak percobaan. Tunggu 15 menit sebelum mencoba kembali.',
    SESSION_ENDED: 'Sesi berakhir. Silakan masuk kembali.',
    SESSION_BUSY: 'Permintaan sebelumnya masih diproses. Coba lagi sebentar.',
    INVALID_REQUEST: 'Periksa kembali isian Anda.',
    FORBIDDEN: 'Permintaan tidak diizinkan. Muat ulang halaman lalu coba kembali.',
    PASSWORD_REJECTED: 'Password saat ini tidak cocok atau password baru belum memenuhi ketentuan. Silakan isi kembali.',
    PASSWORD_UPDATE_INCOMPLETE: 'Perubahan belum dapat dikonfirmasi. Coba masuk dengan password baru. Jika tetap gagal, hubungi administrator.',
    AUTH_UNAVAILABLE: 'Layanan akun belum dapat dihubungi. Coba lagi nanti.',
  };
  let account = null;
  let busy = false;
  let generation = 0;

  function clearPasswords() {
    for (const input of passwordInputs) { input.value = ''; input.type = 'password'; input.setCustomValidity(''); }
    element('login-show').checked = false;
    element('password-show').checked = false;
  }
  function setBusy(value) {
    busy = value;
    element('main').setAttribute('aria-busy', String(value));
    for (const control of controls) {
      control.disabled = value;
      if (control.dataset.pending) {
        control.dataset.label ??= control.textContent;
        control.textContent = value ? control.dataset.pending : control.dataset.label;
      }
    }
  }
  function announce(text = '', tone = 'error', focus = true) {
    notice.textContent = text;
    notice.dataset.tone = tone;
    notice.hidden = !text;
    if (text && focus) notice.focus();
  }
  function show(view, focus = true) {
    clearPasswords();
    element('loading').hidden = true;
    for (const name of views) element(`${name}-view`).hidden = name !== view;
    announce('');
    if (focus) element(`${view}-title`).focus();
  }
  function showLogin(message = '', tone = 'error', focus = true) {
    if (account) element('username').value = account.username;
    account = null;
    show('login', focus);
    announce(message, tone, focus);
  }
  function showPassword(focus = true) {
    if (!account) return;
    show('password', focus);
    element('password-username').textContent = account.username;
    element('password-eyebrow').textContent = account.must_change_password ? 'Langkah pertama' : 'Keamanan akun';
    element('password-intro').textContent = account.must_change_password
      ? 'Sebelum melanjutkan, ganti password awal Anda dengan password pribadi.'
      : 'Buat password baru untuk akun Anda.';
    element('password-cancel').hidden = account.must_change_password;
  }
  function showAccount(value, focus = true) {
    if (!value || typeof value.username !== 'string' || typeof value.must_change_password !== 'boolean') {
      throw new Error('AUTH_UNAVAILABLE');
    }
    account = { username: value.username, must_change_password: value.must_change_password };
    if (account.must_change_password) return showPassword(focus);
    show('account', focus);
    element('account-username').textContent = account.username;
  }
  function csrf() {
    const value = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('__Host-sph_csrf='));
    return value?.slice('__Host-sph_csrf='.length) ?? '';
  }
  async function api(action, body) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (['password', 'logout'].includes(action)) headers['X-CSRF-Token'] = csrf();
    const response = await fetch(`/api/auth/${action}`, {
      method: body === undefined ? 'GET' : 'POST', headers, body,
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000),
    });
    const data = await response.json();
    if (!response.ok || data?.ok !== true) {
      const error = new Error(messages[data?.error] ? data.error : 'AUTH_UNAVAILABLE');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function failure(error, changingPassword = false) {
    const code = messages[error?.message] ? error.message : changingPassword ? 'PASSWORD_UPDATE_INCOMPLETE' : 'AUTH_UNAVAILABLE';
    if (code === 'SESSION_ENDED' || code === 'PASSWORD_UPDATE_INCOMPLETE') showLogin(messages[code]);
    else announce(messages[code]);
  }
  async function bootstrap() {
    const current = ++generation;
    account = null;
    clearPasswords();
    for (const name of views) element(`${name}-view`).hidden = true;
    announce('');
    element('loading').hidden = false;
    setBusy(true);
    try {
      const data = await api('me');
      if (current === generation) showAccount(data.account, false);
    } catch (error) {
      if (current === generation) showLogin(error.status === 401 ? '' : messages[error.message] ?? messages.AUTH_UNAVAILABLE, 'error', false);
    } finally { if (current === generation) setBusy(false); }
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const body = JSON.stringify({ username: element('username').value.trim(), password: element('login-password').value });
    clearPasswords();
    announce('');
    setBusy(true);
    const current = generation;
    try {
      const data = await api('login', body);
      if (current === generation) showAccount(data.account);
    } catch (error) { if (current === generation) failure(error); }
    finally { if (current === generation) setBusy(false); }
  });
  passwordForm.addEventListener('input', () => {
    element('new-password').setCustomValidity('');
    element('confirm-password').setCustomValidity('');
  });
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !account) return;
    const next = element('new-password');
    const confirm = element('confirm-password');
    if (next.value === element('current-password').value) next.setCustomValidity('Gunakan password yang berbeda dari password saat ini.');
    if (next.value !== confirm.value) confirm.setCustomValidity('Ulangi password baru dengan nilai yang sama.');
    if (!passwordForm.reportValidity()) return;
    const body = JSON.stringify({ current_password: element('current-password').value, new_password: next.value });
    clearPasswords();
    announce('');
    setBusy(true);
    const current = generation;
    try {
      const data = await api('password', body);
      if (data.password_changed !== true || data.sign_in_required !== true) throw new Error('PASSWORD_UPDATE_INCOMPLETE');
      if (current === generation) showLogin('Password berhasil diubah. Silakan masuk kembali dengan password baru.', 'success');
    } catch (error) { if (current === generation) failure(error, true); }
    finally { if (current === generation) setBusy(false); }
  });
  for (const button of document.querySelectorAll('.logout')) button.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    clearPasswords();
    announce('');
    const current = generation;
    try {
      await api('logout', '{}');
      if (current === generation) showLogin('Anda sudah keluar dari akun.', 'success');
    } catch {
      // Logout can revoke the portal cookie even if upstream signout fails.
      try {
        await api('me');
        if (current === generation) announce('Belum berhasil keluar. Silakan coba kembali.');
      } catch (error) {
        if (current === generation) {
          if (error.status === 401) showLogin('Sesi portal sudah berakhir. Silakan masuk kembali.', 'success');
          else announce('Status keluar belum dapat dikonfirmasi. Muat ulang halaman untuk memeriksa sesi.');
        }
      }
    } finally { if (current === generation) setBusy(false); }
  });
  element('change-password').addEventListener('click', () => { if (!busy) showPassword(); });
  element('password-cancel').addEventListener('click', () => { if (!busy && account && !account.must_change_password) showAccount(account); });
  element('login-show').addEventListener('change', (event) => { element('login-password').type = event.target.checked ? 'text' : 'password'; });
  element('password-show').addEventListener('change', (event) => {
    for (const id of ['current-password', 'new-password', 'confirm-password']) element(id).type = event.target.checked ? 'text' : 'password';
  });
  window.addEventListener('pagehide', () => {
    ++generation;
    clearPasswords();
    account = null;
    for (const name of views) element(`${name}-view`).hidden = true;
    element('loading').hidden = false;
  });
  window.addEventListener('pageshow', (event) => { if (event.persisted) void bootstrap(); });
  void bootstrap();
})();
