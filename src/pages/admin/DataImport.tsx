import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, Download, CheckCircle, XCircle, AlertCircle,
  FileText, CreditCard, BookOpen, ChevronLeft, Loader2, X,
} from 'lucide-react';
import {
  collection, getDocs, addDoc, doc, setDoc, writeBatch,
  query, where,
} from 'firebase/firestore';
import { db } from '../../firebase';
import { UserProfile, Student, Subject } from '../../types';

// ─── helpers ────────────────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  for (const raw of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

/** Accept DD/MM/YYYY, DD-MM-YYYY or YYYY-MM-DD → returns YYYY-MM-DD or null */
function parseDate(s: string): string | null {
  const clean = s.trim();
  const dmy = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const ymd = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return clean;
  return null;
}

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

function monthLabel(iso: string): string {
  const d = new Date(iso);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function academicYear(iso: string): string {
  const y = parseInt(iso.slice(0, 4));
  const m = parseInt(iso.slice(5, 7));
  return m >= 4 ? `${y}-${String(y + 1).slice(-2)}` : `${y - 1}-${String(y).slice(-2)}`;
}

function simpleGrade(pct: number): string {
  if (pct >= 91) return 'A+';
  if (pct >= 81) return 'A';
  if (pct >= 71) return 'B+';
  if (pct >= 61) return 'B';
  if (pct >= 51) return 'C';
  if (pct >= 41) return 'D';
  return 'F';
}

function normalizeMethod(raw: string): string {
  const m = raw.toLowerCase().replace(/[\s_\-]/g, '');
  if (['upi'].includes(m)) return 'upi';
  if (m.includes('bank') || m.includes('neft') || m.includes('rtgs')) return 'bank_transfer';
  if (m.includes('cheque') || m.includes('check')) return 'cheque';
  if (m.includes('net') || m.includes('internet')) return 'net_banking';
  if (m.includes('online') || m.includes('card')) return 'online';
  return 'cash';
}

function receiptId(): string {
  return `HIST-${Date.now()}-${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;
}

type ImportStatus = 'ok' | 'skip' | 'error';
interface RowResult { row: number; label: string; status: ImportStatus; reason?: string }

// ─── tab types ───────────────────────────────────────────────────────────────

type Tab = 'payments' | 'dues' | 'exams';

const TEMPLATES = {
  payments: {
    header: 'Admission Number,Date (DD/MM/YYYY),Amount,Payment Method,Fee Head,Receipt Number,Reference Number,Remarks',
    sample: [
      'ADM001,01/04/2024,5000,cash,Tuition Fees,REC-001,,Annual tuition fee',
      'ADM001,01/04/2024,800,cash,Transport,REC-001,,',
      'ADM002,15/06/2024,5000,upi,Tuition Fees,REC-002,UPI123456,',
    ],
  },
  dues: {
    header: 'Admission Number,Academic Year,Month,Fee Head,Total Amount,Paid Amount,Due Date (DD/MM/YYYY)',
    sample: [
      'ADM001,2024-25,April 2024,Tuition Fees,5000,0,15/04/2024',
      'ADM001,2024-25,April 2024,Transport,800,0,15/04/2024',
      'ADM002,2024-25,May 2024,Tuition Fees,5000,2500,15/05/2024',
    ],
  },
  exams: {
    header: 'Exam Name,Term,Exam Date (DD/MM/YYYY),Admission Number,Subject,Marks Obtained,Max Marks',
    sample: [
      'Mid-Term,Term 1,15/09/2024,ADM001,Mathematics,45,50',
      'Mid-Term,Term 1,15/09/2024,ADM001,English,38,50',
      'Mid-Term,Term 1,15/09/2024,ADM002,Mathematics,42,50',
      'Mid-Term,Term 1,15/09/2024,ADM002,English,35,50',
    ],
  },
};

function downloadTemplate(tab: Tab) {
  const t = TEMPLATES[tab];
  const content = [t.header, ...t.sample].join('\n');
  const blob = new Blob([content], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `template_${tab}.csv`;
  a.click();
}

function downloadReport(results: RowResult[], tab: Tab) {
  const rows = [['Row', 'Entry', 'Status', 'Reason']];
  for (const r of results) rows.push([String(r.row), r.label, r.status, r.reason ?? '']);
  const content = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([content], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `import_report_${tab}.csv`;
  a.click();
}

// ─── shared preview types ───────────────────────────────────────────────────

interface PreviewRow {
  rowNum: number;
  cols: string[];
  issue?: string;
}

// ─── component ───────────────────────────────────────────────────────────────

export default function DataImport({ user }: { user: UserProfile }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('payments');

  // Shared master data
  const [students, setStudents] = useState<Student[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loadingMaster, setLoadingMaster] = useState(true);

  useEffect(() => {
    Promise.all([
      getDocs(collection(db, 'students')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() } as Student))),
      getDocs(collection(db, 'subjects')).then(s => s.docs.map(d => ({ id: d.id, ...d.data() } as Subject))),
    ]).then(([st, su]) => { setStudents(st); setSubjects(su); setLoadingMaster(false); });
  }, []);

  const studentMap = Object.fromEntries(students.map(s => [s.admissionNumber?.trim().toUpperCase(), s]));
  const subjectMap = Object.fromEntries(subjects.map(s => [s.name?.trim().toLowerCase(), s]));

  // Per-tab state
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setPreview([]); setRawRows([]); setResults(null); if (fileRef.current) fileRef.current.value = ''; };

  // Parse file on upload
  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResults(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      if (rows.length < 2) { alert('File appears empty or has only a header row.'); return; }
      const dataRows = rows.slice(1); // skip header
      setRawRows(dataRows);
      // Build preview with simple issue detection
      const pv: PreviewRow[] = dataRows.map((cols, i) => {
        const issue = validateRow(cols, tab, studentMap);
        return { rowNum: i + 2, cols, issue };
      });
      setPreview(pv);
    };
    reader.readAsText(file);
  }, [tab, studentMap]);

  function validateRow(cols: string[], t: Tab, sMap: Record<string, Student>): string | undefined {
    const admNo = cols[0]?.trim().toUpperCase();
    if (!admNo) return 'Missing admission number';
    if (!sMap[admNo]) return `Student "${admNo}" not found`;
    if (t === 'payments') {
      if (!parseDate(cols[1] || '')) return 'Invalid date (use DD/MM/YYYY)';
      if (!parseFloat(cols[2] || '')) return 'Invalid amount';
      if (!cols[4]?.trim()) return 'Missing fee head';
    }
    if (t === 'dues') {
      if (!cols[1]?.trim()) return 'Missing academic year';
      if (!cols[2]?.trim()) return 'Missing month';
      if (!parseFloat(cols[3] || '') && !parseFloat(cols[4] || '')) return 'Missing fee head or amount';
    }
    if (t === 'exams') {
      if (!cols[0]?.trim()) return 'Missing exam name';
      if (!parseDate(cols[2] || '')) return 'Invalid exam date';
      const admNoExam = cols[3]?.trim().toUpperCase();
      if (!admNoExam) return 'Missing admission number';
      if (!sMap[admNoExam]) return `Student "${admNoExam}" not found`;
      if (!cols[4]?.trim()) return 'Missing subject';
      if (parseFloat(cols[5] || '') === undefined) return 'Invalid marks';
    }
  }

  // ── IMPORT PAYMENTS ───────────────────────────────────────────────────────
  async function importPayments(): Promise<RowResult[]> {
    const res: RowResult[] = [];
    // Group by (admNo + date)
    const groups: Record<string, { student: Student; date: string; rows: string[][] }> = {};
    for (const [i, cols] of rawRows.entries()) {
      const admNo = cols[0]?.trim().toUpperCase();
      const dateStr = parseDate(cols[1] || '');
      const student = studentMap[admNo];
      if (!student || !dateStr) {
        res.push({ row: i + 2, label: `${admNo}`, status: 'skip', reason: 'Missing or invalid data' });
        continue;
      }
      const key = `${admNo}||${dateStr}`;
      if (!groups[key]) groups[key] = { student, date: dateStr, rows: [] };
      groups[key].rows.push(cols);
    }

    for (const [key, grp] of Object.entries(groups)) {
      const { student, date, rows } = grp;
      const admNo = key.split('||')[0];
      const label = `${student.name} (${admNo}) on ${date}`;
      try {
        const amount = rows.reduce((sum, r) => sum + (parseFloat(r[2]) || 0), 0);
        const method = normalizeMethod(rows[0][3] || 'cash');
        const feeHead = rows[0][4]?.trim() || 'Fees';
        const receiptNumber = rows[0][5]?.trim() || receiptId();
        const referenceNumber = rows[0][6]?.trim() || undefined;
        const remarks = rows[0][7]?.trim() || 'Legacy import';
        const allocations = rows.map(r => ({
          headName: r[4]?.trim() || 'Fees',
          amount: parseFloat(r[2]) || 0,
        }));
        const month = monthLabel(date);
        const acYear = academicYear(date);

        // Create feeRequest (legacy)
        const reqRef = doc(collection(db, 'feeRequests'));
        const feeRequest = {
          studentId: student.id,
          classId: student.classId,
          academicYear: acYear,
          month,
          heads: allocations.map(a => ({
            name: a.headName, amount: a.amount, discount: 0,
            discountReason: '', finalAmount: a.amount,
          })),
          totalAmount: amount,
          fineAmount: 0,
          waivedAmount: 0,
          paidAmount: amount,
          status: 'paid' as const,
          dueDate: date,
          createdAt: new Date().toISOString(),
          legacyImport: true,
        };
        await setDoc(reqRef, feeRequest);

        // Create feePayment
        await addDoc(collection(db, 'feePayments'), {
          studentId: student.id,
          classId: student.classId,
          feeRequestId: reqRef.id,
          feeHead,
          amount,
          fineAmount: 0,
          allocations,
          date,
          method,
          referenceNumber,
          receiptNumber,
          remarks,
          legacyImport: true,
        });

        res.push({ row: 0, label, status: 'ok' });
      } catch (err: any) {
        res.push({ row: 0, label, status: 'error', reason: err.message });
      }
    }
    return res;
  }

  // ── IMPORT OUTSTANDING DUES ───────────────────────────────────────────────
  async function importDues(): Promise<RowResult[]> {
    const res: RowResult[] = [];
    // Group by (admNo + academicYear + month)
    const groups: Record<string, { student: Student; academicYear: string; month: string; rows: string[][] }> = {};
    for (const [i, cols] of rawRows.entries()) {
      const admNo = cols[0]?.trim().toUpperCase();
      const acYear = cols[1]?.trim();
      const month = cols[2]?.trim();
      const student = studentMap[admNo];
      if (!student || !acYear || !month) {
        res.push({ row: i + 2, label: `Row ${i + 2}`, status: 'skip', reason: 'Missing required fields' });
        continue;
      }
      const key = `${admNo}||${acYear}||${month}`;
      if (!groups[key]) groups[key] = { student, academicYear: acYear, month, rows: [] };
      groups[key].rows.push(cols);
    }

    // Check existing feeRequests for duplicates
    const existingReqs = await getDocs(query(
      collection(db, 'feeRequests'),
      where('legacyImport', '==', true)
    )).then(s => new Set(s.docs.map(d => {
      const data = d.data();
      return `${data.studentId}||${data.academicYear}||${data.month}`;
    })));

    for (const [key, grp] of Object.entries(groups)) {
      const { student, rows } = grp;
      const admNo = key.split('||')[0];
      const label = `${student.name} (${admNo}) — ${grp.month} ${grp.academicYear}`;

      const dupKey = `${student.id}||${grp.academicYear}||${grp.month}`;
      if (existingReqs.has(dupKey)) {
        res.push({ row: 0, label, status: 'skip', reason: 'Already imported for this month' });
        continue;
      }
      try {
        const heads = rows.map(r => {
          const total = parseFloat(r[4]) || 0;
          const paid = parseFloat(r[5]) || 0;
          return { name: r[3]?.trim() || 'Fees', total, paid };
        });
        const totalAmount = heads.reduce((s, h) => s + h.total, 0);
        const paidAmount = heads.reduce((s, h) => s + h.paid, 0);
        const status =
          paidAmount <= 0 ? 'pending'
          : paidAmount >= totalAmount ? 'paid'
          : 'partially_paid';
        const dueDateRaw = rows[0][6]?.trim();
        const dueDate = dueDateRaw ? (parseDate(dueDateRaw) ?? '') : '';

        await addDoc(collection(db, 'feeRequests'), {
          studentId: student.id,
          classId: student.classId,
          academicYear: grp.academicYear,
          month: grp.month,
          heads: heads.map(h => ({
            name: h.name, amount: h.total, discount: 0,
            discountReason: '', finalAmount: h.total,
          })),
          totalAmount,
          fineAmount: 0,
          waivedAmount: 0,
          paidAmount,
          status,
          dueDate,
          createdAt: new Date().toISOString(),
          legacyImport: true,
        });

        res.push({ row: 0, label, status: 'ok' });
      } catch (err: any) {
        res.push({ row: 0, label, status: 'error', reason: err.message });
      }
    }
    return res;
  }

  // ── IMPORT EXAM RESULTS ───────────────────────────────────────────────────
  async function importExams(): Promise<RowResult[]> {
    const res: RowResult[] = [];
    // Groups: examKey → exam meta; examKey+admNo → [rows]
    const examMeta: Record<string, { name: string; term: string; date: string }> = {};
    const resultRows: Record<string, { student: Student; examKey: string; rows: string[][] }> = {};

    for (const [i, cols] of rawRows.entries()) {
      const examName = cols[0]?.trim();
      const term = cols[1]?.trim();
      const dateStr = parseDate(cols[2] || '');
      const admNo = cols[3]?.trim().toUpperCase();
      const subjectName = cols[4]?.trim();
      const marksRaw = parseFloat(cols[5]);
      const maxRaw = parseFloat(cols[6]);
      const student = studentMap[admNo];

      if (!examName || !dateStr || !admNo || !subjectName || isNaN(marksRaw) || isNaN(maxRaw) || !student) {
        res.push({ row: i + 2, label: `Row ${i + 2}`, status: 'skip', reason: 'Missing or invalid data' });
        continue;
      }
      const examKey = `${examName}||${term}||${dateStr}`;
      examMeta[examKey] = { name: examName, term, date: dateStr };
      const rKey = `${examKey}||${admNo}`;
      if (!resultRows[rKey]) resultRows[rKey] = { student, examKey, rows: [] };
      resultRows[rKey].rows.push(cols);
    }

    // Create exam documents (one per unique examKey)
    const examIdMap: Record<string, string> = {};
    for (const [examKey, meta] of Object.entries(examMeta)) {
      // Check if already exists
      const existing = await getDocs(query(
        collection(db, 'exams'),
        where('name', '==', meta.name),
        where('term', '==', meta.term),
        where('startDate', '==', meta.date),
      ));
      if (!existing.empty) {
        examIdMap[examKey] = existing.docs[0].id;
      } else {
        const ref = doc(collection(db, 'exams'));
        await setDoc(ref, {
          name: meta.name,
          term: meta.term,
          startDate: meta.date,
          endDate: meta.date,
          classIds: [...new Set(Object.values(resultRows)
            .filter(r => r.examKey === examKey)
            .map(r => r.student.classId))],
          maxMarks: 100,
          status: 'published',
          type: 'scheduled',
          createdAt: new Date().toISOString(),
          createdBy: user.uid,
          publishedAt: new Date().toISOString(),
          publishedBy: user.uid,
          legacyImport: true,
        });
        examIdMap[examKey] = ref.id;
      }
    }

    // Create examResult documents
    for (const [rKey, grp] of Object.entries(resultRows)) {
      const { student, examKey, rows } = grp;
      const examId = examIdMap[examKey];
      const label = `${student.name} — ${examMeta[examKey].name}`;
      try {
        const subjectResults = rows.map(r => {
          const sub = subjectMap[r[4]?.trim().toLowerCase()];
          const marks = parseFloat(r[5]) || 0;
          const max = parseFloat(r[6]) || 100;
          const pct = max > 0 ? (marks / max) * 100 : 0;
          return {
            subjectId: sub?.id || r[4]?.trim(),
            marksObtained: marks,
            maxMarks: max,
            grade: simpleGrade(pct),
            status: 'present' as const,
          };
        });
        const totalMarks = subjectResults.reduce((s, r) => s + r.marksObtained, 0);
        const totalMax = subjectResults.reduce((s, r) => s + r.maxMarks, 0);
        const pct = totalMax > 0 ? (totalMarks / totalMax) * 100 : 0;
        const resultDocId = `${examId}_${student.id}`;
        await setDoc(doc(db, 'examResults', resultDocId), {
          id: resultDocId,
          examId,
          studentId: student.id,
          classId: student.classId,
          subjectResults,
          totalMarks,
          percentage: Math.round(pct * 10) / 10,
          overallGrade: simpleGrade(pct),
          published: true,
          updatedAt: new Date().toISOString(),
          createdBy: user.uid,
          createdByName: user.name || user.email,
          legacyImport: true,
          version: 1,
        });
        res.push({ row: 0, label, status: 'ok' });
      } catch (err: any) {
        res.push({ row: 0, label, status: 'error', reason: err.message });
      }
    }
    return res;
  }

  const handleImport = async () => {
    setImporting(true);
    try {
      let res: RowResult[] = [];
      if (tab === 'payments') res = await importPayments();
      else if (tab === 'dues') res = await importDues();
      else res = await importExams();
      setResults(res);
    } finally {
      setImporting(false);
    }
  };

  const okCount = results?.filter(r => r.status === 'ok').length ?? 0;
  const skipCount = results?.filter(r => r.status === 'skip').length ?? 0;
  const errCount = results?.filter(r => r.status === 'error').length ?? 0;
  const importableCount = preview.filter(p => !p.issue).length;

  // ── render ────────────────────────────────────────────────────────────────

  const TAB_CONFIG = [
    { key: 'payments' as Tab, label: 'Past Payments', icon: CreditCard,
      desc: 'Import historical fee payment records. Each row is one payment entry per student.' },
    { key: 'dues' as Tab, label: 'Outstanding Dues', icon: FileText,
      desc: 'Import pending/outstanding balances owed by students from previous terms.' },
    { key: 'exams' as Tab, label: 'Exam Results', icon: BookOpen,
      desc: 'Import past exam marks. Each row is one subject result for a student in an exam.' },
  ];

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--cream)' }}>
      {/* ── mobile topbar ── */}
      <div
        className="lg:hidden sticky top-0 z-20 flex items-center gap-3 px-4 h-14"
        style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}
      >
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl" style={{ color: 'var(--ink-3)' }}>
          <ChevronLeft size={20} />
        </button>
        <p className="font-bold text-[15px]" style={{ color: 'var(--ink)' }}>Data Import</p>
      </div>

      <div className="px-4 py-6 lg:px-0 max-w-4xl mx-auto">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="display text-2xl mb-1">Historical Data Import</h1>
          <p className="text-sm" style={{ color: 'var(--ink-3)' }}>
            Upload past data via CSV — payments, outstanding dues, and exam results.
          </p>
        </div>

        {/* Tab selector */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {TAB_CONFIG.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); reset(); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold shrink-0 transition-colors"
              style={tab === t.key
                ? { background: 'var(--ink)', color: 'var(--cream)' }
                : { background: 'var(--cream-2)', color: 'var(--ink-3)' }}
            >
              <t.icon size={15} strokeWidth={2} />
              {t.label}
            </button>
          ))}
        </div>

        {loadingMaster ? (
          <div className="flex items-center justify-center gap-2 py-20" style={{ color: 'var(--ink-3)' }}>
            <Loader2 size={20} className="spin" />
            <span className="text-sm">Loading student data…</span>
          </div>
        ) : (
          <>
            {/* Description card */}
            <div
              className="rounded-2xl p-4 mb-5"
              style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}
            >
              <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
                {TAB_CONFIG.find(t => t.key === tab)?.desc}
              </p>
            </div>

            {/* Step 1: Download template */}
            <div className="rounded-2xl p-5 mb-4" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>
              <p className="font-bold text-sm mb-3" style={{ color: 'var(--ink)' }}>
                Step 1 — Download Template
              </p>
              <button
                onClick={() => downloadTemplate(tab)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
                style={{ background: 'var(--cream-2)', color: 'var(--ink-2)' }}
              >
                <Download size={15} />
                Download CSV Template
              </button>
              <p className="text-xs mt-2" style={{ color: 'var(--ink-4)' }}>
                Fill this template and save as CSV before uploading.
              </p>
            </div>

            {/* Step 2: Upload */}
            <div className="rounded-2xl p-5 mb-4" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>
              <p className="font-bold text-sm mb-3" style={{ color: 'var(--ink)' }}>
                Step 2 — Upload CSV
              </p>
              <label
                className="flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-colors"
                style={{ borderColor: 'var(--line)', background: 'var(--cream)' }}
              >
                <Upload size={24} style={{ color: 'var(--ink-4)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--ink-3)' }}>
                  Click to choose CSV file
                </span>
                <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
              </label>
            </div>

            {/* Preview */}
            {preview.length > 0 && !results && (
              <div className="rounded-2xl p-5 mb-4" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="font-bold text-sm" style={{ color: 'var(--ink)' }}>
                    Step 3 — Review &amp; Import
                  </p>
                  <button onClick={reset} style={{ color: 'var(--ink-4)' }}><X size={16} /></button>
                </div>
                <div className="flex gap-3 mb-4 text-xs flex-wrap">
                  <span className="px-2 py-1 rounded-lg font-semibold" style={{ background: '#d1fae5', color: '#065f46' }}>
                    {importableCount} importable
                  </span>
                  <span className="px-2 py-1 rounded-lg font-semibold" style={{ background: '#fef3c7', color: '#92400e' }}>
                    {preview.length - importableCount} will skip
                  </span>
                </div>
                <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--line)' }}>
                  <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--cream-2)' }}>
                        <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--ink-3)' }}>#</th>
                        {TEMPLATES[tab].header.split(',').map(h => (
                          <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap" style={{ color: 'var(--ink-3)' }}>{h}</th>
                        ))}
                        <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--ink-3)' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, idx) => (
                        <tr
                          key={idx}
                          style={{ background: row.issue ? 'rgba(239,68,68,.06)' : undefined,
                                   borderTop: '1px solid var(--line)' }}
                        >
                          <td className="px-3 py-2" style={{ color: 'var(--ink-4)' }}>{row.rowNum}</td>
                          {row.cols.map((c, ci) => (
                            <td key={ci} className="px-3 py-2 max-w-[160px] truncate" style={{ color: 'var(--ink-2)' }}>{c}</td>
                          ))}
                          <td className="px-3 py-2 whitespace-nowrap">
                            {row.issue
                              ? <span className="text-xs font-semibold" style={{ color: 'var(--coral)' }}>⚠ {row.issue}</span>
                              : <span className="text-xs font-semibold" style={{ color: 'var(--leaf)' }}>✓ Import</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex gap-3 flex-wrap">
                  <button
                    onClick={handleImport}
                    disabled={importing || importableCount === 0}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors"
                    style={importing || importableCount === 0
                      ? { background: 'var(--cream-2)', color: 'var(--ink-4)' }
                      : { background: 'var(--ink)', color: 'var(--cream)' }}
                  >
                    {importing ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
                    {importing ? 'Importing…' : `Import ${importableCount} Record${importableCount !== 1 ? 's' : ''}`}
                  </button>
                  <button onClick={reset} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ color: 'var(--ink-3)' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Results */}
            {results && (
              <div className="rounded-2xl p-5" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>
                <p className="font-bold text-sm mb-4" style={{ color: 'var(--ink)' }}>Import Complete</p>
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[
                    { label: 'Imported', count: okCount, color: '#d1fae5', text: '#065f46' },
                    { label: 'Skipped', count: skipCount, color: '#fef3c7', text: '#92400e' },
                    { label: 'Errors', count: errCount, color: '#fee2e2', text: '#991b1b' },
                  ].map(s => (
                    <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: s.color }}>
                      <p className="text-2xl font-bold" style={{ color: s.text }}>{s.count}</p>
                      <p className="text-xs font-semibold mt-0.5" style={{ color: s.text }}>{s.label}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-1 max-h-60 overflow-y-auto mb-4">
                  {results.map((r, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs py-1">
                      {r.status === 'ok' && <CheckCircle size={14} style={{ color: 'var(--leaf)', shrink: 0, marginTop: 1 }} />}
                      {r.status === 'skip' && <AlertCircle size={14} style={{ color: '#d97706', shrink: 0, marginTop: 1 }} />}
                      {r.status === 'error' && <XCircle size={14} style={{ color: 'var(--coral)', shrink: 0, marginTop: 1 }} />}
                      <span style={{ color: 'var(--ink-2)' }}>
                        {r.label}
                        {r.reason && <span style={{ color: 'var(--ink-4)' }}> — {r.reason}</span>}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 flex-wrap">
                  <button
                    onClick={() => downloadReport(results, tab)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
                    style={{ background: 'var(--cream-2)', color: 'var(--ink-2)' }}
                  >
                    <Download size={14} />
                    Download Report
                  </button>
                  <button
                    onClick={reset}
                    className="px-4 py-2 rounded-xl text-sm font-semibold"
                    style={{ background: 'var(--ink)', color: 'var(--cream)' }}
                  >
                    Import More
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
