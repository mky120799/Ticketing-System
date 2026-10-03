/** Local calendar date (YYYY-MM-DD) of an instant in an IANA time zone. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

function isBusinessDay(instant: Date, timeZone: string, holidays: ReadonlySet<string>): boolean {
  const date = localDate(instant, timeZone);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // calendar date only, so noon UTC avoids any DST edge
  return weekday !== 0 && weekday !== 6 && !holidays.has(date);
}

/**
 * Adds business days (Mon-Fri excluding the supplied holiday dates) to an instant, keeping the time of day.
 * Zero days returns the same instant. Used for "acknowledge within N business days" regulatory clocks.
 */
export function addBusinessDays(from: Date, days: number, timeZone: string, holidays: ReadonlySet<string>): Date {
  let cursor = new Date(from.getTime()); let remaining = days;
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + 24 * 3_600_000);
    if (isBusinessDay(cursor, timeZone, holidays)) remaining--;
  }
  return cursor;
}
