import { UserProfile, Student, Subject, Timetable } from '../../types';
import { useData } from '../../contexts/DataContext';
import { BookOpen, Users, Hash } from 'lucide-react';
import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { Spinner, EmptyState } from '../../components/ui';

interface ParentSubjectsProps {
  user: UserProfile;
  selectedStudent: Student | null;
}

export default function ParentSubjects({ user, selectedStudent }: ParentSubjectsProps) {
  const { classesMap } = useData();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSubjects = async () => {
      if (!selectedStudent) return;
      setLoading(true);
      try {
        const timetableQ = query(collection(db, 'timetable'), where('classId', '==', selectedStudent.classId));
        const ttSnap = await getDocs(timetableQ);

        let subjectIds: string[] = [];
        if (!ttSnap.empty) {
          const tt = ttSnap.docs[0].data() as Timetable;
          tt.schedule.forEach(day => {
            day.periods.forEach(p => {
              if (p.subjectId && !subjectIds.includes(p.subjectId)) {
                subjectIds.push(p.subjectId);
              }
            });
          });
        }

        if (subjectIds.length === 0) {
          const allSubSnap = await getDocs(collection(db, 'subjects'));
          setSubjects(allSubSnap.docs.map(d => ({ id: d.id, ...d.data() } as Subject)));
        } else {
          const subs: Subject[] = [];
          for (const id of subjectIds) {
            const sDoc = await getDoc(doc(db, 'subjects', id));
            if (sDoc.exists()) {
              subs.push({ id: sDoc.id, ...sDoc.data() } as Subject);
            }
          }
          setSubjects(subs);
        }
      } catch (err) {
        console.error('Error fetching subjects:', err);
        handleFirestoreError(err, OperationType.LIST, 'subjects');
      } finally {
        setLoading(false);
      }
    };
    fetchSubjects();
  }, [selectedStudent]);

  if (!selectedStudent) {
    return (
      <div className="pad">
        <EmptyState
          icon={Users}
          title="No Student Selected"
          description="Please select a student to view their academic subjects."
        />
      </div>
    );
  }

  return (
    <div className="pad stack" style={{ '--stack-gap': '20px' } as React.CSSProperties}>
      {/* Topbar */}
      <div className="topbar">
        <div>
          <p className="eyebrow">{selectedStudent.name} · {classesMap[selectedStudent.classId] || selectedStudent.classId}</p>
          <h1 className="display" style={{ fontSize: 22 }}>Subjects</h1>
        </div>
        <span
          className="chip"
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '4px 12px',
            borderRadius: 99,
            background: 'var(--cream-2)',
            color: 'var(--ink-2)',
          }}
        >
          {subjects.length} total
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : subjects.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No subjects assigned"
          description="This class doesn't have any subjects assigned in the system yet."
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {subjects.map(subject => (
            <div
              key={subject.id}
              className="card"
              style={{ padding: 16 }}
            >
              <div
                className="flex items-center justify-center"
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: 'var(--cream-2)',
                  marginBottom: 12,
                }}
              >
                <BookOpen className="w-5 h-5" style={{ color: 'var(--ink)' }} />
              </div>
              <p style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>{subject.name}</p>
              <div className="flex items-center gap-1" style={{ marginTop: 4 }}>
                <Hash className="w-3 h-3" style={{ color: 'var(--ink-3)' }} />
                <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase' }}>
                  {subject.code}
                </span>
              </div>
              <div style={{ marginTop: 8 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 99,
                    background: subject.type === 'theory' ? '#dbeafe' : '#d1fae5',
                    color: subject.type === 'theory' ? '#1e40af' : '#065f46',
                    textTransform: 'capitalize',
                  }}
                >
                  {subject.type || 'Theory'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
