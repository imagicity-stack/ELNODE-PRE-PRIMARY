import { UserProfile, Timetable, TimetableConfig } from '../../types';
import { useData } from '../../contexts/DataContext';
import { MapPin, User } from 'lucide-react';
import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';

interface StudentTimetableProps {
  user: UserProfile;
}

const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

export default function StudentTimetable({ user }: StudentTimetableProps) {
  const { classesMap } = useData();
  const [timetable, setTimetable] = useState<Timetable | null>(null);
  const [config, setConfig] = useState<TimetableConfig | null>(null);
  const [subjects, setSubjects] = useState<Record<string, { name: string; code: string }>>({});
  const [teachers, setTeachers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [day, setDay] = useState(todayName);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const configSnap = await getDoc(doc(db, 'timetableSettings', 'global')).catch(err => { handleFirestoreError(err, OperationType.GET, 'timetableSettings'); throw err; });
        if (configSnap.exists()) {
          const cfg = configSnap.data() as TimetableConfig;
          setConfig(cfg);
          if (cfg.days && !cfg.days.includes(day)) setDay(cfg.days[0]);
        }

        if (user.classId) {
          const q = query(collection(db, 'timetable'), where('classId', '==', user.classId));
          const snapshot = await getDocs(q).catch(err => { handleFirestoreError(err, OperationType.LIST, 'timetable'); throw err; });
          if (!snapshot.empty) setTimetable({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Timetable);
        }

        const subSnap = await getDocs(collection(db, 'subjects')).catch(err => { handleFirestoreError(err, OperationType.LIST, 'subjects'); throw err; });
        const subMap: Record<string, { name: string; code: string }> = {};
        subSnap.docs.forEach(d => { const data = d.data(); subMap[d.id] = { name: data.name, code: data.code }; });
        setSubjects(subMap);

        const teachSnap = await getDocs(collection(db, 'teachers')).catch(err => { handleFirestoreError(err, OperationType.LIST, 'teachers'); throw err; });
        const teachMap: Record<string, string> = {};
        teachSnap.docs.forEach(d => { teachMap[d.id] = d.data().name; });
        setTeachers(teachMap);
      } catch (err) {
        console.error('Error fetching timetable data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user.classId]);

  const getPeriod = (d: string, slotId: string) => {
    if (!timetable) return null;
    return timetable.schedule.find(s => s.day === d)?.periods.find(p => p.slotId === slotId) || null;
  };

  const className = `${classesMap[user.classId] || user.classId || ''}${user.section ? ` · ${user.section}` : ''}`;

  return (
    <div className="pb-2">
      <div className="topbar">
        <div>
          <div className="eyebrow">{className || 'Timetable'}</div>
          <h1>Schedule</h1>
        </div>
      </div>

      {/* Day pills */}
      {config && (
        <div className="hscroll" style={{ paddingTop: 4 }}>
          {config.days.map((d) => (
            <button key={d} className={'dpill' + (d === day ? ' on' : '') + (d === todayName ? ' today' : '')} onClick={() => setDay(d)} style={{ width: 56, minWidth: 56 }}>
              <span className="wd">{d === todayName ? 'Today' : 'Day'}</span>
              <span className="dn">{d.slice(0, 3)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Timeline */}
      <div className="pad stack" style={{ marginTop: 16 }}>
        {loading || !config ? (
          <div className="card muted small" style={{ textAlign: 'center', padding: 24 }}>Loading…</div>
        ) : (
          config.slots.map((slot) => {
            const isBreak = slot.type === 'break' || slot.type === 'lunch';
            const period = !isBreak ? getPeriod(day, slot.id) : null;
            const subject = period ? subjects[period.subjectId] : null;
            const teacherName = period ? teachers[period.teacherId] : null;

            return (
              <div key={slot.id} style={{ display: 'grid', gridTemplateColumns: '52px 1fr', gap: 12 }}>
                <div className="mono tiny" style={{ color: 'var(--ink-3)', paddingTop: 16, textAlign: 'right' }}>
                  {slot.startTime}<br /><span style={{ opacity: 0.5 }}>{slot.endTime}</span>
                </div>
                <div className="card" style={{
                  padding: '14px 16px', position: 'relative', overflow: 'hidden',
                  background: isBreak ? 'var(--cream-2)' : 'var(--paper)',
                  borderStyle: isBreak || (!period) ? 'dashed' : 'solid',
                }}>
                  {!isBreak && period && (
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'var(--ink)' }} />
                  )}
                  <div className="flex between center">
                    <div style={{ fontWeight: 600, fontSize: 15, color: isBreak || !period ? 'var(--ink-3)' : 'var(--ink)' }}>
                      {isBreak ? slot.label : (subject?.name || period?.subjectId || 'Free period')}
                    </div>
                    <span className="chip" style={{ padding: '2px 8px', fontSize: 10 }}>{slot.label}</span>
                  </div>
                  {!isBreak && period && (
                    <div className="flex" style={{ gap: 14, marginTop: 10 }}>
                      <span className="tiny muted flex center gap-8"><User size={12} /> {teacherName || 'TBA'}</span>
                      {period.room && <span className="tiny muted flex center gap-8"><MapPin size={12} /> Room {period.room}</span>}
                    </div>
                  )}
                  {isBreak && <div className="small muted" style={{ marginTop: 4 }}>{slot.startTime} – {slot.endTime}</div>}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ height: 16 }} />
    </div>
  );
}
