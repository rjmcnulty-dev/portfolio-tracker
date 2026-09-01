// Today's date ('YYYY-MM-DD') in US/Eastern, not this process's own (UTC on
// GitHub Actions runners) timezone. Anything tied to the US trading day — a
// price's as_of, "which scheduled deposits/trades are due today" — needs
// this instead of a raw `new Date()` read, or a job that runs late (past
// UTC midnight, still evening in Eastern) silently attributes to the wrong
// calendar day. DST-aware via Intl, no dependency.
export function todayInEastern() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
