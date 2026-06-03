import { UserProfile, Student, FeeRequest, FeePayment, FineConfig, AdvancePayment, FeeStructure, FeeHead } from '../../types';
import { CreditCard, IndianRupee, Receipt, AlertCircle, CheckCircle2, Clock, Download, Wallet, Scale, ShieldOff, CalendarDays, MessageSquare } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, getDocs, query, where, doc, orderBy, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { calculateFine, getEffectiveTotal } from '../../services/fineService';
import { getAdvancePaymentsForStudent } from '../../services/advancePaymentService';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { generateFeeReceipt } from '../../lib/receiptGenerator';
import { fmtDate } from '../../lib/utils';
import { useToast } from '../../components/Toast';
import { logActivity } from '../../services/activityService';
import {
  Alert,
  Spinner,
  Modal,
  FormField,
  Input,
  Textarea,
  Button,
  Table,
  Thead,
  Th,
  Tbody,
  Tr,
  Td,
  EmptyState,
  IconButton,
  Badge,
} from '../../components/ui';

interface ParentFeesProps {
  user: UserProfile;
  selectedStudent: Student | null;
}

declare global {
  interface Window {
    Razorpay: any;
  }
}

export default function ParentFees({ user, selectedStudent }: ParentFeesProps) {
  const [feeRequests, setFeeRequests] = useState<FeeRequest[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [fineConfig, setFineConfig] = useState<FineConfig | null>(null);
  const [advancePayments, setAdvancePayments] = useState<AdvancePayment[]>([]);
  const [availableHeads, setAvailableHeads] = useState<FeeHead[]>([]);
  const [loading, setLoading] = useState(false);

  // Advance payment modal state (parent-initiated, online)
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [advanceSelectedMonths, setAdvanceSelectedMonths] = useState<string[]>([]);
  const [advanceSelectedHeads, setAdvanceSelectedHeads] = useState<string[]>([]);
  const [advanceProcessing, setAdvanceProcessing] = useState(false);

  // Partial payment request state
  const [partialReqModal, setPartialReqModal] = useState<{
    isOpen: boolean; requestId: string; maxAmount: number;
  }>({ isOpen: false, requestId: '', maxAmount: 0 });
  const [partialReqData, setPartialReqData] = useState({
    amount: '', reason: '', committedDate: '',
  });
  const [partialReqLoading, setPartialReqLoading] = useState(false);

  const { showToast } = useToast();
  const unsubRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    if (!selectedStudent?.id) return;

    // Tear down previous student's listeners
    unsubRef.current.forEach(u => u());
    unsubRef.current = [];
    setLoading(true);

    // One-shot reads for data that changes rarely
    Promise.all([
      getDoc(doc(db, 'fine-config', 'global')),
      getAdvancePaymentsForStudent(selectedStudent.id).catch(() => [] as AdvancePayment[]),
      getDocs(query(collection(db, 'feeStructures'), where('classId', '==', selectedStudent.classId))).catch(() => null),
    ]).then(([fineSnap, advances, structSnap]) => {
      if (fineSnap.exists()) setFineConfig(fineSnap.data() as FineConfig);
      setAdvancePayments(advances);
      if (structSnap && !structSnap.empty) {
        setAvailableHeads((structSnap.docs[0].data() as FeeStructure).heads || []);
      } else {
        getDocs(collection(db, 'feeHeads'))
          .then(s => setAvailableHeads(s.docs.map(d => d.data() as FeeHead)))
          .catch(() => setAvailableHeads([]));
      }
    }).catch(err => console.error('Error loading parent fee static data:', err));

    // Live listeners for fee requests and payments
    const unsubRequests = onSnapshot(
      query(collection(db, 'feeRequests'), where('studentId', '==', selectedStudent.id)),
      snap => {
        setFeeRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as FeeRequest)));
        setLoading(false);
      },
      err => handleFirestoreError(err, OperationType.LIST, 'feeRequests'),
    );

    const unsubPayments = onSnapshot(
      query(collection(db, 'feePayments'), where('studentId', '==', selectedStudent.id), orderBy('date', 'desc')),
      snap => setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() } as FeePayment))),
      err => handleFirestoreError(err, OperationType.LIST, 'feePayments'),
    );

    unsubRef.current = [unsubRequests, unsubPayments];
    return () => { unsubRef.current.forEach(u => u()); };
  }, [selectedStudent?.id]);

  const handleSubmitPartialRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(partialReqData.amount);
    if (!amount || amount <= 0 || amount >= partialReqModal.maxAmount) {
      showToast(`Enter an amount between ₹1 and ₹${(partialReqModal.maxAmount - 1).toLocaleString()}`, 'error');
      return;
    }
    if (!partialReqData.reason.trim()) { showToast('Please enter a reason', 'error'); return; }
    if (!partialReqData.committedDate) { showToast('Please enter a committed payment date', 'error'); return; }
    setPartialReqLoading(true);
    try {
      await updateDoc(doc(db, 'feeRequests', partialReqModal.requestId), {
        partialPaymentRequest: {
          requestedAmount: amount,
          reason: partialReqData.reason.trim(),
          committedDate: partialReqData.committedDate,
          requestedAt: new Date().toISOString(),
          status: 'pending',
        },
      });
      logActivity(user, 'Partial Payment Request', 'Parents',
        `Requested ₹${amount.toLocaleString()} partial — committed by ${partialReqData.committedDate}`);
      try {
        const phone = selectedStudent?.parentDetails?.phone;
        if (phone) {
          await fetch('/api/whatsapp/send-template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone,
              templateName: 'partial_payment_request',
              parameters: [
                selectedStudent?.parentDetails?.fatherName || user.name,
                selectedStudent?.name || '',
                `₹${amount.toLocaleString('en-IN')}`,
                partialReqData.committedDate,
                partialReqData.reason,
              ],
            }),
          });
        }
      } catch { /* non-fatal */ }
      showToast('Partial payment request submitted — the accountant will process it.', 'success');
      setPartialReqModal({ isOpen: false, requestId: '', maxAmount: 0 });
      setPartialReqData({ amount: '', reason: '', committedDate: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'feeRequests');
    } finally {
      setPartialReqLoading(false);
    }
  };

  const handleDownloadReceipt = (payment: FeePayment) => {
    const request = feeRequests.find(r => r.id === payment.feeRequestId);
    if (request && selectedStudent) {
      generateFeeReceipt(payment, request, selectedStudent);
    } else {
      showToast('Could not find fee request details for this payment.', 'error');
    }
  };

  const handlePayNow = async (request: FeeRequest) => {
    if (!window.Razorpay) {
      showToast('Payment gateway is loading. Please try again in a few seconds.', 'error');
      return;
    }

    const currentFine = fineConfig ? calculateFine(request, fineConfig) : 0;
    const remainingAmount = request.totalAmount + currentFine - (request.waivedAmount || 0) - (request.paidAmount || 0);
    if (remainingAmount <= 0) {
      showToast('This fee request is already fully paid.', 'info');
      return;
    }

    const amountInPaise = Math.round(remainingAmount * 100);
    if (amountInPaise < 100) {
      showToast('Minimum payment amount is ₹1.', 'error');
      return;
    }

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
      description: `Fees for ${request.month} - ${selectedStudent?.name}`,
      theme: { color: '#EF4444' },
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
              classId: selectedStudent?.classId || '',
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
          logActivity(user, 'Paid Fees Online', 'Parents', `Paid ₹${remainingAmount.toLocaleString()} for ${request.heads[0]?.name || 'Academic Fee'} via Razorpay`);
          showToast(`Payment successful! Receipt: ${body.receiptNumber}`, 'success');
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

  // ── Advance payment helpers ────────────────────────────────────────────────

  const getUpcomingMonths = (): string[] => {
    const months: string[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push(d.toLocaleString('default', { month: 'long', year: 'numeric' }));
    }
    return months;
  };

  const calcAdvanceTotal = (): { perMonth: number; total: number } => {
    const perMonth = availableHeads
      .filter(h => advanceSelectedHeads.includes(h.name))
      .reduce((s, h) => s + (h.amount || 0), 0);
    return { perMonth, total: perMonth * advanceSelectedMonths.length };
  };

  const monthsAlreadyCovered = (): Set<string> => {
    const s = new Set<string>();
    advancePayments.forEach(adv =>
      (adv.monthlyBreakdown || []).forEach(e => {
        if (!e.consumed) s.add(e.month);
      })
    );
    return s;
  };

  const openAdvanceModal = () => {
    setAdvanceSelectedMonths([]);
    setAdvanceSelectedHeads([]);
    setIsAdvanceModalOpen(true);
  };

  const handlePayAdvanceOnline = async () => {
    if (!selectedStudent) return;
    if (advanceSelectedMonths.length === 0) {
      showToast('Pick at least one month', 'info');
      return;
    }
    if (advanceSelectedHeads.length === 0) {
      showToast('Pick at least one fee head', 'info');
      return;
    }
    if (!window.Razorpay) {
      showToast('Payment gateway is loading. Please try again.', 'error');
      return;
    }

    const { total } = calcAdvanceTotal();
    const amountInPaise = Math.round(total * 100);
    if (amountInPaise < 100) {
      showToast('Minimum payment is ₹1', 'error');
      return;
    }

    const monthlyBreakdown = advanceSelectedMonths.map(m => ({
      month: m,
      heads: availableHeads
        .filter(h => advanceSelectedHeads.includes(h.name))
        .map(h => ({ name: h.name, amount: h.amount })),
    }));

    setAdvanceProcessing(true);
    try {
      const orderRes = await fetch('/api/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountInPaise,
          kind: 'advance',
          studentId: selectedStudent.id,
        }),
      });
      if (!orderRes.ok) {
        showToast('Could not initiate payment. Try again.', 'error');
        setAdvanceProcessing(false);
        return;
      }
      const { orderId } = await orderRes.json();

      // Persist the advance intent so the server-side webhook can record the
      // payment even if the app is reloaded/backgrounded before the client
      // handler fires. The webhook reads pendingAdvanceOrders/{orderId}.
      try {
        await setDoc(doc(db, 'pendingAdvanceOrders', orderId), {
          studentId: selectedStudent.id,
          classId: selectedStudent.classId,
          parentId: user.uid,
          academicYear: '2024-25',
          monthlyBreakdown,
          totalAmount: total,
          remarks: 'Online advance via parent portal',
          createdAt: new Date().toISOString(),
        });
      } catch { /* non-blocking — client path still works without this */ }

      const options = {
        key: (import.meta as any).env.VITE_RAZORPAY_KEY_ID || '',
        order_id: orderId,
        currency: 'INR',
        name: 'School Fee — Advance',
        description: `Advance for ${advanceSelectedMonths.join(', ')}`,
        theme: { color: '#7C3AED' },
        handler: async (response: any) => {
          try {
            const verifyRes = await fetch('/api/razorpay/verify-advance-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                studentId: selectedStudent.id,
                classId: selectedStudent.classId,
                parentId: user.uid,
                academicYear: '2024-25',
                monthlyBreakdown,
                totalAmount: total,
                remarks: `Online advance via parent portal`,
              }),
            });
            if (!verifyRes.ok) {
              const err = await verifyRes.json();
              showToast(err.error || 'Verification failed. Contact support.', 'error');
              return;
            }
            const { receiptNumber } = await verifyRes.json();
            logActivity(user, 'Paid Advance Online', 'Parents',
              `Paid ₹${total.toLocaleString('en-IN')} advance for ${advanceSelectedMonths.length} month(s) via Razorpay`);
            showToast(`Advance payment successful! Receipt: ${receiptNumber}`, 'success');
            setIsAdvanceModalOpen(false);
          } catch (err) {
            console.error('verify-advance failed', err);
            showToast('Could not record advance — contact support', 'error');
          } finally {
            setAdvanceProcessing(false);
          }
        },
        modal: {
          ondismiss: () => setAdvanceProcessing(false),
        },
        prefill: {
          name: selectedStudent.parentDetails?.fatherName || user.name,
          email: selectedStudent.parentDetails?.email,
          contact: selectedStudent.parentDetails?.phone,
        },
      };
      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) {
      console.error('advance order failed', err);
      showToast('Could not initiate advance payment', 'error');
      setAdvanceProcessing(false);
    }
  };

  if (!selectedStudent) return null;

  const outstandingAmount = feeRequests
    .filter(r => r.status !== 'paid')
    .reduce((sum, r) => sum + (r.totalAmount + (fineConfig ? calculateFine(r, fineConfig) : 0) - (r.waivedAmount || 0) - (r.paidAmount || 0)), 0);

  const currentRequest = feeRequests.find(r => r.status !== 'paid' && r.status !== 'overdue') || feeRequests.find(r => r.status === 'overdue');
  const currentFineForRequest = currentRequest && fineConfig ? calculateFine(currentRequest, fineConfig) : 0;

  return (
    <div className="pad stack" style={{ '--stack-gap': '20px' } as React.CSSProperties}>
      {/* Topbar */}
      <div className="topbar">
        <div>
          <p className="eyebrow">{selectedStudent.name}</p>
          <h1 className="display" style={{ fontSize: 22 }}>Fees</h1>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : (
        <>
          {/* Hero outstanding card */}
          <div
            className="card"
            style={{
              background: outstandingAmount > 0 ? 'var(--ink)' : 'var(--paper)',
              color: outstandingAmount > 0 ? 'var(--cream)' : 'var(--ink)',
            }}
          >
            <p className="eyebrow" style={{ color: outstandingAmount > 0 ? 'var(--cream-2)' : 'var(--ink-3)' }}>
              Total Outstanding
            </p>
            <p className="t-num display" style={{ fontSize: 36, lineHeight: 1.1, marginTop: 4 }}>
              ₹{(outstandingAmount || 0).toLocaleString('en-IN')}
            </p>
            {outstandingAmount === 0 && (
              <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
                <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--leaf)' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--leaf)' }}>All dues cleared!</span>
              </div>
            )}
          </div>

          {/* Current fee request breakdown */}
          {currentRequest ? (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: '1px solid var(--line)', background: 'var(--cream-2)' }}
              >
                <div className="flex items-center gap-2">
                  <Receipt className="w-4 h-4" style={{ color: 'var(--ink-3)' }} />
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Current Fee Request</span>
                </div>
                <span className="eyebrow">{currentRequest.month}</span>
              </div>

              <div style={{ borderBottom: '1px solid var(--line)' }}>
                {currentRequest.heads.map((head, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-4 py-3"
                    style={{ borderBottom: i < currentRequest.heads.length - 1 ? '1px solid var(--line)' : 'none' }}
                  >
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700 }}>{head.name}</p>
                      <p className="tiny muted">Base ₹{head.amount} · Disc ₹{head.discount}</p>
                    </div>
                    <p className="t-num" style={{ fontWeight: 800 }}>₹{(head.finalAmount || 0).toLocaleString()}</p>
                  </div>
                ))}
              </div>

              <div className="px-4 py-3" style={{ background: 'var(--cream-2)' }}>
                {currentFineForRequest > 0 && (
                  <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                    <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--coral)' }}>
                      <Scale className="w-3.5 h-3.5" /> Late Fine
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--coral)' }}>
                      + ₹{currentFineForRequest.toLocaleString()}
                    </span>
                  </div>
                )}
                {(currentRequest.waivedAmount || 0) > 0 && (
                  <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                    <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--leaf)' }}>
                      <ShieldOff className="w-3.5 h-3.5" /> Waiver
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--leaf)' }}>
                      - ₹{currentRequest.waivedAmount!.toLocaleString()}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between" style={{ borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Balance Due</span>
                  <span className="t-num" style={{ fontSize: 20, fontWeight: 900, color: 'var(--coral)' }}>
                    ₹{(currentRequest.totalAmount + currentFineForRequest - (currentRequest.waivedAmount || 0) - (currentRequest.paidAmount || 0)).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="px-4 py-3 stack" style={{ '--stack-gap': '8px' } as React.CSSProperties}>
                <button
                  onClick={() => handlePayNow(currentRequest)}
                  className="btn accent w-full flex items-center justify-center gap-2"
                  style={{ padding: '12px 0', fontSize: 14 }}
                >
                  <CreditCard className="w-4 h-4" />
                  Pay Now — ₹{(currentRequest.totalAmount + currentFineForRequest - (currentRequest.waivedAmount || 0) - (currentRequest.paidAmount || 0)).toLocaleString()}
                </button>
                {currentRequest.status !== 'paid' && !currentRequest.partialPaymentRequest && (
                  <button
                    onClick={() => {
                      const remaining = currentRequest.totalAmount - (currentRequest.waivedAmount || 0) - (currentRequest.paidAmount || 0);
                      setPartialReqModal({ isOpen: true, requestId: currentRequest.id, maxAmount: remaining });
                      setPartialReqData({ amount: '', reason: '', committedDate: '' });
                    }}
                    className="btn ghost w-full flex items-center justify-center gap-1.5"
                    style={{ padding: '10px 0', fontSize: 13 }}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Request Partial Payment
                  </button>
                )}
                {currentRequest.partialPaymentRequest?.status === 'pending' && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: '#fef3c7', border: '1px solid #fde68a' }}>
                    <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: '#d97706' }} />
                    <p style={{ fontSize: 11, color: '#92400e', fontWeight: 500 }}>
                      Partial request of ₹{currentRequest.partialPaymentRequest.requestedAmount.toLocaleString()} pending.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="card flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#d1fae5' }}>
                <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--leaf)' }} />
              </div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 700 }}>All Dues Cleared!</p>
                <p className="tiny muted">No pending fee requests for {selectedStudent.name}.</p>
              </div>
            </div>
          )}

          {/* Advance Payments */}
          <div>
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <p className="eyebrow">Advance Payments</p>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)' }}>
                {advancePayments.length} record(s)
              </span>
            </div>

            {advancePayments.length === 0 ? (
              <div className="card">
                <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>No advance payments made yet.</p>
                {availableHeads.length > 0 && (
                  <>
                    <div className="stack" style={{ '--stack-gap': '6px', marginTop: 12 } as React.CSSProperties}>
                      {availableHeads.map(h => (
                        <div key={h.name} className="flex items-center justify-between">
                          <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{h.name}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--leaf)' }}>
                            ₹{h.amount.toLocaleString('en-IN')}/mo
                          </span>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={openAdvanceModal}
                      className="btn accent flex items-center gap-1.5"
                      style={{ marginTop: 12, fontSize: 13, padding: '8px 16px' }}
                    >
                      <CreditCard className="w-3.5 h-3.5" /> Pay in Advance Online
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="stack" style={{ '--stack-gap': '8px' } as React.CSSProperties}>
                {advancePayments.map(adv => (
                  <div key={adv.id} className="card" style={{ padding: '12px 16px' }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Wallet className="w-4 h-4" style={{ color: 'var(--ink-3)' }} />
                        <span style={{ fontSize: 12, fontWeight: 700 }}>{adv.receiptNumber}</span>
                      </div>
                      <span className="t-num" style={{ fontSize: 16, fontWeight: 900 }}>
                        ₹{adv.totalAmount.toLocaleString('en-IN')}
                      </span>
                    </div>
                    <p className="tiny muted" style={{ marginTop: 4 }}>
                      {fmtDate(adv.date)} · {adv.paymentMethod.replace('_', ' ')}
                    </p>
                    <div className="flex flex-wrap gap-1" style={{ marginTop: 8 }}>
                      {(adv.monthlyBreakdown || []).map(e => (
                        <span
                          key={e.month}
                          className="chip"
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 99,
                            background: e.consumed ? '#d1fae5' : 'var(--cream-2)',
                            color: e.consumed ? '#065f46' : 'var(--ink-2)',
                          }}
                        >
                          {e.month.split(' ')[0].slice(0, 3)} {e.month.split(' ')[1]?.slice(-2)}
                          {e.consumed && ' ✓'}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {availableHeads.length > 0 && (
                  <button
                    onClick={openAdvanceModal}
                    className="btn ghost flex items-center justify-center gap-1.5 w-full"
                    style={{ padding: '10px 0', fontSize: 13 }}
                  >
                    <CreditCard className="w-3.5 h-3.5" /> Pay More in Advance
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Payment History */}
          <div>
            <p className="eyebrow" style={{ marginBottom: 10 }}>Payment History</p>
            {payments.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '24px' }}>
                <p className="muted" style={{ fontSize: 13 }}>No payment records yet.</p>
              </div>
            ) : (
              <div className="stack" style={{ '--stack-gap': '8px' } as React.CSSProperties}>
                {payments.map((tx) => (
                  <div key={tx.id} className="card flex items-center gap-3" style={{ padding: '12px 16px' }}>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--cream-2)' }}>
                      <Receipt className="w-4 h-4" style={{ color: 'var(--ink-3)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: 14, fontWeight: 700 }}>₹{(tx.amount || 0).toLocaleString()}</p>
                      <p className="tiny muted">{tx.receiptNumber} · {fmtDate(tx.date)}</p>
                      <p className="tiny muted capitalize">{tx.method.replace('_', ' ')}</p>
                    </div>
                    <button
                      onClick={() => handleDownloadReceipt(tx)}
                      className="icon-btn"
                      aria-label="Download receipt"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Pay in Advance Online Modal */}
      <Modal
        isOpen={isAdvanceModalOpen}
        onClose={() => !advanceProcessing && setIsAdvanceModalOpen(false)}
        title="Pay Fee in Advance"
        subtitle={`For ${selectedStudent.name} · Online payment via Razorpay`}
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-3 w-full">
            <div className="text-xs text-slate-500">
              <span className="font-bold text-slate-700">
                {advanceSelectedMonths.length} month(s) × ₹{calcAdvanceTotal().perMonth.toLocaleString('en-IN')}
              </span>
              <span className="mx-1.5">=</span>
              <span className="text-base font-black text-violet-700">
                ₹{calcAdvanceTotal().total.toLocaleString('en-IN')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setIsAdvanceModalOpen(false)} disabled={advanceProcessing}>
                Cancel
              </Button>
              <Button
                variant="primary"
                icon={CreditCard}
                loading={advanceProcessing}
                onClick={handlePayAdvanceOnline}
              >
                Pay ₹{calcAdvanceTotal().total.toLocaleString('en-IN')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          <Alert variant="info">
            Pre-pay your child's fees for upcoming months. Once paid, the school will not generate a fee request for the covered heads in those months — and no late penalty applies.
          </Alert>

          <FormField label="Pick the months you want to pre-pay" required>
            <div className="grid grid-cols-3 md:grid-cols-4 gap-2 mt-1">
              {getUpcomingMonths().map(m => {
                const alreadyCovered = monthsAlreadyCovered().has(m);
                const selected = advanceSelectedMonths.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={alreadyCovered}
                    onClick={() =>
                      setAdvanceSelectedMonths(prev =>
                        selected ? prev.filter(x => x !== m) : [...prev, m]
                      )
                    }
                    className={`px-2 py-2 rounded-lg text-[11px] font-bold border transition-all ${
                      alreadyCovered
                        ? 'bg-slate-100 text-slate-400 border-slate-200 line-through cursor-not-allowed'
                        : selected
                        ? 'bg-violet-600 text-white border-violet-600 shadow-md'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-violet-400 hover:bg-violet-50'
                    }`}
                    title={alreadyCovered ? 'Already paid in advance' : ''}
                  >
                    <CalendarDays className="w-3 h-3 inline mb-0.5 mr-1" />
                    {m.split(' ')[0].slice(0, 3)} '{m.split(' ')[1]?.slice(-2)}
                  </button>
                );
              })}
            </div>
          </FormField>

          <FormField label="Pick the fee heads to include" required hint="Synced from the school's fee structure for your child's class">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
              {availableHeads.map(h => {
                const selected = advanceSelectedHeads.includes(h.name);
                return (
                  <button
                    key={h.name}
                    type="button"
                    onClick={() =>
                      setAdvanceSelectedHeads(prev =>
                        selected ? prev.filter(x => x !== h.name) : [...prev, h.name]
                      )
                    }
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-all ${
                      selected
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-400 hover:bg-indigo-50'
                    }`}
                  >
                    <span className="text-xs font-bold">{h.name}</span>
                    <span className={`text-xs font-bold ${selected ? 'text-white' : 'text-emerald-600'}`}>
                      ₹{h.amount.toLocaleString('en-IN')}/mo
                    </span>
                  </button>
                );
              })}
            </div>
            {availableHeads.length === 0 && (
              <p className="text-xs text-rose-600 mt-2">
                No fee structure is set for your child's class. Please contact the school office.
              </p>
            )}
          </FormField>
        </div>
      </Modal>

      {/* Partial Payment Request Modal */}
      <Modal
        isOpen={partialReqModal.isOpen}
        onClose={() => !partialReqLoading && setPartialReqModal({ isOpen: false, requestId: '', maxAmount: 0 })}
        title="Request Partial Payment"
        subtitle="The accountant will process your request and collect the amount"
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => setPartialReqModal({ isOpen: false, requestId: '', maxAmount: 0 })} disabled={partialReqLoading}>
              Cancel
            </Button>
            <Button variant="primary" loading={partialReqLoading} onClick={(e: any) => {
              const form = document.querySelector('form[data-partial-req-form]') as HTMLFormElement;
              if (form) form.requestSubmit();
            }}>
              Submit Request
            </Button>
          </div>
        }
      >
        <form onSubmit={handleSubmitPartialRequest} data-partial-req-form className="space-y-4">
          <FormField label={`Amount to Pay Now (₹)`} required hint={`Must be less than the full balance of ₹${partialReqModal.maxAmount.toLocaleString()}`}>
            <Input
              type="number"
              required
              min={1}
              max={partialReqModal.maxAmount - 1}
              value={partialReqData.amount}
              onChange={e => setPartialReqData(d => ({ ...d, amount: e.target.value }))}
              placeholder="e.g. 2000"
            />
          </FormField>
          <FormField label="Reason for Partial Payment" required>
            <Textarea
              required
              rows={2}
              value={partialReqData.reason}
              onChange={e => setPartialReqData(d => ({ ...d, reason: e.target.value }))}
              placeholder="e.g. Financial difficulty this month — will pay balance next week"
            />
          </FormField>
          <FormField label="Committed Date for Remaining Balance" required hint="Date by which you commit to pay the remaining amount">
            <Input
              type="date"
              required
              value={partialReqData.committedDate}
              min={new Date().toISOString().split('T')[0]}
              onChange={e => setPartialReqData(d => ({ ...d, committedDate: e.target.value }))}
            />
          </FormField>
          <div className="flex items-start gap-2.5 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <AlertCircle className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-[10px] text-blue-700">
              This is a request — not a payment. The accountant will review and collect the amount. You will receive a WhatsApp confirmation.
            </p>
          </div>
        </form>
      </Modal>
    </div>
  );
}
