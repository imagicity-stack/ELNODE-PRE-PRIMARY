import { UserProfile, Expense, FeePayment, Salary } from '../../types';
import { Download, FileText, PieChart, TrendingUp, Loader2, Sparkles } from 'lucide-react';
import AIInsightsPanel from '../../components/AIInsightsPanel';
import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { createPdf, addFooter, TABLE_STYLES } from '../../lib/pdfTemplate';
import { savePdf } from '../../lib/download';
import { useToast } from '../../components/Toast';
import { fmtMonthYear } from '../../lib/utils';
import { cn } from '../../lib/utils';

interface FinancialReportsProps {
  user: UserProfile;
}

type ReportType = 'fee_collection' | 'expense_statement' | 'payroll_summary' | 'profit_loss';

function getMonthRange(range: string): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (range === 'This Month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: fmt(from), to: fmt(to) };
  }
  if (range === 'Last Month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: fmt(from), to: fmt(to) };
  }
  if (range === 'This Quarter') {
    const q = Math.floor(now.getMonth() / 3);
    const from = new Date(now.getFullYear(), q * 3, 1);
    const to = new Date(now.getFullYear(), q * 3 + 3, 0);
    return { from: fmt(from), to: fmt(to) };
  }
  return {
    from: `${now.getFullYear()}-01-01`,
    to: `${now.getFullYear()}-12-31`,
  };
}

const RANGES = ['This Month', 'Last Month', 'This Quarter', 'This Year'];

const REPORT_TYPES = [
  { value: 'fee_collection' as ReportType, label: 'Fee Collection' },
  { value: 'expense_statement' as ReportType, label: 'Expenses' },
  { value: 'payroll_summary' as ReportType, label: 'Salary' },
  { value: 'profit_loss' as ReportType, label: 'P&L' },
];

export default function FinancialReports({ user }: FinancialReportsProps) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [salaries, setSalaries] = useState<Salary[]>([]);
  const [dateRange, setDateRange] = useState('This Month');
  const [generating, setGenerating] = useState<ReportType | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    const fetch = async () => {
      try {
        const [expSnap, paySnap, salSnap] = await Promise.all([
          getDocs(query(collection(db, 'expenses'), orderBy('date', 'desc'))),
          getDocs(query(collection(db, 'feePayments'), orderBy('date', 'desc'))),
          getDocs(collection(db, 'salaries')),
        ]);
        setExpenses(expSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Expense)));
        setPayments(paySnap.docs.map((d) => ({ id: d.id, ...d.data() } as FeePayment)));
        setSalaries(salSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Salary)));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'financial_reports');
      }
    };
    fetch();
  }, []);

  const inRange = (date: string, range: { from: string; to: string }) =>
    date >= range.from && date <= range.to;

  const generateFeeCollectionReport = async () => {
    const range = getMonthRange(dateRange);
    const filtered = payments.filter((p) => inRange(p.date, range));
    const total = filtered.reduce((s, p) => s + (p.amount || 0), 0);

    const { doc, contentY } = await createPdf(
      'Fee Collection Report',
      `Period: ${range.from} to ${range.to}`,
    );

    const rows = filtered.map((p) => [
      p.receiptNumber || '-',
      p.date,
      p.studentId,
      p.feeHead || '-',
      (p.method || '').replace('_', ' ').toUpperCase(),
      `Rs. ${(p.amount || 0).toLocaleString('en-IN')}`,
    ]);

    (doc as any).autoTable({
      startY: contentY + 2,
      head: [['Receipt No', 'Date', 'Student ID', 'Fee Head', 'Method', 'Amount']],
      body: rows,
      foot: [[
        { content: `Total Collections: ${filtered.length} entries`, colSpan: 5, styles: { fontStyle: 'bold', halign: 'right' } },
        { content: `Rs. ${total.toLocaleString('en-IN')}`, styles: { fontStyle: 'bold', textColor: [5, 150, 105] } },
      ]],
      ...TABLE_STYLES,
      footStyles: { fillColor: [209, 250, 229], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 9 },
      margin: { left: 12, right: 12 },
    });

    addFooter(doc);
    await savePdf(doc, `fee_collection_${range.from}_${range.to}.pdf`);
  };

  const generateExpenseReport = async () => {
    const range = getMonthRange(dateRange);
    const filtered = expenses.filter((e) => inRange(e.date, range));
    const total = filtered.reduce((s, e) => s + (e.amount || 0), 0);

    const { doc, contentY } = await createPdf(
      'Expense Statement',
      `Period: ${range.from} to ${range.to}`,
    );

    const rows = filtered.map((e) => [
      e.date,
      e.category,
      e.biller,
      e.description || '-',
      e.status.toUpperCase(),
      `Rs. ${(e.amount || 0).toLocaleString('en-IN')}`,
    ]);

    (doc as any).autoTable({
      startY: contentY + 2,
      head: [['Date', 'Category', 'Biller', 'Description', 'Status', 'Amount']],
      body: rows,
      foot: [[
        { content: `Total Expenses: ${filtered.length} entries`, colSpan: 5, styles: { fontStyle: 'bold', halign: 'right' } },
        { content: `Rs. ${total.toLocaleString('en-IN')}`, styles: { fontStyle: 'bold', textColor: [220, 38, 38] } },
      ]],
      ...TABLE_STYLES,
      footStyles: { fillColor: [254, 226, 226], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 9 },
      margin: { left: 12, right: 12 },
    });

    addFooter(doc);
    await savePdf(doc, `expense_statement_${range.from}_${range.to}.pdf`);
  };

  const generatePayrollReport = async () => {
    const range = getMonthRange(dateRange);
    const monthPrefix = range.from.slice(0, 7);
    const filtered = salaries.filter((s) => s.month && s.month.startsWith(monthPrefix));
    const totalNet = filtered.reduce((s, e) => s + (e.netAmount || 0), 0);
    const totalBase = filtered.reduce((s, e) => s + (e.baseAmount || 0), 0);

    const { doc, contentY } = await createPdf(
      'Payroll Summary',
      `Period: ${range.from} to ${range.to}`,
    );

    const rows = filtered.map((s) => [
      s.employeeName,
      s.employeeRole,
      fmtMonthYear(s.month),
      `Rs. ${(s.baseAmount || 0).toLocaleString('en-IN')}`,
      `Rs. ${(s.allowances || 0).toLocaleString('en-IN')}`,
      `Rs. ${((s.deductions?.pf || 0) + (s.deductions?.tax || 0) + (s.deductions?.leaveDeduction || 0) + (s.deductions?.other || 0)).toLocaleString('en-IN')}`,
      `Rs. ${(s.netAmount || 0).toLocaleString('en-IN')}`,
      s.status.toUpperCase(),
    ]);

    (doc as any).autoTable({
      startY: contentY + 2,
      head: [['Employee', 'Role', 'Month', 'Base', 'Allowances', 'Deductions', 'Net Pay', 'Status']],
      body: rows,
      foot: [[
        { content: `${filtered.length} employees`, colSpan: 3, styles: { fontStyle: 'bold' } },
        { content: `Rs. ${totalBase.toLocaleString('en-IN')}`, styles: { fontStyle: 'bold' } },
        { content: '', colSpan: 2 },
        { content: `Rs. ${totalNet.toLocaleString('en-IN')}`, styles: { fontStyle: 'bold', textColor: [5, 150, 105] } },
        { content: '' },
      ]],
      ...TABLE_STYLES,
      styles: { fontSize: 8, cellPadding: 3 },
      footStyles: { fillColor: [209, 250, 229], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 9 },
      margin: { left: 12, right: 12 },
    });

    addFooter(doc);
    await savePdf(doc, `payroll_summary_${monthPrefix}.pdf`);
  };

  const generatePLReport = async () => {
    const range = getMonthRange(dateRange);
    const totalIncome = payments.filter((p) => inRange(p.date, range)).reduce((s, p) => s + (p.amount || 0), 0);
    const totalExpenses = expenses.filter((e) => inRange(e.date, range)).reduce((s, e) => s + (e.amount || 0), 0);
    const monthPrefix = range.from.slice(0, 7);
    const totalSalaries = salaries.filter((s) => s.month?.startsWith(monthPrefix)).reduce((s, e) => s + (e.netAmount || 0), 0);
    const totalCosts = totalExpenses + totalSalaries;
    const netProfit = totalIncome - totalCosts;

    const { doc, contentY } = await createPdf(
      'Profit & Loss Statement',
      `Period: ${range.from} to ${range.to}`,
    );

    const summaryRows = [
      ['Fee Collections (Income)', `Rs. ${totalIncome.toLocaleString('en-IN')}`, ''],
      ['Operating Expenses', `Rs. ${totalExpenses.toLocaleString('en-IN')}`, ''],
      ['Salary Disbursements', `Rs. ${totalSalaries.toLocaleString('en-IN')}`, ''],
      ['Total Costs', `Rs. ${totalCosts.toLocaleString('en-IN')}`, ''],
      ['Net Profit / (Loss)', `Rs. ${Math.abs(netProfit).toLocaleString('en-IN')}`, netProfit >= 0 ? 'PROFIT' : 'LOSS'],
    ];

    (doc as any).autoTable({
      startY: contentY + 2,
      head: [['Description', 'Amount', 'Status']],
      body: summaryRows,
      ...TABLE_STYLES,
      bodyStyles: { fontSize: 10 },
      columnStyles: {
        0: { cellWidth: 100 },
        1: { cellWidth: 55, halign: 'right' },
        2: { cellWidth: 30, halign: 'center', fontStyle: 'bold' },
      },
      didDrawCell: (data: any) => {
        if (data.section === 'body' && data.row.index === 4) {
          data.cell.styles.textColor = netProfit >= 0 ? [5, 150, 105] : [220, 38, 38];
          data.cell.styles.fontStyle = 'bold';
        }
      },
      margin: { left: 12, right: 12 },
    });

    addFooter(doc);
    await savePdf(doc, `profit_loss_${range.from}_${range.to}.pdf`);
  };

  const handleGenerate = async (type: ReportType) => {
    setGenerating(type);
    try {
      if (type === 'fee_collection') await generateFeeCollectionReport();
      else if (type === 'expense_statement') await generateExpenseReport();
      else if (type === 'payroll_summary') await generatePayrollReport();
      else if (type === 'profit_loss') await generatePLReport();
      showToast('Report downloaded successfully!', 'success');
    } catch {
      showToast('Failed to generate report. Please try again.', 'error');
    } finally {
      setGenerating(null);
    }
  };

  const range = getMonthRange(dateRange);
  const totalIncome = payments.filter((p) => inRange(p.date, range)).reduce((s, p) => s + (p.amount || 0), 0);
  const totalExpenseAmt = expenses.filter((e) => inRange(e.date, range)).reduce((s, e) => s + (e.amount || 0), 0);
  const monthPrefix = range.from.slice(0, 7);
  const totalSalariesAmt = salaries.filter((s) => s.month?.startsWith(monthPrefix)).reduce((s, e) => s + (e.netAmount || 0), 0);
  const netProfit = totalIncome - (totalExpenseAmt + totalSalariesAmt);

  const reports: { type: ReportType; title: string; desc: string; icon: any }[] = [
    {
      type: 'fee_collection',
      title: 'Fee Collection Report',
      desc: 'Detailed breakdown of all fee payments received by students.',
      icon: TrendingUp,
    },
    {
      type: 'expense_statement',
      title: 'Expense Statement',
      desc: 'Complete record of school expenditures and bills.',
      icon: FileText,
    },
    {
      type: 'payroll_summary',
      title: 'Payroll Summary',
      desc: 'Monthly salary disbursements and deductions for all staff.',
      icon: PieChart,
    },
    {
      type: 'profit_loss',
      title: 'Profit & Loss',
      desc: 'Overall financial health: income vs expenditure analysis.',
      icon: TrendingUp,
    },
  ];

  return (
    <>
      <div className="pad stack" style={{ gap: 'var(--space-5)' }}>
        {/* Topbar */}
        <div className="topbar">
          <div>
            <div className="eyebrow">{dateRange}</div>
            <h1>Reports</h1>
          </div>
          <div>
            <button
              className="btn ghost"
              onClick={() => handleGenerate('profit_loss')}
              disabled={!!generating}
            >
              {generating === 'profit_loss' ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <Download style={{ width: 14, height: 14 }} />}
              Export PDF
            </button>
          </div>
        </div>

        {/* Date range chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
              className={cn('chip', dateRange === r ? 'solid' : '')}
              style={{ cursor: 'pointer' }}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Summary stat cards 2x2 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {[
            { label: 'Total Collected', value: totalIncome, color: 'var(--leaf)', positive: true },
            { label: 'Total Expenses', value: totalExpenseAmt, color: 'var(--coral)', positive: false },
            { label: 'Salary Paid', value: totalSalariesAmt, color: 'var(--accent)', positive: false },
            { label: 'Net Balance', value: netProfit, color: netProfit >= 0 ? 'var(--leaf)' : 'var(--coral)', positive: netProfit >= 0 },
          ].map(stat => (
            <div key={stat.label} className="card">
              <p className="eyebrow" style={{ marginBottom: 4 }}>{stat.label}</p>
              <p className="t-num" style={{ fontSize: 22, fontWeight: 800, color: stat.color }}>
                ₹{Math.abs(stat.value).toLocaleString('en-IN')}
              </p>
              {stat.label === 'Net Balance' && (
                <p className="tiny muted" style={{ marginTop: 4 }}>{netProfit >= 0 ? 'Surplus' : 'Deficit'}</p>
              )}
            </div>
          ))}
        </div>

        {/* Report type chips + download */}
        <div className="section-head">Generate Reports</div>
        <div className="stack" style={{ gap: 'var(--space-3)' }}>
          {reports.map(report => {
            const Icon = report.icon;
            const isLoading = generating === report.type;
            return (
              <div key={report.type} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)', marginBottom: 2 }}>{report.title}</p>
                  <p className="tiny muted">{report.desc}</p>
                </div>
                <button
                  onClick={() => handleGenerate(report.type)}
                  disabled={!!generating}
                  className="btn ghost"
                  style={{ flexShrink: 0, fontSize: 12 }}
                >
                  {isLoading ? (
                    <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" />
                  ) : (
                    <Download style={{ width: 14, height: 14 }} />
                  )}
                  {isLoading ? 'Generating…' : 'Download'}
                </button>
              </div>
            );
          })}
        </div>

        {/* Desktop table — hidden on mobile */}
        <div className="hidden lg:block">
          <div className="section-head">Fee Payments — {dateRange}</div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--cream-2)' }}>
                  {['Receipt', 'Date', 'Method', 'Amount'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: 'var(--ink-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.filter(p => inRange(p.date, range)).slice(0, 20).map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '10px 14px' }} className="mono">{p.receiptNumber || '-'}</td>
                    <td style={{ padding: '10px 14px' }} className="mono">{p.date}</td>
                    <td style={{ padding: '10px 14px', textTransform: 'capitalize' }}>{(p.method || '').replace(/_/g, ' ')}</td>
                    <td style={{ padding: '10px 14px' }} className="t-num">₹{(p.amount || 0).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
                {payments.filter(p => inRange(p.date, range)).length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-3)' }}>No payments in this period</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Floating AI Insights button */}
      <button
        onClick={() => setAiOpen(true)}
        className="fixed bottom-5 right-5 md:bottom-8 md:right-8 z-30 group flex items-center gap-2 bg-gradient-to-br from-violet-600 to-fuchsia-700 text-white shadow-xl shadow-violet-500/30 rounded-full pl-3 pr-4 py-3 active:scale-95 transition-transform"
        aria-label="Open AI insights"
      >
        <Sparkles className="w-5 h-5" />
        <span className="text-xs font-bold hidden md:inline">Ask AI</span>
      </button>

      <AIInsightsPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        period={dateRange as any}
      />
    </>
  );
}
