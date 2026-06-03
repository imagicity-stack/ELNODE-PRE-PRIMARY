import { UserProfile, Student, Homework } from '../../types';
import { fmtDate } from '../../lib/utils';
import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { Spinner } from '../../components/ui';

interface ParentHomeworkProps {
  user: UserProfile;
  selectedStudent: Student | null;
}

export default function ParentHomework({ user: _user, selectedStudent }: ParentHomeworkProps) {
  const [homework, setHomework] = useState<Homework[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'done'>('all');

  useEffect(() => {
    const fetchHomework = async () => {
      if (!selectedStudent?.classId) return;
      setLoading(true);
      try {
        const q = query(
          collection(db, 'homework'),
          where('classId', '==', selectedStudent.classId),
          orderBy('dueDate', 'desc')
        );
        const snap = await getDocs(q).catch(err => { handleFirestoreError(err, OperationType.LIST, 'homework'); throw err; });
        setHomework(snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as Homework)));
      } catch (err) {
        console.error('Error fetching parent homework data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchHomework();
  }, [selectedStudent?.classId]);

  if (!selectedStudent) return null;

  const isSubmitted = (hw: Homework) =>
    hw.submissions?.some(s => s.studentId === selectedStudent.id);

  const isOverdue = (hw: Homework) => {
    const due = hw.dueDate ? new Date(hw.dueDate) : null;
    return due && due < new Date() && !isSubmitted(hw);
  };

  const submittedCount = homework.filter(isSubmitted).length;
  const pendingCount = homework.length - submittedCount;
  const completion = homework.length > 0 ? Math.round((submittedCount / homework.length) * 100) : 0;

  const filtered = homework.filter(hw => {
    const submitted = isSubmitted(hw);
    if (statusFilter === 'pending') return !submitted;
    if (statusFilter === 'done') return submitted;
    return true;
  });

  const filterOptions: { id: 'all' | 'pending' | 'done'; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: homework.length },
    { id: 'pending', label: 'Pending', count: pendingCount },
    { id: 'done', label: 'Done', count: submittedCount },
  ];

  return (
    <div>
      {/* Topbar */}
      <div className="topbar">
        <div>
          <div className="eyebrow">{selectedStudent.name}</div>
          <h1>Homework</h1>
        </div>
        {pendingCount > 0 && (
          <span
            className="chip solid"
            style={{ fontSize: 12, fontWeight: 700 }}
          >
            {pendingCount} pending
          </span>
        )}
      </div>

      <div className="pad" style={{ paddingTop: 12, paddingBottom: 32 }}>
        <div className="stack">

          {/* Progress overview card */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Overall Completion</span>
              <span className="t-num" style={{ fontSize: 22 }}>{completion}%</span>
            </div>
            <div className="bar">
              <i style={{ width: `${completion}%`, background: 'var(--leaf)' }} />
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
              <div>
                <div className="t-num" style={{ fontSize: 20 }}>{homework.length}</div>
                <div className="muted tiny">Total</div>
              </div>
              <div>
                <div className="t-num" style={{ fontSize: 20, color: 'var(--leaf)' }}>{submittedCount}</div>
                <div className="muted tiny">Done</div>
              </div>
              <div>
                <div className="t-num" style={{ fontSize: 20, color: 'var(--coral)' }}>{pendingCount}</div>
                <div className="muted tiny">Pending</div>
              </div>
            </div>
          </div>

          {/* Filter chips row */}
          <div className="hscroll" style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>
            {filterOptions.map(f => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                className={statusFilter === f.id ? 'chip solid' : 'chip'}
              >
                {f.label}
                <span
                  style={{
                    marginLeft: 4, fontSize: 11, fontWeight: 700,
                    opacity: statusFilter === f.id ? 1 : 0.6,
                  }}
                >
                  {f.count}
                </span>
              </button>
            ))}
          </div>

          {/* Homework list */}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
              <Spinner />
            </div>
          ) : filtered.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '40px 16px' }}>
              <div className="muted" style={{ fontSize: 14 }}>No assignments here.</div>
            </div>
          ) : (
            <div className="stack">
              {filtered.map((hw) => {
                const submitted = isSubmitted(hw);
                const overdue = isOverdue(hw);
                const submission = hw.submissions?.find(s => s.studentId === selectedStudent.id);

                let statusLabel = 'Pending';
                let statusColor = 'var(--ink-3)';
                let statusBg = 'var(--cream-2)';
                if (submitted) {
                  statusLabel = 'Submitted';
                  statusColor = 'var(--leaf)';
                  statusBg = '#eafaf0';
                } else if (overdue) {
                  statusLabel = 'Overdue';
                  statusColor = 'var(--coral)';
                  statusBg = '#fff0ee';
                }

                return (
                  <div key={hw.id} className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div className="eyebrow">{hw.subjectId}</div>
                      <span
                        className="chip"
                        style={{
                          fontSize: 11, fontWeight: 700,
                          color: statusColor, background: statusBg,
                          borderColor: 'transparent',
                        }}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.4, marginBottom: 6 }}>
                      {hw.content}
                    </div>
                    <div className="muted tiny" style={{ marginBottom: submitted ? 10 : 0 }}>
                      Due {fmtDate(hw.dueDate)}
                    </div>

                    {/* Progress bar — shows 100% if submitted else 0% */}
                    <div className="bar" style={{ marginTop: 8 }}>
                      <i
                        style={{
                          width: submitted ? '100%' : '0%',
                          background: submitted ? 'var(--leaf)' : overdue ? 'var(--coral)' : 'var(--ink)',
                        }}
                      />
                    </div>

                    {submitted && submission && (
                      <div
                        style={{
                          marginTop: 10, padding: '8px 12px',
                          background: '#eafaf0', borderRadius: 10,
                          border: '1px solid #c5efd4',
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--leaf)', marginBottom: 2 }}>
                          Submitted {new Date(submission.submittedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </div>
                        {submission.content && (
                          <div style={{ fontSize: 12, color: '#2a7a4b', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                            {submission.content}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
