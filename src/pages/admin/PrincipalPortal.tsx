import { Routes, Route, Navigate } from 'react-router-dom';
import PrincipalShell from '../../components/PrincipalShell';
import { UserProfile } from '../../types';
import PrincipalDashboard from './PrincipalDashboard';
import StudentManagement from './StudentManagement';
import TeacherManagement from './TeacherManagement';
import ClassManagement from './ClassManagement';
import SubjectManagement from './SubjectManagement';
import HouseManagement from './HouseManagement';
import StaffManagement from './StaffManagement';
import AdmissionManagement from './AdmissionManagement';
import ExamManagement from './ExamManagement';
import ResultEntry from '../teacher/ResultEntry';
import LeaveManagement from './LeaveManagement';
import TeacherLeaveApproval from './TeacherLeaveApproval';
import NoticeBoard from './NoticeBoard';
import LessonLogs from '../shared/LessonLogs';
import AcademicCalendar from './AcademicCalendar';
import GradingScaleManagement from './GradingScaleManagement';
import TimetableManagement from './TimetableManagement';
import ActivityTracker from './ActivityTracker';
import ProfileSettings from '../shared/ProfileSettings';
import GrievanceTracker from '../grievance/GrievanceTracker';

export default function PrincipalPortal({ user }: { user: UserProfile }) {
  return (
    <PrincipalShell user={user}>
      <Routes>
        <Route path="/" element={<PrincipalDashboard user={user} />} />
        <Route path="/students" element={<StudentManagement user={user} />} />
        <Route path="/teachers" element={<TeacherManagement user={user} />} />
        <Route path="/classes" element={<ClassManagement user={user} />} />
        <Route path="/subjects" element={<SubjectManagement user={user} />} />
        <Route path="/houses" element={<HouseManagement user={user} />} />
        <Route path="/staff" element={<StaffManagement user={user} />} />
        <Route path="/admissions" element={<AdmissionManagement user={user} />} />
        <Route path="/exams" element={<ExamManagement user={user} />} />
        <Route path="/exams/:examId/marks" element={<ResultEntry user={user} />} />
        <Route path="/leaves" element={<LeaveManagement user={user} />} />
        <Route path="/teacher-leaves" element={<TeacherLeaveApproval user={user} />} />
        <Route path="/timetable" element={<TimetableManagement user={user} />} />
        <Route path="/grading-scales" element={<GradingScaleManagement user={user} />} />
        <Route path="/notices" element={<NoticeBoard user={user} />} />
        <Route path="/diary" element={<LessonLogs user={user} />} />
        <Route path="/activity-logs" element={<ActivityTracker user={user} />} />
        <Route path="/calendar" element={<AcademicCalendar user={user} />} />
        <Route path="/tracker" element={<GrievanceTracker user={user} />} />
        <Route path="/profile" element={<ProfileSettings user={user} />} />
        <Route path="*" element={<Navigate to="/principal" />} />
      </Routes>
    </PrincipalShell>
  );
}
