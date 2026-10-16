import { withSupabase } from "npm:@supabase/server@1";

// Temporary setup recovery, limited to the confirmed technical administrator.
// Uses the supported Auth Admin API, never edits auth.users/password hashes.
const expectedUsername = "itadmin";
const expectedEmail = "bpfbesakih@gmail.com";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", Allow: "POST" } });
}

async function newPassword(req: Request): Promise<string> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !req.body) {
    throw new Error("request");
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2048) { await reader.cancel(); throw new Error("request"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const password = body?.new_password;
  if (!body || Array.isArray(body) || typeof password !== "string" || password.length < 12
      || password.length > 128 || !password.trim()) throw new Error("request");
  return password;
}

async function recover(req: Request): Promise<Response> {
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  let password: string;
  try { password = await newPassword(req); }
  catch { return reply({ ok: false, error: "INVALID_REQUEST", message: "Isi new_password dengan 12–128 karakter." }, 400); }

  let base: string, key: string;
  try {
    const url = new URL(Deno.env.get("SUPABASE_URL")?.trim() ?? "");
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
        || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/") {
      throw new Error("configuration");
    }
    base = url.origin;
    const dictionary = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
    const configuredKey = dictionary ? JSON.parse(dictionary)?.default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (typeof configuredKey !== "string" || !configuredKey.trim()) throw new Error("configuration");
    key = configuredKey.trim();
  } catch { return reply({ ok: false, error: "RECOVERY_CONFIGURATION_UNAVAILABLE" }, 503); }

  const headers = {
    "Content-Type": "application/json", apikey: key,
    ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}),
  };
  async function request(path: string, method = "GET", body?: unknown) {
    return await fetch(`${base}${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error", signal: AbortSignal.timeout(12000),
    });
  }

  try {
    const resolvedResponse = await request("/rest/v1/rpc/portal_resolve_login", "POST", { p_username: expectedUsername });
    if (!resolvedResponse.ok) throw new Error("resolve");
    const identities = await resolvedResponse.json();
    if (!Array.isArray(identities) || identities.length !== 1
        || !uuid.test(identities[0]?.auth_user_id)
        || identities[0]?.login_email?.toLowerCase() !== expectedEmail) {
      return reply({ ok: false, error: "TARGET_ACCOUNT_NOT_READY" }, 409);
    }
    const userId = identities[0].auth_user_id;

    const roleResponse = await request("/rest/v1/app_roles?code=eq.SUPER_ADMIN&is_system=eq.true&is_active=eq.true&select=id");
    if (!roleResponse.ok) throw new Error("role");
    const roles = await roleResponse.json();
    if (!Array.isArray(roles) || roles.length !== 1 || !uuid.test(roles[0]?.id)) {
      return reply({ ok: false, error: "TARGET_ACCOUNT_NOT_READY" }, 409);
    }
    const assignmentResponse = await request(`/rest/v1/app_user_roles?user_id=eq.${encodeURIComponent(userId)}&role_id=eq.${encodeURIComponent(roles[0].id)}&scope_kind=eq.ALL&select=id`);
    if (!assignmentResponse.ok) throw new Error("assignment");
    const assignments = await assignmentResponse.json();
    if (!Array.isArray(assignments) || assignments.length !== 1 || !uuid.test(assignments[0]?.id)) {
      return reply({ ok: false, error: "TARGET_ACCOUNT_NOT_READY" }, 409);
    }

    const updated = await request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, "PUT", { password });
    if (!updated.ok) {
      return reply({ ok: false, error: [400, 422].includes(updated.status) ? "PASSWORD_REJECTED" : "RECOVERY_UNAVAILABLE" },
        [400, 422].includes(updated.status) ? 400 : 503);
    }
    // Keep the existing Auth UID, application links, role, and password flag.
    return reply({ ok: true, username: expectedUsername, password_reset: true });
  } catch {
    // Never log or echo a password, key, upstream body, or exception.
    return reply({ ok: false, error: "RECOVERY_UNAVAILABLE" }, 503);
  }
}

export default {
  fetch: withSupabase({ auth: "secret" }, recover),
};
