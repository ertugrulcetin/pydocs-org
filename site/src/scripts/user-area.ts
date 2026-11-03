// Navbar user area (ClojureDocs' $user-area): when the readable pd_user cookie
// is set, "Log In" becomes the GitHub avatar + "Log Out". Otherwise the Log In
// link returns to the exact current URL (static pages, e.g. 404, can't know it).
const raw = document.cookie.match(/(?:^|;\s*)pd_user=([^;]+)/)?.[1];

const decode = (s: string): { id: number; login: string } | null => {
  try {
    const json = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const u = JSON.parse(json) as { id?: unknown; login?: unknown };
    return typeof u.id === 'number' && typeof u.login === 'string' ? { id: u.id, login: u.login } : null;
  } catch {
    return null;
  }
};

const user = raw ? decode(raw) : null;
document.querySelectorAll<HTMLElement>('[data-user-area]').forEach((li) => {
  if (user) {
    li.classList.add('user-area');
    const a = document.createElement('a');
    a.href = '/auth/logout';
    a.title = `Logged in as ${user.login}`;
    const img = document.createElement('img');
    img.className = 'avatar';
    img.alt = '';
    img.src = `https://avatars.githubusercontent.com/u/${user.id}?s=64`;
    a.append(img, ' Log Out');
    li.replaceChildren(a);
  } else {
    const a = li.querySelector('a');
    if (a) a.href = `/auth/login?return=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
  }
});
if (user) document.body.classList.add('logged-in');
