// Today's date ('YYYY-MM-DD') in US/Eastern, not the Edge Function
// runtime's own (UTC) timezone — see scripts/lib/dates.mjs (the Node
// counterpart) for why this matters.
export function todayInEastern(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
