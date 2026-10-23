// Installable-app support: registers sw.js from the same folder as the page (/app/ on
// Cloudflare, / on a local Node.js install). The worker only shows an offline notice and keeps
// no portal data, so registering it after the page has loaded is enough.
export function registerServiceWorker(env = globalThis) {
  const container = env.navigator?.serviceWorker;
  if (!env.isSecureContext || !container) return Promise.resolve(null);
  const register = () => container.register(new URL('sw.js', env.location.href)).catch(() => null);
  if (env.document?.readyState === 'complete') return register();
  return new Promise((resolve) => env.addEventListener('load', () => resolve(register()), {once: true}));
}
