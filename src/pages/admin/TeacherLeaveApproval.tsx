import React, { useState, useEffect, useMemo } from 'react';
import {
  ClipboardCheck,
  Search,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  query,
  where,
  orderBy,
  getDoc,
  runTransaction,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import {
  UserProfile,
  TeacherLeaveRequest,
  SubstituteAssignment,
  Teacher,
  Timetable,
  TimetableConfig,
} from '../../types';
import { Modal, FormField, Button, Select } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { format, addDays, parseISO, startOfMonth, endOfMonth, isSunday } from 'date-fns';
import { logActivity } from '../../services/activityService';
import { fmtDate } from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SubstituteRow {
  date: string;
  slotId: string;
  slotLabel: string;
  slotStartTime: string;
  classId: string;
  subjectId: string;
  originalTeacherId: string;
  substituteTeacherId: string;
  substituteTeacherName: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDatesInRange(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  let current = parseISO(startDate);
  const end = parseISO(endDate);
  while (current <= end) {
    if (!isSunday(current)) result.push(format(current, 'yyyy-MM-dd'));
    current = addDays(current, 1);
  }
  return result;
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

const LEAVE_TYPE_LABELS: Record<string, string> = {
  casual: 'Casual', medical: 'Medical', emergency: 'Emergency',
  half_day: 'Half Day', comp_off: 'Comp Off', earned: 'Earned',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--coral)',
  approved: 'var(--leaf)',
  rejected: '#ef4444',
  cancelled: 'var(--ink-3)',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function TeacherLeaveApproval({ user }: { user: UserProfile }) {
  const { showToast } = useToast();

  const [leaves, setLeaves] = useState<TeacherLeaveRequest[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [timetableConfig, setTimetableConfig] = useState<TimetableConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [selectedLeave, setSelectedLeave] = useState<TeacherLeaveRequest | null>(null);
  const [principalRemarks, setPrincipalRemarks] = useState('');
  const [substituteRows, setSubstituteRows] = useState<SubstituteRow[]>([]);
  const [isApproving, setIsApproving] = useState(false);

  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectRemarks, setRejectRemarks] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);

  const [revokeModalOpen, setRevokeModalOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  const [isRevoking, setIsRevoking] = useState(false);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [leavesSnap, teachersSnap, timetablesSnap, configSnap] = await Promise.all([
        getDocs(query(collection(db, 'teacherLeaves'), orderBy('submittedAt', 'desc'))),
        getDocs(collection(db, 'teachers')),
        getDocs(collection(db, 'timetable')),
        getDoc(doc(db, 'timetableSettings', 'global')),
      ]);
      setLeaves(leavesSnap.docs.map(d => ({ id: d.id, ...d.data() } as TeacherLeaveRequest)));
      setTeachers(teachersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Teacher)));
      setTimetables(timetablesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Timetable)));
      if (configSnap.exists()) setTimetableConfig({ id: configSnap.id, ...configSnap.data() } as TimetableConfig);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'teacherLeaves');
      showToast('Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const now = new Date();
  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd');
  const today = format(now, 'yyyy-MM-dd');

  const pendingCount = useMemo(() => leaves.filter(l => l.status === 'pending').length, [leaves]);
  const approvedThisMonth = useMemo(() => leaves.filter(l => l.status === 'approved' && l.approvedAt && l.approvedAt >= monthStart && l.approvedAt <= monthEnd + 'T23:59:59').length, [leaves, monthStart, monthEnd]);
  const rejectedThisMonth = useMemo(() => leaves.filter(l => l.status === 'rejected' && l.approvedAt && l.approvedAt >= monthStart && l.approvedAt <= monthEnd + 'T23:59:59').length, [leaves, monthStart, monthEnd]);
  const teachersOnLeaveToday = useMemo(() => new Set(leaves.filter(l => l.status === 'approved' && l.startDate <= today && l.endDate >= today).map(l => l.teacherId)).size, [leaves, today]);

  const filteredLeaves = useMemo(() => leaves.filter(leave => {
    const matchStatus = filterStatus === 'all' || leave.status === filterStatus;
    const matchSearch = !searchQuery || leave.teacherName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchStatus && matchSearch;
  }), [leaves, filterStatus, searchQuery]);

  const buildSubstituteRows = (leave: TeacherLeaveRequest): SubstituteRow[] => {
    if (!timetableConfig) return [];
    const dates = getDatesInRange(leave.startDate, leave.endDate);
    const rows: SubstituteRow[] = [];
    for (const dateStr of dates) {
      const dayOfWeek = format(parseISO(dateStr), 'EEEE');
      for (const timetable of timetables) {
        const daySchedule = timetable.schedule.find(s => s.day.toLowerCase() === dayOfWeek.toLowerCase());
        if (!daySchedule) continue;
        for (const period of daySchedule.periods) {
          if (period.teacherId !== leave.teacherId) continue;
          const slot = timetableConfig.slots.find(s => s.id === period.slotId);
          if (!slot || slot.type !== 'period') continue;
          const alreadyExists = rows.some(r => r.date === dateStr && r.slotId === period.slotId && r.classId === timetable.classId);
          if (alreadyExists) continue;
          rows.push({ date: dateStr, slotId: period.slotId, slotLabel: slot.label, slotStartTime: slot.startTime, classId: timetable.classId, subjectId: period.subjectId, originalTeacherId: leave.teacherId, substituteTeacherId: '', substituteTeacherName: '' });
        }
      }
    }
    rows.sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.slotStartTime.localeCompare(b.slotStartTime));
    return rows;
  };

  const openApprovalModal = (leave: TeacherLeaveRequest) => {
    setSelectedLeave(leave);
    setPrincipalRemarks('');
    setSubstituteRows(buildSubstituteRows(leave));
    setApprovalModalOpen(true);
  };

  const updateSubstituteRow = (index: number, teacherId: string) => {
    const teacher = teachers.find(t => t.id === teacherId);
    setSubstituteRows(prev => prev.map((row, i) => i === index ? { ...row, substituteTeacherId: teacherId, substituteTeacherName: teacher?.name ?? '' } : row));
  };

  const assignAllTBD = () => {
    setSubstituteRows(prev => prev.map(row => row.substituteTeacherId === '' ? { ...row, substituteTeacherId: 'TBD', substituteTeacherName: 'TBD' } : row));
  };

  const handleApprove = async () => {
    if (!selectedLeave) return;
    const tbdCount = substituteRows.filter(r => !r.substituteTeacherId || r.substituteTeacherId === 'TBD').length;
    if (tbdCount > 0) {
      const proceed = window.confirm(`${tbdCount} period(s) still have no substitute assigned (TBD). These classes will be unattended unless you assign substitutes later.\n\nApprove anyway?`);
      if (!proceed) return;
    }
    try {
      setIsApproving(true);
      const now = new Date().toISOString();
      const dates = getDatesInRange(selectedLeave.startDate, selectedLeave.endDate);
      const attendanceRefs = dates.map(() => doc(collection(db, 'attendance')));
      const subRefs = substituteRows.map(() => doc(collection(db, 'substituteAssignments')));
      await runTransaction(db, async tx => {
        const leaveSnap = await tx.get(doc(db, 'teacherLeaves', selectedLeave.id));
        if (!leaveSnap.exists()) throw new Error('Leave request no longer exists');
        if (leaveSnap.data().status !== 'pending') throw new Error(`Leave is already ${leaveSnap.data().status}. Reload the page.`);
        tx.update(doc(db, 'teacherLeaves', selectedLeave.id), { status: 'approved', approvedBy: user.uid, approvedAt: now, principalRemarks: principalRemarks.trim() || null, substituteAssigned: true, attendanceSynced: true, updatedAt: now });
        dates.forEach((dateStr, i) => { tx.set(attendanceRefs[i], { date: dateStr, employeeId: selectedLeave.teacherId, type: 'staff', status: 'approved_leave', leaveId: selectedLeave.id, remarks: 'Teacher leave approved by principal', classId: null, createdAt: now }); });
        substituteRows.forEach((row, i) => {
          const isTBD = !row.substituteTeacherId || row.substituteTeacherId === 'TBD';
          const assignment: Record<string, any> = { leaveId: selectedLeave.id, date: row.date, slotId: row.slotId, classId: row.classId, originalTeacherId: row.originalTeacherId, status: isTBD ? 'unassigned' : 'assigned', assignedBy: user.uid, createdAt: now, updatedAt: now };
          if (!isTBD) { assignment.substituteTeacherId = row.substituteTeacherId; assignment.substituteTeacherName = row.substituteTeacherName; }
          tx.set(subRefs[i], assignment);
        });
      });
      await logActivity(user, 'Teacher Leave Approved', 'Principal', `Approved leave for ${selectedLeave.teacherName} (${fmtDate(selectedLeave.startDate)} to ${fmtDate(selectedLeave.endDate)})` + (tbdCount > 0 ? ` — ${tbdCount} period(s) still TBD` : ''), { leaveId: selectedLeave.id, teacherId: selectedLeave.teacherId, tbdCount });
      showToast(`Leave approved for ${selectedLeave.teacherName}` + (tbdCount > 0 ? ` (${tbdCount} TBD periods need substitutes)` : ''), tbdCount > 0 ? 'info' : 'success');
      setApprovalModalOpen(false);
      setSelectedLeave(null);
      loadAll();
    } catch (error: any) {
      console.error('Error approving leave:', error);
      showToast(error?.message || 'Failed to approve leave', 'error');
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!selectedLeave) return;
    if (!rejectRemarks.trim()) { showToast('Please provide a reason for rejection', 'error'); return; }
    try {
      setIsRejecting(true);
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'teacherLeaves', selectedLeave.id), { status: 'rejected', approvedBy: user.uid, approvedAt: now, principalRemarks: rejectRemarks.trim(), updatedAt: now });
      await logActivity(user, 'Teacher Leave Rejected', 'Principal', `Rejected leave for ${selectedLeave.teacherName} (${fmtDate(selectedLeave.startDate)} to ${fmtDate(selectedLeave.endDate)})`, { leaveId: selectedLeave.id, teacherId: selectedLeave.teacherId });
      showToast(`Leave rejected for ${selectedLeave.teacherName}`, 'success');
      setRejectModalOpen(false);
      setRejectRemarks('');
      setSelectedLeave(null);
      loadAll();
    } catch (error) {
      console.error('Error rejecting leave:', error);
      showToast('Failed to reject leave', 'error');
    } finally {
      setIsRejecting(false);
    }
  };

  const handleRevoke = async () => {
    if (!selectedLeave) return;
    try {
      setIsRevoking(true);
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      batch.update(doc(db, 'teacherLeaves', selectedLeave.id), { status: 'pending', substituteAssigned: false, attendanceSynced: false, principalRemarks: revokeReason.trim() || null, updatedAt: now });
      const subSnap = await getDocs(query(collection(db, 'substituteAssignments'), where('leaveId', '==', selectedLeave.id)));
      subSnap.docs.forEach(d => batch.delete(d.ref));
      const attSnap = await getDocs(query(collection(db, 'attendance'), where('leaveId', '==', selectedLeave.id), where('type', '==', 'staff')));
      attSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      await logActivity(user, 'Teacher Leave Revoked', 'Principal', `Revoked approved leave for ${selectedLeave.teacherName} (${fmtDate(selectedLeave.startDate)} to ${fmtDate(selectedLeave.endDate)})`, { leaveId: selectedLeave.id, teacherId: selectedLeave.teacherId });
      showToast(`Leave revoked for ${selectedLeave.teacherName}`, 'success');
      setRevokeModalOpen(false);
      setRevokeReason('');
      setSelectedLeave(null);
      loadAll();
    } catch (error) {
      console.error('Error revoking leave:', error);
      showToast('Failed to revoke leave', 'error');
    } finally {
      setIsRevoking(false);
    }
  };

  const teacherMap = useMemo(() => Object.fromEntries(teachers.map(t => [t.id, t])), [teachers]);
  const statusFilters = ['all', 'pending', 'approved', 'rejected', 'cancelled'];

  return (
    <>
      {/* Topbar */}
      <div className="topbar">
        <div>
          <div className="eyebrow">{pendingCount} pending</div>
          <h1>Teacher Leaves</h1>
        </div>
      </div>

      <div className="pad stack" style={{ paddingBottom: 32 }}>
        {/* Search */}
        <div className="card flex" style={{ gap: 10, padding: '10px 14px', alignItems: 'center' }}>
          <Search size={16} className="muted" style={{ flexShrink: 0 }} />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search teacher name…"
            style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, fontSize: 14, fontFamily: 'var(--body)', color: 'var(--ink)' }}
          />
        </div>

        {/* Status filter chips */}
        <div className="hscroll" style={{ padding: 0 }}>
          {statusFilters.map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={filterStatus === s ? 'chip solid' : 'chip'}
              style={{ textTransform: 'capitalize' }}
            >
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          {[
            { label: 'Pending', value: pendingCount, color: 'var(--coral)' },
            { label: 'Approved', value: approvedThisMonth, color: 'var(--leaf)' },
            { label: 'Rejected', value: rejectedThisMonth, color: '#ef4444' },
            { label: 'On Leave Today', value: teachersOnLeaveToday, color: 'var(--accent)' },
          ].map(s => (
            <div key={s.label} className="card" style={{ textAlign: 'center', padding: '12px 8px' }}>
              <div className="t-num" style={{ fontSize: 24, color: s.color }}>{s.value}</div>
              <div className="eyebrow" style={{ marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Leave cards */}
        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <p className="muted">Loading…</p>
          </div>
        ) : filteredLeaves.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <ClipboardCheck size={36} style={{ margin: '0 auto 12px', color: 'var(--ink-3)' }} />
            <p style={{ fontWeight: 700 }}>No leave requests found</p>
          </div>
        ) : (
          <div className="stack">
            {filteredLeaves.map(leave => {
              const teacher = teacherMap[leave.teacherId];
              return (
                <div key={leave.id} className="card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    {/* Avatar */}
                    {teacher?.photoURL ? (
                      <img src={teacher.photoURL} alt={leave.teacherName}
                        style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div className="avatar" style={{ width: 40, height: 40, fontSize: 14, flexShrink: 0 }}>
                        {getInitials(leave.teacherName)}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{leave.teacherName}</span>
                        {/* Status dot */}
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: STATUS_COLORS[leave.status] || 'var(--ink-3)', fontWeight: 600 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_COLORS[leave.status] || 'var(--ink-3)', display: 'inline-block' }} />
                          {leave.status.charAt(0).toUpperCase() + leave.status.slice(1)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                        <span className="chip" style={{ fontSize: 11, padding: '2px 8px' }}>
                          {LEAVE_TYPE_LABELS[leave.leaveType] || leave.leaveType}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-3)' }}>
                          <Calendar size={11} />
                          {leave.startDate === leave.endDate ? fmtDate(leave.startDate) : `${fmtDate(leave.startDate)} → ${fmtDate(leave.endDate)}`}
                          {' · '}<strong>{leave.totalDays}d</strong>
                        </span>
                      </div>
                      <p className="muted" style={{ fontSize: 12, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {leave.reason}
                      </p>
                    </div>
                  </div>

                  {/* Action buttons */}
                  {leave.status === 'pending' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                      <button
                        onClick={() => openApprovalModal(leave)}
                        style={{ padding: '8px 0', borderRadius: 10, background: 'var(--leaf)', color: '#fff', border: 0, fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}
                      >
                        <CheckCircle2 size={14} /> Approve
                      </button>
                      <button
                        onClick={() => { setSelectedLeave(leave); setRejectModalOpen(true); }}
                        style={{ padding: '8px 0', borderRadius: 10, background: 'transparent', border: '1px solid var(--coral)', color: 'var(--coral)', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}
                      >
                        <XCircle size={14} /> Reject
                      </button>
                    </div>
                  )}
                  {leave.status === 'approved' && (
                    <button
                      onClick={() => { setSelectedLeave(leave); setRevokeModalOpen(true); }}
                      style={{ marginTop: 12, width: '100%', padding: '8px 0', borderRadius: 10, background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-2)', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}
                    >
                      <RotateCcw size={14} /> Revoke
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Approval Modal ───────────────────────────────────────────────── */}
      <Modal
        isOpen={approvalModalOpen}
        onClose={() => { if (!isApproving) setApprovalModalOpen(false); }}
        title="Approve Leave Request"
        subtitle={`Teacher: ${selectedLeave?.teacherName}`}
        size="lg"
      >
        {selectedLeave && (
          <div className="space-y-6">
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Leave Summary</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Teacher</p>
                  <p className="text-sm font-bold text-slate-900">{selectedLeave.teacherName}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Type</p>
                  <p className="text-sm font-bold text-slate-900">{LEAVE_TYPE_LABELS[selectedLeave.leaveType] || selectedLeave.leaveType}</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Dates</p>
                  <p className="text-sm font-bold text-slate-900">
                    {format(parseISO(selectedLeave.startDate), 'd MMM')}
                    {selectedLeave.endDate !== selectedLeave.startDate ? ` – ${format(parseISO(selectedLeave.endDate), 'd MMM')}` : ''}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Duration</p>
                  <p className="text-sm font-bold text-slate-900">{selectedLeave.totalDays} {selectedLeave.totalDays === 1 ? 'Day' : 'Days'}</p>
                </div>
              </div>
              <div className="mt-3 bg-slate-50 rounded-xl p-3 border border-slate-100">
                <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">Reason</p>
                <p className="text-sm text-slate-700">{selectedLeave.reason}</p>
              </div>
              {selectedLeave.substitutePreference && (
                <div className="mt-3 bg-amber-50 rounded-xl p-3 border border-amber-100">
                  <p className="text-[10px] text-amber-700 font-bold uppercase mb-1">Teacher's Substitute Suggestion</p>
                  <p className="text-sm text-amber-900">{selectedLeave.substitutePreference}</p>
                </div>
              )}
            </div>

            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">Principal Remarks (Optional)</p>
              <textarea
                placeholder="Add any remarks or instructions..."
                value={principalRemarks}
                onChange={e => setPrincipalRemarks(e.target.value)}
                rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 resize-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Substitute Assignment ({substituteRows.length} period{substituteRows.length !== 1 ? 's' : ''})
                </p>
                {substituteRows.length > 0 && (
                  <button onClick={assignAllTBD} className="text-xs text-violet-600 font-bold hover:underline">
                    Mark all remaining as TBD
                  </button>
                )}
              </div>
              {substituteRows.length === 0 ? (
                <div className="bg-slate-50 rounded-xl p-4 text-center text-sm text-slate-500 border border-slate-100">
                  No periods found for this teacher in the timetable for the leave dates.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto max-h-72">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Date</th>
                          <th className="text-left px-3 py-2 font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Period</th>
                          <th className="text-left px-3 py-2 font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Class</th>
                          <th className="text-left px-3 py-2 font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Assign Substitute</th>
                        </tr>
                      </thead>
                      <tbody>
                        {substituteRows.map((row, idx) => (
                          <tr key={idx} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-3 py-2 font-bold text-slate-700 whitespace-nowrap">{format(parseISO(row.date), 'EEE, d MMM')}</td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <span className="font-bold text-slate-800">{row.slotLabel}</span>
                              <span className="text-slate-400 ml-1">({row.slotStartTime})</span>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-slate-600 font-bold">{row.classId}</td>
                            <td className="px-3 py-2 min-w-[180px]">
                              <select
                                value={row.substituteTeacherId}
                                onChange={e => updateSubstituteRow(idx, e.target.value)}
                                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                              >
                                <option value="">-- TBD --</option>
                                {teachers.filter(t => t.id !== selectedLeave.teacherId).map(t => (
                                  <option key={t.id} value={t.id}>
                                    {t.name}{t.subjects?.includes(row.subjectId) ? ' (Subject match)' : ''}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <Button variant="secondary" onClick={() => setApprovalModalOpen(false)} disabled={isApproving}>Cancel</Button>
              <Button variant="success" loading={isApproving} onClick={handleApprove} className="bg-emerald-600 hover:bg-emerald-700 font-bold">
                <CheckCircle2 className="w-4 h-4 mr-1.5" /> Confirm Approval
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Reject Modal ─────────────────────────────────────────────────── */}
      <Modal
        isOpen={rejectModalOpen}
        onClose={() => { if (!isRejecting) { setRejectModalOpen(false); setRejectRemarks(''); } }}
        title="Reject Leave Request"
        subtitle={`Teacher: ${selectedLeave?.teacherName}`}
        size="sm"
      >
        <div className="space-y-4">
          {selectedLeave && (
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 text-sm">
              <p className="font-bold text-slate-800">{selectedLeave.teacherName}</p>
              <p className="text-slate-500 mt-0.5">
                {format(parseISO(selectedLeave.startDate), 'd MMM')}
                {selectedLeave.endDate !== selectedLeave.startDate ? ` – ${format(parseISO(selectedLeave.endDate), 'd MMM')}` : ''}
                {' · '}{selectedLeave.totalDays}d · <span className="capitalize">{selectedLeave.leaveType.replace('_', ' ')}</span>
              </p>
            </div>
          )}
          <FormField label="Reason for Rejection" hint="Required — will be shared with the teacher">
            <textarea
              placeholder="e.g. Insufficient notice period, critical exam week, etc."
              value={rejectRemarks}
              onChange={e => setRejectRemarks(e.target.value)}
              rows={3}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 resize-none"
            />
          </FormField>
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="secondary" onClick={() => { setRejectModalOpen(false); setRejectRemarks(''); }} disabled={isRejecting}>Cancel</Button>
            <Button variant="danger" loading={isRejecting} onClick={handleReject}>
              <XCircle className="w-4 h-4 mr-1.5" /> Reject Leave
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Revoke Modal ─────────────────────────────────────────────────── */}
      <Modal
        isOpen={revokeModalOpen}
        onClose={() => { if (!isRevoking) { setRevokeModalOpen(false); setRevokeReason(''); } }}
        title="Revoke Approved Leave"
        subtitle="This will revert the leave to Pending and delete substitute assignments"
        size="sm"
      >
        <div className="space-y-4">
          {selectedLeave && (
            <div className="bg-amber-50 rounded-xl p-3 border border-amber-200 text-sm">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold text-amber-900">Revoking leave for {selectedLeave.teacherName}</p>
                  <p className="text-amber-700 mt-0.5 text-xs">All substitute assignments and attendance records created for this leave will be deleted. The leave will be returned to Pending status.</p>
                </div>
              </div>
            </div>
          )}
          <FormField label="Reason for Revocation (Optional)">
            <textarea
              placeholder="e.g. Leave cancelled by teacher, emergency staffing requirement..."
              value={revokeReason}
              onChange={e => setRevokeReason(e.target.value)}
              rows={3}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 resize-none"
            />
          </FormField>
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="secondary" onClick={() => { setRevokeModalOpen(false); setRevokeReason(''); }} disabled={isRevoking}>Cancel</Button>
            <Button variant="danger" loading={isRevoking} onClick={handleRevoke}>
              <RotateCcw className="w-4 h-4 mr-1.5" /> Revoke Approval
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
