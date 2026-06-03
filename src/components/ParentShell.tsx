import React, { useEffect, useRef, useState } from 'react';
import { usePullToRefresh, PullIndicator } from './PullToRefresh';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import {
  Home, Wallet, Clock, BookOpen, BarChart3, ClipboardCheck,
  Megaphone, Calendar, MessageCircle, User, LogOut, Bell, ChevronDown,
  MoreHorizontal, X,
} from 'lucide-react';
import { APP_NAME, SCHOOL_NAME, APP_LOGO } from '../constants';
import { UserProfile, Student } from '../types';
import NotificationCenter from './NotificationCenter';
import { useToast } from './Toast';
import { logActivity } from '../services/activityService';
import { requestNotificationPermission, startNotificationListeners } from '../services/notificationService';

const BASE = '/parent';

const NAV_SECTIONS = [
  {
    heading: 'Overview',
    items: [
      { label: 'Home', icon: Home, path: '' },
    ],
  },
  {
    heading: 'Academics',
    items: [
      { label: 'Attendance', icon: Clock, path: '/attendance' },
      { label: 'Timetable', icon: Calendar, path: '/timetable' },
      { label: 'Subjects', icon: BookOpen, path: '/subjects' },
      { label: 'Grades', icon: BarChart3, path: '/exams' },
      { label: 'Class Diary', icon: BookOpen, path: '/diary' },
    ],
  },
  {
    heading: 'Finance',
    items: [
      { label: 'Fees', icon: Wallet, path: '/fees' },
    ],
  },
  {
    heading: 'Requests',
    items: [
      { label: 'Leaves', icon: ClipboardCheck, path: '/leaves' },
      { label: 'Grievances', icon: MessageCircle, path: '/grievances' },
    ],
  },
  {
    heading: 'Communication',
    items: [
      { label: 'Notices', icon: Megaphone, path: '/notices' },
      { label: 'Calendar', icon: Calendar, path: '/calendar' },
    ],
  },
  {
    heading: 'Profile',
    items: [
      { label: "Child's Profile", icon: User, path: '/child-profile' },
    ],
  },
];

const TABS = [
  { label: 'Home', icon: Home, path: '' },
  { label: 'Fees', icon: Wallet, path: '/fees' },
  { label: 'Attend', icon: Clock, path: '/attendance' },
  { label: 'Grades', icon: BarChart3, path: '/exams' },
];

export interface ParentShellProps {
  children: React.ReactNode;
  user: UserProfile;
  students: Student[];
  selectedStudent: Student | null;
  onSelectStudent: (s: Student) => void;
}

export default function ParentShell({
  children,
  user,
  students,
  selectedStudent,
  onSelectStudent,
}: ParentShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const mainRef = useRef<HTMLElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const { pullY, refreshing } = usePullToRefresh(mainRef, () => setRefreshKey(k => k + 1));
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const userName = user.name || user.email || 'Parent';
  const initials = userName.charAt(0).toUpperCase();

  const isActive = (path: string) =>
    location.pathname === `${BASE}${path}` || (path === '' && location.pathname === BASE);

  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [location.pathname]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      await requestNotificationPermission();
      if (auth.currentUser) {
        unsub = startNotificationListeners(
          auth.currentUser.uid, 'parent', [],
          (title, body) => showToast(`${title}: ${body}`, 'info')
        );
      }
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  const handleLogout = async () => {
    try {
      await logActivity(user, 'User Logged Out', 'Parents', `${user.name} signed out of the Parent portal`);
    } catch { /* non-fatal */ }
    await signOut(auth);
    navigate('/login');
  };

  return (
    <div className="eh-app min-h-screen flex" style={{ background: 'var(--cream)' }}>
      {/* ── Desktop sidebar ─────────────────────────────────────── */}
      <aside
        className="hidden lg:flex flex-col fixed inset-y-0 left-0 w-64 z-30"
        style={{ background: 'var(--paper)', borderRight: '1px solid var(--line)' }}
      >
        {/* Logo + student chip */}
        <div className="px-5 py-4 space-y-2" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--ink)' }}
            >
              <img src={APP_LOGO} className="w-6 h-6 object-contain" alt={APP_NAME} referrerPolicy="no-referrer" />
            </div>
            <div className="min-w-0">
              <p className="display text-sm leading-none truncate" style={{ fontSize: 15 }}>{APP_NAME}</p>
              <p className="eyebrow mt-1 truncate">{SCHOOL_NAME}</p>
            </div>
          </div>

          {/* Student switcher chip */}
          {selectedStudent && (
            <div className="relative">
              {students.length > 1 ? (
                <>
                  <button
                    onClick={() => setSwitcherOpen(o => !o)}
                    className="chip solid w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left"
                    style={{ background: 'var(--ink)', color: 'var(--cream)', fontSize: 12 }}
                  >
                    <span className="font-semibold truncate">{selectedStudent.name}</span>
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />
                  </button>
                  {switcherOpen && (
                    <div
                      className="absolute top-full left-0 right-0 mt-1 rounded-xl z-50 overflow-hidden"
                      style={{ background: 'var(--paper)', border: '1px solid var(--line)', boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}
                    >
                      {students.map(s => (
                        <button
                          key={s.id}
                          onClick={() => { onSelectStudent(s); setSwitcherOpen(false); }}
                          className="w-full text-left px-3 py-2.5 text-[13px] font-semibold transition-colors"
                          style={
                            s.id === selectedStudent.id
                              ? { background: 'var(--ink)', color: 'var(--cream)' }
                              : { color: 'var(--ink-2)' }
                          }
                          onMouseEnter={e => { if (s.id !== selectedStudent.id) e.currentTarget.style.background = 'var(--cream-2)'; }}
                          onMouseLeave={e => { if (s.id !== selectedStudent.id) e.currentTarget.style.background = 'transparent'; }}
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div
                  className="px-3 py-1.5 rounded-xl text-[12px] font-semibold truncate"
                  style={{ background: 'var(--cream-2)', color: 'var(--ink-2)' }}
                >
                  {selectedStudent.name}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto scrollbar-hide">
          {NAV_SECTIONS.map((section, si) => (
            <div key={section.heading} className={si > 0 ? 'mt-4' : ''}>
              <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--ink-4)' }}>
                {section.heading}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(item.path);
                  return (
                    <Link
                      key={item.label + item.path}
                      to={`${BASE}${item.path}`}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors"
                      style={
                        active
                          ? { background: 'var(--ink)', color: 'var(--cream)' }
                          : { color: 'var(--ink-3)' }
                      }
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--cream-2)'; }}
                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <item.icon className="w-[18px] h-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.7} />
                      <span className="text-[13px] font-semibold">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 space-y-1" style={{ borderTop: '1px solid var(--line)' }}>
          <Link
            to={`${BASE}/profile`}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors"
            style={isActive('/profile') ? { background: 'var(--ink)', color: 'var(--cream)' } : { color: 'var(--ink-2)' }}
          >
            <div className="avatar" style={{ width: 28, height: 28, fontSize: 12 }}>
              {user.photoURL
                ? <img src={user.photoURL} alt={userName} className="w-full h-full object-cover rounded-full" />
                : initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold truncate leading-none">{userName}</p>
              <p className="eyebrow mt-0.5">Parent</p>
            </div>
          </Link>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors"
            style={{ color: 'var(--ink-3)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--coral)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; }}
          >
            <LogOut className="w-[18px] h-[18px] shrink-0" />
            <span className="text-[13px] font-semibold">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 lg:ml-64">
        {/* Desktop top strip */}
        <div
          className="hidden lg:flex items-center justify-end gap-3 px-8 h-16 shrink-0 sticky top-0 z-20"
          style={{ background: 'var(--cream)' }}
        >
          <NotificationCenter user={user} />
        </div>

        {/* Mobile topbar — student switcher chips */}
        {students.length > 1 && (
          <div
            className="lg:hidden sticky top-0 z-20 px-4 py-2"
            style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}
          >
            <div className="hscroll flex gap-2">
              {students.map(s => (
                <button
                  key={s.id}
                  onClick={() => onSelectStudent(s)}
                  className={`chip shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all${s.id === selectedStudent?.id ? ' solid' : ''}`}
                  style={
                    s.id === selectedStudent?.id
                      ? { background: 'var(--ink)', color: 'var(--cream)' }
                      : { background: 'var(--cream-2)', color: 'var(--ink-2)' }
                  }
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Mobile notification bell — shown in pages' own topbar via slot, but also globally */}
        <div
          className="lg:hidden flex items-center justify-between px-4 h-12 shrink-0 sticky top-0 z-10"
          style={{ background: 'var(--cream)', borderBottom: '1px solid transparent' }}
        >
          <span className="eyebrow">Parent Portal</span>
          <NotificationCenter user={user} />
        </div>

        {/* Scrollable content */}
        <PullIndicator pullY={pullY} refreshing={refreshing} />
        <main ref={mainRef} className="flex-1 overflow-y-auto pb-24 lg:pb-8">
          <div className="lg:max-w-7xl lg:mx-auto lg:px-10" key={refreshKey}>
            {children}
          </div>
        </main>
      </div>

      {/* ── Mobile bottom tab bar ───────────────────────────────── */}
      <nav className="tabbar lg:hidden fixed bottom-0 inset-x-0 z-30">
        {TABS.map((t) => {
          const active = isActive(t.path);
          return (
            <button
              key={t.label}
              className={'tab' + (active ? ' active' : '')}
              onClick={() => navigate(`${BASE}${t.path}`)}
            >
              <t.icon size={22} strokeWidth={active ? 2.2 : 1.6} />
              <span>{t.label}</span>
              <span className="dot" />
            </button>
          );
        })}
        <button
          className={'tab' + (showMoreMenu ? ' active' : '')}
          onClick={() => setShowMoreMenu(true)}
        >
          <MoreHorizontal size={22} strokeWidth={showMoreMenu ? 2.2 : 1.6} />
          <span>More</span>
          <span className="dot" />
        </button>
      </nav>

      {/* ── More menu overlay (mobile) ──────────────────────────── */}
      {showMoreMenu && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setShowMoreMenu(false)}
        >
          <div
            className="more-sheet rounded-t-2xl flex flex-col"
            style={{ background: 'var(--paper)', maxHeight: '88vh' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
              <p className="text-[15px] font-bold" style={{ color: 'var(--ink)' }}>Menu</p>
              <button
                onClick={() => setShowMoreMenu(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full"
                style={{ background: 'var(--cream-2)', color: 'var(--ink-3)' }}
              >
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-3 py-3">
              {NAV_SECTIONS.map((section, si) => (
                <div key={section.heading} className={si > 0 ? 'mt-4' : ''}>
                  <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--ink-4)' }}>
                    {section.heading}
                  </p>
                  <div className="space-y-0.5">
                    {section.items.map((item) => {
                      const active = isActive(item.path);
                      return (
                        <button
                          key={item.label + item.path}
                          className="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-left"
                          style={active ? { background: 'var(--ink)', color: 'var(--cream)' } : { color: 'var(--ink-2)' }}
                          onClick={() => { navigate(`${BASE}${item.path}`); setShowMoreMenu(false); }}
                        >
                          <item.icon className="w-5 h-5 shrink-0" strokeWidth={active ? 2.2 : 1.7} />
                          <span className="text-[14px] font-semibold">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-3 pb-2 pt-2 shrink-0 space-y-0.5" style={{ borderTop: '1px solid var(--line)' }}>
              <button
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-left"
                style={isActive('/profile') ? { background: 'var(--ink)', color: 'var(--cream)' } : { color: 'var(--ink-2)' }}
                onClick={() => { navigate(`${BASE}/profile`); setShowMoreMenu(false); }}
              >
                <div className="avatar shrink-0" style={{ width: 28, height: 28, fontSize: 12 }}>
                  {user.photoURL ? <img src={user.photoURL} alt={userName} className="w-full h-full object-cover rounded-full" /> : initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold truncate leading-none">{userName}</p>
                  <p className="eyebrow mt-0.5">My Profile</p>
                </div>
              </button>
              <button
                onClick={() => { setShowMoreMenu(false); handleLogout(); }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors"
                style={{ color: 'var(--coral)' }}
              >
                <LogOut className="w-5 h-5 shrink-0" />
                <span className="text-[14px] font-semibold">Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
