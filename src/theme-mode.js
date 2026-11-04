(() => {
  const storageKey = 'kpi-panel-theme';
  const root = document.documentElement;
  let selected = 'dark';
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'dark' || saved === 'light') selected = saved;
  } catch {
    // The visual preference remains usable when browser storage is unavailable.
  }
  root.dataset.theme = selected;

  const updateButton = () => {
    const button = document.querySelector('#themeToggle');
    if (!button) return;
    const dark = root.dataset.theme === 'dark';
    const label = dark ? 'تغییر به حالت روز' : 'تغییر به حالت شب';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(dark));
    button.title = label;
  };
  const connectButton = () => {
    const button = document.querySelector('#themeToggle');
    if (!button) return;
    updateButton();
    button.addEventListener('click', () => {
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(storageKey, root.dataset.theme); } catch { /* Keep the current selection. */ }
      updateButton();
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connectButton, {once: true});
  else connectButton();
})();
