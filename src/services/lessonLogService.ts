import {
  collection, doc, runTransaction, deleteDoc, addDoc,
} from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase';
import { LessonLog, UserProfile } from '../types';

export class ConcurrentEditError extends Error {
  constructor() {
    super('This log was edited by someone else while you were editing. Please refresh and try again.');
    this.name = 'ConcurrentEditError';
  }
}

const MAX_TOPIC = 200;
const MAX_BODY = 5000;

export function validateLessonInput(input: { topic: string; classwork: string; homework: string }): string | null {
  if (!input.topic.trim()) return 'Topic is required.';
  if (input.topic.length > MAX_TOPIC) return `Topic must be ${MAX_TOPIC} characters or fewer.`;
  if (input.classwork.length > MAX_BODY) return `Classwork must be ${MAX_BODY} characters or fewer.`;
  if (input.homework.length > MAX_BODY) return `Homework must be ${MAX_BODY} characters or fewer.`;
  return null;
}

// Strips path separators and trims length so user-supplied filenames are safe in storage paths.
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\/\\]/g, '_')
    .replace(/[^a-zA-Z0-9._\- ]/g, '')
    .slice(0, 80) || `file_${Date.now()}`;
}

interface UpdatePayload {
  topic: string;
  classwork: string;
  homework: string;
  classworkFileUrl?: string;
  classworkFileName?: string;
  homeworkFileUrl?: string;
  homeworkFileName?: string;
}

/**
 * Atomically update a lesson log with optimistic concurrency control.
 * Throws ConcurrentEditError if the doc was modified since `expectedVersion`.
 */
export async function updateLessonLog(
  id: string,
  expectedVersion: number,
  patch: UpdatePayload,
  user: UserProfile,
): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'lessonLogs', id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Lesson log no longer exists.');
    const current = snap.data() as LessonLog;
    const currentVersion = current.version ?? 0;
    if (currentVersion !== expectedVersion) {
      throw new ConcurrentEditError();
    }

    const update: any = {
      topic: patch.topic.trim(),
      classwork: patch.classwork,
      homework: patch.homework,
      updatedAt: new Date().toISOString(),
      updatedBy: user.uid,
      updatedByName: user.name,
      version: currentVersion + 1,
    };
    if (patch.classworkFileUrl !== undefined) {
      update.classworkFileUrl = patch.classworkFileUrl;
      update.classworkFileName = patch.classworkFileName;
    }
    if (patch.homeworkFileUrl !== undefined) {
      update.homeworkFileUrl = patch.homeworkFileUrl;
      update.homeworkFileName = patch.homeworkFileName;
    }
    tx.update(ref, update);
  });
}

/**
 * Delete a lesson log and best-effort cleanup of attached storage files.
 */
export async function deleteLessonLog(log: LessonLog): Promise<void> {
  await deleteDoc(doc(db, 'lessonLogs', log.id));
  // Best-effort: remove attached files. Failures here don't roll back the delete.
  const cleanups: Promise<unknown>[] = [];
  if (log.classworkFileUrl) {
    try { cleanups.push(deleteObject(ref(storage, log.classworkFileUrl)).catch(() => {})); } catch {}
  }
  if (log.homeworkFileUrl) {
    try { cleanups.push(deleteObject(ref(storage, log.homeworkFileUrl)).catch(() => {})); } catch {}
  }
  await Promise.all(cleanups);
}
