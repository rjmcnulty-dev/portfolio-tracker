// Fetches a decrypted secret from the reveal-secret Edge Function, which
// only responds to a caller holding the project's service-role key (see
// supabase/functions/reveal-secret) — this script gets a plaintext value
// without ever implementing AES-GCM decryption itself; only
// supabase/functions/_shared/secrets.ts does that. Returns null (never
// throws) if SUPABASE_SERVICE_ROLE_KEY isn't set or the secret isn't
// configured yet, so callers fall back to their pre-encryption env var
// during the transition — see fetch-prices.mjs / backfill-portfolio-history.mjs.
export async function getSecret(key) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/reveal-secret`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ key }),
    })
    if (!res.ok) return null
    const body = await res.json()
    return body.value ?? null
  } catch {
    return null
  }
}
