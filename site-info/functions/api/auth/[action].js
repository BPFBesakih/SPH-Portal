import { handleAuth, handlePortal } from '../../../lib/portal-auth.mjs';

export function onRequest({ request, env }) {
  return new URL(request.url).pathname === '/api/auth/reset' ? handlePortal(request, env) : handleAuth(request, env);
}
