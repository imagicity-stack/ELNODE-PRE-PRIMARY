import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import {
  Bell, Send, GraduationCap, Wallet, Megaphone, CalendarDays, Users, Search, X,
  Trash2, Globe, UserCheck, Layers, AlertTriangle,
} from 'lucide-react';
import {
  FormField, Input, Textarea, Select, ConfirmModal, Avatar,
} from '../../components/ui';
import { AppNotification, NotificationCategory, NotificationTargetType, UserProfile, Class } from '../../types';
import {
  sendNotification, deleteNotification, buildAudience, NOTIFICATION_CATEGORIES,
} from '../../services/notificationCenterService';
import { logActivity } from '../../services/activityService';
import { useToast } from '../../components/Toast';
import { cn } from '../../lib/utils';

const CATEGORY_ICON: Record<string, any> = { GraduationCap, Wallet, Megaphone, CalendarDays, Bell };

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'student', label: 'Students' },
  { value: 'parent', label: 'Parents' },
  { value: 'teacher', label: 'Teachers' },
  { value: 'accounts', label: 'Accounts' },
  { value: 'principal', label: 'Principal' },
  { value: 'office_staff', label: 'Staff' },
];

const TARGET_OPTIONS: { value: NotificationTargetType; label: string; icon: any; desc: string }[] = [
  { value: 'all', label: 'Everyone', icon: Globe, desc: 'All app users' },
  { value: 'role', label: 'By Role', icon: Users, desc: 'Students, parents, etc.' },
  { value: 'class', label: 'By Class', icon: Layers, desc: 'A class / section' },
  { value: 'individual', label: 'Individuals', icon: UserCheck, desc: 'Specific people' },
];

interface SearchUser { uid: string; name: string; email: string; role: string; classId?: string; section?: string; }

export default function NotificationManager({ user }: { user: UserProfile }) {
  const { showToast } = useToast();

  const [category, setCategory] = useState<NotificationCategory>('notice');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<'normal' | 'high'>('normal');
  const [targetType, setTargetType] = useState<NotificationTargetType>('all');
  const [link, setLink] = useState('');
  const [sending, setSending] = useState(false);

  // Role target
  const [roles, setRoles] = useState<string[]>([]);
  // Class target
  const [classes, setClasses] = useState<Class[]>([]);
  const [classId, setClassId] = useState('');
  const [section, setSection] = useState('');
  // Individual target
  const [allUsers, setAllUsers] = useState<SearchUser[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<SearchUser[]>([]);

  // History
  const [history, setHistory] = useState<AppNotification[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    getDocs(collection(db, 'classes'))
      .then((snap) => setClasses(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Class))))
      .catch(() => {});

    const unsub = onSnapshot(
      query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(50)),
      (snap) => setHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AppNotification))),
      () => {}
    );
    return () => unsub();
  }, []);

  // Lazy-load users the first time individual targeting is chosen.
  useEffect(() => {
    if (targetType !== 'individual' || usersLoaded) return;
    getDocs(collection(db, 'users'))
      .then((snap) => {
        setAllUsers(
          snap.docs.map((d) => {
            const u = d.data() as any;
            return { uid: d.id, name: u.name || u.email || 'User', email: u.email || '', role: u.role || '', classId: u.classId, section: u.section };
          })
        );
        setUsersLoaded(true);
      })
      .catch(() => showToast('Could not load users', 'error'));
  }, [targetType, usersLoaded, showToast]);

  const selectedClass = classes.find((c) => c.id === classId);
  const sectionOptions = selectedClass?.sections?.map((s) => s.name || 'A') || [];

  const userResults = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return [];
    return allUsers
      .filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .filter((u) => !selectedUsers.some((s) => s.uid === u.uid))
      .slice(0, 8);
  }, [userSearch, allUsers, selectedUsers]);

  const toggleRole = (r: string) =>
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));

  const audiencePreview = useMemo(() => {
    return buildAudience(targetType, {
      roles,
      classId,
      section: section || undefined,
      className: selectedClass?.name,
      userIds: selectedUsers.map((u) => u.uid),
      userLabels: selectedUsers.map((u) => u.name),
    });
  }, [targetType, roles, classId, section, selectedClass, selectedUsers]);

  const canSend = useMemo(() => {
    if (!title.trim() || !body.trim()) return false;
    if (targetType === 'role') return roles.length > 0;
    if (targetType === 'class') return !!classId;
    if (targetType === 'individual') return selectedUsers.length > 0;
    return true; // 'all'
  }, [title, body, targetType, roles, classId, selectedUsers]);

  const resetForm = () => {
    setTitle(''); setBody(''); setLink(''); setPriority('normal');
    setRoles([]); setClassId(''); setSection(''); setSelectedUsers([]); setUserSearch('');
  };

  const handleSend = async () => {
    if (!canSend) return;
    const { audience, summary } = audiencePreview;
    if (audience.length === 0) { showToast('Select at least one recipient', 'error'); return; }
    setSending(true);
    try {
      await sendNotification({
        title, body, category, priority, targetType, audience, targetSummary: summary,
        link: link.trim() || undefined,
        sender: { uid: user.uid, name: user.name },
      });
      logActivity(user, 'Notification Sent', 'Super Admin',
        `Sent "${title}" to ${summary}`, { category, targetType });
      showToast(`Notification sent to ${summary}`, 'success');
      resetForm();
    } catch (e: any) {
      showToast(e?.message || 'Failed to send notification', 'error');
    } finally {
      setSending(false);
    }
  };

  const performDelete = async () => {
    if (!deleteId) return;
    try { await deleteNotification(deleteId); showToast('Notification deleted', 'success'); }
    catch { showToast('Failed to delete', 'error'); }
    finally { setDeleteId(null); }
  };

  return (
    <div className="pad stack" style={{ gap: 24 }}>
      <div className="topbar">
        <div>
          <div className="eyebrow">Admin Portal</div>
          <h1>Notifications</h1>
        </div>
        <button className="btn accent" onClick={handleSend} disabled={sending || !canSend}>
          <Send size={15} />
          {sending ? 'Sending…' : 'Send Notification'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24, alignItems: 'start' }}>
        {/* Composer */}
        <div className="card stack" style={{ gap: 20 }}>
          <div className="eyebrow">Compose</div>

          {/* Category chips */}
          <div className="stack" style={{ gap: 8 }}>
            <p className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Category</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[]).map((key) => {
                const cat = NOTIFICATION_CATEGORIES[key];
                const Icon = CATEGORY_ICON[cat.icon] || Bell;
                const active = category === key;
                return (
                  <button
                    key={key}
                    onClick={() => setCategory(key)}
                    className={cn('chip', active ? 'solid' : '')}
                  >
                    <Icon size={13} /> {cat.label}
                  </button>
                );
              })}
            </div>
          </div>

          <FormField label="Title" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Term 1 results are out" maxLength={120} />
          </FormField>

          <FormField label="Message" required>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="Write the notification message…" maxLength={1000} />
          </FormField>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <FormField label="Priority">
              <Select value={priority} onChange={(e) => setPriority(e.target.value as any)}>
                <option value="normal">Normal</option>
                <option value="high">Urgent</option>
              </Select>
            </FormField>
            <FormField label="Open link (optional)" hint="In-app route, e.g. /notices">
              <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="/notices" />
            </FormField>
          </div>

          {/* Target type */}
          <div className="stack" style={{ gap: 8 }}>
            <p className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Send to</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
              {TARGET_OPTIONS.map((opt) => {
                const active = targetType === opt.value;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setTargetType(opt.value)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      padding: '10px 8px', borderRadius: 12, border: `1.5px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                      background: active ? 'rgba(99,102,241,.07)' : 'transparent',
                      color: active ? 'var(--accent)' : 'var(--ink)', cursor: 'pointer', transition: 'all .15s',
                    }}
                  >
                    <Icon size={18} />
                    <span style={{ fontSize: 11, fontWeight: 700 }}>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Target detail */}
          {targetType === 'role' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ROLE_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => toggleRole(r.value)}
                  className={cn('chip', roles.includes(r.value) ? 'solid' : '')}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}

          {targetType === 'class' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <FormField label="Class" required>
                <Select value={classId} onChange={(e) => { setClassId(e.target.value); setSection(''); }}>
                  <option value="">Select class</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
                </Select>
              </FormField>
              <FormField label="Section" hint="Leave blank for whole class">
                <Select value={section} onChange={(e) => setSection(e.target.value)} disabled={!classId}>
                  <option value="">All sections</option>
                  {sectionOptions.map((s) => <option key={s} value={s}>Section {s}</option>)}
                </Select>
              </FormField>
            </div>
          )}

          {targetType === 'individual' && (
            <div className="stack" style={{ gap: 8 }}>
              {selectedUsers.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selectedUsers.map((u) => (
                    <span key={u.uid} className="chip solid" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {u.name}
                      <button onClick={() => setSelectedUsers((prev) => prev.filter((x) => x.uid !== u.uid))} style={{ lineHeight: 0 }}>
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div style={{ position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--line)' }} />
                <input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder={usersLoaded ? 'Search by name or email…' : 'Loading users…'}
                  disabled={!usersLoaded}
                  style={{
                    width: '100%', paddingLeft: 34, paddingRight: 12, height: 40, border: '1.5px solid var(--line)',
                    borderRadius: 10, fontSize: 14, outline: 'none', background: 'var(--cream)',
                  }}
                />
                {userResults.length > 0 && (
                  <div style={{
                    position: 'absolute', zIndex: 10, marginTop: 4, width: '100%', background: '#fff',
                    borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.12)', border: '1px solid var(--line)', overflow: 'hidden',
                  }}>
                    {userResults.map((u) => (
                      <button
                        key={u.uid}
                        onClick={() => { setSelectedUsers((prev) => [...prev, u]); setUserSearch(''); }}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left' }}
                      >
                        <Avatar name={u.name} size="sm" />
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{u.name}</p>
                          <p className="tiny muted" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email} · {u.role}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Summary bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            <p className="tiny muted">
              Sending to <strong style={{ color: 'var(--ink)' }}>{audiencePreview.summary}</strong>
            </p>
          </div>
        </div>

        {/* History */}
        <div className="card stack" style={{ gap: 12 }}>
          <div className="eyebrow">Recently Sent</div>
          {history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <Megaphone size={28} style={{ color: 'var(--line)', margin: '0 auto 8px' }} />
              <p className="muted tiny">No notifications yet</p>
            </div>
          ) : (
            <div className="stack" style={{ gap: 8, maxHeight: '60vh', overflowY: 'auto' }}>
              {history.map((n) => {
                const cat = NOTIFICATION_CATEGORIES[n.category] || NOTIFICATION_CATEGORIES.general;
                const Icon = CATEGORY_ICON[cat.icon] || Bell;
                return (
                  <div key={n.id} style={{
                    display: 'flex', gap: 10, padding: 12, borderRadius: 12,
                    border: '1px solid var(--line)', background: 'var(--cream)',
                    position: 'relative',
                  }}
                    className="group"
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', flexShrink: 0, background: 'var(--cream-2)',
                    }}>
                      <Icon size={16} style={{ color: 'var(--accent)' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{n.title}</p>
                        {n.priority === 'high' && <AlertTriangle size={12} style={{ color: 'var(--coral)', flexShrink: 0 }} />}
                      </div>
                      <p className="tiny muted" style={{ margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</p>
                      <p className="tiny muted" style={{ margin: '2px 0 0' }}>
                        {n.targetSummary} · {new Date(n.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <button
                      onClick={() => setDeleteId(n.id)}
                      className="icon-btn"
                      style={{ alignSelf: 'flex-start', color: 'var(--coral)' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={performDelete}
        title="Delete notification?"
        message="This removes it from the notification center for all recipients."
      />
    </div>
  );
}
