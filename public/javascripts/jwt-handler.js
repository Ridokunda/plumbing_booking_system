// Attach the session-bound CSRF token to same-origin state-changing requests.
// The filename is retained so existing page includes remain cache-compatible.
(function installSecureFetch() {
  const originalFetch = window.fetch.bind(window);

  window.fetch = function secureFetch(resource, options = {}) {
    const url = typeof resource === 'string' ? resource : resource.url;
    const isSameOrigin =
      url.startsWith('/') || new URL(url, window.location.href).origin === window.location.origin;
    const method = (options.method || 'GET').toUpperCase();

    if (isSameOrigin && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const headers = new Headers(options.headers || {});
      const csrfCookie = document.cookie
        .split('; ')
        .find((value) => value.startsWith('csrfToken='));

      if (csrfCookie) {
        headers.set('X-CSRF-Token', decodeURIComponent(csrfCookie.split('=').slice(1).join('=')));
      }
      options.headers = headers;
    }

    return originalFetch(resource, options);
  };
})();
