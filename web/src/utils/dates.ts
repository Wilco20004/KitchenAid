// Dates in the meal plan are plain local calendar days ("2026-09-25"), never
// UTC timestamps — otherwise evening entries slip to the next day.

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, days: number): string {
  const d = parseIsoDate(s);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/** Monday of the week containing s. */
export function weekStart(s: string): string {
  const d = parseIsoDate(s);
  const offset = (d.getDay() + 6) % 7;
  return addDays(s, -offset);
}

export const today = () => isoDate(new Date());

export function dayLabel(s: string): { weekday: string; day: string; month: string } {
  const d = parseIsoDate(s);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
    day: String(d.getDate()),
    month: d.toLocaleDateString(undefined, { month: 'short' }),
  };
}

export function rangeLabel(start: string, end: string): string {
  const a = parseIsoDate(start);
  const b = parseIsoDate(end);
  const left = a.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const right = b.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${left} – ${right}`;
}
