import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export interface ReceiptTypeConfig {
  prefix: string;
  startFrom: number;
}

export interface SchoolSettings {
  academicYear: string;     // e.g. "2026-27"
  schoolName?: string;
  address?: string;
  phone?: string;
  website?: string;
  email?: string;
  /** @deprecated use receiptConfig.feeReceipt instead */
  receiptPrefix?: string;
  /** @deprecated use receiptConfig.feeReceipt instead */
  receiptStartNumber?: number;
  receiptConfig?: {
    feeReceipt: ReceiptTypeConfig;
    advanceReceipt: ReceiptTypeConfig;
    expenseReceipt: ReceiptTypeConfig;
    salarySlip: ReceiptTypeConfig;
  };
  // Day of the FOLLOWING month that fee requests default to. e.g. 10 → request
  // generated in May defaults to due date June 10. Range: 1-28. Default: 10.
  defaultFeeDueDay?: number;
  updatedAt?: string;
  updatedBy?: string;
}

/** Returns the receipt config for a given type, with safe defaults. */
export function getReceiptTypeConfig(
  settings: SchoolSettings,
  type: keyof NonNullable<SchoolSettings['receiptConfig']>,
): ReceiptTypeConfig {
  const defaults: Record<string, ReceiptTypeConfig> = {
    feeReceipt:     { prefix: settings.receiptPrefix || 'EHSREC', startFrom: settings.receiptStartNumber ?? 1 },
    advanceReceipt: { prefix: 'EHSADV', startFrom: 1 },
    expenseReceipt: { prefix: 'EXP', startFrom: 1 },
    salarySlip:     { prefix: 'SAL', startFrom: 1 },
  };
  return settings.receiptConfig?.[type] ?? defaults[type];
}

const REF = () => doc(db, 'settings', 'global');

export async function getSchoolSettings(): Promise<SchoolSettings> {
  const snap = await getDoc(REF());
  if (snap.exists()) return snap.data() as SchoolSettings;
  return { academicYear: '2026-27' };
}

export async function saveSchoolSettings(data: SchoolSettings): Promise<void> {
  await setDoc(REF(), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

/** Returns the default fee request due date as a YYYY-MM-DD string,
 *  computed from `defaultFeeDueDay` (day of the FOLLOWING month).
 *  Falls back to the 10th if no setting or invalid value. */
export function computeDefaultFeeDueDate(dueDay?: number, base: Date = new Date()): string {
  const day = Number.isFinite(dueDay) && dueDay! >= 1 && dueDay! <= 28 ? Math.floor(dueDay!) : 10;
  const d = new Date(base.getFullYear(), base.getMonth() + 1, day);
  // Format from local date parts — NOT toISOString(), which shifts to UTC and
  // can roll the date back a day in timezones ahead of UTC (e.g. IST = UTC+5:30,
  // where local midnight on the 10th becomes 18:30 UTC on the 9th).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
