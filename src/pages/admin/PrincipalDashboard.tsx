import { useState, useEffect } from 'react';
import { Users, GraduationCap, Clock, Megaphone, BookOpen, CreditCard, Sparkles } from 'lucide-react';
import { collection, query, getDocs, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { UserProfile } from '../../types';
import { Link } from 'react-router-dom';
import AIInsightsPanel from '../../components/AIInsightsPanel';

export default function PrincipalDashboard({ user }: { user: UserProfile }) {
  const [stats, setStats] = useState({
    students: 0,
    teachers: 0,
    classes: 0,
    attendanceToday: '—',
  });
  const [pendingLeaves, setPendingLeaves] = useState(0);
  const [notices, setNotices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const [studentSnap, teacherSnap, classSnap, attendanceSnap, leaveSnap, noticesSnap] = await Promise.all([
          getDocs(collection(db, 'students')),
          getDocs(collection(db, 'teachers')),
          getDocs(collection(db, 'classes')),
          getDocs(query(collection(db, 'attendance'), where('date', '==', today))),
          getDocs(query(collection(db, 'studentLeaves'), where('status', 'in', ['submitted', 'pending']))),
          getDocs(query(collection(db, 'notices'), orderBy('createdAt', 'desc'), limit(3))),
        ]);

        const totalStudents = studentSnap.size;
        const present = attendanceSnap.docs.filter(d => d.data().status === 'present').length;
        const pct = totalStudents > 0 ? Math.round((present / totalStudents) * 100) : 0;

        setStats({
          students: totalStudents,
          teachers: teacherSnap.size,
          classes: classSnap.size,
          attendanceToday: `${pct}%`,
        });
        setPendingLeaves(leaveSnap.size || 0);
        setNotices(noticesSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('PrincipalDashboard stats error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const todayLabel = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const quickActions = [
    { label: 'Students', icon: Users, to: '/principal/students' },
    { label: 'Teachers', icon: GraduationCap, to: '/principal/teachers' },
    { label: 'Leaves', icon: Clock, to: '/principal/leaves' },
    { label: 'Exams', icon: BookOpen, to: '/principal/exams' },
    { label: 'Notices', icon: Megaphone, to: '/principal/notices' },
    { label: 'Fees', icon: CreditCard, to: '/principal/fees' },
  ];

  return (
    <div className="eh-app" style={{ paddingBottom: '80px' }}>
      <div className="topbar">
        <div>
          <p className="eyebrow">{todayLabel}</p>
          <h1>Principal Dashboard</h1>
        </div>
      </div>

      <div className="pad">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 }}>
          <div className="card" style={{ padding: '16px 18px' }}>
            <p className="eyebrow">Students</p>
            <p className="t-num" style={{ fontSize: '2.8rem', lineHeight: 1 }}>
              {loading ? '—' : stats.students.toLocaleString()}
            </p>
          </div>
          <div className="card" style={{ padding: '16px 18px' }}>
            <p className="eyebrow">Teachers</p>
            <p className="t-num" style={{ fontSize: '2.8rem', lineHeight: 1 }}>
              {loading ? '—' : stats.teachers.toLocaleString()}
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 20 }}>
          <div className="card" style={{ padding: '16px 18px' }}>
            <p className="eyebrow">Pending Leaves</p>
            <p className="t-num" style={{ fontSize: '2.4rem', lineHeight: 1, color: 'var(--coral)' }}>
              {loading ? '—' : pendingLeaves}
            </p>
          </div>
          <div className="card" style={{ padding: '16px 18px' }}>
            <p className="eyebrow">Today's Attendance</p>
            <p className="t-num" style={{ fontSize: '2.4rem', lineHeight: 1, color: 'var(--leaf)' }}>
              {loading ? '—' : stats.attendanceToday}
            </p>
          </div>
        </div>

        <div className="section-head">
          <h2>Notices</h2>
          <Link to="/principal/notices">View all</Link>
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
