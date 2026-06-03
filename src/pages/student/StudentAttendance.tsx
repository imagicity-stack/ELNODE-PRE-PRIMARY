import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { UserProfile, Attendance } from '../../types';
import { fmtDate } from '../../lib/utils';
import { ClipboardCheck } from 'lucide-react';

interface StudentAttendanceProps {
  user: UserProfile;
}

// Maps an attendance status to a swatch colour in the design palette.
const statusColor = (status: string): string => {
  switch (status) {
    case 'present': return 'var(--ink)';
    case 'late': return 'var(--accent)';
    case 'approved_leave': return 'var(--sky)';
    case 'leave_pending': return 'var(--ink-4)';
    default: return 'var(--coral)'; // absent / uninformed
  }
};

const statusLabel = (status: string): string => {
  switch (status) {
    case 'present': return 'Present';
    case 'absent': return 'Absent';
    case 'late': return 'Late';
    case 'approved_leave': return 'Excused';
    case 'leave_pending': return 'Pending';
    case 'uninformed_absence': return 'Absent';
    default: return status.replace(/_/g, ' ');
  }
};

export default function StudentAttendance({ user }: StudentAttendanceProps) {
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAttendance = async () => {
      const studentId = user.studentId || user.schoolNumber || user.uid;
      if (!studentId) return;
      setLoading(true);
      try {
        const q = query(
          collection(db, 'attendance'),
          where('studentId', '==', studentId),
          orderBy('date', 'desc')
        );
        const snap = await getDocs(q).catch(err => {
          handleFirestoreError(err, OperationType.LIST, 'attendance');
          throw err;
        });
        setAttendance(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Attendance)));
      } catch (err) {
        console.error('Error fetching attendance:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAttendance();
  }, [user.uid, user.studentId, user.schoolNumber]);

  const totalDays = attendance.length;
  const presentDays = attendance.filter(a => a.status === 'present').length;
  const absentDays = attendance.filter(a => a.status === 'absent' || a.status === 'uninformed_absence').length;
  const lateDays = attendance.filter(a => a.status === 'late').length;
  const pct = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;
  const pctColor = pct >= 75 ? 'var(--leaf)' : pct >= 60 ? 'var(--accent)' : 'var(--coral)';

  // chronological for the grid
  const grid = attendance.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  return (
    <div className="pb-2">
      <div className="topbar">
        <div>
          <div className="eyebrow">Attendance</div>
          <h1>This term.</h1>
        </div>
      </div>

      {/* Summary card */}
      <div className="pad" style={{ marginTop: 6 }}>
        <div className="card" style={{ padding: 20 }}>
          <div className="eyebrow">Days present</div>
          <div className="flex" style={{ alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <div className="t-num" style={{ fontSize: 52, lineHeight: 1 }}>
              {presentDays}<span style={{ color: 'var(--ink-3)' }}>/{totalDays || 0}</span>
            </div>
            <div className="display" style={{ fontSize: 22, color: pctColor }}>{pct}%</div>
          </div>

          {grid.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: 3, marginTop: 16 }}>
              {grid.map((a) => (
                <span key={a.id} title={`${fmtDate(a.date)} · ${statusLabel(a.status)}`} style={{
                  aspectRatio: '1 / 1', borderRadius: 2, background: statusColor(a.status),
                }} />
              ))}
            </div>
          ) : (
            <div className="small muted" style={{ marginTop: 14 }}>No records yet.</div>
          )}

          <div className="flex" style={{ gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
            <Legend swatch="var(--ink)" label={`Present ${presentDays}`} />
            <Legend swatch="var(--accent)" label={`Late ${lateDays}`} />
            <Legend swatch="var(--coral)" label={`Absent ${absentDays}`} />
          </div>
        </div>
      </div>

      {/* Records */}
      <div className="section-head">
        <h2>Records</h2>
        {totalDays > 0 && <span className="mono tiny muted">{totalDays} days</span>}
      </div>
      <div className="pad stack">
        {loading ? (
          <div className="card muted small" style={{ textAlign: 'center', padding: 24 }}>Loading…</div>
        ) : attendance.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 28 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--cream-2)', display: 'grid', placeItems: 'center', margin: '0 auto 10px' }}>
              <ClipboardCheck size={22} className="muted" />
            </div>
            <div className="bold">No attendance records</div>
            <div className="small muted" style={{ marginTop: 2 }}>They'll appear here once marked by your teacher.</div>
          </div>
        ) : (
          attendance.map((record) => {
            const isLate = record.status === 'late';
            const isAbsent = record.status === 'absent' || record.status === 'uninformed_absence';
            return (
              <div key={record.id} className="card" style={{ padding: '14px 16px' }}>
                <div className="flex between center">
                  <div className="flex center gap-12">
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: statusColor(record.status), display: 'inline-block' }} />
                    <div style={{ fontWeight: 600 }}>{fmtDate(record.date)}</div>
                  </div>
                  <span className="chip" style={
                    isLate
                      ? { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'transparent' }
                      : isAbsent
                        ? { background: 'var(--coral)', color: '#fff', borderColor: 'transparent' }
                        : {}
                  }>
                    {statusLabel(record.status)}
                  </span>
                </div>
                {record.remarks && <div className="small muted" style={{ marginTop: 6 }}>{record.remarks}</div>}
              </div>
            );
          })
        )}
      </div>

      <div style={{ height: 16 }} />
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <div className="flex center gap-8">
      <span style={{ width: 10, height: 10, borderRadius: 2, background: swatch, display: 'inline-block' }} />
      <span className="tiny muted">{label}</span>
    </div>
  );
}
