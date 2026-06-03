import { UserProfile, FeeRequest, FeePayment, Student, FineConfig } from '../../types';
import { CreditCard, Receipt, CheckCircle2, Download, Scale, ShieldOff } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, query, where, doc, orderBy, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { calculateFine } from '../../services/fineService';
import { generateFeeReceipt } from '../../lib/receiptGenerator';
import { useToast } from '../../components/Toast';
import { logActivity } from '../../services/activityService';
import { fmtDate } from '../../lib/utils';

interface StudentFeesProps {
  user: UserProfile;
}

declare global {
  interface Window { Razorpay: any; }
}

export default function StudentFees({ user }: StudentFeesProps) {
  const [feeRequests, setFeeRequests] = useState<FeeRequest[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [student, setStudent] = useState<Student | null>(null);
  const [fineConfig, setFineConfig] = useState<FineConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();
  const unsubRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    const studentId = user.studentId || user.schoolNumber;
    if (!studentId) { setLoading(false); return; }

    // Tear down any previous listeners before setting up new ones
    unsubRef.current.forEach(u => u());
    unsubRef.current = [];
    setLoading(true);

    // One-shot reads for data that doesn't change frequently
    Promise.all([
      getDoc(doc(db, 'students', studentId)),
      getDoc(doc(db, 'fine-config', 'global')),
    ]).then(([studentSnap, fineSnap]) => {
      if (studentSnap.exists()) setStudent({ id: studentSnap.id, ...studentSnap.data() } as Student);
      if (fineSnap.exists()) setFineConfig(fineSnap.data() as FineConfig);
    }).catch(err => handleFirestoreError(err, OperationType.GET, 'students'));

    // Live listeners for fee requests and payments
    const unsubRequests = onSnapshot(
      query(collection(db, 'feeRequests'), where('studentId', '==', studentId)),
      snap => {
        setFeeRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as FeeRequest)));
        setLoading(false);
      },
      err => handleFirestoreError(err, OperationType.LIST, 'feeRequests'),
    );

    const unsubPayments = onSnapshot(
      query(collection(db, 'feePayments'), where('studentId', '==', studentId), orderBy('date', 'desc')),
      snap => setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() } as FeePayment))),
      err => handleFirestoreError(err, OperationType.LIST, 'feePayments'),
    );

    unsubRef.current = [unsubRequests, unsubPayments];
    return () => { unsubRef.current.forEach(u => u()); };
  }, [user.uid]);

  const handleDownloadReceipt = (payment: FeePayment) => {
    const request = feeRequests.find(r => r.id === payment.feeRequestId);
    if (request && student) generateFeeReceipt(payment, request, student);
    else showToast('Could not find fee request details for this payment.', 'error');
  };

  const netDue = (r: FeeRequest) =>
    r.totalAmount + (fineConfig ? calculateFine(r, fineConfig) : 0) - (r.waivedAmount || 0) - (r.paidAmount || 0);

  const handlePayNow = async (request: FeeRequest) => {
    const remainingAmount = netDue(request);
    const amountInPaise = Math.round(remainingAmount * 100);
    if (amountInPaise < 100) { showToast('Minimum payment amount is ₹1.', 'error'); return; }

    let orderId: string;
    try {
      const orderRes = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountInPaise, feeRequestId: request.id, studentId: request.studentId }),
      });
      if (!orderRes.ok) throw new Error('Order creation failed');
      const { orderId: id } = await orderRes.json();
      orderId = id;
    } catch {
      showToast('Could not initiate payment. Please try again.', 'error');
      return;
    }

    const options = {
      key: (import.meta as any).env.VITE_RAZORPAY_KEY_ID || '',
      order_id: orderId,
      currency: 'INR',
      name: 'School Fee Payment',
      description: `Fees for ${request.month}`,
      theme: { color: '#0E0F11' },
      handler: async function (response: any) {
        const rzpPaymentId: string = response.razorpay_payment_id || '';
        try {
          const verifyRes = await fetch('/api/razorpay/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: rzpPaymentId,
              razorpay_signature: response.razorpay_signature,
              feeRequestId: request.id,
              studentId: request.studentId,
              classId: student?.classId || '',
              amount: remainingAmount,
              feeHead: request.heads[0]?.name || 'Academic Fee',
              month: request.month,
            }),
          });
          let body: any = {};
          try { body = await verifyRes.json(); } catch { /* non-JSON response */ }
          if (!verifyRes.ok) {
            showToast(
              `${body.error || 'Payment verification failed.'} Payment ID: ${rzpPaymentId}`,
              'error'
            );
            return;
          }
          logActivity(user, 'Paid Fees Online', 'Students', `Paid ₹${remainingAmount.toLocaleString()} for ${request.heads[0]?.name || 'Academic Fee'} via Razorpay`);
          showToast(`Payment successful! Receipt: ${body.receiptNumber}`, 'success');
          // No fetchData() needed — onSnapshot updates the UI automatically
        } catch {
          showToast(
            `Payment may have been processed but confirmation failed. Quote this ID to support: ${rzpPaymentId}`,
            'error'
          );
        }
      },
      prefill: { name: user.name, email: user.email },
    };
    const rzp = new window.Razorpay(options);
    rzp.open();
  };

  const outstandingAmount = feeRequests.filter(r => r.status !== 'paid').reduce((sum, r) => sum + netDue(r), 0);
  const currentRequest = feeRequests.find(r => r.status !== 'paid');
  const currentFine = currentRequest && fineConfig ? calculateFine(currentRequest, fineConfig) : 0;
  const currentDue = currentRequest ? netDue(currentRequest) : 0;

  return (
    <div className="pb-2">
      <div className="topbar">
        <div>
          <div className="eyebrow">Fees</div>
          <h1>{outstandingAmount > 0 ? 'Balance due.' : "You're clear."}</h1>
        </div>
      </div>

      {/* Hero */}
      <div className="pad" style={{ marginTop: 6 }}>
        <div className="card inked" style={{ position: 'relative', overflow: 'hidden' }}>
          <div className="flex between center">
            <span className="eyebrow" style={{ color: 'var(--cream)', opacity: 0.65 }}>Total outstanding</span>
            {currentRequest && <span className="mono small" style={{ opacity: 0.75 }}>{currentRequest.month}</span>}
          </div>
          <div className="t-num" style={{ fontSize: 44, marginTop: 12, lineHeight: 1 }}>
            {outstandingAmount > 0 ? <>₹{outstandingAmount.toLocaleString('en-IN')}</> : 'All cleared'}
          </div>
          {outstandingAmount > 0 && currentRequest ? (
            <>
              <div style={{ color: '#D7D3C5', marginTop: 6, fontSize: 13 }}>
                Due by {fmtDate(currentRequest.dueDate)}
              </div>
              <button onClick={() => handlePayNow(currentRequest)} className="btn accent" style={{ marginTop: 16 }}>
                <CreditCard size={16} /> Pay ₹{currentDue.toLocaleString('en-IN')}
              </button>
            </>
          ) : (
            <div style={{ color: '#D7D3C5', marginTop: 6, fontSize: 13 }}>No pending dues. Great job.</div>
          )}
          <div className="display" style={{ position: 'absolute', right: -8, bottom: -22, fontSize: 110, color: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }}>₹</div>
        </div>
      </div>

      {/* Current request breakdown */}
      {loading ? (
        <div className="pad" style={{ marginTop: 12 }}>
          <div className="card muted small" style={{ textAlign: 'center', padding: 24 }}>Loading…</div>
        </div>
      ) : currentRequest ? (
        <>
          <div className="section-head"><h2>This month</h2><span className="mono tiny muted">{currentRequest.month}</span></div>
          <div className="pad">
            <div className="card flush">
              {currentRequest.heads.map((head, i) => (
                <div key={i} className="row">
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{head.name}</div>
                    <div className="tiny muted" style={{ marginTop: 2 }}>Base ₹{head.amount} · Disc ₹{head.discount}</div>
                  </div>
                  <div className="bold">₹{(head.finalAmount || 0).toLocaleString('en-IN')}</div>
                </div>
              ))}
              <div style={{ padding: 16, background: 'var(--cream-2)' }}>
                {currentFine > 0 && (
                  <div className="flex between" style={{ marginBottom: 6 }}>
                    <span className="small flex center gap-8" style={{ color: 'var(--coral)' }}><Scale size={14} /> Late fine</span>
                    <span className="bold" style={{ color: 'var(--coral)' }}>+ ₹{currentFine.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {(currentRequest.waivedAmount || 0) > 0 && (
                  <div className="flex between" style={{ marginBottom: 6 }}>
                    <span className="small flex center gap-8" style={{ color: 'var(--leaf)' }}><ShieldOff size={14} /> Waiver</span>
                    <span className="bold" style={{ color: 'var(--leaf)' }}>- ₹{currentRequest.waivedAmount!.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {(currentRequest.paidAmount || 0) > 0 && (
                  <div className="flex between small muted" style={{ marginBottom: 6 }}>
                    <span>Previously paid</span>
                    <span>- ₹{currentRequest.paidAmount!.toLocaleString('en-IN')}</span>
                  </div>
                )}
                <div className="flex between center" style={{ paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                  <span className="bold">Net balance due</span>
                  <span className="t-num" style={{ fontSize: 22 }}>₹{currentDue.toLocaleString('en-IN')}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="pad" style={{ marginTop: 12 }}>
          <div className="card flex center" style={{ gap: 14, padding: 18 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--cream-2)', display: 'grid', placeItems: 'center' }}>
              <CheckCircle2 size={22} style={{ color: 'var(--leaf)' }} />
            </div>
            <div>
              <div className="bold">All dues cleared</div>
              <div className="small muted">No pending fee requests right now.</div>
            </div>
          </div>
        </div>
      )}

      {/* Payment history */}
      <div className="section-head"><h2>Payment history</h2>{payments.length > 0 && <span className="mono tiny muted">{payments.length}</span>}</div>
      <div className="pad stack">
        {payments.length === 0 ? (
          <div className="card muted small" style={{ textAlign: 'center', padding: 24 }}>No payment records yet.</div>
        ) : (
          payments.map((tx) => (
            <div key={tx.id} className="card flex center" style={{ gap: 12, padding: '14px 16px' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--cream-2)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Receipt size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="bold">₹{(tx.amount || 0).toLocaleString('en-IN')}</div>
                <div className="tiny muted" style={{ marginTop: 2 }}>{tx.receiptNumber} · {fmtDate(tx.date)} · {tx.method.replace(/_/g, ' ')}</div>
              </div>
              <button onClick={() => handleDownloadReceipt(tx)} className="icon-btn" aria-label="Download receipt" title="Download receipt">
                <Download size={16} />
              </button>
            </div>
          ))
        )}
      </div>

      <div style={{ height: 16 }} />
    </div>
  );
}
