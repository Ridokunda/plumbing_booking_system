(() => {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const toggle = header.querySelector('.site-nav-toggle');
  const links = header.querySelector('.site-nav-links');

  function setMenu(open) {
    header.dataset.menuOpen = String(open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  setMenu(false);
  toggle.hidden = false;
  toggle.addEventListener('click', () => setMenu(header.dataset.menuOpen !== 'true'));
  links.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMenu(false);
  });
  header.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && header.dataset.menuOpen === 'true') {
      setMenu(false);
      toggle.focus();
    }
  });

  const badge = header.querySelector('#notification-count');
  if (badge && window.EventSource) {
    const stream = new window.EventSource('/notifications/stream');
    stream.addEventListener('unread', (event) => {
      const count = Number(JSON.parse(event.data).unreadCount || 0);
      badge.textContent = String(count);
      badge.hidden = count === 0;
      badge.setAttribute('aria-label', `${count} unread notifications`);
    });
  }
})();
