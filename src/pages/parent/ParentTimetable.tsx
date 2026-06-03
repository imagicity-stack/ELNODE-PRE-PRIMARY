import { UserProfile, Student, Timetable, TimetableConfig } from '../../types';
import { useData } from '../../contexts/DataContext';
import { Calendar, User, MapPin, Clock, Users } from 'lucide-react';
import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { Spinner, EmptyState } from '../../components/ui';

interface ParentTimetableProps {
  user: UserProfile;
  selectedStudent: Student | null;
}

const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

export default function ParentTimetable({ user, selectedStudent }: ParentTimetableProps) {
  const { classesMap } = useData();
  const [timetable, setTimetable] = useState<Timetable | null>(null);
  const [config, setConfig] = useState<TimetableConfig | null>(null);
  const [subjects, setSubjects] = useState<Record<string, { name: string; code: string }>>({});
  const [teachers, setTeachers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState(todayName);

  useEffect(() => {
    const fetchData = async () => {
      if (!selectedStudent) return;
      setLoading(true);
      try {
        const configSnap = await getDoc(doc(db, 'timetableSettings', 'global')).catch(err => { handleFirestoreError(err, OperationType.GET, 'timetableSettings'); throw err; });
        if (configSnap.exists()) {
          const cfg = configSnap.data() as TimetableConfig;
          setConfig(cfg);
          if (cfg.days && !cfg.days.includes(activeDay)) {
            setActiveDay(cfg.days[0]);
          }
        }

        if (selectedStudent.classId) {
          const q = query(collection(db, 'timetable'), where('classId', '==', selectedStudent.classId));
          const snapshot = await getDocs(q).catch(err => { handleFirestoreError(err, OperationType.LIST, 'timetable'); throw err; });
          if (!snapshot.empty) {
            setTimetable({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Timetable);
          } else {
            setTimetable(null);
          }
        }

        const subSnap = await getDocs(collection(db, 'subjects')).catch(err => { handleFirestoreError(err, OperationType.LIST, 'subjects'); throw err; });
        const subMap: Record<string, { name: string; code: string }> = {};
        subSnap.docs.forEach(d => {
          const data = d.data();
          subMap[d.id] = { name: data.name, code: data.code };
        });
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
  }, [selectedStudent]);

  if (!selectedStudent) {
    return (
      <div className="pad">
        <EmptyState
          icon={Users}
          title="No Student Selected"
          description="Please select a student to view their timetable."
        />
      </div>
    );
  }

  const getPeriod = (day: string, slotId: string) => {
    if (!timetable) return null;
    const daySchedule = timetable.schedule.find(s => s.day === day);
    return daySchedule?.periods.find(p => p.slotId === slotId);
  };

  return (
    <div className="pad stack" style={{ '--stack-gap': '20px' } as React.CSSProperties}>
      {/* Topbar */}
      <div className="topbar">
        <div>
          <p className="eyebrow">{selectedStudent.name}</p>
          <h1 className="display" style={{ fontSize: 22 }}>Timetable</h1>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : !config ? (
        <EmptyState
          icon={Calendar}
          title="Settings Not Found"
          description="Timetable settings have not been configured by the administrator."
        />
      ) : !timetable ? (
        <EmptyState
          icon={Calendar}
          title="Timetable Not Found"
          description={`No timetable has been uploaded for ${classesMap[selectedStudent.classId] || selectedStudent.classId}.`}
        />
      ) : (
        <>
          {/* Day pills */}
          <div className="hscroll" style={{ gap: 8 }}>
            {config.days.map(day => {
              const isToday = day === todayName;
              const active = day === activeDay;
              return (
                <button
                  key={day}
                  onClick={() => setActiveDay(day)}
                  className={`dpill${active ? ' solid' : ''}${isToday && !active ? ' today' : ''}`}
                  style={{
                    flexShrink: 0,
                    padding: '6px 14px',
                    borderRadius: 99,
                    fontSize: 12,
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer',
                    background: active ? 'var(--ink)' : isToday ? 'var(--cream-2)' : 'var(--cream-2)',
                    color: active ? 'var(--cream)' : isToday ? 'var(--accent)' : 'var(--ink-2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {isToday && !active && (
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
                  )}
                  {day}
                </button>
              );
            })}
          </div>

          {/* Period timeline */}
          <div className="stack" style={{ '--stack-gap': '8px' } as React.CSSProperties}>
            {config.slots.map(slot => {
              if (slot.type === 'break') {
                return (
                  <div
                    key={slot.id}
                    className="flex items-center justify-between px-4 py-3 rounded-xl"
                    style={{ background: '#fef3c7', border: '1px solid #fde68a' }}
                  >
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#92400e' }}>{slot.label}</p>
                      <p style={{ fontSize: 10, color: '#d97706' }}>{slot.startTime} – {slot.endTime}</p>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, background: '#fde68a', color: '#92400e', padding: '2px 8px', borderRadius: 99 }}>Break</span>
                  </div>
                );
              }

              if (slot.type === 'lunch') {
                return (
                  <div
                    key={slot.id}
                    className="flex items-center justify-between px-4 py-3 rounded-xl"
                    style={{ background: '#d1fae5', border: '1px solid #a7f3d0' }}
                  >
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#065f46' }}>{slot.label}</p>
                      <p style={{ fontSize: 10, color: '#059669' }}>{slot.startTime} – {slot.endTime}</p>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, background: '#a7f3d0', color: '#065f46', padding: '2px 8px', borderRadius: 99 }}>Lunch</span>
                  </div>
                );
              }

              const period = getPeriod(activeDay, slot.id);
              const subject = period ? subjects[period.subjectId] : null;
              const teacherName = period ? teachers[period.teacherId] : null;

              if (!period) {
                return (
                  <div
                    key={slot.id}
                    className="flex items-center justify-between px-4 py-3 rounded-xl"
                    style={{ border: '1px dashed var(--line)' }}
                  >
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-4)' }}>{slot.label}</p>
                      <p style={{ fontSize: 10, color: 'var(--ink-4)' }}>{slot.startTime} – {slot.endTime}</p>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-4)' }}>Free Period</span>
                  </div>
                );
              }

              return (
                <div
                  key={slot.id}
                  className="card"
                  style={{
                    padding: '12px 16px',
                    borderLeft: '4px solid var(--ink)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                        {subject?.name || period.subjectId}
                      </p>
                      <div className="flex items-center gap-3" style={{ marginTop: 4 }}>
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3" style={{ color: 'var(--ink-3)' }} />
                          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{teacherName || 'TBA'}</span>
                        </div>
                        {period.room && (
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" style={{ color: 'var(--ink-3)' }} />
                            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Room {period.room}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-2)' }}>{slot.label}</p>
                      <p style={{ fontSize: 10, color: 'var(--ink-3)' }}>{slot.startTime}–{slot.endTime}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
