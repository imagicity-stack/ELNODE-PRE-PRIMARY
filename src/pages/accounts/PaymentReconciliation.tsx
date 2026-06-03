import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { UserProfile, FeePayment, FeeRequest, Student } from '../../types';
import { fmtDate } from '../../lib/utils';
import { AlertTriangle, CheckCircle2, RefreshCcw, FileWarning, Copy, Scale, GitBranch } from 'lucide-react';
import { useData } from '../../contexts/DataContext';
import { fmtMonthYear } from '../../lib/utils';

interface Props {
  user: UserProfile;
}

interface OrphanRow {
  payment: FeePayment;
  reason: 'missing-request' | 'wrong-student';
}

interface DupRow {
  transactionId: string;
  payments: FeePayment[];
}

interface DriftRow {
  request: FeeRequest;
  recordedPaid: number;
  paymentsSum: number;
  delta: number;
  studentName?: string;
}

interface StatusMismatchRow {
  request: FeeRequest;
  expectedStatus: FeeRequest['status'];
  studentName?: string;
}

export default function PaymentReconciliation({ user: _user }: Props) {
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [requests, setRequests] = useState<FeeRequest[]>([]);
  const [studentsLocal, setStudentsLocal] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const { students: studentsCtx } = useData();

  const studentMap = useMemo(() => {
    const map = new Map<string, Student>();
    const all = studentsLocal.length ? studentsLocal : studentsCtx;
    (all || []).forEach(s => map.set(s.id, s));
    return map;
  }, [studentsLocal, studentsCtx]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [paySnap, reqSnap, stuSnap] = await Promise.all([
        getDocs(collection(db, 'feePayments')),
        getDocs(collection(db, 'feeRequests')),
        getDocs(collection(db, 'students')),
      ]);
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() } as FeePayment)));
      setRequests(reqSnap.docs.map(d => ({ id: d.id, ...d.data() } as FeeRequest)));
      setStudentsLocal(stuSnap.docs.map(d => ({ id: d.id, ...d.data() } as Student)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'reconciliation');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // ─── Build maps ────────────────────────────────────────────────────────────
  const requestMap = useMemo(() => {
    const m = new Map<string, FeeRequest>();
    requests.forEach(r => m.set(r.id, r));
    return m;
  }, [requests]);

  const paymentsByRequest = useMemo(() => {
    const m = new Map<string, FeePayment[]>();
    payments.forEach(p => {
      const arr = m.get(p.feeRequestId) || [];
      arr.push(p);
      m.set(p.feeRequestId, arr);
    });
    return m;
  }, [payments]);

  // ─── 1. Orphaned payments ──────────────────────────────────────────────────
  const orphans: OrphanRow[] = useMemo(() => {
    const list: OrphanRow[] = [];
    for (const p of payments) {
      const req = requestMap.get(p.feeRequestId);
      if (!req) {
        list.push({ payment: p, reason: 'missing-request' });
      } else if (req.studentId !== p.studentId) {
        list.push({ payment: p, reason: 'wrong-student' });
      }
    }
    return list;
  }, [payments, requestMap]);

  // ─── 2. Duplicate transactionIds ───────────────────────────────────────────
  const duplicates: DupRow[] = useMemo(() => {
    const byTxn = new Map<string, FeePayment[]>();
    for (const p of payments) {
      if (!p.transactionId) continue;
      const arr = byTxn.get(p.transactionId) || [];
      arr.push(p);
      byTxn.set(p.transactionId, arr);
    }
    return Array.from(byTxn.entries())
      .filter(([, arr]) => arr.length > 1)
      .map(([transactionId, arr]) => ({ transactionId, payments: arr }));
  }, [payments]);

  // ─── 3. Sum drift: recorded paidAmount vs sum(payments) ────────────────────
  const drift: DriftRow[] = useMemo(() => {
    const rows: DriftRow[] = [];
    for (const r of requests) {
      const related = paymentsByRequest.get(r.id) || [];
      const sum = related.reduce((acc, p) => acc + (p.amount || 0), 0);
      const recorded = r.paidAmount || 0;
      const delta = Math.round((recorded - sum) * 100) / 100;
      if (Math.abs(delta) > 0.5) {
        rows.push({
          request: r,
          recordedPaid: recorded,
          paymentsSum: sum,
          delta,
          studentName: studentMap.get(r.studentId)?.name,
        });
      }
    }
    return rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [requests, paymentsByRequest, studentMap]);

  // ─── 4. Status mismatches: stored status vs computed status ────────────────
  const statusMismatches: StatusMismatchRow[] = useMemo(() => {
    const rows: StatusMismatchRow[] = [];
    for (const r of requests) {
      const totalRequired = (r.totalAmount || 0) + (r.fineAmount || 0) - (r.waivedAmount || 0);
      const paid = r.paidAmount || 0;
      let expected: FeeRequest['status'];
      if (paid <= 0.001) expected = 'pending';
      else if (paid + 0.001 >= totalRequired) expected = 'paid';
      else expected = 'partially_paid';
      if (r.status === 'overdue') continue;
      if (r.status !== expected) {
        rows.push({
          request: r,
          expectedStatus: expected,
          studentName: studentMap.get(r.studentId)?.name,
        });
      }
    }
    return rows;
  }, [requests, studentMap]);

  const healthy =
    orphans.length === 0 &&
    duplicates.length === 0 &&
    drift.length === 0 &&
    statusMismatches.length === 0;

  const totalIssues = orphans.length + duplicates.length + drift.length + statusMismatches.length;

  return (
    <div className="pad stack" style={{ gap: 'var(--space-5)' }}>
      {/* Topbar */}
      <div className="topbar">
        <div>
          <div className="eyebrow">Ledger Audit</div>
          <h1>Reconciliation</h1>
        </div>
        <div>
          <button
            className="btn ghost"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCcw style={{ width: 14, height: 14 }} className={loading ? 'animate-spin' : ''} />
            Re-run
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        <div className="card">
          <p className="eyebrow" style={{ marginBottom: 4 }}>Orphaned</p>
          <p className="t-num" style={{ fontSize: 28, fontWeight: 800, color: orphans.length ? 'var(--coral)' : 'var(--leaf)' }}>
            {orphans.length}
          </p>
          <p className="tiny muted">missing-request or wrong-student</p>
        </div>
        <div className="card">
          <p className="eyebrow" style={{ marginBottom: 4 }}>Duplicates</p>
          <p className="t-num" style={{ fontSize: 28, fontWeight: 800, color: duplicates.length ? 'var(--coral)' : 'var(--leaf)' }}>
            {duplicates.length}
          </p>
          <p className="tiny muted">same transaction ID used twice</p>
        </div>
        <div className="card">
          <p className="eyebrow" style={{ marginBottom: 4 }}>Sum Drift</p>
          <p className="t-num" style={{ fontSize: 28, fontWeight: 800, color: drift.length ? 'var(--accent)' : 'var(--leaf)' }}>
            {drift.length}
          </p>
          <p className="tiny muted">paidAmount ≠ payments sum</p>
        </div>
        <div className="card">
          <p className="eyebrow" style={{ marginBottom: 4 }}>Status Mismatch</p>
          <p className="t-num" style={{ fontSize: 28, fontWeight: 800, color: statusMismatches.length ? 'var(--accent)' : 'var(--leaf)' }}>
            {statusMismatches.length}
          </p>
          <p className="tiny muted">stored vs computed status differs</p>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem 0' }}>
          <div className="animate-spin" style={{ width: 28, height: 28, borderRadius: '50%', border: '3px solid var(--line)', borderTopColor: 'var(--accent)', margin: '0 auto' }} />
        </div>
      )}

      {/* Healthy state */}
      {!loading && healthy && (
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
          <CheckCircle2 style={{ width: 40, height: 40, margin: '0 auto 12px', color: 'var(--leaf)' }} />
          <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink)', marginBottom: 4 }}>Ledger is clean</p>
          <p className="muted">No orphaned payments, duplicate transactions, sum drift, or status mismatches found.</p>
        </div>
      )}

      {/* ─── Orphaned payments ─── */}
      {!loading && orphans.length > 0 && (
        <div>
          <div className="section-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileWarning style={{ width: 14, height: 14, color: 'var(--coral)' }} />
            Orphaned Payments
            <span className="chip" style={{ background: 'var(--coral)', color: '#fff', fontSize: 11, marginLeft: 4 }}>{orphans.length}</span>
          </div>
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            {orphans.map(({ payment, reason }) => (
              <div key={payment.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
                    {payment.receiptNumber || payment.id}
                  </p>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="mono tiny muted">{fmtDate(payment.date)}</span>
                    <span className="chip" style={{ fontSize: 11, background: 'color-mix(in srgb, var(--coral) 15%, transparent)', color: 'var(--coral)' }}>
                      {reason === 'missing-request' ? 'Missing fee request' : 'Wrong student'}
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p className="t-num" style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                    ₹{(payment.amount || 0).toLocaleString('en-IN')}
                  </p>
                  <p className="tiny muted capitalize">{(payment.method || '').replace(/_/g, ' ')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Duplicate transactions ─── */}
      {!loading && duplicates.length > 0 && (
        <div>
          <div className="section-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Copy style={{ width: 14, height: 14, color: 'var(--coral)' }} />
            Duplicate Transaction IDs
            <span className="chip" style={{ background: 'var(--coral)', color: '#fff', fontSize: 11, marginLeft: 4 }}>{duplicates.length}</span>
          </div>
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            {duplicates.map(d => (
              <div key={d.transactionId} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
                    {d.transactionId}
                  </p>
                  <p className="mono tiny muted">
                    Receipts: {d.payments.map(p => p.receiptNumber).join(', ')}
                  </p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p className="t-num" style={{ fontSize: 14, fontWeight: 700, color: 'var(--coral)' }}>
                    ₹{d.payments.reduce((s, p) => s + (p.amount || 0), 0).toLocaleString('en-IN')}
                  </p>
                  <span className="chip" style={{ fontSize: 11, background: 'color-mix(in srgb, var(--coral) 15%, transparent)', color: 'var(--coral)' }}>
                    {d.payments.length} dupes
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Sum drift ─── */}
      {!loading && drift.length > 0 && (
        <div>
          <div className="section-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Scale style={{ width: 14, height: 14, color: 'var(--accent)' }} />
            Paid-Amount Drift
            <span className="chip" style={{ background: 'var(--accent)', color: '#fff', fontSize: 11, marginLeft: 4 }}>{drift.length}</span>
          </div>
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            {drift.map(d => (
              <div key={d.request.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', marginBottom: 2 }}>
                    {d.studentName || d.request.studentId}
                  </p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="mono tiny muted">{fmtMonthYear(d.request.month)}</span>
                    <span className="tiny muted">Recorded ₹{d.recordedPaid.toLocaleString('en-IN')} · Sum ₹{d.paymentsSum.toLocaleString('en-IN')}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p className="t-num" style={{ fontSize: 15, fontWeight: 700, color: d.delta > 0 ? 'var(--coral)' : 'var(--accent)' }}>
                    {d.delta > 0 ? '+' : ''}₹{d.delta.toLocaleString('en-IN')}
                  </p>
                  <p className="tiny muted capitalize">{d.request.status.replace(/_/g, ' ')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Status mismatches ─── */}
      {!loading && statusMismatches.length > 0 && (
        <div>
          <div className="section-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GitBranch style={{ width: 14, height: 14, color: 'var(--accent)' }} />
            Status Mismatches
            <span className="chip" style={{ background: 'var(--accent)', color: '#fff', fontSize: 11, marginLeft: 4 }}>{statusMismatches.length}</span>
          </div>
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            {statusMismatches.map(m => {
              const total = (m.request.totalAmount || 0) + (m.request.fineAmount || 0) - (m.request.waivedAmount || 0);
              return (
                <div key={m.request.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', marginBottom: 2 }}>
                      {m.studentName || m.request.studentId}
                    </p>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="mono tiny muted">{fmtMonthYear(m.request.month)}</span>
                      <span className="chip" style={{ fontSize: 11, background: '#fef3c7', color: '#92400e' }}>
                        {m.request.status.replace(/_/g, ' ')}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>→</span>
                      <span className="chip" style={{ fontSize: 11, background: 'color-mix(in srgb, var(--leaf) 15%, transparent)', color: 'var(--leaf)' }}>
                        {m.expectedStatus.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p className="tiny muted">
                      ₹{(m.request.paidAmount || 0).toLocaleString('en-IN')} / ₹{total.toLocaleString('en-IN')}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* How to resolve */}
      {!loading && totalIssues > 0 && (
        <div className="card" style={{ background: 'color-mix(in srgb, #f59e0b 8%, transparent)', border: '1px solid color-mix(in srgb, #f59e0b 30%, transparent)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <AlertTriangle style={{ width: 16, height: 16, color: '#92400e', flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13, color: '#78350f' }}>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>How to resolve</p>
              <ul style={{ paddingLeft: 16, lineHeight: 1.7 }}>
                <li><b>Orphaned payments</b>: re-link to the correct fee request, or delete if accidental.</li>
                <li><b>Duplicate txns</b>: review receipts and remove the duplicate from the Payments page.</li>
                <li><b>Sum drift</b>: edit the fee request's paidAmount to match the sum of its payments (or rollback the stray payment).</li>
                <li><b>Status mismatches</b>: usually fix themselves on the next payment; otherwise re-save the fee request.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
