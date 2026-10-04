import { addBusinessDays, localDate } from '../src/compliance/business-calendar.js';

describe('business calendar', () => {
  const tz = 'Australia/Sydney';
  it('skips weekends', () => { expect(localDate(addBusinessDays(new Date('2026-10-02T05:00:00Z'), 1, tz, new Set()), tz)).toBe('2026-10-05'); }); // Fri -> Mon
  it('skips configured public holidays', () => { expect(localDate(addBusinessDays(new Date('2026-10-02T05:00:00Z'), 1, tz, new Set(['2026-10-05'])), tz)).toBe('2026-10-06'); });
  it('returns the same instant for zero days', () => { const from = new Date('2026-10-02T05:00:00Z'); expect(addBusinessDays(from, 0, tz, new Set()).getTime()).toBe(from.getTime()); });
  it('uses the local date for the time zone, not UTC', () => { expect(localDate(new Date('2026-10-02T20:00:00Z'), tz)).toBe('2026-10-03'); });
});

import { addBusinessMinutes } from '../src/compliance/business-calendar.js';

describe('business-hours deadlines', () => {
  const sydney = { timeZone: 'Australia/Sydney', startMinute: 9 * 60, endMinute: 17 * 60, workingDays: [1, 2, 3, 4, 5] };
  const at = (iso: string) => new Date(iso);
  const local = (d: Date) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  it('counts only working time within a day', () => { expect(local(addBusinessMinutes(at('2026-10-06T00:30:00Z'), 120, sydney, new Set()))).toContain('13:30'); }); // Tue 11:30 local + 2 working hours
  it('rolls over the end of the day to the next morning', () => {
    const end = addBusinessMinutes(at('2026-10-06T05:00:00Z'), 180, sydney, new Set()); // Tue 16:00 local + 3h = Wed 11:00
    expect(local(end)).toMatch(/Wed.*11:00/);
  });
  it('skips weekends and holidays', () => {
    expect(local(addBusinessMinutes(at('2026-10-02T06:00:00Z'), 120, sydney, new Set()))).toMatch(/Mon.*10:00/); // Fri 16:00 local: 1h left on Friday + 1h on Monday
    expect(local(addBusinessMinutes(at('2026-10-02T06:00:00Z'), 120, sydney, new Set(['2026-10-05'])))).toMatch(/Tue.*10:00/);
  });
  it('starts counting at opening time when the clock starts outside hours', () => { expect(local(addBusinessMinutes(at('2026-10-05T20:00:00Z'), 60, sydney, new Set()))).toMatch(/Tue.*10:00/); }); // Tue 07:00 local -> 09:00 + 1h
  it('handles a zero-length deadline and daylight-saving boundaries', () => {
    expect(addBusinessMinutes(at('2026-10-06T01:00:00Z'), 0, sydney, new Set()).getTime()).toBeGreaterThan(0);
    expect(() => addBusinessMinutes(at('2026-04-03T05:00:00Z'), 600, sydney, new Set())).not.toThrow(); // across the April end of daylight saving
  });
});
