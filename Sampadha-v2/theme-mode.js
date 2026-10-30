// Light or dark mode: the person's choice on this device, otherwise the system setting. Loaded in
// <head> before the stylesheets so the first paint is already in the right mode. Any button with
// data-mode-toggle switches it; charts listen for the 'sampadha:mode' event to redraw.
(() => {
  const KEY = 'sampadha-mode';
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const saved = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  function label() {
    const dark = root.dataset.mode === 'dark';
    for (const button of document.querySelectorAll('[data-mode-toggle]')) {
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      button.title = dark ? 'Light mode' : 'Dark mode';
    }
  }
  function apply(mode) {
    root.dataset.mode = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#0b111d' : '#f3f5f8');
    label();
    window.dispatchEvent(new CustomEvent('sampadha:mode', { detail: mode }));
  }
  apply(saved() === 'dark' || saved() === 'light' ? saved() : system.matches ? 'dark' : 'light');
  system.addEventListener('change', (event) => {
    if (!saved()) apply(event.matches ? 'dark' : 'light');
  });
  try {
    localStorage.removeItem('sampadha-theme'); // the old four-scheme picker
  } catch {}
  document.addEventListener('DOMContentLoaded', label);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-mode-toggle]')) return;
    const next = root.dataset.mode === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    // The new palette spreads out from the switch as a circle (View Transitions, where the
    // browser has it); with reduced motion, or without the API, it changes at once.
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || still) return apply(next);
    const box = event.target.closest('[data-mode-toggle]').getBoundingClientRect(),
      x = box.left + box.width / 2,
      y = box.top + box.height / 2,
      radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.classList.add('mode-switching');
    const transition = document.startViewTransition(() => apply(next));
    transition.ready
      .then(() =>
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 620, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
        ),
      )
      .catch(() => {});
    transition.finished.finally(() => root.classList.remove('mode-switching'));
  });
})();
