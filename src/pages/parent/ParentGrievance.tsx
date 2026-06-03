import { useState, useEffect } from 'react';
import {
  collection, addDoc, query, where, orderBy, onSnapshot, doc, updateDoc,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { UserProfile, Student, Grievance, GrievanceCategory, GrievancePriority } from '../../types';
import { logActivity } from '../../services/activityService';
import { useToast } from '../../components/Toast';
import { MessageCircle, Plus, Clock, CheckCircle2, AlertCircle, X, Send } from 'lucide-react';
import { cn } from '../../lib/utils';

const CATEGORIES: { value: GrievanceCategory; label: string }[] = [
  { value: 'academic', label: 'Academic' },
  { value: 'fee', label: 'Fee / Payment' },
  { value: 'facility', label: 'Facility / Infrastructure' },
  { value: 'staff_conduct', label: 'Staff Conduct' },
  { value: 'transport', label: 'Transport' },
  { value: 'other', label: 'Other' },
];

const PRIORITIES: { value: GrievancePriority; label: string; description: string }[] = [
  { value: 'low', label: 'Low', description: 'General feedback or suggestion' },
  { value: 'medium', label: 'Medium', description: 'Needs attention soon' },
  { value: 'high', label: 'High', description: 'Affecting my child\'s learning' },
  { value: 'urgent', label: 'Urgent', description: 'Immediate action required' },
];

const statusConfig: Record<string, { label: string; bg: string; color: string; icon: any }> = {
  open: { label: 'Open', bg: '#fee2e2', color: '#991b1b', icon: AlertCircle },
  in_progress: { label: 'In Progress', bg: '#fef3c7', color: '#92400e', icon: Clock },
  awaiting_response: { label: 'Awaiting Response', bg: '#dbeafe', color: '#1e40af', icon: Clock },
  resolved: { label: 'Resolved', bg: '#d1fae5', color: '#065f46', icon: CheckCircle2 },
  closed: { label: 'Closed', bg: 'var(--cream-2)', color: 'var(--ink-3)', icon: CheckCircle2 },
};

interface Props {
  user: UserProfile;
  selectedStudent: Student | null;
}

export default function ParentGrievance({ user, selectedStudent }: Props) {
  const [grievances, setGrievances] = useState<Grievance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedGrievance, setSelectedGrievance] = useState<Grievance | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);

  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'other' as GrievanceCategory,
    priority: 'medium' as GrievancePriority,
  });
  const [submitting, setSubmitting] = useState(false);

  const { showToast } = useToast();

  useEffect(() => {
    if (!user.uid) return;
    const q = query(
      collection(db, 'grievances'),
      where('submittedByUid', '==', user.uid),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Grievance));
      setGrievances(list);
      if (selectedGrievance) {
        const updated = list.find(g => g.id === selectedGrievance.id);
        if (updated) setSelectedGrievance(updated);
      }
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user.uid]);

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.description.trim() || submitting) return;
    setSubmitting(true);
    try {
      const grievance = {
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        priority: form.priority,
        status: 'open',
        submittedByUid: user.uid,
        parentName: user.name,
        parentPhone: user.phone || '',
        studentId: selectedStudent?.id || '',
        studentName: selectedStudent?.name || '',
        classSection: selectedStudent ? `${selectedStudent.classId} ${selectedStudent.section}`.trim() : '',
        isEscalated: false,
        notes: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await addDoc(collection(db, 'grievances'), grievance);
      setForm({ title: '', description: '', category: 'other', priority: 'medium' });
      setShowForm(false);
      showToast('Grievance submitted successfully. We will get back to you shortly.', 'success');
      logActivity(user, 'Grievance Submitted', 'Parents', `"${form.title.trim()}" — ${form.category} (${form.priority} priority) for ${selectedStudent?.name || 'student'}`, { category: form.category, priority: form.priority, studentId: selectedStudent?.id });
    } catch {
      showToast('Failed to submit grievance', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async () => {
    if (!replyText.trim() || !selectedGrievance || submittingReply) return;
    setSubmittingReply(true);
    try {
      const note = {
        id: Date.now().toString(),
        content: replyText.trim(),
        authorName: user.name,
        authorRole: 'parent',
        createdAt: new Date().toISOString(),
        isInternal: false,
      };
      const updatedNotes = [...(selectedGrievance.notes || []), note];
      await updateDoc(doc(db, 'grievances', selectedGrievance.id), {
        notes: updatedNotes,
        status: 'awaiting_response',
        updatedAt: new Date().toISOString(),
      });
      setReplyText('');
      showToast('Reply added', 'success');
      logActivity(user, 'Grievance Reply Sent', 'Parents', `Reply on "${selectedGrievance.title}": ${replyText.trim().slice(0, 80)}`, { grievanceId: selectedGrievance.id });
    } catch {
      showToast('Failed to add reply', 'error');
    } finally {
      setSubmittingReply(false);
    }
  };

  const publicNotes = (g: Grievance) => (g.notes || []).filter(n => !n.isInternal);

  return (
    <div className="pad stack" style={{ '--stack-gap': '20px' } as React.CSSProperties}>
      {/* Topbar */}
      <div className="topbar">
        <div>
          <p className="eyebrow">{selectedStudent?.name || 'Parent'}</p>
          <h1 className="display" style={{ fontSize: 22 }}>Grievances</h1>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="btn accent flex items-center gap-1.5"
            style={{ fontSize: 13, padding: '8px 14px' }}
          >
            <Plus className="w-4 h-4" />
            New Grievance
          </button>
        )}
      </div>

      {/* Submit form */}
      {showForm && (
        <div className="card">
          <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 14, fontWeight: 700 }}>Submit a Grievance</p>
            <button
              onClick={() => setShowForm(false)}
              className="icon-btn"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Title *</label>
              <input
                type="text"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Brief title of your concern"
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Category *</label>
                <select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value as GrievanceCategory }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 bg-white"
                >
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Priority *</label>
                <select
                  value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value as GrievancePriority }))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 bg-white"
                >
                  {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label} — {p.description}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Description *</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Describe your concern in detail..."
                rows={4}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 resize-none"
              />
            </div>

            {selectedStudent && (
              <div className="p-3 rounded-xl" style={{ background: 'var(--cream-2)' }}>
                <p style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                  Filing for: <strong>{selectedStudent.name}</strong> ({selectedStudent.classId} {selectedStudent.section})
                </p>
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowForm(false)}
                className="btn ghost"
                style={{ padding: '8px 16px', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!form.title.trim() || !form.description.trim() || submitting}
                className="btn accent flex items-center gap-2"
                style={{ padding: '8px 16px', fontSize: 13 }}
              >
                <Send className="w-4 h-4" />
                {submitting ? 'Submitting...' : 'Submit Grievance'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List + Detail layout */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--ink)', borderTopColor: 'transparent' }} />
          </div>
        ) : grievances.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
            <MessageCircle className="w-8 h-8 mx-auto" style={{ color: 'var(--ink-4)', marginBottom: 8 }} />
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-3)' }}>No grievances filed yet</p>
            <button
              onClick={() => setShowForm(true)}
              className="btn accent"
              style={{ marginTop: 12, fontSize: 13, padding: '8px 16px' }}
            >
              File a Grievance
            </button>
          </div>
        ) : (
          <div className="stack" style={{ '--stack-gap': '8px' } as React.CSSProperties}>
            {grievances.map(g => {
              const sc = statusConfig[g.status] || statusConfig.open;
              const Icon = sc.icon;
              const isSelected = selectedGrievance?.id === g.id;
              return (
                <button
                  key={g.id}
                  onClick={() => setSelectedGrievance(isSelected ? null : g)}
                  className="w-full text-left card"
                  style={{
                    padding: '12px 16px',
                    background: isSelected ? 'var(--ink)' : 'var(--paper)',
                    color: isSelected ? 'var(--cream)' : 'var(--ink)',
                    transition: 'all 0.15s',
                  }}
                >
                  <div className="flex items-start justify-between gap-2" style={{ marginBottom: 6 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>{g.title}</p>
                    <span
                      className="flex items-center gap-1 shrink-0"
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 99,
                        background: isSelected ? 'rgba(255,255,255,0.15)' : sc.bg,
                        color: isSelected ? 'var(--cream)' : sc.color,
                      }}
                    >
                      <Icon className="w-3 h-3" />
                      {sc.label}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: 11,
                      color: isSelected ? 'var(--cream-2)' : 'var(--ink-3)',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      marginBottom: 6,
                    } as React.CSSProperties}
                  >
                    {g.description}
                  </p>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 10, color: isSelected ? 'var(--cream-2)' : 'var(--ink-4)', textTransform: 'capitalize' }}>
                      {g.category.replace('_', ' ')}
                    </span>
                    <span style={{ color: isSelected ? 'var(--cream-2)' : 'var(--ink-4)', fontSize: 10 }}>·</span>
                    <span style={{ fontSize: 10, color: isSelected ? 'var(--cream-2)' : 'var(--ink-4)' }}>
                      {new Date(g.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </span>
                    {publicNotes(g).length > 0 && (
                      <span
                        style={{
                          marginLeft: 'auto',
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 99,
                          background: isSelected ? 'rgba(255,255,255,0.2)' : 'var(--cream-2)',
                          color: isSelected ? 'var(--cream)' : 'var(--ink-2)',
                        }}
                      >
                        {publicNotes(g).length} note{publicNotes(g).length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Detail panel */}
        {selectedGrievance && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              className="flex items-start justify-between p-4"
              style={{ borderBottom: '1px solid var(--line)' }}
            >
              <div>
                <p style={{ fontSize: 15, fontWeight: 700 }}>{selectedGrievance.title}</p>
                <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 99,
                      background: (statusConfig[selectedGrievance.status] || statusConfig.open).bg,
                      color: (statusConfig[selectedGrievance.status] || statusConfig.open).color,
                    }}
                  >
                    {(statusConfig[selectedGrievance.status] || statusConfig.open).label}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'capitalize' }}>
                    {selectedGrievance.category.replace('_', ' ')}
                  </span>
                </div>
              </div>
              <button onClick={() => setSelectedGrievance(null)} className="icon-btn">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4" style={{ background: 'var(--cream-2)', borderBottom: '1px solid var(--line)' }}>
              <p className="eyebrow" style={{ marginBottom: 4 }}>Your Complaint</p>
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {selectedGrievance.description}
              </p>
            </div>

            <div className="p-4" style={{ borderBottom: '1px solid var(--line)' }}>
              <p className="eyebrow" style={{ marginBottom: 10 }}>Communication Thread</p>
              <div className="space-y-3" style={{ maxHeight: 240, overflowY: 'auto' }}>
                {publicNotes(selectedGrievance).length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--ink-4)', textAlign: 'center', padding: '16px 0' }}>
                    No replies yet. The grievance team will respond shortly.
                  </p>
                ) : (
                  publicNotes(selectedGrievance).map(note => (
                    <div
                      key={note.id}
                      style={{
                        maxWidth: '85%',
                        marginLeft: note.authorRole === 'parent' ? 'auto' : 0,
                        padding: '10px 12px',
                        borderRadius: 12,
                        background: note.authorRole === 'parent' ? 'var(--ink)' : 'var(--cream-2)',
                        color: note.authorRole === 'parent' ? 'var(--cream)' : 'var(--ink)',
                      }}
                    >
                      <p style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, opacity: 0.7 }}>
                        {note.authorRole === 'parent' ? 'You' : note.authorName}
                      </p>
                      <p style={{ fontSize: 12, lineHeight: 1.5 }}>{note.content}</p>
                      <p style={{ fontSize: 10, opacity: 0.5, marginTop: 4, textAlign: 'right' }}>
                        {new Date(note.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {selectedGrievance.status !== 'closed' && (
              <div className="p-4">
                <textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Add more details or reply to the team..."
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 resize-none"
                  style={{ marginBottom: 8 }}
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleReply}
                    disabled={!replyText.trim() || submittingReply}
                    className="btn accent flex items-center gap-2"
                    style={{ padding: '8px 16px', fontSize: 13 }}
                  >
                    <Send className="w-3.5 h-3.5" />
                    {submittingReply ? 'Sending...' : 'Send Reply'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
