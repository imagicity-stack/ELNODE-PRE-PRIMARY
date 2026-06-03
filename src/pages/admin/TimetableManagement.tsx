import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, doc, query, where, addDoc, updateDoc, deleteDoc, getDoc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { Plus, Trash2, Settings, Save, Trash, Archive, History, AlertCircle } from 'lucide-react';
import { Modal, FormField, Input, Select, Button } from '../../components/ui';
import { logActivity } from '../../services/activityService';
import { Class, Subject, Teacher, Timetable, TimetableConfig, TimeSlot, UserProfile } from '../../types';
import { usePermissions } from '../../hooks/usePermissions';

export default function TimetableManagement({ user }: { user: UserProfile }) {
  const [classes, setClasses] = useState<Class[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [config, setConfig] = useState<TimetableConfig | null>(null);

  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedTimetable, setSelectedTimetable] = useState<Timetable | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [publishEffectiveFrom, setPublishEffectiveFrom] = useState<string>(new Date().toISOString().split('T')[0]);
  const [publishAcademicYear, setPublishAcademicYear] = useState<string>('');
  const [publishLoading, setPublishLoading] = useState(false);
  const [archiveDocs, setArchiveDocs] = useState<Timetable[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);

  const { isReadOnly } = usePermissions(user.role);
  const readOnly = isReadOnly('timetable');

  const [formData, setFormData] = useState({
    day: '',
    slotId: '',
    subjectId: '',
    teacherId: '',
    room: ''
  });

  const [configForm, setConfigForm] = useState<TimetableConfig>({
    id: 'global',
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    slots: [
      { id: '1', label: '1st Period', startTime: '08:30 AM', endTime: '09:30 AM', type: 'period' },
      { id: '2', label: '2nd Period', startTime: '09:30 AM', endTime: '10:30 AM', type: 'period' },
      { id: '3', label: 'Break', startTime: '10:30 AM', endTime: '11:00 AM', type: 'break' },
      { id: '4', label: '3rd Period', startTime: '11:00 AM', endTime: '12:00 PM', type: 'period' },
      { id: '5', label: '4th Period', startTime: '12:00 PM', endTime: '01:00 PM', type: 'period' },
      { id: '6', label: 'Lunch', startTime: '01:00 PM', endTime: '02:00 PM', type: 'lunch' },
      { id: '7', label: '5th Period', startTime: '02:00 PM', endTime: '03:00 PM', type: 'period' },
    ],
    updatedAt: new Date().toISOString()
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [classesSnap, subjectsSnap, teachersSnap, timetableSnap, configSnap] = await Promise.all([
          getDocs(collection(db, 'classes')),
          getDocs(collection(db, 'subjects')),
          getDocs(collection(db, 'teachers')),
          getDocs(collection(db, 'timetable')),
          getDoc(doc(db, 'timetableSettings', 'global'))
        ]);

        setClasses(classesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Class)));
        setSubjects(subjectsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Subject)));
        setTeachers(teachersSnap.docs.map(d => ({ id: d.id, ...d.data() } as Teacher)));
        setTimetables(timetableSnap.docs.map(d => ({ id: d.id, ...d.data() } as Timetable)));

        if (configSnap.exists()) {
          setConfig(configSnap.data() as TimetableConfig);
          setConfigForm(configSnap.data() as TimetableConfig);
        } else {
          await setDoc(doc(db, 'timetableSettings', 'global'), configForm);
          setConfig(configForm);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'timetable');
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    const tt = timetables.find(t => t.classId === selectedClassId);
    setSelectedTimetable(tt || null);
  }, [selectedClassId, timetables]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassId) return;

    setLoading(true);
    try {
      let updatedTimetable: Partial<Timetable>;

      if (selectedTimetable) {
        const newSchedule = [...selectedTimetable.schedule];
        let daySchedule = newSchedule.find(s => s.day === formData.day);

        if (!daySchedule) {
          daySchedule = { day: formData.day, periods: [] };
          newSchedule.push(daySchedule);
        }

        const periodIndex = daySchedule.periods.findIndex(p => p.slotId === formData.slotId);
        const newPeriod = {
          slotId: formData.slotId,
          subjectId: formData.subjectId,
          teacherId: formData.teacherId,
          room: formData.room
        };

        if (periodIndex >= 0) {
          daySchedule.periods[periodIndex] = newPeriod;
        } else {
          daySchedule.periods.push(newPeriod);
        }

        updatedTimetable = { schedule: newSchedule, updatedAt: new Date().toISOString() };
        await updateDoc(doc(db, 'timetable', selectedTimetable.id), updatedTimetable);
      } else {
        const newTT: Omit<Timetable, 'id'> = {
          classId: selectedClassId,
          schedule: [{
            day: formData.day,
            periods: [{
              slotId: formData.slotId,
              subjectId: formData.subjectId,
              teacherId: formData.teacherId,
              room: formData.room
            }]
          }],
          version: 1,
          effectiveFrom: new Date().toISOString().split('T')[0],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        } as any;
        await addDoc(collection(db, 'timetable'), newTT);
      }

      const snap = await getDocs(collection(db, 'timetable'));
      setTimetables(snap.docs.map(d => ({ id: d.id, ...d.data() } as Timetable)));

      const className = classes.find(c => c.id === selectedClassId)?.name || selectedClassId;
      const subjectName = subjects.find(s => s.id === formData.subjectId)?.name || formData.subjectId;
      const teacherName = teachers.find(t => t.id === formData.teacherId)?.name || formData.teacherId;
      const slotLabel = config?.slots.find(s => s.id === formData.slotId)?.label || formData.slotId;
      logActivity(
        user,
        'Timetable Slot Created',
        'Academic',
        `Class ${className} · ${formData.day} ${slotLabel} → ${subjectName} (${teacherName})`,
        { classId: selectedClassId, day: formData.day, slotId: formData.slotId, subjectId: formData.subjectId, teacherId: formData.teacherId }
      );

      setIsModalOpen(false);
      setFormData({ day: '', slotId: '', subjectId: '', teacherId: '', room: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'timetable');
    } finally {
      setLoading(false);
    }
  };

  const removePeriod = async (day: string, slotId: string) => {
    if (!selectedTimetable) return;

    try {
      const newSchedule = selectedTimetable.schedule.map(s => {
        if (s.day === day) {
          return { ...s, periods: s.periods.filter(p => p.slotId !== slotId) };
        }
        return s;
      }).filter(s => s.periods.length > 0);

      await updateDoc(doc(db, 'timetable', selectedTimetable.id), {
        schedule: newSchedule,
        updatedAt: new Date().toISOString()
      });

      const snap = await getDocs(collection(db, 'timetable'));
      setTimetables(snap.docs.map(d => ({ id: d.id, ...d.data() } as Timetable)));

      const className = classes.find(c => c.id === selectedTimetable.classId)?.name || selectedTimetable.classId;
      const slotLabel = config?.slots.find(s => s.id === slotId)?.label || slotId;
      logActivity(
        user,
        'Timetable Slot Deleted',
        'Academic',
        `Class ${className} · ${day} ${slotLabel} removed`,
        { classId: selectedTimetable.classId, day, slotId }
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'timetable');
    }
  };

  const getPeriod = (day: string, slotId: string) => {
    if (!selectedTimetable) return null;
    const daySchedule = selectedTimetable.schedule.find(s => s.day === day);
    return daySchedule?.periods.find(p => p.slotId === slotId);
  };

  const handlePublishNewVersion = async () => {
    if (!selectedTimetable || !selectedClassId) return;
    setPublishLoading(true);
    try {
      const effectiveFromIso = publishEffectiveFrom || new Date().toISOString().split('T')[0];
      const prevVersion = selectedTimetable.version || 1;
      const nextVersion = prevVersion + 1;

      const archivePayload: any = {
        classId: selectedTimetable.classId,
        schedule: selectedTimetable.schedule,
        academicYear: selectedTimetable.academicYear || publishAcademicYear || '',
        version: prevVersion,
        effectiveFrom: selectedTimetable.effectiveFrom || '',
        effectiveTo: effectiveFromIso,
        updatedAt: selectedTimetable.updatedAt,
        archivedAt: new Date().toISOString(),
        archivedBy: user.uid,
      };
      const archiveClean = JSON.parse(JSON.stringify(archivePayload));
      await addDoc(collection(db, 'timetableArchive'), archiveClean);

      await updateDoc(doc(db, 'timetable', selectedTimetable.id), {
        version: nextVersion,
        effectiveFrom: effectiveFromIso,
        academicYear: publishAcademicYear || selectedTimetable.academicYear || '',
        updatedAt: new Date().toISOString(),
      });

      const snap = await getDocs(collection(db, 'timetable'));
      setTimetables(snap.docs.map(d => ({ id: d.id, ...d.data() } as Timetable)));

      logActivity(
        user,
        'Published Timetable Version',
        'Academic',
        `Class ${classes.find(c => c.id === selectedClassId)?.name || selectedClassId} → v${nextVersion} (effective ${effectiveFromIso})`,
        { classId: selectedClassId, version: nextVersion, effectiveFrom: effectiveFromIso }
      );

      setIsPublishModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'timetable');
    } finally {
      setPublishLoading(false);
    }
  };

  const openHistory = async () => {
    if (!selectedClassId) return;
    setIsHistoryModalOpen(true);
    setHistoryLoading(true);
    try {
      const q = query(collection(db, 'timetableArchive'), where('classId', '==', selectedClassId));
      const snap = await getDocs(q);
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as Timetable));
      docs.sort((a, b) => (b.version || 0) - (a.version || 0));
      setArchiveDocs(docs);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'timetableArchive');
    } finally {
      setHistoryLoading(false);
    }
  };

  const saveConfig = async () => {
    setConfigLoading(true);
    try {
      const updatedConfig = { ...configForm, updatedAt: new Date().toISOString() };
      await setDoc(doc(db, 'timetableSettings', 'global'), updatedConfig);
      setConfig(updatedConfig);
      setIsConfigModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'timetableSettings');
    } finally {
      setConfigLoading(false);
    }
  };

  const addSlot = () => {
    const newSlot: TimeSlot = {
      id: Math.random().toString(36).substr(2, 9),
      label: 'New Slot',
      startTime: '08:00 AM',
      endTime: '09:00 AM',
      type: 'period'
    };
    setConfigForm({ ...configForm, slots: [...configForm.slots, newSlot] });
  };

  const removeSlot = (id: string) => {
    setConfigForm({ ...configForm, slots: configForm.slots.filter(s => s.id !== id) });
  };

  const updateSlot = (id: string, updates: Partial<TimeSlot>) => {
    setConfigForm({
      ...configForm,
      slots: configForm.slots.map(s => s.id === id ? { ...s, ...updates } : s)
    });
  };

  const filteredTeachers = useMemo(() => {
    if (!formData.subjectId) return [];
    return teachers.filter(t => t.subjects?.includes(formData.subjectId));
  }, [teachers, formData.subjectId]);

  const busyTeachers = useMemo(() => {
    if (!formData.day || !formData.slotId) return new Set<string>();
    const busy = new Set<string>();
    timetables.forEach(tt => {
      if (tt.classId !== selectedClassId) {
        const daySchedule = tt.schedule.find(s => s.day === formData.day);
        if (daySchedule) {
          const period = daySchedule.periods.find(p => p.slotId === formData.slotId);
          if (period?.teacherId) busy.add(period.teacherId);
        }
      }
    });
    return busy;
  }, [timetables, formData.day, formData.slotId, selectedClassId]);

  const handleSubjectChange = (subjectId: string) => {
    const isTeacherValid = teachers.some(t => t.id === formData.teacherId && t.subjects?.includes(subjectId));
    setFormData(prev => ({ ...prev, subjectId, teacherId: isTeacherValid ? prev.teacherId : '' }));
  };

  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const [selectedDay, setSelectedDay] = useState<string>(todayName);

  const activeDays = config?.days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const dayAbbr: Record<string, string> = {
    Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed',
    Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun'
  };

  const selectedClassName = classes.find(c => c.id === selectedClassId)?.name || '';

  return (
    <>
      {/* Topbar */}
      <div className="topbar pad">
        <div>
          <div className="eyebrow">{selectedClassId ? `Class ${selectedClassName}` : 'Select a class below'}</div>
          <h1>Timetable</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!readOnly && (
            <button
              className="icon-btn"
              title="Schedule Settings"
              onClick={() => setIsConfigModalOpen(true)}
            >
              <Settings size={16} />
            </button>
          )}
          {selectedTimetable && (
            <button
              className="icon-btn"
              title="Version History"
              onClick={openHistory}
            >
              <History size={16} />
            </button>
          )}
          {!readOnly && selectedTimetable && (
            <button
              className="btn ghost"
              style={{ fontSize: 13, padding: '8px 14px' }}
              onClick={() => {
                setPublishEffectiveFrom(new Date().toISOString().split('T')[0]);
                setPublishAcademicYear(selectedTimetable.academicYear || '');
                setIsPublishModalOpen(true);
              }}
            >
              <Archive size={14} style={{ marginRight: 6 }} />
              New Version
            </button>
          )}
          {!readOnly && selectedClassId && (
            <button
              className="btn accent"
              style={{ fontSize: 13, padding: '8px 14px' }}
              onClick={() => {
                setFormData({ ...formData, day: selectedDay || activeDays[0] || '', slotId: config?.slots[0]?.id || '' });
                setIsModalOpen(true);
              }}
            >
              <Plus size={14} style={{ marginRight: 6 }} />
              Add Period
            </button>
          )}
        </div>
      </div>

      {/* Class filter chips */}
      <div className="hscroll" style={{ paddingTop: 8, paddingBottom: 8 }}>
        {classes.map(c => (
          <button
            key={c.id}
            className={`chip${selectedClassId === c.id ? ' solid' : ''}`}
            onClick={() => setSelectedClassId(c.id)}
          >
            Class {c.name}
          </button>
        ))}
      </div>

      {/* Day pills */}
      {selectedClassId && config && (
        <div className="hscroll" style={{ paddingTop: 4, paddingBottom: 8 }}>
          {activeDays.map(day => {
            const isToday = day === todayName;
            const isOn = day === selectedDay;
            return (
              <button
                key={day}
                className={`dpill${isOn ? ' on' : ''}${isToday && !isOn ? ' today' : ''}`}
                style={{ textAlign: 'center' }}
                onClick={() => setSelectedDay(day)}
              >
                <div className="wd">{dayAbbr[day] || day.slice(0, 3)}</div>
                <div className="dn" style={{ fontSize: 13 }}>{day.slice(0, 1)}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div className="pad" style={{ paddingTop: 12 }}>
        {!selectedClassId ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 6 }}>No class selected</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Pick a class above to view its timetable</div>
          </div>
        ) : !config ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
            <span className="muted tiny">Loading configuration…</span>
          </div>
        ) : (
          <div className="stack">
            {config.slots.map(slot => {
              const isBreak = slot.type === 'break' || slot.type === 'lunch';
              const period = getPeriod(selectedDay, slot.id);
              const subject = subjects.find(s => s.id === period?.subjectId);
              const teacher = teachers.find(t => t.id === period?.teacherId);

              return (
                <div
                  key={slot.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '52px 1fr',
                    gap: 10,
                    alignItems: 'stretch',
                  }}
                >
                  {/* Time column */}
                  <div style={{ paddingTop: 4, textAlign: 'right' }}>
                    <div className="mono tiny muted" style={{ lineHeight: 1.2 }}>
                      {slot.startTime.replace(/\s?(AM|PM)$/, m => m.trim().toLowerCase())}
                    </div>
                  </div>

                  {/* Slot content */}
                  {isBreak ? (
                    <div
                      style={{
                        border: '1px dashed var(--line)',
                        borderRadius: 10,
                        padding: '8px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        background: 'var(--cream)',
                      }}
                    >
                      <span className="eyebrow" style={{ fontSize: 11 }}>{slot.label}</span>
                      <span className="muted tiny">{slot.startTime} – {slot.endTime}</span>
                    </div>
                  ) : period ? (
                    <div
                      className="card"
                      style={{
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>
                          {subject?.name || 'Unknown Subject'}
                        </div>
                        <div className="muted tiny" style={{ marginTop: 3 }}>
                          {teacher?.name || 'TBA'}
                          {period.room ? ` · ${period.room}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {subject?.code && (
                          <span className="chip" style={{ fontSize: 11, padding: '3px 8px' }}>
                            {subject.code}
                          </span>
                        )}
                        {!readOnly && (
                          <button
                            className="icon-btn"
                            style={{ width: 30, height: 30 }}
                            title="Remove period"
                            onClick={() => removePeriod(selectedDay, slot.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                        {!readOnly && (
                          <button
                            className="icon-btn"
                            style={{ width: 30, height: 30 }}
                            title="Edit period"
                            onClick={() => {
                              setFormData({
                                day: selectedDay,
                                slotId: slot.id,
                                subjectId: period.subjectId,
                                teacherId: period.teacherId,
                                room: period.room || ''
                              });
                              setIsModalOpen(true);
                            }}
                          >
                            <Settings size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    !readOnly ? (
                      <button
                        style={{
                          border: '1.5px dashed var(--line)',
                          borderRadius: 10,
                          padding: '12px 14px',
                          background: 'transparent',
                          cursor: 'pointer',
                          textAlign: 'left',
                          color: 'var(--ink-4)',
                          fontSize: 12,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          transition: 'border-color 0.15s, color 0.15s',
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--ink-3)';
                          (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-2)';
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line)';
                          (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-4)';
                        }}
                        onClick={() => {
                          setFormData({ day: selectedDay, slotId: slot.id, subjectId: '', teacherId: '', room: '' });
                          setIsModalOpen(true);
                        }}
                      >
                        <Plus size={13} />
                        <span>{slot.label} — assign subject</span>
                      </button>
                    ) : (
                      <div
                        style={{
                          border: '1.5px dashed var(--line-2)',
                          borderRadius: 10,
                          padding: '12px 14px',
                          color: 'var(--ink-4)',
                          fontSize: 12,
                        }}
                      >
                        {slot.label} — free
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Schedule Period Modal ── */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Schedule Period"
        subtitle={`${formData.day} at ${config?.slots.find(s => s.id === formData.slotId)?.startTime || 'TBA'}`}
        footer={
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button form="tt-form" loading={loading}>Save Period</Button>
          </div>
        }
      >
        <form id="tt-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Day">
              <Select
                value={formData.day}
                onChange={e => setFormData({ ...formData, day: e.target.value })}
              >
                {config?.days.map(d => <option key={d} value={d}>{d}</option>)}
              </Select>
            </FormField>
            <FormField label="Time Slot">
              <Select
                value={formData.slotId}
                onChange={e => setFormData({ ...formData, slotId: e.target.value })}
              >
                {config?.slots.filter(s => s.type === 'period').map(s => (
                  <option key={s.id} value={s.id}>{s.label} ({s.startTime})</option>
                ))}
              </Select>
            </FormField>
          </div>

          <FormField label="Subject" required>
            <Select
              required
              value={formData.subjectId}
              onChange={e => handleSubjectChange(e.target.value)}
            >
              <option value="">Select Subject</option>
              {subjects.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
              ))}
            </Select>
          </FormField>

          <FormField label="Teacher" required>
            <Select
              required
              disabled={!formData.subjectId}
              value={formData.teacherId}
              onChange={e => setFormData({ ...formData, teacherId: e.target.value })}
            >
              <option value="">{formData.subjectId ? 'Select Teacher' : 'Select Subject First'}</option>
              {filteredTeachers.map(t => {
                const isBusy = busyTeachers.has(t.id);
                return (
                  <option key={t.id} value={t.id} disabled={isBusy}>
                    {t.name} {isBusy ? '(Occupied)' : ''}
                  </option>
                );
              })}
            </Select>
          </FormField>

          <FormField label="Room / Location">
            <Input
              placeholder="e.g. Lab 1, Room 202"
              value={formData.room}
              onChange={e => setFormData({ ...formData, room: e.target.value })}
            />
          </FormField>
        </form>
      </Modal>

      {/* ── Schedule Settings Modal ── */}
      <Modal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        title="Schedule Configuration"
        subtitle="Manage school timings, periods and working days."
        size="xl"
        footer={
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setIsConfigModalOpen(false)}>Cancel</Button>
            <Button icon={Save} onClick={saveConfig} loading={configLoading}>Save Settings</Button>
          </div>
        }
      >
        <div className="space-y-6">
          <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
            <p className="text-sm text-blue-700 leading-relaxed">
              Define the structure of your school day. You can add periods, breaks, and lunch slots.
              Changes here will update the grid layout for all classes.
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">Time Slots</h4>
            <div className="grid grid-cols-12 gap-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2">
              <div className="col-span-3">Label</div>
              <div className="col-span-2">Start</div>
              <div className="col-span-2">End</div>
              <div className="col-span-3">Type</div>
              <div className="col-span-2">Action</div>
            </div>

            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {configForm.slots.map((slot) => (
                <div key={slot.id} className="grid grid-cols-12 gap-3 items-center p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-all">
                  <div className="col-span-3">
                    <Input
                      value={slot.label}
                      onChange={e => updateSlot(slot.id, { label: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      placeholder="08:00 AM"
                      value={slot.startTime}
                      onChange={e => updateSlot(slot.id, { startTime: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      placeholder="09:00 AM"
                      value={slot.endTime}
                      onChange={e => updateSlot(slot.id, { endTime: e.target.value })}
                    />
                  </div>
                  <div className="col-span-3">
                    <Select
                      value={slot.type}
                      onChange={e => updateSlot(slot.id, { type: e.target.value as any })}
                    >
                      <option value="period">Period</option>
                      <option value="break">Short Break</option>
                      <option value="lunch">Lunch Break</option>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <button
                      className="icon-btn"
                      style={{ background: 'var(--coral)', color: '#fff', border: 'none' }}
                      onClick={() => removeSlot(slot.id)}
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </div>
              ))}
              <button
                onClick={addSlot}
                className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 hover:text-blue-500 hover:border-blue-200 hover:bg-blue-50 transition-all text-xs font-bold"
              >
                + Add New Slot
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Publish New Version Modal ── */}
      <Modal
        isOpen={isPublishModalOpen}
        onClose={() => setIsPublishModalOpen(false)}
        title="Save as New Version"
        subtitle="Archive the current schedule and start a new version. Past lesson logs remain anchored to their original slots."
        footer={
          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => setIsPublishModalOpen(false)}>Cancel</Button>
            <Button icon={Archive} onClick={handlePublishNewVersion} loading={publishLoading}>Archive & Publish</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-800 flex gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">When should you use this?</p>
              <p className="mt-1 text-xs leading-relaxed">
                Use this for permanent restructures (new term, government rule change). For minor timing tweaks just edit the slots directly — old lesson logs already store their slot labels.
              </p>
            </div>
          </div>
          <FormField label="Effective from">
            <Input type="date" value={publishEffectiveFrom} onChange={e => setPublishEffectiveFrom(e.target.value)} />
          </FormField>
          <FormField label="Academic year">
            <Input placeholder="e.g. 2025-26" value={publishAcademicYear} onChange={e => setPublishAcademicYear(e.target.value)} />
          </FormField>
          <div className="text-xs text-slate-500">
            Current version: <span className="font-bold text-slate-700">v{selectedTimetable?.version || 1}</span>
            {' → '}
            New version: <span className="font-bold text-emerald-600">v{(selectedTimetable?.version || 1) + 1}</span>
          </div>
        </div>
      </Modal>

      {/* ── Version History Modal ── */}
      <Modal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        title="Timetable Version History"
        subtitle="Archived versions for the selected class."
        size="xl"
      >
        {historyLoading ? (
          <p className="text-center py-8 text-sm text-slate-500">Loading history…</p>
        ) : archiveDocs.length === 0 ? (
          <div className="py-12 text-center">
            <History className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-700">No archived versions yet</p>
            <p className="text-xs text-slate-500 mt-1">Publishing a new version archives the current one here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {archiveDocs.map(a => (
              <div key={a.id} className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-slate-900">Version {a.version || '?'}{a.academicYear ? ` · ${a.academicYear}` : ''}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {a.effectiveFrom ? `Effective ${a.effectiveFrom}` : 'Effective date n/a'}
                      {a.effectiveTo ? ` → ${a.effectiveTo}` : ''}
                    </p>
                  </div>
                  <span className="chip">Archived</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-2">
                  Archived {a.archivedAt ? new Date(a.archivedAt).toLocaleString() : ''} · {a.schedule?.length || 0} days configured
                </p>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
