import React, { useState, useEffect, useMemo } from 'react';
import {
  Send, AlertCircle, CheckCircle2,
  RefreshCw, Phone, Search, X, CheckSquare, Square,
} from 'lucide-react';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { UserProfile, Student, FeeRequest, Class } from '../../types';
import { useToast } from '../../components/Toast';
import { logActivity } from '../../services/activityService';
import { fmtDate } from '../../lib/utils';

const PAYMENT_LINK = 'https://ehs.elnode.in/parent/fees';

interface RecipientRow {
  phone: string;
  parentName: string;
  studentName: string;
  classSection: string;
  amount: string;
  month: string;
  dueDate: string;
  requestId: string;
}

const TEMPLATES = [
  {
    id: 'fees_due_reminder',
    label: 'Fee Reminder',
    description: 'For pending / partially paid fees — sent before or on the due date',
    statuses: ['pending', 'partially_paid'],
    includeOverdue: false,
  },
  {
    id: 'fees_overdue_notice',
    label: 'Overdue Notice',
    description: 'Stronger reminder for fees past the due date',
    statuses: ['pending', 'partially_paid', 'overdue'],
    includeOverdue: true,
  },
] as const;

function buildParams(template: typeof TEMPLATES[number]['id'], r: RecipientRow): string[] {
  if (template === 'fees_due_reminder') {
    return [r.parentName, r.amount, r.studentName, r.classSection, r.month, r.dueDate, PAYMENT_LINK];
  }
  return [r.parentName, r.amount, r.studentName, r.classSection, r.month, r.dueDate, PAYMENT_LINK];
}

export default function WhatsAppNotifications({ user }: { user: UserProfile }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [requests, setRequests] = useState<FeeRequest[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);

  const [template, setTemplate] = useState<typeof TEMPLATES[number]['id']>('fees_due_reminder');

  const [classFilter, setClassFilter] = useState<string[]>([]);
  const [sectionFilter, setSectionFilter] = useState<string[]>([]);
  const [genderFilter, setGenderFilter] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [minAmount, setMinAmount] = useState('');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);

  const { showToast } = useToast();

  useEffect(() => {
    (async () => {
      try {
        const [studSnap, reqSnap, clsSnap] = await Promise.all([
          getDocs(collection(db, 'students')),
          getDocs(collection(db, 'feeRequests')),
          getDocs(collection(db, 'classes')),
        ]);
        setStudents(studSnap.docs.map(d => ({ id: d.id, ...d.data() } as Student)));
        setRequests(reqSnap.docs.map(d => ({ id: d.id, ...d.data() } as FeeRequest)));
        setClasses(clsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Class)));
      } catch {
        showToast('Failed to load data', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const today = new Date().toISOString().split('T')[0];
  const selectedTemplate = TEMPLATES.find(t => t.id === template)!;

  const availableSections = useMemo(() => {
    const pool = classFilter.length > 0 ? classes.filter(c => classFilter.includes(c.id)) : classes;
    const set = new Set<string>();
    pool.forEach(c => (c.sections || []).forEach(s => s.name && set.add(s.name)));
    return Array.from(set).sort();
  }, [classes, classFilter]);

  const toggleArr = (setter: React.Dispatch<React.SetStateAction<string[]>>, value: string) =>
    setter(prev => (prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]));

  const recipients: RecipientRow[] = useMemo(() => {
    const min = parseFloat(minAmount) || 0;
    const term = search.trim().toLowerCase();
    return requests
      .filter(r => {
        if (!selectedTemplate.statuses.includes(r.status as any)) return false;
        if (selectedTemplate.includeOverdue) {
          if (r.status === 'paid') return false;
        } else {
          if (r.dueDate && r.dueDate < today) return false;
        }
        return true;
      })
      .flatMap(r => {
        const student = students.find(s => s.id === r.studentId);
        if (!student?.parentDetails?.phone) return [];
        if (classFilter.length > 0 && !classFilter.includes(student.classId)) return [];
        if (sectionFilter.length > 0 && !sectionFilter.includes(student.section)) return [];
        if (genderFilter.length > 0 && !genderFilter.includes(student.gender || '')) return [];

        const cls = classes.find(c => c.id === student.classId);
        const classSection = `${cls?.name || student.classId} - ${student.section}`;
        const outstanding = r.totalAmount - (r.paidAmount || 0) - (r.waivedAmount || 0) + (r.fineAmount || 0);
        if (outstanding <= 0) return [];
        if (outstanding < min) return [];

        const parentName = student.parentDetails.fatherName || 'Parent';
        if (term && !`${parentName} ${student.name} ${student.parentDetails.phone}`.toLowerCase().includes(term)) return [];

        return [{
          phone: student.parentDetails.phone,
          parentName,
          studentName: student.name,
          classSection,
          amount: `₹${outstanding.toLocaleString('en-IN')}`,
          month: r.month || 'Annual',
          dueDate: r.dueDate
            ? new Date(r.dueDate + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
            : '-',
          requestId: r.id,
        }];
      });
  }, [requests, students, classes, template, classFilter, sectionFilter, genderFilter, minAmount, search, today]);

  const recipientKey = recipients.map(r => r.requestId).join('|');
  useEffect(() => {
    setSelectedIds(new Set(recipients.map(r => r.requestId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientKey]);

  const sendList = useMemo(
    () => recipients.filter(r => selectedIds.has(r.requestId)),
    [recipients, selectedIds],
  );

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const selectAll = () => setSelectedIds(new Set(recipients.map(r => r.requestId)));
  const clearAll = () => setSelectedIds(new Set());
  const allSelected = recipients.length > 0 && sendList.length === recipients.length;

  const clearFilters = () => {
    setClassFilter([]);
    setSectionFilter([]);
    setGenderFilter([]);
    setSearch('');
    setMinAmount('');
  };
  const activeFilterCount =
    classFilter.length + sectionFilter.length + genderFilter.length + (search.trim() ? 1 : 0) + (minAmount.trim() ? 1 : 0);

  const GENDERS = [
    { value: 'male', label: 'Male' },
    { value: 'female', label: 'Female' },
    { value: 'other', label: 'Other' },
  ];

  const pendingCount = requests.filter(r => r.status === 'pending' || r.status === 'partially_paid').length;
  const overdueCount = requests.filter(r => r.dueDate && r.dueDate < today && r.status !== 'paid').length;
  const noPhoneCount = students.filter(s => !s.parentDetails?.phone).length;

  const handleSend = async () => {
    if (sendList.length === 0) {
      showToast('Select at least one parent to send to', 'error');
      return;
    }
    if (!confirm(`Send "${selectedTemplate.label}" to ${sendList.length} selected parent(s)?`)) return;

    setSending(true);
    setProgress({ done: 0, total: sendList.length, failed: 0 });

    let failed = 0;
    for (let i = 0; i < sendList.length; i++) {
      const r = sendList[i];
      try {
        const res = await fetch('/api/whatsapp/send-template', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: r.phone,
            templateName: template,
            parameters: buildParams(template, r),
          }),
        });
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
      setProgress({ done: i + 1, total: sendList.length, failed });
      if (i < sendList.length - 1) await new Promise(res => setTimeout(res, 500));
    }

    const filterSummary = activeFilterCount === 0
      ? 'All Classes'
      : [
          classFilter.length ? `${classFilter.length} class(es)` : '',
          sectionFilter.length ? `${sectionFilter.length} section(s)` : '',
          genderFilter.length ? genderFilter.join('/') : '',
        ].filter(Boolean).join(', ') || 'Custom';

    try {
      await addDoc(collection(db, 'whatsappLogs'), {
        templateName: template,
        filter: filterSummary,
        total: sendList.length,
        failed,
        sentBy: user.uid,
        sentByName: user.displayName || user.email || 'Admin',
        sentAt: serverTimestamp(),
      });
      await logActivity(user, 'WhatsApp Blast Sent', 'Super Admin', `${template} sent to ${sendList.length - failed}/${sendList.length} parents`, { template, total: sendList.length, failed });
    } catch { /* non-fatal */ }

    setSending(false);
    showToast(
      failed === 0
        ? `Successfully sent to ${sendList.length} parent(s)`
        : `Sent ${sendList.length - failed}/${sendList.length} — ${failed} failed`,
      failed === 0 ? 'success' : 'error',
    );
  };

  if (loading) {
    return (
      <div className="pad stack" style={{ paddingTop: 24 }}>
        <div style={{ height: 32, width: 200, background: 'var(--line)', borderRadius: 8, animation: 'pulse 1.5s infinite' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {[1, 2, 3].map(i => <div key={i} style={{ height: 80, background: 'var(--line)', borderRadius: 12 }} />)}
        </div>
        <div style={{ height: 200, background: 'var(--line)', borderRadius: 12 }} />
      </div>
    );
  }

  return (
    <>
      {/* Topbar */}
      <div className="topbar pad">
        <div>
          <div className="eyebrow">Fee notifications</div>
          <h1>WhatsApp</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn accent"
            style={{ fontSize: 13, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6, opacity: (sending || sendList.length === 0) ? 0.5 : 1 }}
            onClick={handleSend}
            disabled={sending || sendList.length === 0}
          >
            {sending
              ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</>
              : <><Send size={14} /> Send to {sendList.length}</>}
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="hscroll" style={{ paddingTop: 10, paddingBottom: 4 }}>
        <div className="card" style={{ padding: '10px 16px', minWidth: 120, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="t-num" style={{ fontSize: 22, color: 'var(--coral)' }}>{pendingCount}</div>
          <div className="eyebrow" style={{ fontSize: 10 }}>Pending</div>
        </div>
        <div className="card" style={{ padding: '10px 16px', minWidth: 120, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="t-num" style={{ fontSize: 22, color: 'var(--coral)' }}>{overdueCount}</div>
          <div className="eyebrow" style={{ fontSize: 10 }}>Overdue</div>
        </div>
        <div className="card" style={{ padding: '10px 16px', minWidth: 120, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div className="t-num" style={{ fontSize: 22 }}>{noPhoneCount}</div>
          <div className="eyebrow" style={{ fontSize: 10 }}>No Phone</div>
        </div>
        <div className="card" style={{ padding: '10px 16px', minWidth: 120, display: 'flex', flexDirection: 'column', gap: 2, background: sendList.length > 0 ? 'var(--accent)' : undefined }}>
          <div className="t-num" style={{ fontSize: 22 }}>{sendList.length}</div>
          <div className="eyebrow" style={{ fontSize: 10 }}>Selected</div>
        </div>
      </div>

      <div className="pad stack" style={{ paddingTop: 16, paddingBottom: 80 }}>

        {/* Template selector */}
        <div>
          <div className="section-head" style={{ padding: '0 0 10px' }}>
            <h2 style={{ fontSize: 14 }}>Template</h2>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {TEMPLATES.map(t => (
              <button
                key={t.id}
                className={`chip${template === t.id ? ' solid' : ''}`}
                style={{ padding: '8px 16px', fontSize: 13 }}
                onClick={() => setTemplate(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {selectedTemplate && (
            <p className="muted tiny" style={{ marginTop: 6 }}>{selectedTemplate.description}</p>
          )}
        </div>

        {/* Filters */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div className="eyebrow" style={{ fontSize: 11 }}>Filter Recipients</div>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--coral)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
              >
                <X size={12} /> Clear ({activeFilterCount})
              </button>
            )}
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-4)' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search parent, student or phone…"
              style={{
                width: '100%', height: 38, paddingLeft: 32, paddingRight: 12,
                border: '1px solid var(--line)', borderRadius: 10, background: 'var(--cream)',
                fontSize: 13, outline: 'none', boxSizing: 'border-box', color: 'var(--ink)',
              }}
            />
          </div>

          {/* Min amount */}
          <div style={{ marginBottom: 12 }}>
            <input
              type="number"
              min={0}
              value={minAmount}
              onChange={e => setMinAmount(e.target.value)}
              placeholder="Min. outstanding (₹)"
              style={{
                width: '100%', height: 38, padding: '0 12px',
                border: '1px solid var(--line)', borderRadius: 10, background: 'var(--cream)',
                fontSize: 13, outline: 'none', boxSizing: 'border-box', color: 'var(--ink)',
              }}
            />
          </div>

          {/* Class chips */}
          {classes.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>Class</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {classes.map(c => (
                  <button
                    key={c.id}
                    className={`chip${classFilter.includes(c.id) ? ' solid' : ''}`}
                    style={{ fontSize: 12, padding: '5px 12px' }}
                    onClick={() => toggleArr(setClassFilter, c.id)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Section chips */}
          {availableSections.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>Section</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {availableSections.map(s => (
                  <button
                    key={s}
                    className={`chip${sectionFilter.includes(s) ? ' solid' : ''}`}
                    style={{ fontSize: 12, padding: '5px 12px' }}
                    onClick={() => toggleArr(setSectionFilter, s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Gender chips */}
          <div>
            <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>Gender</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {GENDERS.map(g => (
                <button
                  key={g.value}
                  className={`chip${genderFilter.includes(g.value) ? ' solid' : ''}`}
                  style={{ fontSize: 12, padding: '5px 12px' }}
                  onClick={() => toggleArr(setGenderFilter, g.value)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {progress && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="tiny muted">{progress.done} / {progress.total} sent</span>
              {progress.failed > 0 && <span className="tiny" style={{ color: 'var(--coral)' }}>{progress.failed} failed</span>}
            </div>
            <div style={{ height: 6, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  borderRadius: 999,
                  background: 'var(--leaf)',
                  width: `${(progress.done / progress.total) * 100}%`,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        )}

        {/* Recipient list */}
        {recipients.length > 0 && (
          <div>
            <div className="section-head" style={{ padding: '0 0 10px' }}>
              <h2 style={{ fontSize: 14 }}>
                Recipients
                <span className="muted" style={{ fontWeight: 400, fontSize: 13, marginLeft: 6 }}>
                  {sendList.length} of {recipients.length}
                </span>
              </h2>
              <button
                onClick={allSelected ? clearAll : selectAll}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 12, fontWeight: 600, color: 'var(--ink-2)',
                  background: 'none', border: 'none', cursor: 'pointer',
                }}
              >
                {allSelected ? <Square size={14} /> : <CheckSquare size={14} />}
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            </div>

            <div className="stack">
              {recipients.map(r => {
                const checked = selectedIds.has(r.requestId);
                return (
                  <button
                    key={r.requestId}
                    onClick={() => toggleSelect(r.requestId)}
                    className="card"
                    style={{
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                      background: checked ? 'var(--accent)' : undefined,
                      borderColor: checked ? 'transparent' : undefined,
                      transition: 'background 0.12s, border-color 0.12s',
                    }}
                  >
                    {/* Checkbox */}
                    <div
                      style={{
                        width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                        border: checked ? '2px solid var(--ink)' : '2px solid var(--line)',
                        background: checked ? 'var(--ink)' : 'transparent',
                        display: 'grid', placeItems: 'center',
                      }}
                    >
                      {checked && <CheckCircle2 size={12} color="var(--cream)" strokeWidth={3} />}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.parentName}
                      </div>
                      <div className="muted tiny" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.studentName} · {r.classSection}
                      </div>
                      <div className="tiny" style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--ink-3)' }}>
                        <Phone size={10} />
                        {r.phone}
                      </div>
                    </div>

                    {/* Amount + due */}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="t-num" style={{ fontSize: 15 }}>{r.amount}</div>
                      <div className="tiny muted" style={{ marginTop: 2 }}>Due {fmtDate(r.dueDate)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {recipients.length === 0 && !loading && (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <AlertCircle size={28} style={{ margin: '0 auto 10px', color: 'var(--ink-4)' }} />
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>No recipients found</div>
            <div className="muted tiny">Adjust your filters or template selection.</div>
          </div>
        )}
      </div>

      {/* Sticky send bar when items selected */}
      {sendList.length > 0 && (
        <div
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0,
            background: 'var(--paper)', borderTop: '1px solid var(--line)',
            padding: '12px 16px', zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {sendList.length} parent{sendList.length !== 1 ? 's' : ''} selected
            </div>
            <div className="muted tiny">{selectedTemplate.label}</div>
          </div>
          <button
            className="btn accent"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', opacity: sending ? 0.6 : 1 }}
            onClick={handleSend}
            disabled={sending}
          >
            {sending
              ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Sending…</>
              : <><Send size={14} /> Send to {sendList.length}</>}
          </button>
        </div>
      )}
    </>
  );
}
