import { doc, runTransaction } from 'firebase/firestore';
import type { DocumentSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

export type ReceiptCounterId = 'fee' | 'advance' | 'expense' | 'salary';

/** Reference to the counter document for a given receipt type. */
export const receiptCounterRef = (id: ReceiptCounterId = 'fee') => doc(db, 'counters', id);

/** Format a raw counter number into a padded receipt string (e.g. "EHSREC0042"). */
export function formatReceiptNumber(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(4, '0')}`;
}

/**
 * Compute the next counter value from a snapshot of the counter doc.
 * The counter stores `lastNumber`, initialised to `startFrom - 1` on first use
 * so the very first receipt gets number `startFrom`.
 */
export function nextReceiptNumberFromSnap(
  snap: DocumentSnapshot,
  startFrom: number,
): number {
  const current: number = snap.exists()
    ? ((snap.data() as any)?.lastNumber ?? startFrom - 1)
    : startFrom - 1;
  return current + 1;
}

/**
 * Atomically increments the counter for `id` and returns the formatted receipt number.
 * Use this for standalone reservations (advance payments, expense receipts, salary slips).
 * For fee payments recorded inside a larger Firestore transaction, use
 * `receiptCounterRef` + `nextReceiptNumberFromSnap` + `formatReceiptNumber` directly.
 */
export async function getNextReceiptNumber(
  id: ReceiptCounterId,
  prefix: string,
  startFrom: number,
): Promise<string> {
  const ref = receiptCounterRef(id);
  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const nextNum = nextReceiptNumberFromSnap(snap, startFrom);
    tx.set(ref, { lastNumber: nextNum }, { merge: true });
    return nextNum;
  });
  return formatReceiptNumber(prefix, next);
}
