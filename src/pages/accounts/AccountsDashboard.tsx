import {
  Download,
  Receipt,
  Sparkles,
  IndianRupee,
} from 'lucide-react';
import { UserProfile, Expense, FeePayment, Fee, Student, FeeRequest, Class } from '../../types';
import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { createPdf, addFooter, drawInfoBox, TABLE_STYLES } from '../../lib/pdfTemplate';
import { savePdf } from '../../lib/download';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useNavigate } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { Spinner } from '../../components/ui';
import AIInsightsPanel from '../../components/AIInsightsPanel';

interface AccountsDashboardProps {
  user: UserProfile;
}

export default function AccountsDashboard({ user }: AccountsDashboardProps) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [fees, setFees] = useState<Fee[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [feeRequests, setFeeRequests] = useState<FeeRequest[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onErr = (err: any) => handleFirestoreError(err, OperationType.LIST, 'accounts_dashboard');
    const unsubs = [
      onSnapshot(collection(db, 'expenses'), (s) => setExpenses(s.docs.map(d => ({ id: d.id, ...d.data() } as Expense))), onErr),
      onSnapshot(query(collection(db, 'feePayments'), orderBy('date', 'desc'), limit(15)), (s) => setPayments(s.docs.map(d => ({ id: d.id, ...d.data() } as FeePayment))), onErr),
      onSnapshot(collection(db, 'feeRequests'), (s) => setFeeRequests(s.docs.map(d => ({ id: d.id, ...d.data() } as FeeRequest))), onErr),
      onSnapshot(collection(db, 'students'), (s) => { setStudents(s.docs.map(d => ({ id: d.id, ...d.data() } as Student))); setLoading(false); }, onErr),
      onSnapshot(collection(db, 'classes'), (s) => setClasses(s.docs.map(d => ({ id: d.id, ...d.data() } as Class))), onErr),
    ];
    return () => unsubs.forEach(u => u());
  }, []);

  const filteredStudents = students.filter(s =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.schoolNumber.includes(searchTerm)
  );

  const totalCollection = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

  const totalPending = feeRequests
    .filter(r => r.status !== 'paid')
    .reduce((sum, r) => sum + (r.totalAmount - (r.paidAmount || 0)), 0);

  const monthlyExpenses = expenses
    .filter(e => e.date.startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((sum, e) => sum + (e.amount || 0), 0);

  const netProfit = totalCollection - expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

  const getStudentFeeStatus = (studentId: string): 'paid' | 'overdue' | 'pending' | null => {
    const requests = feeRequests.filter(r => r.studentId === studentId);
    if (requests.length === 0) return null;
    const unpaid = requests.filter(r => r.status !== 'paid');
    if (unpaid.length === 0) return 'paid';
    const today = new Date().toISOString().split('T')[0];
    const hasOverdue = unpaid.some(r => r.dueDate && r.dueDate < today);
    return hasOverdue ? 'overdue' : 'pending';
  };

  const exportReport = async () => {
    const today = new Date().toLocaleDateString('en-IN');
    const { doc, contentY, pageWidth } = await createPdf(
      'Financial Overview Report',
      `Generated on ${today}`,
    );

    let y = contentY + 4;

    y = drawInfoBox(
      doc,
      [
        { label: 'Total Collection', value: `₹${totalCollection.toLocaleString('en-IN')}` },
        { label: 'Pending Fees', value: `₹${totalPending.toLocaleString('en-IN')}` },
        { label: 'Monthly Expenses', value: `₹${monthlyExpenses.toLocaleString('en-IN')}` },
        { label: 'Net Profit', value: `₹${netProfit.toLocaleString('en-IN')}` },
        { label: 'Total Students', value: students.length.toString() },
        { label: 'Total Payments', value: payments.length.toString() },
      ],
      y,
      pageWidth,
      2,
    );

    y += 6;

    // Recent payments table
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(5, 150, 105);
    doc.text('RECENT FEE PAYMENTS', 12, y);
    y += 3;

    const paymentRows = payments.slice(0, 20).map((p) => {
      const student = students.find((s) => s.id === p.studentId);
      return [
        p.receiptNumber || '-',
        p.date,
        student?.name || p.studentId,
        `₹${(p.amount || 0).toLocaleString('en-IN')}`,
        (p.method || '').replace('_', ' ').toUpperCase(),
      ];
    });

    (doc as any).autoTable({
      startY: y,
      head: [['Receipt No', 'Date', 'Student', 'Amount', 'Method']],
      body: paymentRows,
      ...TABLE_STYLES,
      styles: { fontSize: 8, cellPadding: 3 },
      margin: { left: 12, right: 12 },
    });

    addFooter(doc);
    await savePdf(doc, `financial_overview_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // Prepare chart data (last 7 days)
  const last7Days = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dateStr = d.toISOString().split('T')[0];
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });

    const dayCollection = payments
      .filter(p => p.date === dateStr)
      .reduce((sum, p) => sum + p.amount, 0);

    const dayExpense = expenses
      .filter(e => e.date === dateStr)
      .reduce((sum, e) => sum + e.amount, 0);

    return { name: dayName, collection: dayCollection, expense: dayExpense };
  });

  if (loading) {
    return <Spinner />;
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const todayCollection = payments
    .filter(p => p.date === todayStr)
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  const todayCount = payments.filter(p => p.date === todayStr).length;

  const pendingRequests = feeRequests.filter(r => r.status !== 'paid');
  const today = new Date().toISOString().split('T')[0];
  const overdueRequests = pendingRequests.filter(r => r.dueDate && r.dueDate < today);

  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      {/* ── topbar ── */}
      <div className="topbar pad">
        <div>
          <div className="eyebrow">{todayLabel}</div>
          <h1>Accounts.</h1>
        </div>
        <div>
          <button className="btn ghost" onClick={exportReport}>
            <Download size={15} />
            Export Report
          </button>
        </div>
      </div>

      <div className="pad stack">
        {/* ── 4 stat cards — 2×2 on mobile, 4 cols on desktop ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}
          className="lg:grid-cols-4-override">
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span className="eyebrow">Total Collected</span>
            <span className="t-num" style={{ color: 'var(--leaf)' }}>
              ₹{(totalCollection || 0).toLocaleString('en-IN')}
            </span>
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span className="eyebrow">Pending</span>
            <span className="t-num" style={{ color: 'var(--coral)' }}>
              ₹{(totalPending || 0).toLocaleString('en-IN')}
            </span>
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span className="eyebrow">Expenses</span>
            <span className="t-num" style={{ color: 'var(--ink)' }}>
              ₹{(monthlyExpenses || 0).toLocaleString('en-IN')}
            </span>
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <span className="eyebrow">Net Balance</span>
            <span className="t-num" style={{ color: 'var(--accent)' }}>
              ₹{(netProfit || 0).toLocaleString('en-IN')}
            </span>
          </div>
        </div>

        {/* ── Pending payments ── */}
        {pendingRequests.length > 0 && (
          <div>
            <div className="section-head"><h2>Pending Payments</h2></div>
            <div className="stack">
              {pendingRequests.slice(0, 8).map(req => {
                const student = students.find(s => s.id === req.studentId);
                const balance = (req.totalAmount || 0) - (req.paidAmount || 0);
                const isOverdue = req.dueDate && req.dueDate < today;
                return (
                  <div key={req.id} className="card row" style={{ alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{student?.name || req.studentId}</div>
                      <div className="mono tiny muted">
                        {req.month} · Due {req.dueDate}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontWeight: 700, color: 'var(--coral)' }}>
                        ₹{balance.toLocaleString('en-IN')}
                      </span>
                      {isOverdue && (
                        <span className="chip solid" style={{ background: 'var(--coral)', color: '#fff', fontSize: '0.7rem' }}>
                          Overdue
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Recent payments ── */}
        {payments.length > 0 && (
          <div>
            <div className="section-head"><h2>Recent Payments</h2></div>
            <div className="stack">
              {payments.slice(0, 5).map(tx => {
                const student = students.find(s => s.id === tx.studentId);
                return (
                  <div key={tx.id} className="card row" style={{ alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{student?.name || tx.studentId}</div>
                      <div className="mono tiny muted">{tx.date} · {(tx.method || '').replace('_', ' ')}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 700, color: 'var(--leaf)' }}>
                        ₹{(tx.amount || 0).toLocaleString('en-IN')}
                      </span>
                      <button
                        className="icon-btn"
                        aria-label="Receipt"
                        title={`Receipt ${tx.receiptNumber || ''}`}
                      >
                        <Receipt size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Charts — desktop only ── */}
        <div className="hidden lg:block">
          <div className="section-head"><h2>Cash Flow — Last 7 Days</h2></div>
          <div className="card" style={{ padding: '1.5rem' }}>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={last7Days}>
                  <defs>
                    <linearGradient id="colorColl" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--leaf)" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="var(--leaf)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorExp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--coral)" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="var(--coral)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--ink)' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--ink)' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--paper)', borderRadius: '10px', border: '1px solid var(--line)' }}
                    itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                  />
                  <Area type="monotone" dataKey="collection" stroke="var(--leaf)" strokeWidth={2.5} fillOpacity={1} fill="url(#colorColl)" name="Collection" />
                  <Area type="monotone" dataKey="expense" stroke="var(--coral)" strokeWidth={2.5} fillOpacity={1} fill="url(#colorExp)" name="Expense" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* ── Floating AI button ── */}
      <button
        onClick={() => setAiOpen(true)}
        style={{
          position: 'fixed',
          bottom: '1.5rem',
          right: '1.5rem',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: 'var(--ink)',
          color: '#c8f135',
          border: 'none',
          borderRadius: '9999px',
          padding: '0.75rem 1.1rem',
          fontWeight: 700,
          fontSize: '0.8rem',
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
        }}
        aria-label="Open AI insights"
      >
        <Sparkles size={18} />
        <span className="hidden lg:inline">Ask AI</span>
      </button>

      <AIInsightsPanel open={aiOpen} onClose={() => setAiOpen(false)} period="This Month" />
    </>
  );
}
