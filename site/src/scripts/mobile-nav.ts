// Port of ClojureDocs' mobile menu behavior (src/cljs/clojuredocs/main.cljs):
// the hamburger toggles `mobile-push` on the page wrapper, the slide-out menu,
// and the mobile navbar; any tap outside the menu, or on a menu link, closes it.
const PUSH_SELECTORS = ['.mobile-push-wrapper', '.mobile-nav-menu', '.mobile-nav-bar'];

const pushEls = (): Element[] =>
  PUSH_SELECTORS.map((s) => document.querySelector(s)).filter((el): el is Element => el !== null);

const close = (): void => pushEls().forEach((el) => el.classList.remove('mobile-push'));

document.querySelectorAll<HTMLButtonElement>('.btn.mobile-menu').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    pushEls().forEach((el) => el.classList.toggle('mobile-push'));
    e.stopPropagation();
  });
});

document.body.addEventListener('click', close);

const menu = document.querySelector<HTMLElement>('.mobile-nav-menu');
if (menu) {
  for (const type of ['click', 'touchstart', 'touchend'] as const) {
    menu.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
  }
  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));

  // The menu fills the viewport height (ClojureDocs' bind-resize).
  const fit = (): void => {
    menu.style.height = `${window.innerHeight}px`;
  };
  fit();
  window.addEventListener('resize', fit, { passive: true });
}

// Preview and local builds show the staging banner (PLAN.md §5 #31).
if (location.hostname !== 'pydocs.org') {
  document.querySelector<HTMLElement>('.staging-banner')?.removeAttribute('hidden');
}
