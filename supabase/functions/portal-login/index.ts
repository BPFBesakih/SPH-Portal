import { withSupabase } from "npm:@supabase/server@1";

// Server-to-server only. Never put a secret API key or the returned session in
// static frontend code. The future web backend must protect its own session.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scopes = new Set(["SELF", "ASSIGNED_UNITS", "ASSIGNED_POSTS", "ALL"]);
const invalidCredentials = {
  ok: false, error: "INVALID_CREDENTIALS",
  message: "Username atau password salah, atau akun belum dapat digunakan.",
};

function reply(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store", "Allow": "POST",
      ...(status === 429 ? { "Retry-After": "900" } : {}),
    },
  });
}

function apiKey(dictionaryName: string, legacyName: string): string {
  const dictionary = Deno.env.get(dictionaryName)?.trim();
  if (dictionary) {
    const value = JSON.parse(dictionary)?.default;
    if (typeof value !== "string" || !value.trim()) throw new Error("configuration");
    return value.trim();
  }
  const value = Deno.env.get(legacyName)?.trim();
  if (!value) throw new Error("configuration");
  return value;
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !req.body) {
    throw new Error("body");
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) { await reader.cancel(); throw new Error("body"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("body");
  return body;
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function callJson(base: string, path: string, key: string, body: unknown, token?: string) {
  // Legacy JWT API keys also need their default Authorization header.
  const bearer = token ?? (key.startsWith("eyJ") ? key : undefined);
  const response = await fetch(`${base}${path}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(12000),
    headers: {
      "Content-Type": "application/json", apikey: key,
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { response, data: response.ok ? await response.json() : null };
}

function safeAccount(value: any, expectedId: string, expectedUsername: string) {
  const user = value?.user;
  if (user?.id !== expectedId || user?.username !== expectedUsername || user?.status !== "ACTIVE"
      || typeof user.must_change_password !== "boolean"
      || !Number.isSafeInteger(user.row_version) || user.row_version < 1
      || !Array.isArray(value.role_assignments) || value.role_assignments.length > 256) {
    throw new Error("account");
  }
  const assignments = value.role_assignments.map((assignment: any) => {
    if (!uuid.test(assignment?.assignment_id) || !uuid.test(assignment?.role_id)
        || typeof assignment.role !== "string" || !assignment.role.length || assignment.role.length > 64
        || !scopes.has(assignment.scope_kind) || !Array.isArray(assignment.permissions)
        || !assignment.permissions.every((code: unknown) => typeof code === "string"
          && /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(code))) {
      throw new Error("account");
    }
    return {
      assignment_id: assignment.assignment_id, role_id: assignment.role_id,
      role: assignment.role, scope_kind: assignment.scope_kind,
      permissions: [...new Set<string>(assignment.permissions)],
    };
  });
  return {
    user: { id: user.id, username: user.username, status: user.status,
      must_change_password: user.must_change_password, row_version: user.row_version },
    role_assignments: assignments,
  };
}

async function login(req: Request): Promise<Response> {
  if (req.method !== "POST") return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  let body;
  try { body = await readBody(req); }
  catch { return reply({ ok: false, error: "INVALID_REQUEST" }, 400); }
  const action = body.action ?? "probe";
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = body.password;
  const ip = body.client_ip ?? (action === "probe" ? "operator-probe" : "");
  if (!["probe", "login"].includes(action as string) || !username || username.length > 64
      || typeof password !== "string" || !password.length || password.length > 128
      || typeof ip !== "string" || !ip.trim() || ip.length > 64) {
    return reply({ ok: false, error: "INVALID_REQUEST" }, 400);
  }

  let base: string, adminKey: string, publicKey: string;
  try {
    const url = new URL(Deno.env.get("SUPABASE_URL")?.trim() ?? "");
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
        || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/") {
      throw new Error("configuration");
    }
    base = url.origin;
    adminKey = apiKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    publicKey = apiKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  } catch { return reply({ ok: false, error: "LOGIN_CONFIGURATION_UNAVAILABLE" }, 503); }

  let accessToken = "";
  let keepSession = false;
  let result: Record<string, unknown> = { ok: false, error: "LOGIN_UNAVAILABLE" };
  let status = 503;
  try {
    const rate = await callJson(base, "/rest/v1/rpc/portal_take_login_slot", adminKey, {
      p_username_hash: await digest(`username\0${username}`),
      p_ip_hash: await digest(`ip\0${ip.trim().toLowerCase()}`),
    });
    if (!rate.response.ok || typeof rate.data !== "boolean") throw new Error("rate");
    if (!rate.data) return reply({ ok: false, error: "LOGIN_LIMITED", message: "Terlalu banyak percobaan. Coba lagi nanti." }, 429);

    const resolved = await callJson(base, "/rest/v1/rpc/portal_resolve_login", adminKey, { p_username: username });
    if (!resolved.response.ok || !Array.isArray(resolved.data) || resolved.data.length > 1) throw new Error("resolve");
    const identity = resolved.data[0];
    if (identity && (!uuid.test(identity.auth_user_id) || typeof identity.login_email !== "string" || !identity.login_email.trim())) {
      throw new Error("resolve");
    }
    // Unknown usernames still take the password-auth path; no public resolver.
    const signedIn = await callJson(base, "/auth/v1/token?grant_type=password", publicKey, {
      email: identity?.login_email ?? "unavailable-account@portal.invalid", password,
    });
    if (!signedIn.response.ok) {
      if ([400, 401, 403].includes(signedIn.response.status)) { result = invalidCredentials; status = 401; }
      else if (signedIn.response.status === 429) { result = { ok: false, error: "LOGIN_LIMITED" }; status = 429; }
      else throw new Error("auth");
    } else {
      const session = signedIn.data;
      if (typeof session?.access_token === "string" && session.access_token.length <= 8192
          && /^[A-Za-z0-9._-]+$/.test(session.access_token)) accessToken = session.access_token;
      if (!accessToken || typeof session.refresh_token !== "string" || !session.refresh_token.length
          || session.refresh_token.length > 4096 || !Number.isInteger(session.expires_in)
          || session.expires_in < 1 || session.expires_in > 86400 || session.token_type !== "bearer") {
        throw new Error("session");
      }
      if (!identity || session.user?.id !== identity.auth_user_id) { result = invalidCredentials; status = 401; }
      else {
        const current = await callJson(base, "/rest/v1/rpc/portal_current_account", publicKey, {}, accessToken);
        if (!current.response.ok) throw new Error("profile");
        if (!current.data) { result = invalidCredentials; status = 401; }
        else {
          const account = safeAccount(current.data, identity.auth_user_id, username);
          if (action === "probe") {
            result = {
              ok: true,
              checks: { password_sign_in: true, account_context: true, temporary_session_signout: true },
              account: {
                username: account.user.username, must_change_password: account.user.must_change_password,
                role_count: account.role_assignments.length,
                permission_count: new Set(account.role_assignments.flatMap((assignment: any) => assignment.permissions)).size,
              },
            };
          } else {
            result = { ok: true, account, session: {
              access_token: accessToken, refresh_token: session.refresh_token,
              expires_in: session.expires_in, token_type: "bearer",
            } };
            keepSession = true;
          }
          status = 200;
        }
      }
    }
  } catch {
    // No credential, exception text, or upstream response is logged/returned.
    result = { ok: false, error: "LOGIN_UNAVAILABLE" }; status = 503;
  } finally {
    if (accessToken && !keepSession) {
      try {
        const signedOut = await fetch(`${base}/auth/v1/logout?scope=local`, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(12000),
          headers: { apikey: publicKey, Authorization: `Bearer ${accessToken}` },
        });
        if (!signedOut.ok) throw new Error("signout");
      } catch { result = { ok: false, error: "LOGIN_UNAVAILABLE" }; status = 503; }
    }
  }
  return reply(result, status);
}

export default {
  fetch: withSupabase({ auth: "secret" }, login),
};
