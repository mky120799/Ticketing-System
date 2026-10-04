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

export interface WorkingSchedule { timeZone: string; startMinute: number; endMinute: number; workingDays: readonly number[]; }

/** Wall-clock parts of an instant in a time zone. */
function localParts(instant: Date, timeZone: string): { date: string; minuteOfDay: number; weekday: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(instant).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute), weekday: new Date(`${date}T12:00:00Z`).getUTCDay() };
}

/** The instant at which the wall clock in `timeZone` reads `date` + `minuteOfDay` (handles daylight saving by iterating on the offset). */
function localToInstant(date: string, minuteOfDay: number, timeZone: string): Date {
  let guess = new Date(`${date}T00:00:00Z`).getTime() + minuteOfDay * 60_000;
  for (let i = 0; i < 3; i++) {
    const shown = localParts(new Date(guess), timeZone);
    const shownMs = new Date(`${shown.date}T00:00:00Z`).getTime() + shown.minuteOfDay * 60_000;
    const wantedMs = new Date(`${date}T00:00:00Z`).getTime() + minuteOfDay * 60_000;
    if (shownMs === wantedMs) break;
    guess += wantedMs - shownMs;
  }
  return new Date(guess);
}

/**
 * Adds working minutes to an instant: only time inside working hours on working days that are not holidays counts.
 * A start outside working hours begins counting at the next opening time.
 */
export function addBusinessMinutes(from: Date, minutes: number, schedule: WorkingSchedule, holidays: ReadonlySet<string>): Date {
  let remaining = Math.max(0, Math.round(minutes)); let cursor = from;
  for (let guard = 0; guard < 4000; guard++) {
    const { date, minuteOfDay, weekday } = localParts(cursor, schedule.timeZone);
    if (schedule.workingDays.includes(weekday) && !holidays.has(date) && minuteOfDay < schedule.endMinute) {
      const opening = Math.max(minuteOfDay, schedule.startMinute); const available = schedule.endMinute - opening;
      if (remaining <= available) return localToInstant(date, opening + remaining, schedule.timeZone);
      remaining -= available;
    }
    const next = new Date(new Date(`${date}T12:00:00Z`).getTime() + 24 * 3_600_000);
    cursor = localToInstant(next.toISOString().slice(0, 10), 0, schedule.timeZone);
  }
  throw new Error('Could not place the deadline within the working calendar');
}
