// The only path anywhere in this app that returns a decrypted secret over
// HTTP — exists purely so the GitHub Actions scripts (fetch-prices.mjs,
// backfill-portfolio-history.mjs) can get the Twelve Data key without a
// second AES-GCM implementation in Node (see scripts/lib/secrets.mjs). It is
// NOT gated by `verify_jwt` (see supabase/config.toml — this caller isn't a
// logged-in user, it's a trusted server-to-server script) but by manually
// checking the Authorization header equals the project's own service-role
// key. The browser never holds that key, so the browser can never reach
// this endpoint — see README's "Encrypted secrets" section for the full
// reasoning, including what this does and doesn't protect against.
import { createClient } from "@supabase/supabase-js";
import { decryptSecret } from "../_shared/secrets.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const masterKey = Deno.env.get("CONFIG_ENCRYPTION_KEY");
  if (!supabaseUrl || !serviceRoleKey || !masterKey) {
    return json({ error: "Supabase runtime env vars or CONFIG_ENCRYPTION_KEY are missing" }, 500);
  }

  if (req.headers.get("Authorization") !== `Bearer ${serviceRoleKey}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { key?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const key = body.key;
  if (!key) return json({ error: "key is required" }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase.from("app_secrets").select("ciphertext").eq("key", key).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: `Secret '${key}' is not set` }, 404);

  const value = await decryptSecret(data.ciphertext, masterKey);
  return json({ value });
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request, authenticated with the service-role key itself:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/reveal-secret' \
    --header 'Authorization: Bearer <service-role-key>' \
    --data '{"key":"twelve_data_api_key"}'

*/
