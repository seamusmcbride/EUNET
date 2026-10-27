const form = document.getElementById('form');
const error = document.getElementById('error');
const submit = document.getElementById('submit');
const showError = (msg) => { error.textContent = msg; error.classList.toggle('d-none', !msg); };

document.getElementById('reveal').onclick = (e) => {
  e.preventDefault();
  const pw = document.getElementById('password');
  pw.type = pw.type === 'password' ? 'text' : 'password';
};

// Offer certificate sign-in when the server has it turned on
if (!window.EUNET_DEMO) {
  fetch('/api/login/options').then((r) => r.json()).then((o) => { document.getElementById('certOption').hidden = !o.certificate; }).catch(() => {});
}
const certBtn = document.getElementById('certLogin');
certBtn.onclick = async () => {
  showError('');
  certBtn.disabled = true;
  certBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Checking certificate…';
  try {
    const res = await fetch('/api/login/certificate', { method: 'POST', headers: { 'X-EUNET': '1' } });
    if (res.ok) { location.href = 'index.html'; return; }
    showError(res.status === 429 ? 'Too many attempts. Wait a minute and try again.' : (await res.json().catch(() => ({}))).error || 'Certificate sign-in failed.');
  } catch {
    showError("Can't reach the server. Check your connection.");
  }
  certBtn.disabled = false;
  certBtn.innerHTML = '<i class="ti ti-certificate me-2"></i>Sign in with my certificate';
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
