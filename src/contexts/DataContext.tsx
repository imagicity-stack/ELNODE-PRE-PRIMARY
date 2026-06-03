import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  doc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  orderBy, 
  limit 
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile, Teacher, Student, Notice, TimetableConfig, Timetable, Class } from '../types';
import { sortByClassName, sortByName } from '../lib/utils';

interface DataContextType {
  teacherData: Teacher | null;
  studentData: Student | null;
  notices: Notice[];
  timetableConfig: TimetableConfig | null;
  timetables: Timetable[];
  classes: Class[];
  students: Student[];
  teachers: Teacher[];
  classesMap: Record<string, string>;
  subjectsMap: Record<string, string>;
  teachersMap: Record<string, string>;
  loading: boolean;
  refreshGlobalData: () => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children, user }: { children: React.ReactNode, user: UserProfile | null }) {
  const [teacherData, setTeacherData] = useState<Teacher | null>(null);
  const [studentData, setStudentData] = useState<Student | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [timetableConfig, setTimetableConfig] = useState<TimetableConfig | null>(null);
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [classesMap, setClassesMap] = useState<Record<string, string>>({});
  const [subjectsMap, setSubjectsMap] = useState<Record<string, string>>({});
  const [teachersMap, setTeachersMap] = useState<Record<string, string>>({});
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setTeacherData(null);
      setStudentData(null);
      setTimetables([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribes: (() => void)[] = [];

    // Utility for safe listeners
    const safeOnSnapshot = (ref: any, onNext: (snap: any) => void, name: string, operationType: OperationType = OperationType.LIST) => {
      // Don't start listeners if auth is not ready
      if (!auth.currentUser) {
        console.warn(`Attempted to start listener for ${name} without currentUser. Skipping.`);
        return () => {};
      }

      return onSnapshot(ref, onNext, (err) => {
        // If we get a permission-denied error, it might be due to auth transition
        if (err.code === 'permission-denied') {
          console.warn(`Permission denied for ${name}. Auth state:`, auth.currentUser?.uid ? 'Logged in' : 'Not logged in');
          
          // Only report the error if we are genuinely supposed to be logged in
          if (auth.currentUser) {
            try {
              handleFirestoreError(err, operationType, name);
            } catch (e) {
              // Logged inside helper
            }
          }
        } else {
          console.error(`Listener error for ${name}:`, err);
        }

        // We don't block the whole app for one listener failure
        if (name === 'teacher' || name === 'student') {
          setLoading(false);
        }
      });
    };

    // 1. Listen for Timetable Settings (Global)
    const unsubTimetableConfig = safeOnSnapshot(doc(db, 'timetableSettings', 'global'), (doc) => {
      if (doc.exists()) {
        setTimetableConfig(doc.data() as TimetableConfig);
      }
    }, 'timetableSettings/global', OperationType.GET);
    unsubscribes.push(unsubTimetableConfig);

    // 2. Generic Mappings (Live Listeners) - Added slight delay to spread out requests
    setTimeout(() => {
      const unsubClasses = safeOnSnapshot(collection(db, 'classes'), (snapshot) => {
        const map: Record<string, string> = {};
        const list: Class[] = [];
        snapshot.docs.forEach(d => {
          map[d.id] = d.data().name;
          list.push({ id: d.id, ...d.data() } as Class);
        });
        setClassesMap(map);
        setClasses(sortByClassName(list));
      }, 'classes');
      unsubscribes.push(unsubClasses);

      const unsubTeachers = safeOnSnapshot(collection(db, 'teachers'), (snapshot) => {
        const map: Record<string, string> = {};
        const list: Teacher[] = [];
        snapshot.docs.forEach(d => {
          map[d.id] = d.data().name;
          list.push({ id: d.id, ...d.data() } as Teacher);
        });
        setTeachersMap(map);
        setTeachers(sortByName(list));
      }, 'teachers');
      unsubscribes.push(unsubTeachers);

      // Only roles with list permission on students collection
      if (user.role === 'admin' || user.role === 'accounts' || user.role === 'principal' || user.role === 'teacher') {
        const unsubStudents = safeOnSnapshot(collection(db, 'students'), (snapshot) => {
          setStudents(sortByName(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Student))));
        }, 'students');
        unsubscribes.push(unsubStudents);
      }

      const unsubSubjects = safeOnSnapshot(collection(db, 'subjects'), (snapshot) => {
        const map: Record<string, string> = {};
        snapshot.docs.forEach(d => map[d.id] = d.data().name);
        setSubjectsMap(map);
      }, 'subjects');
      unsubscribes.push(unsubSubjects);

      const unsubTimetables = safeOnSnapshot(collection(db, 'timetable'), (snapshot) => {
        setTimetables(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Timetable)));
      }, 'timetable');
      unsubscribes.push(unsubTimetables);
    }, 500);

    // 3. Role-specific Data Listeners
    if (user.role === 'teacher') {
      const teacherId = user.teacherId || user.uid;
      const unsubTeacher = safeOnSnapshot(doc(db, 'teachers', teacherId), (doc) => {
        if (doc.exists()) {
          setTeacherData({ id: doc.id, ...doc.data() } as Teacher);
        }
        setLoading(false);
      }, 'teachers/' + teacherId, OperationType.GET);
      unsubscribes.push(unsubTeacher);
    } 
    else if (user.role === 'student' || user.role === 'parent') {
      const studentId = user.studentId || (user.studentIds && user.studentIds[0]);
      if (studentId) {
        const unsubStudent = safeOnSnapshot(doc(db, 'students', studentId), (doc) => {
          if (doc.exists()) {
            setStudentData({ id: doc.id, ...doc.data() } as Student);
          }
          setLoading(false);
        }, 'students/' + studentId, OperationType.GET);
        unsubscribes.push(unsubStudent);
      } else {
        setLoading(false);
      }
    } else {
      setTimeout(() => setLoading(false), 1000); // Admin or other roles
    }

    // 4. Notices Listener (Common)
    setTimeout(() => {
      const noticesQuery = query(
        collection(db, 'notices'),
        where('targetRoles', 'array-contains', user.role === 'super_admin' ? 'admin' : user.role),
        orderBy('createdAt', 'desc'),
        limit(10)
      );
      const unsubNotices = safeOnSnapshot(noticesQuery, (snapshot) => {
        setNotices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notice)));
      }, 'notices');
      unsubscribes.push(unsubNotices);
    }, 1500);

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [user]);

  const refreshGlobalData = () => {
    // This could trigger manual re-fetches if needed, 
    // but onSnapshot handles most cases automatically
  };

  return (
    <DataContext.Provider value={{ 
      teacherData, 
      studentData, 
      notices, 
      timetableConfig, 
      timetables,
      classes,
      students,
      teachers,
      classesMap,
      subjectsMap,
      teachersMap,
      loading,
      refreshGlobalData 
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
}
