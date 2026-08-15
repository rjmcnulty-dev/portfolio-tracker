// Reads one app_config row (public read, plain values) with a fallback if
// the row is missing or the query fails — same pattern as
// supabase/functions/_shared/config.ts on the Edge Function side and
// src/hooks/useAppConfig.js's useConfigValue on the client side.
export async function getConfig(supabase, key, fallback) {
  const { data, error } = await supabase.from('app_config').select('value').eq('key', key).maybeSingle()
  if (error || !data) return fallback
  return data.value
}
