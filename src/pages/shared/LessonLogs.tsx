import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { UserProfile, LessonLog, Student } from '../../types';
import {
  BookOpen, Search, Paperclip, Edit2, Trash2, AlertTriangle,
  History, Filter, RotateCw, Download,
} from 'lucide-react';
import {
  collection, query, where, onSnapshot, orderBy, limit as fsLimit,
  startAfter, getDocs, QueryDocumentSnapshot, DocumentData,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useData } from '../../contexts/DataContext';
import {
  Modal, FormField, Input, Textarea, Button, Spinner,
} from '../../components/ui';
import { useToast } from '../../components/Toast';
import { logActivity } from '../../services/activityService';
import { openExternalUrl } from '../../lib/download';
import {
  updateLessonLog, deleteLessonLog, validateLessonInput,
  ConcurrentEditError,
} from '../../services/lessonLogService';

interface LessonLogsProps {
  user: UserProfile;
  student?: Student;
}

const PAGE_SIZE = 30;

export default function LessonLogs({ user, student }: LessonLogsProps) {
  const {
    classesMap: classes,
    subjectsMap: subjects,
    teachersMap: teachers,
    teacherData,
  } = useData();
  const [logs, setLogs] = useState<LessonLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<LessonLog | null>(null);

  // Search & filters
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Pagination (cursor-based)
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Edit/delete state
  const [editingLog, setEditingLog] = useState<LessonLog | null>(null);
  const [editForm, setEditForm] = useState({ topic: '', classwork: '', homework: '' });
  const [saving, setSaving] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<LessonLog | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { showToast } = useToast();

  const classTeacherId = teacherData?.classTeacherOf?.classId;

  // Build the base Firestore query for the current user's scope
  const buildScopedQuery = useCallback(() => {
    const base = collection(db, 'lessonLogs');
    if (student) {
      return query(base, where('classId', '==', student.classId), orderBy('date', 'desc'), orderBy('createdAt', 'desc'), fsLimit(PAGE_SIZE));
    }
    if (user.role === 'teacher') {
      const tid = user.teacherId || user.uid;
      if (classTeacherId) {
        return query(base, where('classId', '==', classTeacherId), orderBy('date', 'desc'), orderBy('createdAt', 'desc'), fsLimit(PAGE_SIZE));
      }
      return query(base, where('teacherId', '==', tid), orderBy('date', 'desc'), orderBy('createdAt', 'desc'), fsLimit(PAGE_SIZE));
    }
    // Admins / principal / super_admin: full view
    return query(base, orderBy('date', 'desc'), orderBy('createdAt', 'desc'), fsLimit(PAGE_SIZE));
  }, [student, user.role, user.teacherId, user.uid, classTeacherId]);

  // Real-time subscription to the first page; later pages are loaded with one-shot reads.
  useEffect(() => {
    setLoading(true);
    const q = buildScopedQuery();
    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as LessonLog));
      setLogs(list);
      setCursor(snap.docs[snap.docs.length - 1] || null);
      setHasMore(snap.docs.length === PAGE_SIZE);
      setLoading(false);
      // Keep the selected/editing log in sync if it's part of the live page
      setSelectedLog(prev => (prev ? list.find(l => l.id === prev.id) || prev : null));
    }, err => {
      handleFirestoreError(err, OperationType.LIST, 'lessonLogs');
      setLoading(false);
    });
    return unsub;
  }, [buildScopedQuery]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const base = collection(db, 'lessonLogs');
      let q;
      if (student) {
        q = query(base, where('classId', '==', student.classId), orderBy('date', 'desc'), orderBy('createdAt', 'desc'), startAfter(cursor), fsLimit(PAGE_SIZE));
      } else if (user.role === 'teacher') {
        const tid = user.teacherId || user.uid;
        q = classTeacherId
          ? query(base, where('classId', '==', classTeacherId), orderBy('date', 'desc'), orderBy('createdAt', 'desc'), startAfter(cursor), fsLimit(PAGE_SIZE))
          : query(base, where('teacherId', '==', tid), orderBy('date', 'desc'), orderBy('createdAt', 'desc'), startAfter(cursor), fsLimit(PAGE_SIZE));
      } else {
        q = query(base, orderBy('date', 'desc'), orderBy('createdAt', 'desc'), startAfter(cursor), fsLimit(PAGE_SIZE));
      }
      const snap = await getDocs(q);
      const more = snap.docs.map(d => ({ id: d.id, ...(d.data() as object) } as LessonLog));
      setLogs(prev => [...prev, ...more]);
      setCursor(snap.docs[snap.docs.length - 1] || cursor);
      setHasMore(snap.docs.length === PAGE_SIZE);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'lessonLogs');
    } finally {
      setLoadingMore(false);
    }
  };

  // Client-side search + date filter on the loaded set
  const visibleLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter(l => {
      if (dateFrom && l.date < dateFrom) return false;
      if (dateTo && l.date > dateTo) return false;
      if (!q) return true;
      return (
        l.topic?.toLowerCase().includes(q) ||
        l.classwork?.toLowerCase().includes(q) ||
        l.homework?.toLowerCase().includes(q) ||
        (subjects[l.subjectId] || '').toLowerCase().includes(q) ||
        (teachers[l.teacherId] || '').toLowerCase().includes(q)
      );
    });
  }, [logs, search, dateFrom, dateTo, subjects, teachers]);

  // Permission helpers
  const canEdit = (log: LessonLog) =>
    user.role === 'super_admin' || user.role === 'principal' || user.role === 'office_staff' ||
    (user.role === 'teacher' && log.teacherId === (user.teacherId || user.uid));
  const canDelete = canEdit;

  const handleDownload = async (url: string, _name: string) => {
    await openExternalUrl(url);
  };

  const openEdit = (log: LessonLog) => {
    setEditingLog(log);
    setEditForm({ topic: log.topic || '', classwork: log.classwork || '', homework: log.homework || '' });
    setSelectedLog(null);
  };

  const saveEdit = async () => {
    if (!editingLog || saving) return;
    const err = validateLessonInput(editForm);
    if (err) { showToast(err, 'error'); return; }
    setSaving(true);
    try {
      await updateLessonLog(
        editingLog.id,
        editingLog.version ?? 0,
        {
          topic: editForm.topic.trim(),
          classwork: editForm.classwork,
          homework: editForm.homework,
        },
        user,
      );
      logActivity(user, 'Edited Lesson Log', 'Teachers',
        `Edited diary entry for ${classes[editingLog.classId] || editingLog.classId} · ${editingLog.topic}`,
        { logId: editingLog.id, classId: editingLog.classId });
      showToast('Lesson log updated', 'success');
      setEditingLog(null);
    } catch (e: any) {
      if (e instanceof ConcurrentEditError) {
        showToast(e.message, 'error');
        setEditingLog(null); // Force user to view the fresh version
      } else {
        showToast(e?.message || 'Failed to update lesson log', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteCandidate || deleting) return;
    setDeleting(true);
    try {
      await deleteLessonLog(deleteCandidate);
      logActivity(user, 'Deleted Lesson Log', 'Teachers',
        `Deleted diary entry for ${classes[deleteCandidate.classId] || deleteCandidate.classId} · ${deleteCandidate.topic}`,
        { logId: deleteCandidate.id, classId: deleteCandidate.classId });
      showToast('Lesson log deleted', 'success');
      setDeleteCandidate(null);
      setSelectedLog(null);
    } catch (e: any) {
      showToast(e?.message || 'Failed to delete', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const clearFilters = () => { setSearch(''); setDateFrom(''); setDateTo(''); };
  const hasActiveFilters = !!(search || dateFrom || dateTo);

  const dateRangeLabel = dateFrom || dateTo
    ? `${dateFrom || '…'} → ${dateTo || '…'}`
    : null;

  return (
    <div>
      {/* ── Topbar ── */}
      <div className="topbar">
        <div>
          <div className="eyebrow">
            {logs.length > 0
              ? `${logs.length} entries${dateRangeLabel ? ' · ' + dateRangeLabel : ''}`
              : student
                ? `${student.name}'s class diary`
                : 'Daily lesson logs'}
          </div>
          <h1>Class Diary</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Desktop: date range inline */}
          <div className="flex gap-8 center" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              title="From date"
              style={{
                border: '1px solid var(--line)',
                borderRadius: 10,
                padding: '6px 10px',
                fontSize: 13,
                background: 'var(--paper)',
                color: 'var(--ink)',
                display: 'none',
              }}
              className="desktop-date-from"
            />
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              title="To date"
              style={{
                border: '1px solid var(--line)',
                borderRadius: 10,
                padding: '6px 10px',
                fontSize: 13,
                background: 'var(--paper)',
                color: 'var(--ink)',
                display: 'none',
              }}
              className="desktop-date-to"
            />
          </div>
          {/* Mobile: filter toggle */}
          <button
            className="icon-btn mobile-only"
            onClick={() => setShowFilters(s => !s)}
            title="Toggle filters"
            style={{ position: 'relative' }}
          >
            <Filter size={18} />
            {hasActiveFilters && (
              <span style={{
                position: 'absolute', top: 2, right: 2,
                width: 7, height: 7, borderRadius: '50%',
                background: 'var(--accent)',
              }} />
            )}
          </button>
          {hasActiveFilters && (
            <button className="btn ghost" onClick={clearFilters} style={{ fontSize: 12 }}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="pad">
        {/* ── Search card ── */}
        <div className="card flex center gap-8" style={{ padding: '10px 14px', marginBottom: 16 }}>
          <Search size={16} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search topic, content, subject, teacher…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, border: 'none', outline: 'none',
              background: 'transparent', fontSize: 14, color: 'var(--ink)',
            }}
          />
        </div>

        {/* ── Date filter panel (mobile toggle / desktop always shown via CSS) ── */}
        {showFilters && (
          <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>From</div>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  style={{
                    width: '100%', border: '1px solid var(--line)', borderRadius: 10,
                    padding: '8px 10px', fontSize: 13, background: 'var(--paper)', color: 'var(--ink)',
                  }}
                />
              </div>
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>To</div>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  style={{
                    width: '100%', border: '1px solid var(--line)', borderRadius: 10,
                    padding: '8px 10px', fontSize: 13, background: 'var(--paper)', color: 'var(--ink)',
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Content ── */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 0', gap: 12 }}>
            <Spinner size="lg" />
            <p className="muted" style={{ fontSize: 14 }}>Loading lesson logs…</p>
          </div>
        ) : visibleLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <BookOpen size={40} style={{ color: 'var(--line)', margin: '0 auto 12px' }} />
            <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
              {hasActiveFilters ? 'No matching logs' : 'No Logs Available'}
            </p>
            <p className="muted" style={{ fontSize: 14 }}>
              {hasActiveFilters
                ? 'Try adjusting your search or date filters.'
                : student
                  ? 'No classwork or homework has been logged for this class yet.'
                  : 'Check back later for updates.'}
            </p>
          </div>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Showing {visibleLogs.length} of {logs.length} loaded{hasMore ? ' · more available' : ''}
            </p>

            <div className="stack">
              {visibleLogs.map(log => (
                <div
                  key={log.id}
                  className="card"
                  style={{ cursor: 'pointer', borderLeft: '4px solid var(--accent)' }}
                  onClick={() => setSelectedLog(log)}
                >
                  {/* Header row */}
                  <div className="row" style={{ alignItems: 'flex-start', padding: 0, marginBottom: 8 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="eyebrow" style={{ marginBottom: 4 }}>
                        {subjects[log.subjectId] || log.subjectId}
                        {' · '}
                        {classes[log.classId] ? `Class ${classes[log.classId]}` : log.classId}
                      </div>
                      <p style={{ fontWeight: 800, fontSize: 15, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {log.topic}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      {log.classworkFileUrl && <Paperclip size={13} style={{ color: 'var(--accent)' }} />}
                      {log.homeworkFileUrl && <Paperclip size={13} style={{ color: 'var(--leaf)' }} />}
                      <span className="mono tiny" style={{ fontSize: 11 }}>
                        {new Date(log.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      </span>
                    </div>
                  </div>

                  {/* Classwork preview */}
                  <p className="muted" style={{
                    fontSize: 13, margin: '4px 0',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    <strong style={{ color: 'var(--ink)' }}>CW:</strong> {log.classwork || 'No classwork noted'}
                  </p>

                  {/* Homework preview */}
                  <p className="muted" style={{
                    fontSize: 13, margin: '4px 0 8px',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    <strong style={{ color: 'var(--ink)' }}>HW:</strong> {log.homework || 'No homework assigned'}
                  </p>

                  {/* Footer */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                    <span className="eyebrow" style={{ fontSize: 10, letterSpacing: '0.08em' }}>
                      {teachers[log.teacherId] || 'Subject Teacher'}
                    </span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {log.updatedAt && log.updatedAt !== log.createdAt && (
                        <span style={{ fontSize: 10, color: 'var(--coral)', fontWeight: 700 }}>edited</span>
                      )}
                      {canEdit(log) && (
                        <button
                          className="icon-btn"
                          title="Edit"
                          onClick={e => { e.stopPropagation(); openEdit(log); }}
                        >
                          <Edit2 size={14} />
                        </button>
                      )}
                      {canDelete(log) && (
                        <button
                          className="icon-btn"
                          title="Delete"
                          onClick={e => { e.stopPropagation(); setDeleteCandidate(log); }}
                          style={{ color: 'var(--coral)' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {hasMore && (
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 20 }}>
                <button
                  className="btn ghost"
                  onClick={loadMore}
                  disabled={loadingMore}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <RotateCw size={15} className={loadingMore ? 'animate-spin' : ''} />
                  {loadingMore ? 'Loading…' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Detail Modal ─────────────────────────────────────────────────── */}
      <Modal
        isOpen={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        title="Lesson Details"
        subtitle={selectedLog
          ? `${subjects[selectedLog.subjectId] || selectedLog.subjectId} • Class ${classes[selectedLog.classId] || selectedLog.classId} • ${new Date(selectedLog.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
          : ''}
        size="lg"
      >
        {selectedLog && (
          <div className="space-y-6">
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
              <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-2">Today's Topic</h4>
              <p className="text-2xl font-black text-slate-900 leading-tight">{selectedLog.topic}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-blue-600 font-bold text-sm uppercase tracking-wider">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                    <BookOpen className="w-4 h-4" />
                  </div>
                  Classwork
                </div>
                <div className="bg-white border border-slate-100 rounded-xl p-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed min-h-[80px]">
                  {selectedLog.classwork || 'No details provided.'}
                </div>
                {selectedLog.classworkFileUrl && (
                  <Button
                    variant="secondary" size="sm" icon={Download}
                    className="w-full justify-center"
                    onClick={() => handleDownload(selectedLog.classworkFileUrl!, selectedLog.classworkFileName || 'classwork')}
                  >
                    {selectedLog.classworkFileName || 'Download Classwork File'}
                  </Button>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-emerald-600 font-bold text-sm uppercase tracking-wider">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                    <BookOpen className="w-4 h-4" />
                  </div>
                  Homework
                </div>
                <div className="bg-white border border-slate-100 rounded-xl p-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed min-h-[80px]">
                  {selectedLog.homework || 'No homework assigned.'}
                </div>
                {selectedLog.homeworkFileUrl && (
                  <Button
                    variant="secondary" size="sm" icon={Download}
                    className="w-full justify-center"
                    onClick={() => handleDownload(selectedLog.homeworkFileUrl!, selectedLog.homeworkFileName || 'homework')}
                  >
                    {selectedLog.homeworkFileName || 'Download Homework File'}
                  </Button>
                )}
              </div>
            </div>

            {/* Metadata + audit trail */}
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Subject Teacher</p>
                  <p className="font-semibold text-slate-700">{teachers[selectedLog.teacherId] || 'Unknown'}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Period</p>
                  <p className="font-semibold text-slate-700">
                    {selectedLog.slotLabel || selectedLog.slotId}
                    {selectedLog.slotStartTime && ` · ${selectedLog.slotStartTime}–${selectedLog.slotEndTime || ''}`}
                  </p>
                </div>
                {selectedLog.createdAt && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Created</p>
                    <p className="font-semibold text-slate-700">
                      {new Date(selectedLog.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {selectedLog.createdByName && ` · ${selectedLog.createdByName}`}
                    </p>
                  </div>
                )}
                {selectedLog.updatedAt && selectedLog.updatedAt !== selectedLog.createdAt && (
                  <div>
                    <p className="text-[10px] font-bold text-amber-500 uppercase flex items-center gap-1">
                      <History className="w-3 h-3" /> Last Edited
                    </p>
                    <p className="font-semibold text-amber-700">
                      {new Date(selectedLog.updatedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {selectedLog.updatedByName && ` · ${selectedLog.updatedByName}`}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Edit/delete actions */}
            {(canEdit(selectedLog) || canDelete(selectedLog)) && (
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                {canEdit(selectedLog) && (
                  <Button variant="secondary" icon={Edit2} onClick={() => openEdit(selectedLog)}>
                    Edit
                  </Button>
                )}
                {canDelete(selectedLog) && (
                  <button
                    onClick={() => { setDeleteCandidate(selectedLog); setSelectedLog(null); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold hover:bg-rose-100 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ─── Edit Modal ──────────────────────────────────────────────────── */}
      <Modal
        isOpen={!!editingLog}
        onClose={() => setEditingLog(null)}
        title="Edit Lesson Log"
        subtitle={editingLog
          ? `${subjects[editingLog.subjectId] || editingLog.subjectId} • Class ${classes[editingLog.classId] || editingLog.classId} • ${new Date(editingLog.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
          : ''}
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setEditingLog(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={saveEdit}>Save Changes</Button>
          </div>
        }
      >
        {editingLog && (
          <div className="space-y-5">
            <FormField label="Topic" required hint={`${editForm.topic.length}/200`}>
              <Input
                value={editForm.topic}
                maxLength={200}
                onChange={e => setEditForm(f => ({ ...f, topic: e.target.value }))}
              />
            </FormField>
            <FormField label="Classwork" hint={`${editForm.classwork.length}/5000`}>
              <Textarea
                rows={4}
                value={editForm.classwork}
                maxLength={5000}
                onChange={e => setEditForm(f => ({ ...f, classwork: e.target.value }))}
              />
            </FormField>
            <FormField label="Homework" hint={`${editForm.homework.length}/5000`}>
              <Textarea
                rows={4}
                value={editForm.homework}
                maxLength={5000}
                onChange={e => setEditForm(f => ({ ...f, homework: e.target.value }))}
              />
            </FormField>
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>If another teacher or admin saved this log while you were editing, your changes will be rejected to prevent overwriting their work.</span>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Delete Confirmation ─────────────────────────────────────────── */}
      <Modal
        isOpen={!!deleteCandidate}
        onClose={() => setDeleteCandidate(null)}
        title="Delete Lesson Log?"
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteCandidate(null)} disabled={deleting}>Cancel</Button>
            <button
              onClick={confirmDelete}
              disabled={deleting}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        }
      >
        {deleteCandidate && (
          <div className="space-y-3">
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl">
              <p className="text-sm font-bold text-rose-700">{deleteCandidate.topic}</p>
              <p className="text-xs text-rose-600 mt-1">
                {subjects[deleteCandidate.subjectId] || deleteCandidate.subjectId} ·
                Class {classes[deleteCandidate.classId] || deleteCandidate.classId} ·
                {' '}{new Date(deleteCandidate.date).toLocaleDateString('en-IN')}
              </p>
            </div>
            <p className="text-sm text-slate-600">This will permanently delete the lesson log and any attached files. This action cannot be undone.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
