import { UserProfile, Student, Class, Fee, FeePayment, FeeRequest, FeeStructure, PaymentMethod, FeeHead, FineConfig } from '../../types';
import { Download, IndianRupee, CheckCircle2, Clock, AlertCircle, Plus, Receipt, Trash2, History, ShieldOff, Scale, MessageSquare, Search, Users, ChevronDown, ChevronUp, Wallet, CalendarDays } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where, addDoc, updateDoc, doc, setDoc, deleteDoc, getDoc, runTransaction, onSnapshot } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { calculateFine, getEffectiveTotal } from '../../services/fineService';
import { getSchoolSettings, computeDefaultFeeDueDate, getReceiptTypeConfig } from '../../services/settingsService';
import { getNextReceiptNumber, receiptCounterRef, nextReceiptNumberFromSnap, formatReceiptNumber } from '../../services/receiptCounterService';
import {
  getUnconsumedForMonth,
  consumeAdvanceEntry,
  createAdvancePayment,
  buildAdvanceApplicationPayment,
  getAdvancePaymentsForStudent,
} from '../../services/advancePaymentService';
import { db, storage, handleFirestoreError, OperationType } from '../../firebase';
import { generateFeeReceipt } from '../../lib/receiptGenerator';
import { createPdf, addFooter, TABLE_STYLES } from '../../lib/pdfTemplate';
import { savePdf } from '../../lib/download';
import { fmtMonthYear, fmtDate, sortByClassName, sortByName } from '../../lib/utils';
import { useToast } from '../../components/Toast';
import { PaymentSuccess, StaggeredList } from '../../components/animations';
import { logActivity } from '../../services/activityService';
import {
  Badge,
  Button,
  IconButton,
  Modal,
  FormField,
  Input,
  Select,
  Textarea,
  Avatar,
} from '../../components/ui';

interface FeeCollectionProps {
  user: UserProfile;
}

export default function FeeCollection({ user }: FeeCollectionProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClass, setSelectedClass] = useState('all');
  const [students, setStudents] = useState<Student[]>([]);
  const [paymentSuccess, setPaymentSuccess] = useState<{ amount: number; receiptNumber?: string } | null>(null);
  const [feeRequests, setFeeRequests] = useState<FeeRequest[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [feeStructures, setFeeStructures] = useState<FeeStructure[]>([]);
  const [globalHeads, setGlobalHeads] = useState<FeeHead[]>([]);
  const [fineConfig, setFineConfig] = useState<FineConfig | null>(null);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isOpenPayment, setIsOpenPayment] = useState(false); // true = no linked feeRequest (past/open payment)
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [isEditingRequest, setIsEditingRequest] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [captureForRequestId, setCaptureForRequestId] = useState<string | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const { showToast } = useToast();

  const [paymentData, setPaymentData] = useState({
    amount: '',
    head: 'Tuition Fees',
    openHead: '',   // used when isOpenPayment = true (free-form fee head)
    method: 'cash' as PaymentMethod,
    date: new Date().toISOString().split('T')[0],
    referenceNumber: '',
    remarks: '',
    voucherNumber: '',
    voucherImage: null as File | null,
  });

  // Advance payment modal state
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [advanceStudent, setAdvanceStudent] = useState<Student | null>(null);
  const [advanceData, setAdvanceData] = useState({
    selectedMonths: [] as string[],
    selectedHeads: [] as string[],
    method: 'cash' as PaymentMethod,
    date: new Date().toISOString().split('T')[0],
    referenceNumber: '',
    voucherNumber: '',
    voucherImage: null as File | null,
    remarks: '',
  });
  const [advanceLoading, setAdvanceLoading] = useState(false);
  const [advancePayments, setAdvancePayments] = useState<any[]>([]);

  const [waiverData, setWaiverData] = useState({
    amount: '',
    reason: '',
    isOpen: false,
    requestId: '',
    studentName: ''
  });

  const [customHeadForm, setCustomHeadForm] = useState({ name: '', amount: '' });
  const [addGlobalHeadId, setAddGlobalHeadId] = useState('');
  const [defaultFeeDueDay, setDefaultFeeDueDay] = useState<number>(10);

  // Past/open payment heads builder (custom heads + discounts with reason)
  type EditableHead = { name: string; amount: number; discount: number; discountReason?: string; finalAmount: number; isCustom?: boolean };
  const [openHeads, setOpenHeads] = useState<EditableHead[]>([]);
  const [openCustomHead, setOpenCustomHead] = useState({ name: '', amount: '' });
  const [openAddGlobalHeadId, setOpenAddGlobalHeadId] = useState('');
  const [requestData, setRequestData] = useState<{
    month: string;
    dueDate: string;
    heads: { name: string; amount: number; discount: number; discountReason?: string; finalAmount: number; isCustom?: boolean }[];
  }>({
    month: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
    dueDate: computeDefaultFeeDueDate(10),
    heads: [],
  });

  const fetchData = () => {
    // No-op: live data via onSnapshot. Kept so existing call sites still type-check.
  };

  useEffect(() => {
    setLoading(true);
    const onErr = (err: any) => { handleFirestoreError(err, OperationType.LIST, 'feeRequests'); setLoading(false); };

    const unsubs = [
      onSnapshot(collection(db, 'students'), (s) => setStudents(sortByName(s.docs.map(d => ({ id: d.id, ...d.data() } as Student)))), onErr),
      onSnapshot(collection(db, 'feeRequests'), (s) => { setFeeRequests(s.docs.map(d => ({ id: d.id, ...d.data() } as FeeRequest))); setLoading(false); }, onErr),
      onSnapshot(collection(db, 'feePayments'), (s) => {
        const sorted = s.docs.map(d => ({ id: d.id, ...d.data() } as FeePayment))
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setPayments(sorted);
      }, onErr),
      onSnapshot(collection(db, 'feeStructures'), (s) => setFeeStructures(s.docs.map(d => ({ id: d.id, ...d.data() } as FeeStructure))), onErr),
      onSnapshot(collection(db, 'classes'), (s) => setClasses(sortByClassName(s.docs.map(d => ({ id: d.id, ...d.data() } as Class)))), onErr),
      onSnapshot(collection(db, 'feeHeads'), (s) => setGlobalHeads(s.docs.map(d => ({ ...d.data() } as FeeHead))), onErr),
    ];

    // fine-config is a static singleton — one-time read is sufficient
    getDoc(doc(db, 'fine-config', 'global')).then(fineSnap => {
      if (fineSnap.exists()) setFineConfig(fineSnap.data() as FineConfig);
    }).catch(onErr);

    getSchoolSettings().then(s => {
      if (s.defaultFeeDueDay && s.defaultFeeDueDay >= 1 && s.defaultFeeDueDay <= 28) {
        setDefaultFeeDueDay(s.defaultFeeDueDay);
      }
    }).catch(() => {/* settings load is non-critical */});

    const params = new URLSearchParams(window.location.search);
    const searchParam = params.get('search');
    if (searchParam) {
      setSearchTerm(searchParam);
    }

    return () => unsubs.forEach(u => u());
  }, []);

  const exportCollectionReport = async () => {
    const total = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const today = new Date().toLocaleDateString('en-IN');
    const { doc, contentY } = await createPdf('Fee Collection Report', `As of ${today}`);

    const rows = payments.map((p) => {
      const student = students.find((s) => s.id === p.studentId);
      return [
        p.receiptNumber || '-',
        p.date,
        student?.name || p.studentId,
        student?.classId ? `${student.classId}-${student.section}` : '-',
        p.feeHead || '-',
        (p.method || '').replace('_', ' ').toUpperCase(),
        `₹${(p.amount || 0).toLocaleString('en-IN')}`,
      ];
    });

    (doc as any).autoTable({
      startY: contentY + 2,
      head: [['Receipt', 'Date', 'Student', 'Class', 'Fee Head', 'Method', 'Amount']],
      body: rows,
      foot: [[
        { content: `Total: ${payments.length} payments`, colSpan: 6, styles: { fontStyle: 'bold', halign: 'right' } },
        { content: `₹${total.toLocaleString('en-IN')}`, styles: { fontStyle: 'bold', textColor: [5, 150, 105] } },
      ]],
      ...TABLE_STYLES,
      footStyles: { fillColor: [209, 250, 229], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 8, cellPadding: 3 },
      margin: { left: 12, right: 12 },
    });

    addFooter(doc);
    await savePdf(doc, `fee_collection_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const handleDownloadReceipt = (payment: FeePayment) => {
    const request = feeRequests.find(r => r.id === payment.feeRequestId);
    const student = students.find(s => s.id === payment.studentId);
    if (request && student) {
      generateFeeReceipt(payment, request, student);
    } else {
      showToast('Could not find fee request or student details for this payment.', 'error');
    }
  };

  const handleSendWhatsApp = async (payment: FeePayment) => {
    const student = students.find(s => s.id === payment.studentId);
    const cls = classes.find(c => c.id === student?.classId);
    if (!student?.parentDetails?.phone) {
      showToast('No phone number on record for this student', 'error');
      return;
    }
    const classSection = `${cls?.name || student.classId} - ${student.section}`;
    try {
      const res = await fetch('/api/whatsapp/send-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: student.parentDetails.phone,
          templateName: 'payments_confirmed',
          parameters: [
            student.parentDetails.fatherName || 'Parent',
            `₹${payment.amount.toLocaleString('en-IN')}`,
            student.name,
            classSection,
            payment.receiptNumber,
            new Date(payment.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
            payment.method.replace(/_/g, ' '),
          ],
        }),
      });
      if (!res.ok) throw new Error();
      showToast('WhatsApp receipt sent!', 'success');
    } catch {
      showToast('Failed to send WhatsApp message', 'error');
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) return;

    setLoading(true);
    // Track a stub created for an open/past payment so we can roll it back if the
    // payment transaction fails — otherwise a phantom pending invoice is left behind.
    let createdStubId: string | null = null;
    // Track an uploaded voucher image so we can delete it if the tx fails — no
    // orphaned files left in Storage.
    let uploadedVoucherPath: string | null = null;
    try {
      let pendingRequest = captureForRequestId
        ? feeRequests.find(r => r.id === captureForRequestId)
        : feeRequests.find(r => r.studentId === selectedStudent.id && r.status !== 'paid');

      // ── Open / past payment: no linked fee request — create a stub on the fly ──
      // The amount collected is derived from the fee heads (with discounts) the
      // user builds — there is no separate "amount" field for past payments.
      let openPaymentTotal: number | null = null;
      if (!pendingRequest && isOpenPayment) {
        if (openHeads.length === 0) {
          showToast('Add at least one fee head', 'error');
          setLoading(false);
          return;
        }
        const missingReason = openHeads.find(h => h.discount > 0 && !h.discountReason?.trim());
        if (missingReason) {
          showToast(`Please enter a reason for the discount on "${missingReason.name}"`, 'error');
          setLoading(false);
          return;
        }
        const total = openHeads.reduce((s, h) => s + (h.finalAmount || 0), 0);
        if (!Number.isFinite(total) || total <= 0) {
          showToast('Total payable must be greater than zero', 'error');
          setLoading(false);
          return;
        }
        openPaymentTotal = total;
        const d = new Date(paymentData.date);
        const month = d.toLocaleString('default', { month: 'long', year: 'numeric' });
        const yr = d.getFullYear();
        const mo = d.getMonth() + 1;
        const acYear = mo >= 4 ? `${yr}-${String(yr + 1).slice(-2)}` : `${yr - 1}-${String(yr).slice(-2)}`;
        const stubRef = doc(collection(db, 'feeRequests'));
        const stub = {
          studentId: selectedStudent.id,
          classId: selectedStudent.classId,
          academicYear: acYear,
          month,
          heads: openHeads.map(h => ({
            name: h.name,
            amount: h.amount,
            discount: h.discount || 0,
            discountReason: h.discountReason || '',
            finalAmount: h.finalAmount,
            ...(h.isCustom ? { isCustom: true } : {}),
          })),
          totalAmount: total,
          fineAmount: 0,
          waivedAmount: 0,
          paidAmount: 0,
          status: 'pending' as const,
          dueDate: paymentData.date,
          createdAt: new Date().toISOString(),
          legacyImport: true,
        };
        await setDoc(stubRef, stub);
        createdStubId = stubRef.id;
        pendingRequest = { id: stubRef.id, ...stub };
        // patch local state so the transaction can find it
        setFeeRequests(prev => [...prev, pendingRequest as any]);
      }

      if (!pendingRequest) throw new Error('No pending fee request found for student');

      // For past payments the amount equals the heads total; otherwise the typed amount.
      const payAmount = openPaymentTotal != null ? openPaymentTotal : Number(paymentData.amount);
      if (!Number.isFinite(payAmount) || payAmount <= 0) {
        throw new Error('Enter a valid payment amount');
      }

      // Primary fee head for the payment record — for past payments use the first
      // built head rather than the unrelated default ('Tuition Fees').
      const primaryFeeHead = isOpenPayment && openHeads[0] ? openHeads[0].name : paymentData.head;

      const schoolSettings = await getSchoolSettings();
      const feeCfg = getReceiptTypeConfig(schoolSettings, 'feeReceipt');
      const receiptPrefix = feeCfg.prefix;
      const receiptStartFrom = feeCfg.startFrom;
      const requestRef = doc(db, 'feeRequests', pendingRequest.id);

      const priorPaymentsSnap = await getDocs(query(
        collection(db, 'feePayments'),
        where('feeRequestId', '==', pendingRequest.id)
      ));
      const priorPayments = priorPaymentsSnap.docs.map(d => d.data() as FeePayment);

      let voucherImageUrl: string | undefined;
      if (paymentData.method === 'cash' && paymentData.voucherImage) {
        try {
          const file = paymentData.voucherImage;
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const path = `fee_vouchers/${selectedStudent.id}/${Date.now()}_${safeName}`;
          const ref = storageRef(storage, path);
          await uploadBytes(ref, file);
          voucherImageUrl = await getDownloadURL(ref);
          uploadedVoucherPath = path;
        } catch (uploadErr) {
          console.error('Voucher upload failed:', uploadErr);
          throw new Error('Voucher upload failed — payment not recorded. Try again.');
        }
      }

      const counterRef = receiptCounterRef('fee');
      const txResult = await runTransaction(db, async (tx) => {
        // All reads must come before any writes in a Firestore transaction.
        const fresh = await tx.get(requestRef);
        const counterSnap = await tx.get(counterRef);
        if (!fresh.exists()) throw new Error('Fee request no longer exists');
        const freshData = { id: fresh.id, ...(fresh.data() as Omit<FeeRequest, 'id'>) } as FeeRequest;

        if (freshData.status === 'paid') {
          throw new Error('This fee request is already fully paid');
        }

        // Reserve the receipt number inside the transaction so a failed/aborted
        // payment never burns a number — the sequence stays gapless.
        const receiptNum = nextReceiptNumberFromSnap(counterSnap, receiptStartFrom);
        const receiptNumber = formatReceiptNumber(receiptPrefix, receiptNum);

        const currentFine = fineConfig ? calculateFine(freshData, fineConfig) : 0;
        const feeTotal = freshData.totalAmount - (freshData.waivedAmount || 0);
        const alreadyPaid = freshData.paidAmount || 0;
        const feeRemaining = Math.max(0, feeTotal - alreadyPaid);

        if (payAmount > feeRemaining + 0.001) {
          throw new Error(
            `Payment amount exceeds remaining fee balance of ₹${feeRemaining.toFixed(2)}.` +
            (currentFine > 0 ? ` Outstanding fine of ₹${currentFine} must be waived separately.` : '')
          );
        }

        const newPaidAmount = alreadyPaid + payAmount;
        const newStatus: FeeRequest['status'] =
          newPaidAmount + 0.001 >= feeTotal ? 'paid' : 'partially_paid';

        const headBalances = new Map<string, number>();
        (freshData.heads || []).forEach(h => {
          headBalances.set(h.name, (h.finalAmount ?? h.amount ?? 0));
        });
        for (const p of priorPayments) {
          if (p.allocations && p.allocations.length) {
            for (const a of p.allocations) {
              const cur = headBalances.get(a.headName) ?? 0;
              headBalances.set(a.headName, Math.max(0, cur - (a.amount || 0)));
            }
          } else if (p.feeHead && headBalances.has(p.feeHead)) {
            const cur = headBalances.get(p.feeHead) ?? 0;
            headBalances.set(p.feeHead, Math.max(0, cur - (p.amount || 0)));
          }
        }

        const allocations: { headName: string; amount: number }[] = [];
        let remainingToAllocate = payAmount;
        const orderedHeads = (freshData.heads || []).map(h => h.name);
        const ordered = orderedHeads.includes(primaryFeeHead)
          ? [primaryFeeHead, ...orderedHeads.filter(n => n !== primaryFeeHead)]
          : orderedHeads;

        for (const name of ordered) {
          if (remainingToAllocate <= 0.001) break;
          const bal = headBalances.get(name) ?? 0;
          if (bal <= 0) continue;
          const take = Math.min(bal, remainingToAllocate);
          allocations.push({ headName: name, amount: Number(take.toFixed(2)) });
          remainingToAllocate -= take;
        }
        if (remainingToAllocate > 0.001) {
          allocations.push({
            headName: primaryFeeHead || 'Other',
            amount: Number(remainingToAllocate.toFixed(2)),
          });
        }

        const paymentDoc: Omit<FeePayment, 'id'> = {
          studentId: selectedStudent.id,
          classId: selectedStudent.classId,
          feeRequestId: pendingRequest.id,
          feeHead: primaryFeeHead,
          amount: payAmount,
          fineAmount: 0,
          allocations,
          date: paymentData.date,
          method: paymentData.method,
          referenceNumber: paymentData.referenceNumber,
          receiptNumber,
          remarks: paymentData.remarks,
          ...(paymentData.method === 'cash' && paymentData.voucherNumber
            ? { voucherNumber: paymentData.voucherNumber }
            : {}),
          ...(voucherImageUrl ? { voucherImageUrl } : {}),
        };

        const newPayRef = doc(collection(db, 'feePayments'));
        tx.set(newPayRef, paymentDoc);
        tx.update(requestRef, {
          paidAmount: newPaidAmount,
          fineAmount: currentFine,
          status: newStatus,
          updatedAt: new Date().toISOString(),
        });
        // Consume the receipt number only now that the payment is committing.
        tx.set(counterRef, { lastNumber: receiptNum }, { merge: true });

        return { paymentId: newPayRef.id, newStatus, paymentDoc, receiptNumber };
      });
      const receiptNumber = txResult.receiptNumber;

      const paymentDoc = txResult.paymentDoc;

      try {
        const allReqSnap = await getDocs(query(
          collection(db, 'feeRequests'),
          where('studentId', '==', selectedStudent.id)
        ));
        const allReqs = allReqSnap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<FeeRequest, 'id'>) } as FeeRequest));
        const stillPending = allReqs.some(r =>
          r.id === pendingRequest.id ? txResult.newStatus !== 'paid' : r.status !== 'paid'
        );
        await updateDoc(doc(db, 'students', selectedStudent.id), {
          feeStatus: stillPending ? 'pending' : 'paid',
        });
      } catch (statusErr) {
        console.warn('[FeeCollection] derived student.feeStatus update failed:', statusErr);
      }

      await logActivity(
        user,
        txResult.newStatus === 'paid' ? 'Full Payment Collected' : 'Partial Payment Collected',
        'Accounts',
        `Collected ₹${payAmount.toLocaleString('en-IN')} from ${selectedStudent.name} (${selectedStudent.schoolNumber}) via ${paymentData.method.replace('_', ' ')} — status: ${txResult.newStatus.replace('_', ' ')}`,
        { studentId: selectedStudent.id, amount: payAmount, method: paymentData.method, status: txResult.newStatus }
      );

      setIsModalOpen(false);
      setIsOpenPayment(false);
      fetchData();
      setPaymentSuccess({ amount: payAmount, receiptNumber });

      try {
        const parentPhone = selectedStudent.parentDetails?.phone;
        if (parentPhone) {
          const cls = classes.find(c => c.id === selectedStudent.classId);
          const classSection = `${cls?.name || selectedStudent.classId} - ${selectedStudent.section}`;
          await fetch('/api/whatsapp/send-template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: parentPhone,
              templateName: 'payments_confirmed',
              parameters: [
                selectedStudent.parentDetails?.fatherName || 'Parent',
                `₹${payAmount.toLocaleString('en-IN')}`,
                selectedStudent.name,
                classSection,
                paymentDoc.receiptNumber,
                new Date(paymentData.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
                (paymentData.method || '').replace(/_/g, ' '),
              ],
            }),
          });
        }
      } catch { /* non-fatal */ }
    } catch (err: any) {
      // Roll back an open/past-payment stub so a failed payment never leaves a
      // phantom pending invoice on the student.
      if (createdStubId) {
        const stubId = createdStubId;
        await deleteDoc(doc(db, 'feeRequests', stubId)).catch(() => {});
        setFeeRequests(prev => prev.filter(r => r.id !== stubId));
      }
      // Delete an uploaded voucher image whose payment never committed.
      if (uploadedVoucherPath) {
        await deleteObject(storageRef(storage, uploadedVoucherPath)).catch(() => {});
      }
      const msg = err?.message || '';
      if (msg && !msg.toLowerCase().includes('firestore') && !msg.toLowerCase().includes('permission')) {
        showToast(msg, 'error');
      } else {
        handleFirestoreError(err, OperationType.WRITE, 'feePayments');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCreateOrUpdateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) return;

    const missingReason = requestData.heads.find(h => h.discount > 0 && !h.discountReason?.trim());
    if (missingReason) {
      showToast(`Please enter a reason for the discount on "${missingReason.name}"`, 'error');
      return;
    }

    if (!isEditingRequest) {
      const duplicate = feeRequests.find(
        r => r.studentId === selectedStudent.id && r.month === requestData.month
      );
      if (duplicate && !window.confirm(
        `A fee request for ${requestData.month} already exists for ${selectedStudent.name}.\n\nCreate a second invoice for the same month anyway? (e.g. a custom ad-hoc charge)`
      )) {
        return;
      }
    }

    setLoading(true);
    try {
      const totalAmount = requestData.heads.reduce((sum, h) => sum + h.finalAmount, 0);
      const requestPayload: Partial<FeeRequest> = {
        studentId: selectedStudent.id,
        classId: selectedStudent.classId,
        academicYear: '2024-25',
        month: requestData.month,
        heads: requestData.heads,
        totalAmount,
        status: totalAmount > 0 ? 'pending' : 'paid',
        dueDate: requestData.dueDate,
      };

      if (isEditingRequest && currentRequestId) {
        const editPayload: Partial<FeeRequest> = {
          ...requestPayload,
          updatedAt: new Date().toISOString(),
        } as Partial<FeeRequest>;
        await updateDoc(doc(db, 'feeRequests', currentRequestId), editPayload);
        showToast('Fee request updated successfully!', 'success');
        await logActivity(
          user,
          'Fee Request Updated',
          'Accounts',
          `Updated fee request for ${selectedStudent.name} (${fmtMonthYear(requestData.month)}) — total ₹${totalAmount.toLocaleString('en-IN')}`,
          {
            studentId: selectedStudent.id,
            studentName: selectedStudent.name,
            studentClass: classes.find(c => c.id === selectedStudent.classId)?.name || selectedStudent.classId,
            month: requestData.month,
            totalAmount,
            heads: requestData.heads.map(h => ({ name: h.name, amount: h.amount, discount: h.discount, finalAmount: h.finalAmount })),
          }
        );
      } else {
        const newRequest: Omit<FeeRequest, 'id'> = {
          ...requestPayload,
          paidAmount: 0,
          createdAt: new Date().toISOString(),
        } as Omit<FeeRequest, 'id'>;
        const newReqRef = await addDoc(collection(db, 'feeRequests'), newRequest);

        let advanceApplied = 0;
        try {
          const matches = await getUnconsumedForMonth(selectedStudent.id, requestData.month);
          const requestHeadNames = new Set(requestData.heads.map(h => h.name));
          const requestHeadAmounts = new Map(requestData.heads.map(h => [h.name, h.finalAmount]));

          for (const { advance, entry, entryIndex } of matches) {
            let entryApplied = 0;
            const allocations: { headName: string; amount: number }[] = [];
            for (const h of entry.heads) {
              if (!requestHeadNames.has(h.name)) continue;
              const cap = requestHeadAmounts.get(h.name) || 0;
              const take = Math.min(h.amount, cap);
              if (take <= 0) continue;
              entryApplied += take;
              allocations.push({ headName: h.name, amount: Number(take.toFixed(2)) });
              requestHeadAmounts.set(h.name, cap - take);
            }
            if (entryApplied <= 0.001) continue;

            const settings = await getSchoolSettings();
            const advCfg = getReceiptTypeConfig(settings, 'advanceReceipt');
            const advReceipt = await getNextReceiptNumber('advance', advCfg.prefix, advCfg.startFrom);
            const synthetic = buildAdvanceApplicationPayment({
              request: { id: newReqRef.id, studentId: selectedStudent.id, classId: selectedStudent.classId },
              advance,
              entry: { ...entry, heads: allocations.map(a => ({ name: a.headName, amount: a.amount })) },
              totalApplied: Number(entryApplied.toFixed(2)),
              receiptNumber: advReceipt,
            });
            const payRef = await addDoc(collection(db, 'feePayments'), synthetic);
            await consumeAdvanceEntry(advance.id, entryIndex, newReqRef.id, payRef.id);
            advanceApplied += entryApplied;
          }

          if (advanceApplied > 0.001) {
            const newPaid = Number(advanceApplied.toFixed(2));
            const newStatus: FeeRequest['status'] =
              newPaid + 0.001 >= totalAmount ? 'paid' : 'partially_paid';
            await updateDoc(newReqRef, {
              paidAmount: newPaid,
              status: newStatus,
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (advErr) {
          console.error('[FeeCollection] auto-apply advance failed (non-fatal):', advErr);
        }

        await updateDoc(doc(db, 'students', selectedStudent.id), {
          feeStatus: advanceApplied >= totalAmount - 0.001 && totalAmount > 0 ? 'paid' : 'pending',
        });
        const advNote = advanceApplied > 0
          ? ` — ₹${advanceApplied.toFixed(2)} auto-applied from advance`
          : '';
        showToast(`Fee request generated successfully${advNote}`, 'success');
        await logActivity(
          user,
          'Fee Request Generated',
          'Accounts',
          `Generated fee request for ${selectedStudent.name} (${fmtMonthYear(requestData.month)}) — ₹${totalAmount.toLocaleString('en-IN')} total${advNote}`,
          {
            studentId: selectedStudent.id,
            studentName: selectedStudent.name,
            studentClass: classes.find(c => c.id === selectedStudent.classId)?.name || selectedStudent.classId,
            month: requestData.month,
            totalAmount,
            advanceApplied: advanceApplied > 0 ? advanceApplied : undefined,
            heads: requestData.heads.map(h => ({ name: h.name, amount: h.amount, discount: h.discount, finalAmount: h.finalAmount })),
          }
        );
      }

      setIsRequestModalOpen(false);
      setIsEditingRequest(false);
      setCurrentRequestId(null);
      fetchData();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'feeRequests');
    } finally {
      setLoading(false);
    }
  };

  // ── Advance payment helpers ────────────────────────────────────────────────

  const openAdvanceModal = async (student: Student) => {
    setAdvanceStudent(student);
    setAdvanceData({
      selectedMonths: [],
      selectedHeads: [],
      method: 'cash',
      date: new Date().toISOString().split('T')[0],
      referenceNumber: '',
      voucherNumber: '',
      voucherImage: null,
      remarks: '',
    });
    try {
      const existing = await getAdvancePaymentsForStudent(student.id);
      setAdvancePayments(existing);
    } catch (err) {
      console.warn('Failed to load existing advance payments:', err);
      setAdvancePayments([]);
    }
    setIsAdvanceModalOpen(true);
  };

  const getUpcomingMonths = (): string[] => {
    const months: string[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push(d.toLocaleString('default', { month: 'long', year: 'numeric' }));
    }
    return months;
  };

  const getAvailableHeadsForAdvance = (student: Student | null) => {
    if (!student) return [] as FeeHead[];
    const structure = feeStructures.find(s => s.classId === student.classId);
    const classHeads: FeeHead[] = structure?.heads || [];
    const classHeadNames = new Set(classHeads.map(h => h.name));
    const extraGlobal = globalHeads.filter(h => !classHeadNames.has(h.name));
    return [...classHeads, ...extraGlobal];
  };

  const calcAdvanceTotal = (): { perMonth: number; total: number } => {
    const heads = getAvailableHeadsForAdvance(advanceStudent);
    const selectedHeadAmounts = heads
      .filter(h => advanceData.selectedHeads.includes(h.name))
      .reduce((s, h) => s + (h.amount || 0), 0);
    return {
      perMonth: selectedHeadAmounts,
      total: selectedHeadAmounts * advanceData.selectedMonths.length,
    };
  };

  const handleRecordAdvance = async () => {
    if (!advanceStudent) return;
    if (advanceData.selectedMonths.length === 0) {
      showToast('Pick at least one month to pay in advance', 'info');
      return;
    }
    if (advanceData.selectedHeads.length === 0) {
      showToast('Pick at least one fee head', 'info');
      return;
    }
    if (advanceData.method !== 'cash' && !advanceData.referenceNumber.trim()) {
      showToast('Reference number required for non-cash payments', 'info');
      return;
    }

    try {
      const existing = await getAdvancePaymentsForStudent(advanceStudent.id);
      const alreadyCovered = new Set<string>();
      existing.forEach(a =>
        (a.monthlyBreakdown || []).forEach(e => {
          if (!e.consumed) alreadyCovered.add(e.month);
        })
      );
      const dupes = advanceData.selectedMonths.filter(m => alreadyCovered.has(m));
      if (dupes.length > 0) {
        showToast(`Already paid in advance for: ${dupes.join(', ')}`, 'error');
        return;
      }
    } catch (e) {
      console.warn('overlap check failed', e);
    }

    setAdvanceLoading(true);
    try {
      const heads = getAvailableHeadsForAdvance(advanceStudent).filter(h =>
        advanceData.selectedHeads.includes(h.name)
      );
      const { total } = calcAdvanceTotal();

      let voucherImageUrl: string | undefined;
      if (advanceData.method === 'cash' && advanceData.voucherImage) {
        try {
          const file = advanceData.voucherImage;
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const path = `fee_vouchers/${advanceStudent.id}/advance_${Date.now()}_${safeName}`;
          const r = storageRef(storage, path);
          await uploadBytes(r, file);
          voucherImageUrl = await getDownloadURL(r);
        } catch (err) {
          console.error('Advance voucher upload failed:', err);
          showToast('Voucher upload failed', 'error');
          setAdvanceLoading(false);
          return;
        }
      }

      const settings = await getSchoolSettings();
      const advCfg2 = getReceiptTypeConfig(settings, 'advanceReceipt');
      const receiptNumber = await getNextReceiptNumber('advance', advCfg2.prefix, advCfg2.startFrom);

      const monthlyBreakdown = advanceData.selectedMonths.map(m => ({
        month: m,
        heads: heads.map(h => ({ name: h.name, amount: h.amount })),
        consumed: false,
      }));

      const advanceId = await createAdvancePayment({
        studentId: advanceStudent.id,
        classId: advanceStudent.classId,
        academicYear: '2024-25',
        monthlyBreakdown,
        totalAmount: total,
        paymentMethod: advanceData.method,
        referenceNumber: advanceData.referenceNumber || undefined,
        voucherNumber: advanceData.method === 'cash' && advanceData.voucherNumber
          ? advanceData.voucherNumber : undefined,
        voucherImageUrl,
        receiptNumber,
        date: advanceData.date,
        remarks: advanceData.remarks || undefined,
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
      });

      showToast(`Advance payment of ₹${total.toLocaleString('en-IN')} recorded — receipt ${receiptNumber}`, 'success');
      setPaymentSuccess({ amount: total, receiptNumber });

      logActivity(
        user,
        'Advance Payment Recorded',
        'Accounts',
        `Recorded advance payment of ₹${total.toLocaleString('en-IN')} for ${advanceStudent.name} via ${advanceData.method.replace('_', ' ')}, covering ${advanceData.selectedMonths.length} month(s) — receipt ${receiptNumber}`,
        {
          studentId: advanceStudent.id,
          studentName: advanceStudent.name,
          studentClass: classes.find(c => c.id === advanceStudent.classId)?.name || advanceStudent.classId,
          advanceId,
          totalAmount: total,
          method: advanceData.method,
          receiptNumber,
          months: advanceData.selectedMonths,
          heads: advanceData.selectedHeads,
        },
      );

      const phone = advanceStudent.parentDetails?.phone;
      if (phone) {
        try {
          await fetch('/api/whatsapp/send-template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone,
              templateName: 'payments_confirmed',
              parameters: [
                advanceStudent.parentDetails?.fatherName || 'Parent',
                `₹${total.toLocaleString('en-IN')}`,
                receiptNumber,
                fmtDate(advanceData.date),
                `Advance for ${advanceData.selectedMonths.join(', ')}`,
              ],
            }),
          });
        } catch { /* non-fatal */ }
      }

      setIsAdvanceModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'advancePayments');
    } finally {
      setAdvanceLoading(false);
    }
  };

  const handleCancelRequest = async (requestId: string, studentId: string) => {
    if (!window.confirm('Are you sure you want to cancel this fee request? Current payments will be orphaned.')) return;
    try {
      const student = students.find(s => s.id === studentId);
      await deleteDoc(doc(db, 'feeRequests', requestId));

      const remainingRequests = feeRequests.filter(r => r.studentId === studentId && r.id !== requestId);
      const isStillPending = remainingRequests.some(r => r.status !== 'paid');
      await updateDoc(doc(db, 'students', studentId), { feeStatus: isStillPending ? 'pending' : 'paid' });

      showToast('Fee request cancelled', 'success');

      const cancelledReq = feeRequests.find(r => r.id === requestId);
      await logActivity(
        user,
        'Fee Request Cancelled',
        'Accounts',
        `Cancelled fee request for ${student?.name || studentId}${cancelledReq ? ` — ₹${cancelledReq.totalAmount.toLocaleString('en-IN')} for ${fmtMonthYear(cancelledReq.month)}` : ''}`,
        {
          studentId,
          studentName: student?.name,
          feeRequestId: requestId,
          totalAmount: cancelledReq?.totalAmount,
          month: cancelledReq?.month,
        }
      );

      fetchData();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'feeRequests');
    }
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!window.confirm('Are you sure you want to delete this payment record? This will revert the paid status of the corresponding fee request.')) return;

    setLoading(true);
    try {
      const payment = payments.find(p => p.id === paymentId);
      if (!payment) return;

      const paymentRef = doc(db, 'feePayments', paymentId);
      const requestRef = payment.feeRequestId ? doc(db, 'feeRequests', payment.feeRequestId) : null;

      await runTransaction(db, async (tx) => {
        const payDoc = await tx.get(paymentRef);
        if (!payDoc.exists()) {
          return;
        }

        if (requestRef) {
          const reqDoc = await tx.get(requestRef);
          if (reqDoc.exists()) {
            const reqData = reqDoc.data() as FeeRequest;
            const newPaidAmount = Math.max(0, (reqData.paidAmount || 0) - payment.amount);
            const newStatus: FeeRequest['status'] = newPaidAmount === 0 ? 'pending' : 'partially_paid';
            tx.update(requestRef, {
              paidAmount: newPaidAmount,
              status: newStatus,
              updatedAt: new Date().toISOString(),
            });
          }
        }

        tx.delete(paymentRef);
      });

      try {
        const allReqSnap = await getDocs(query(
          collection(db, 'feeRequests'),
          where('studentId', '==', payment.studentId)
        ));
        const stillPending = allReqSnap.docs.some(d => {
          const r = d.data() as FeeRequest;
          if (d.id === payment.feeRequestId) return true;
          return r.status !== 'paid';
        });
        await updateDoc(doc(db, 'students', payment.studentId), {
          feeStatus: stillPending ? 'pending' : 'paid',
        });
      } catch (statusErr) {
        console.warn('[FeeCollection] derived student.feeStatus update failed after delete:', statusErr);
      }

      await logActivity(
        user,
        'Payment Record Deleted',
        'Super Admin',
        `Deleted payment record ${payment.receiptNumber} for ₹${payment.amount.toLocaleString('en-IN')} — ${payment.method?.replace('_', ' ')} payment reversed`,
        {
          studentId: payment.studentId,
          receiptNumber: payment.receiptNumber,
          amount: payment.amount,
          method: payment.method,
          feeRequestId: payment.feeRequestId,
        }
      );

      showToast('Payment record deleted successfully', 'success');
      fetchData();
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg && !msg.toLowerCase().includes('firestore') && !msg.toLowerCase().includes('permission')) {
        showToast(msg, 'error');
      } else {
        handleFirestoreError(err, OperationType.DELETE, 'feePayments');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleWaiveFine = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const request = feeRequests.find(r => r.id === waiverData.requestId);
      if (!request) return;

      const updatedRequest: Partial<FeeRequest> = {
        waivedAmount: (request.waivedAmount || 0) + Number(waiverData.amount),
        waivedBy: user.uid,
        waivedAt: new Date().toISOString(),
        waiverReason: waiverData.reason
      };

      await updateDoc(doc(db, 'feeRequests', request.id), updatedRequest);
      logActivity(
        user,
        'Fine Waived',
        user.role === 'super_admin' ? 'Super Admin' : 'Accounts',
        `Waived penalty of ₹${Number(waiverData.amount).toLocaleString('en-IN')} for ${waiverData.studentName} — reason: ${waiverData.reason || 'not specified'}`,
        {
          studentId: request.studentId,
          studentName: waiverData.studentName,
          waivedAmount: Number(waiverData.amount),
          reason: waiverData.reason,
          feeRequestId: request.id,
        }
      );
      showToast('Penalty waived successfully', 'success');
      setWaiverData({ ...waiverData, isOpen: false });
      fetchData();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'feeRequests');
    } finally {
      setLoading(false);
    }
  };

  const openRequestModal = (student: Student, request?: FeeRequest) => {
    setSelectedStudent(student);
    getAdvancePaymentsForStudent(student.id)
      .then(setAdvancePayments)
      .catch(() => setAdvancePayments([]));
    if (request) {
      setIsEditingRequest(true);
      setCurrentRequestId(request.id);
      setRequestData({
        month: request.month,
        dueDate: request.dueDate,
        heads: request.heads
      });
    } else {
      setIsEditingRequest(false);
      setCurrentRequestId(null);
      const sourceHeads = getAvailableHeadsForAdvance(student).map(h => ({
        name: h.name,
        amount: h.amount,
        discount: 0,
        finalAmount: h.amount,
      }));
      setRequestData({
        month: new Date().toLocaleString('default', { month: 'long', year: 'numeric' }),
        dueDate: computeDefaultFeeDueDate(defaultFeeDueDay),
        heads: sourceHeads,
      });
    }
    setIsRequestModalOpen(true);
  };

  const filteredStudents = students.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          s.schoolNumber.includes(searchTerm);
    const matchesClass = selectedClass === 'all' || s.classId === selectedClass;
    return matchesSearch && matchesClass;
  });

  const todayCollection = payments
    .filter(p => p.date === new Date().toISOString().split('T')[0])
    .reduce((sum, p) => sum + p.amount, 0);

  const monthCollection = payments
    .filter(p => p.date.startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((sum, p) => sum + p.amount, 0);

  const totalOutstanding = feeRequests
    .filter(f => f.status !== 'paid')
    .reduce((sum, f) => sum + (f.totalAmount - (f.paidAmount || 0)), 0);

  const today = new Date().toISOString().split('T')[0];

  return (
    <>
      <PaymentSuccess
        show={paymentSuccess != null}
        amount={paymentSuccess?.amount}
        message={paymentSuccess?.receiptNumber ? `Receipt #${paymentSuccess.receiptNumber}` : undefined}
        onDismiss={() => setPaymentSuccess(null)}
      />

      {/* ── topbar ── */}
      <div className="topbar pad">
        <div>
          <div className="eyebrow">Accounts</div>
          <h1>Fee Collection</h1>
        </div>
        <div>
          {(user.role === 'super_admin' || user.role === 'accounts') && (
            <button className="btn accent" onClick={() => {
              if (filteredStudents.length > 0) openRequestModal(filteredStudents[0]);
            }}>
              <Plus size={15} />
              Collect Fee
            </button>
          )}
        </div>
      </div>

      <div className="pad stack">
        {/* ── Search + class filter chips ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--ink)', opacity: 0.4, pointerEvents: 'none' }} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search student name or roll no..."
              style={{
                width: '100%',
                paddingLeft: '2.25rem',
                paddingRight: '0.75rem',
                paddingTop: '0.6rem',
                paddingBottom: '0.6rem',
                border: '1.5px solid var(--line)',
                borderRadius: '0.75rem',
                fontSize: '0.9rem',
                background: 'var(--paper)',
                color: 'var(--ink)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div className="hscroll" style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={() => setSelectedClass('all')}
              className={selectedClass === 'all' ? 'chip solid' : 'chip'}
            >
              All Classes
            </button>
            {classes.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedClass(c.id)}
                className={selectedClass === c.id ? 'chip solid' : 'chip'}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {/* ── Student fee cards ── */}
        {filteredStudents.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <Users size={40} style={{ color: 'var(--line)', margin: '0 auto 0.75rem' }} />
            <p style={{ fontWeight: 700, color: 'var(--ink)' }}>No students found</p>
            <p className="muted" style={{ fontSize: '0.85rem' }}>Try a different search or class</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.75rem' }}>
            {filteredStudents.slice(0, 50).map((student) => {
              const studentRequests = feeRequests.filter(r => r.studentId === student.id && r.status !== 'paid');
              const className = classes.find(c => c.id === student.classId)?.name || student.classId;
              const hasOverdue = studentRequests.some(r => r.dueDate && r.dueDate < today);
              const totalBalance = studentRequests.reduce((sum, r) =>
                sum + Math.max(0, (r.totalAmount || 0) - (r.waivedAmount || 0) - (r.paidAmount || 0)), 0);

              return (
                <div key={student.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {/* Header: avatar + name + status badge */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
                      <Avatar name={student.name} size="sm" />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: 'var(--ink)', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{student.name}</div>
                        <div className="mono tiny muted">{className} · {student.section} · #{student.schoolNumber}</div>
                      </div>
                    </div>
                    {studentRequests.length > 0 ? (
                      <Badge variant={hasOverdue ? 'error' : 'warning'} style={{ flexShrink: 0 }}>
                        {studentRequests.length > 1 ? `${studentRequests.length} pending` : (hasOverdue ? 'Overdue' : studentRequests[0].status.replace('_', ' '))}
                      </Badge>
                    ) : (
                      <span className="chip" style={{ fontSize: '0.7rem', flexShrink: 0, color: 'var(--ink)', opacity: 0.45 }}>No invoice</span>
                    )}
                  </div>

                  {/* One row per pending request */}
                  {studentRequests.map((req) => {
                    const reqBalance = Math.max(0, (req.totalAmount || 0) - (req.waivedAmount || 0) - (req.paidAmount || 0));
                    const reqIsOverdue = req.dueDate && req.dueDate < today;
                    const reqFine = fineConfig ? calculateFine(req, fineConfig) : 0;
                    return (
                      <div key={req.id} style={{ borderRadius: '0.6rem', border: '1px solid var(--line)', overflow: 'hidden' }}>
                        {/* Month + totals */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.25rem', padding: '0.35rem 0.5rem', background: 'var(--cream)' }}>
                          <div style={{ textAlign: 'center' }}>
                            <div className="eyebrow" style={{ fontSize: '0.58rem' }}>Month</div>
                            <div style={{ fontWeight: 700, fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{req.month}</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div className="eyebrow" style={{ fontSize: '0.58rem' }}>Total</div>
                            <div style={{ fontWeight: 700, fontSize: '0.72rem' }}>₹{(req.totalAmount || 0).toLocaleString()}</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div className="eyebrow" style={{ fontSize: '0.58rem', color: 'var(--coral)' }}>Due</div>
                            <div style={{ fontWeight: 700, fontSize: '0.72rem', color: 'var(--coral)' }}>₹{reqBalance.toLocaleString()}{reqFine > 0 ? ` +₹${reqFine}` : ''}</div>
                          </div>
                        </div>
                        {/* Heads chips */}
                        {req.heads && req.heads.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', padding: '0.35rem 0.5rem', borderTop: '1px solid var(--line-2)' }}>
                            {req.heads.map((h, i) => (
                              <span key={i} className="chip" style={{ fontSize: '0.64rem' }}>{h.name}: ₹{(h.finalAmount || h.amount || 0).toLocaleString()}</span>
                            ))}
                          </div>
                        )}
                        {/* Per-request action buttons */}
                        <div style={{ padding: '0.5rem', borderTop: '1px solid var(--line-2)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                          {req.partialPaymentRequest?.status === 'pending' && user.role !== 'super_admin' ? (
                            <div style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--ink)', opacity: 0.55, padding: '0.4rem', border: '1px solid var(--line)', borderRadius: '0.5rem' }}>
                              Partial payment request pending — awaiting accountant approval
                            </div>
                          ) : (
                            <button
                              className="btn accent"
                              style={{ width: '100%', fontSize: '0.8rem', padding: '0.45rem 0.75rem', justifyContent: 'center', gap: '0.4rem' }}
                              onClick={() => {
                                setSelectedStudent(student);
                                setCaptureForRequestId(req.id);
                                setIsOpenPayment(false);
                                const defaultHead = req.heads?.[0]?.name || globalHeads[0]?.name || 'Tuition Fees';
                                setPaymentData({ ...paymentData, amount: reqBalance.toString(), head: defaultHead, openHead: '' });
                                setIsModalOpen(true);
                              }}
                            >
                              <IndianRupee size={13} />
                              Collect Payment — ₹{reqBalance.toLocaleString()}{reqIsOverdue ? ' ⚠' : ''}
                            </button>
                          )}
                          <div style={{ display: 'flex', gap: '0.3rem' }}>
                            <button
                              className="btn ghost"
                              onClick={() => openRequestModal(student, req)}
                              style={{ flex: 1, fontSize: '0.72rem', padding: '0.3rem 0.5rem', gap: '0.3rem' }}
                            >
                              <Receipt size={12} /> Edit Request
                            </button>
                            {reqFine > 0 && (
                              <button
                                className="btn ghost"
                                onClick={() => setWaiverData({ isOpen: true, requestId: req.id, amount: String(reqFine), reason: '', studentName: student.name })}
                                style={{ flex: 1, fontSize: '0.72rem', padding: '0.3rem 0.5rem', gap: '0.3rem', color: 'var(--leaf)' }}
                              >
                                <ShieldOff size={12} /> Waive Fine
                              </button>
                            )}
                            <button
                              className="btn ghost"
                              onClick={() => handleCancelRequest(req.id, student.id)}
                              style={{ flex: 1, fontSize: '0.72rem', padding: '0.3rem 0.5rem', gap: '0.3rem', color: 'var(--coral)' }}
                            >
                              <Trash2 size={12} /> Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Generate + Past — always shown */}
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: 'auto' }}>
                    <button
                      className="btn accent"
                      onClick={() => openRequestModal(student)}
                      style={{ flex: 1, fontSize: '0.78rem', padding: '0.4rem 0.6rem' }}
                    >
                      <Plus size={13} /> Create Fee Request
                    </button>
                    <button
                      className="btn ghost"
                      title="Record a past or open payment without a fee request"
                      onClick={() => {
                        setSelectedStudent(student);
                        setCaptureForRequestId(null);
                        setIsOpenPayment(true);
                        // Prefill with the class fee structure so the user can
                        // tweak amounts / discounts or remove + add custom heads.
                        setOpenHeads(getAvailableHeadsForAdvance(student).map(h => ({
                          name: h.name, amount: h.amount, discount: 0, finalAmount: h.amount,
                        })));
                        setOpenCustomHead({ name: '', amount: '' });
                        setOpenAddGlobalHeadId('');
                        setPaymentData({
                          amount: '',
                          head: 'Tuition Fees',
                          openHead: '',
                          method: 'cash',
                          date: new Date().toISOString().split('T')[0],
                          referenceNumber: '',
                          remarks: '',
                          voucherNumber: '',
                          voucherImage: null,
                        });
                        setIsModalOpen(true);
                      }}
                      style={{ fontSize: '0.78rem', padding: '0.4rem 0.6rem' }}
                    >
                      <History size={13} /> Past Payment
                    </button>
                  </div>

                  {/* Payment history toggle */}
                  <button
                    onClick={() => setExpandedStudentId(expandedStudentId === student.id ? null : student.id)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', fontSize: '0.72rem', color: 'var(--ink)', opacity: 0.45, background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem' }}
                  >
                    <History size={12} />
                    History
                    {expandedStudentId === student.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>

                  {expandedStudentId === student.id && (() => {
                    const studentPayments = payments.filter(p => p.studentId === student.id);
                    return (
                      <div style={{ borderTop: '1px solid var(--line)', paddingTop: '0.5rem' }}>
                        {studentPayments.length === 0 ? (
                          <p style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--ink)', opacity: 0.4, padding: '0.35rem 0' }}>No payments recorded yet</p>
                        ) : studentPayments.map(p => (
                          <div key={p.id} className="row" style={{ padding: '0.3rem 0', alignItems: 'center' }}>
                            <div>
                              <span style={{ fontWeight: 700, fontSize: '0.78rem' }}>₹{(p.amount || 0).toLocaleString()}</span>
                              <span className="mono tiny muted" style={{ marginLeft: '0.4rem' }}>{p.method} · {fmtDate(p.date)}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                              <button className="btn ghost" onClick={() => handleDownloadReceipt(p)} title="Download receipt" style={{ fontSize: '0.68rem', padding: '0.2rem 0.45rem', gap: '0.25rem' }}><Receipt size={11} /> Receipt</button>
                              <button className="btn ghost" onClick={() => handleSendWhatsApp(p)} title="Send WhatsApp" style={{ fontSize: '0.68rem', padding: '0.2rem 0.45rem', gap: '0.25rem' }}><MessageSquare size={11} /> WhatsApp</button>
                              {user.role === 'super_admin' && (
                                <button className="btn ghost" onClick={() => handleDeletePayment(p.id)} title="Delete" style={{ fontSize: '0.68rem', padding: '0.2rem 0.45rem', gap: '0.25rem', color: 'var(--coral)' }}><Trash2 size={11} /> Delete</button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Export FAB ── */}
        <button
          onClick={exportCollectionReport}
          style={{
            position: 'fixed',
            bottom: '1.5rem',
            right: '1.5rem',
            zIndex: 40,
            width: '3.25rem',
            height: '3.25rem',
            background: 'var(--ink)',
            color: '#fff',
            border: 'none',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
          }}
          aria-label="Export"
        >
          <Download size={20} />
        </button>
      </div>

      {/* Generate Fee Request Modal */}
      <Modal
        isOpen={isRequestModalOpen && !!selectedStudent}
        onClose={() => {
          setIsRequestModalOpen(false);
          setIsEditingRequest(false);
          setCurrentRequestId(null);
        }}
        title={isEditingRequest ? "Modify Fee Request" : "Generate Fee Request"}
        subtitle={selectedStudent ? `${selectedStudent.name} (${selectedStudent.schoolNumber})` : ''}
        size="lg"
        footer={
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Total Request Amount</p>
              <p className="text-2xl font-black text-slate-900">₹{(requestData.heads.reduce((sum, h) => sum + h.finalAmount, 0) || 0).toLocaleString()}</p>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => {
                setIsRequestModalOpen(false);
                setIsEditingRequest(false);
              }}>Cancel</Button>
              <Button
                variant="success"
                loading={loading}
                onClick={(e: any) => {
                  const form = document.querySelector('form[data-request-form]') as HTMLFormElement;
                  if (form) form.requestSubmit();
                }}
              >
                {isEditingRequest ? 'Update Request' : 'Generate Request'}
              </Button>
            </div>
          </div>
        }
      >
        <form onSubmit={handleCreateOrUpdateRequest} data-request-form className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Billing Month" required>
              <Input
                type="text"
                required
                value={requestData.month}
                onChange={(e) => setRequestData({ ...requestData, month: e.target.value })}
              />
            </FormField>
            <FormField label="Due Date" required>
              <Input
                type="date"
                required
                value={requestData.dueDate}
                onChange={(e) => setRequestData({ ...requestData, dueDate: e.target.value })}
              />
            </FormField>
          </div>

          {(() => {
            if (!selectedStudent || !requestData.month || isEditingRequest) return null;
            const coveredByAdvance = advancePayments.some(adv =>
              (adv.monthlyBreakdown || []).some((e: any) => e.month === requestData.month && !e.consumed)
            );
            if (!coveredByAdvance) return null;
            return (
              <div className="flex items-start gap-2.5 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <IndianRupee className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-emerald-700">Advance payment found for {requestData.month}</p>
                  <p className="text-[11px] text-emerald-600 mt-0.5">
                    This student has an unconsumed advance covering this month. On submission, the advance will be automatically applied and the request may go directly to "paid" or "partially paid".
                  </p>
                </div>
              </div>
            );
          })()}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Fee Heads</h3>
              <div className="flex items-center gap-3">
                {requestData.heads.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setRequestData({ ...requestData, heads: [] })}
                    className="text-[10px] font-bold text-rose-500 hover:text-rose-600 uppercase tracking-wider"
                    title="Remove all heads to build a custom-only request"
                  >
                    Clear all
                  </button>
                )}
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Add/remove heads · discount with reason</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 border-b border-slate-200">
                <span className="flex-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Head</span>
                <span className="w-24 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Amount</span>
                <span className="w-24 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Discount</span>
                <span className="w-24 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Final</span>
                <span className="w-7" />
              </div>

              {requestData.heads.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-amber-700 bg-amber-50">
                  No heads yet. Add a global head or a custom head below.
                </div>
              ) : (
                requestData.heads.map((head, index) => (
                  <div key={index} className="border-b border-slate-100 last:border-0">
                    <div className="flex items-center gap-2 px-4 py-3">
                      <div className="flex-1 flex items-center gap-2 min-w-0">
                        <span className="text-sm font-bold text-slate-900 truncate">{head.name}</span>
                        {head.isCustom && (
                          <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-black bg-violet-100 text-violet-700 rounded-md uppercase tracking-wide">Custom</span>
                        )}
                      </div>
                      <span className="w-24 text-right text-sm font-medium text-slate-500 shrink-0">₹{(head.amount || 0).toLocaleString()}</span>
                      <input
                        type="number"
                        min={0}
                        max={head.amount}
                        value={head.discount}
                        onChange={(e) => {
                          const newHeads = [...requestData.heads];
                          newHeads[index].discount = Math.min(Number(e.target.value), head.amount);
                          newHeads[index].finalAmount = newHeads[index].amount - newHeads[index].discount;
                          setRequestData({ ...requestData, heads: newHeads });
                        }}
                        className="w-24 text-right px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400 bg-white shrink-0"
                        placeholder="0"
                      />
                      <span className={`w-24 text-right text-sm font-black shrink-0 ${head.discount > 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
                        ₹{(head.finalAmount || 0).toLocaleString()}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const newHeads = requestData.heads.filter((_, i) => i !== index);
                          setRequestData({ ...requestData, heads: newHeads });
                        }}
                        className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                        title="Remove head"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {head.discount > 0 && (
                      <div className="px-4 pb-3 -mt-1">
                        <input
                          type="text"
                          value={head.discountReason || ''}
                          onChange={(e) => {
                            const newHeads = [...requestData.heads];
                            newHeads[index].discountReason = e.target.value;
                            setRequestData({ ...requestData, heads: newHeads });
                          }}
                          placeholder="Reason for discount (required)"
                          className="w-full px-3 py-1.5 text-xs border border-amber-200 bg-amber-50 rounded-lg focus:outline-none focus:border-amber-400 text-slate-700 placeholder:text-amber-400"
                        />
                      </div>
                    )}
                  </div>
                ))
              )}

              {requestData.heads.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-t border-slate-200">
                  <span className="flex-1 text-xs font-bold text-slate-700">Total</span>
                  <span className="w-24 text-right text-xs font-bold text-slate-500">₹{requestData.heads.reduce((s, h) => s + (h.amount || 0), 0).toLocaleString()}</span>
                  <span className="w-24 text-right text-xs font-bold text-rose-500">-₹{requestData.heads.reduce((s, h) => s + (h.discount || 0), 0).toLocaleString()}</span>
                  <span className="w-24 text-right text-sm font-black text-slate-900">₹{requestData.heads.reduce((s, h) => s + (h.finalAmount || 0), 0).toLocaleString()}</span>
                  <span className="w-7" />
                </div>
              )}
            </div>

            {(() => {
              const available = globalHeads.filter(gh => !requestData.heads.some(h => h.name === gh.name));
              if (available.length === 0) return null;
              return (
                <div className="flex items-center gap-2 pt-1">
                  <select
                    value={addGlobalHeadId}
                    onChange={(e) => setAddGlobalHeadId(e.target.value)}
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white text-slate-700"
                  >
                    <option value="">Add a global head...</option>
                    {available.map(h => (
                      <option key={h.name} value={h.name}>{h.name} — ₹{h.amount.toLocaleString()}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (!addGlobalHeadId) return;
                      const gh = globalHeads.find(h => h.name === addGlobalHeadId);
                      if (!gh) return;
                      setRequestData({ ...requestData, heads: [...requestData.heads, { name: gh.name, amount: gh.amount, discount: 0, finalAmount: gh.amount }] });
                      setAddGlobalHeadId('');
                    }}
                    disabled={!addGlobalHeadId}
                    className="px-3 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-colors flex items-center gap-1 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Global
                  </button>
                </div>
              );
            })()}

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customHeadForm.name}
                onChange={(e) => setCustomHeadForm({ ...customHeadForm, name: e.target.value })}
                placeholder="Custom head name..."
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 bg-white"
              />
              <input
                type="number"
                value={customHeadForm.amount}
                onChange={(e) => setCustomHeadForm({ ...customHeadForm, amount: e.target.value })}
                placeholder="₹ Amount"
                min={1}
                className="w-32 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 bg-white"
              />
              <button
                type="button"
                onClick={() => {
                  const amt = Number(customHeadForm.amount);
                  if (!customHeadForm.name.trim() || amt <= 0) return;
                  setRequestData({ ...requestData, heads: [...requestData.heads, { name: customHeadForm.name.trim(), amount: amt, discount: 0, finalAmount: amt, isCustom: true }] });
                  setCustomHeadForm({ name: '', amount: '' });
                }}
                disabled={!customHeadForm.name.trim() || Number(customHeadForm.amount) <= 0}
                className="px-3 py-2 bg-violet-600 text-white text-xs font-bold rounded-xl hover:bg-violet-700 disabled:opacity-40 transition-colors flex items-center gap-1 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Custom
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Capture Payment Modal */}
      <Modal
        isOpen={isModalOpen && !!selectedStudent}
        onClose={() => { setIsModalOpen(false); setIsOpenPayment(false); setCaptureForRequestId(null); }}
        title={isOpenPayment ? 'Record Past Payment' : 'Capture Payment'}
        subtitle={selectedStudent ? `${selectedStudent.name} (${selectedStudent.schoolNumber})` : ''}
        size={isOpenPayment ? 'lg' : 'sm'}
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setIsOpenPayment(false); }}>Cancel</Button>
            <Button variant="primary" loading={loading} onClick={(e: any) => {
              const form = document.querySelector('form[data-payment-form]') as HTMLFormElement;
              if (form) form.requestSubmit();
            }}>{isOpenPayment
              ? `Record Payment${openHeads.length > 0 ? ` — ₹${openHeads.reduce((s, h) => s + (h.finalAmount || 0), 0).toLocaleString()}` : ''}`
              : 'Capture Payment'}</Button>
          </div>
        }
      >
        <form onSubmit={handleRecordPayment} data-payment-form className="space-y-5">
          {/* Open/past payment: build fee heads with discounts (amount is derived) */}
          {isOpenPayment ? (
            <>
              <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: 'var(--cream-2)' }}>
                <History className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--ink-3)' }} />
                <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                  Recording a past payment — no open invoice needed. Build the fee heads below (add custom heads or discounts with a reason). A fee record will be created automatically for the total.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Fee Heads</h3>
                  {openHeads.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setOpenHeads([])}
                      className="text-[10px] font-bold text-rose-500 hover:text-rose-600 uppercase tracking-wider"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <span className="flex-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Head</span>
                    <span className="w-24 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Amount</span>
                    <span className="w-24 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Discount</span>
                    <span className="w-24 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">Final</span>
                    <span className="w-7" />
                  </div>

                  {openHeads.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-amber-700 bg-amber-50">
                      No heads yet. Add a global head or a custom head below.
                    </div>
                  ) : (
                    openHeads.map((head, index) => (
                      <div key={index} className="border-b border-slate-100 last:border-0">
                        <div className="flex items-center gap-2 px-4 py-3">
                          <div className="flex-1 flex items-center gap-2 min-w-0">
                            <span className="text-sm font-bold text-slate-900 truncate">{head.name}</span>
                            {head.isCustom && (
                              <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-black bg-violet-100 text-violet-700 rounded-md uppercase tracking-wide">Custom</span>
                            )}
                          </div>
                          <span className="w-24 text-right text-sm font-medium text-slate-500 shrink-0">₹{(head.amount || 0).toLocaleString()}</span>
                          <input
                            type="number"
                            min={0}
                            max={head.amount}
                            value={head.discount}
                            onChange={(e) => {
                              const newHeads = [...openHeads];
                              newHeads[index].discount = Math.min(Number(e.target.value), head.amount);
                              newHeads[index].finalAmount = newHeads[index].amount - newHeads[index].discount;
                              setOpenHeads(newHeads);
                            }}
                            className="w-24 text-right px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400 bg-white shrink-0"
                            placeholder="0"
                          />
                          <span className={`w-24 text-right text-sm font-black shrink-0 ${head.discount > 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
                            ₹{(head.finalAmount || 0).toLocaleString()}
                          </span>
                          <button
                            type="button"
                            onClick={() => setOpenHeads(openHeads.filter((_, i) => i !== index))}
                            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                            title="Remove head"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {head.discount > 0 && (
                          <div className="px-4 pb-3 -mt-1">
                            <input
                              type="text"
                              value={head.discountReason || ''}
                              onChange={(e) => {
                                const newHeads = [...openHeads];
                                newHeads[index].discountReason = e.target.value;
                                setOpenHeads(newHeads);
                              }}
                              placeholder="Reason for discount (required)"
                              className="w-full px-3 py-1.5 text-xs border border-amber-200 bg-amber-50 rounded-lg focus:outline-none focus:border-amber-400 text-slate-700 placeholder:text-amber-400"
                            />
                          </div>
                        )}
                      </div>
                    ))
                  )}

                  {openHeads.length > 0 && (
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-t border-slate-200">
                      <span className="flex-1 text-xs font-bold text-slate-700">Total Payable</span>
                      <span className="w-24 text-right text-xs font-bold text-slate-500">₹{openHeads.reduce((s, h) => s + (h.amount || 0), 0).toLocaleString()}</span>
                      <span className="w-24 text-right text-xs font-bold text-rose-500">-₹{openHeads.reduce((s, h) => s + (h.discount || 0), 0).toLocaleString()}</span>
                      <span className="w-24 text-right text-sm font-black text-slate-900">₹{openHeads.reduce((s, h) => s + (h.finalAmount || 0), 0).toLocaleString()}</span>
                      <span className="w-7" />
                    </div>
                  )}
                </div>

                {(() => {
                  const available = globalHeads.filter(gh => !openHeads.some(h => h.name === gh.name));
                  if (available.length === 0) return null;
                  return (
                    <div className="flex items-center gap-2 pt-1">
                      <select
                        value={openAddGlobalHeadId}
                        onChange={(e) => setOpenAddGlobalHeadId(e.target.value)}
                        className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 bg-white text-slate-700"
                      >
                        <option value="">Add a global head...</option>
                        {available.map(h => (
                          <option key={h.name} value={h.name}>{h.name} — ₹{h.amount.toLocaleString()}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          if (!openAddGlobalHeadId) return;
                          const gh = globalHeads.find(h => h.name === openAddGlobalHeadId);
                          if (!gh) return;
                          setOpenHeads([...openHeads, { name: gh.name, amount: gh.amount, discount: 0, finalAmount: gh.amount }]);
                          setOpenAddGlobalHeadId('');
                        }}
                        disabled={!openAddGlobalHeadId}
                        className="px-3 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-colors flex items-center gap-1 shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Global
                      </button>
                    </div>
                  );
                })()}

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={openCustomHead.name}
                    onChange={(e) => setOpenCustomHead({ ...openCustomHead, name: e.target.value })}
                    placeholder="Custom head name..."
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 bg-white"
                  />
                  <input
                    type="number"
                    value={openCustomHead.amount}
                    onChange={(e) => setOpenCustomHead({ ...openCustomHead, amount: e.target.value })}
                    placeholder="₹ Amount"
                    min={1}
                    className="w-32 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-violet-400 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const amt = Number(openCustomHead.amount);
                      if (!openCustomHead.name.trim() || amt <= 0) return;
                      setOpenHeads([...openHeads, { name: openCustomHead.name.trim(), amount: amt, discount: 0, finalAmount: amt, isCustom: true }]);
                      setOpenCustomHead({ name: '', amount: '' });
                    }}
                    disabled={!openCustomHead.name.trim() || Number(openCustomHead.amount) <= 0}
                    className="px-3 py-2 bg-violet-600 text-white text-xs font-bold rounded-xl hover:bg-violet-700 disabled:opacity-40 transition-colors flex items-center gap-1 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Custom
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {(() => {
                const pending = captureForRequestId
                  ? feeRequests.find(r => r.id === captureForRequestId)
                  : selectedStudent
                    ? feeRequests.find(r => r.studentId === selectedStudent.id && r.status !== 'paid')
                    : null;
                if (!pending?.heads?.length) return null;
                return (
                  <div className="bg-slate-50 rounded-xl border border-slate-100 divide-y divide-slate-100">
                    {pending.heads.map((h, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2">
                        <span className="text-xs text-slate-600 font-medium">{h.name}</span>
                        <span className="text-xs font-bold text-slate-900">₹{(h.finalAmount || h.amount || 0).toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-3 py-2 bg-white rounded-b-xl">
                      <span className="text-xs font-bold text-slate-900">Total Invoiced</span>
                      <span className="text-sm font-black text-slate-900">₹{(pending.totalAmount || 0).toLocaleString()}</span>
                    </div>
                  </div>
                );
              })()}
              {(() => {
                const isSuperAdmin = user?.role === 'super_admin';
                if (isSuperAdmin) {
                  return (
                    <FormField label="Amount to Collect (₹)" required hint="Super admin override — partial collection allowed. Fine is waived separately.">
                      <Input
                        type="number"
                        required
                        value={paymentData.amount}
                        onChange={(e) => setPaymentData({ ...paymentData, amount: e.target.value })}
                      />
                    </FormField>
                  );
                }
                return (
                  <FormField label="Amount to Collect (₹)" hint="Locked to full pending balance. Partial payments require super admin approval.">
                    <Input
                      type="number"
                      value={paymentData.amount}
                      readOnly
                      disabled
                      className="bg-slate-50 cursor-not-allowed"
                    />
                  </FormField>
                );
              })()}
            </>
          )}
          {(() => {
            const pendingReqs = selectedStudent
              ? feeRequests.filter(r => r.studentId === selectedStudent.id && r.status !== 'paid')
              : [];
            const outstandingFine = pendingReqs.reduce((sum, r) => sum + (fineConfig ? calculateFine(r, fineConfig) : 0), 0);
            if (outstandingFine <= 0) return null;
            return (
              <div className="flex items-start gap-2.5 p-3 bg-rose-50 border border-rose-100 rounded-xl">
                <Scale className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-rose-700">Outstanding Fine: ₹{outstandingFine.toLocaleString()}</p>
                  <p className="text-[10px] text-rose-500 mt-0.5">Fine is not included in this payment. Use the waive button (shield icon) to clear it after collecting fees.</p>
                </div>
              </div>
            );
          })()}
          <FormField label="Payment Method" required>
            <Select
              value={paymentData.method}
              onChange={(e) => setPaymentData({ ...paymentData, method: e.target.value as any })}
            >
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="cheque">Cheque</option>
              <option value="upi">UPI</option>
              <option value="net_banking">Net Banking</option>
            </Select>
          </FormField>
          {paymentData.method !== 'cash' && (
            <FormField label="Reference Number" required>
              <Input
                type="text"
                required
                placeholder="Transaction ID / Cheque No."
                value={paymentData.referenceNumber}
                onChange={(e) => setPaymentData({ ...paymentData, referenceNumber: e.target.value })}
              />
            </FormField>
          )}
          {paymentData.method === 'cash' && (
            <>
              <FormField label="Cash Voucher Number" hint="Optional — written on the physical cash voucher / receipt book">
                <Input
                  type="text"
                  placeholder="e.g. CV-0042"
                  value={paymentData.voucherNumber}
                  onChange={(e) => setPaymentData({ ...paymentData, voucherNumber: e.target.value })}
                />
              </FormField>
              <FormField label="Cash Voucher Photo" hint="Optional — attach a photo of the signed voucher">
                <div className="flex items-center gap-3">
                  <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg border border-slate-200 transition-colors">
                    <Receipt className="w-3.5 h-3.5" />
                    {paymentData.voucherImage ? 'Change Photo' : 'Attach Photo'}
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => setPaymentData({ ...paymentData, voucherImage: e.target.files?.[0] || null })}
                    />
                  </label>
                  {paymentData.voucherImage && (
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-slate-600 truncate max-w-[180px]">{paymentData.voucherImage.name}</span>
                      <button
                        type="button"
                        onClick={() => setPaymentData({ ...paymentData, voucherImage: null })}
                        className="text-rose-500 hover:text-rose-600 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </FormField>
            </>
          )}
          <FormField label="Date of Payment" required hint="Past dates are accepted">
            <Input
              type="date"
              required
              value={paymentData.date}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => setPaymentData({ ...paymentData, date: e.target.value })}
            />
          </FormField>
          <FormField label="Remarks">
            <Textarea
              value={paymentData.remarks}
              onChange={(e) => setPaymentData({ ...paymentData, remarks: e.target.value })}
              rows={3}
            />
          </FormField>
        </form>
      </Modal>

      {/* Advance Payment Modal */}
      <Modal
        isOpen={isAdvanceModalOpen}
        onClose={() => setIsAdvanceModalOpen(false)}
        title="Record Advance Payment"
        subtitle={advanceStudent ? `For ${advanceStudent.name}` : ''}
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-3 w-full">
            <div className="text-xs text-slate-500">
              <span className="font-bold text-slate-700">
                {advanceData.selectedMonths.length} month(s) × ₹{calcAdvanceTotal().perMonth.toLocaleString('en-IN')}
              </span>
              <span className="mx-1.5">=</span>
              <span className="text-base font-black text-emerald-700">
                ₹{calcAdvanceTotal().total.toLocaleString('en-IN')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setIsAdvanceModalOpen(false)}>Cancel</Button>
              <Button variant="primary" loading={advanceLoading} onClick={handleRecordAdvance}>
                Record Advance
              </Button>
            </div>
          </div>
        }
      >
        {advanceStudent && (
          <div className="space-y-5">
            {advancePayments.length > 0 && (
              <div className="p-3 bg-violet-50 border border-violet-200 rounded-xl">
                <p className="text-[10px] font-bold text-violet-700 uppercase tracking-widest mb-2">Existing Advance Payments</p>
                <div className="space-y-1">
                  {advancePayments.map(adv => (
                    <div key={adv.id} className="text-[11px] text-violet-900">
                      <span className="font-bold">{adv.receiptNumber}</span> · ₹{adv.totalAmount?.toLocaleString('en-IN')} ·
                      {' '}{(adv.monthlyBreakdown || []).map((e: any) => (
                        <span key={e.month} className={e.consumed ? 'line-through opacity-60' : 'font-bold'}>{e.month}{' '}</span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <FormField label="Months to Pay In Advance" required hint="Pick all months you want to pre-pay for. Already-covered months are blocked.">
              <div className="grid grid-cols-3 md:grid-cols-4 gap-2 mt-1">
                {getUpcomingMonths().map(m => {
                  const alreadyCovered = advancePayments.some(adv =>
                    (adv.monthlyBreakdown || []).some((e: any) => e.month === m && !e.consumed)
                  );
                  const selected = advanceData.selectedMonths.includes(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={alreadyCovered}
                      onClick={() => {
                        setAdvanceData(prev => ({
                          ...prev,
                          selectedMonths: selected
                            ? prev.selectedMonths.filter(x => x !== m)
                            : [...prev.selectedMonths, m],
                        }));
                      }}
                      className={`px-2 py-2 rounded-lg text-[11px] font-bold border transition-all ${
                        alreadyCovered
                          ? 'bg-slate-100 text-slate-400 border-slate-200 line-through cursor-not-allowed'
                          : selected
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-md'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-400 hover:bg-emerald-50'
                      }`}
                    >
                      <CalendarDays className="w-3 h-3 inline mb-0.5 mr-1" />
                      {m.split(' ')[0].slice(0, 3)} '{m.split(' ')[1]?.slice(-2)}
                    </button>
                  );
                })}
              </div>
            </FormField>

            <FormField label="Fee Heads to Include" required hint="Synced from the class fee structure">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                {getAvailableHeadsForAdvance(advanceStudent).map(h => {
                  const selected = advanceData.selectedHeads.includes(h.name);
                  return (
                    <button
                      key={h.name}
                      type="button"
                      onClick={() => {
                        setAdvanceData(prev => ({
                          ...prev,
                          selectedHeads: selected
                            ? prev.selectedHeads.filter(x => x !== h.name)
                            : [...prev.selectedHeads, h.name],
                        }));
                      }}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-all ${
                        selected
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-indigo-400 hover:bg-indigo-50'
                      }`}
                    >
                      <span className="text-xs font-bold">{h.name}</span>
                      <span className={`text-xs font-bold ${selected ? 'text-white' : 'text-emerald-600'}`}>
                        ₹{h.amount.toLocaleString('en-IN')}
                      </span>
                    </button>
                  );
                })}
              </div>
              {getAvailableHeadsForAdvance(advanceStudent).length === 0 && (
                <p className="text-xs text-rose-600 mt-2">No fee structure set for this class. Ask the admin to configure one first.</p>
              )}
            </FormField>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Payment Method" required>
                <Select
                  value={advanceData.method}
                  onChange={(e) => setAdvanceData({ ...advanceData, method: e.target.value as any })}
                >
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                  <option value="upi">UPI</option>
                  <option value="net_banking">Net Banking</option>
                </Select>
              </FormField>
              <FormField label="Date" required>
                <Input
                  type="date"
                  required
                  value={advanceData.date}
                  onChange={(e) => setAdvanceData({ ...advanceData, date: e.target.value })}
                />
              </FormField>
            </div>

            {advanceData.method !== 'cash' && (
              <FormField label="Reference Number" required>
                <Input
                  type="text"
                  required
                  placeholder="Transaction ID / Cheque No."
                  value={advanceData.referenceNumber}
                  onChange={(e) => setAdvanceData({ ...advanceData, referenceNumber: e.target.value })}
                />
              </FormField>
            )}

            {advanceData.method === 'cash' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Cash Voucher Number" hint="Optional — from physical book">
                  <Input
                    type="text"
                    placeholder="e.g. CV-0042"
                    value={advanceData.voucherNumber}
                    onChange={(e) => setAdvanceData({ ...advanceData, voucherNumber: e.target.value })}
                  />
                </FormField>
                <FormField label="Cash Voucher Photo" hint="Optional">
                  <div className="flex items-center gap-3">
                    <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg border border-slate-200">
                      <Receipt className="w-3.5 h-3.5" />
                      {advanceData.voucherImage ? 'Change' : 'Attach'}
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        className="hidden"
                        onChange={(e) => setAdvanceData({ ...advanceData, voucherImage: e.target.files?.[0] || null })}
                      />
                    </label>
                    {advanceData.voucherImage && (
                      <span className="text-xs text-slate-600 truncate max-w-[160px]">{advanceData.voucherImage.name}</span>
                    )}
                  </div>
                </FormField>
              </div>
            )}

            <FormField label="Remarks" hint="Optional">
              <Textarea
                value={advanceData.remarks}
                onChange={(e) => setAdvanceData({ ...advanceData, remarks: e.target.value })}
                rows={2}
              />
            </FormField>
          </div>
        )}
      </Modal>

      {/* Waive Fine Modal */}
      <Modal
        isOpen={waiverData.isOpen}
        onClose={() => setWaiverData({ ...waiverData, isOpen: false })}
        title="Waive Penalty Fine"
        subtitle={`Student: ${waiverData.studentName}`}
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => setWaiverData({ ...waiverData, isOpen: false })}>Cancel</Button>
            <Button variant="danger" loading={loading} onClick={(e: any) => {
              const form = document.querySelector('form[data-waiver-form]') as HTMLFormElement;
              if (form) form.requestSubmit();
            }}>Confirm Waiver</Button>
          </div>
        }
      >
        <form onSubmit={handleWaiveFine} data-waiver-form className="space-y-4">
          <FormField label="Amount to Waive (₹)" required hint="Enter the amount you wish to waive from the calculated fine">
            <Input
              type="number"
              required
              value={waiverData.amount}
              onChange={(e) => setWaiverData({ ...waiverData, amount: e.target.value })}
            />
          </FormField>
          <FormField label="Reason for Waiver" required>
            <Textarea
              required
              value={waiverData.reason}
              onChange={(e) => setWaiverData({ ...waiverData, reason: e.target.value })}
              placeholder="e.g. Negotiated with Parent, Technical Issue, etc."
              rows={3}
            />
          </FormField>
          <div className="p-3 bg-amber-50 rounded-xl border border-amber-100 flex gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
            <p className="text-[10px] text-amber-700 leading-relaxed italic">
              Warning: This action is permanent and will be logged as a waiver by {user.name}.
            </p>
          </div>
        </form>
      </Modal>
    </>
  );
}
