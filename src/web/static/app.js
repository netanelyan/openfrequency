// The desk's one script. Everything works without it; this makes the common
// actions one tap without a page load, and makes the slide strip feel native.
(() => {
  document.documentElement.classList.add('js');
  const toast = document.getElementById('toast');
  let toastTimer = null;
  const say = (msg, bad = false) => {
    if (!toast || !msg) return;
    toast.textContent = msg;
    toast.classList.toggle('bad', bad);
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  };
  if (toast?.dataset.flash) say(toast.dataset.flash);

  // The navigation bar lifts once the page scrolls under it.
  const lift = () => document.documentElement.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', lift, { passive: true });
  lift();

  // Two taps for anything that cannot be undone in one.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-confirm]');
    if (!b) return;
    if (b.dataset.armed === '1') return;
    e.preventDefault();
    b.dataset.armed = '1';
    b.dataset.label = b.innerHTML;
    b.classList.add('armed');
    b.textContent = b.dataset.confirm;
    setTimeout(() => {
      if (b.dataset.armed === '1') {
        b.dataset.armed = '';
        b.classList.remove('armed');
        b.innerHTML = b.dataset.label;
      }
    }, 3500);
  });

  // Show or hide a panel (the reject box).
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-toggle]');
    if (!b) return;
    const box = document.querySelector(b.dataset.toggle);
    if (!box) return;
    const open = box.classList.toggle('open');
    b.setAttribute('aria-expanded', String(open));
    if (open) box.querySelector('select, input, textarea')?.focus();
  });

  // Forms marked data-ajax post in the background.
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-ajax]');
    if (!form) return;
    const btn = form.querySelector('[data-confirm]');
    if (btn && btn.dataset.armed !== '1') return;
    e.preventDefault();
    const submit = form.querySelector('button[type=submit]');
    submit?.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'x-of-ajax': '1', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)),
        credentials: 'same-origin',
      });
      const out = await res.json().catch(() => ({ ok: false, message: 'תשובה לא צפויה מהשרת' }));
      const kind = form.dataset.ajax;
      if (kind === 'theme' && out.theme) {
        document.documentElement.dataset.theme = out.theme;
        return;
      }
      say(out.message, !out.ok);
      if (!out.ok) return;
      if (kind === 'remove') {
        const card = form.closest('[data-post]');
        if (card) {
          card.style.maxHeight = `${card.scrollHeight}px`;
          card.classList.add('leaving');
          setTimeout(() => card.classList.add('gone'), 220);
          setTimeout(() => card.remove(), 600);
        }
      } else if (kind === 'reload') {
        setTimeout(() => location.reload(), 400);
      }
    } catch {
      say('אין חיבור. נסו שוב.', true);
    } finally {
      submit?.removeAttribute('aria-busy');
    }
  });

  // A segmented control submits as soon as it changes.
  document.querySelectorAll('form[data-autosubmit]').forEach((form) => {
    form.addEventListener('change', () => form.requestSubmit());
  });

  // Dots that follow the slide strip.
  document.querySelectorAll('[data-strip]').forEach((strip) => {
    const dots = strip.nextElementSibling?.matches('.dots') ? [...strip.nextElementSibling.children] : [];
    if (!dots.length || !('IntersectionObserver' in window)) return;
    const slides = [...strip.children];
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.intersectionRatio > 0.6) {
            const i = slides.indexOf(en.target);
            dots.forEach((d, k) => d.classList.toggle('on', k === i));
          }
        }
      },
      { root: strip, threshold: [0.6] }
    );
    slides.forEach((s) => io.observe(s));
  });

  // A link to a folded panel on the same page (Edit, to #edit) opens it.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    const target = a && a.getAttribute('href').length > 1 ? document.querySelector(a.getAttribute('href')) : null;
    if (target?.tagName === 'DETAILS') target.open = true;
  });

  // Tapping a slide opens its facts.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('.strip a[href^="#s-"]');
    if (!a) return;
    const target = document.querySelector(a.getAttribute('href'));
    const details = target?.closest('details');
    if (details) details.open = true;
    const first = target?.querySelector('details.fact');
    if (first) first.open = true;
  });
})();
