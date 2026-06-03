import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { auth } from '../firebase';
import { signOut } from 'firebase/auth';
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  BookOpen,
  Calendar,
  CreditCard,
  ClipboardCheck,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
  Bell,
  Search,
  User,
  Home,
  CheckSquare,
  Wallet,
  Clock,
  Briefcase,
  UserPlus,
  Megaphone,
  LayoutGrid,
  DollarSign,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Shield,
  ShieldCheck,
  History as HistoryIcon,
  Settings2,
  MessageSquare,
  IndianRupee,
  CalendarDays,
  BarChart3,
  Banknote,
  SlidersHorizontal,
  AlertTriangle,
  Cpu,
  BadgePercent,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { APP_NAME, SCHOOL_NAME, APP_LOGO } from '../constants';
import { UserRole, UserProfile } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { requestNotificationPermission, startNotificationListeners } from '../services/notificationService';
import NotificationCenter from './NotificationCenter';
import { useToast } from './Toast';
import { usePermissions } from '../hooks/usePermissions';
import { logActivity } from '../services/activityService';
import { ActivitySection } from '../types';

const roleToSection = (role: string): ActivitySection => {
  switch (role) {
    case 'super_admin': return 'Super Admin';
    case 'accountant':
    case 'accounts': return 'Accounts';
    case 'teacher': return 'Teachers';
    case 'student': return 'Students';
    case 'parent': return 'Parents';
    case 'principal': return 'Principal';
    case 'grievance_officer': return 'Super Admin';
    default: return 'Staff';
  }
};

// ─── Role Configuration ───────────────────────────────────────────────────────

const roleConfig: Record<UserRole, {
  label: string;
  accent: string;
  accentLight: string;
  accentText: string;
  accentBorder: string;
  gradient: string;
}> = {
  super_admin: {
    label: 'Admin Portal',
    accent: 'bg-indigo-500',
    accentLight: 'bg-indigo-500/15',
    accentText: 'text-indigo-400',
    accentBorder: 'border-indigo-500/30',
    gradient: 'from-indigo-600 to-violet-600',
  },
  teacher: {
    label: 'Teacher Portal',
    accent: 'bg-blue-500',
    accentLight: 'bg-blue-500/15',
    accentText: 'text-blue-400',
    accentBorder: 'border-blue-500/30',
    gradient: 'from-blue-600 to-sky-500',
  },
  student: {
    label: 'Student Portal',
    accent: 'bg-emerald-500',
    accentLight: 'bg-emerald-500/15',
    accentText: 'text-emerald-400',
    accentBorder: 'border-emerald-500/30',
    gradient: 'from-emerald-600 to-teal-500',
  },
  parent: {
    label: 'Parent Portal',
    accent: 'bg-violet-500',
    accentLight: 'bg-violet-500/15',
    accentText: 'text-violet-400',
    accentBorder: 'border-violet-500/30',
    gradient: 'from-violet-600 to-purple-600',
  },
  accounts: {
    label: 'Accounts Portal',
    accent: 'bg-amber-500',
    accentLight: 'bg-amber-500/15',
    accentText: 'text-amber-400',
    accentBorder: 'border-amber-500/30',
    gradient: 'from-amber-500 to-orange-500',
  },
  principal: {
    label: 'Principal Portal',
    accent: 'bg-rose-500',
    accentLight: 'bg-rose-500/15',
    accentText: 'text-rose-400',
    accentBorder: 'border-rose-500/30',
    gradient: 'from-rose-600 to-pink-600',
  },
  office_staff: {
    label: 'Staff Portal',
    accent: 'bg-cyan-500',
    accentLight: 'bg-cyan-500/15',
    accentText: 'text-cyan-400',
    accentBorder: 'border-cyan-500/30',
    gradient: 'from-cyan-600 to-blue-600',
  },
  grievance_officer: {
    label: 'Grievance Portal',
    accent: 'bg-teal-500',
    accentLight: 'bg-teal-500/15',
    accentText: 'text-teal-400',
    accentBorder: 'border-teal-500/30',
    gradient: 'from-teal-600 to-emerald-600',
  },
};

// ─── Nav Items ────────────────────────────────────────────────────────────────

// Section display order for super_admin and principal
const ADMIN_SECTION_ORDER = [
  'Overview', 'People', 'Academic', 'Attendance & Leaves',
  'Finance', 'Communication', 'Grievance', 'System',
];

interface NavItem {
  label: string;
  icon: any;
  path: string;
  roles: UserRole[];
  section?: string;
  moduleId?: string;
  profileItem?: boolean; // pinned to sidebar footer, not in scroll nav
}

const navItems: NavItem[] = [
  // ── Overview ──────────────────────────────────────────────────────────────
  { label: 'Dashboard', icon: LayoutGrid, path: '', roles: ['super_admin', 'accounts', 'teacher', 'student', 'parent', 'principal', 'office_staff'], section: 'Overview', moduleId: 'dashboard' },

  // ── People ────────────────────────────────────────────────────────────────
  { label: 'Students', icon: Users, path: '/students', roles: ['super_admin', 'principal', 'office_staff'], section: 'People', moduleId: 'students' },
  { label: 'Faculty', icon: Briefcase, path: '/teachers', roles: ['super_admin', 'principal', 'office_staff'], section: 'People', moduleId: 'teachers' },
  { label: 'Staff', icon: Shield, path: '/staff', roles: ['super_admin', 'principal', 'office_staff'], section: 'People', moduleId: 'staff' },
  { label: 'Admissions', icon: UserPlus, path: '/admissions', roles: ['super_admin', 'principal', 'office_staff'], section: 'People', moduleId: 'admissions' },

  // ── Academic ──────────────────────────────────────────────────────────────
  { label: 'Classes', icon: GraduationCap, path: '/classes', roles: ['super_admin', 'principal', 'office_staff'], section: 'Academic', moduleId: 'classes' },
  { label: 'Subjects', icon: BookOpen, path: '/subjects', roles: ['super_admin', 'principal', 'office_staff'], section: 'Academic', moduleId: 'subjects' },
  { label: 'Houses', icon: Home, path: '/houses', roles: ['super_admin', 'principal', 'office_staff'], section: 'Academic', moduleId: 'houses' },
  { label: 'Timetable', icon: CalendarDays, path: '/timetable', roles: ['super_admin', 'principal', 'office_staff'], section: 'Academic', moduleId: 'timetable' },
  { label: 'Exams', icon: FileText, path: '/exams', roles: ['super_admin', 'principal', 'office_staff'], section: 'Academic', moduleId: 'exams' },
  { label: 'Grading', icon: CheckSquare, path: '/grading-scales', roles: ['super_admin', 'principal', 'office_staff'], section: 'Academic', moduleId: 'grading-scales' },
  { label: 'Calendar', icon: Calendar, path: '/calendar', roles: ['super_admin', 'principal', 'office_staff'], section: 'Academic', moduleId: 'calendar' },

  // ── Attendance & Leaves ───────────────────────────────────────────────────
  { label: 'Student Leaves', icon: ClipboardCheck, path: '/leaves', roles: ['super_admin', 'principal', 'office_staff'], section: 'Attendance & Leaves', moduleId: 'leaves' },
  { label: 'Teacher Leaves', icon: ClipboardCheck, path: '/teacher-leaves', roles: ['super_admin', 'principal'], section: 'Attendance & Leaves', moduleId: 'teacher-leaves' },
  { label: 'Class Diary', icon: BookOpen, path: '/diary', roles: ['super_admin', 'principal', 'office_staff'], section: 'Attendance & Leaves', moduleId: 'diary' },

  // ── Finance (admin + accounts) ────────────────────────────────────────────
  { label: 'Fee Structure', icon: SlidersHorizontal, path: '/fees', roles: ['super_admin'], section: 'Finance' },
  { label: 'Fee Collection', icon: Wallet, path: '/fee-collection', roles: ['super_admin', 'accounts'], section: 'Finance' },
  { label: 'Payment History', icon: HistoryIcon, path: '/payment-history', roles: ['super_admin', 'accounts'], section: 'Finance' },
  { label: 'Analytics', icon: BarChart3, path: '/analytics', roles: ['super_admin', 'accounts'], section: 'Finance' },
  { label: 'Expenses', icon: CreditCard, path: '/expenses', roles: ['super_admin', 'accounts'], section: 'Finance' },
  { label: 'Salaries', icon: Banknote, path: '/salaries', roles: ['super_admin', 'accounts'], section: 'Finance' },
  { label: 'Fine Management', icon: BadgePercent, path: '/fine-settings', roles: ['super_admin'], section: 'Finance' },
  { label: 'Payroll Settings', icon: Settings, path: '/payroll-settings', roles: ['super_admin'], section: 'Finance' },
  { label: 'Reports', icon: TrendingUp, path: '/reports', roles: ['super_admin', 'accounts'], section: 'Finance' },

  // ── Communication ─────────────────────────────────────────────────────────
  { label: 'Notices', icon: Megaphone, path: '/notices', roles: ['super_admin', 'principal', 'office_staff'], section: 'Communication', moduleId: 'notices' },
  { label: 'Notifications', icon: Bell, path: '/notifications', roles: ['super_admin', 'principal'], section: 'Communication' },
  { label: 'Broadcast', icon: LayoutDashboard, path: '/broadcast', roles: ['super_admin', 'grievance_officer'], section: 'Communication' },
  { label: 'WhatsApp', icon: MessageSquare, path: '/whatsapp', roles: ['super_admin', 'accounts'], section: 'Communication' },

  // ── Grievance ─────────────────────────────────────────────────────────────
  { label: 'Grievances', icon: AlertTriangle, path: '/tracker', roles: ['super_admin', 'principal', 'grievance_officer'], section: 'Grievance' },
  { label: 'Fee Follow-up', icon: Wallet, path: '/fee-followup', roles: ['super_admin', 'grievance_officer'], section: 'Grievance' },

  // ── System (super admin only) ─────────────────────────────────────────────
  { label: 'School Settings', icon: Settings2, path: '/school-settings', roles: ['super_admin'], section: 'System' },
  { label: 'Role Permissions', icon: ShieldCheck, path: '/permissions', roles: ['super_admin'], section: 'System' },
  { label: 'Activity Logs', icon: HistoryIcon, path: '/activity-logs', roles: ['super_admin', 'principal'], section: 'System', moduleId: 'activity-logs' },

  // ── Profile (pinned to sidebar bottom — not in scroll nav) ────────────────
  { label: 'Profile', icon: User, path: '/profile', roles: ['super_admin', 'accounts', 'teacher', 'student', 'parent', 'principal', 'grievance_officer'], profileItem: true },

  // ── Grievance officer dashboard ───────────────────────────────────────────
  { label: 'Dashboard', icon: LayoutGrid, path: '', roles: ['grievance_officer'], section: 'Overview' },

  // ── Teacher ───────────────────────────────────────────────────────────────
  { label: 'My Classes', icon: GraduationCap, path: '/classes', roles: ['teacher'], section: 'Academic' },
  { label: 'Attendance', icon: ClipboardCheck, path: '/attendance', roles: ['teacher'], section: 'Academic' },
  { label: 'Timetable', icon: CalendarDays, path: '/timetable', roles: ['teacher'], section: 'Academic' },
  { label: 'Class Diary', icon: BookOpen, path: '/diary', roles: ['teacher'], section: 'Academic' },
  { label: 'Study Materials', icon: BookOpen, path: '/notes', roles: ['teacher'], section: 'Academic' },
  { label: 'Exams', icon: FileText, path: '/exams', roles: ['teacher'], section: 'Academic' },
  { label: 'My Leaves', icon: ClipboardCheck, path: '/leaves', roles: ['teacher'], section: 'Academic' },
  { label: 'Calendar', icon: Calendar, path: '/calendar', roles: ['teacher'], section: 'Academic' },
  { label: 'Notices', icon: Megaphone, path: '/notices', roles: ['teacher'], section: 'Communication' },

  // ── Student ───────────────────────────────────────────────────────────────
  { label: 'My Subjects', icon: BookOpen, path: '/subjects', roles: ['student'], section: 'Academic' },
  { label: 'Attendance', icon: Clock, path: '/attendance', roles: ['student'], section: 'Academic' },
  { label: 'Timetable', icon: CalendarDays, path: '/timetable', roles: ['student'], section: 'Academic' },
  { label: 'Leaves', icon: ClipboardCheck, path: '/leaves', roles: ['student'], section: 'Academic' },
  { label: 'Exams', icon: FileText, path: '/exams', roles: ['student'], section: 'Academic' },
  { label: 'Class Diary', icon: BookOpen, path: '/diary', roles: ['student'], section: 'Academic' },
  { label: 'Calendar', icon: Calendar, path: '/calendar', roles: ['student'], section: 'Academic' },
  { label: 'Fees', icon: Wallet, path: '/fees', roles: ['student'], section: 'Finance' },
  { label: 'Notices', icon: Megaphone, path: '/notices', roles: ['student'], section: 'Communication' },

  // ── Parent ────────────────────────────────────────────────────────────────
  { label: 'Attendance', icon: Clock, path: '/attendance', roles: ['parent'], section: 'My Child' },
  { label: 'Leaves', icon: ClipboardCheck, path: '/leaves', roles: ['parent'], section: 'My Child' },
  { label: 'Fees', icon: Wallet, path: '/fees', roles: ['parent'], section: 'My Child' },
  { label: 'Timetable', icon: CalendarDays, path: '/timetable', roles: ['parent'], section: 'Academic' },
  { label: 'Subjects', icon: BookOpen, path: '/subjects', roles: ['parent'], section: 'Academic' },
  { label: 'Class Diary', icon: BookOpen, path: '/diary', roles: ['parent'], section: 'Academic' },
  { label: 'Exams', icon: FileText, path: '/exams', roles: ['parent'], section: 'Academic' },
  { label: 'Calendar', icon: Calendar, path: '/calendar', roles: ['parent'], section: 'Academic' },
  { label: 'Notices', icon: Megaphone, path: '/notices', roles: ['parent'], section: 'Communication' },
  { label: 'Grievances', icon: AlertTriangle, path: '/grievances', roles: ['parent'], section: 'Communication' },
];

// ─── Component ───────────────────────────────────────────────────────────────

interface PortalLayoutProps {
  children: React.ReactNode;
  user: UserProfile;
  customHeader?: React.ReactNode;
}

export default function PortalLayout({ children, user, customHeader }: PortalLayoutProps) {
  const role = user.role;
  const userName = user.name || user.email || 'User';
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const config = roleConfig[role] || roleConfig.super_admin;
  const { canAccess, loading: permissionsLoading } = usePermissions(role);

  const filteredItems = navItems.filter(item => {
    const roleMatch = item.roles.includes(role);
    if (!roleMatch) return false;
    if (item.moduleId) {
      return canAccess(item.moduleId);
    }
    return true;
  });

  const profileItem = filteredItems.find(i => i.profileItem);
  const navOnlyItems = filteredItems.filter(i => !i.profileItem);

  const getPortalPath = (r: string) => {
    switch (r) {
      case 'super_admin': return '/superadmin';
      case 'office_staff': return '/staff';
      case 'principal': return '/principal';
      case 'teacher': return '/teacher';
      case 'student': return '/student';
      case 'parent': return '/parent';
      case 'accounts': return '/accounts';
      case 'grievance_officer': return '/grievance';
      default: return `/${r.replace('_', '')}`;
    }
  };

  const basePath = getPortalPath(role);
  const { showToast } = useToast();

  useEffect(() => {
    // Request permission and start listening
    const setupNotifications = async () => {
      // Permission request is optional, the listeners still work for UI toasts
      await requestNotificationPermission();
      
      if (auth.currentUser) {
        const studentId = (auth.currentUser as any).studentId || auth.currentUser.uid;

        // Resolve the user's class scope so diary notifications stay relevant.
        // Student: their own classId. Parent: fetch their children's classIds (one-shot).
        let classIds: string[] = [];
        try {
          if (role === 'student' && user.classId) {
            classIds = [user.classId];
          } else if (role === 'parent' && user.studentIds?.length) {
            const { getDoc, doc } = await import('firebase/firestore');
            const { db } = await import('../firebase');
            const docs = await Promise.all(
              user.studentIds.slice(0, 10).map(id => getDoc(doc(db, 'students', id)))
            );
            classIds = Array.from(new Set(
              docs.filter(d => d.exists()).map(d => (d.data() as any).classId).filter(Boolean)
            ));
          }
        } catch { /* non-fatal — listener will simply skip */ }

        const unsubscribe = startNotificationListeners(
          studentId,
          role,
          classIds,
          (title, body) => showToast(`${title}: ${body}`, 'info')
        );
        return unsubscribe;
      }
    };
    
    let unsubscribeFn: (() => void) | undefined;
    setupNotifications().then(unsub => {
      unsubscribeFn = unsub;
    });

    return () => {
      if (unsubscribeFn) unsubscribeFn();
    };
  }, [role]);

  const rawGroups = navOnlyItems.reduce((acc, item) => {
    const section = item.section || 'General';
    if (!acc[section]) acc[section] = [];
    acc[section].push(item);
    return acc;
  }, {} as Record<string, NavItem[]>);

  // For admin/principal roles, enforce canonical section order; others keep insertion order
  const isAdminRole = role === 'super_admin' || role === 'principal' || role === 'office_staff' || role === 'accounts';
  const groupedItems: Record<string, NavItem[]> = isAdminRole
    ? Object.fromEntries(
        ADMIN_SECTION_ORDER
          .filter(s => rawGroups[s])
          .map(s => [s, rawGroups[s]])
          .concat(Object.entries(rawGroups).filter(([s]) => !ADMIN_SECTION_ORDER.includes(s)))
      )
    : rawGroups;

  const handleLogout = async () => {
    try {
      const section = roleToSection(user.role);
      await logActivity(
        user,
        'User Logged Out',
        section,
        `${user.name} signed out of the ${section} portal`
      );
    } catch { /* non-fatal — proceed with sign out */ }
    await signOut(auth);
    navigate('/login');
  };

  const SidebarContent = () => (
    <div className="h-full flex flex-col">
      {/* Logo Header */}
      <div className={cn('flex items-center gap-3 p-5 border-b border-white/[0.06]', collapsed && 'lg:justify-center')}>
        <div className={cn(`w-9 h-9 rounded-xl bg-gradient-to-br ${config.gradient} flex items-center justify-center shadow-lg shrink-0`)}>
          <img src={APP_LOGO} className="w-6 h-6 object-contain" alt={APP_NAME} referrerPolicy="no-referrer" />
        </div>
        <AnimatePresence>
          {(!collapsed) && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              className="overflow-hidden"
            >
              <p className="text-white font-bold text-sm leading-none whitespace-nowrap">{APP_NAME}</p>
              <p className={cn('text-[10px] font-semibold mt-0.5 whitespace-nowrap', config.accentText)}>{SCHOOL_NAME}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mobile close */}
        <button onClick={() => setMobileOpen(false)} className="ml-auto p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 lg:hidden">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto scrollbar-hide space-y-5">
        {Object.entries(groupedItems).map(([section, items]) => (
          <div key={section}>
            {!collapsed && section !== 'General' && (
              <p className="px-3 mb-1.5 text-[9px] font-black text-slate-600 uppercase tracking-[0.18em]">
                {section}
              </p>
            )}
            {collapsed && <div className="mx-3 mb-1.5 h-px bg-white/[0.06]" />}
            <div className="space-y-0.5">
              {items.map((item) => {
                const fullPath = `${basePath}${item.path}`;
                const isActive = location.pathname === fullPath || (item.path === '' && location.pathname === basePath);
                return (
                  <Link
                    key={`${item.label}-${item.path}`}
                    to={fullPath}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-150 group relative',
                      collapsed && 'lg:justify-center',
                      isActive
                        ? cn('text-white', config.accentLight, 'sidebar-item-active')
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                    )}
                  >
                    <item.icon className={cn(
                      'w-[17px] h-[17px] shrink-0 transition-transform duration-150 group-hover:scale-110',
                      isActive ? config.accentText : ''
                    )} />
                    {!collapsed && (
                      <span className={cn('text-[13px] font-medium whitespace-nowrap', isActive ? 'text-white' : '')}>
                        {item.label}
                      </span>
                    )}
                    {isActive && !collapsed && (
                      <span className={cn('ml-auto w-1.5 h-1.5 rounded-full', config.accent)} />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer: Profile + Logout */}
      <div className="border-t border-white/[0.06] p-3 space-y-0.5">
        {/* Profile link */}
        {profileItem && (() => {
          const fullPath = `${basePath}${profileItem.path}`;
          const isActive = location.pathname === fullPath;
          return (
            <Link
              to={fullPath}
              onClick={() => setMobileOpen(false)}
              title={collapsed ? 'Profile' : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 group',
                collapsed && 'lg:justify-center',
                isActive ? cn('text-white', config.accentLight, 'sidebar-item-active') : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
              )}
            >
              <div className={cn(`w-7 h-7 rounded-lg bg-gradient-to-br ${config.gradient} flex items-center justify-center shrink-0 text-white font-bold text-xs shadow overflow-hidden`)}>
                {user.photoURL ? (
                  <img src={user.photoURL} alt={userName} className="w-full h-full object-cover" />
                ) : (
                  userName.charAt(0).toUpperCase()
                )}
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-semibold truncate leading-none', isActive ? 'text-white' : 'text-slate-300')}>{userName}</p>
                  <p className={cn('text-[10px] mt-0.5 font-medium capitalize', config.accentText)}>{role.replace('_', ' ')}</p>
                </div>
              )}
              {!collapsed && isActive && (
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', config.accent)} />
              )}
            </Link>
          );
        })()}

        {/* Sign Out */}
        <button
          onClick={handleLogout}
          title={collapsed ? 'Sign Out' : undefined}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150 group',
            collapsed && 'lg:justify-center'
          )}
        >
          <LogOut className="w-[18px] h-[18px] shrink-0 group-hover:-translate-x-0.5 transition-transform" />
          {!collapsed && <span className="text-sm font-medium">Sign Out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans">
      {/* Desktop Sidebar */}
      <aside className={cn(
        'hidden lg:flex flex-col fixed inset-y-0 left-0 z-30 bg-slate-900 transition-all duration-300 ease-in-out shrink-0',
        collapsed ? 'w-[72px]' : 'w-64'
      )}>
        <SidebarContent />

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 w-6 h-6 bg-slate-700 border border-slate-600 rounded-full flex items-center justify-center text-slate-300 hover:bg-slate-600 hover:text-white transition-all shadow-lg z-10"
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </aside>

      {/* Mobile Sidebar */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-40 lg:hidden"
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed inset-y-0 left-0 w-72 bg-slate-900 z-50 lg:hidden"
            >
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className={cn(
        'flex-1 flex flex-col min-w-0 transition-all duration-300',
        'lg:ml-64',
        collapsed && 'lg:ml-[72px]'
      )}>
        {/* Header */}
        <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-slate-100 px-6 h-16 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-all lg:hidden"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Search */}
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search..."
                className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {customHeader}

            {/* Notification center — bell, unread badge, and dropdown panel */}
            <NotificationCenter user={user} />

            <div className="h-7 w-px bg-slate-100 mx-1" />

            {/* User info */}
            <div className="flex items-center gap-3">
              <div className="hidden sm:block text-right">
                <p className="text-sm font-bold text-slate-900 leading-none">{userName}</p>
                <p className={cn('text-[10px] font-semibold mt-0.5 uppercase tracking-wider', config.accentText.replace('text-', 'text-').replace('400', '600'))}>
                  {role.replace('_', ' ')}
                </p>
              </div>
              <div className={cn(`w-9 h-9 rounded-xl bg-gradient-to-br ${config.gradient} flex items-center justify-center text-white font-bold text-sm shadow-sm overflow-hidden`)}>
                {user.photoURL ? (
                  <img src={user.photoURL} alt={userName} className="w-full h-full object-cover" />
                ) : (
                  userName.charAt(0).toUpperCase()
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
