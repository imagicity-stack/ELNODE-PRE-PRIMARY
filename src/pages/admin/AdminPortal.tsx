import { Routes, Route, Navigate } from 'react-router-dom';
import AdminShell from '../../components/AdminShell';
import { UserProfile } from '../../types';
import AdminDashboard from './AdminDashboard';
import StudentManagement from './StudentManagement';
import TeacherManagement from './TeacherManagement';
import ClassManagement from './ClassManagement';
import SubjectManagement from './SubjectManagement';
import HouseManagement from './HouseManagement';
import FeeStructure from './FeeStructure';
import LeaveManagement from './LeaveManagement';
import TeacherLeaveApproval from './TeacherLeaveApproval';
import StaffManagement from './StaffManagement';
import AdmissionManagement from './AdmissionManagement';
import ExamManagement from './ExamManagement';
import ResultEntry from '../teacher/ResultEntry';
import NoticeBoard from './NoticeBoard';
import LessonLogs from '../shared/LessonLogs';
import AcademicCalendar from './AcademicCalendar';
import GradingScaleManagement from './GradingScaleManagement';
import TimetableManagement from './TimetableManagement';
import ActivityTracker from './ActivityTracker';
import PayrollSettings from './PayrollSettings';
import FineSettings from './FineSettings';
import RolePermissionsManager from './RolePermissionsManager';
import DataImport from './DataImport';
import ExpenseManagement from '../accounts/ExpenseManagement';
import SalaryManagement from '../accounts/SalaryManagement';
import FinancialReports from '../accounts/FinancialReports';
import FeeCollection from '../accounts/FeeCollection';
import PaymentHistory from '../accounts/PaymentHistory';
import PaymentAnalytics from '../accounts/PaymentAnalytics';
import ProfileSettings from '../shared/ProfileSettings';
import SchoolSettings from './SchoolSettings';
import WhatsAppNotifications from './WhatsAppNotifications';
import NotificationManager from './NotificationManager';
import GrievanceTracker from '../grievance/GrievanceTracker';
import FeeFollowup from '../grievance/FeeFollowup';
import BroadcastCenter from '../grievance/BroadcastCenter';
import StudentProfileAnalytics from './StudentProfileAnalytics';

export default function AdminPortal({ user }: { user: UserProfile }) {
  return (
    <AdminShell user={user}>
      <Routes>
        <Route path="/" element={<AdminDashboard user={user} />} />
        <Route path="/students" element={<StudentManagement user={user} />} />
        <Route path="/teachers" element={<TeacherManagement user={user} />} />
        <Route path="/classes" element={<ClassManagement user={user} />} />
        <Route path="/subjects" element={<SubjectManagement user={user} />} />
        <Route path="/houses" element={<HouseManagement user={user} />} />
        <Route path="/fees" element={<FeeStructure user={user} />} />
        <Route path="/leaves" element={<LeaveManagement user={user} />} />
        <Route path="/teacher-leaves" element={<TeacherLeaveApproval user={user} />} />
        <Route path="/fee-collection" element={<FeeCollection user={user} />} />
        <Route path="/payment-history" element={<PaymentHistory user={user} />} />
        <Route path="/analytics" element={<PaymentAnalytics user={user} />} />
        <Route path="/expenses" element={<ExpenseManagement user={user} />} />
        <Route path="/salaries" element={<SalaryManagement user={user} />} />
        <Route path="/reports" element={<FinancialReports user={user} />} />
        <Route path="/staff" element={<StaffManagement user={user} />} />
        <Route path="/admissions" element={<AdmissionManagement user={user} />} />
        <Route path="/exams" element={<ExamManagement user={user} />} />
        <Route path="/exams/:examId/marks" element={<ResultEntry user={user} />} />
        <Route path="/timetable" element={<TimetableManagement user={user} />} />
        <Route path="/grading-scales" element={<GradingScaleManagement user={user} />} />
        <Route path="/notices" element={<NoticeBoard user={user} />} />
        <Route path="/notifications" element={<NotificationManager user={user} />} />
        <Route path="/payroll-settings" element={<PayrollSettings user={user} />} />
        <Route path="/fine-settings" element={<FineSettings user={user} />} />
        <Route path="/permissions" element={<RolePermissionsManager user={user} />} />
        <Route path="/school-settings" element={<SchoolSettings user={user} />} />
        <Route path="/whatsapp" element={<WhatsAppNotifications user={user} />} />
        <Route path="/diary" element={<LessonLogs user={user} />} />
        <Route path="/activity-logs" element={<ActivityTracker user={user} />} />
        <Route path="/data-import" element={<DataImport user={user} />} />
        <Route path="/calendar" element={<AcademicCalendar user={user} />} />
        <Route path="/tracker" element={<GrievanceTracker user={user} />} />
        <Route path="/fee-followup" element={<FeeFollowup user={user} />} />
        <Route path="/broadcast" element={<BroadcastCenter user={user} />} />
        <Route path="/profile" element={<ProfileSettings user={user} />} />
        <Route path="/student-profile-analytics" element={<StudentProfileAnalytics user={user} />} />
        <Route path="*" element={<Navigate to="/superadmin" />} />
      </Routes>
    </AdminShell>
  );
}
