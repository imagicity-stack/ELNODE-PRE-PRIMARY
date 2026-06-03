import { UserProfile, FeePayment, FeeRequest, Class, Student } from '../../types';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { RefreshCcw } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { useData } from '../../contexts/DataContext';

interface PaymentAnalyticsProps {
  user: UserProfile;
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export default function PaymentAnalytics({ user }: PaymentAnalyticsProps) {
  const [payments, setPayments] = useState<FeePayment[]>([]);
  const [requests, setRequests] = useState<FeeRequest[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const { classes } = useData();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [paymentsSnap, requestsSnap, studentsSnap] = await Promise.all([
        getDocs(collection(db, 'feePayments')),
        getDocs(collection(db, 'feeRequests')),
        getDocs(collection(db, 'students')),
      ]);

      const rawPayments = paymentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FeePayment));
      rawPayments.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      setPayments(rawPayments);
      setRequests(requestsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FeeRequest)));
      setStudents(studentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Stats Calculations
  const stats = useMemo(() => {
    const totalCollected = payments.reduce((acc, p) => acc + p.amount, 0);
    const totalExpected = requests.reduce((acc, r) => acc + r.totalAmount, 0);
    const totalWaived = requests.reduce((acc, r) => acc + (r.waivedAmount || 0), 0);
    const totalFine = requests.filter(r => r.status === 'paid').reduce((acc, r) => acc + (r.fineAmount || 0), 0);
    const pendingRequests = requests.filter(r => r.status !== 'paid');
    const pendingAmount = pendingRequests.reduce((acc, r) => acc + (r.totalAmount - (r.waivedAmount || 0) - (r.paidAmount || 0)), 0);
    const collectionRate = totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0;
    const partialCount = requests.filter(r => r.status === 'partially_paid').length;
    const partialRequestCount = requests.filter(r => r.partialPaymentRequest?.status === 'pending').length;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const currentMonthCollection = payments
      .filter(p => new Date(p.date) >= thirtyDaysAgo)
      .reduce((acc, p) => acc + p.amount, 0);

    return {
      totalCollected, totalExpected, totalWaived, totalFine,
      pendingAmount, collectionRate, currentMonthCollection,
      partialCount, partialRequestCount,
    };
  }, [payments, requests]);

  // Chart Data: Collection Trend
  const trendData = useMemo(() => {
    const months: Record<string, number> = {};
    payments.forEach(p => {
      const month = new Date(p.date).toLocaleString('default', { month: 'short', year: '2-digit' });
      months[month] = (months[month] || 0) + p.amount;
    });
    return Object.entries(months).map(([name, amount]) => ({ name, amount }));
  }, [payments]);

  // Chart Data: Payment Method
  const methodData = useMemo(() => {
    const methods: Record<string, number> = {};
    payments.forEach(p => {
      const method = p.method.replace('_', ' ').toUpperCase();
      methods[method] = (methods[method] || 0) + p.amount;
    });
    return Object.entries(methods).map(([name, value]) => ({ name, value }));
  }, [payments]);

  // Chart Data: Fee Head Distribution — uses allocations for accuracy, falls back to feeHead
  const headData = useMemo(() => {
    const heads: Record<string, number> = {};
    payments.forEach(p => {
      if (p.allocations && p.allocations.length > 0) {
        p.allocations.forEach((a: any) => {
          const name = a.headName || 'Other';
          heads[name] = (heads[name] || 0) + (a.amount || 0);
        });
      } else {
        const head = p.feeHead || 'Tuition Fees';
        heads[head] = (heads[head] || 0) + p.amount;
      }
    });
    // Add fine collected (snapshotted on paid requests)
    const fineCollected = requests
      .filter(r => r.status === 'paid' && (r.fineAmount || 0) > 0)
      .reduce((acc, r) => acc + (r.fineAmount || 0), 0);
    if (fineCollected > 0) heads['Late Fine (Penalty)'] = (heads['Late Fine (Penalty)'] || 0) + fineCollected;
    return Object.entries(heads)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [payments, requests]);

  // Per-head: expected vs collected vs outstanding table
  const headTable = useMemo(() => {
    const expected: Record<string, number> = {};
    const collected: Record<string, number> = {};
    requests.forEach(r => r.heads?.forEach(h => {
      expected[h.name] = (expected[h.name] || 0) + (h.finalAmount || h.amount || 0);
    }));
    payments.forEach(p => {
      if (p.allocations && p.allocations.length > 0) {
        p.allocations.forEach((a: any) => {
          collected[a.headName] = (collected[a.headName] || 0) + (a.amount || 0);
        });
      } else {
        const head = p.feeHead || 'Tuition Fees';
        collected[head] = (collected[head] || 0) + p.amount;
      }
    });
    const allHeads = Array.from(new Set([...Object.keys(expected), ...Object.keys(collected)]));
    return allHeads.map(name => ({
      name,
      expected: expected[name] || 0,
      collected: collected[name] || 0,
      outstanding: Math.max(0, (expected[name] || 0) - (collected[name] || 0)),
    })).sort((a, b) => b.expected - a.expected);
  }, [payments, requests]);

  // Chart Data: Class-wise
  const classData = useMemo(() => {
    const classMap: Record<string, { collected: number; pending: number }> = {};
    payments.forEach(p => {
      const className = classes.find(c => c.id === p.classId)?.name || 'Unknown';
      if (!classMap[className]) classMap[className] = { collected: 0, pending: 0 };
      classMap[className].collected += p.amount;
    });
    requests.forEach(r => {
      if (r.status !== 'paid') {
        const className = classes.find(c => c.id === r.classId)?.name || 'Unknown';
        if (!classMap[className]) classMap[className] = { collected: 0, pending: 0 };
        classMap[className].pending += r.totalAmount - (r.waivedAmount || 0) - (r.paidAmount || 0);
      }
    });
    return Object.entries(classMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.collected - a.collected)
      .slice(0, 10);
  }, [payments, requests, classes]);

  // Defaulters count: students with at least one unpaid/overdue request
  const defaulterCount = useMemo(() => {
    const ids = new Set<string>();
    requests.forEach(r => {
      if (r.status === 'pending' || r.status === 'overdue') ids.add(r.studentId);
    });
    return ids.size;
  }, [requests]);

  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="pad stack">
      {/* Topbar */}
      <div className="topbar">
        <div>
          <div className="eyebrow">As of {today}</div>
          <h1>Analytics</h1>
        </div>
        <div>
          <button
            className="icon-btn"
            onClick={fetchData}
            aria-label="Refresh"
            disabled={loading}
          >
            <RefreshCcw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Key metrics — 2×2 grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
        <div className="card stack" style={{ gap: '0.25rem' }}>
          <div className="eyebrow">Total Collected</div>
          <div className="t-num" style={{ color: 'var(--leaf)' }}>
            ₹{stats.totalCollected.toLocaleString('en-IN')}
          </div>
          <div className="tiny muted">All time receipts</div>
        </div>

        <div className="card stack" style={{ gap: '0.25rem' }}>
          <div className="eyebrow">Pending</div>
          <div className="t-num" style={{ color: 'var(--coral)' }}>
            ₹{stats.pendingAmount.toLocaleString('en-IN')}
          </div>
          <div className="tiny muted">Outstanding dues</div>
        </div>

        <div className="card stack" style={{ gap: '0.25rem' }}>
          <div className="eyebrow">Collection Rate</div>
          <div className="t-num" style={{ color: 'var(--accent)' }}>
            {stats.collectionRate.toFixed(1)}%
          </div>
          <div className="tiny muted">Of total expected</div>
        </div>

        <div className="card stack" style={{ gap: '0.25rem' }}>
          <div className="eyebrow">Defaulters</div>
          <div className="t-num" style={{ color: 'var(--coral)' }}>
            {defaulterCount}
          </div>
          <div className="tiny muted">Students with pending/overdue fees</div>
        </div>
      </div>

      {/* Class-wise breakdown */}
      <div className="card stack">
        <div className="eyebrow">Class-wise Breakdown</div>
        {classData.length === 0 ? (
          <p className="muted tiny">No data yet.</p>
        ) : (
          classData.map((row, i) => {
            const total = row.collected + row.pending;
            const pct = total > 0 ? Math.min(100, (row.collected / total) * 100) : 0;
            return (
              <div key={row.name} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--ink)' }}>{row.name}</span>
                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <span className="tiny" style={{ color: 'var(--leaf)' }}>
                      ₹{row.collected.toLocaleString('en-IN')}
                    </span>
                    {row.pending > 0 && (
                      <span className="tiny" style={{ color: 'var(--coral)' }}>
                        ₹{row.pending.toLocaleString('en-IN')} pending
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ height: '6px', background: 'var(--line)', borderRadius: '9999px', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: 'var(--leaf)',
                      borderRadius: '9999px',
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Monthly trend chart — desktop only */}
      <div className="hidden lg:block">
        <div className="card stack">
          <div className="eyebrow">Monthly Collection Trend</div>
          {trendData.length === 0 ? (
            <p className="muted tiny">No payment data to display.</p>
          ) : (
            <div style={{ height: 280, width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                  <XAxis
                    dataKey="name"
                    stroke="var(--ink)"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="var(--ink)"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '10px',
                      border: '1px solid var(--line)',
                      background: 'var(--cream)',
                      color: 'var(--ink)',
                    }}
                    formatter={(v: any) => [`₹${(v || 0).toLocaleString('en-IN')}`, 'Collected']}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="var(--accent)"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#colorAmount)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
