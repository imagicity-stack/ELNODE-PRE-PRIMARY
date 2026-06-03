import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { logActivity } from '../../services/activityService';
import { SchoolEvent, UserProfile } from '../../types';
import { usePermissions } from '../../hooks/usePermissions';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isSameMonth,
  isSameDay,
  addDays,
  parseISO
} from 'date-fns';
import { cn } from '../../lib/utils';
import {
  Button, Modal, ConfirmModal,
  FormField, Input, Select
} from '../../components/ui';

interface AcademicCalendarProps {
  user: UserProfile;
}

export default function AcademicCalendar({ user }: AcademicCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [events, setEvents] = useState<SchoolEvent[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const { isReadOnly } = usePermissions(user.role);
  const readOnly = isReadOnly('calendar');

  const isAdmin = user.role === 'super_admin' || user.role === 'principal';
  const canWrite = user.role === 'super_admin' || (user.role === 'principal' && !readOnly);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    type: 'event' as SchoolEvent['type'],
    startDate: '',
    endDate: '',
    allDay: true,
    location: '',
    color: 'indigo'
  });

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'events'));
      setEvents(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SchoolEvent)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'events');
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setLoading(true);
    try {
      const eventRef = await addDoc(collection(db, 'events'), {
        ...formData,
        createdBy: user.uid,
        createdAt: new Date().toISOString(),
      });
      logActivity(
        user,
        'Calendar Event Created',
        'Academic',
        `Created calendar event "${formData.title}" on ${formData.startDate}`,
        { eventId: eventRef.id, title: formData.title, type: formData.type, startDate: formData.startDate }
      );
      setIsModalOpen(false);
      fetchEvents();
      setFormData({ title: '', description: '', type: 'event', startDate: '', endDate: '', allDay: true, location: '', color: 'indigo' });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'events');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEvent = (id: string) => {
    if (!isAdmin) return;
    setDeletingId(id);
    setIsDeleteModalOpen(true);
  };

  const performDelete = async () => {
    if (!deletingId) return;
    try {
      const deletedEvent = events.find(e => e.id === deletingId);
      await deleteDoc(doc(db, 'events', deletingId));
      logActivity(
        user,
        'Calendar Event Deleted',
        'Academic',
        deletedEvent
          ? `Deleted calendar event "${deletedEvent.title}"`
          : `Deleted calendar event ${deletingId}`,
        { eventId: deletingId, title: deletedEvent?.title, type: deletedEvent?.type }
      );
      fetchEvents();
      setIsDeleteModalOpen(false);
      setDeletingId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `events/${deletingId}`);
    }
  };

  const eventDotColor = (type: string) => {
    if (type === 'holiday') return 'var(--coral)';
    if (type === 'exam') return 'var(--accent)';
    if (type === 'meeting') return 'var(--leaf)';
    return 'var(--ink)';
  };

  const eventTypeChipStyle = (type: string) => {
    const base = { fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 99, textTransform: 'capitalize' as const, display: 'inline-block' };
    if (type === 'holiday') return { ...base, background: 'color-mix(in srgb, var(--coral) 15%, transparent)', color: 'var(--coral)' };
    if (type === 'exam') return { ...base, background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)' };
    if (type === 'meeting') return { ...base, background: 'color-mix(in srgb, var(--leaf) 15%, transparent)', color: 'var(--leaf)' };
    return { ...base, background: 'var(--cream-2)', color: 'var(--ink)' };
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);

  const calRows: Date[][] = [];
  let day = calStart;
  while (day <= calEnd) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    calRows.push(week);
  }

  const upcomingEvents = events
    .filter(e => parseISO(e.startDate) >= new Date())
    .sort((a, b) => parseISO(a.startDate).getTime() - parseISO(b.startDate).getTime());

  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <>
      <div className="stack pad">
        <div className="topbar">
          <div>
            <div className="eyebrow">{format(currentMonth, 'MMMM yyyy')}</div>
            <h1>Calendar</h1>
          </div>
          {canWrite && (
            <div>
              <button className="btn accent" onClick={() => setIsModalOpen(true)}>
                <Plus style={{ width: 16, height: 16 }} /> Event
              </button>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.25rem' }}>
          <button className="icon-btn" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
            <ChevronLeft style={{ width: 18, height: 18 }} />
          </button>
          <span className="display" style={{ fontSize: '1.25rem', fontWeight: 700 }}>{format(currentMonth, 'MMMM yyyy')}</span>
          <button className="icon-btn" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
            <ChevronRight style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--line)' }}>
            {DAY_LABELS.map(d => (
              <div key={d} className="eyebrow" style={{ textAlign: 'center', padding: '0.5rem 0', fontSize: '0.65rem' }}>{d}</div>
            ))}
          </div>
          {calRows.map((week, wi) => (
            <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: wi < calRows.length - 1 ? '1px solid var(--line)' : undefined }}>
              {week.map((d) => {
                const dayEvents = events.filter(ev => isSameDay(parseISO(ev.startDate), d));
                const isToday = isSameDay(d, new Date());
                const inMonth = isSameMonth(d, currentMonth);
                return (
                  <div
                    key={d.toString()}
                    onClick={() => {
                      setSelectedDate(d);
                      setFormData(prev => ({ ...prev, startDate: format(d, 'yyyy-MM-dd') }));
                    }}
                    style={{
                      minHeight: 72,
                      padding: '0.375rem',
                      borderRight: '1px solid var(--line)',
                      opacity: inMonth ? 1 : 0.35,
                      cursor: 'pointer',
                      background: isToday ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
                    }}
                  >
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 24, height: 24, borderRadius: '50%', fontSize: '0.78rem', fontWeight: isToday ? 700 : 500,
                      background: isToday ? 'var(--accent)' : 'transparent',
                      color: isToday ? 'var(--paper)' : 'var(--ink)',
                    }}>
                      {format(d, 'd')}
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                      {dayEvents.map(ev => (
                        <span
                          key={ev.id}
                          title={ev.title}
                          onClick={(e) => { e.stopPropagation(); if (canWrite) handleDeleteEvent(ev.id); }}
                          style={{ width: 8, height: 8, borderRadius: '50%', background: eventDotColor(ev.type), cursor: canWrite ? 'pointer' : 'default', flexShrink: 0 }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {upcomingEvents.length > 0 && (
          <div className="stack">
            <div className="section-head">Upcoming Events</div>
            {upcomingEvents.map(event => (
              <div key={event.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
                  <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 42 }}>
                    <div className="eyebrow" style={{ fontSize: '0.6rem' }}>{format(parseISO(event.startDate), 'MMM')}</div>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', lineHeight: 1 }}>{format(parseISO(event.startDate), 'dd')}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={eventTypeChipStyle(event.type)}>{event.type}</span>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', marginTop: '0.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.title}</div>
                    {event.endDate && event.endDate !== event.startDate && (
                      <div className="muted" style={{ fontSize: '0.72rem' }}>
                        {format(parseISO(event.startDate), 'MMM d')} – {format(parseISO(event.endDate), 'MMM d, yyyy')}
                      </div>
                    )}
                  </div>
                </div>
                {canWrite && (
                  <button className="icon-btn" onClick={() => handleDeleteEvent(event.id)} title="Delete event">
                    <svg style={{ width: 14, height: 14, color: 'var(--coral)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={performDelete}
        title="Delete Event?"
        message="This action cannot be undone. This event will be removed from the calendar."
      />

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add New Event"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button form="event-form" type="submit" loading={loading} icon={Plus}>
              Add Event
            </Button>
          </div>
        }
      >
        <form id="event-form" onSubmit={handleCreateEvent} className="space-y-4">
          <FormField label="Event Title" required>
            <Input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g. Annual Sports Day"
            />
          </FormField>
          <FormField label="Type" required>
            <Select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
            >
              <option value="event">General Event</option>
              <option value="holiday">Holiday</option>
              <option value="exam">Examination</option>
              <option value="meeting">Meeting</option>
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Start Date" required>
              <Input
                type="date"
                required
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
              />
            </FormField>
            <FormField label="End Date" required>
              <Input
                type="date"
                required
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="Location">
            <Input
              type="text"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              placeholder="e.g. School Auditorium"
            />
          </FormField>
        </form>
      </Modal>
    </>
  );
}
