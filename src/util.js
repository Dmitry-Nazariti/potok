export function money(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

export function todayISO(d = new Date()) {
  return formatISO(d);
}

export function formatISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return formatISO(d);
}

export function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

export function daysInMonth(iso) {
  const d = parseISO(iso);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function monthKey(iso) {
  return String(iso).slice(0, 7);
}

export function monthStart(iso) {
  return `${monthKey(iso)}-01`;
}

export function monthEnd(iso) {
  const d = parseISO(iso);
  return formatISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function shiftMonth(iso, delta) {
  const d = parseISO(monthStart(iso));
  d.setMonth(d.getMonth() + delta);
  return formatISO(d);
}

export function clampDay(year, monthIndex, day) {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(Math.max(1, day), last);
}

export function advanceDate(cadence, occurrence, dayOfMonth) {
  if (cadence === "weekly") return addDays(occurrence, 7);
  if (cadence === "biweekly") return addDays(occurrence, 14);
  const current = parseISO(occurrence);
  const day = dayOfMonth || current.getDate();
  const nextMonth = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  nextMonth.setDate(clampDay(nextMonth.getFullYear(), nextMonth.getMonth(), day));
  return formatISO(nextMonth);
}

export function occurrencesFrom(rec, fromInclusive, toInclusive, limit = 400) {
  const out = [];
  if (!rec || rec.active === false) return out;
  let cursor = rec.nextDate;
  let guard = 0;
  while (cursor < fromInclusive && guard < limit) {
    cursor = advanceDate(rec.cadence, cursor, rec.dayOfMonth);
    guard++;
  }
  while (cursor <= toInclusive && guard < limit) {
    out.push(cursor);
    cursor = advanceDate(rec.cadence, cursor, rec.dayOfMonth);
    guard++;
  }
  return out;
}

export function walkForward(rec, fromDate) {
  let cursor = fromDate;
  let guard = 0;
  while (cursor <= fromDate && guard < 48) {
    const next = advanceDate(rec.cadence, cursor, rec.dayOfMonth);
    if (next === cursor) break;
    cursor = next;
    guard++;
    if (cursor > fromDate) return cursor;
  }
  return advanceDate(rec.cadence, fromDate, rec.dayOfMonth);
}

export function nextAfter(rec, date) {
  let cursor = rec.nextDate;
  let guard = 0;
  if (cursor > date) return cursor;
  while (cursor <= date && guard < 500) {
    cursor = advanceDate(rec.cadence, cursor, rec.dayOfMonth);
    guard++;
  }
  return cursor;
}

export function isValidDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return false;
  const d = parseISO(iso);
  return formatISO(d) === iso;
}

export function normalizePattern(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[«»"'`]/g, "")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function roundPct(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

export function sum(list, fn) {
  let total = 0;
  for (const item of list) total += fn(item);
  return money(total);
}

export function isoStamp() {
  return new Date().toISOString();
}

export function monthLabel(iso) {
  const d = parseISO(monthStart(iso));
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(d);
}

export function shortDate(iso) {
  const d = parseISO(iso);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(d);
}
