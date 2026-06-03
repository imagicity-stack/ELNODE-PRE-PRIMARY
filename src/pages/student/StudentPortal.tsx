import { Routes, Route, Navigate } from 'react-router-dom';
import StudentShell from '../../components/StudentShell';
import { UserProfile } from '../../types';
import StudentDashboard from './StudentDashboard';
import StudentHomework from './StudentHomework';
import StudentFees from './StudentFees';
import StudentTimetable from './StudentTimetable';
import StudentAttendance from './StudentAttendance';
import StudentLeaves from './StudentLeaves';
import StudentSubjects from './StudentSubjects';
import StudentNotes from './StudentNotes';
import ExtendedProfile from './ExtendedProfile';
import ResultView from '../shared/ResultView';
import AcademicCalendar from '../admin/AcademicCalendar';
import NoticeBoard from '../admin/NoticeBoard';
import LessonLogs from '../shared/LessonLogs';
import { useData } from '../../contexts/DataContext';

export default function StudentPortal({ user }: { user: UserProfile }) {
  const { studentData: student } = useData();

  return (
    <StudentShell user={user}>
      <Routes>
        <Route path="/" element={<StudentDashboard user={user} />} />
        <Route path="/homework" element={<StudentHomework user={user} />} />
        <Route path="/fees" element={<StudentFees user={user} />} />
        <Route path="/timetable" element={<StudentTimetable user={user} />} />
        <Route path="/attendance" element={<StudentAttendance user={user} />} />
        <Route path="/leaves" element={<StudentLeaves user={user} />} />
        <Route path="/subjects" element={<StudentSubjects user={user} />} />
        <Route path="/notes" element={<StudentNotes user={user} />} />
        <Route path="/profile" element={<ExtendedProfile user={user} student={student || null} />} />
        <Route path="/exams" element={student ? <ResultView student={student} /> : null} />
        <Route path="/calendar" element={<AcademicCalendar user={user} />} />
        <Route path="/notices" element={<NoticeBoard user={user} />} />
        <Route path="/diary" element={<LessonLogs user={user} student={student || undefined} />} />
        <Route path="*" element={<Navigate to="/student" />} />
      </Routes>
    </StudentShell>
  );
}
