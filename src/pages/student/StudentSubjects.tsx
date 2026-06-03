import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { UserProfile, Subject, Timetable } from '../../types';
import { BookOpen } from 'lucide-react';

interface StudentSubjectsProps {
  user: UserProfile;
}

export default function StudentSubjects({ user }: StudentSubjectsProps) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSubjects = async () => {
      if (!user.classId) { setLoading(false); return; }
      setLoading(true);
      try {
        const q = query(collection(db, 'timetable'), where('classId', '==', user.classId));
        const ttSnap = await getDocs(q);

        const subjectIds = new Set<string>();
        ttSnap.docs.forEach(d => {
          const tt = d.data() as Timetable;
          tt.schedule?.forEach(day => {
            day.periods?.forEach(period => { if (period.subjectId) subjectIds.add(period.subjectId); });
          });
        });

        if (subjectIds.size === 0) {
          const allSubSnap = await getDocs(collection(db, 'subjects'));
          setSubjects(allSubSnap.docs.map(d => ({ id: d.id, ...d.data() } as Subject)));
        } else {
          const subjectList: Subject[] = [];
          for (const id of Array.from(subjectIds)) {
            const sDoc = await getDoc(doc(db, 'subjects', id));
            if (sDoc.exists()) subjectList.push({ id: sDoc.id, ...sDoc.data() } as Subject);
          }
          setSubjects(subjectList);
        }
      } catch (err) {
        console.error('Error fetching subjects:', err);
        handleFirestoreError(err, OperationType.LIST, 'subjects');
      } finally {
        setLoading(false);
      }
    };
    fetchSubjects();
  }, [user.classId]);

  return (
    <div className="pb-2">
      <div className="topbar">
        <div>
          <div className="eyebrow">{subjects.length} subject{subjects.length !== 1 ? 's' : ''}</div>
          <h1>Subjects</h1>
        </div>
      </div>

      <div className="pad" style={{ marginTop: 6 }}>
        {loading ? (
          <div className="card muted small" style={{ textAlign: 'center', padding: 24 }}>Loading…</div>
        ) : subjects.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 28 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--cream-2)', display: 'grid', placeItems: 'center', margin: '0 auto 10px' }}>
              <BookOpen size={22} className="muted" />
            </div>
            <div className="bold">No subjects assigned</div>
            <div className="small muted" style={{ marginTop: 2 }}>Your class has no subjects in the system yet.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {subjects.map((subject) => (
              <div key={subject.id} className="card" style={{ padding: 16 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--cream-2)', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
                  <BookOpen size={20} />
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.2 }}>{subject.name}</div>
                <div className="mono tiny" style={{ color: 'var(--ink-3)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{subject.code}</div>
                <span className="chip" style={{ marginTop: 10, padding: '2px 10px', fontSize: 10 }}>{subject.type || 'Theory'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ height: 16 }} />
    </div>
  );
}
