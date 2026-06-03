import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  limit,
  setDoc,
  getDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { AppNotification, NotificationCategory, NotificationTargetType, UserProfile } from '../types';

// ─── Category presets (icon names resolved in the UI) ──────────────────────────
export const NOTIFICATION_CATEGORIES: Record<
  NotificationCategory,
  { label: string; icon: string; color: string; bg: string }
> = {
  exam: { label: 'Exam / Result', icon: 'GraduationCap', color: 'text-violet-600', bg: 'bg-violet-50' },
  fee: { label: 'Fee / Payment', icon: 'Wallet', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  notice: { label: 'Notice', icon: 'Megaphone', color: 'text-indigo-600', bg: 'bg-indigo-50' },
  event: { label: 'Event / Holiday', icon: 'CalendarDays', color: 'text-amber-600', bg: 'bg-amber-50' },
  general: { label: 'General', icon: 'Bell', color: 'text-slate-600', bg: 'bg-slate-100' },
};

// ─── Audience tokens ────────────────────────────────────────────────────────
// The set of tokens a given user matches. A notification reaches the user if any
// of its `audience` entries appears in this set.
export function audienceTokensForUser(user: UserProfile): string[] {
  const tokens = new Set<string>(['all', `role:${user.role}`, `user:${user.uid}`]);

  const addClass = (classId?: string, section?: string) => {
    if (!classId) return;
    tokens.add(`class:${classId}`);
    tokens.add(`class:${classId}:${section || 'A'}`);
  };

  addClass(user.classId, user.section);
  // Parents carry denormalized classIds for each child (set on login).
  const classIds = (user as any).classIds as string[] | undefined;
  if (Array.isArray(classIds)) classIds.forEach((cid) => addClass(cid));

  return Array.from(tokens);
}

// Build the audience tokens + human summary for a composed notification.
export function buildAudience(
  targetType: NotificationTargetType,
  opts: {
    roles?: string[];
    classId?: string;
    section?: string;
    className?: string;
    userIds?: string[];
    userLabels?: string[];
  }
): { audience: string[]; summary: string } {
  switch (targetType) {
    case 'all':
      return { audience: ['all'], summary: 'Everyone' };
    case 'role': {
      const roles = opts.roles || [];
      return {
        audience: roles.map((r) => `role:${r}`),
        summary: roles.length ? roles.map(prettyRole).join(', ') : 'No roles',
      };
    }
    case 'class': {
      if (!opts.classId) return { audience: [], summary: 'No class' };
      const token = opts.section
        ? `class:${opts.classId}:${opts.section}`
        : `class:${opts.classId}`;
      const summary = `Class ${opts.className || opts.classId}${opts.section ? ` - ${opts.section}` : ' (all sections)'}`;
      return { audience: [token], summary };
    }
    case 'individual': {
      const ids = opts.userIds || [];
      return {
        audience: ids.map((id) => `user:${id}`),
        summary: opts.userLabels?.length
          ? opts.userLabels.join(', ')
          : `${ids.length} ${ids.length === 1 ? 'person' : 'people'}`,
      };
    }
  }
}

function prettyRole(role: string): string {
  const map: Record<string, string> = {
    student: 'Students',
    parent: 'Parents',
    teacher: 'Teachers',
    accounts: 'Accounts',
    principal: 'Principal',
    office_staff: 'Staff',
    super_admin: 'Admins',
    grievance_officer: 'Grievance',
  };
  return map[role] || role;
}

// ─── Sending ──────────────────────────────────────────────────────────────
export async function sendNotification(payload: {
  title: string;
  body: string;
  category: NotificationCategory;
  priority: 'normal' | 'high';
  targetType: NotificationTargetType;
  audience: string[];
  targetSummary: string;
  link?: string;
  sender: { uid: string; name: string };
}): Promise<void> {
  const notifDoc: Omit<AppNotification, 'id'> = {
    title: payload.title.trim(),
    body: payload.body.trim(),
    category: payload.category,
    priority: payload.priority,
    audience: payload.audience,
    targetType: payload.targetType,
    targetSummary: payload.targetSummary,
    createdAt: new Date().toISOString(),
    createdBy: payload.sender,
    ...(payload.link ? { link: payload.link } : {}),
  };
  const ref = await addDoc(collection(db, 'notifications'), notifDoc);

  // Phase 2: fire-and-forget push notification via Vercel API
  try {
    const pushRes = await fetch('/api/notifications/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notificationId: ref.id,
        audience: payload.audience,
        title: payload.title.trim(),
        body: payload.body.trim(),
        category: payload.category,
        priority: payload.priority,
        link: payload.link,
      }),
    });
    const pushData = await pushRes.json().catch(() => ({}));
    if (!pushRes.ok) {
      console.warn('[push] send-push API error:', pushData);
    } else {
      console.info('[push] result:', pushData);
    }
  } catch (e) {
    // Push delivery failure must not block the in-app notification
    console.warn('[push] API call failed (non-critical):', e);
  }
}

export async function deleteNotification(id: string): Promise<void> {
  await deleteDoc(doc(db, 'notifications', id));
}

// ─── Receiving (real-time feed for a user) ──────────────────────────────────
// Reads the most recent notifications and filters to the user's audience client
// side. Notification volume in a school app is modest, so a 100-item window with
// a single-field index (createdAt) is plenty and avoids composite-index setup.
export function subscribeFeed(
  user: UserProfile,
  cb: (items: AppNotification[]) => void,
  onError?: (e: Error) => void
): () => void {
  const tokens = new Set(audienceTokensForUser(user));
  const q = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as AppNotification))
        .filter((n) => Array.isArray(n.audience) && n.audience.some((t) => tokens.has(t)));
      cb(items);
    },
    (err) => onError?.(err)
  );
}

// ─── Per-user read state ────────────────────────────────────────────────────
export function subscribeReadState(
  uid: string,
  cb: (state: { lastReadAt: string; dismissedIds: string[] }) => void
): () => void {
  return onSnapshot(doc(db, 'userNotificationState', uid), (snap) => {
    const data = snap.data();
    cb({
      lastReadAt: data?.lastReadAt || '1970-01-01T00:00:00.000Z',
      dismissedIds: data?.dismissedIds || [],
    });
  });
}

export async function markAllRead(uid: string): Promise<void> {
  await setDoc(
    doc(db, 'userNotificationState', uid),
    { lastReadAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

export async function dismissNotification(uid: string, id: string): Promise<void> {
  const ref = doc(db, 'userNotificationState', uid);
  const snap = await getDoc(ref);
  const existing: string[] = snap.data()?.dismissedIds || [];
  // Cap the dismissed list so it can't grow without bound.
  const next = [id, ...existing.filter((x) => x !== id)].slice(0, 200);
  await setDoc(ref, { dismissedIds: next, updatedAt: new Date().toISOString() }, { merge: true });
}
