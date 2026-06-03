import {
  Users,
  GraduationCap,
  CreditCard,
  Megaphone,
  UserPlus,
  Building2,
  Clock,
  FileText,
  BookOpen,
  BarChart3,
  Sparkles,
  Download,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy, limit, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { Notice, UserProfile } from '../../types';
import { Link } from 'react-router-dom';
import AIInsightsPanel from '../../components/AIInsightsPanel';
import { createPdf, addFooter, drawInfoBox, TABLE_STYLES } from '../../lib/pdfTemplate';
import { savePdf } from '../../lib/download';

const GENDER_COLORS = ['#6366f1', '#ec4899'];

interface AdminDashboardProps {
  user: UserProfile;
}

export default function AdminDashboard({ user }: AdminDashboardProps) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [recentAdmissions, setRecentAdmissions] = useState<any[]>([]);
  const [counts, setCounts] = useState({ students: 0, teachers: 0, classes: 0, feeCollection: 0 });
  const [attendanceStats, setAttendanceStats] = useState<{ name: string; present: number; absent: number; rate: number }[]>([]);
  const [feeTrendData, setFeeTrendData] = useState<{ month: string; amount: number }[]>([]);
  const [genderStats, setGenderStats] = useState([{ name: 'Boys', value: 0 }, { name: 'Girls', value: 0 }]);
  const [classDistribution, setClassDistribution] = useState<{ name: string; students: number }[]>([]);
  const [feeOverview, setFeeOverview] = useState({ expected: 0, collected: 0, outstanding: 0, collectionRate: 0 });
  const [pendingLeaves, setPendingLeaves] = useState(0);
  const [attendanceRate, setAttendanceRate] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    const fetchDashboardData = async () => {
      const now = new Date();
      const today = now.toISOString().split('T')[0];

      // Mon–Fri of the current week (real working-day buckets)
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const weekDates = Array.from({ length: 5 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return { name: dayNames[d.getDay()], date: d.toISOString().split('T')[0] };
      });

      // Last 6 calendar months as YYYY-MM buckets
      const monthBuckets = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
        return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('default', { month: 'short' }) };
      });

      const safe = async <T,>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
        try { return await fn(); } catch (err) { console.warn(`Dashboard: ${label} failed`, err); return fallback; }
      };

      const [studentsSnap, teachersSnap, classesSnap, noticesSnap, recentSnap, feesSnap, leaveSnap, weekAttendanceSnap, feeReqSnap] = await Promise.all([
        safe('students', () => getDocs(collection(db, 'students')), { docs: [] as any[], size: 0 } as any),
        safe('teachers', () => getDocs(collection(db, 'teachers')), { docs: [] as any[], size: 0 } as any),
        safe('classes', () => getDocs(collection(db, 'classes')), { docs: [] as any[], size: 0 } as any),
        safe('notices', () => getDocs(query(collection(db, 'notices'), orderBy('createdAt', 'desc'), limit(3))), { docs: [] as any[] } as any),
        safe('recentAdmissions', () => getDocs(query(collection(db, 'students'), orderBy('createdAt', 'desc'), limit(5))), { docs: [] as any[] } as any),
        safe('feePayments', () => getDocs(collection(db, 'feePayments')), { docs: [] as any[] } as any),
        safe('studentLeaves', () => getDocs(query(collection(db, 'studentLeaves'), where('status', 'in', ['submitted', 'pending']))), { size: 0 } as any),
        safe('weekAttendance', () => getDocs(query(collection(db, 'attendance'), where('date', 'in', weekDates.map(w => w.date)))), { docs: [] as any[] } as any),
        safe('feeRequests', () => getDocs(collection(db, 'feeRequests')), { docs: [] as any[] } as any),
      ]);

      const students = studentsSnap.docs.map((d: any) => d.data());
      const boys = students.filter((s: any) => s.gender === 'male' || s.gender === 'Boy').length;
      const girls = students.filter((s: any) => s.gender === 'female' || s.gender === 'Girl').length;
      setGenderStats([{ name: 'Boys', value: boys }, { name: 'Girls', value: girls }]);

      const payments = feesSnap.docs.map((d: any) => d.data());
      const totalFees = payments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
      setCounts({
        students: studentsSnap.size || 0,
        teachers: teachersSnap.size || 0,
        classes: classesSnap.size || 0,
        feeCollection: totalFees,
      });
      setNotices(noticesSnap.docs.map((d: any) => ({ id: d.id, ...d.data() } as Notice)));
      setRecentAdmissions(recentSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      setPendingLeaves(leaveSnap.size || 0);

      // ─── Real weekly attendance (student docs only) ──────────────────────
      const weekDocs = weekAttendanceSnap.docs.map((d: any) => d.data()).filter((a: any) => a.type !== 'staff');
      const presentStatuses = ['present', 'late', 'regularized'];
      const absentStatuses = ['absent', 'uninformed_absence'];
      const attStats = weekDates.map(w => {
        const dayDocs = weekDocs.filter((a: any) => a.date === w.date);
        const present = dayDocs.filter((a: any) => presentStatuses.includes(a.status)).length;
        const absent = dayDocs.filter((a: any) => absentStatuses.includes(a.status)).length;
        const marked = present + absent;
        return { name: w.name, present, absent, rate: marked > 0 ? Math.round((present / marked) * 100) : 0 };
      });
      setAttendanceStats(attStats);

      const todayBucket = attStats.find(a => weekDates.find(w => w.name === a.name)?.date === today);
      setAttendanceRate(todayBucket ? todayBucket.rate : 0);

      // ─── Real fee collection trend (last 6 months) ───────────────────────
      setFeeTrendData(monthBuckets.map(m => ({
        month: m.label,
        amount: payments.filter((p: any) => (p.date || '').startsWith(m.key)).reduce((s: number, p: any) => s + (p.amount || 0), 0),
      })));

      // ─── Class-wise enrollment ───────────────────────────────────────────
      const classNameById: Record<string, string> = {};
      classesSnap.docs.forEach((d: any) => { classNameById[d.id] = d.data().name || d.id; });
      const classCount: Record<string, number> = {};
      students.forEach((s: any) => { const k = s.classId || 'Unassigned'; classCount[k] = (classCount[k] || 0) + 1; });
      setClassDistribution(
        Object.entries(classCount)
          .map(([id, n]) => ({ name: classNameById[id] || id, students: n }))
          .sort((a, b) => b.students - a.students)
          .slice(0, 12)
      );

      // ─── Fee collection efficiency (expected vs collected) ───────────────
      const requests = feeReqSnap.docs.map((d: any) => d.data());
      const expected = requests.reduce((s: number, r: any) => s + (r.totalAmount || 0), 0);
      const collected = requests.reduce((s: number, r: any) => s + (r.paidAmount || 0), 0);
      const outstanding = Math.max(0, expected - collected);
      setFeeOverview({
        expected,
        collected,
        outstanding,
        collectionRate: expected > 0 ? Math.round((collected / expected) * 100) : 0,
      });
    };
    fetchDashboardData();
  }, []);

  const downloadReport = async () => {
    const today = new Date().toLocaleDateString('en-IN');
    const { doc, contentY, pageWidth } = await createPdf(
      'Admin Dashboard Report',
      `Generated on ${today}`,
    );

    let y = contentY + 4;

    y = drawInfoBox(
      doc,
      [
        { label: 'Total Students', value: counts.students.toString() },
        { label: 'Total Teachers', value: counts.teachers.toString() },
        { label: 'Active Classes', value: counts.classes.toString() },
        { label: 'Fee Collection', value: `₹${counts.feeCollection.toLocaleString('en-IN')}` },
        { label: 'Collection Rate', value: `${feeOverview.collectionRate}%` },
        { label: 'Outstanding Dues', value: `₹${feeOverview.outstanding.toLocaleString('en-IN')}` },
        { label: "Today's Attendance", value: `${attendanceRate}%` },
        { label: 'Pending Leaves', value: pendingLeaves.toString() },
        { label: 'Report Date', value: today },
      ],
      y,
      pageWidth,
      2,
    );

    y += 6;

    if (recentAdmissions.length > 0) {
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(5, 150, 105);
      doc.text('RECENT ADMISSIONS', 12, y);
      y += 3;

      const admissionRows = recentAdmissions.map((s: any) => [
        s.name || '-',
        s.classId || '-',
        s.section || '-',
        s.admissionNumber || '-',
        s.feeStatus?.toUpperCase() || '-',
      ]);

      (doc as any).autoTable({
        startY: y,
        head: [['Name', 'Class', 'Section', 'Admission No', 'Fee Status']],
        body: admissionRows,
        ...TABLE_STYLES,
        styles: { fontSize: 8.5, cellPadding: 4 },
        margin: { left: 12, right: 12 },
      });
    }

    addFooter(doc);
    await savePdf(doc, `admin_report_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const quickActions = [
    { label: 'Students', icon: Users, to: '/superadmin/students' },
    { label: 'Teachers', icon: GraduationCap, to: '/superadmin/teachers' },
    { label: 'Fees', icon: CreditCard, to: '/superadmin/fees' },
    { label: 'Leaves', icon: Clock, to: '/superadmin/leaves' },
    { label: 'Exams', icon: BookOpen, to: '/superadmin/exams' },
    { label: 'Notices', icon: Megaphone, to: '/superadmin/notices' },
    { label: 'Admissions', icon: UserPlus, to: '/superadmin/admissions' },
    { label: 'Classes', icon: Building2, to: '/superadmin/classes' },
    { label: 'Reports', icon: BarChart3, to: '/superadmin/reports' },
  ];

  return (
    <div className="eh-app" style={{ paddingBottom: '80px' }}>
      <div className="topbar">
        <div>
          <p className="eyebrow">{todayLabel}</p>
          <h1>School Overview.</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="icon-btn mobile-only" onClick={downloadReport} aria-label="Download report" title="Download Report">
            <Download size={16} />
          </button>
          <button className="btn ghost hidden lg:flex" onClick={downloadReport} style={{ fontSize: 13, alignItems: 'center' }}>
            <Download size={14} style={{ marginRight: 6 }} />
            Download Report
          </button>
        </div>
      </div>

      <div className="pad">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 }}>
          <div className="card" style={{ padding: '16px 18px' }}>
            <p className="eyebrow">Students</p>
            <p className="t-num" style={{ fontSize: '2.8rem', lineHeight: 1 }}>{counts.students.toLocaleString()}</p>
          </div>
          <div className="card" style={{ padding: '16px 18px' }}>
            <p className="eyebrow">Teachers</p>
            <p className="t-num" style={{ fontSize: '2.8rem', lineHeight: 1 }}>{counts.teachers.toLocaleString()}</p>
          </div>
          <div className="card" style={{ padding: '16px 18px' }}>
            <p className="eyebrow">Classes</p>
            <p className="t-num" style={{ fontSize: '2.8rem', lineHeight: 1 }}>{counts.classes.toLocaleString()}</p>
          </div>
          <div className="card" style={{ padding: '16px 18px' }}>
            <p className="eyebrow">Fee Collection</p>
            <p className="t-num" style={{ fontSize: '2.8rem', lineHeight: 1 }}>₹{counts.feeCollection.toLocaleString()}</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div className="card" style={{ padding: '16px 18px' }}>
            <p className="eyebrow">Pending Leaves</p>
            <p className="t-num" style={{ fontSize: '2.4rem', lineHeight: 1, color: 'var(--coral)' }}>{pendingLeaves}</p>
          </div>
          <div className="card" style={{ padding: '16px 18px' }}>
            <p className="eyebrow">Today's Attendance</p>
            <p className="t-num" style={{ fontSize: '2.4rem', lineHeight: 1, color: 'var(--leaf)' }}>{attendanceRate}%</p>
          </div>
          <div className="card" style={{ padding: '16px 18px' }}>
            <p className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><TrendingUp size={12} /> Collection Rate</p>
            <p className="t-num" style={{ fontSize: '2.4rem', lineHeight: 1, color: 'var(--ink)' }}>{feeOverview.collectionRate}%</p>
            <p className="muted tiny" style={{ margin: '4px 0 0' }}>₹{feeOverview.collected.toLocaleString('en-IN')} of ₹{feeOverview.expected.toLocaleString('en-IN')}</p>
          </div>
          <div className="card" style={{ padding: '16px 18px' }}>
            <p className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Wallet size={12} /> Outstanding Dues</p>
            <p className="t-num" style={{ fontSize: '2.4rem', lineHeight: 1, color: 'var(--coral)' }}>₹{feeOverview.outstanding.toLocaleString('en-IN')}</p>
          </div>
        </div>

        <div className="section-head">
          <h2>Recent Admissions</h2>
          <Link to="/superadmin/students">View all</Link>
        </div>
        <div className="stack" style={{ marginBottom: 20 }}>
          {recentAdmissions.length > 0 ? recentAdmissions.map((s) => (
            <div key={s.id} className="card row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
              <div style={{
                width: 38, height: 38, borderRadius: '50%', background: 'var(--ink)', color: 'var(--cream)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 15, flexShrink: 0,
              }}>
                {(s.name || '?')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 600, fontSize: 14, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</p>
                <p className="muted tiny" style={{ margin: 0 }}>{s.admissionNumber || '—'} · {s.classId}{s.section ? ` ${s.section}` : ''}</p>
              </div>
            </div>
          )) : (
            <p className="muted" style={{ textAlign: 'center', padding: '24px 0', fontSize: 14 }}>No recent admissions</p>
          )}
        </div>

        <div className="section-head">
          <h2>Notices</h2>
          <Link to="/superadmin/notices">View all</Link>
        </div>
        <div className="stack" style={{ marginBottom: 20 }}>
          {notices.length > 0 ? notices.slice(0, 3).map((n) => (
            <div key={n.id} style={{
              borderLeft: '3px solid var(--coral)',
              paddingLeft: 14,
              paddingTop: 4,
              paddingBottom: 4,
            }}>
              <p style={{ fontWeight: 600, fontSize: 14, margin: '0 0 2px' }}>{n.title}</p>
              <p className="muted tiny" style={{ margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.content}</p>
            </div>
          )) : (
            <p className="muted" style={{ textAlign: 'center', padding: '16px 0', fontSize: 14 }}>No recent notices</p>
          )}
        </div>

        <div className="section-head">
          <h2>Quick Actions</h2>
        </div>
      </div>

      <div className="hscroll" style={{ paddingBottom: 8, marginBottom: 20 }}>
        {quickActions.map((a) => (
          <Link key={a.label} to={a.to} style={{ textDecoration: 'none' }}>
            <div className="card" style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 8, padding: '14px 16px', minWidth: 80, cursor: 'pointer',
            }}>
              <a.icon size={20} color="var(--ink-2)" />
              <p className="eyebrow" style={{ margin: 0 }}>{a.label}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="hidden lg:block" style={{ padding: '0 var(--pad)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
          <div className="card">
            <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Weekly Attendance</p>
            {attendanceStats.every(a => a.present + a.absent === 0) ? (
              <p className="muted" style={{ textAlign: 'center', padding: '70px 0', fontSize: 13 }}>No attendance marked this week</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={attendanceStats} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="present" stackId="a" fill="#4d8b5f" radius={[0, 0, 0, 0]} name="Present" />
                  <Bar dataKey="absent" stackId="a" fill="#e2553a" radius={[4, 4, 0, 0]} name="Absent" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="card">
            <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Fee Collection Trend</p>
            {feeTrendData.every(d => d.amount === 0) ? (
              <p className="muted" style={{ textAlign: 'center', padding: '70px 0', fontSize: 13 }}>No payments in the last 6 months</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={feeTrendData}>
                  <defs>
                    <linearGradient id="colorFee" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0E0F11" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#0E0F11" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: 12 }} formatter={(v: number) => [`₹${v.toLocaleString('en-IN')}`, 'Collected']} />
                  <Area type="monotone" dataKey="amount" stroke="#0E0F11" strokeWidth={2.5} fillOpacity={1} fill="url(#colorFee)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {classDistribution.length > 0 && (
          <div className="card" style={{ marginBottom: 20 }}>
            <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Enrollment by Class</p>
            <ResponsiveContainer width="100%" height={Math.max(180, classDistribution.length * 34)}>
              <BarChart data={classDistribution} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} width={90} />
                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: 12 }} formatter={(v: number) => [`${v} students`, '']} />
                <Bar dataKey="students" fill="#0E0F11" radius={[0, 4, 4, 0]} name="Students" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="card" style={{ marginBottom: 20 }}>
          <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Student Distribution</p>
          {genderStats.reduce((s, e) => s + e.value, 0) === 0 ? (
            <p className="muted" style={{ textAlign: 'center', padding: '40px 0', fontSize: 13 }}>No student data yet</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={genderStats} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={4} dataKey="value">
                    {genderStats.map((_, i) => (
                      <Cell key={i} fill={GENDER_COLORS[i % GENDER_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1 }}>
                {genderStats.map((entry, i) => (
                  <div key={entry.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 12, height: 12, borderRadius: '50%', background: GENDER_COLORS[i], display: 'inline-block' }} />
                      <span style={{ fontSize: 14, color: 'var(--ink-2)' }}>{entry.name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{entry.value}</span>
                      <span className="muted tiny">{counts.students > 0 ? `${Math.round((entry.value / counts.students) * 100)}%` : '0%'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <button
        onClick={() => setAiOpen(true)}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 30,
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--ink)', color: 'var(--cream)',
          border: 'none', borderRadius: 999,
          padding: '10px 16px', cursor: 'pointer',
          boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        }}
        aria-label="Open AI insights"
      >
        <Sparkles size={18} color="var(--accent)" />
        <span style={{ fontSize: 13, fontWeight: 600 }}>Ask AI</span>
      </button>

      <AIInsightsPanel open={aiOpen} onClose={() => setAiOpen(false)} period="This Month" />
    </div>
  );
}
