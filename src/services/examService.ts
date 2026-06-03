import {
  collection, doc, runTransaction, query, where, getDocs,
  writeBatch, serverTimestamp, getDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Exam, ExamResult, UserProfile, Student } from '../types';

export class ConcurrentEditError extends Error {
  constructor() {
    super('This result was edited by someone else. Refresh and try again to avoid overwriting their work.');
    this.name = 'ConcurrentEditError';
  }
}

// ─── Date / schedule validation ────────────────────────────────────────────

export interface ExamScheduleInput {
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  startTime?: string; // HH:MM
  endTime?: string;
  durationMinutes?: number;
  room?: string;
  classIds: string[];
  invigilatorId?: string;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

export function validateExamSchedule(input: ExamScheduleInput, opts?: { allowPast?: boolean }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!input.startDate) issues.push({ level: 'error', message: 'Start date is required.' });
  if (!input.endDate) issues.push({ level: 'error', message: 'End date is required.' });
  if (input.startDate && input.endDate && input.startDate > input.endDate) {
    issues.push({ level: 'error', message: 'Start date cannot be after end date.' });
  }
  if (!opts?.allowPast && input.startDate) {
    const today = new Date().toISOString().split('T')[0];
    if (input.startDate < today) {
      issues.push({ level: 'warning', message: 'Start date is in the past.' });
    }
  }
  if (input.startDate) {
    const day = new Date(input.startDate + 'T00:00:00').getDay();
    if (day === 0) issues.push({ level: 'warning', message: 'Start date falls on a Sunday.' });
  }
  if (input.startTime && input.endTime && input.startTime >= input.endTime) {
    issues.push({ level: 'error', message: 'End time must be after start time.' });
  }
  if (input.durationMinutes !== undefined && input.durationMinutes <= 0) {
    issues.push({ level: 'error', message: 'Duration must be positive.' });
  }
  if (!input.classIds || input.classIds.length === 0) {
    issues.push({ level: 'error', message: 'At least one class must be selected.' });
  }
  return issues;
}

// ─── Conflict detection ────────────────────────────────────────────────────

export interface ExamConflict {
  type: 'room' | 'invigilator' | 'class';
  exam: Exam;
  detail: string;
}

/**
 * Find scheduling conflicts: same room booked, same invigilator booked, or any of the
 * selected classes already has an exam on the same date with overlapping time window.
 * Skips comparison against `excludeExamId` (useful when editing an existing exam).
 */
export async function findExamConflicts(
  input: ExamScheduleInput,
  excludeExamId?: string,
): Promise<ExamConflict[]> {
  if (!input.startDate || !input.endDate) return [];

  // Fetch exams that could overlap by date range. We pull anything whose endDate >= startDate
  // and filter by class/room/invigilator client-side.
  const q = query(
    collection(db, 'exams'),
    where('endDate', '>=', input.startDate),
  );
  const snap = await getDocs(q);
  const candidates: Exam[] = snap.docs
    .map(d => ({ id: d.id, ...(d.data() as object) } as Exam))
    .filter(e => e.id !== excludeExamId && e.startDate <= input.endDate);

  const conflicts: ExamConflict[] = [];
  const newStart = input.startTime || '00:00';
  const newEnd = input.endTime || '23:59';

  for (const c of candidates) {
    const cStart = c.startTime || '00:00';
    const cEnd = c.endTime || '23:59';
    const timeOverlap = newStart < cEnd && cStart < newEnd;
    if (!timeOverlap) continue;

    if (input.room && c.room && input.room.trim().toLowerCase() === c.room.trim().toLowerCase()) {
      conflicts.push({
        type: 'room',
        exam: c,
        detail: `Room "${input.room}" already booked for "${c.name}" on ${c.startDate}`,
      });
    }
    if (input.invigilatorId && c.invigilatorId === input.invigilatorId) {
      conflicts.push({
        type: 'invigilator',
        exam: c,
        detail: `Invigilator already assigned to "${c.name}" on ${c.startDate}`,
      });
    }
    const sharedClasses = input.classIds.filter(cid => c.classIds?.includes(cid));
    if (sharedClasses.length > 0) {
      conflicts.push({
        type: 'class',
        exam: c,
        detail: `Class(es) ${sharedClasses.join(', ')} already have "${c.name}" on ${c.startDate}`,
      });
    }
  }
  return conflicts;
}

// ─── Result CRUD with optimistic concurrency ───────────────────────────────

const RESULT_DOC_ID = (examId: string, studentId: string) => `${examId}_${studentId}`;

/**
 * Save / upsert an exam result with optimistic concurrency. If the existing doc's `version`
 * doesn't match `expectedVersion`, throws ConcurrentEditError.
 *
 * Pass expectedVersion=0 for new docs (the transaction will create with version=1).
 */
export async function saveExamResult(
  result: Partial<ExamResult> & { examId: string; studentId: string },
  expectedVersion: number,
  user: UserProfile,
): Promise<void> {
  const ref = doc(db, 'examResults', RESULT_DOC_ID(result.examId, result.studentId));
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const exists = snap.exists();
    const current = exists ? (snap.data() as ExamResult) : null;
    const currentVersion = current?.version ?? 0;
    if (exists && currentVersion !== expectedVersion) {
      throw new ConcurrentEditError();
    }
    const nowIso = new Date().toISOString();
    const merged: any = {
      ...current,
      ...result,
      updatedAt: nowIso,
      updatedBy: user.uid,
      updatedByName: user.name,
      version: currentVersion + 1,
    };
    if (!exists) {
      merged.createdBy = user.uid;
      merged.createdByName = user.name;
      merged.published = current?.published ?? false;
    }
    tx.set(ref, merged, { merge: true });
  });
}

/**
 * Bulk-save many results for one exam. Each result is saved transactionally with its own
 * version check. Returns counts of saved vs conflicts.
 */
export async function bulkSaveExamResults(
  results: Array<{ result: Partial<ExamResult> & { examId: string; studentId: string }; expectedVersion: number }>,
  user: UserProfile,
): Promise<{ saved: number; conflicts: number; errors: string[] }> {
  let saved = 0;
  let conflicts = 0;
  const errors: string[] = [];
  for (const { result, expectedVersion } of results) {
    try {
      await saveExamResult(result, expectedVersion, user);
      saved++;
    } catch (e: any) {
      if (e instanceof ConcurrentEditError) conflicts++;
      else errors.push(e?.message || 'Unknown error');
    }
  }
  return { saved, conflicts, errors };
}

// ─── Publication workflow ──────────────────────────────────────────────────

/**
 * Publish all results for an exam. Sets `published: true` on every examResult doc
 * for this exam and updates the exam's `status` to 'published'.
 */
export async function publishExamResults(examId: string, user: UserProfile): Promise<number> {
  const resultsSnap = await getDocs(query(collection(db, 'examResults'), where('examId', '==', examId)));
  const batch = writeBatch(db);
  const nowIso = new Date().toISOString();
  resultsSnap.docs.forEach(d => {
    batch.update(d.ref, { published: true, updatedAt: nowIso });
  });
  batch.update(doc(db, 'exams', examId), {
    status: 'published',
    publishedAt: nowIso,
    publishedBy: user.uid,
  });
  await batch.commit();
  return resultsSnap.size;
}

const RESULTS_LINK = 'https://ehs.elnode.in/parent/exams';

/**
 * Send a WhatsApp notification (via WATI) to each parent whose child has a published
 * result for this exam. Best-effort — individual failures don't abort the rest.
 *
 * Returns counts of attempted/succeeded/failed.
 */
export async function notifyParentsOfPublishedResults(
  examId: string,
): Promise<{ attempted: number; sent: number; failed: number }> {
  const examSnap = await getDoc(doc(db, 'exams', examId));
  if (!examSnap.exists()) return { attempted: 0, sent: 0, failed: 0 };
  const exam = examSnap.data() as Exam;

  // Fetch all published results for this exam (server-side enforced visibility for parents
  // depends on this flag too, so we mirror the same condition here).
  const resultsSnap = await getDocs(query(
    collection(db, 'examResults'),
    where('examId', '==', examId),
    where('published', '==', true),
  ));
  if (resultsSnap.empty) return { attempted: 0, sent: 0, failed: 0 };

  // Bulk-fetch the student docs (for parent phone) — chunked by 10 (Firestore `in` limit).
  const studentIds = resultsSnap.docs.map(d => (d.data() as any).studentId).filter(Boolean);
  const studentMap: Record<string, Student> = {};
  for (let i = 0; i < studentIds.length; i += 10) {
    const chunk = studentIds.slice(i, i + 10);
    const sSnap = await getDocs(query(collection(db, 'students'), where('__name__', 'in', chunk)));
    sSnap.forEach(d => { studentMap[d.id] = { id: d.id, ...(d.data() as object) } as Student; });
  }

  // Collect unique classIds and houseIds to bulk-fetch display names.
  const classIdSet = new Set<string>();
  const houseIdSet = new Set<string>();
  Object.values(studentMap).forEach(s => {
    if ((s as any).classId) classIdSet.add((s as any).classId);
    if ((s as any).houseId) houseIdSet.add((s as any).houseId);
  });

  const classNameMap: Record<string, string> = {};
  const houseNameMap: Record<string, string> = {};

  const classIds = [...classIdSet];
  for (let i = 0; i < classIds.length; i += 10) {
    const chunk = classIds.slice(i, i + 10);
    const snap = await getDocs(query(collection(db, 'classes'), where('__name__', 'in', chunk)));
    snap.forEach(d => { classNameMap[d.id] = (d.data() as any).name || d.id; });
  }

  const houseIds = [...houseIdSet];
  for (let i = 0; i < houseIds.length; i += 10) {
    const chunk = houseIds.slice(i, i + 10);
    const snap = await getDocs(query(collection(db, 'houses'), where('__name__', 'in', chunk)));
    snap.forEach(d => { houseNameMap[d.id] = (d.data() as any).name || d.id; });
  }

  let attempted = 0, sent = 0, failed = 0;
  for (const d of resultsSnap.docs) {
    const result = d.data() as ExamResult;
    const student = studentMap[result.studentId];
    const phone = student?.parentDetails?.phone;
    if (!phone) continue;
    attempted++;

    const parentName = (student as any)?.parentDetails?.fatherName || 'Parent';
    const studentName = (student as any)?.name || '';
    const className = classNameMap[(student as any)?.classId] || (student as any)?.classId || '';
    const houseName = houseNameMap[(student as any)?.houseId] || (student as any)?.houseId || '';

    try {
      const res = await fetch('/api/whatsapp/send-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          templateName: 'exam_results_published',
          // {{1}} parent name  {{2}} student name  {{3}} class  {{4}} house
          // {{5}} exam name    {{6}} portal link
          parameters: [parentName, studentName, className, houseName, exam.name, RESULTS_LINK],
        }),
      });
      if (res.ok) sent++; else failed++;
    } catch {
      failed++;
    }
  }
  return { attempted, sent, failed };
}

export async function unpublishExamResults(examId: string, user: UserProfile): Promise<number> {
  const resultsSnap = await getDocs(query(collection(db, 'examResults'), where('examId', '==', examId)));
  const batch = writeBatch(db);
  const nowIso = new Date().toISOString();
  resultsSnap.docs.forEach(d => {
    batch.update(d.ref, { published: false, updatedAt: nowIso });
  });
  batch.update(doc(db, 'exams', examId), {
    status: 'completed',
    publishedAt: null as any,
    publishedBy: null as any,
  });
  await batch.commit();
  return resultsSnap.size;
}

// ─── Legacy data migration (one-shot) ──────────────────────────────────────

/**
 * Copy any docs from the (incorrectly named) `results` collection over to `examResults`,
 * preserving deterministic doc IDs and skipping any already-present targets. Safe to run
 * multiple times — idempotent.
 */
export async function migrateLegacyResults(): Promise<{ copied: number; skipped: number }> {
  const legacySnap = await getDocs(collection(db, 'results'));
  let copied = 0, skipped = 0;
  const batch = writeBatch(db);
  let opCount = 0;
  for (const d of legacySnap.docs) {
    const data = d.data() as any;
    if (!data.examId || !data.studentId) { skipped++; continue; }
    const targetId = RESULT_DOC_ID(data.examId, data.studentId);
    const targetRef = doc(db, 'examResults', targetId);
    const existing = await getDoc(targetRef);
    if (existing.exists()) { skipped++; continue; }
    batch.set(targetRef, { ...data, version: data.version ?? 1, published: data.published ?? false });
    copied++; opCount++;
    if (opCount >= 400) {
      await batch.commit();
      opCount = 0;
    }
  }
  if (opCount > 0) await batch.commit();
  return { copied, skipped };
}

// ─── Grade calculation helpers ─────────────────────────────────────────────

export function calculateGradeFromScale(
  marks: number, maxMarks: number,
  ranges: Array<{ min: number; max: number; grade: string }>,
): string {
  if (maxMarks <= 0) return 'N/A';
  const percentage = (marks / maxMarks) * 100;
  const range = ranges.find(r => percentage >= r.min && percentage <= r.max);
  return range ? range.grade : 'F';
}

// ─── Grading scale validation ──────────────────────────────────────────────

export function validateGradingScale(ranges: Array<{ min: number; max: number; grade: string }>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!ranges || ranges.length === 0) {
    issues.push({ level: 'error', message: 'Grading scale must have at least one range.' });
    return issues;
  }
  // Check each range internally valid
  for (const r of ranges) {
    if (r.min < 0 || r.max > 100) {
      issues.push({ level: 'error', message: `Range "${r.grade}" must be within 0–100.` });
    }
    if (r.min > r.max) {
      issues.push({ level: 'error', message: `Range "${r.grade}" has min greater than max.` });
    }
  }
  // Sort and check coverage + overlap
  const sorted = [...ranges].sort((a, b) => a.min - b.min);
  let prevMax = -1;
  for (const r of sorted) {
    if (r.min <= prevMax) {
      issues.push({ level: 'error', message: `Ranges overlap around ${r.min}.` });
    } else if (prevMax >= 0 && r.min > prevMax + 1) {
      issues.push({ level: 'warning', message: `Gap in scale between ${prevMax} and ${r.min}.` });
    }
    prevMax = r.max;
  }
  if (sorted[0].min > 0) issues.push({ level: 'warning', message: `Scale doesn't cover below ${sorted[0].min}%.` });
  if (sorted[sorted.length - 1].max < 100) issues.push({ level: 'warning', message: `Scale doesn't cover above ${sorted[sorted.length - 1].max}%.` });
  // Duplicate grade labels
  const labels = ranges.map(r => r.grade);
  const dups = labels.filter((l, i) => labels.indexOf(l) !== i);
  if (dups.length > 0) issues.push({ level: 'warning', message: `Duplicate grade label: ${[...new Set(dups)].join(', ')}` });
  return issues;
}
