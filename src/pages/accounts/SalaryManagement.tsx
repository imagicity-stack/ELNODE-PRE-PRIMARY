import { UserProfile, Teacher, Salary, StaffMember, UnifiedStaff, PayrollConfig } from '../../types';
import { generatePayrollSlip } from '../../lib/payrollSlip';
import { getSchoolSettings, getReceiptTypeConfig } from '../../services/settingsService';
import { getNextReceiptNumber } from '../../services/receiptCounterService';
import { saveText } from '../../lib/download';
import {
  Download,
  Users,
  Settings,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Wallet,
  Banknote,
  History,
  Filter,
  Plus,
  ArrowRight,
  TrendingUp,
  PieChart as PieChartIcon,
  ChevronRight,
  FileText,
  AlertCircle,
  Edit2,
  Trash2,
  HandCoins,
} from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  updateDoc,
  doc,
  getDoc,
  orderBy,
  serverTimestamp,
  onSnapshot,
  writeBatch,
  runTransaction,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useToast } from '../../components/Toast';
import { logActivity } from '../../services/activityService';
import {
  Card,
  Badge,
  Button,
  Modal,
  SearchInput,
  FormField,
  Input,
  Select,
  Textarea,
  Table,
  Thead,
  Th,
  Tbody,
  Tr,
  Td,
  EmptyState,
  Avatar,
} from '../../components/ui';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie
} from 'recharts';

import { fmtMonthYear as fmtMonth } from '../../lib/utils';

interface SalaryManagementProps {
  user: UserProfile;
}

// Outstanding advance balance helper
interface SalaryAdvance {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole?: string;
  amount: number;
  adjustedAmount: number;     // how much has been recovered via payroll
  status: 'outstanding' | 'partially_adjusted' | 'adjusted';
  date: string;               // ISO date
  method: string;
  transactionId?: string;
  reason?: string;
  recordedBy?: string;
  adjustments?: { salaryId: string; month: string; amount: number; date: string }[];
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function SalaryManagement({ user }: SalaryManagementProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [staffList, setStaffList] = useState<UnifiedStaff[]>([]);
  const [salaries, setSalaries] = useState<Salary[]>([]);
  const [loading, setLoading] = useState(false);
  const [payrollConfig, setPayrollConfig] = useState<PayrollConfig | null>(null);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [historyStaff, setHistoryStaff] = useState<UnifiedStaff | null>(null);
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [advanceStaff, setAdvanceStaff] = useState<UnifiedStaff | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [salaryToDelete, setSalaryToDelete] = useState<Salary | null>(null);
  const [editingSalary, setEditingSalary] = useState<Salary | null>(null);
  const [advances, setAdvances] = useState<SalaryAdvance[]>([]);

  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [targetMonth, setTargetMonth] = useState(selectedMonth); // For specific generation
  const [processingStaff, setProcessingStaff] = useState<UnifiedStaff | null>(null);
  const [processingSalary, setProcessingSalary] = useState<Salary | null>(null);

  const { showToast } = useToast();

  // Payroll Generation Form
  const [payrollForm, setPayrollForm] = useState({
    bonus: 0,
    pf: 0,
    tax: 0,
    leaves: 0,
    leaveDeductionRate: 0,
    otherDeductions: 0,
    remarks: ''
  });

  // Payment Form
  const [paymentData, setPaymentData] = useState({
    paidAmount: 0,
    method: 'bank_transfer',
    transactionId: '',
    phone: '',
  });

  // Advance Payment Form
  const [advanceForm, setAdvanceForm] = useState({
    amount: 0,
    method: 'bank_transfer',
    transactionId: '',
    reason: '',
    phone: '',
  });

  const fetchData = () => {
    // No-op: live data is wired via onSnapshot below. Kept for callers in the file.
  };

  useEffect(() => {
    setLoading(true);
    let teachersData: UnifiedStaff[] = [];
    let otherStaffData: UnifiedStaff[] = [];
    const onErr = (err: any) => { handleFirestoreError(err, OperationType.LIST, 'salaries'); setLoading(false); };

    const mergeStaff = () => setStaffList([...teachersData, ...otherStaffData]);

    const unsubTeachers = onSnapshot(collection(db, 'teachers'), (snap) => {
      teachersData = snap.docs.map(doc => {
        const data = doc.data() as Teacher;
        return { ...data, id: doc.id, staffCategory: 'Teacher', baseSalary: data.salaryStructure || 0 } as UnifiedStaff;
      });
      mergeStaff();
    }, onErr);

    const unsubStaff = onSnapshot(collection(db, 'staff'), (snap) => {
      otherStaffData = snap.docs.map(doc => {
        const data = doc.data() as StaffMember;
        let cat: UnifiedStaff['staffCategory'] = 'Other Staff';
        if (data.role === 'principal') cat = 'Principal';
        else if (data.role === 'accounts') cat = 'Accounts';
        else if (data.role === 'grievance_officer') cat = 'Grievance';
        else if (data.role === 'admin') cat = 'Admin';
        return { ...data, id: doc.id, staffCategory: cat, baseSalary: data.salary || 0 } as UnifiedStaff;
      });
      mergeStaff();
    }, onErr);

    const unsubSalaries = onSnapshot(query(collection(db, 'salaries'), orderBy('month', 'desc')), (snap) => {
      setSalaries(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Salary)));
      setLoading(false);
    }, onErr);

    const unsubAdvances = onSnapshot(collection(db, 'salaryAdvances'), (snap) => {
      setAdvances(snap.docs.map(d => ({ id: d.id, ...d.data() } as SalaryAdvance)));
    }, onErr);

    // payroll-config is rarely changed — one-time read is fine
    getDoc(doc(db, 'payroll-config', 'global')).then(configSnap => {
      if (configSnap.exists()) {
        setPayrollConfig(configSnap.data() as PayrollConfig);
      } else {
        setPayrollConfig({
          id: 'global',
          workingDaysInYear: 240,
          pfRate: 12,
          professionalTax: 200,
          updatedBy: 'system',
          updatedAt: ''
        });
      }
    }).catch(onErr);

    return () => { unsubTeachers(); unsubStaff(); unsubSalaries(); unsubAdvances(); };
  }, []);

  // Outstanding advances per employee (helper)
  const outstandingAdvanceFor = (employeeId: string): { total: number; advances: SalaryAdvance[] } => {
    const list = advances.filter(a => a.employeeId === employeeId && a.status !== 'adjusted');
    const total = list.reduce((sum, a) => sum + Math.max(0, (a.amount || 0) - (a.adjustedAmount || 0)), 0);
    return { total, advances: list };
  };

  const handleOpenCreatePayroll = (staff: UnifiedStaff) => {
    setEditingSalary(null);
    setProcessingStaff(staff);
    setTargetMonth(selectedMonth);

    const defaultPf = Math.round(staff.baseSalary * (payrollConfig?.pfRate ?? 12) / 100);
    const defaultTax = payrollConfig?.professionalTax ?? 200;

    let defaultDailyRate = payrollConfig?.leaveDeductionPerDay ?? 0;
    if (defaultDailyRate === 0) {
      const workingDays = payrollConfig?.workingDaysInYear ?? 240;
      defaultDailyRate = Math.round((staff.baseSalary * 12) / workingDays);
    }

    setPayrollForm({
      bonus: 0,
      pf: defaultPf,
      tax: defaultTax,
      leaves: 0,
      leaveDeductionRate: defaultDailyRate,
      otherDeductions: 0,
      remarks: ''
    });
    setIsCreateModalOpen(true);
  };

  const handleOpenEditPayroll = (salary: Salary, staff: UnifiedStaff) => {
    if (salary.status !== 'pending') {
      showToast('Only pending payrolls can be edited. Reverse the payment expense first.', 'error');
      return;
    }
    setEditingSalary(salary);
    setProcessingStaff(staff);
    setTargetMonth(salary.month);
    setPayrollForm({
      bonus: salary.allowances || 0,
      pf: salary.deductions?.pf || 0,
      tax: salary.deductions?.tax || 0,
      leaves: salary.deductions?.leaves || 0,
      leaveDeductionRate: (salary.deductions?.leaves || 0) > 0
        ? Math.round((salary.deductions?.leaveDeduction || 0) / (salary.deductions?.leaves || 1))
        : 0,
      otherDeductions: salary.deductions?.other || 0,
      remarks: salary.remarks || '',
    });
    setIsCreateModalOpen(true);
  };

  const calculateNetAmount = (staff: UnifiedStaff) => {
    const leaveDeduction = payrollForm.leaves * payrollForm.leaveDeductionRate;
    return Math.max(0, staff.baseSalary + payrollForm.bonus - payrollForm.pf - payrollForm.tax - leaveDeduction - payrollForm.otherDeductions);
  };

  const generatePayroll = async () => {
    if (!processingStaff) return;
    if (loading) return;

    const { bonus, pf, tax, leaves, leaveDeductionRate, otherDeductions } = payrollForm;
    if ([bonus, pf, tax, leaves, leaveDeductionRate, otherDeductions].some(v => v < 0)) {
      showToast('Negative values are not allowed', 'error');
      return;
    }
    if (!processingStaff.baseSalary || processingStaff.baseSalary <= 0) {
      showToast(`Base salary is not set for ${processingStaff.name}. Update in HR before generating payroll.`, 'error');
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      showToast('Invalid pay month', 'error');
      return;
    }

    const isEdit = !!editingSalary;
    const leaveDeduction = payrollForm.leaves * payrollForm.leaveDeductionRate;
    const baseNet = calculateNetAmount(processingStaff);

    // Pull current outstanding advances for this employee (only on create, not edit)
    const outstanding = isEdit ? { total: 0, advances: [] as SalaryAdvance[] } : outstandingAdvanceFor(processingStaff.id);
    const advanceToAdjust = Math.min(outstanding.total, baseNet);
    const finalNet = Math.max(0, baseNet - advanceToAdjust);

    setLoading(true);
    try {
      const salaryId = isEdit ? editingSalary!.id : `${processingStaff.id}_${targetMonth}`;
      const salaryRef = doc(db, 'salaries', salaryId);

      const baseRecord: any = {
        employeeId: processingStaff.id,
        employeeName: processingStaff.name,
        employeeRole: (processingStaff as any).role || 'Teacher',
        month: targetMonth,
        baseAmount: processingStaff.baseSalary,
        allowances: payrollForm.bonus,
        deductions: {
          pf: payrollForm.pf,
          tax: payrollForm.tax,
          leaves: payrollForm.leaves,
          leaveDeduction: Math.round(leaveDeduction),
          other: payrollForm.otherDeductions,
          advanceAdjusted: Math.round(advanceToAdjust),
        },
        netAmount: Math.round(finalNet),
        balanceAmount: Math.round(finalNet),
        remarks: payrollForm.remarks,
        updatedAt: new Date().toISOString(),
      };

      if (isEdit) {
        // Edit only allowed when status === 'pending' (no payments)
        await updateDoc(salaryRef, baseRecord);
        // Reset advance adjustments tied to old salaryId (rare; out of scope to reapply)
        logActivity(user, 'Edited Payroll', 'Accounts',
          `Updated payroll for ${processingStaff.name} for ${fmtMonth(targetMonth)}`);
        showToast('Payroll updated', 'success');
      } else {
        // Generate salary slip number before the transaction
        try {
          const salarySettings = await getSchoolSettings();
          const slipCfg = getReceiptTypeConfig(salarySettings, 'salarySlip');
          const slipNum = await getNextReceiptNumber('salary', slipCfg.prefix, slipCfg.startFrom);
          baseRecord.receiptNumber = slipNum;
        } catch { /* non-blocking; PDF falls back to legacy format */ }

        // Atomic check-and-create using deterministic ID
        await runTransaction(db, async (tx) => {
          // Read advances first (Firestore transactions require reads before writes)
          const advanceRefs = outstanding.advances.map(a => doc(db, 'salaryAdvances', a.id));
          const advanceSnaps = await Promise.all(advanceRefs.map(r => tx.get(r)));

          const salarySnap = await tx.get(salaryRef);
          if (salarySnap.exists()) {
            throw new Error('DUPLICATE_PAYROLL');
          }

          tx.set(salaryRef, {
            ...baseRecord,
            paidAmount: 0,
            status: 'pending',
            paymentHistory: [],
            createdAt: new Date().toISOString(),
          });

          // Apply advance adjustments greedily across outstanding advances (oldest first)
          let remaining = advanceToAdjust;
          const today = new Date().toISOString();
          const sortedSnaps = advanceSnaps.slice().sort((a, b) => {
            const ad = (a.data() as any)?.date || '';
            const bd = (b.data() as any)?.date || '';
            return ad.localeCompare(bd);
          });
          for (const aSnap of sortedSnaps) {
            if (remaining <= 0) break;
            if (!aSnap.exists()) continue;
            const adv = aSnap.data() as any;
            const advOutstanding = Math.max(0, (adv.amount || 0) - (adv.adjustedAmount || 0));
            if (advOutstanding <= 0) continue;
            const take = Math.min(advOutstanding, remaining);
            const newAdjusted = (adv.adjustedAmount || 0) + take;
            const newStatus = newAdjusted >= adv.amount ? 'adjusted' : 'partially_adjusted';
            const newEntry = { salaryId, month: targetMonth, amount: take, date: today };
            tx.update(aSnap.ref, {
              adjustedAmount: newAdjusted,
              status: newStatus,
              adjustments: [...(adv.adjustments || []), newEntry],
              updatedAt: today,
            });
            remaining -= take;
          }
        });

        logActivity(user, 'Generated Payroll', 'Accounts',
          `Generated payroll for ${processingStaff.name} for ${fmtMonth(targetMonth)}` +
          (advanceToAdjust > 0 ? ` (Rs. ${advanceToAdjust.toLocaleString('en-IN')} advance adjusted)` : '')
        );
        showToast(
          advanceToAdjust > 0
            ? `Payroll generated. Rs. ${advanceToAdjust.toLocaleString('en-IN')} advance auto-adjusted.`
            : `Payroll generated for ${processingStaff.name}`,
          'success'
        );
      }

      setIsCreateModalOpen(false);
      setEditingSalary(null);
    } catch (err: any) {
      if (err?.message === 'DUPLICATE_PAYROLL') {
        showToast(`Payroll already exists for ${processingStaff.name} for ${fmtMonth(targetMonth)}.`, 'error');
      } else {
        handleFirestoreError(err, OperationType.WRITE, 'salaries');
      }
    } finally {
      setLoading(false);
    }
  };

  // Delete pending payroll (cascades to any orphan expenses just in case)
  const deletePendingSalary = async () => {
    if (!salaryToDelete) return;
    if (salaryToDelete.status !== 'pending' || (salaryToDelete.paidAmount || 0) > 0) {
      showToast('Only pending payrolls with no payments can be deleted.', 'error');
      return;
    }
    setLoading(true);
    try {
      const expensesSnap = await getDocs(query(collection(db, 'expenses'), where('salaryId', '==', salaryToDelete.id)));
      const batch = writeBatch(db);
      batch.delete(doc(db, 'salaries', salaryToDelete.id));
      expensesSnap.docs.forEach(d => batch.delete(d.ref));

      // Roll back any advance adjustments tied to this salaryId
      const adjustedAdvances = advances.filter(a => (a.adjustments || []).some(adj => adj.salaryId === salaryToDelete.id));
      for (const adv of adjustedAdvances) {
        const removedAmount = (adv.adjustments || [])
          .filter(adj => adj.salaryId === salaryToDelete.id)
          .reduce((s, adj) => s + (adj.amount || 0), 0);
        const newAdjusted = Math.max(0, (adv.adjustedAmount || 0) - removedAmount);
        const newStatus = newAdjusted <= 0 ? 'outstanding' : newAdjusted >= adv.amount ? 'adjusted' : 'partially_adjusted';
        batch.update(doc(db, 'salaryAdvances', adv.id), {
          adjustedAmount: newAdjusted,
          status: newStatus,
          adjustments: (adv.adjustments || []).filter(adj => adj.salaryId !== salaryToDelete.id),
          updatedAt: new Date().toISOString(),
        });
      }

      await batch.commit();
      logActivity(user, 'Deleted Payroll', 'Accounts',
        `Deleted payroll for ${salaryToDelete.employeeName} for ${fmtMonth(salaryToDelete.month)}`);
      showToast('Payroll deleted', 'success');
      setIsDeleteConfirmOpen(false);
      setSalaryToDelete(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'salaries');
    } finally {
      setLoading(false);
    }
  };

  // Advance Payment processor
  const processAdvance = async () => {
    if (!advanceStaff) return;
    if (loading) return;
    const amt = Number(advanceForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('Advance amount must be greater than 0', 'error');
      return;
    }

    setLoading(true);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      const advanceRef = doc(collection(db, 'salaryAdvances'));
      const expenseRef = doc(collection(db, 'expenses'));

      batch.set(advanceRef, {
        employeeId: advanceStaff.id,
        employeeName: advanceStaff.name,
        employeeRole: (advanceStaff as any).role || advanceStaff.staffCategory,
        amount: amt,
        adjustedAmount: 0,
        status: 'outstanding',
        date: now,
        method: advanceForm.method,
        transactionId: advanceForm.transactionId || '',
        reason: advanceForm.reason || '',
        recordedBy: (user as any)?.email || 'system',
        adjustments: [],
        createdAt: now,
      });

      batch.set(expenseRef, {
        category: 'salary_advance',
        biller: advanceStaff.name,
        amount: amt,
        date: now.split('T')[0],
        status: 'paid',
        paymentMethod: advanceForm.method,
        description: `Salary Advance to ${advanceStaff.name} - ${advanceForm.reason || 'No reason given'}`,
        salaryAdvanceId: advanceRef.id,
        createdAt: now,
      });

      await batch.commit();

      logActivity(user, 'Paid Salary Advance', 'Accounts',
        `Advance of Rs. ${amt.toLocaleString('en-IN')} paid to ${advanceStaff.name}`);
      showToast(`Advance of Rs. ${amt.toLocaleString('en-IN')} recorded`, 'success');

      // WhatsApp notify if phone present
      const enteredPhone = (advanceForm.phone || '').trim();
      if (enteredPhone) {
        try {
          const staff = staffList.find(s => s.id === advanceStaff.id);
          if (staff && (staff as any).phone !== enteredPhone) {
            const collectionName = staff.staffCategory === 'Teacher' ? 'teachers' : 'staff';
            await updateDoc(doc(db, collectionName, advanceStaff.id), { phone: enteredPhone });
          }
          const res = await fetch('/api/whatsapp/send-template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: enteredPhone,
              templateName: 'salaries_disbursed',
              parameters: [
                advanceStaff.name,
                `Rs. ${amt.toLocaleString('en-IN')} (Advance)`,
                fmtMonth(new Date().toISOString().slice(0, 7)),
                (advanceStaff as any).role || advanceStaff.staffCategory,
                (advanceForm.method || '').replace(/_/g, ' '),
                advanceForm.transactionId || '-',
                new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
              ],
            }),
          });
          if (!res.ok) throw new Error(`status ${res.status}`);
        } catch (e) {
          console.warn('WhatsApp notification failed:', e);
          showToast('Advance saved, but WhatsApp notification could not be sent.', 'warning' as any);
        }
      }

      setIsAdvanceModalOpen(false);
      setAdvanceForm({ amount: 0, method: 'bank_transfer', transactionId: '', reason: '', phone: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'salaryAdvances');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAdvance = (staff: UnifiedStaff) => {
    setAdvanceStaff(staff);
    setAdvanceForm({
      amount: 0,
      method: 'bank_transfer',
      transactionId: '',
      reason: '',
      phone: (staff as any).phone || '',
    });
    setIsAdvanceModalOpen(true);
  };

  const handleOpenPayment = (salary: Salary) => {
    setProcessingSalary(salary);
    const staff = staffList.find(s => s.id === salary.employeeId);
    setPaymentData({
      paidAmount: salary.balanceAmount,
      method: 'bank_transfer',
      transactionId: '',
      phone: (staff as any)?.phone || '',
    });
    setIsPayModalOpen(true);
  };

  const processPayment = async () => {
    if (!processingSalary) return;
    if (loading) return; // Re-entrancy guard against rapid double-click

    const amt = Number(paymentData.paidAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('Amount must be greater than 0', 'error');
      return;
    }
    const balance = processingSalary.balanceAmount || 0;
    if (amt > balance) {
      showToast(`Amount exceeds outstanding balance of Rs. ${balance.toLocaleString('en-IN')}`, 'error');
      return;
    }

    setLoading(true);
    try {
      const paymentTimestamp = new Date().toISOString();
      const newPaidAmount = (processingSalary.paidAmount || 0) + amt;
      const newBalance = Math.max(0, processingSalary.netAmount - newPaidAmount);
      const status = newBalance <= 0 ? 'paid' : 'partially_paid';

      const payment = {
        amount: amt,
        date: paymentTimestamp,
        method: paymentData.method,
        transactionId: paymentData.transactionId || '',
        recordedBy: (user as any)?.email || 'system',
      };
      const history = [...((processingSalary as any).paymentHistory || []), payment];

      // Atomic write: salary update + expense creation must both succeed or both fail
      const batch = writeBatch(db);
      const salaryRef = doc(db, 'salaries', processingSalary.id);
      const expenseRef = doc(collection(db, 'expenses'));

      batch.update(salaryRef, {
        paidAmount: newPaidAmount,
        balanceAmount: newBalance,
        status,
        paidAt: paymentTimestamp,
        updatedAt: paymentTimestamp,
        paymentHistory: history,
      });

      batch.set(expenseRef, {
        category: 'salary',
        biller: processingSalary.employeeName,
        amount: amt,
        date: paymentTimestamp.split('T')[0],
        status: 'paid',
        paymentMethod: paymentData.method,
        description: `Salary Payment - ${fmtMonth(processingSalary.month)} (${processingSalary.employeeRole})`,
        salaryId: processingSalary.id,
        salaryPaymentDate: paymentTimestamp,
        createdAt: paymentTimestamp,
      });

      await batch.commit();

      logActivity(
        user,
        'Processed Salary Payment',
        'Accounts',
        `Paid Rs. ${amt.toLocaleString('en-IN')} to ${processingSalary.employeeName} (${status === 'paid' ? 'Full' : 'Partial'} - ${fmtMonth(processingSalary.month)})`
      );
      showToast(
        status === 'paid'
          ? 'Full payment processed successfully'
          : `Partial payment recorded. Balance: Rs. ${newBalance.toLocaleString('en-IN')}`,
        'success'
      );

      // Side effects after the atomic write succeeds — phone update + WhatsApp
      const enteredPhone = (paymentData.phone || '').trim();
      try {
        const staff = staffList.find(s => s.id === processingSalary.employeeId);
        if (enteredPhone && staff && (staff as any).phone !== enteredPhone) {
          const collectionName = staff.staffCategory === 'Teacher' ? 'teachers' : 'staff';
          await updateDoc(doc(db, collectionName, processingSalary.employeeId), { phone: enteredPhone });
        }
      } catch (e) {
        console.warn('Phone update failed:', e);
      }

      if (enteredPhone) {
        try {
          const res = await fetch('/api/whatsapp/send-template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: enteredPhone,
              templateName: 'salaries_disbursed',
              parameters: [
                processingSalary.employeeName,
                `Rs. ${amt.toLocaleString('en-IN')}`,
                processingSalary.month,
                processingSalary.employeeRole,
                (paymentData.method || '').replace(/_/g, ' '),
                paymentData.transactionId || '-',
                new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
              ],
            }),
          });
          if (!res.ok) throw new Error(`status ${res.status}`);
        } catch (e) {
          console.warn('WhatsApp notification failed:', e);
          showToast('Payment saved, but WhatsApp notification could not be sent.', 'warning' as any);
        }
      }

      setIsPayModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `salaries/${processingSalary.id}`);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenHistory = (staff: UnifiedStaff) => {
    setHistoryStaff(staff);
    setIsHistoryModalOpen(true);
  };

  const exportPayroll = async () => {
    const headers = ['Employee', 'Category', 'Month', 'Base', 'Bonus', 'PF', 'Tax', 'Leaves', 'Net Amount', 'Paid', 'Balance', 'Status'];
    const csvData = salaries.map(s => [
      s.employeeName,
      staffList.find(staff => staff.id === s.employeeId)?.staffCategory || 'Unknown',
      fmtMonth(s.month),
      s.baseAmount || (s as any).amount || 0,
      s.allowances || (s as any).bonus || 0,
      s.deductions?.pf || 0,
      s.deductions?.tax || 0,
      s.deductions?.leaves || 0,
      s.netAmount || (s as any).amount || 0,
      s.paidAmount,
      s.balanceAmount,
      s.status
    ]);

    const csvContent = [headers, ...csvData].map(row => row.join(',')).join('\n');
    await saveText(csvContent, `Payroll_Export_${fmtMonth(selectedMonth).replace(/\s+/g, '_')}.csv`);
  };

  const filteredStaff = useMemo(() => {
    return staffList.filter(s => {
      const matchesSearch = (s.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                           (s.email || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = selectedCategory === 'all' || s.staffCategory.toLowerCase() === selectedCategory.toLowerCase();
      return matchesSearch && matchesCategory;
    });
  }, [staffList, searchTerm, selectedCategory]);

  const stats = useMemo(() => {
    const monthSalaries = salaries.filter(s => s.month === selectedMonth);
    const totalNet = monthSalaries.reduce((sum, s) => sum + (s.netAmount || (s as any).amount || 0), 0);
    const totalPaid = monthSalaries.reduce((sum, s) => sum + (s.paidAmount || 0), 0);
    const pendingCount = monthSalaries.filter(s => s.status !== 'paid').length;

    return {
      totalNet,
      totalPaid,
      pendingCount,
      totalExpenses: salaries.reduce((sum, s) => sum + (s.paidAmount || 0), 0)
    };
  }, [salaries, selectedMonth]);

  const chartData = useMemo(() => {
    const categories = ['Teacher', 'Principal', 'Accounts', 'Admin', 'Other Staff'];
    return categories.map(cat => {
      const catSalaries = salaries.filter(s => {
        const staff = staffList.find(st => st.id === s.employeeId || (st as any).teacherId === s.employeeId);
        return staff?.staffCategory === cat;
      });
      return {
        name: cat,
        amount: catSalaries.reduce((sum, s) => sum + (s.paidAmount || 0), 0)
      };
    }).filter(d => d.amount > 0);
  }, [salaries, staffList]);

  const COLORS = ['#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e'];

  const staffCategoryChips = ['all', 'teacher', 'principal', 'accounts', 'admin', 'other staff'];

  // Derive year and month index from selectedMonth string (YYYY-MM)
  const [selYear, selMonthIdx] = selectedMonth.split('-').map(Number);

  const handleMonthChip = (idx: number) => {
    const mm = String(idx + 1).padStart(2, '0');
    setSelectedMonth(`${selYear}-${mm}`);
  };

  const monthLabel = new Date(selectedMonth + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <>
      {/* ── Topbar ──────────────────────────────────────────────────────── */}
      <div className="topbar">
        <div>
          <div className="eyebrow">{monthLabel}</div>
          <h1>Salaries</h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn ghost" onClick={exportPayroll}>
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button className="btn accent" onClick={() => setIsAnalyticsOpen(true)}>
            <TrendingUp className="w-4 h-4" /> Analytics
          </button>
        </div>
      </div>

      {/* ── Month Selector ───────────────────────────────────────────────── */}
      <div className="hscroll pad" style={{ paddingTop: 0, paddingBottom: 0 }}>
        <div style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem 0' }}>
          {MONTHS.map((m, i) => (
            <button
              key={m}
              onClick={() => handleMonthChip(i)}
              className={`chip${(i + 1) === selMonthIdx ? ' solid' : ''}`}
              style={{ whiteSpace: 'nowrap' }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* ── Summary Stat Cards ───────────────────────────────────────────── */}
      <div className="pad" style={{ paddingBottom: 0 }}>
        <div className="stack" style={{ '--stack-cols': 3 } as any}>
          <div className="card" style={{ padding: '1rem 1.25rem' }}>
            <div className="eyebrow">Total Payroll</div>
            <div className="t-num" style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '0.25rem' }}>
              ₹{stats.totalNet.toLocaleString('en-IN')}
            </div>
            <div className="tiny muted">{fmtMonth(selectedMonth)}</div>
          </div>
          <div className="card" style={{ padding: '1rem 1.25rem', borderColor: 'var(--leaf)' }}>
            <div className="eyebrow" style={{ color: 'var(--leaf)' }}>Paid</div>
            <div className="t-num" style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '0.25rem', color: 'var(--leaf)' }}>
              ₹{stats.totalPaid.toLocaleString('en-IN')}
            </div>
            <div className="tiny muted">disbursed this month</div>
          </div>
          <div className="card" style={{ padding: '1rem 1.25rem', borderColor: 'var(--coral)' }}>
            <div className="eyebrow" style={{ color: 'var(--coral)' }}>Pending</div>
            <div className="t-num" style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '0.25rem', color: 'var(--coral)' }}>
              {stats.pendingCount}
            </div>
            <div className="tiny muted">staff awaiting payment</div>
          </div>
        </div>
      </div>

      {/* ── Search + Category Filter ─────────────────────────────────────── */}
      <div className="pad" style={{ paddingTop: '1rem', paddingBottom: 0 }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '1 1 240px' }}>
            <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search staff by name or email…" />
          </div>
          <div className="hscroll" style={{ flex: '0 0 auto' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {staffCategoryChips.map(c => (
                <button
                  key={c}
                  onClick={() => setSelectedCategory(c)}
                  className={`chip${selectedCategory === c ? ' solid' : ''}`}
                  style={{ textTransform: 'capitalize', whiteSpace: 'nowrap' }}
                >
                  {c === 'all' ? 'All' : c}
                </button>
              ))}
            </div>
          </div>
          <Select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            style={{ width: '140px' }}
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
          </Select>
        </div>
      </div>

      {/* ── Mobile Cards ─────────────────────────────────────────────────── */}
      <div className="pad lg:hidden">
        <div className="stack">
          {filteredStaff.length === 0 ? (
            <EmptyState icon={Users} title="No staff found" />
          ) : (
            filteredStaff.map((staff) => {
              const salary = salaries.find(s => (s.employeeId === staff.id || (s as any).teacherId === staff.id) && s.month === selectedMonth);
              if (selectedStatus !== 'all') {
                const st = salary?.status || 'unrecorded';
                if (selectedStatus === 'pending' && st === 'paid') return null;
                if (selectedStatus === 'paid' && st !== 'paid') return null;
              }
              const isPaid = salary?.status === 'paid';
              const initials = staff.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
              return (
                <div key={staff.id} className="card" style={{ padding: '1rem' }}>
                  {/* Row 1: avatar + name + status chip */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{
                      width: '2.5rem', height: '2.5rem', borderRadius: '50%',
                      background: 'var(--cream-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: '0.85rem', color: 'var(--ink)', flexShrink: 0,
                      overflow: 'hidden',
                    }}>
                      {staff.photoURL
                        ? <img src={staff.photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : initials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{staff.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem', flexWrap: 'wrap' }}>
                        <span className="chip" style={{ fontSize: '0.7rem', padding: '0.1rem 0.5rem' }}>{staff.staffCategory}</span>
                        <span className="tiny muted">{(staff as any).role || 'Staff'}</span>
                      </div>
                    </div>
                    {!salary ? (
                      <span className="chip" style={{ fontSize: '0.7rem', background: 'var(--cream-2)', color: 'var(--ink)', flexShrink: 0 }}>Unrecorded</span>
                    ) : (
                      <span
                        className="chip solid"
                        style={{
                          fontSize: '0.7rem', flexShrink: 0,
                          background: isPaid ? 'var(--leaf)' : salary.status === 'partially_paid' ? 'var(--accent)' : 'var(--coral)',
                        }}
                      >
                        {salary.status.replace('_', ' ')}
                      </span>
                    )}
                  </div>

                  {/* Row 2: salary numbers */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <div style={{ background: 'var(--cream-2)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}>
                      <div className="eyebrow">Basic + Allowances</div>
                      <div className="t-num" style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                        ₹{(staff.baseSalary || 0).toLocaleString('en-IN')}
                        {salary && salary.allowances > 0 && (
                          <span style={{ fontSize: '0.7rem', color: 'var(--leaf)', marginLeft: '0.3rem' }}>+{salary.allowances.toLocaleString('en-IN')}</span>
                        )}
                      </div>
                    </div>
                    <div style={{ background: 'var(--cream-2)', borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}>
                      <div className="eyebrow">Net Pay</div>
                      <div className="t-num" style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--ink)' }}>
                        ₹{(salary ? (salary.netAmount || (salary as any).amount) : staff.baseSalary).toLocaleString('en-IN')}
                      </div>
                    </div>
                  </div>

                  {/* Row 3: action buttons */}
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                    {!salary ? (
                      <button className="btn accent" style={{ flex: 1 }} onClick={() => handleOpenCreatePayroll(staff)}>
                        <Plus className="w-3.5 h-3.5" /> Generate
                      </button>
                    ) : !isPaid ? (
                      <button className="btn accent" style={{ flex: 1 }} onClick={() => handleOpenPayment(salary)}>
                        <CreditCard className="w-3.5 h-3.5" /> Pay ₹{salary.balanceAmount.toLocaleString('en-IN')}
                      </button>
                    ) : (
                      <div className="btn ghost" style={{ flex: 1, cursor: 'default', color: 'var(--leaf)' }}>
                        <CheckCircle2 className="w-3.5 h-3.5" /> Paid
                      </div>
                    )}
                    <button className="icon-btn" title="Advance" onClick={() => handleOpenAdvance(staff)} style={{ color: '#b45309' }}>
                      <HandCoins className="w-4 h-4" />
                    </button>
                    <button className="icon-btn" title="History" onClick={() => handleOpenHistory(staff)}>
                      <History className="w-4 h-4" />
                    </button>
                    {salary ? (
                      <button
                        className="icon-btn"
                        title="Download Payslip"
                        onClick={() => generatePayrollSlip(salary, (staffList.find(s => s.id === salary.employeeId) as any)?.employeeId)}
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    ) : (
                      <button className="icon-btn" disabled style={{ opacity: 0.35 }}>
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                    {salary && salary.status === 'pending' && (
                      <>
                        <button className="icon-btn" title="Edit" onClick={() => handleOpenEditPayroll(salary, staff)}>
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button className="icon-btn" title="Delete" style={{ color: 'var(--coral)' }} onClick={() => { setSalaryToDelete(salary); setIsDeleteConfirmOpen(true); }}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Desktop Table ────────────────────────────────────────────────── */}
      <div className="hidden lg:block overflow-x-auto pad" style={{ paddingTop: '1rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--line)' }}>
              {['Employee', 'Category', `Status — ${monthLabel}`, 'Net Salary', 'Actions'].map(h => (
                <th key={h} style={{ padding: '0.6rem 0.75rem', textAlign: h === 'Actions' ? 'right' : 'left', fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredStaff.map((staff) => {
              const salary = salaries.find(s => (s.employeeId === staff.id || (s as any).teacherId === staff.id) && s.month === selectedMonth);
              if (selectedStatus !== 'all') {
                const st = salary?.status || 'unrecorded';
                if (selectedStatus === 'pending' && st === 'paid') return null;
                if (selectedStatus === 'paid' && st !== 'paid') return null;
              }
              const isPaid = salary?.status === 'paid';
              const initials = staff.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
              return (
                <tr key={staff.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  {/* Employee */}
                  <td style={{ padding: '0.65rem 0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <div style={{
                        width: '2rem', height: '2rem', borderRadius: '50%',
                        background: 'var(--cream-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: '0.75rem', flexShrink: 0, overflow: 'hidden',
                      }}>
                        {staff.photoURL
                          ? <img src={staff.photoURL} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : initials}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700 }}>{staff.name}</div>
                        <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{(staff as any).role || 'Faculty'}</div>
                      </div>
                    </div>
                  </td>
                  {/* Category */}
                  <td style={{ padding: '0.65rem 0.75rem' }}>
                    <span className="chip" style={{ fontSize: '0.7rem' }}>{staff.staffCategory}</span>
                  </td>
                  {/* Status */}
                  <td style={{ padding: '0.65rem 0.75rem' }}>
                    {!salary ? (
                      <span className="chip" style={{ fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                        <AlertCircle className="w-3 h-3" /> Unrecorded
                      </span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <span
                          className="chip solid"
                          style={{
                            fontSize: '0.7rem', display: 'inline-block',
                            background: isPaid ? 'var(--leaf)' : salary.status === 'partially_paid' ? 'var(--accent)' : 'var(--coral)',
                          }}
                        >
                          {salary.status.replace('_', ' ')}
                        </span>
                        {salary.paidAmount > 0 && (
                          <span className="tiny muted">Paid: ₹{salary.paidAmount.toLocaleString('en-IN')}</span>
                        )}
                      </div>
                    )}
                  </td>
                  {/* Net Salary */}
                  <td style={{ padding: '0.65rem 0.75rem' }}>
                    <div className="t-num" style={{ fontWeight: 800 }}>
                      ₹{(salary ? (salary.netAmount || (salary as any).amount) : staff.baseSalary).toLocaleString('en-IN')}
                    </div>
                    <div className="tiny muted">Base: ₹{(staff.baseSalary || 0).toLocaleString('en-IN')}</div>
                  </td>
                  {/* Actions */}
                  <td style={{ padding: '0.65rem 0.75rem', textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {!salary ? (
                        <Button size="sm" onClick={() => handleOpenCreatePayroll(staff)} icon={Plus}>Generate</Button>
                      ) : salary.status !== 'paid' ? (
                        <Button size="sm" variant="primary" onClick={() => handleOpenPayment(salary)} icon={CreditCard}>Pay</Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="text-emerald-600" disabled icon={CheckCircle2}>Paid</Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-amber-600" onClick={() => handleOpenAdvance(staff)} icon={HandCoins} title="Pay Salary Advance" />
                      {salary && salary.status === 'pending' && (
                        <>
                          <Button size="sm" variant="ghost" className="text-slate-500" onClick={() => handleOpenEditPayroll(salary, staff)} icon={Edit2} title="Edit Payroll" />
                          <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => { setSalaryToDelete(salary); setIsDeleteConfirmOpen(true); }} icon={Trash2} title="Delete Payroll" />
                        </>
                      )}
                      <Button size="sm" variant="ghost" className="text-slate-500" onClick={() => handleOpenHistory(staff)} icon={History} title="View Payment History" />
                      {salary && (
                        <button
                          className="icon-btn"
                          title="Download Payslip"
                          onClick={() => generatePayrollSlip(salary, (staffList.find(s => s.id === salary.employeeId) as any)?.employeeId)}
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredStaff.length === 0 && <EmptyState icon={Users} title="No staff members match filters" />}
      </div>

      {/* ─────────────────────── MODALS (all preserved) ─────────────────── */}

      {/* Step 1: Create Payroll Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => { setIsCreateModalOpen(false); setEditingSalary(null); }}
        title={editingSalary ? 'Edit Payroll' : 'Step 1: Calculate Monthly Payroll'}
        subtitle={processingStaff ? `For ${processingStaff.name}${editingSalary ? ` · ${fmtMonth(editingSalary.month)}` : ''}` : ''}
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => { setIsCreateModalOpen(false); setEditingSalary(null); }}>Cancel</Button>
            <Button variant="primary" onClick={generatePayroll} loading={loading} icon={ArrowRight}>
              {editingSalary ? 'Save Changes' : 'Finalize Payroll'}
            </Button>
          </div>
        }
      >
        {processingStaff && (() => {
          const out = editingSalary ? { total: 0, advances: [] as SalaryAdvance[] } : outstandingAdvanceFor(processingStaff.id);
          const baseNet = calculateNetAmount(processingStaff);
          const adjusted = Math.min(out.total, baseNet);
          const finalNet = Math.max(0, baseNet - adjusted);
          return (
          <div className="space-y-6">
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Avatar name={processingStaff.name} size="sm" src={processingStaff.photoURL} />
                <div>
                  <h4 className="font-bold text-slate-900 leading-none">{processingStaff.name}</h4>
                  <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mt-1">{(processingStaff as any).role || 'Staff'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="default">Target Payroll Month</Badge>
                <Input
                  type="month"
                  value={targetMonth}
                  onChange={(e) => setTargetMonth(e.target.value)}
                  className="w-40 h-9 py-0 font-bold"
                  disabled={!!editingSalary}
                />
              </div>
            </div>

            {out.total > 0 && !editingSalary && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
                <HandCoins className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-amber-900">
                    Outstanding advance: Rs. {out.total.toLocaleString('en-IN')}
                  </p>
                  <p className="text-[11px] text-amber-700 mt-1">
                    Rs. {adjusted.toLocaleString('en-IN')} will be auto-adjusted against this payroll.
                    {out.total > baseNet && ` Rs. ${(out.total - baseNet).toLocaleString('en-IN')} will roll over to next month.`}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b pb-2">Additions</h4>
                <div className="space-y-4">
                  <FormField label="Monthly Base Salary">
                    <Input value={`₹${processingStaff.baseSalary.toLocaleString()}`} disabled className="bg-slate-50 font-bold" />
                  </FormField>
                  <FormField label="Incentives / Bonus">
                    <Input
                      type="number"
                      value={payrollForm.bonus}
                      onChange={(e) => setPayrollForm({ ...payrollForm, bonus: Number(e.target.value) })}
                      placeholder="0"
                    />
                  </FormField>
                </div>

                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b pb-2 pt-4">Deductions</h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label={`EPF (${payrollConfig?.pfRate || 12}%)`}>
                    <Input
                      type="number"
                      value={payrollForm.pf}
                      onChange={(e) => setPayrollForm({ ...payrollForm, pf: Number(e.target.value) })}
                    />
                  </FormField>
                  <FormField label="Tax (P-Tax / TDS)">
                    <Input
                      type="number"
                      value={payrollForm.tax}
                      onChange={(e) => setPayrollForm({ ...payrollForm, tax: Number(e.target.value) })}
                    />
                  </FormField>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="Leaves Taken">
                    <Input
                      type="number"
                      max="31"
                      value={payrollForm.leaves}
                      onChange={(e) => setPayrollForm({ ...payrollForm, leaves: Number(e.target.value) })}
                    />
                  </FormField>
                  <FormField label="Deduction per Day Leave">
                    <Input
                      type="number"
                      value={payrollForm.leaveDeductionRate}
                      onChange={(e) => setPayrollForm({ ...payrollForm, leaveDeductionRate: Number(e.target.value) })}
                    />
                  </FormField>
                </div>
                <FormField label="Misc Deductions">
                  <Input
                    type="number"
                    value={payrollForm.otherDeductions}
                    onChange={(e) => setPayrollForm({ ...payrollForm, otherDeductions: Number(e.target.value) })}
                  />
                </FormField>
              </div>

              <div className="flex flex-col">
                <div className="bg-slate-900 text-white rounded-3xl p-6 flex-1 flex flex-col justify-between">
                  <div>
                    <h4 className="text-blue-400 font-bold text-xs uppercase tracking-widest mb-6">Payroll Preview</h4>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-400">Monthly Base</span>
                        <span className="font-mono">₹{processingStaff.baseSalary.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-400">Allowances</span>
                        <span className="text-emerald-400 font-mono">+ ₹{payrollForm.bonus.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-400">Total Deductions</span>
                        <span className="text-rose-400 font-mono">
                          - ₹{(
                            payrollForm.pf +
                            payrollForm.tax +
                            payrollForm.otherDeductions +
                            (payrollForm.leaves * payrollForm.leaveDeductionRate)
                          ).toLocaleString()}
                        </span>
                      </div>
                      {adjusted > 0 && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-amber-300">Advance Adjustment</span>
                          <span className="text-amber-300 font-mono">- Rs. {adjusted.toLocaleString('en-IN')}</span>
                        </div>
                      )}
                      <div className="h-px bg-slate-800 my-4" />
                      <div className="flex justify-between items-end">
                        <div className="flex flex-col">
                          <p className="text-[10px] font-bold text-slate-500 uppercase">{editingSalary ? 'Updated Net Pay' : 'Calculated Net Pay'}</p>
                          <p className="text-4xl font-black text-white">Rs. {finalNet.toLocaleString('en-IN')}</p>
                        </div>
                        <Badge variant="success" className="mb-2">READY</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="mt-8">
                    <p className="text-[10px] text-slate-500 italic mb-4">
                      * Rate calculation: (₹{processingStaff.baseSalary.toLocaleString()} × 12) / {payrollConfig?.workingDaysInYear || 240} = ₹{payrollForm.leaveDeductionRate.toLocaleString()}/day
                    </p>
                    <FormField label="Remarks / Note">
                      <Textarea
                        className="bg-slate-800 border-none text-white"
                        placeholder="e.g. Performance bonus included..."
                        value={payrollForm.remarks}
                        onChange={(e) => setPayrollForm({ ...payrollForm, remarks: e.target.value })}
                        rows={3}
                      />
                    </FormField>
                  </div>
                </div>
              </div>
            </div>
          </div>
          );
        })()}
      </Modal>

      {/* Step 2: Payment Modal */}
      <Modal
        isOpen={isPayModalOpen && !!processingSalary}
        onClose={() => setIsPayModalOpen(false)}
        title="Step 2: Disburse Salary"
        subtitle={processingSalary ? `Paying ${processingSalary.employeeName} for ${fmtMonth(processingSalary.month)}` : ''}
        size="md"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setIsPayModalOpen(false)}>Back</Button>
            <Button variant="primary" onClick={processPayment} loading={loading} icon={CheckCircle2}>
               Confirm Payment
            </Button>
          </div>
        }
      >
        {processingSalary && (
          <div className="space-y-6">
            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 text-center">
              <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest mb-1">Net Amount Payable</p>
              <h2 className="text-5xl font-black text-emerald-900">₹{processingSalary.balanceAmount.toLocaleString()}</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Amount to Pay">
                <Input
                  type="number"
                  value={paymentData.paidAmount}
                  onChange={(e) => setPaymentData({ ...paymentData, paidAmount: Number(e.target.value) })}
                  className="font-bold text-lg"
                />
              </FormField>
              <FormField label="Method">
                <Select
                  value={paymentData.method}
                  onChange={(e) => setPaymentData({ ...paymentData, method: e.target.value })}
                >
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash Payment</option>
                  <option value="upi">UPI / Instant Pay</option>
                  <option value="cheque">Cheque</option>
                </Select>
              </FormField>
            </div>

            <FormField label="Transaction ID / Ref">
              <Input
                value={paymentData.transactionId}
                onChange={(e) => setPaymentData({ ...paymentData, transactionId: e.target.value })}
                placeholder="TXN..."
              />
            </FormField>

            <FormField label="Mobile Number (WhatsApp confirmation will be sent)">
              <Input
                type="tel"
                value={paymentData.phone}
                onChange={(e) => setPaymentData({ ...paymentData, phone: e.target.value })}
                placeholder="10-digit mobile number"
              />
            </FormField>

            <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 flex items-start gap-3">
              <History className="w-5 h-5 text-blue-500 mt-1" />
              <div>
                <p className="text-sm font-bold text-blue-900">Accounting Note</p>
                <p className="text-[10px] text-blue-700 mt-0.5">
                  This will be recorded as a "Salary" expense in the accounts portal.
                  {paymentData.phone ? ' A WhatsApp confirmation will be sent to the employee.' : ''}
                </p>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Analytics Modal */}
      <Modal
        isOpen={isAnalyticsOpen}
        onClose={() => setIsAnalyticsOpen(false)}
        title="Payroll Insights & Analytics"
        size="xl"
      >
        <div className="space-y-8 min-h-[500px]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="card p-6 overflow-hidden">
              <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2">
                <PieChartIcon className="w-5 h-5 text-blue-500" />
                Distribution by Category
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} />
                    <YAxis fontSize={10} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v/1000}k`} />
                    <Tooltip cursor={{ fill: '#f8fafc' }} formatter={(v: any) => `₹${v.toLocaleString()}`} />
                    <Bar dataKey="amount" radius={[8, 8, 0, 0]} barSize={40}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <History className="w-5 h-5 text-emerald-500" />
                Recent Disbursements
              </h3>
              <div className="space-y-3">
                {salaries.filter(s => s.paidAmount > 0).slice(0, 6).map(s => (
                  <div key={s.id} className="card p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar name={s.employeeName} size="sm" />
                      <div>
                        <p className="text-sm font-bold text-slate-900">{s.employeeName}</p>
                        <p className="text-[10px] text-slate-400 capitalize font-medium">{fmtMonth(s.month)} • {s.employeeRole}</p>
                      </div>
                    </div>
                    <p className="font-black" style={{ color: 'var(--leaf)' }}>₹{s.paidAmount.toLocaleString()}</p>
                  </div>
                ))}
                {salaries.filter(s => s.paidAmount > 0).length === 0 && (
                   <div className="py-20 text-center text-slate-400 text-sm italic border-2 border-dashed border-slate-100 rounded-3xl">
                     No payments recorded yet.
                   </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Payment History Modal — full audit trail per employee */}
      <Modal
        isOpen={isHistoryModalOpen && !!historyStaff}
        onClose={() => setIsHistoryModalOpen(false)}
        title="Salary & Payment History"
        subtitle={historyStaff ? `${historyStaff.name} · ${historyStaff.staffCategory}` : ''}
        size="xl"
      >
        {historyStaff && (() => {
          const employeeSalaries = salaries
            .filter(s => s.employeeId === historyStaff.id)
            .sort((a, b) => (b.month || '').localeCompare(a.month || ''));

          const totalEarned = employeeSalaries.reduce((sum, s) => sum + (s.netAmount || 0), 0);
          const totalPaid = employeeSalaries.reduce((sum, s) => sum + (s.paidAmount || 0), 0);
          const totalDue = employeeSalaries.reduce((sum, s) => sum + (s.balanceAmount || 0), 0);
          const allPayments = employeeSalaries.flatMap(s =>
            (s.paymentHistory || []).map(p => ({ ...p, month: s.month, netAmount: s.netAmount, salaryId: s.id }))
          );
          const empAdvances = advances
            .filter(a => a.employeeId === historyStaff.id)
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          const outstandingAdv = empAdvances.reduce((s, a) =>
            s + Math.max(0, (a.amount || 0) - (a.adjustedAmount || 0)), 0);

          return (
            <div className="space-y-6">
              {/* Summary cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="card" style={{ padding: '1rem' }}>
                  <div className="eyebrow">Total Earned (All Months)</div>
                  <div className="t-num" style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: '0.5rem' }}>Rs. {totalEarned.toLocaleString('en-IN')}</div>
                  <div className="tiny muted mt-1">{employeeSalaries.length} payroll record(s)</div>
                </div>
                <div className="card" style={{ padding: '1rem', borderColor: 'var(--leaf)' }}>
                  <div className="eyebrow" style={{ color: 'var(--leaf)' }}>Total Disbursed</div>
                  <div className="t-num" style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: '0.5rem', color: 'var(--leaf)' }}>Rs. {totalPaid.toLocaleString('en-IN')}</div>
                  <div className="tiny muted mt-1">{allPayments.length} payment(s) made</div>
                </div>
                <div className="card" style={{ padding: '1rem', borderColor: totalDue > 0 ? 'var(--coral)' : 'var(--line)' }}>
                  <div className="eyebrow" style={{ color: totalDue > 0 ? 'var(--coral)' : undefined }}>Outstanding Balance</div>
                  <div className="t-num" style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: '0.5rem', color: totalDue > 0 ? 'var(--coral)' : 'var(--ink)' }}>Rs. {totalDue.toLocaleString('en-IN')}</div>
                  <div className="tiny muted mt-1">{totalDue > 0 ? 'Pending disbursement' : 'All settled'}</div>
                </div>
              </div>

              {empAdvances.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                      <HandCoins className="w-4 h-4 text-amber-600" /> Salary Advances
                    </h4>
                    {outstandingAdv > 0 && (
                      <Badge variant="warning">Outstanding: Rs. {outstandingAdv.toLocaleString('en-IN')}</Badge>
                    )}
                  </div>
                  <div className="space-y-2">
                    {empAdvances.map((adv) => {
                      const remaining = Math.max(0, (adv.amount || 0) - (adv.adjustedAmount || 0));
                      const advStatusVar =
                        adv.status === 'adjusted' ? 'success' :
                        adv.status === 'partially_adjusted' ? 'info' : 'warning';
                      return (
                        <div key={adv.id} className="rounded-xl border border-slate-200 bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${remaining > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                <HandCoins className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-slate-900 leading-none">
                                  Rs. {(adv.amount || 0).toLocaleString('en-IN')}
                                  <span className="ml-2 text-[10px] uppercase tracking-widest text-slate-400 font-bold">Advance</span>
                                </p>
                                <p className="text-[10px] text-slate-500 mt-1 font-medium">
                                  {new Date(adv.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                  {' · '}<span className="uppercase">{(adv.method || '').replace(/_/g, ' ')}</span>
                                  {adv.transactionId ? ` · TXN ${adv.transactionId}` : ''}
                                  {adv.reason ? ` · ${adv.reason}` : ''}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <Badge variant={advStatusVar as any}>{adv.status.replace('_', ' ').toUpperCase()}</Badge>
                              <p className="text-[10px] text-slate-400 mt-1">
                                Adjusted: Rs. {(adv.adjustedAmount || 0).toLocaleString('en-IN')} · Pending: Rs. {remaining.toLocaleString('en-IN')}
                              </p>
                            </div>
                          </div>
                          {(adv.adjustments || []).length > 0 && (
                            <div className="mt-2 pt-2 border-t border-slate-100">
                              <p className="text-[9px] uppercase tracking-widest font-bold text-slate-400 mb-1">Adjusted Against</p>
                              <div className="flex flex-wrap gap-1.5">
                                {(adv.adjustments || []).map((adj, i) => (
                                  <span key={i} className="text-[10px] bg-slate-100 text-slate-700 rounded-full px-2 py-0.5 font-medium">
                                    {fmtMonth(adj.month)}: Rs. {adj.amount.toLocaleString('en-IN')}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {employeeSalaries.length === 0 ? (
                <EmptyState icon={History} title="No payroll records" description="Generate a payroll first to start tracking payments." />
              ) : (
                <div className="space-y-4">
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-500">Monthly Payroll Breakdown</h4>
                  {employeeSalaries.map((s) => {
                    const mLabel = fmtMonth(s.month);
                    const history = s.paymentHistory || [];
                    const statusColor =
                      s.status === 'paid' ? 'success' :
                      s.status === 'partially_paid' ? 'info' : 'warning';

                    return (
                      <div key={s.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                        {/* Header strip */}
                        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-50 border-b border-slate-100">
                          <div className="flex items-center gap-3">
                            <Calendar className="w-4 h-4 text-slate-400" />
                            <div>
                              <p className="text-sm font-bold text-slate-900 leading-none">{mLabel}</p>
                              <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest font-bold">
                                Net Rs. {(s.netAmount || 0).toLocaleString('en-IN')} · Paid Rs. {(s.paidAmount || 0).toLocaleString('en-IN')} · Balance Rs. {(s.balanceAmount || 0).toLocaleString('en-IN')}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={statusColor as any}>{s.status.replace('_', ' ').toUpperCase()}</Badge>
                            <Button size="sm" variant="ghost" icon={Download} onClick={() => generatePayrollSlip(s, (staffList.find(st => st.id === s.employeeId) as any)?.employeeId)} title="Download Pay Slip" />
                          </div>
                        </div>

                        {/* Payments list */}
                        {history.length === 0 ? (
                          <div className="px-4 py-6 text-center text-xs text-slate-400 italic">
                            No payments disbursed yet for this month.
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-100">
                            {history.map((p: any, idx: number) => {
                              const cumulative = history.slice(0, idx + 1).reduce((sum: number, x: any) => sum + (x.amount || 0), 0);
                              const isFinalPayment = cumulative >= (s.netAmount || 0);
                              const paymentLabel = history.length === 1 && isFinalPayment ? 'Full Payment' :
                                                   isFinalPayment ? `Final Installment (#${idx + 1})` :
                                                   `Partial Installment #${idx + 1}`;
                              return (
                                <div key={idx} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50/70">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isFinalPayment && history.length === 1 ? 'bg-emerald-100 text-emerald-700' : isFinalPayment ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                                      <Banknote className="w-4 h-4" />
                                    </div>
                                    <div>
                                      <p className="text-sm font-bold text-slate-900 leading-none">
                                        Rs. {(p.amount || 0).toLocaleString('en-IN')}
                                        <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                          {paymentLabel}
                                        </span>
                                      </p>
                                      <p className="text-[10px] text-slate-500 mt-1 font-medium">
                                        {new Date(p.date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        {' · '}
                                        <span className="uppercase">{(p.method || '').replace(/_/g, ' ')}</span>
                                        {p.transactionId ? ` · TXN ${p.transactionId}` : ''}
                                        {p.recordedBy ? ` · by ${p.recordedBy}` : ''}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Running Total</p>
                                    <p className="text-xs font-black text-slate-700">Rs. {cumulative.toLocaleString('en-IN')} / Rs. {(s.netAmount || 0).toLocaleString('en-IN')}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* Salary Advance Modal */}
      <Modal
        isOpen={isAdvanceModalOpen && !!advanceStaff}
        onClose={() => setIsAdvanceModalOpen(false)}
        title="Pay Salary Advance"
        subtitle={advanceStaff ? `${advanceStaff.name} · ${advanceStaff.staffCategory}` : ''}
        size="md"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setIsAdvanceModalOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={processAdvance} loading={loading} icon={HandCoins}>
              Disburse Advance
            </Button>
          </div>
        }
      >
        {advanceStaff && (() => {
          const out = outstandingAdvanceFor(advanceStaff.id);
          return (
            <div className="space-y-5">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Current Outstanding Advance</p>
                <p className="text-3xl font-black text-amber-900 mt-1">Rs. {out.total.toLocaleString('en-IN')}</p>
                <p className="text-[11px] text-amber-700 mt-1">
                  New advance will add to this. Outstanding amount is auto-deducted from the next generated payroll.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Advance Amount" required>
                  <Input
                    type="number"
                    min={0}
                    value={advanceForm.amount}
                    onChange={(e) => setAdvanceForm({ ...advanceForm, amount: Number(e.target.value) })}
                    className="font-bold text-lg"
                    placeholder="0"
                  />
                </FormField>
                <FormField label="Method" required>
                  <Select
                    value={advanceForm.method}
                    onChange={(e) => setAdvanceForm({ ...advanceForm, method: e.target.value })}
                  >
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cash">Cash Payment</option>
                    <option value="upi">UPI / Instant Pay</option>
                    <option value="cheque">Cheque</option>
                  </Select>
                </FormField>
              </div>

              <FormField label="Transaction ID / Ref">
                <Input
                  value={advanceForm.transactionId}
                  onChange={(e) => setAdvanceForm({ ...advanceForm, transactionId: e.target.value })}
                  placeholder="TXN..."
                />
              </FormField>

              <FormField label="Reason / Purpose">
                <Textarea
                  rows={2}
                  value={advanceForm.reason}
                  onChange={(e) => setAdvanceForm({ ...advanceForm, reason: e.target.value })}
                  placeholder="e.g. Medical emergency, school trip advance..."
                />
              </FormField>

              <FormField label="Mobile Number (WhatsApp confirmation will be sent)">
                <Input
                  type="tel"
                  value={advanceForm.phone}
                  onChange={(e) => setAdvanceForm({ ...advanceForm, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                  placeholder="10-digit mobile number"
                />
              </FormField>

              <div className="p-3 bg-blue-50 rounded-xl border border-blue-100 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-[11px] text-blue-700">
                  This will be recorded as a <strong>Salary Advance</strong> expense and will be automatically adjusted against this employee's next generated payroll.
                </p>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Delete Payroll Confirmation */}
      <Modal
        isOpen={isDeleteConfirmOpen && !!salaryToDelete}
        onClose={() => { setIsDeleteConfirmOpen(false); setSalaryToDelete(null); }}
        title="Delete Payroll Record?"
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => { setIsDeleteConfirmOpen(false); setSalaryToDelete(null); }}>
              Cancel
            </Button>
            <Button variant="danger" onClick={deletePendingSalary} loading={loading} icon={Trash2}>
              Delete Permanently
            </Button>
          </div>
        }
      >
        {salaryToDelete && (
          <div className="space-y-3">
            <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-bold text-rose-900">This cannot be undone</p>
                <p className="text-[11px] text-rose-700 mt-1">
                  The payroll record for <strong>{salaryToDelete.employeeName}</strong> for <strong>{fmtMonth(salaryToDelete.month)}</strong> will be permanently removed. Any advance adjustments tied to this payroll will be reversed back to outstanding.
                </p>
              </div>
            </div>
            <div className="text-xs text-slate-500 leading-relaxed">
              <p><strong>Net Salary:</strong> Rs. {(salaryToDelete.netAmount || 0).toLocaleString('en-IN')}</p>
              <p><strong>Status:</strong> {salaryToDelete.status.replace('_', ' ').toUpperCase()}</p>
              {(salaryToDelete.deductions as any)?.advanceAdjusted > 0 && (
                <p><strong>Advance Adjusted:</strong> Rs. {((salaryToDelete.deductions as any).advanceAdjusted || 0).toLocaleString('en-IN')}</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
