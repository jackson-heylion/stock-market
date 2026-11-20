// Site-wide color theme controller, independent from the simulated trading ledger.
export const THEME_KEY = 'stock-market-theme-v1';
export const DEFAULT_THEME = 'dark';

export function normalizeTheme(value) {
  return value === 'light' ? 'light' : 'dark';
}

export function readTheme(storage) {
  try { return normalizeTheme(storage?.getItem(THEME_KEY)); }
  catch { return DEFAULT_THEME; }
}

export function applyTheme(theme, {root, button, meta} = {}) {
  const resolved = normalizeTheme(theme);
  if (root) root.dataset.theme = resolved;
  if (button) {
    const nextLight = resolved === 'dark';
    button.setAttribute('aria-label', nextLight ? '切换到亮色主题' : '切换到暗色主题');
    button.setAttribute('aria-pressed', String(resolved === 'light'));
    button.title = nextLight ? '切换到亮色主题' : '切换到暗色主题';
    const icon = button.querySelector('.theme-icon');
    const label = button.querySelector('.theme-label');
    if (icon) icon.textContent = nextLight ? '☀' : '☾';
    if (label) label.textContent = nextLight ? '亮色' : '暗色';
  }
  if (meta) meta.setAttribute('content', resolved === 'light' ? '#f4f7fb' : '#080f1b');
  return resolved;
}

export function initTheme({root, button, meta, storage} = {}) {
  const doc = typeof document !== 'undefined' ? document : null;
  const el = root ?? doc?.documentElement;
  const btn = button ?? doc?.getElementById('theme-toggle');
  const themeMeta = meta ?? doc?.querySelector('meta[name="theme-color"]');
  let store = storage;
  if (store === undefined) {
    try { store = typeof localStorage === 'undefined' ? null : localStorage; }
    catch { store = null; }
  }
  applyTheme(readTheme(store), {root:el, button:btn, meta:themeMeta});
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = el?.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next, {root:el, button:btn, meta:themeMeta});
    try { store?.setItem(THEME_KEY, next); }
    catch { /* restricted private browsing: choice lasts until reload */ }
  });
}
