// Reads one app_config row (public read, plain values — nothing here is
// secret, see _shared/secrets.ts for that) with a fallback if the row is
// missing or the query fails, mirroring src/hooks/useAppConfig.js's
// useConfigValue on the client side. Shared across Edge Functions in this
// project via a relative import — the first use of this project's
// supabase/functions/_shared/ folder.
// deno-lint-ignore no-explicit-any
export async function getConfig<T>(supabase: any, key: string, fallback: T): Promise<T> {
  const { data, error } = await supabase.from("app_config").select("value").eq("key", key).maybeSingle();
  if (error || !data) return fallback;
  return data.value as T;
}
