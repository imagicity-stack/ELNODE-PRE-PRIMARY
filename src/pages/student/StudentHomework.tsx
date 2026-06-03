import { UserProfile, Homework } from '../../types';
import { fmtDate } from '../../lib/utils';
import { openExternalUrl } from '../../lib/download';
import { CheckSquare, Download, Upload } from 'lucide-react';
import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy, updateDoc, doc, arrayUnion } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useToast } from '../../components/Toast';
import { logActivity } from '../../services/activityService';
import { Button, Modal, FormField, Textarea } from '../../components/ui';

interface StudentHomeworkProps {
  user: UserProfile;
}

export default function StudentHomework({ user }: StudentHomeworkProps) {
  const [homework, setHomework] = useState<Homework[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedHw, setSelectedHw] = useState<Homework | null>(null);
  const [submitText, setSubmitText] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');
  const { showToast } = useToast();

  useEffect(() => {
    const fetchHomework = async () => {
      if (!user.classId) return;
      setLoading(true);
      try {
        const q = query(
          collection(db, 'homework'),
          where('classId', '==', user.classId),
          orderBy('dueDate', 'desc')
        );
        const snap = await getDocs(q).catch(err => { handleFirestoreError(err, OperationType.LIST, 'homework'); throw err; });
        setHomework(snap.docs.map(d => ({ id: d.id, ...d.data() } as Homework)));
      } catch (err) {
        console.error('Error fetching homework:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchHomework();
  }, [user.classId]);

  const isSubmitted = (hw: Homework) => hw.submissions?.some(s => s.studentId === user.studentId);

  const handleDownload = async (hw: Homework) => {
    if (hw.attachmentUrl) await openExternalUrl(hw.attachmentUrl);
    else showToast('No attachment available for this assignment.', 'info');
  };

  const handleSubmit = async () => {
    if (!selectedHw || !submitText.trim()) { showToast('Please write your submission before submitting.', 'error'); return; }
    if (!user.studentId) { showToast('Student ID not found. Please contact admin.', 'error'); return; }
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'homework', selectedHw.id), {
        submissions: arrayUnion({ studentId: user.studentId, content: submitText.trim(), submittedAt: new Date().toISOString() }),
      });
      logActivity(user, 'Homework Submitted', 'Students', `Submitted homework for ${selectedHw.subjectId}`, { homeworkId: selectedHw.id, subject: selectedHw.subjectId });
      showToast('Homework submitted successfully!', 'success');
      setHomework(prev => prev.map(hw =>
        hw.id === selectedHw.id
          ? { ...hw, submissions: [...(hw.submissions || []), { studentId: user.studentId!, content: submitText.trim(), submittedAt: new Date().toISOString() }] }
          : hw
      ));
      setSelectedHw(null);
      setSubmitText('');
    } catch (err) {
      showToast('Failed to submit homework. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const pendingCount = homework.filter(hw => !isSubmitted(hw)).length;
  const visible = homework.filter(hw => {
    if (filter === 'pending') return !isSubmitted(hw);
    if (filter === 'done') return isSubmitted(hw);
    return true;
  });

  const isOverdue = (hw: Homework) => !isSubmitted(hw) && hw.dueDate && new Date(hw.dueDate) < new Date();

  return (
    <div className="pb-2">
      <div className="topbar">
        <div>
          <div className="eyebrow">{pendingCount} pending</div>
          <h1>Homework</h1>
        </div>
      </div>

      {/* Filter chips */}
      <div className="hscroll" style={{ paddingTop: 4 }}>
        {([['all', 'All'], ['pending', 'Pending'], ['done', 'Done']] as const).map(([k, label]) => (
          <button key={k} className={'chip' + (filter === k ? ' solid' : '')} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      <div className="pad stack" style={{ marginTop: 14 }}>
        {loading ? (
          <div className="card muted small" style={{ textAlign: 'center', padding: 24 }}>Loading…</div>
        ) : visible.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 28 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--cream-2)', display: 'grid', placeItems: 'center', margin: '0 auto 10px' }}>
              <CheckSquare size={22} className="muted" />
            </div>
            <div className="bold">Nothing here</div>
            <div className="small muted" style={{ marginTop: 2 }}>No assignments match this filter.</div>
          </div>
        ) : (
          visible.map((hw) => {
            const submitted = isSubmitted(hw);
            const overdue = isOverdue(hw);
            return (
              <div key={hw.id} className="card" style={{ padding: 16, position: 'relative' }}>
                {overdue && (
                  <span style={{ position: 'absolute', top: 12, right: 12, background: 'var(--coral)', color: '#fff', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em' }}>DUE</span>
                )}
                <div className="eyebrow">{hw.subjectId} · Due {fmtDate(hw.dueDate)}</div>
                <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 17, marginTop: 6, letterSpacing: '-0.01em', textDecoration: submitted ? 'line-through' : 'none', textDecorationColor: 'var(--ink-3)' }}>
                  {hw.content}
                </div>

                <div className="flex between center" style={{ marginTop: 12, gap: 12 }}>
                  <div className="bar" style={{ flex: 1 }}>
                    <i style={{ width: submitted ? '100%' : '8%', background: submitted ? 'var(--leaf)' : overdue ? 'var(--coral)' : 'var(--ink)' }} />
                  </div>
                  <span className="mono tiny" style={{ color: submitted ? 'var(--leaf)' : 'var(--ink-3)', textTransform: 'uppercase' }}>
                    {submitted ? 'Submitted' : 'Pending'}
                  </span>
                </div>

                <div className="flex gap-8" style={{ marginTop: 14 }}>
                  <button
                    onClick={() => handleDownload(hw)}
                    disabled={!hw.attachmentUrl}
                    className="btn ghost"
                    style={{ flex: 1, padding: '10px 12px', fontSize: 13, opacity: hw.attachmentUrl ? 1 : 0.4 }}
                  >
                    <Download size={15} /> Download
                  </button>
                  {!submitted && (
                    <button
                      onClick={() => { setSelectedHw(hw); setSubmitText(''); }}
                      className="btn accent"
                      style={{ flex: 1, padding: '10px 12px', fontSize: 13 }}
                    >
                      <Upload size={15} /> Submit
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ height: 16 }} />

      {/* Submit modal (legacy UI component, functional) */}
      <Modal
        isOpen={!!selectedHw}
        onClose={() => setSelectedHw(null)}
        title={`Submit: ${selectedHw?.subjectId} Assignment`}
        size="md"
        footer={
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setSelectedHw(null)}>Cancel</Button>
            <Button variant="primary" icon={Upload} loading={submitting} onClick={handleSubmit}>Submit Homework</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="p-3 bg-slate-50 rounded-xl text-sm text-slate-600">
            <strong>Assignment:</strong> {selectedHw?.content}
          </div>
          <FormField label="Your Submission" required>
            <Textarea rows={5} value={submitText} onChange={e => setSubmitText(e.target.value)} placeholder="Write your answer or describe what you've done..." />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}
