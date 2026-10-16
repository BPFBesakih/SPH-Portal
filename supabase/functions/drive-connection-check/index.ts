import { withSupabase } from "npm:@supabase/server@1";

// Diagnostic only: reads the configured folder; never creates or changes files.
const secretNames = [
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_REFRESH_TOKEN",
  "GOOGLE_DRIVE_FOLDER_ID",
];

function reply(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Allow": "POST" },
  });
}

async function checkConnection(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return reply({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const values = secretNames.map((name) => Deno.env.get(name)?.trim() ?? "");
  const missing = secretNames.filter((_, index) => !values[index]);
  if (missing.length) {
    return reply({ ok: false, error: "MISSING_SECRETS", missing }, 500);
  }
  const [clientId, clientSecret, refreshToken, folderId] = values;
  let stage = "token";

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(12000),
      redirect: "error",
    });
    if (!tokenResponse.ok) {
      return reply({
        ok: false, stage, error: "GOOGLE_TOKEN_REFRESH_FAILED",
        upstream_status: tokenResponse.status,
      }, 502);
    }
    const token = await tokenResponse.json();
    if (typeof token?.access_token !== "string" || !token.access_token.trim()) {
      return reply({ ok: false, stage, error: "INVALID_TOKEN_RESPONSE" }, 502);
    }

    stage = "folder";
    const folderUrl = new URL(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`,
    );
    folderUrl.searchParams.set("fields", "mimeType,trashed,capabilities(canAddChildren)");
    const folderResponse = await fetch(folderUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(12000),
      redirect: "error",
    });
    if (!folderResponse.ok) {
      return reply({
        ok: false, stage, error: "FOLDER_ACCESS_FAILED",
        upstream_status: folderResponse.status,
      }, 502);
    }
    const folder = await folderResponse.json();
    if (folder?.mimeType !== "application/vnd.google-apps.folder") {
      return reply({ ok: false, stage, error: "NOT_A_FOLDER" }, 409);
    }
    if (folder.trashed !== false) {
      return reply({ ok: false, stage, error: "FOLDER_NOT_ACTIVE" }, 409);
    }
    if (folder.capabilities?.canAddChildren !== true) {
      return reply({ ok: false, stage, error: "CANNOT_ADD_FILES" }, 409);
    }

    return reply({
      ok: true,
      checks: { token_refresh: true, folder_access: true, can_add_files: true },
    });
  } catch (error) {
    const timedOut = error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    // Never return/log the exception, Google response body, or credentials.
    return reply({
      ok: false, stage,
      error: timedOut ? "GOOGLE_REQUEST_TIMEOUT" : "GOOGLE_REQUEST_FAILED",
    }, timedOut ? 504 : 502);
  }
}

export default {
  fetch: withSupabase({ auth: "secret" }, checkConnection),
};
