import { UserProfile, Student, Attendance } from '../../types';
import { ClipboardCheck, Calendar, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { fmtDate } from '../../lib/utils';
import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { EmptyState } from '../../components/ui';

interface ParentAttendanceProps {
  user: UserProfile;
  selectedStudent: Student | null;
}

const statusInfo = (status: string) => {
  switch (status) {
    case 'present': return { label: 'Present', bg: '#d1fae5', color: '#065f46', dot: '#10b981' };
    case 'absent': return { label: 'Absent', bg: '#fee2e2', color: '#991b1b', dot: '#ef4444' };
    case 'late': return { label: 'Late', bg: '#fef3c7', color: '#92400e', dot: '#f59e0b' };
    case 'approved_leave': return { label: 'Approved Leave', bg: '#dbeafe', color: '#1e40af', dot: '#3b82f6' };
    case 'leave_pending': return { label: 'Leave Pending', bg: '#ede9fe', color: '#5b21b6', dot: '#8b5cf6' };
    case 'uninformed_absence': return { label: 'Uninformed', bg: '#fee2e2', color: '#991b1b', dot: '#ef4444' };
    default: return { label: status.replace(/_/g, ' '), bg: 'var(--cream-2)', color: 'var(--ink-2)', dot: 'var(--ink-4)' };
  }
};

// 24-col heatmap — one cell per record
function AttendanceHeatmap({ records }: { records: Attendance[] }) {
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return null;

  const cellColor = (status: string) => {
    switch (status) {
      case 'present': return '#10b981';
      case 'absent': return '#ef4444';
      case 'late': return '#f59e0b';
      case 'approved_leave': return '#3b82f6';
      default: return 'var(--cream-2)';
    }
  };

  const cols = 24;
  const rows = Math.ceil(sorted.length / cols);

  return (
    <div>
      <p className="eyebrow" style={{ marginBottom: 8 }}>Heatmap</p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 3,
        }}
      >
        {sorted.map((r, i) => (
          <div
            key={r.id}
            title={`${r.date}: ${r.status}`}
            style={{
              aspectRatio: '1',
              borderRadius: 3,
              background: cellColor(r.status),
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-3" style={{ marginTop: 8 }}>
        {[
          { label: 'Present', color: '#10b981' },
          { label: 'Absent', color: '#ef4444' },
          { label: 'Late', color: '#f59e0b' },
          { label: 'Leave', color: '#3b82f6' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div style={{ width: 8, height: 8, borderRadius: 2, background: l.color }} />
            <span className="tiny muted">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ParentAttendance({ user, selectedStudent }: ParentAttendanceProps) {
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAttendance = async () => {
      if (!selectedStudent?.id) return;
      setLoading(true);
      try {
        const q = query(
          collection(db, 'attendance'),
          where('studentId', '==', selectedStudent.id),
          orderBy('date', 'desc')
        );
        const snap = await getDocs(q).catch(err => { handleFirestoreError(err, OperationType.LIST, 'attendance'); throw err; });
        setAttendance(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Attendance)));
      } catch (err) {
        console.error('Error fetching parent attendance data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAttendance();
  }, [selectedStudent?.id]);

  if (!selectedStudent) return null;

  const totalDays = attendance.length;
  const presentDays = attendance.filter(a => a.status === 'present').length;
  const absentDays = attendance.filter(a => a.status === 'absent').length;
  const lateDays = attendance.filter(a => a.status === 'late').length;
  const attendancePct = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;
  const attColor = attendancePct >= 75 ? 'var(--leaf)' : attendancePct >= 60 ? '#f59e0b' : 'var(--coral)';

  return (
    <div className="pad stack" style={{ '--stack-gap': '20px' } as React.CSSProperties}>
      {/* Topbar */}
      <div className="topbar">
        <div>
          <p className="eyebrow">{selectedStudent.name}</p>
          <h1 className="display" style={{ fontSize: 22 }}>Attendance</h1>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--ink)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <>
          {/* Big stat cards */}
          <div className="grid grid-cols-2 gap-3" style={{ gap: 12 }}>
            <div className="card" style={{ textAlign: 'center', padding: '16px 12px' }}>
              <p className="t-num display" style={{ fontSize: 40, lineHeight: 1, color: attColor }}>{attendancePct}%</p>
              <p className="eyebrow" style={{ marginTop: 4 }}>Overall</p>
            </div>
            <div className="stack" style={{ '--stack-gap': '8px', display: 'flex', flexDirection: 'column' } as React.CSSProperties}>
              <div className="card" style={{ flex: 1, textAlign: 'center', padding: '10px 8px' }}>
                <p className="t-num" style={{ fontSize: 22, fontWeight: 800, color: '#10b981' }}>{presentDays}</p>
                <p className="eyebrow">Present</p>
              </div>
              <div className="card" style={{ flex: 1, textAlign: 'center', padding: '10px 8px' }}>
                <p className="t-num" style={{ fontSize: 22, fontWeight: 800, color: 'var(--coral)' }}>{absentDays}</p>
                <p className="eyebrow">Absent</p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
              <p className="eyebrow">Overall Progress</p>
              <span style={{ fontSize: 11, fontWeight: 700, color: attColor }}>{presentDays}/{totalDays}</span>
            </div>
            <div className="bar" style={{ height: 8, borderRadius: 4, background: 'var(--cream-2)' }}>
              <i style={{ width: `${attendancePct}%`, background: attColor, borderRadius: 4, display: 'block', height: '100%' }} />
            </div>
            <div className="flex items-center justify-between" style={{ marginTop: 10 }}>
              {[
                { label: 'Total', val: totalDays, color: 'var(--ink)' },
                { label: 'Late', val: lateDays, color: '#f59e0b' },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="tiny muted">{s.label}:</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{s.val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Heatmap */}
          {attendance.length > 0 && (
            <div className="card">
              <AttendanceHeatmap records={attendance} />
            </div>
          )}

          {/* Records list */}
          {attendance.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No attendance records"
              description="Attendance records will appear here once they are marked by the teacher."
            />
          ) : (
            <div>
              <p className="eyebrow" style={{ marginBottom: 10 }}>All Records</p>
              <div className="stack" style={{ '--stack-gap': '8px' } as React.CSSProperties}>
                {attendance.map(record => {
                  const info = statusInfo(record.status);
                  return (
                    <div key={record.id} className="card flex items-center gap-3" style={{ padding: '12px 16px' }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: info.dot, flexShrink: 0 }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5" style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{fmtDate(record.date)}</span>
                        </div>
                        {record.remarks && (
                          <p className="tiny muted" style={{ marginTop: 2 }}>{record.remarks}</p>
                        )}
                      </div>
                      <span
                        className="chip"
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '3px 10px',
                          borderRadius: 99,
                          background: info.bg,
                          color: info.color,
                          flexShrink: 0,
                          textTransform: 'capitalize',
                        }}
                      >
                        {info.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
