import {
  Wallet,
  Clock,
  Calendar,
  BookOpen,
  BarChart3,
  ClipboardCheck,
  MessageCircle,
  Bell,
  Sparkles,
  Users,
  ChevronRight,
} from 'lucide-react';
import { UserProfile, Student, Notice, FeeRequest, Attendance, Homework, ExamResult } from '../../types';
import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import AIInsightsPanel from '../../components/AIInsightsPanel';
import { buildParentContext } from '../../lib/aiContext';
import { fmtDate } from '../../lib/utils';

interface ParentDashboardProps {
  user: UserProfile;
  selectedStudent: Student | null;
}

const QUICK_ACTIONS = [
  { to: '/parent/fees', label: 'Fees', icon: Wallet },
  { to: '/parent/attendance', label: 'Attendance', icon: Clock },
  { to: '/parent/timetable', label: 'Timetable', icon: Calendar },
  { to: '/parent/exams', label: 'Grades', icon: BarChart3 },
  { to: '/parent/leaves', label: 'Leaves', icon: ClipboardCheck },
  { to: '/parent/grievances', label: 'Grievance', icon: MessageCircle },
];

export default function ParentDashboard({ user, selectedStudent }: ParentDashboardProps) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [feeRequests, setFeeRequests] = useState<FeeRequest[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [examResults, setExamResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!selectedStudent) return;
      setLoading(true);
      try {
        const noticesQ = query(
          collection(db, 'notices'),
          where('targetRoles', 'array-contains', 'parent'),
          orderBy('createdAt', 'desc'),
          limit(3)
        );
        const noticesSnap = await getDocs(noticesQ);
        setNotices(noticesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notice)));

        const feesQ = query(
          collection(db, 'feeRequests'),
          where('studentId', '==', selectedStudent.id),
          orderBy('dueDate', 'desc'),
          limit(4)
        );
        const feesSnap = await getDocs(feesQ);
        setFeeRequests(feesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FeeRequest)));

        const attendanceQ = query(
          collection(db, 'attendance'),
          where('studentId', '==', selectedStudent.id)
        );
        const attendanceSnap = await getDocs(attendanceQ);
        setAttendance(attendanceSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Attendance)));

        const homeworkQ = query(
          collection(db, 'homework'),
          where('classId', '==', selectedStudent.classId),
          orderBy('dueDate', 'desc'),
          limit(2)
        );
        const homeworkSnap = await getDocs(homeworkQ);
        setHomework(homeworkSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Homework)));

        const examResultsQ = query(
          collection(db, 'examResults'),
          where('studentId', '==', selectedStudent.id),
          limit(4)
        );
        const examResultsSnap = await getDocs(examResultsQ);
        setExamResults(examResultsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExamResult)));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'dashboard-data');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [selectedStudent]);

  if (!selectedStudent) {
    return (
      <div className="pad stack" style={{ paddingTop: 48, textAlign: 'center' }}>
        <Users className="w-12 h-12 mx-auto" style={{ color: 'var(--ink-4)' }} />
        <p className="display" style={{ marginTop: 12 }}>No Students Linked</p>
        <p className="muted tiny" style={{ marginTop: 4 }}>
          There are no student profiles linked to this parent account. Please contact the administration.
        </p>
      </div>
    );
  }

  const pendingFees = feeRequests.filter(f => f.status === 'pending' || f.status === 'overdue')
    .reduce((sum, f) => sum + f.totalAmount, 0);
  const totalDays = attendance.length;
  const presentDays = attendance.filter(a => a.status === 'present').length;
  const attendancePct = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;
  const attendanceLabel = totalDays > 0 ? `${attendancePct}%` : '--';
  const parentName = user.name?.split(' ')[0] || 'there';

  const attColor = attendancePct >= 75 ? 'var(--leaf)' : attendancePct >= 60 ? '#f59e0b' : 'var(--coral)';

  return (
    <div className="pad stack" style={{ '--stack-gap': '20px' } as React.CSSProperties}>
      {/* Topbar */}
      <div className="topbar">
        <div>
          <p className="eyebrow">{selectedStudent.name}</p>
          <h1 className="display" style={{ fontSize: 22 }}>Hello, {parentName}.</h1>
        </div>
        <Bell className="w-5 h-5 lg:hidden" style={{ color: 'var(--ink-3)' }} />
      </div>

      {/* Fee hero card — only if outstanding */}
      {pendingFees > 0 && (
        <Link
          to="/parent/fees"
          className="card"
          style={{ background: 'var(--ink)', color: 'var(--cream)', display: 'block', textDecoration: 'none' }}
        >
          <p className="eyebrow" style={{ color: 'var(--cream-2)' }}>Outstanding Balance</p>
          <p className="t-num display" style={{ fontSize: 36, lineHeight: 1.1, marginTop: 4 }}>
            ₹{pendingFees.toLocaleString('en-IN')}
          </p>
          <div className="flex items-center gap-2" style={{ marginTop: 16 }}>
            <span className="btn accent" style={{ fontSize: 13, padding: '6px 16px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Pay Now <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </Link>
      )}

      {/* Attendance stat card */}
      <div className="card">
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <div>
            <p className="eyebrow">Attendance</p>
            <p className="t-num display" style={{ fontSize: 32, lineHeight: 1 }}>{presentDays}</p>
            <p className="muted tiny" style={{ marginTop: 2 }}>of {totalDays} days present</p>
          </div>
          <p className="t-num" style={{ fontSize: 28, fontWeight: 800, color: attColor }}>{attendanceLabel}</p>
        </div>
        <div className="bar" style={{ height: 6, borderRadius: 4, background: 'var(--cream-2)' }}>
          <i style={{ width: `${attendancePct}%`, background: attColor, borderRadius: 4, display: 'block', height: '100%' }} />
        </div>
      </div>

      {/* Quick-action tiles */}
      <div>
        <p className="eyebrow" style={{ marginBottom: 10 }}>Quick Actions</p>
        <div className="hscroll" style={{ gap: 10 }}>
          {QUICK_ACTIONS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              style={{
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                width: 72,
                height: 72,
                borderRadius: 16,
                background: 'var(--paper)',
                border: '1px solid var(--line)',
                textDecoration: 'none',
                color: 'var(--ink)',
              }}
            >
              <Icon className="w-5 h-5" strokeWidth={1.8} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em' }}>{label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Upcoming homework */}
      {homework.length > 0 && (
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
            <p className="eyebrow">Upcoming Homework</p>
            <Link to="/parent/diary" style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none' }}>See all</Link>
          </div>
          <div className="stack" style={{ '--stack-gap': '8px' } as React.CSSProperties}>
            {homework.slice(0, 2).map(hw => (
              <div key={hw.id} className="card" style={{ padding: '12px 16px' }}>
                <div className="flex items-center justify-between">
                  <span className="eyebrow" style={{ color: 'var(--accent)' }}>{hw.subjectId}</span>
                  <span className="tiny muted">{fmtDate(hw.dueDate)}</span>
                </div>
                <p style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: 'var(--ink)' }}>
                  {hw.content.substring(0, 80)}{hw.content.length > 80 ? '…' : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notice strip */}
      {notices.length > 0 && (
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
            <p className="eyebrow">Latest Notices</p>
            <Link to="/parent/notices" style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textDecoration: 'none' }}>See all</Link>
          </div>
          <div className="stack" style={{ '--stack-gap': '8px' } as React.CSSProperties}>
            {notices.slice(0, 2).map(notice => (
              <div key={notice.id} className="card" style={{ padding: '12px 16px' }}>
                <div className="flex items-start gap-3">
                  <Bell className="w-4 h-4 shrink-0" style={{ color: 'var(--ink-3)', marginTop: 2 }} />
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{notice.title}</p>
                    <p className="muted tiny" style={{ marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {notice.content}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Floating AI button */}
      <button
        onClick={() => setAiOpen(true)}
        className="fixed z-30 flex items-center gap-2"
        style={{
          bottom: 80,
          right: 20,
          background: 'var(--ink)',
          color: '#d4ff6e',
          border: 'none',
          borderRadius: 20,
          padding: '10px 18px',
          fontSize: 13,
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        }}
        aria-label="Open AI Insights"
      >
        <Sparkles className="w-4 h-4" />
        <span className="hidden sm:inline">Ask AI</span>
      </button>

      <AIInsightsPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        label="Parent AI"
        greeting={`Hello! I can see ${selectedStudent.name}'s attendance, fees, homework, and exam results. What would you like to know?`}
        contextBuilder={() => buildParentContext(selectedStudent.id, selectedStudent.name, selectedStudent.classId)}
        placeholder="Ask about fees, attendance, results…"
        suggestedPrompts={[
          `What is ${selectedStudent.name}'s attendance percentage?`,
          'Are there any pending fee payments?',
          'How did my child perform in recent exams?',
          'What homework is due this week?',
          'Is there anything urgent I should be aware of?',
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
