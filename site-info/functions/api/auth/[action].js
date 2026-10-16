import { handleAuth } from '../../../lib/portal-auth.mjs';

export function onRequest({ request, env }) {
  return handleAuth(request, env);
}
