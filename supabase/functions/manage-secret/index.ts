// Lets the logged-in admin set/check the Twelve Data and Finnhub API keys
// from /admin's Secrets tab, encrypted at rest — see README's "Encrypted
// secrets" section for the full design. `verify_jwt = true` (see
// supabase/config.toml) rejects a request with no valid-for-this-project JWT
// at the platform gateway — but the anon key is ALSO a valid JWT for the
// project (same signing secret, role "anon"), so that alone doesn't require
// a real login. This function additionally calls auth.getUser() with the
// caller's token to confirm it belongs to an actual authenticated session,
// not just any project-signed token. Never returns a previously-saved
// value — "save" echoes back only what was just typed (a `preview`, not the
// full value), and "status" never decrypts at all. See reveal-secret/index.ts
// for the only path that does return a decrypted value, gated a different way.
import { createClient } from "@supabase/supabase-js";
import { encryptSecret } from "../_shared/secrets.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// The only secrets this app currently has a use for — not an open key/value
// store, so a typo in the client can't silently create a stray row.
const ALLOWED_KEYS = new Set(["twelve_data_api_key", "finnhub_api_key", "anthropic_api_key"]);

function previewOf(value: string): string {
  return value.length > 4 ? `••••${value.slice(-4)}` : "••••";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const masterKey = Deno.env.get("CONFIG_ENCRYPTION_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !masterKey) {
    return json({ error: "Supabase runtime env vars or CONFIG_ENCRYPTION_KEY are missing" }, 500);
  }

  // verify_jwt=true only proves the caller presented some project-signed
  // JWT — the anon key qualifies too. This is the check that actually
  // requires a real logged-in session: a client built with the anon key
  // (i.e. the caller's own Authorization header) can only resolve to a user
  // if that header carries a genuine user access token.
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { action?: string; key?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { action, key } = body;
  if (!key || !ALLOWED_KEYS.has(key)) {
    return json({ error: `Unknown secret key. Allowed: ${[...ALLOWED_KEYS].join(", ")}` }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (action === "status") {
    const { data, error } = await supabase.from("app_secrets").select("updated_at").eq("key", key).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    return json({ isSet: Boolean(data), updatedAt: data?.updated_at ?? null });
  }

  if (action === "save") {
    const value = typeof body.value === "string" ? body.value.trim() : "";
    if (!value) return json({ error: "value is required" }, 400);

    const ciphertext = await encryptSecret(value, masterKey);
    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from("app_secrets")
      .upsert({ key, ciphertext, updated_at: updatedAt }, { onConflict: "key" });
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, updatedAt, preview: previewOf(value) });
  }

  return json({ error: "action must be 'save' or 'status'" }, 400);
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request (requires a valid user JWT, unlike this app's other functions):

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/manage-secret' \
    --header 'Authorization: Bearer <user-access-token>' \
    --data '{"action":"status","key":"twelve_data_api_key"}'

*/
