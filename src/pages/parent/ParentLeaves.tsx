import React, { useState, useEffect } from 'react';
import {
  ClipboardCheck,
  Calendar,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  FileText,
  Plus,
  ArrowRight,
  Info,
  ShieldCheck,
  ChevronRight,
  Eye,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  collection,
  query,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  where,
  orderBy,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebase';
import {
  StudentLeaveRequest,
  UserProfile,
  Student,
  LeaveType,
  LeaveReasonCategory,
  LeaveStatus,
} from '../../types';
import {
  Button,
  Input,
  Badge,
  Modal,
  FormField,
  Textarea,
} from '../../components/ui';
import { useToast } from '../../components/Toast';
import { format, differenceInDays } from 'date-fns';
import { logActivity } from '../../services/activityService';

const leaveTypes: { value: LeaveType; label: string; icon: any }[] = [
  { value: 'planned', label: 'Planned Leave', icon: Calendar },
  { value: 'medical', label: 'Medical Leave', icon: AlertCircle },
  { value: 'emergency', label: 'Emergency Leave', icon: Clock },
  { value: 'half_day', label: 'Half Day Leave', icon: ArrowRight },
  { value: 'regularization', label: 'Regularize Absence', icon: ShieldCheck },
];

const reasonCategories: LeaveReasonCategory[] = [
  'Medical', 'Family Function', 'Travel', 'Emergency', 'Religious Reason', 'Personal Reason', 'Exam-related', 'Other',
];

const statusChip = (status: LeaveStatus) => {
  switch (status) {
    case 'approved':
      return { bg: '#d1fae5', color: '#065f46', label: 'Approved' };
    case 'rejected':
      return { bg: '#fee2e2', color: '#991b1b', label: 'Rejected' };
    case 'document_required':
      return { bg: '#dbeafe', color: '#1e40af', label: 'Docs Needed' };
    case 'regularized':
      return { bg: '#ede9fe', color: '#5b21b6', label: 'Regularized' };
    case 'cancelled':
      return { bg: 'var(--cream-2)', color: 'var(--ink-3)', label: 'Cancelled' };
    default:
      return { bg: '#fef3c7', color: '#92400e', label: 'Pending' };
  }
};

const getStatusBadge = (status: LeaveStatus) => {
  switch (status) {
    case 'submitted':
    case 'pending':
      return <Badge variant="warning" className="flex items-center gap-1"><Clock className="w-3 h-3" /> Submitted</Badge>;
    case 'approved':
      return <Badge variant="success" className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Approved</Badge>;
    case 'rejected':
      return <Badge variant="error" className="flex items-center gap-1"><XCircle className="w-3 h-3" /> Rejected</Badge>;
    case 'document_required':
      return <Badge variant="info" className="flex items-center gap-1"><FileText className="w-3 h-3" /> Docs Needed</Badge>;
    case 'regularized':
      return <Badge className="flex items-center gap-1 bg-violet-100 text-violet-700"><CheckCircle2 className="w-3 h-3" /> Regularized</Badge>;
    case 'cancelled':
      return <Badge variant="default" className="flex items-center gap-1"><XCircle className="w-3 h-3" /> Cancelled</Badge>;
    default:
      return <Badge variant="default">{status}</Badge>;
  }
};

export default function ParentLeaves({ user, selectedStudent }: { user: UserProfile; selectedStudent: Student | null }) {
  const [leaves, setLeaves] = useState<StudentLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [viewingLeave, setViewingLeave] = useState<StudentLeaveRequest | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const [formData, setFormData] = useState({
    leaveType: 'planned' as LeaveType,
    reasonCategory: 'Personal Reason' as LeaveReasonCategory,
    startDate: '',
    endDate: '',
    reason: '',
    isEmergency: false,
    parentDeclaration: false,
  });

  const { showToast } = useToast();

  useEffect(() => {
    if (selectedStudent) {
      fetchStudentLeaves();
    }
  }, [selectedStudent]);

  const fetchStudentLeaves = async () => {
    if (!selectedStudent) return;
    try {
      setLoading(true);
      const leaveRef = collection(db, 'studentLeaves');
      const q = query(
        leaveRef,
        where('studentId', '==', selectedStudent.id),
        where('parentId', '==', user.uid),
        orderBy('submittedAt', 'desc')
      );
      const querySnapshot = await getDocs(q);
      const leaveList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StudentLeaveRequest));
      setLeaves(leaveList);
    } catch (error) {
      console.error('Error fetching parent leaves:', error);
      showToast('Failed to fetch leave history', 'error');
    } finally {
      setLoading(false);
    }
  };

  const calculateDays = () => {
    if (!formData.startDate || !formData.endDate) return 0;
    const start = new Date(formData.startDate);
    const end = new Date(formData.endDate);
    if (end < start) return 0;
    return differenceInDays(end, start) + 1;
  };

  const handleApplyLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent || !user) return;

    const days = calculateDays();
    if (days <= 0) {
      showToast('End date must be after start date', 'info');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const allowsPastDates = formData.leaveType === 'regularization' || formData.leaveType === 'emergency';
    if (formData.startDate < today && !allowsPastDates) {
      showToast('Start date cannot be in the past. Use "Regularize Absence" for past absences.', 'info');
      return;
    }

    if (formData.leaveType === 'planned') {
      const minDate = new Date();
      minDate.setDate(minDate.getDate() + 2);
      if (formData.startDate < minDate.toISOString().split('T')[0]) {
        showToast('Planned leave must be applied at least 2 days in advance.', 'info');
        return;
      }
    }

    const maxDays: Record<LeaveType, number> = {
      half_day: 1,
      emergency: 3,
      planned: 14,
      medical: 30,
      regularization: 30,
    };
    if (days > maxDays[formData.leaveType]) {
      showToast(`${formData.leaveType.replace('_', ' ')} leave cannot exceed ${maxDays[formData.leaveType]} day(s).`, 'info');
      return;
    }

    const hasOverlap = leaves.some(l => {
      if (['cancelled', 'rejected'].includes(l.status)) return false;
      return formData.startDate <= l.endDate && formData.endDate >= l.startDate;
    });
    if (hasOverlap) {
      showToast('You already have a leave request covering these dates. Please check your leave history.', 'error');
      return;
    }

    if (!formData.parentDeclaration) {
      showToast('Please confirm the parent declaration', 'info');
      return;
    }

    try {
      setSubmitting(true);
      const leaveRequest: Omit<StudentLeaveRequest, 'id'> = {
        studentId: selectedStudent.id,
        parentId: user.uid,
        studentName: selectedStudent.name,
        classId: selectedStudent.classId,
        section: selectedStudent.section,
        leaveType: formData.leaveType,
        reasonCategory: formData.reasonCategory,
        reason: formData.reason,
        startDate: formData.startDate,
        endDate: formData.endDate,
        totalDays: days,
        isEmergency: formData.isEmergency,
        parentDeclaration: formData.parentDeclaration,
        status: 'submitted',
        submittedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        attendanceConnectionStatus: 'pending',
      };

      await addDoc(collection(db, 'studentLeaves'), leaveRequest);

      logActivity(
        user,
        'Leave Request Submitted',
        'Parents',
        `Applied for ${days} days leave for ${selectedStudent.name}`,
        { studentId: selectedStudent.id, days, startDate: formData.startDate }
      );

      showToast('Leave request submitted successfully', 'success');
      setIsAdding(false);
      resetForm();
      fetchStudentLeaves();
    } catch (error) {
      console.error('Error applying for leave:', error);
      showToast('Failed to submit leave request', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      leaveType: 'planned',
      reasonCategory: 'Personal Reason',
      startDate: '',
      endDate: '',
      reason: '',
      isEmergency: false,
      parentDeclaration: false,
    });
  };

  const handleCancelLeave = async (leaveId: string) => {
    if (!confirm('Are you sure you want to cancel this leave request?')) return;
    try {
      await updateDoc(doc(db, 'studentLeaves', leaveId), {
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
      });
      showToast('Leave request cancelled', 'success');
      fetchStudentLeaves();
    } catch (error) {
      console.error('Error cancelling leave:', error);
      showToast('Failed to cancel leave request', 'error');
    }
  };

  const handleUploadDocument = async (leaveId: string, file: File) => {
    try {
      setUploadingDoc(true);
      const storageRef = ref(storage, `leave_documents/${leaveId}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'studentLeaves', leaveId), {
        documentUrl: downloadURL,
        documentName: file.name,
        status: 'submitted',
        updatedAt: new Date().toISOString(),
      });
      showToast('Document uploaded — leave resubmitted for review', 'success');
      setViewingLeave(null);
      fetchStudentLeaves();
    } catch (error) {
      console.error('Error uploading document:', error);
      showToast('Failed to upload document', 'error');
    } finally {
      setUploadingDoc(false);
    }
  };

  if (!selectedStudent) return null;

  const pendingCount = leaves.filter(l => l.status === 'submitted' || l.status === 'pending').length;
  const approvedCount = leaves.filter(l => l.status === 'approved').length;

  return (
    <div className="pad stack" style={{ '--stack-gap': '20px' } as React.CSSProperties}>
      {/* Topbar */}
      <div className="topbar">
        <div>
          <p className="eyebrow">{selectedStudent.name}</p>
          <h1 className="display" style={{ fontSize: 22 }}>
            Leaves
            {pendingCount > 0 && (
              <span
                style={{
                  display: 'inline-block',
                  marginLeft: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  background: '#fef3c7',
                  color: '#92400e',
                  padding: '1px 8px',
                  borderRadius: 99,
                  verticalAlign: 'middle',
                }}
              >
                {pendingCount} pending
              </span>
            )}
          </h1>
        </div>
        <button
          onClick={() => setIsAdding(true)}
          className="btn accent flex items-center gap-1.5"
          style={{ fontSize: 13, padding: '8px 14px' }}
        >
          <Plus className="w-4 h-4" />
          Apply Leave
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[
          { label: 'Total', val: leaves.length, color: 'var(--ink)' },
          { label: 'Approved', val: approvedCount, color: 'var(--leaf)' },
          { label: 'Pending', val: pendingCount, color: '#d97706' },
        ].map(s => (
          <div key={s.label} className="card" style={{ textAlign: 'center', padding: '12px 8px' }}>
            <p className="t-num" style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.val}</p>
            <p className="eyebrow">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Leave list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--ink)', borderTopColor: 'transparent' }} />
        </div>
      ) : leaves.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
          <ClipboardCheck className="w-10 h-10 mx-auto" style={{ color: 'var(--ink-4)', marginBottom: 8 }} />
          <p style={{ fontSize: 14, fontWeight: 700 }}>No leave records</p>
          <p className="tiny muted" style={{ marginTop: 4 }}>Tap "Apply Leave" to submit a new request.</p>
        </div>
      ) : (
        <div className="stack" style={{ '--stack-gap': '8px' } as React.CSSProperties}>
          {leaves.map(leave => {
            const chip = statusChip(leave.status);
            return (
              <div key={leave.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <button
                  onClick={() => setViewingLeave(leave)}
                  className="w-full flex items-center gap-3 text-left"
                  style={{ padding: '12px 16px' }}
                >
                  <div
                    className="flex flex-col items-center justify-center shrink-0"
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      background: leave.status === 'approved' ? '#d1fae5' : leave.status === 'rejected' ? '#fee2e2' : '#fef3c7',
                      color: leave.status === 'approved' ? '#065f46' : leave.status === 'rejected' ? '#991b1b' : '#92400e',
                      fontWeight: 900,
                    }}
                  >
                    <span style={{ fontSize: 9, textTransform: 'uppercase', lineHeight: 1 }}>
                      {format(new Date(leave.startDate), 'MMM')}
                    </span>
                    <span style={{ fontSize: 18, lineHeight: 1 }}>
                      {format(new Date(leave.startDate), 'dd')}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p style={{ fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>
                        {leave.leaveType.replace('_', ' ')}
                      </p>
                      {leave.isEmergency && (
                        <span style={{ fontSize: 9, fontWeight: 700, background: '#fee2e2', color: '#991b1b', padding: '1px 6px', borderRadius: 99 }}>
                          Emergency
                        </span>
                      )}
                    </div>
                    <p className="tiny muted" style={{ marginTop: 2 }}>
                      {format(new Date(leave.startDate), 'do MMM')} – {format(new Date(leave.endDate), 'do MMM')} · {leave.totalDays} {leave.totalDays === 1 ? 'day' : 'days'}
                    </p>
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '3px 10px',
                      borderRadius: 99,
                      background: chip.bg,
                      color: chip.color,
                      flexShrink: 0,
                    }}
                  >
                    {chip.label}
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--ink-4)' }} />
                </button>

                {leave.status === 'submitted' && (
                  <div className="flex justify-end px-4 pb-3">
                    <button
                      onClick={() => handleCancelLeave(leave.id)}
                      className="flex items-center gap-1 text-xs font-bold"
                      style={{ color: 'var(--coral)' }}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Cancel Request
                    </button>
                  </div>
                )}
                {leave.status === 'document_required' && (
                  <div className="px-4 pb-3">
                    <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-bold" style={{ color: '#2563eb' }}>
                      <Upload className="w-3.5 h-3.5" />
                      {uploadingDoc ? 'Uploading…' : 'Upload Document'}
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        className="hidden"
                        disabled={uploadingDoc}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUploadDocument(leave.id, f); }}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Apply Leave Modal */}
      <Modal
        isOpen={isAdding}
        onClose={() => setIsAdding(false)}
        title="Apply for Student Leave"
        subtitle={`Requesting for ${selectedStudent?.name}`}
        size="md"
      >
        <form onSubmit={handleApplyLeave} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Leave Type" required>
              <select
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                value={formData.leaveType}
                onChange={(e) => setFormData({ ...formData, leaveType: e.target.value as LeaveType })}
                required
              >
                {leaveTypes.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Reason Category" required>
              <select
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                value={formData.reasonCategory}
                onChange={(e) => setFormData({ ...formData, reasonCategory: e.target.value as LeaveReasonCategory })}
                required
              >
                {reasonCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Start Date" required>
              <Input
                type="date"
                required
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
              />
            </FormField>
            <FormField label="End Date" required>
              <Input
                type="date"
                required
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
              />
            </FormField>
          </div>

          {calculateDays() > 0 && (
            <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100 flex items-center justify-between">
              <p className="text-xs font-bold text-indigo-700">Total Leave Duration:</p>
              <p className="text-sm font-black text-indigo-900">{calculateDays()} {calculateDays() === 1 ? 'Day' : 'Days'}</p>
            </div>
          )}

          {formData.leaveType === 'planned' && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-800 font-medium">Planned leave must be applied at least <strong>2 days in advance</strong> and cannot exceed 14 days.</p>
            </div>
          )}
          {formData.leaveType === 'medical' && calculateDays() > 3 && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-2">
              <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-blue-800 font-medium">Medical leave over 3 days requires a <strong>doctor's certificate</strong>. The school may ask you to upload it after submission.</p>
            </div>
          )}
          {formData.leaveType === 'half_day' && calculateDays() > 1 && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-rose-800 font-medium">Half day leave can only be for <strong>1 day</strong>.</p>
            </div>
          )}
          {formData.leaveType === 'emergency' && calculateDays() > 3 && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-rose-800 font-medium">Emergency leave cannot exceed <strong>3 days</strong>. For longer absence please use Medical or Planned leave.</p>
            </div>
          )}

          <FormField label="Reason for Leave" required>
            <Textarea
              placeholder="Please provide details about the reason for leave..."
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              required
              rows={3}
            />
          </FormField>

          <div className="space-y-3 pt-2">
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative mt-0.5">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={formData.isEmergency}
                  onChange={(e) => setFormData({ ...formData, isEmergency: e.target.checked })}
                />
                <div className="w-5 h-5 bg-white border-2 border-slate-200 rounded peer-checked:bg-indigo-600 peer-checked:border-indigo-600 transition-all"></div>
                <CheckCircle2 className="absolute inset-0 w-5 h-5 text-white scale-0 peer-checked:scale-75 transition-transform" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-700">Mark as Emergency Leave</p>
                <p className="text-[10px] text-slate-400 font-medium italic">Check this if the leave was sudden and unplanned.</p>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative mt-0.5">
                <input
                  type="checkbox"
                  className="peer sr-only"
                  checked={formData.parentDeclaration}
                  onChange={(e) => setFormData({ ...formData, parentDeclaration: e.target.checked })}
                  required
                />
                <div className="w-5 h-5 bg-white border-2 border-slate-200 rounded peer-checked:bg-indigo-600 peer-checked:border-indigo-600 transition-all"></div>
                <CheckCircle2 className="absolute inset-0 w-5 h-5 text-white scale-0 peer-checked:scale-75 transition-transform" />
              </div>
              <p className="text-xs font-medium text-slate-600">
                I hereby declare that the information provided is correct and I am responsible for the absence of my child.
              </p>
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <Button variant="secondary" onClick={() => setIsAdding(false)}>Cancel</Button>
            <Button variant="primary" loading={submitting} type="submit">Submit Request</Button>
          </div>
        </form>
      </Modal>

      {/* View Leave Modal */}
      <Modal
        isOpen={!!viewingLeave}
        onClose={() => setViewingLeave(null)}
        title="Leave Details"
        subtitle={`Request ID: ${viewingLeave?.id.slice(0, 8)}`}
        size="sm"
      >
        {viewingLeave && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
              <div>
                <p className="text-[9px] text-slate-400 font-bold uppercase">Status</p>
                {getStatusBadge(viewingLeave.status)}
              </div>
              <div className="text-right">
                <p className="text-[9px] text-slate-400 font-bold uppercase">Leave Type</p>
                <p className="text-xs font-bold text-slate-900 capitalize">{viewingLeave.leaveType.replace('_', ' ')}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 border border-slate-100 rounded-xl">
                <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">Start Date</p>
                <p className="text-sm font-bold text-slate-900">{format(new Date(viewingLeave.startDate), 'do MMM, yyyy')}</p>
              </div>
              <div className="p-3 border border-slate-100 rounded-xl">
                <p className="text-[9px] text-slate-400 font-bold uppercase mb-1">End Date</p>
                <p className="text-sm font-bold text-slate-900">{format(new Date(viewingLeave.endDate), 'do MMM, yyyy')}</p>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-[9px] text-slate-400 font-bold uppercase">Reason ({viewingLeave.reasonCategory})</p>
              <div className="p-3 bg-indigo-50/30 border border-indigo-100 rounded-xl">
                <p className="text-xs text-slate-700 italic">"{viewingLeave.reason}"</p>
              </div>
            </div>

            {viewingLeave.adminRemarks && (
              <div className="space-y-1">
                <p className="text-[9px] text-emerald-600 font-black uppercase">School Remarks</p>
                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                  <p className="text-xs text-emerald-900 font-bold">{viewingLeave.adminRemarks}</p>
                </div>
              </div>
            )}

            {viewingLeave.status === 'document_required' && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-2">
                <p className="text-xs font-bold text-blue-800">School has requested a supporting document</p>
                <p className="text-[10px] text-blue-600">Upload a photo or PDF (medical certificate, application, etc.). Once uploaded, your leave will be resubmitted for review.</p>
                <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-colors">
                  <Upload className="w-3.5 h-3.5" />
                  {uploadingDoc ? 'Uploading…' : 'Upload Document'}
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    disabled={uploadingDoc}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUploadDocument(viewingLeave.id, file);
                    }}
                  />
                </label>
                {viewingLeave.documentUrl && (
                  <p className="text-[10px] text-blue-600 font-medium">
                    Previously uploaded: <a href={viewingLeave.documentUrl} target="_blank" rel="noreferrer" className="underline">{viewingLeave.documentName || 'View file'}</a>
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button variant="secondary" className="w-full" onClick={() => setViewingLeave(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
