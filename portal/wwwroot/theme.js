// Follow the device's light/dark setting (Tabler reads data-bs-theme)
try {
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const apply = () => document.documentElement.setAttribute('data-bs-theme', dark.matches ? 'dark' : 'light');
  apply();
  dark.addEventListener('change', apply);
} catch { /* keep the default light theme */ }
