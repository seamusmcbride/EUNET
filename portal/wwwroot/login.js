const form = document.getElementById('form');
const error = document.getElementById('error');
const submit = document.getElementById('submit');
const showError = (msg) => { error.textContent = msg; error.classList.toggle('d-none', !msg); };

document.getElementById('reveal').onclick = (e) => {
  e.preventDefault();
  const pw = document.getElementById('password');
  pw.type = pw.type === 'password' ? 'text' : 'password';
};

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const name = form.name.value.trim(), password = form.password.value;
  if (!name || !password) { showError('Enter your user name and password.'); return; }
  submit.disabled = true;
  submit.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Signing in…';
  try {
    if (window.EUNET_DEMO) { location.href = 'index.html'; return; }
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EUNET': '1' },
      body: JSON.stringify({ name, password, remember: document.getElementById('remember').checked }),
    });
    if (res.ok) { location.href = 'index.html'; return; }
    if (res.status === 429) showError('Too many attempts. Wait a minute and try again.');
    else showError((await res.json().catch(() => ({}))).error || 'Sign-in failed.');
  } catch {
    showError("Can't reach the server. Check your connection.");
  }
  submit.disabled = false;
  submit.innerHTML = '<i class="ti ti-login-2 me-2"></i>Sign in';
  form.password.select();
});
