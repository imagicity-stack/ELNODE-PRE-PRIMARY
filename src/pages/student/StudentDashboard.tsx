import {
  Bell, Search, ClipboardCheck, Wallet, CheckSquare, CalendarDays,
  BookOpen, FileText, ChevronRight, Sparkles,
} from 'lucide-react';
import { UserProfile, Notice, Homework, Attendance, FeeRequest } from '../../types';
import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { useData } from '../../contexts/DataContext';
import AIInsightsPanel from '../../components/AIInsightsPanel';
import { buildStudentContext } from '../../lib/aiContext';
import { fmtDate } from '../../lib/utils';

interface StudentDashboardProps {
  user: UserProfile;
}

export default function StudentDashboard({ user }: StudentDashboardProps) {
  const { classesMap } = useData();
  const navigate = useNavigate();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [feeRequests, setFeeRequests] = useState<FeeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const noticesQ = query(
          collection(db, 'notices'),
          where('targetRoles', 'array-contains', 'student'),
          orderBy('createdAt', 'desc'),
          limit(3)
        );
        const noticesSnap = await getDocs(noticesQ);
        setNotices(noticesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notice)));

        if (user.classId) {
          const homeworkQ = query(
            collection(db, 'homework'),
            where('classId', '==', user.classId),
            orderBy('dueDate', 'desc'),
            limit(3)
          );
          const homeworkSnap = await getDocs(homeworkQ);
          setHomework(homeworkSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Homework)));
        }

        const attendanceQ = query(
          collection(db, 'attendance'),
          where('studentId', '==', user.studentId || user.uid)
        );
        const attendanceSnap = await getDocs(attendanceQ);
        setAttendance(attendanceSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Attendance)));

        const feesQ = query(
          collection(db, 'feeRequests'),
          where('studentId', '==', user.studentId || user.uid),
          where('status', 'in', ['pending', 'partially_paid', 'overdue'])
        );
        const feesSnap = await getDocs(feesQ);
        setFeeRequests(feesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FeeRequest)));
      } catch (err) {
        console.error('Error fetching student dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user.uid, user.classId, user.studentId]);

  const totalDays = attendance.length;
  const presentDays = attendance.filter(a => a.status === 'present').length;
  const attendancePct = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;
  const pendingFee = feeRequests.reduce((s, f) => s + ((f.totalAmount || 0) - (f.paidAmount || 0)), 0);
  const totalFee = feeRequests.reduce((s, f) => s + (f.totalAmount || 0), 0);
  const paidFee = totalFee - pendingFee;
  const feePctPaid = totalFee > 0 ? Math.round((paidFee / totalFee) * 100) : 100;

  const firstName = (user.name || 'there').split(' ')[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const className = `${classesMap[user.classId] || user.classId || ''}${user.section ? ` · ${user.section}` : ''}`;

  // Last ~24 attendance records as bars (most recent last)
  const bars = attendance
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .slice(-24);

  const actions = [
    { icon: ClipboardCheck, label: 'Attendance', sub: `${attendancePct}% present`, to: '/student/attendance' },
    { icon: Wallet, label: 'Pay fees', sub: pendingFee > 0 ? `₹${pendingFee.toLocaleString('en-IN')} due` : 'All clear', to: '/student/fees' },
    { icon: CheckSquare, label: 'Homework', sub: homework.length ? `${homework.length} pending` : 'All done', to: '/student/homework' },
    { icon: CalendarDays, label: 'Timetable', sub: 'Class schedule', to: '/student/timetable' },
    { icon: BookOpen, label: 'Subjects', sub: 'My subjects', to: '/student/subjects' },
    { icon: FileText, label: 'Leave', sub: 'Apply', to: '/student/leaves' },
  ];

  return (
    <div className="pb-2">
      {/* Topbar */}
      <div className="topbar">
        <div>
          <div className="eyebrow">{greet}</div>
          <h1>{firstName},<br />let's begin.</h1>
        </div>
        <div className="flex items-center" style={{ gap: 8 }}>
          <button className="icon-btn mobile-only" aria-label="search"><Search size={18} /></button>
          <button className="icon-btn mobile-only" aria-label="notices" onClick={() => navigate('/student/notices')}>
            <Bell size={18} />
            {notices.length > 0 && (
              <span style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: '50%', background: 'var(--coral)' }} />
            )}
          </button>
          <div className="avatar">{(user.name || 'S').charAt(0).toUpperCase()}</div>
        </div>
      </div>

      {/* Hero — fee standing */}
      <div className="pad" style={{ marginTop: 6 }}>
        <div className="card inked" style={{ position: 'relative', overflow: 'hidden' }}>
          <div className="flex between center">
            <span className="eyebrow" style={{ color: 'var(--cream)', opacity: 0.65 }}>
              {pendingFee > 0 ? 'Outstanding balance' : 'Fees'}
            </span>
            <span className="mono small" style={{ opacity: 0.75 }}>{className}</span>
          </div>
          <div className="t-num" style={{ fontSize: 44, marginTop: 12, lineHeight: 1 }}>
            {pendingFee > 0 ? <>₹{pendingFee.toLocaleString('en-IN')}</> : 'All cleared'}
          </div>
          {pendingFee > 0 ? (
            <>
              <div style={{ color: '#D7D3C5', marginTop: 6, fontSize: 13 }}>
                {feeRequests[0]?.dueDate ? `Next due ${fmtDate(feeRequests[0].dueDate)}` : 'Payment pending'}
              </div>
              <div className="bar" style={{ marginTop: 16, background: 'rgba(255,255,255,0.12)' }}>
                <i style={{ width: `${feePctPaid}%`, background: 'var(--accent)' }} />
              </div>
              <div className="flex between" style={{ marginTop: 8 }}>
                <span className="mono tiny" style={{ opacity: 0.7 }}>{feePctPaid}% paid</span>
                <Link to="/student/fees" className="mono tiny" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                  Pay now →
                </Link>
              </div>
            </>
          ) : (
            <div style={{ color: '#D7D3C5', marginTop: 6, fontSize: 13 }}>
              You have no pending dues. Nicely done.
            </div>
          )}
          <div className="display" style={{ position: 'absolute', right: -8, bottom: -22, fontSize: 110, color: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }}>
            ₹
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="pad" style={{ marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
          <Link to="/student/attendance" className="card" style={{ textAlign: 'left', display: 'block', textDecoration: 'none', color: 'inherit' }}>
            <div className="eyebrow">Attendance</div>
            <div className="t-num" style={{ fontSize: 38, marginTop: 4 }}>
              {attendancePct}<span style={{ fontSize: 18, color: 'var(--ink-3)' }}>%</span>
            </div>
            <div className="small muted" style={{ marginTop: 2 }}>
              {totalDays > 0 ? `${presentDays}/${totalDays} days` : 'No records yet'}
            </div>
            {bars.length > 0 && (
              <div className="flex" style={{ gap: 3, marginTop: 10 }}>
                {bars.map((a, i) => (
                  <span key={i} style={{
                    flex: 1, height: 14, borderRadius: 2,
                    background: a.status === 'present' ? 'var(--ink)' : 'var(--coral)',
                  }} />
                ))}
              </div>
            )}
          </Link>
          <Link to="/student/homework" className="card accent" style={{ textAlign: 'left', display: 'block', textDecoration: 'none', color: 'var(--accent-ink)' }}>
            <div className="eyebrow" style={{ color: 'var(--accent-ink)', opacity: 0.7 }}>Homework</div>
            <div className="t-num" style={{ fontSize: 38, marginTop: 4 }}>{homework.length}</div>
            <div className="small" style={{ marginTop: 2, opacity: 0.75 }}>
              {homework.length ? 'pending tasks' : 'all caught up'}
            </div>
            <div className="mono tiny" style={{ marginTop: 10, opacity: 0.75 }}>
              {homework.length ? '▲ DUE SOON' : '✓ CLEAR'}
            </div>
          </Link>
        </div>
      </div>

      {/* Quick actions */}
      <div className="section-head"><h2>Quick actions</h2></div>
      <div className="hscroll">
        {actions.map((a) => (
          <button key={a.label} className="card" style={{ minWidth: 134, textAlign: 'left', padding: 14, flexShrink: 0 }} onClick={() => navigate(a.to)}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--cream-2)', display: 'grid', placeItems: 'center' }}>
              <a.icon size={18} />
            </div>
            <div style={{ fontWeight: 600, fontSize: 13, marginTop: 10 }}>{a.label}</div>
            <div className="small muted" style={{ marginTop: 2 }}>{a.sub}</div>
          </button>
        ))}
      </div>

      {/* Upcoming homework */}
      <div className="section-head">
        <h2>Upcoming homework</h2>
        <Link to="/student/homework" style={{ fontSize: 12, color: 'var(--ink-3)', textDecoration: 'none' }}>View all →</Link>
      </div>
      <div className="pad stack">
        {loading ? (
          <div className="card muted small" style={{ textAlign: 'center', padding: 24 }}>Loading…</div>
        ) : homework.length > 0 ? (
          homework.map((hw) => (
            <button key={hw.id} className="card" style={{ textAlign: 'left', display: 'flex', gap: 14, alignItems: 'center', padding: '14px 16px', width: '100%' }} onClick={() => navigate('/student/homework')}>
              <div style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--cream-2)', fontFamily: 'var(--display)', fontWeight: 700, fontSize: 16 }}>
                {(hw.subjectId || '?').slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hw.content}</div>
                <div className="small muted" style={{ marginTop: 2 }}>{hw.subjectId} · Due {fmtDate(hw.dueDate)}</div>
              </div>
              <ChevronRight size={16} className="muted" />
            </button>
          ))
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: 28 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--cream-2)', display: 'grid', placeItems: 'center', margin: '0 auto 10px' }}>
              <CheckSquare size={22} className="muted" />
            </div>
            <div className="bold">You're all caught up</div>
            <div className="small muted" style={{ marginTop: 2 }}>No pending homework right now.</div>
          </div>
        )}
      </div>

      {/* Notice strip */}
      {notices.length > 0 && (
        <div className="pad" style={{ marginTop: 16 }}>
          <button
            className="card"
            style={{ width: '100%', textAlign: 'left', display: 'flex', gap: 14, padding: 14, alignItems: 'center', borderLeft: '4px solid var(--coral)' }}
            onClick={() => navigate('/student/notices')}
          >
            <div className="eyebrow" style={{ color: 'var(--coral)' }}>New</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{notices[0].title}</div>
              <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{notices[0].content}</div>
            </div>
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      <div style={{ height: 16 }} />

      {/* AI insights floating button */}
      <button
        onClick={() => setAiOpen(true)}
        className="fixed z-30 flex items-center gap-2"
        style={{
          bottom: 'calc(76px + env(safe-area-inset-bottom))',
          right: 16,
          background: 'var(--ink)', color: 'var(--cream)',
          padding: '12px 16px', borderRadius: 999, border: 0,
          fontWeight: 600, fontSize: 14, cursor: 'pointer',
          boxShadow: '0 8px 24px rgba(14,15,17,0.25)',
        }}
        aria-label="Ask AI"
      >
        <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />
        Ask AI
      </button>

      <AIInsightsPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        label="Student AI"
        greeting={`Hi ${firstName}! I can see your attendance, fee status, homework, and exam results. What would you like to know?`}
        contextBuilder={() => buildStudentContext(user.studentId || user.uid, user.classId || '')}
        placeholder="Ask about your fees, attendance, results…"
        suggestedPrompts={[
          'What is my current attendance percentage?',
          'Do I have any pending fee payments?',
          'What homework is due soon?',
          'How did I perform in my recent exams?',
          'Am I at risk of attendance shortage?',
        ]}
        summaryRenderer={(ctx) => ctx?.summary ? (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className={`rounded-lg p-2 ${ctx.summary.attendancePct >= 75 ? 'bg-emerald-50' : 'bg-rose-50'}`}>
              <p className={`text-[9px] font-bold uppercase ${ctx.summary.attendancePct >= 75 ? 'text-emerald-700' : 'text-rose-700'}`}>Attendance</p>
              <p className={`text-xs font-black mt-0.5 ${ctx.summary.attendancePct >= 75 ? 'text-emerald-800' : 'text-rose-800'}`}>{ctx.summary.attendancePct}%</p>
            </div>
            <div className={`rounded-lg p-2 ${ctx.summary.pendingFeeAmount > 0 ? 'bg-amber-50' : 'bg-emerald-50'}`}>
              <p className={`text-[9px] font-bold uppercase ${ctx.summary.pendingFeeAmount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>Fees Due</p>
              <p className={`text-xs font-black mt-0.5 ${ctx.summary.pendingFeeAmount > 0 ? 'text-amber-800' : 'text-emerald-800'}`}>
                {ctx.summary.pendingFeeAmount > 0 ? `₹${(ctx.summary.pendingFeeAmount / 1000 | 0)}k` : 'Clear'}
              </p>
            </div>
            <div className="bg-blue-50 rounded-lg p-2">
              <p className="text-[9px] text-blue-700 font-bold uppercase">Avg Score</p>
              <p className="text-xs font-black text-blue-800 mt-0.5">{ctx.summary.avgExamScore != null ? `${ctx.summary.avgExamScore}%` : '--'}</p>
            </div>
          </div>
        ) : null}
      />
    </div>
  );
}
