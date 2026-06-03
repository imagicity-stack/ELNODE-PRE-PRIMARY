import React, { useState, useEffect, useMemo } from 'react';
import { UserProfile, FeePayment, FeeRequest, Student, Class, PaymentMethod } from '../../types';
import {
  Download,
  Search,
  Filter,
  History,
  FileText,
  User,
  CreditCard,
  RefreshCcw,
  ExternalLink,
  Receipt,
  ChevronDown,
  ChevronUp,
  Tag,
  MessageSquare,
  BadgePercent,
  IndianRupee,
  Banknote,
} from 'lucide-react';
import { collection, query, orderBy, onSnapshot, where, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useData } from '../../contexts/DataContext';
import { useToast } from '../../components/Toast';
import { generateFeeReceipt } from '../../lib/receiptGenerator';
import { fmtDate } from '../../lib/utils';
import { saveText, openExternalUrl } from '../../lib/download';
import Papa from 'papaparse';
import {
  Card,
  Badge,
  Button,
  IconButton,
  SearchInput,
  FormField,
  Input,
  Select,
  Table,
  Thead,
  Th,
  Tbody,
  Tr,
  Td,
  EmptyState,
  Spinner,
} from '../../components/ui';

const METHOD_COLORS: Record<string, string> = {
  cash: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  upi: 'bg-violet-50 text-violet-700 border-violet-200',
  bank_transfer: 'bg-blue-50 text-blue-700 border-blue-200',
  cheque: 'bg-amber-50 text-amber-700 border-amber-200',
  net_banking: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  online: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

export default function PaymentHistory({ user }: { user: UserProfile }) {
  const { classes, students: globalStudents } = useData();
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [feeRequests, setFeeRequests] = useState<FeeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { showToast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClass, setSelectedClass] = useState('all');
  const [selectedMethod, setSelectedMethod] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, 'feePayments'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setPayments(snap.docs.map(d => ({ id: d.id, ...d.data() } as FeePayment)));
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'feePayments');
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Load fee requests once for discount info
  useEffect(() => {
    getDocs(collection(db, 'feeRequests')).then(snap => {
      setFeeRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as FeeRequest)));
    }).catch(() => {});
  }, []);

  const filteredPayments = useMemo(() => {
    return payments.filter(p => {
      const student = globalStudents.find(s => s.id === p.studentId);
      const q = searchTerm.toLowerCase();
      const matchSearch = !searchTerm || [
        student?.name, p.receiptNumber, p.transactionId, p.referenceNumber, p.voucherNumber, p.remarks,
      ].some(v => v?.toLowerCase().includes(q));
      const matchClass = selectedClass === 'all' || student?.classId === selectedClass;
      const matchMethod = selectedMethod === 'all' || p.method === selectedMethod;
      const d = new Date(p.date);
      const matchStart = !startDate || d >= new Date(startDate);
      const matchEnd = !endDate || d <= new Date(endDate + 'T23:59:59');
      return matchSearch && matchClass && matchMethod && matchStart && matchEnd;
    });
  }, [payments, searchTerm, selectedClass, selectedMethod, startDate, endDate, globalStudents]);

  const todayStr = new Date().toISOString().split('T')[0];
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const todayTotal = payments.filter(p => p.date?.startsWith(todayStr)).reduce((s, p) => s + (p.amount || 0), 0);
  const monthTotal = payments.filter(p => p.date?.startsWith(monthPrefix)).reduce((s, p) => s + (p.amount || 0), 0);
  const totalDiscount = feeRequests.reduce((s, r) => s + r.heads.reduce((hs, h) => hs + (h.discount || 0), 0), 0);

  const dateFilters = [
    { label: 'All', val: '' },
    { label: 'Today', val: todayStr },
    { label: '7 Days', val: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0] },
    { label: '30 Days', val: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0] },
  ];

  const handleExport = async () => {
    if (!filteredPayments.length) { showToast('No data to export', 'error'); return; }
    const rows = filteredPayments.map(p => {
      const student = globalStudents.find(s => s.id === p.studentId);
      const req = feeRequests.find(r => r.id === p.feeRequestId);
      const headDiscount = req?.heads.reduce((s, h) => s + (h.discount || 0), 0) || 0;
      const discountReasons = req?.heads.filter(h => h.discount > 0 && h.discountReason).map(h => `${h.name}: ${h.discountReason}`).join(' | ') || '-';
      return {
        'Receipt No': p.receiptNumber,
        'Date': p.date,
        'Student': student?.name || 'Unknown',
        'School No': student?.schoolNumber || '-',
        'Class': student ? (classes.find(c => c.id === student.classId)?.name || '-') : '-',
        'Amount Paid': p.amount,
        'Gross Invoice': req?.heads.reduce((s, h) => s + (h.amount || 0), 0) || '-',
        'Total Discount': headDiscount || '-',
        'Fine Waived': req?.waivedAmount || '-',
        'Discount Reasons': discountReasons,
        'Method': p.method.replace(/_/g, ' ').toUpperCase(),
        'Ref / Transaction ID': p.transactionId || p.referenceNumber || '-',
        'Voucher No': p.voucherNumber || '-',
        'Remarks': p.remarks || '-',
      };
    });
    const csv = Papa.unparse(rows);
    await saveText(csv, `payment_history_${todayStr}.csv`);
    showToast('Exported successfully', 'success');
  };

  const handleDownloadReceipt = async (p: FeePayment) => {
    const student = globalStudents.find(s => s.id === p.studentId);
    const req = feeRequests.find(r => r.id === p.feeRequestId);
    if (!student || !req) { showToast('Fee request data not available for this receipt', 'error'); return; }
    try {
      await generateFeeReceipt(p, req, student);
    } catch { showToast('Failed to generate receipt', 'error'); }
  };

  // Shared expanded-detail markup, used by both the desktop table and mobile cards.
  const renderDetail = (p: FeePayment, req: any, grossTotal: number | null, discountTotal: number) => (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Head Breakdown */}
      {req?.heads && req.heads.length > 0 && (
        <div className="md:col-span-2">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Fee Head Breakdown</p>
          <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-bold text-slate-600">Head</th>
                  <th className="px-3 py-2 text-right font-bold text-slate-600">Gross</th>
                  <th className="px-3 py-2 text-right font-bold text-slate-600">Discount</th>
                  <th className="px-3 py-2 text-right font-bold text-slate-600">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {req.heads.map((h: any, i: number) => (
                  <tr key={i} className={h.discount > 0 ? 'bg-emerald-50/50' : ''}>
                    <td className="px-3 py-2">
                      <p className="font-semibold text-slate-800">{h.name}</p>
                      {h.discount > 0 && h.discountReason && (
                        <p className="text-[9px] text-emerald-600 mt-0.5 italic">Reason: {h.discountReason}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">₹{(h.amount || 0).toLocaleString('en-IN')}</td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-600">
                      {h.discount > 0 ? `-₹${h.discount.toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-slate-900">₹{(h.finalAmount ?? h.amount ?? 0).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                {discountTotal > 0 && (
                  <>
                    <tr>
                      <td className="px-3 py-1.5 font-semibold text-slate-600" colSpan={2}>Gross Total</td>
                      <td></td>
                      <td className="px-3 py-1.5 text-right font-semibold text-slate-700">₹{(grossTotal ?? 0).toLocaleString('en-IN')}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-1.5 font-bold text-emerald-700" colSpan={2}>Total Discount</td>
                      <td className="px-3 py-1.5 text-right font-bold text-emerald-600">-₹{discountTotal.toLocaleString('en-IN')}</td>
                      <td></td>
                    </tr>
                  </>
                )}
                {(req.waivedAmount || 0) > 0 && (
                  <tr>
                    <td className="px-3 py-1.5 text-slate-500" colSpan={2}>Fine Waiver</td>
                    <td className="px-3 py-1.5 text-right text-slate-500">-₹{req.waivedAmount!.toLocaleString('en-IN')}</td>
                    <td></td>
                  </tr>
                )}
                <tr className="bg-slate-900">
                  <td className="px-3 py-2 font-black text-white" colSpan={3}>Amount Paid (This Receipt)</td>
                  <td className="px-3 py-2 text-right font-black text-white">₹{p.amount.toLocaleString('en-IN')}</td>
                </tr>
                {(req.paidAmount || 0) < (req.totalAmount || 0) - (req.waivedAmount || 0) - 0.01 && (
                  <tr>
                    <td className="px-3 py-1.5 font-bold text-rose-600" colSpan={3}>Balance Due</td>
                    <td className="px-3 py-1.5 text-right font-black text-rose-600">
                      ₹{Math.max(0, (req.totalAmount || 0) - (req.waivedAmount || 0) - (req.paidAmount || 0)).toLocaleString('en-IN')}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Payment Meta */}
      <div className="space-y-3">
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Payment Details</p>
        <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2.5">
          {[
            { label: 'Method', value: p.method.replace(/_/g, ' ').toUpperCase() },
            p.transactionId && { label: 'Transaction ID', value: p.transactionId },
            p.referenceNumber && { label: 'Reference No.', value: p.referenceNumber },
            p.voucherNumber && { label: 'Cash Voucher No.', value: p.voucherNumber },
          ].filter(Boolean).map((row: any) => (
            <div key={row.label} className="flex items-start justify-between gap-2">
              <span className="text-[10px] text-slate-500 font-semibold shrink-0">{row.label}</span>
              <span className="text-xs font-bold text-slate-800 text-right break-all">{row.value}</span>
            </div>
          ))}

          {p.voucherImageUrl && (
            <div>
              <p className="text-[10px] text-slate-500 font-semibold mb-1">Cash Voucher</p>
              <button onClick={() => openExternalUrl(p.voucherImageUrl!)}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium">
                <ExternalLink className="w-3 h-3" /> View Voucher
              </button>
            </div>
          )}

          {p.remarks && (
            <div className="pt-2 border-t border-slate-100">
              <p className="text-[10px] text-slate-500 font-semibold mb-1 flex items-center gap-1">
                <MessageSquare className="w-3 h-3" /> Remarks
              </p>
              <p className="text-xs text-slate-700 italic">"{p.remarks}"</p>
            </div>
          )}

          {req?.waiverReason && (
            <div className="pt-2 border-t border-slate-100">
              <p className="text-[10px] text-violet-600 font-semibold mb-1 flex items-center gap-1">
                <BadgePercent className="w-3 h-3" /> Fine Waiver Reason
              </p>
              <p className="text-xs text-slate-700 italic">"{req.waiverReason}"</p>
            </div>
          )}
        </div>

        <button
          onClick={() => handleDownloadReceipt(p)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Download Receipt PDF
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Topbar */}
      <div className="topbar">
        <div>
          <div className="eyebrow">Accounts</div>
          <h1>Payment History</h1>
        </div>
        <div>
          <Button variant="primary" icon={Download} onClick={handleExport} disabled={!filteredPayments.length}>
            Export CSV
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Today's Collection", value: `₹${todayTotal.toLocaleString('en-IN')}`, sub: `${payments.filter(p => p.date?.startsWith(todayStr)).length} txns` },
          { label: 'This Month', value: `₹${monthTotal.toLocaleString('en-IN')}`, sub: `${payments.filter(p => p.date?.startsWith(monthPrefix)).length} txns` },
          { label: 'Total Payments', value: payments.length.toLocaleString('en-IN'), sub: 'all time' },
          { label: 'Discounts Given', value: `₹${totalDiscount.toLocaleString('en-IN')}`, sub: 'across all requests' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '1rem 1.25rem' }}>
            <div className="eyebrow">{s.label}</div>
            <div className="t-num" style={{ fontSize: '1.25rem', fontWeight: 800, marginTop: '0.25rem' }}>{s.value}</div>
            <div className="tiny muted" style={{ marginTop: '0.15rem' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[260px]">
              <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search student, receipt, txn ID, voucher..." />
            </div>
            <div className="flex gap-2 flex-wrap">
              {dateFilters.map(f => (
                <button
                  key={f.label}
                  onClick={() => setStartDate(f.val)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${startDate === f.val ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="w-40">
              <Select value={selectedMethod} onChange={(e) => setSelectedMethod(e.target.value)}>
                <option value="all">All Methods</option>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
                <option value="net_banking">Net Banking</option>
                <option value="online">Online (Razorpay)</option>
              </Select>
            </div>
            <Button variant={isFilterOpen ? 'primary' : 'secondary'} icon={Filter} onClick={() => setIsFilterOpen(v => !v)}>
              {isFilterOpen ? 'Hide' : 'More'}
            </Button>
          </div>
          {isFilterOpen && (
            <div className="grid grid-cols-3 gap-4 pt-3 border-t border-slate-100">
              <FormField label="Class">
                <Select value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}>
                  <option value="all">All Classes</option>
                  {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </FormField>
              <FormField label="From Date">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </FormField>
              <FormField label="To Date">
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </FormField>
            </div>
          )}
        </div>
      </Card>

      {/* Results Table */}
      <Card padding="none">
        {loading ? (
          <div className="p-20 flex flex-col items-center gap-4">
            <Spinner size="lg" />
            <p className="text-slate-500 font-medium">Loading payment records...</p>
          </div>
        ) : filteredPayments.length === 0 ? (
          <EmptyState icon={FileText} title="No payments found" description="Adjust filters to see more." />
        ) : (
          <>
          {/* Desktop table */}
          <div className="overflow-x-auto hidden md:block">
            <Table>
              <Thead>
                <tr>
                  <Th>Receipt</Th>
                  <Th>Student</Th>
                  <Th>Date</Th>
                  <Th>Invoiced</Th>
                  <Th>Discount</Th>
                  <Th>Paid</Th>
                  <Th>Method</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </Thead>
              <Tbody>
                {filteredPayments.map((p) => {
                  const student = globalStudents.find(s => s.id === p.studentId);
                  const req = feeRequests.find(r => r.id === p.feeRequestId);
                  const className = student ? (classes.find(c => c.id === student.classId)?.name || student.classId) : 'N/A';
                  const grossTotal = req?.heads.reduce((s, h) => s + (h.amount || 0), 0) ?? null;
                  const discountTotal = req?.heads.reduce((s, h) => s + (h.discount || 0), 0) ?? 0;
                  const discountedHeads = req?.heads.filter(h => (h.discount || 0) > 0) ?? [];
                  const isExpanded = expandedId === p.id;
                  const methodColor = METHOD_COLORS[p.method] || 'bg-slate-50 text-slate-600 border-slate-200';

                  return (
                    <React.Fragment key={p.id}>
                      <Tr
                        className={`cursor-pointer transition-colors ${isExpanded ? 'bg-amber-50/60' : 'hover:bg-slate-50/80'}`}
                        onClick={() => setExpandedId(isExpanded ? null : p.id)}
                      >
                        {/* Receipt */}
                        <Td>
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                              <Receipt className="w-3.5 h-3.5 text-amber-600" />
                            </div>
                            <div>
                              <p className="font-bold text-slate-900 text-xs">{p.receiptNumber}</p>
                              {p.voucherNumber && <p className="text-[9px] text-slate-400 font-mono">CV: {p.voucherNumber}</p>}
                            </div>
                          </div>
                        </Td>
                        {/* Student */}
                        <Td>
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                              {student?.photoURL ? <img src={student.photoURL} className="w-full h-full object-cover" /> : <User className="w-3.5 h-3.5 text-slate-400" />}
                            </div>
                            <div>
                              <p className="font-bold text-slate-900 text-xs leading-tight">{student?.name || 'Unknown'}</p>
                              <p className="text-[9px] text-slate-500 uppercase tracking-wider">{className} · {student?.schoolNumber}</p>
                            </div>
                          </div>
                        </Td>
                        {/* Date */}
                        <Td className="text-xs text-slate-600">
                          {fmtDate(p.date)}
                        </Td>
                        {/* Gross Invoiced */}
                        <Td>
                          {grossTotal != null
                            ? <span className="text-xs font-semibold text-slate-700">₹{grossTotal.toLocaleString('en-IN')}</span>
                            : <span className="text-xs text-slate-400">—</span>}
                        </Td>
                        {/* Discount */}
                        <Td>
                          {discountTotal > 0
                            ? <span className="text-xs font-bold text-emerald-600">-₹{discountTotal.toLocaleString('en-IN')}</span>
                            : <span className="text-xs text-slate-300">—</span>}
                        </Td>
                        {/* Amount Paid */}
                        <Td>
                          <span className="text-sm font-black text-slate-900">₹{(p.amount || 0).toLocaleString('en-IN')}</span>
                          {req && (req.paidAmount || 0) < (req.totalAmount || 0) - (req.waivedAmount || 0) - 0.01 && (
                            <p className="text-[9px] text-rose-500 font-bold mt-0.5">Partial</p>
                          )}
                        </Td>
                        {/* Method */}
                        <Td>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${methodColor}`}>
                            {p.method === 'online' ? <ExternalLink className="w-2.5 h-2.5" /> : <CreditCard className="w-2.5 h-2.5" />}
                            {p.method.replace(/_/g, ' ').toUpperCase()}
                          </span>
                        </Td>
                        {/* Actions */}
                        <Td className="text-right">
                          <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                            <IconButton icon={Download} size="sm" variant="ghost" title="Download Receipt" onClick={() => handleDownloadReceipt(p)} />
                            <button className="p-1 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </div>
                        </Td>
                      </Tr>

                      {/* ── Expanded Detail Row ── */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={8} className="bg-amber-50/40 border-t border-amber-100 px-6 py-4">
                            {renderDetail(p, req, grossTotal, discountTotal)}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </Tbody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {filteredPayments.map((p) => {
              const student = globalStudents.find(s => s.id === p.studentId);
              const req = feeRequests.find(r => r.id === p.feeRequestId);
              const className = student ? (classes.find(c => c.id === student.classId)?.name || student.classId) : 'N/A';
              const grossTotal = req?.heads.reduce((s, h) => s + (h.amount || 0), 0) ?? null;
              const discountTotal = req?.heads.reduce((s, h) => s + (h.discount || 0), 0) ?? 0;
              const isExpanded = expandedId === p.id;
              const methodColor = METHOD_COLORS[p.method] || 'bg-slate-50 text-slate-600 border-slate-200';
              const isPartial = req && (req.paidAmount || 0) < (req.totalAmount || 0) - (req.waivedAmount || 0) - 0.01;

              return (
                <div key={p.id} className={isExpanded ? 'bg-amber-50/50' : ''}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : p.id)}
                    className="w-full text-left px-4 py-3.5 active:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      {/* Student + receipt */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                          {student?.photoURL ? <img src={student.photoURL} className="w-full h-full object-cover" /> : <User className="w-4 h-4 text-slate-400" />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 text-sm leading-tight truncate">{student?.name || 'Unknown'}</p>
                          <p className="text-[10px] text-slate-500 uppercase tracking-wider truncate">{className} · {student?.schoolNumber}</p>
                          <p className="text-[10px] text-amber-600 font-bold mt-0.5">{p.receiptNumber}</p>
                        </div>
                      </div>
                      {/* Amount + chevron */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="text-right">
                          <p className="text-base font-black text-slate-900">₹{(p.amount || 0).toLocaleString('en-IN')}</p>
                          {isPartial && <p className="text-[9px] text-rose-500 font-bold">Partial</p>}
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      </div>
                    </div>
                    {/* Meta row */}
                    <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${methodColor}`}>
                        {p.method === 'online' ? <ExternalLink className="w-2.5 h-2.5" /> : <CreditCard className="w-2.5 h-2.5" />}
                        {p.method.replace(/_/g, ' ').toUpperCase()}
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium">{fmtDate(p.date)}</span>
                      {discountTotal > 0 && (
                        <span className="text-[10px] font-bold text-emerald-600">-₹{discountTotal.toLocaleString('en-IN')} disc.</span>
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1">
                      {renderDetail(p, req, grossTotal, discountTotal)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </>
        )}
      </Card>
    </div>
  );
}
