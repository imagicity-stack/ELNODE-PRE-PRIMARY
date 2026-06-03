import {
  collection,
  doc,
  addDoc,
  updateDoc,
  query,
  where,
  getDocs,
  getDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  AdvancePayment,
  AdvanceMonthlyEntry,
  FeePayment,
  FeeRequest,
} from '../types';

/** All advance payments recorded for a single student (any status). */
export async function getAdvancePaymentsForStudent(
  studentId: string,
): Promise<AdvancePayment[]> {
  const snap = await getDocs(
    query(collection(db, 'advancePayments'), where('studentId', '==', studentId)),
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as AdvancePayment));
}

/**
 * Unconsumed advance entries for a given (studentId, month) tuple, sorted
 * oldest first (FIFO) so the earliest advance is applied first.
 */
export async function getUnconsumedForMonth(
  studentId: string,
  month: string,
): Promise<{ advance: AdvancePayment; entry: AdvanceMonthlyEntry; entryIndex: number }[]> {
  const all = await getAdvancePaymentsForStudent(studentId);
  const matches: {
    advance: AdvancePayment;
    entry: AdvanceMonthlyEntry;
    entryIndex: number;
  }[] = [];
  for (const adv of all) {
    (adv.monthlyBreakdown || []).forEach((e, i) => {
      if (e.month === month && !e.consumed) {
        matches.push({ advance: adv, entry: e, entryIndex: i });
      }
    });
  }
  return matches.sort((a, b) =>
    (a.advance.createdAt || '').localeCompare(b.advance.createdAt || ''),
  );
}

/**
 * Atomically mark one entry of an advance payment as consumed and link it to
 * the feeRequest + synthetic feePayment that applied it. If every entry on the
 * doc is now consumed, also flips the top-level status to 'fully_consumed'.
 */
export async function consumeAdvanceEntry(
  advanceId: string,
  entryIndex: number,
  requestId: string,
  paymentId: string,
): Promise<void> {
  const ref = doc(db, 'advancePayments', advanceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() as Omit<AdvancePayment, 'id'>;
  const updated = [...(data.monthlyBreakdown || [])];
  if (!updated[entryIndex] || updated[entryIndex].consumed) return;
  updated[entryIndex] = {
    ...updated[entryIndex],
    consumed: true,
    consumedAt: new Date().toISOString(),
    consumedRequestId: requestId,
    consumedPaymentId: paymentId,
  };
  const fullyConsumed = updated.every(e => e.consumed);
  await updateDoc(ref, {
    monthlyBreakdown: updated,
    ...(fullyConsumed ? { status: 'fully_consumed' as const } : {}),
  });
}

/**
 * Create an advance payment record. Caller is responsible for getting a
 * receipt number (via receiptCounterService) and uploading any voucher photo.
 */
export async function createAdvancePayment(
  data: Omit<AdvancePayment, 'id' | 'status'>,
): Promise<string> {
  const ref = await addDoc(collection(db, 'advancePayments'), {
    ...data,
    status: 'active' as const,
  });
  return ref.id;
}

/**
 * Returns true if the student already has an UNCONSUMED advance entry that
 * covers the given month — useful for the "Pay in Advance" UI to prevent
 * double-paying the same month.
 */
export async function hasUnconsumedAdvanceForMonth(
  studentId: string,
  month: string,
): Promise<boolean> {
  const matches = await getUnconsumedForMonth(studentId, month);
  return matches.length > 0;
}

/**
 * Build the synthetic FeePayment doc that represents "advance applied to
 * a freshly generated fee request". Centralised here so the shape is
 * consistent everywhere advance is consumed.
 */
export function buildAdvanceApplicationPayment(args: {
  request: { id: string; studentId: string; classId: string };
  advance: AdvancePayment;
  entry: AdvanceMonthlyEntry;
  totalApplied: number;
  receiptNumber: string;
}): Omit<FeePayment, 'id'> {
  const { request, advance, entry, totalApplied, receiptNumber } = args;
  return {
    studentId: request.studentId,
    classId: request.classId,
    feeRequestId: request.id,
    feeHead: entry.heads[0]?.name || 'Advance',
    amount: totalApplied,
    allocations: entry.heads.map(h => ({ headName: h.name, amount: h.amount })),
    date: new Date().toISOString().split('T')[0],
    method: advance.paymentMethod,
    referenceNumber: `Advance ${advance.receiptNumber}`,
    receiptNumber,
    remarks: `Auto-applied from advance payment receipt ${advance.receiptNumber}`,
    advancePaymentId: advance.id,
  };
}
