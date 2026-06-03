import { Routes, Route, Navigate } from 'react-router-dom';
import ParentShell from '../../components/ParentShell';
import { db } from '../../firebase';
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { UserProfile, Student } from '../../types';
import ParentDashboard from './ParentDashboard';
import ParentFees from './ParentFees';
import ParentLeaves from './ParentLeaves';
import ParentAttendance from './ParentAttendance';
import ProfileSettings from '../shared/ProfileSettings';
import ParentTimetable from './ParentTimetable';
import ParentSubjects from './ParentSubjects';
import ResultView from '../shared/ResultView';
import AcademicCalendar from '../admin/AcademicCalendar';
import NoticeBoard from '../admin/NoticeBoard';
import LessonLogs from '../shared/LessonLogs';
import ParentGrievance from './ParentGrievance';
import ParentChildProfile from './ParentChildProfile';

export default function ParentPortal({ user }: { user: UserProfile }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStudents = async () => {
      if (user.studentIds && user.studentIds.length > 0) {
        const studentList: Student[] = [];
        for (const id of user.studentIds) {
          const studentDoc = await getDoc(doc(db, 'students', id));
          if (studentDoc.exists()) {
            studentList.push({ id: studentDoc.id, ...studentDoc.data() } as Student);
          }
        }
        setStudents(studentList);
        if (studentList.length > 0) {
          setSelectedStudent(studentList[0]);
        }
      }
      setLoading(false);
    };
    fetchStudents();
  }, [user.studentIds]);

  if (loading) {
    return (
      <div className="eh-app flex items-center justify-center h-screen" style={{ background: 'var(--cream)' }}>
        <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: 'var(--ink)' }} />
      </div>
    );
  }

  return (
    <ParentShell
      user={user}
      students={students}
      selectedStudent={selectedStudent}
      onSelectStudent={setSelectedStudent}
    >
      <Routes>
        <Route path="/" element={<ParentDashboard user={user} selectedStudent={selectedStudent} />} />
        <Route path="/fees" element={<ParentFees user={user} selectedStudent={selectedStudent} />} />
        <Route path="/leaves" element={<ParentLeaves user={user} selectedStudent={selectedStudent} />} />
        <Route path="/attendance" element={<ParentAttendance user={user} selectedStudent={selectedStudent} />} />
        <Route path="/timetable" element={<ParentTimetable user={user} selectedStudent={selectedStudent} />} />
        <Route path="/subjects" element={<ParentSubjects user={user} selectedStudent={selectedStudent} />} />
        <Route path="/profile" element={<ProfileSettings user={user} />} />
        <Route path="/exams" element={selectedStudent ? <ResultView student={selectedStudent} /> : null} />
        <Route path="/calendar" element={<AcademicCalendar user={user} />} />
        <Route path="/notices" element={<NoticeBoard user={user} />} />
        <Route path="/diary" element={<LessonLogs user={user} student={selectedStudent || undefined} />} />
        <Route path="/grievances" element={<ParentGrievance user={user} selectedStudent={selectedStudent} />} />
        <Route path="/child-profile" element={<ParentChildProfile user={user} selectedStudent={selectedStudent} />} />
        <Route path="*" element={<Navigate to="/parent" />} />
      </Routes>
    </ParentShell>
  );
}
