import React, { useState, useEffect } from 'react';
import {
  ClipboardCheck,
  Search,
  Calendar,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  FileText,
  Eye,
  MessageSquare,
} from 'lucide-react';
import {
  collection,
  query,
  getDocs,
  updateDoc,
  doc,
  where,
  orderBy,
  getDoc,
  writeBatch,
  QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { StudentLeaveRequest, UserProfile, LeaveStatus } from '../../types';
import {
  Button,
  Badge,
  Modal,
  FormField,
  Textarea,
} from '../../components/ui';
import { useToast } from '../../components/Toast';
import { format } from 'date-fns';
import { fmtDate } from '../../lib/utils';
import { openExternalUrl } from '../../lib/download';
import { usePermissions } from '../../hooks/usePermissions';
import { logActivity } from '../../services/activityService';
import { useData } from '../../contexts/DataContext';

export default function LeaveManagement({ user }: { user: UserProfile }) {
  const { classesMap } = useData();
  const [leaves, setLeaves] = useState<StudentLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<LeaveStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLeave, setSelectedLeave] = useState<StudentLeaveRequest | null>(null);
  const [remarks, setRemarks] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [processModalOpen, setProcessModalOpen] = useState(false);
  const { showToast } = useToast();

  const { isReadOnly } = usePermissions(user.role);
  const readOnly = isReadOnly('leaves');

  useEffect(() => {
    fetchLeaves();
  }, []);

  const fetchLeaves = async () => {
    try {
      setLoading(true);
      const leaveRef = collection(db, 'studentLeaves');
      const q = query(leaveRef, orderBy('submittedAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const leaveList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StudentLeaveRequest));
      setLeaves(leaveList);
    } catch (error) {
      console.error('Error fetching leaves:', error);
      showToast('Failed to fetch leave requests', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleProcessLeave = async (status: LeaveStatus) => {
    if (!selectedLeave) return;

    try {
      setIsProcessing(true);
      const leaveDocRef = doc(db, 'studentLeaves', selectedLeave.id);

      const updateData: any = {
        status,
        adminRemarks: remarks,
        updatedAt: new Date().toISOString(),
        processedBy: user.uid,
        processedAt: new Date().toISOString(),
      };

      if (status === 'approved' || status === 'regularized') {
        updateData.attendanceConnectionStatus = 'pending';
      } else if (status === 'rejected' && (selectedLeave.status === 'approved' || selectedLeave.status === 'regularized')) {
        updateData.attendanceConnectionStatus = 'pending';
      }

      await updateDoc(leaveDocRef, updateData);

      let syncedCount = 0;
      if (status === 'approved' || status === 'regularized') {
        syncedCount = await syncAttendanceWithLeave(selectedLeave, status);
      } else if (status === 'rejected' && (selectedLeave.status === 'approved' || selectedLeave.status === 'regularized')) {
        await clearAttendanceForLeave(selectedLeave);
      }

      // Log Activity
      await logActivity(
        user,
        'Leave Request Status Updated',
        'Principal',
        `${status.charAt(0).toUpperCase() + status.slice(1)} leave for ${selectedLeave.studentName}`,
        {
          studentId: selectedLeave.studentId,
          status,
          leaveId: selectedLeave.id,
        }
      );

      // WhatsApp notification to parent on approval / rejection
      if (status === 'approved' || status === 'rejected') {
        try {
          const studentSnap = await getDoc(doc(db, 'students', selectedLeave.studentId));
          const phone = studentSnap.exists() ? studentSnap.data()?.parentDetails?.phone : null;
          if (phone) {
            await fetch('/api/whatsapp/send-template', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phone,
                templateName: 'leave_status_update',
                parameters: [
                  studentSnap.data()?.parentDetails?.fatherName || 'Parent',
                  selectedLeave.studentName,
                  selectedLeave.leaveType.replace('_', ' '),
                  `${fmtDate(selectedLeave.startDate)} to ${fmtDate(selectedLeave.endDate)}`,
                  status === 'approved' ? 'Approved ✅' : 'Rejected ❌',
                  remarks || 'No remarks',
                ],
              }),
            });
          }
        } catch { /* non-fatal — leave processing already succeeded */ }
      }

      // Toast — surface sync count so admin knows if attendance was actually updated
      if (status === 'approved' || status === 'regularized') {
        if (syncedCount === 0) {
          showToast(`Leave ${status} — no attendance records found for this period yet. They will sync when teacher marks attendance.`, 'success');
        } else {
          showToast(`Leave ${status} — ${syncedCount} attendance record(s) updated`, 'success');
        }
      } else {
        showToast(`Leave request ${status} successfully`, 'success');
      }

      setProcessModalOpen(false);
      setRemarks('');
      setSelectedLeave(null);
      fetchLeaves();
    } catch (error) {
      console.error('Error processing leave:', error);
      showToast('Failed to process leave request', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const syncAttendanceWithLeave = async (leave: StudentLeaveRequest, status: LeaveStatus): Promise<number> => {
    const leaveDocRef = doc(db, 'studentLeaves', leave.id);
    try {
      const batch = writeBatch(db);
      const q = query(
        collection(db, 'attendance'),
        where('studentId', '==', leave.studentId),
        where('date', '>=', leave.startDate),
        where('date', '<=', leave.endDate)
      );
      const snap = await getDocs(q);
      const targetStatus = status === 'regularized' ? 'regularized' : 'approved_leave';
      snap.docs.forEach((d: QueryDocumentSnapshot) => {
        batch.update(d.ref, {
          status: targetStatus,
          remarks: `Leave ${status}: ${leave.reasonCategory}`,
        });
      });
      await batch.commit();
      await updateDoc(leaveDocRef, { attendanceConnectionStatus: 'connected' });
      return snap.docs.length;
    } catch (error) {
      console.error('Error syncing attendance:', error);
      try { await updateDoc(leaveDocRef, { attendanceConnectionStatus: 'failed' }); } catch {}
      return 0;
    }
  };

  const clearAttendanceForLeave = async (leave: StudentLeaveRequest) => {
    try {
      const batch = writeBatch(db);
      const q = query(
        collection(db, 'attendance'),
        where('studentId', '==', leave.studentId),
        where('date', '>=', leave.startDate),
        where('date', '<=', leave.endDate)
      );
      const snap = await getDocs(q);
      snap.docs.forEach((d: QueryDocumentSnapshot) => {
        if (['approved_leave', 'regularized'].includes(d.data().status)) {
          batch.update(d.ref, { status: 'absent', remarks: 'Leave rejected by admin' });
        }
      });
      await batch.commit();
    } catch (error) {
      console.error('Error clearing attendance for rejected leave:', error);
    }
  };

  const filteredLeaves = leaves.filter(leave => {
    const matchesStatus = filterStatus === 'all' || leave.status === filterStatus;
    const matchesSearch = leave.studentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         leave.reason.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const pendingCount = leaves.filter(l => l.status === 'submitted' || l.status === 'pending').length;

  const statusDot = (status: LeaveStatus) => {
    const colors: Record<string, string> = {
      submitted: 'var(--coral)',
      pending: 'var(--coral)',
      approved: 'var(--leaf)',
      rejected: '#ef4444',
      document_required: 'var(--accent)',
      regularized: '#7c3aed',
      cancelled: 'var(--ink)',
    };
    return (
      <span style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: colors[status] || 'var(--ink)',
        flexShrink: 0,
      }} />
    );
  };

  const statusLabel = (status: LeaveStatus) => {
    const labels: Record<string, string> = {
      submitted: 'Pending',
      pending: 'Pending',
      approved: 'Approved',
      rejected: 'Rejected',
      document_required: 'Doc Required',
      regularized: 'Regularized',
      cancelled: 'Cancelled',
    };
    return labels[status] || status;
  };

  const chipFilters: { key: string; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: `Pending${pendingCount > 0 ? ` (${pendingCount})` : ''}` },
    { key: 'approved', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'document_required', label: 'Doc Required' },
  ];

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">{pendingCount} pending</div>
          <h1>Leaves</h1>
        </div>
      </div>

      <div className="pad stack">
        {/* Search + Filters */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="card flex" style={{ gap: 10, padding: '10px 14px', alignItems: 'center', flex: 1, minWidth: 200 }}>
            <Search size={16} className="muted" style={{ flexShrink: 0 }} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search student or reason..."
              style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, fontSize: 14, fontFamily: 'var(--body)', color: 'var(--ink)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {chipFilters.map(f => (
              <button
                key={f.key}
                className={filterStatus === f.key || (f.key === 'pending' && (filterStatus === 'submitted' || filterStatus === 'pending')) ? 'chip solid' : 'chip'}
                onClick={() => setFilterStatus(f.key as any)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Leave Cards */}
        {loading ? (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <p className="muted">Loading...</p>
          </div>
        ) : filteredLeaves.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <ClipboardCheck size={36} className="muted" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontWeight: 700, marginBottom: 4 }}>No leave requests</p>
            <p className="muted tiny">No results for the current filter.</p>
          </div>
        ) : (
          <div className="stack">
            {filteredLeaves.map(leave => (
              <div key={leave.id} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  {/* Avatar */}
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: 'var(--cream-2)', border: '1px solid var(--line)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 15, flexShrink: 0, color: 'var(--ink)',
                  }}>
                    {leave.studentName.charAt(0).toUpperCase()}
                  </div>

                  {/* Main info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <p style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>{leave.studentName}</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {statusDot(leave.status)}
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{statusLabel(leave.status)}</span>
                        {leave.isEmergency && (
                          <span className="chip solid" style={{ background: '#ef4444', color: '#fff', fontSize: 10, padding: '2px 7px' }}>EMERGENCY</span>
                        )}
                      </div>
                    </div>

                    <div className="eyebrow" style={{ marginTop: 2, marginBottom: 6 }}>
                      {classesMap[leave.classId] || leave.classId}{leave.section ? ` · ${leave.section}` : ''}
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                      <span className="chip" style={{ fontSize: 11, textTransform: 'capitalize' }}>
                        {leave.leaveType.replace('_', ' ')}
                      </span>
                      {leave.reasonCategory && (
                        <span className="chip" style={{ fontSize: 11 }}>{leave.reasonCategory}</span>
                      )}
                      <span className="chip" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Calendar size={10} />
                        {fmtDate(leave.startDate)}{leave.endDate !== leave.startDate ? ` — ${fmtDate(leave.endDate)}` : ''}
                        {' · '}{leave.totalDays}d
                      </span>
                    </div>

                    {leave.reason && (
                      <p className="muted" style={{ fontSize: 13, margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {leave.reason}
                      </p>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <button
                        className="btn ghost"
                        style={{ fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 5 }}
                        onClick={() => { setSelectedLeave(leave); setViewModalOpen(true); }}
                      >
                        <Eye size={13} /> View
                      </button>
                      {!readOnly && (leave.status === 'submitted' || leave.status === 'pending' || leave.status === 'document_required') && (
                        <>
                          <button
                            className="btn accent"
                            style={{ fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 5, background: 'var(--leaf)' }}
                            onClick={() => { setSelectedLeave(leave); setRemarks(''); setProcessModalOpen(true); }}
                          >
                            <CheckCircle2 size={13} /> Approve
                          </button>
                          <button
                            className="btn ghost"
                            style={{ fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 5, color: '#ef4444', borderColor: '#fca5a5' }}
                            onClick={() => { setSelectedLeave(leave); setRemarks(''); setProcessModalOpen(true); }}
                          >
                            <XCircle size={13} /> Reject
                          </button>
                          <button
                            className="btn ghost"
                            style={{ fontSize: 12, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 5 }}
                            onClick={() => { setSelectedLeave(leave); setRemarks(''); setProcessModalOpen(true); }}
                          >
                            <FileText size={13} /> Request Docs
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* View Details Modal */}
      <Modal
        isOpen={viewModalOpen}
        onClose={() => setViewModalOpen(false)}
        title="Leave Request Details"
        subtitle={`Student: ${selectedLeave?.studentName}`}
        size="md"
      >
        {selectedLeave && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div className="p-4 bg-slate-50 border-none shadow-none rounded-xl">
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Leave Duration</p>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-100 rounded-lg">
                    <Calendar className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 leading-none">
                      {format(new Date(selectedLeave.startDate), 'dd MMM')} - {format(new Date(selectedLeave.endDate), 'dd MMM')}
                    </h4>
                    <p className="text-[10px] text-slate-500 font-bold mt-1 uppercase">
                      {selectedLeave.totalDays} Total Days
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-slate-50 border-none shadow-none rounded-xl">
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Leave Category</p>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <FileText className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 leading-none capitalize">
                      {selectedLeave.leaveType.replace('_', ' ')}
                    </h4>
                    <p className="text-[10px] text-slate-500 font-bold mt-1 uppercase">
                      {selectedLeave.reasonCategory}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-slate-400" />
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Detailed Reason</h4>
              </div>
              <div className="p-4 bg-white border border-slate-200 rounded-xl">
                <p className="text-sm text-slate-600 leading-relaxed italic">
                  "{selectedLeave.reason}"
                </p>
              </div>
            </div>

            {selectedLeave.documentUrl && (
              <div className="p-4 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-100 rounded-lg">
                    <FileText className="w-5 h-5 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900">Supporting Document</p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase">Medical Cert / Application</p>
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => openExternalUrl(selectedLeave.documentUrl)}>
                  <Eye className="w-3 h-3 mr-1" /> View Document
                </Button>
              </div>
            )}

            {selectedLeave.adminRemarks && (
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Admin Remarks</h4>
                <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
                  <p className="text-sm text-indigo-900 font-medium">{selectedLeave.adminRemarks}</p>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="secondary" onClick={() => setViewModalOpen(false)}>Close</Button>
              {!readOnly && (selectedLeave.status === 'submitted' || selectedLeave.status === 'pending') && (
                <Button variant="primary" onClick={() => {
                  setViewModalOpen(false);
                  setProcessModalOpen(true);
                }}>Process Leave</Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Process Modal */}
      <Modal
        isOpen={processModalOpen}
        onClose={() => setProcessModalOpen(false)}
        title="Process Leave Request"
        subtitle={`Update status for ${selectedLeave?.studentName}`}
        size="sm"
      >
        <div className="space-y-4">
          <FormField label="Admin Remarks" hint="Provide feedback for the parent">
            <Textarea
              placeholder="e.g. Approved as per medical records, or Please upload doctor's note"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={4}
            />
          </FormField>

          <div className="flex flex-col gap-2 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="primary"
                loading={isProcessing}
                onClick={() => handleProcessLeave('approved')}
                className="bg-emerald-600 hover:bg-emerald-700 h-10 font-bold uppercase tracking-wider"
              >
                Approve
              </Button>
              <Button
                variant="danger"
                loading={isProcessing}
                onClick={() => handleProcessLeave('rejected')}
                className="h-10 font-bold uppercase tracking-wider"
              >
                Reject
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                loading={isProcessing}
                onClick={() => handleProcessLeave('document_required')}
                className="h-10 font-bold uppercase tracking-wider"
                icon={FileText}
              >
                Request Doc
              </Button>
              <Button
                variant="secondary"
                loading={isProcessing}
                onClick={() => handleProcessLeave('regularized')}
                className="h-10 font-bold uppercase tracking-wider border-violet-200 text-violet-700 hover:bg-violet-50"
              >
                Regularize
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
