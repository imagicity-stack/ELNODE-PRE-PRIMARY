import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Sorting helpers ──────────────────────────────────────────────────────────

// Pre-primary grades that should sort before numbered classes, in this order.
const GRADE_ORDER: Record<string, number> = {
  'pre-nursery': -5, 'prenursery': -5,
  'play': -4, 'playgroup': -4, 'pg': -4,
  'nursery': -3, 'nur': -3,
  'lkg': -2, 'pre-kg': -2, 'prekg': -2,
  'ukg': -1, 'kg': -1,
};

/**
 * Compare two class names in natural school order:
 * Pre-Nursery → Play → Nursery → LKG → UKG → 1 → 2 → … → 12,
 * then anything else alphabetically. Numeric classes sort numerically
 * ("2" before "10"), not lexically.
 */
export function compareClassName(a: string, b: string): number {
  const na = (a || '').trim().toLowerCase();
  const nb = (b || '').trim().toLowerCase();

  const ra = GRADE_ORDER[na];
  const rb = GRADE_ORDER[nb];
  if (ra !== undefined && rb !== undefined) return ra - rb;
  if (ra !== undefined) return -1; // named grades come first
  if (rb !== undefined) return 1;

  // Numeric class numbers — sort numerically
  const ia = parseInt(na, 10);
  const ib = parseInt(nb, 10);
  const aIsNum = !Number.isNaN(ia) && /^\d/.test(na);
  const bIsNum = !Number.isNaN(ib) && /^\d/.test(nb);
  if (aIsNum && bIsNum) return ia - ib;
  if (aIsNum) return -1;
  if (bIsNum) return 1;

  // Fallback: natural alphabetical with embedded-number awareness
  return na.localeCompare(nb, undefined, { numeric: true, sensitivity: 'base' });
}

/** Sort an array of objects with a `name` field by school class order. */
export function sortByClassName<T extends { name?: string }>(items: T[]): T[] {
  return [...items].sort((x, y) => compareClassName(x.name || '', y.name || ''));
}

/** Case-insensitive, number-aware A→Z sort by `name` (for students, teachers, etc.). */
export function sortByName<T extends { name?: string }>(items: T[]): T[] {
  return [...items].sort((x, y) =>
    (x.name || '').localeCompare(y.name || '', undefined, { numeric: true, sensitivity: 'base' })
  );
}

/**
 * Convert "YYYY-MM" (e.g. "2026-05") to "Month YYYY" (e.g. "May 2026").
 * Returns the input unchanged if format is not YYYY-MM.
 */
export function fmtMonthYear(m?: string): string {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return m || '';
  try {
    return new Date(m + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  } catch { return m; }
}

function toDateObj(date: string | Date | undefined | null): Date | null {
  if (!date) return null;
  if (date instanceof Date) return isNaN(date.getTime()) ? null : date;
  const d = new Date(date.length === 10 ? date + 'T00:00:00' : date);
  return isNaN(d.getTime()) ? null : d;
}

/** "DD/MM/YYYY" — e.g. 16/05/2026 */
export function fmtDate(date: string | Date | undefined | null): string {
  const d = toDateObj(date);
  if (!d) return '-';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** "DD MMM YYYY" — e.g. 16 May 2026 */
export function fmtDateLong(date: string | Date | undefined | null): string {
  const d = toDateObj(date);
  if (!d) return '-';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "DD MMM" (no year) — e.g. 16 May */
export function fmtDateShort(date: string | Date | undefined | null): string {
  const d = toDateObj(date);
  if (!d) return '-';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
