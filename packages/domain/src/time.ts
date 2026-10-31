import type { Schedule } from "@selio/contracts";

/** Heure (0–23) et jour (0–6) locaux d'un instant dans un fuseau IANA. */
export function localParts(date: Date, timezone: string): { hour: number; day: number; minute: number } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = Number.parseInt(get("hour"), 10) % 24;
    const minute = Number.parseInt(get("minute"), 10);
    const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { hour, minute, day: days[get("weekday")] ?? date.getUTCDay() };
  } catch {
    return { hour: date.getUTCHours(), minute: date.getUTCMinutes(), day: date.getUTCDay() };
  }
}

export function isWithinSchedule(schedule: Schedule, now: Date): boolean {
  const { hour, day } = localParts(now, schedule.timezone);
  if (!schedule.days.includes(day)) return false;
  return hour >= schedule.startHour && hour < schedule.endHour;
}

/** Jour local (AAAA-MM-JJ) pour les compteurs journaliers. */
export function localDayKey(date: Date, timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    return fmt.format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function daysBetween(a: Date | string, b: Date | string): number {
  const da = typeof a === "string" ? new Date(a) : a;
  const db = typeof b === "string" ? new Date(b) : b;
  return Math.floor((db.getTime() - da.getTime()) / 86_400_000);
}
