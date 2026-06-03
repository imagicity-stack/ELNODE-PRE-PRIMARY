import { useState, useEffect, useRef } from 'react';
import {
  collection, onSnapshot, query, where, orderBy,
  doc, updateDoc, addDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { UserProfile, Grievance, GrievanceNote, GrievanceStatus } from '../../types';
import { logActivity } from '../../services/activityService';
import { Button } from '../../components/ui';
import { useToast } from '../../components/Toast';
import {
  MessageSquare, AlertCircle, Clock, CheckCircle2,
  ArrowUpRight, Search, Lock, Send, X,
} from 'lucide-react';

const CATEGORIES = ['academic', 'fee', 'facility', 'staff_conduct', 'transport', 'other'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const STATUSES: GrievanceStatus[] = ['open', 'in_progress', 'awaiting_response', 'resolved', 'closed'];

const statusConfig: Record<string, { label: string; dotColor: string; chipBg: string; chipColor: string }> = {
  open: { label: 'Open', dotColor: 'var(--coral)', chipBg: '#fee2e2', chipColor: '#b91c1c' },
  in_progress: { label: 'In Progress', dotColor: '#f59e0b', chipBg: '#fef3c7', chipColor: '#92400e' },
  awaiting_response: { label: 'Awaiting', dotColor: '#3b82f6', chipBg: '#dbeafe', chipColor: '#1e40af' },
  resolved: { label: 'Resolved', dotColor: 'var(--leaf)', chipBg: '#d1fae5', chipColor: '#065f46' },
  closed: { label: 'Closed', dotColor: 'var(--ink-3)', chipBg: 'var(--cream-2)', chipColor: 'var(--ink-3)' },
};

const priorityChip: Record<string, { bg: string; color: string }> = {
  low: { bg: 'var(--cream-2)', color: 'var(--ink-3)' },
  medium: { bg: '#fef3c7', color: '#92400e' },
  high: { bg: '#ffedd5', color: '#c2410c' },
  urgent: { bg: '#fee2e2', color: '#b91c1c' },
};

export default function GrievanceTracker({ user }: { user: UserProfile }) {
  const [grievances, setGrievances] = useState<Grievance[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [selectedGrievance, setSelectedGrievance] = useState<Grievance | null>(null);
  const [noteText, setNoteText] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [submittingNote, setSubmittingNote] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const notesEndRef = useRef<HTMLDivElement>(null);

  const { showToast } = useToast();

  const isSuperAdmin = user.role === 'super_admin';
  const isPrincipal = user.role === 'principal';
  const isOfficer = user.role === 'grievance_officer';

  useEffect(() => {
    let q;
    if (isSuperAdmin) {
      q = query(collection(db, 'grievances'), orderBy('createdAt', 'desc'));
    } else if (isPrincipal) {
      q = query(collection(db, 'grievances'), where('isEscalated', '==', true), orderBy('createdAt', 'desc'));
    } else {
      q = query(collection(db, 'grievances'), where('isEscalated', '==', false), orderBy('createdAt', 'desc'));
    }

    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Grievance));
      setGrievances(list);
      // Sync selected grievance if open
      if (selectedGrievance) {
        const updated = list.find(g => g.id === selectedGrievance.id);
        if (updated) setSelectedGrievance(updated);
      }
      setLoading(false);
    }, () => setLoading(false));

    return unsub;
  }, [isSuperAdmin, isPrincipal]);

  useEffect(() => {
    notesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedGrievance?.notes]);

  const filtered = grievances.filter(g => {
    if (filterStatus !== 'all' && g.status !== filterStatus) return false;
    if (filterPriority !== 'all' && g.priority !== filterPriority) return false;
    if (filterCategory !== 'all' && g.category !== filterCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return g.title.toLowerCase().includes(q) || g.parentName.toLowerCase().includes(q) || g.studentName.toLowerCase().includes(q);
    }
    return true;
  });

  const handleStatusChange = async (grievance: Grievance, newStatus: GrievanceStatus) => {
    if (updatingStatus) return;
    setUpdatingStatus(true);
    try {
      const updates: any = {
        status: newStatus,
        updatedAt: new Date().toISOString(),
      };
      if (newStatus === 'resolved' || newStatus === 'closed') {
        updates.resolvedAt = new Date().toISOString();
      }
      await updateDoc(doc(db, 'grievances', grievance.id), updates);
      showToast(`Status updated to ${newStatus.replace('_', ' ')}`, 'success');
      logActivity(user, 'Grievance Status Updated', 'Super Admin', `"${grievance.title}" → ${newStatus.replace('_', ' ')} (${grievance.parentName} / ${grievance.studentName})`, { grievanceId: grievance.id, fromStatus: grievance.status, toStatus: newStatus });
    } catch {
      showToast('Failed to update status', 'error');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleEscalate = async (grievance: Grievance) => {
    if (!isOfficer && !isSuperAdmin) return;
    if (grievance.isEscalated) return;
    try {
      await updateDoc(doc(db, 'grievances', grievance.id), {
        isEscalated: true,
        escalatedAt: new Date().toISOString(),
        escalatedBy: user.name,
        updatedAt: new Date().toISOString(),
      });
      setSelectedGrievance(null);
      showToast('Grievance escalated to Principal', 'success');
      logActivity(user, 'Grievance Escalated', 'Super Admin', `"${grievance.title}" escalated to Principal (${grievance.parentName} / ${grievance.studentName})`, { grievanceId: grievance.id });
    } catch {
      showToast('Failed to escalate', 'error');
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim() || !selectedGrievance || submittingNote) return;
    setSubmittingNote(true);
    try {
      const note: GrievanceNote = {
        id: Date.now().toString(),
        content: noteText.trim(),
        authorName: user.name,
        authorRole: user.role,
        createdAt: new Date().toISOString(),
        isInternal,
      };
      const updatedNotes = [...(selectedGrievance.notes || []), note];
      await updateDoc(doc(db, 'grievances', selectedGrievance.id), {
        notes: updatedNotes,
        updatedAt: new Date().toISOString(),
      });
      setNoteText('');
      showToast('Note added', 'success');
      logActivity(user, isInternal ? 'Grievance Internal Note Added' : 'Grievance Note Added', 'Super Admin', `Note on "${selectedGrievance.title}" (${selectedGrievance.parentName} / ${selectedGrievance.studentName}): ${noteText.trim().slice(0, 80)}`, { grievanceId: selectedGrievance.id, isInternal });
    } catch {
      showToast('Failed to add note', 'error');
    } finally {
      setSubmittingNote(false);
    }
  };

  const canEscalate = (g: Grievance) => (isOfficer || isSuperAdmin) && !g.isEscalated;
  const canChangeStatus = !isPrincipal || isSuperAdmin;

  // Status filter chips
  const statusChips = [
    { value: 'all', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'closed', label: 'Closed' },
  ];

  return (
    <div>
      {/* ── Topbar ── */}
      <div className="topbar">
        <div>
          <div className="eyebrow">
            {filtered.length} {filterStatus !== 'all' ? filterStatus.replace('_', ' ') : 'total'}
            {isPrincipal ? ' · escalated' : ''}
          </div>
          <h1>{isPrincipal ? 'Escalated Grievances' : 'Tracker'}</h1>
        </div>
      </div>

      <div className="pad">
        {/* ── Status filter chips ── */}
        <div className="hscroll" style={{ marginBottom: 12 }}>
          {statusChips.map(chip => (
            <button
              key={chip.value}
              className={`chip${filterStatus === chip.value ? ' solid' : ''}`}
              onClick={() => setFilterStatus(chip.value)}
            >
              {chip.label}
              {chip.value !== 'all' && (
                <span style={{ marginLeft: 4, opacity: 0.7, fontSize: 11 }}>
                  ({grievances.filter(g => chip.value === 'all' || g.status === chip.value).length})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Search + priority/category filters ── */}
        <div className="card flex center gap-8" style={{ padding: '10px 14px', marginBottom: 12 }}>
          <Search size={16} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search by title, parent, student…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, color: 'var(--ink)' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <select
            value={filterPriority}
            onChange={e => setFilterPriority(e.target.value)}
            style={{
              flex: 1, border: '1px solid var(--line)', borderRadius: 10,
              padding: '8px 10px', fontSize: 13, background: 'var(--paper)', color: 'var(--ink)',
            }}
          >
            <option value="all">All Priorities</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            style={{
              flex: 1, border: '1px solid var(--line)', borderRadius: 10,
              padding: '8px 10px', fontSize: 13, background: 'var(--paper)', color: 'var(--ink)',
            }}
          >
            <option value="all">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
        </div>

        {/* ── Grievance list ── */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid var(--line)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <MessageSquare size={32} style={{ color: 'var(--line)', margin: '0 auto 8px' }} />
            <p className="muted" style={{ fontSize: 14 }}>No grievances found</p>
          </div>
        ) : (
          <div className="stack">
            {filtered.map(g => {
              const sc = statusConfig[g.status] || statusConfig.open;
              const pc = priorityChip[g.priority] || priorityChip.low;
              return (
                <div
                  key={g.id}
                  className="card"
                  style={{
                    cursor: 'pointer',
                    borderLeft: `4px solid ${sc.dotColor}`,
                    background: selectedGrievance?.id === g.id ? 'var(--cream)' : 'var(--paper)',
                  }}
                  onClick={() => setSelectedGrievance(selectedGrievance?.id === g.id ? null : g)}
                >
                  {/* Title + escalated badge */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <p style={{ fontWeight: 700, fontSize: 14, margin: 0, flex: 1 }}>{g.title}</p>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {g.isEscalated && (
                        <span style={{ padding: '2px 6px', borderRadius: 99, background: '#fee2e2', color: '#b91c1c', fontSize: 10, fontWeight: 700 }}>ESCALATED</span>
                      )}
                    </div>
                  </div>

                  {/* Description preview */}
                  <p className="muted" style={{
                    fontSize: 13, margin: '0 0 8px',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {g.description}
                  </p>

                  {/* Student / parent info */}
                  <div className="eyebrow" style={{ marginBottom: 6 }}>
                    {g.parentName} · {g.studentName} · {g.classSection}
                  </div>

                  {/* Chips + date */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: sc.chipBg, color: sc.chipColor }}>
                      {sc.label}
                    </span>
                    <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: pc.bg, color: pc.color, textTransform: 'capitalize' }}>
                      {g.priority}
                    </span>
                    <span className="muted" style={{ fontSize: 11, textTransform: 'capitalize' }}>{g.category.replace('_', ' ')}</span>
                    <span className="mono tiny" style={{ marginLeft: 'auto', fontSize: 11 }}>
                      {new Date(g.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </span>
                  </div>

                  {/* Inline detail panel when selected */}
                  {selectedGrievance?.id === g.id && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }} onClick={e => e.stopPropagation()}>
                      {/* Meta grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                        <div style={{ padding: 10, background: 'var(--cream-2)', borderRadius: 10 }}>
                          <div className="eyebrow" style={{ marginBottom: 2 }}>Category</div>
                          <p style={{ fontSize: 13, fontWeight: 600, margin: 0, textTransform: 'capitalize' }}>{g.category.replace('_', ' ')}</p>
                        </div>
                        <div style={{ padding: 10, background: 'var(--cream-2)', borderRadius: 10 }}>
                          <div className="eyebrow" style={{ marginBottom: 2 }}>Filed On</div>
                          <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
                            {new Date(g.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </p>
                        </div>
                        {g.parentPhone && (
                          <div style={{ padding: 10, background: 'var(--cream-2)', borderRadius: 10 }}>
                            <div className="eyebrow" style={{ marginBottom: 2 }}>Phone</div>
                            <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{g.parentPhone}</p>
                          </div>
                        )}
                        <div style={{ padding: 10, background: 'var(--cream-2)', borderRadius: 10 }}>
                          <div className="eyebrow" style={{ marginBottom: 2 }}>Status</div>
                          {canChangeStatus ? (
                            <select
                              value={g.status}
                              onChange={e => handleStatusChange(g, e.target.value as GrievanceStatus)}
                              disabled={updatingStatus}
                              style={{ fontSize: 13, fontWeight: 600, background: 'transparent', border: 'none', outline: 'none', width: '100%', color: 'var(--ink)', cursor: 'pointer' }}
                            >
                              {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                            </select>
                          ) : (
                            <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>{statusConfig[g.status]?.label}</span>
                          )}
                        </div>
                      </div>

                      {/* Description */}
                      <div style={{ padding: 12, background: 'var(--cream-2)', borderRadius: 10, marginBottom: 12 }}>
                        <div className="eyebrow" style={{ marginBottom: 4 }}>Description</div>
                        <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{g.description}</p>
                      </div>

                      {/* Escalate */}
                      {canEscalate(g) && (
                        <button
                          onClick={() => handleEscalate(g)}
                          style={{
                            width: '100%', marginBottom: 10, padding: '10px 14px',
                            borderRadius: 10, background: '#fff1f2', border: '1px solid #fecdd3',
                            color: '#b91c1c', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          }}
                        >
                          <ArrowUpRight size={15} /> Escalate to Principal
                        </button>
                      )}
                      {g.isEscalated && g.escalatedBy && (
                        <div style={{ marginBottom: 10, padding: '8px 12px', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 10, fontSize: 12, color: '#b91c1c' }}>
                          Escalated by <strong>{g.escalatedBy}</strong> on {new Date(g.escalatedAt!).toLocaleDateString('en-IN')}
                        </div>
                      )}

                      {/* Thread */}
                      <div style={{ marginBottom: 12 }}>
                        <div className="eyebrow" style={{ marginBottom: 8 }}>
                          Thread ({(g.notes || []).length} notes)
                        </div>
                        <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {(g.notes || []).length === 0 && (
                            <p className="muted" style={{ fontSize: 12, textAlign: 'center', padding: '12px 0' }}>No notes yet</p>
                          )}
                          {(g.notes || []).map(note => (
                            <div
                              key={note.id}
                              style={{
                                padding: '10px 12px', borderRadius: 10, fontSize: 13,
                                background: note.isInternal ? '#fffbeb' : '#eff6ff',
                                border: `1px solid ${note.isInternal ? '#fde68a' : '#bfdbfe'}`,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span style={{ fontSize: 12, fontWeight: 700 }}>
                                  {note.authorName} <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>({note.authorRole.replace('_', ' ')})</span>
                                </span>
                                {note.isInternal && (
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#92400e', fontWeight: 600 }}>
                                    <Lock size={10} /> Internal
                                  </span>
                                )}
                              </div>
                              <p style={{ margin: 0, color: 'var(--ink)', lineHeight: 1.5 }}>{note.content}</p>
                              <p className="muted" style={{ margin: '4px 0 0', fontSize: 10 }}>
                                {new Date(note.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          ))}
                          <div ref={notesEndRef} />
                        </div>
                      </div>

                      {/* Add note */}
                      <textarea
                        value={noteText}
                        onChange={e => setNoteText(e.target.value)}
                        placeholder="Add a note or response…"
                        rows={3}
                        style={{
                          width: '100%', border: '1px solid var(--line)', borderRadius: 10,
                          padding: '10px 12px', fontSize: 13, color: 'var(--ink)',
                          background: 'var(--paper)', resize: 'none', outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#92400e', cursor: 'pointer' }}>
                          <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} />
                          <Lock size={11} />
                          Internal note
                        </label>
                        <Button
                          onClick={handleAddNote}
                          disabled={!noteText.trim() || submittingNote}
                          size="sm"
                        >
                          <Send className="w-3.5 h-3.5 mr-1" />
                          {submittingNote ? 'Saving…' : 'Add Note'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
