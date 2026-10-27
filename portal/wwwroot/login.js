const form = document.getElementById('form');
const error = document.getElementById('error');
const submit = document.getElementById('submit');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.textContent = '';
  const name = form.name.value.trim(), password = form.password.value;
  if (!name || !password) { error.textContent = 'Enter your user name and password.'; return; }
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EUNET': '1' },
      body: JSON.stringify({ name, password, remember: document.getElementById('remember').checked }),
    });
    if (res.ok) { location.href = '/'; return; }
    if (res.status === 429) error.textContent = 'Too many attempts. Wait a minute and try again.';
    else error.textContent = (await res.json().catch(() => ({}))).error || 'Sign-in failed.';
  } catch {
    error.textContent = "Can't reach the server. Check your connection.";
  }
  submit.disabled = false;
  submit.textContent = 'Sign in';
  form.password.select();
});
