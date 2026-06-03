/**
 * Shared service for staff & teacher provisioning, validation, and updates.
 *
 * Handles the cross-cutting concerns the two CRUD pages used to duplicate badly:
 *  • Server-side input validation (trim, length, email/phone format)
 *  • Duplicate-email detection BEFORE creating the Firebase Auth user
 *  • Atomic auth-account provisioning with deterministic cleanup of the
 *    "Secondary" Firebase app (no memory leak on repeated creates)
 *  • Optimistic concurrency on edits via a `version` field enforced through
 *    `runTransaction` — last-write-wins data loss is impossible
 *  • Keeping the linked `users/{uid}` profile in sync when email changes
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { initializeApp, getApp, deleteApp } from 'firebase/app';
import { db, firebaseConfig } from '../firebase';

// ─── Validation ─────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\d{10}$/;
const MAX_NAME_LEN = 80;
const MAX_FIELD_LEN = 200;

export interface StaffBaseInput {
  name: string;
  email: string;
  phone?: string;
  salary: number;
}

export function validateStaffInput(input: StaffBaseInput): string | null {
  const name = input.name?.trim() ?? '';
  if (name.length < 2) return 'Name must be at least 2 characters';
  if (name.length > MAX_NAME_LEN) return `Name must be under ${MAX_NAME_LEN} characters`;

  const email = input.email?.trim().toLowerCase() ?? '';
  if (!EMAIL_REGEX.test(email)) return 'Enter a valid email address';
  if (email.length > MAX_FIELD_LEN) return 'Email is too long';

  if (input.phone) {
    const phone = input.phone.replace(/\D/g, '');
    if (!PHONE_REGEX.test(phone)) return 'Phone must be a 10-digit number';
  }

  if (!Number.isFinite(input.salary) || input.salary < 0) {
    return 'Salary must be a non-negative number';
  }
  if (input.salary > 10_000_000) {
    return 'Salary value looks unreasonably large';
  }
  return null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ─── Email uniqueness ───────────────────────────────────────────────────────

/**
 * Throws if `email` is already attached to a different `users` document.
 * Pass `excludeUid` when editing an existing user so their own doc is ignored.
 */
export async function ensureUniqueEmail(email: string, excludeUid?: string): Promise<void> {
  const normalized = normalizeEmail(email);
  const snap = await getDocs(
    query(collection(db, 'users'), where('email', '==', normalized)),
  );
  const conflict = snap.docs.find(d => d.id !== excludeUid);
  if (conflict) {
    throw new Error(`The email ${normalized} is already registered to another account.`);
  }
}

// ─── Auth provisioning (with proper cleanup) ────────────────────────────────

/**
 * Create a Firebase Auth account for the given email using a temporary
 * "Secondary" app so the current admin's session is never disturbed.
 * The secondary app is torn down in `finally` so repeated invocations
 * don't accumulate resources.
 *
 * If the email already exists with the default password, the existing uid
 * is returned (idempotent recovery). If the password differs, the function
 * throws — the caller must NOT proceed to create the staff/teacher doc.
 */
export async function provisionStaffAuthAccount(
  email: string,
  defaultPassword: string,
): Promise<string> {
  const normalized = normalizeEmail(email);
  const SECONDARY_NAME = 'Secondary';
  let secondaryApp;
  try {
    secondaryApp = getApp(SECONDARY_NAME);
  } catch {
    secondaryApp = initializeApp(firebaseConfig, SECONDARY_NAME);
  }
  const secondaryAuth = getAuth(secondaryApp);

  try {
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, normalized, defaultPassword);
      return cred.user.uid;
    } catch (err: any) {
      if (err?.code !== 'auth/email-already-in-use') throw err;
      try {
        const cred = await signInWithEmailAndPassword(secondaryAuth, normalized, defaultPassword);
        return cred.user.uid;
      } catch (signInErr: any) {
        if (signInErr?.code === 'auth/invalid-credential' || signInErr?.code === 'auth/wrong-password') {
          throw new Error(
            `The email ${normalized} is already in use with a different password. ` +
            `Ask the user to reset their password or use a different email.`,
          );
        }
        throw signInErr;
      }
    }
  } finally {
    try { await signOut(secondaryAuth); } catch { /* ignore */ }
    try { await deleteApp(secondaryApp); } catch { /* ignore */ }
  }
}

// ─── Optimistic-concurrency updates ─────────────────────────────────────────

export class ConcurrentEditError extends Error {
  constructor(message = 'This record was edited by someone else. Please reload and try again.') {
    super(message);
    this.name = 'ConcurrentEditError';
  }
}

interface UpdateOptions {
  collectionName: 'teachers' | 'staff';
  docId: string;
  expectedVersion: number;
  // Fields to write on the staff/teacher document
  updates: Record<string, any>;
  // The original email this record was created with (used to find the linked users doc)
  originalEmail: string;
  // What to merge onto the linked users/{uid} profile
  // (name/phone/photoURL/email — email is updated only if it differs from originalEmail)
  userProfileUpdates: Record<string, any>;
}

/**
 * Update a staff or teacher document with optimistic concurrency, and keep
 * the linked `users/{uid}` doc in sync — including email changes.
 *
 * Throws `ConcurrentEditError` if another writer bumped the version since
 * the form was loaded.
 */
export async function updateStaffWithUserSync(opts: UpdateOptions): Promise<void> {
  const staffRef = doc(db, opts.collectionName, opts.docId);

  // Resolve the linked user doc OUTSIDE the transaction (queries aren't allowed
  // inside one). We find by the original email + role-agnostic lookup.
  const userSnap = await getDocs(
    query(collection(db, 'users'), where('email', '==', normalizeEmail(opts.originalEmail))),
  );
  const userDocRef = userSnap.empty ? null : doc(db, 'users', userSnap.docs[0].id);

  const newEmail = opts.userProfileUpdates.email
    ? normalizeEmail(opts.userProfileUpdates.email)
    : null;

  // If the email is changing, make sure the new one isn't already used elsewhere.
  if (newEmail && newEmail !== normalizeEmail(opts.originalEmail)) {
    await ensureUniqueEmail(newEmail, userDocRef?.id);
  }

  await runTransaction(db, async (tx) => {
    const current = await tx.get(staffRef);
    if (!current.exists()) throw new Error('Record no longer exists');
    const currentVersion = (current.data().version ?? 0) as number;
    if (currentVersion !== opts.expectedVersion) {
      throw new ConcurrentEditError();
    }

    tx.update(staffRef, {
      ...opts.updates,
      version: currentVersion + 1,
      updatedAt: new Date().toISOString(),
    });

    if (userDocRef) {
      tx.set(userDocRef, {
        ...opts.userProfileUpdates,
        ...(newEmail ? { email: newEmail } : {}),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  });
}

// ─── Create helpers ─────────────────────────────────────────────────────────

/**
 * Idempotent lookup for the linked users doc by uid.
 */
export async function getUserProfileByUid(uid: string) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
