import { useState, useEffect } from 'react';
import { ClipboardCheck, ChevronRight, Info } from 'lucide-react';
import { collection, query, getDocs, where, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { StudentLeaveRequest, UserProfile, LeaveStatus } from '../../types';
import { Modal, Button, Badge } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { format } from 'date-fns';

const statusMeta = (status: LeaveStatus): { label: string; color: string; chip: React.CSSProperties } => {
  switch (status) {
    case 'approved': return { label: 'Approved', color: 'var(--leaf)', chip: {} };
    case 'rejected': return { label: 'Rejected', color: 'var(--coral)', chip: { background: 'var(--coral)', color: '#fff', borderColor: 'transparent' } };
    case 'document_required': return { label: 'Docs needed', color: 'var(--sky)', chip: {} };
    default: return { label: 'Pending', color: 'var(--accent)', chip: { background: 'var(--accent)', color: 'var(--accent-ink)', borderColor: 'transparent' } };
  }
};

export default function StudentLeaves({ user }: { user: UserProfile }) {
  const [leaves, setLeaves] = useState<StudentLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingLeave, setViewingLeave] = useState<StudentLeaveRequest | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    if (user.studentId) fetchStudentLeaves();
  }, [user.studentId]);

  const fetchStudentLeaves = async () => {
    try {
      setLoading(true);
      const q = query(collection(db, 'studentLeaves'), where('studentId', '==', user.studentId), orderBy('submittedAt', 'desc'));
      const snap = await getDocs(q);
      setLeaves(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as StudentLeaveRequest)));
    } catch (error) {
      console.error('Error fetching student leaves:', error);
      showToast('Failed to fetch leave history', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: LeaveStatus) => {
    switch (status) {
      case 'submitted':
      case 'pending': return <Badge variant="warning">Submitted</Badge>;
      case 'approved': return <Badge variant="success">Approved</Badge>;
      case 'rejected': return <Badge variant="error">Rejected</Badge>;
      case 'document_required': return <Badge variant="info">Docs Requested</Badge>;
      default: return <Badge variant="default">{status}</Badge>;
    }
  };

  const approvedLeaves = leaves.filter(l => l.status === 'approved');
  const totalApprovedDays = approvedLeaves.reduce((sum, l) => sum + l.totalDays, 0);
  const pendingCount = leaves.filter(l => l.status === 'submitted' || l.status === 'pending').length;

  return (
    <div className="pb-2">
      <div className="topbar">
        <div>
          <div className="eyebrow">{pendingCount} pending · {totalApprovedDays} days approved</div>
          <h1>Leaves</h1>
        </div>
      </div>

      <div className="pad" style={{ marginTop: 6 }}>
        <div className="card flex" style={{ gap: 10, alignItems: 'flex-start', background: 'var(--cream-2)', border: 0 }}>
          <Info size={16} style={{ color: 'var(--ink-3)', flexShrink: 0, marginTop: 1 }} />
          <div className="small ink2">Student view is read-only. For leave applications, ask your parent to use the Parent Portal.</div>
        </div>
      </div>

      <div className="section-head"><h2>Applications</h2></div>
      <div className="pad stack">
        {loading ? (
          <div className="card muted small" style={{ textAlign: 'center', padding: 24 }}>Loading…</div>
        ) : leaves.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 28 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--cream-2)', display: 'grid', placeItems: 'center', margin: '0 auto 10px' }}>
              <ClipboardCheck size={22} className="muted" />
            </div>
            <div className="bold">No leave records</div>
          </div>
        ) : (
          leaves.map((leave) => {
            const meta = statusMeta(leave.status);
            return (
              <button key={leave.id} className="card" style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }} onClick={() => setViewingLeave(leave)}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: meta.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, textTransform: 'capitalize' }}>{leave.leaveType.replace(/_/g, ' ')}</div>
                  <div className="small muted" style={{ marginTop: 2 }}>
                    {format(new Date(leave.startDate), 'd MMM')} – {format(new Date(leave.endDate), 'd MMM yyyy')} · {leave.totalDays} {leave.totalDays === 1 ? 'day' : 'days'}
                  </div>
                </div>
                <span className="chip" style={{ ...meta.chip, fontSize: 10, padding: '3px 9px' }}>{meta.label}</span>
                <ChevronRight size={16} className="muted" />
              </button>
            );
          })
        )}
      </div>

      <div style={{ height: 16 }} />

      <Modal isOpen={!!viewingLeave} onClose={() => setViewingLeave(null)} title="Leave Review" subtitle={viewingLeave?.studentName} size="sm">
        {viewingLeave && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
              <div>
                <p className="text-[9px] text-slate-400 font-bold uppercase">Status</p>
                {getStatusBadge(viewingLeave.status)}
              </div>
              <div className="text-right">
                <p className="text-[9px] text-slate-400 font-bold uppercase">Processed At</p>
                <p className="text-xs font-bold text-slate-600">{viewingLeave.processedAt ? format(new Date(viewingLeave.processedAt), 'do MMM') : '-'}</p>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] text-slate-400 font-bold uppercase">School Remarks</p>
              <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                {viewingLeave.adminRemarks ? (
                  <p className="text-xs text-indigo-900 font-bold leading-relaxed">{viewingLeave.adminRemarks}</p>
                ) : (
                  <p className="text-xs text-slate-400 italic">No remarks from the school yet.</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 border border-slate-100 rounded-xl">
                <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Start Date</p>
                <p className="text-sm font-bold text-slate-900">{format(new Date(viewingLeave.startDate), 'do MMM')}</p>
              </div>
              <div className="p-3 border border-slate-100 rounded-xl">
                <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">End Date</p>
                <p className="text-sm font-bold text-slate-900">{format(new Date(viewingLeave.endDate), 'do MMM')}</p>
              </div>
            </div>
            <Button variant="secondary" className="w-full" onClick={() => setViewingLeave(null)}>Close</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
