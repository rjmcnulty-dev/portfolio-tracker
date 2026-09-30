// supabase-js's functions.invoke() throws a FunctionsHttpError whose message
// is just the generic "Edge Function returned a non-2xx status code" — the
// actual reason (a validation error, a rate limit, an upstream API error,
// etc.) is only in the response body, attached as `error.context` (the raw
// Response). This digs that out so the UI can show the real reason instead
// of the wrapper text. Non-invoke errors (e.g. a Postgrest error) have no
// `.context` and fall through to their own message as-is.
export async function describeEdgeFunctionError(err) {
  const context = err?.context
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.clone().json()
      if (body?.error) return body.error
    } catch {
      // Response wasn't JSON, or already consumed — fall through below.
    }
  }
  return err?.message ?? 'Something went wrong'
}
