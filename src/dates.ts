/**
 * Shared date helper: format a Date as YYYY-MM-DD in America/New_York.
 *
 * The Council operates on New York time. Using toISOString() (UTC) shifts the
 * calendar date after 8pm/7pm ET, which made "today"-anchored windows (upcoming
 * hearings, recent bills) off by one day in the evening. en-CA locale yields
 * ISO-style YYYY-MM-DD directly.
 */
const NY_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
});

export function nyDateString(d: Date = new Date()): string {
  return NY_DATE_FMT.format(d);
}
