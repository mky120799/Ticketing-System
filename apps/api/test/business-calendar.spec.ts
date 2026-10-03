import { addBusinessDays, localDate } from '../src/compliance/business-calendar';

describe('business calendar', () => {
  const tz = 'Australia/Sydney';
  it('skips weekends', () => { expect(localDate(addBusinessDays(new Date('2026-10-02T05:00:00Z'), 1, tz, new Set()), tz)).toBe('2026-10-05'); }); // Fri -> Mon
  it('skips configured public holidays', () => { expect(localDate(addBusinessDays(new Date('2026-10-02T05:00:00Z'), 1, tz, new Set(['2026-10-05'])), tz)).toBe('2026-10-06'); });
  it('returns the same instant for zero days', () => { const from = new Date('2026-10-02T05:00:00Z'); expect(addBusinessDays(from, 0, tz, new Set()).getTime()).toBe(from.getTime()); });
  it('uses the local date for the time zone, not UTC', () => { expect(localDate(new Date('2026-10-02T20:00:00Z'), tz)).toBe('2026-10-03'); });
});
