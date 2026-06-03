import { useState, useEffect, useMemo } from 'react';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { Search, Plus, Trash2, Edit2, Users } from 'lucide-react';
import { Class, Student, UserProfile } from '../../types';
import { logActivity } from '../../services/activityService';
import { usePermissions } from '../../hooks/usePermissions';
import { Modal, ConfirmModal, FormField, Input, Button, Avatar } from '../../components/ui';

interface ViewingSection {
  classId: string;
  className: string;
  section: string;
  capacity: number;
}

export default function ClassManagement({ user }: { user: UserProfile }) {
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingClass, setEditingClass] = useState<Class | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [viewingSection, setViewingSection] = useState<ViewingSection | null>(null);

  const { isReadOnly } = usePermissions(user.role);
  const readOnly = isReadOnly('classes');

  const countStudents = (classId: string, section: string) =>
    students.filter(s => s.classId === classId && (s.section || 'A') === (section || 'A')).length;

  const rosterStudents = useMemo(() => {
    if (!viewingSection) return [];
    return students
      .filter(s => s.classId === viewingSection.classId && (s.section || 'A') === (viewingSection.section || 'A'))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [students, viewingSection]);

  const openRoster = (cls: Class, section: string, capacity: number) =>
    setViewingSection({ classId: cls.id, className: cls.name, section, capacity });

  const [formData, setFormData] = useState({
    name: '',
    sectionCount: 1,
    sections: [{ name: '', capacity: 40 }] as { name: string; capacity: number }[],
  });

  const fetchClasses = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'classes'));
      const list = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Class));
      setClasses(list);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'classes');
    }
  };

  const fetchStudents = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'students'));
      setStudents(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'students');
    }
  };

  useEffect(() => {
    fetchClasses();
    fetchStudents();
  }, []);

  const handleSectionCountChange = (count: number) => {
    const newCount = Math.max(1, count);
    const newSections = Array.from({ length: newCount }, (_, i) => {
      const name = newCount > 1 ? String.fromCharCode(65 + i) : '';
      return { name, capacity: formData.sections[i]?.capacity || 40 };
    });
    setFormData({ ...formData, sectionCount: newCount, sections: newSections });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const classData = {
        name: formData.name,
        sections: formData.sections,
        updatedAt: new Date().toISOString(),
      };
      if (isEditMode && editingClass) {
        await updateDoc(doc(db, 'classes', editingClass.id), classData);
        logActivity(user, 'Class Updated', 'Super Admin', `Updated class "${formData.name}" with ${formData.sections.length} section(s)`, { classId: editingClass.id, name: formData.name });
      } else {
        await addDoc(collection(db, 'classes'), classData);
        logActivity(user, 'Class Created', 'Super Admin', `Created class "${formData.name}" with ${formData.sections.length} section(s)`, { name: formData.name });
      }
      setIsModalOpen(false);
      setIsEditMode(false);
      setEditingClass(null);
      fetchClasses();
      setFormData({ name: '', sectionCount: 1, sections: [{ name: '', capacity: 40 }] });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, isEditMode ? `classes/${editingClass?.id}` : 'classes');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (cls: Class) => {
    setEditingClass(cls);
    setIsEditMode(true);
    setFormData({ name: cls.name, sectionCount: cls.sections.length, sections: cls.sections });
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
    setIsDeleteModalOpen(true);
  };

  const performDelete = async () => {
    if (!deletingId) return;
    try {
      const deletedClass = classes.find(c => c.id === deletingId);
      await deleteDoc(doc(db, 'classes', deletingId));
      fetchClasses();
      setIsDeleteModalOpen(false);
      setDeletingId(null);
      logActivity(user, 'Class Deleted', 'Super Admin', `Deleted class "${deletedClass?.name || deletingId}"`, { classId: deletingId });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `classes/${deletingId}`);
    }
  };

  const filteredClasses = classes.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const openAdd = () => {
    setIsEditMode(false);
    setEditingClass(null);
    setFormData({ name: '', sectionCount: 1, sections: [{ name: '', capacity: 40 }] });
    setIsModalOpen(true);
  };

  return (
    <>
      <div className="pad stack">
        {/* Topbar */}
        <div className="topbar">
          <div>
            <div className="eyebrow">{classes.length} {classes.length === 1 ? 'class' : 'classes'}</div>
            <h1>Classes</h1>
          </div>
          <div>
            {!readOnly && (
              <button className="btn accent" onClick={openAdd}>
                <Plus size={15} style={{ marginRight: 6 }} />
                Add Class
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="card flex" style={{ gap: 10, padding: '10px 14px', alignItems: 'center' }}>
          <Search size={16} className="muted" style={{ flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search classes…"
            style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, fontSize: 14, fontFamily: 'var(--body)', color: 'var(--ink)' }}
          />
        </div>

        {/* Grid */}
        {filteredClasses.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <p className="muted">No classes found.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {filteredClasses.map(cls => {
              const totalStudents = (cls.sections || []).reduce((sum, sec) => sum + countStudents(cls.id, sec.name), 0);
              const totalCapacity = (cls.sections || []).reduce((sum, sec) => sum + (sec.capacity || 0), 0);
              return (
                <div key={cls.id} className="card" style={{ padding: 20 }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <div className="eyebrow" style={{ marginBottom: 2 }}>
                        {(cls.sections || []).length} {(cls.sections || []).length === 1 ? 'section' : 'sections'}
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1 }}>
                        Class {cls.name}
                      </div>
                    </div>
                    {!readOnly && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="icon-btn" onClick={() => handleEdit(cls)} title="Edit">
                          <Edit2 size={14} />
                        </button>
                        <button className="icon-btn" onClick={() => handleDelete(cls.id)} title="Delete" style={{ color: 'var(--coral)' }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Student count */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                    <Users size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                      <strong>{totalStudents}</strong>
                      <span className="muted"> / {totalCapacity} students</span>
                    </span>
                  </div>

                  {/* Section chips */}
                  {(cls.sections || []).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {cls.sections.map((sec, idx) => {
                        const filled = countStudents(cls.id, sec.name);
                        return (
                          <button
                            key={idx}
                            className="chip"
                            onClick={() => openRoster(cls, sec.name, sec.capacity)}
                            style={{ cursor: 'pointer', fontSize: 12 }}
                          >
                            {sec.name || 'A'} · {filled}/{sec.capacity}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete confirm */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={performDelete}
        title="Delete Class?"
        message="This action cannot be undone. All sections in this class will be removed."
        loading={loading}
      />

      {/* Add / Edit modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={isEditMode ? 'Edit Class' : 'New Class'}
        subtitle="Define academic structure and section configuration"
        size="md"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button form="class-form" loading={loading}>{isEditMode ? 'Update Class' : 'Create Class'}</Button>
          </div>
        }
      >
        <form id="class-form" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <FormField label="Class Name / Grade" required>
                <Input required placeholder="e.g. 10 or X" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
              </FormField>
              <FormField label="Number of Sections">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => handleSectionCountChange(formData.sectionCount - 1)}
                    className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-xl font-bold hover:bg-slate-200 transition-all">−</button>
                  <span className="text-2xl font-bold text-slate-900 w-8 text-center">{formData.sectionCount}</span>
                  <button type="button" onClick={() => handleSectionCountChange(formData.sectionCount + 1)}
                    className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-xl font-bold hover:bg-slate-200 transition-all">+</button>
                </div>
              </FormField>
            </div>
            <FormField label="Section Capacities">
              <div className="space-y-2">
                {formData.sections.map((sec, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <span className="w-8 h-8 rounded-lg bg-white border border-violet-100 flex items-center justify-center text-xs font-bold text-violet-600 shrink-0">{sec.name || 'A'}</span>
                    <div className="flex-1">
                      <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-1">Capacity</p>
                      <Input type="number" required value={sec.capacity} onChange={e => { const s = [...formData.sections]; s[idx].capacity = Number(e.target.value); setFormData({ ...formData, sections: s }); }} />
                    </div>
                  </div>
                ))}
              </div>
            </FormField>
          </div>
        </form>
      </Modal>

      {/* Section Roster modal */}
      <Modal
        isOpen={!!viewingSection}
        onClose={() => setViewingSection(null)}
        title={viewingSection ? `Class ${viewingSection.className} · Section ${viewingSection.section || 'A'}` : ''}
        subtitle={viewingSection ? `${rosterStudents.length} of ${viewingSection.capacity} seats filled` : ''}
        size="md"
      >
        {viewingSection && (
          <div>
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-1">
                <span>Enrollment</span>
                <span className={rosterStudents.length >= viewingSection.capacity ? 'text-rose-500' : 'text-violet-600'}>
                  {rosterStudents.length}/{viewingSection.capacity}
                  {rosterStudents.length >= viewingSection.capacity && ' · Full'}
                </span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${rosterStudents.length >= viewingSection.capacity ? 'bg-rose-500' : 'bg-violet-500'}`}
                  style={{ width: `${Math.min(100, viewingSection.capacity > 0 ? (rosterStudents.length / viewingSection.capacity) * 100 : 0)}%` }}
                />
              </div>
            </div>
            {rosterStudents.length === 0 ? (
              <div className="py-10 text-center">
                <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-700">No students enrolled</p>
                <p className="text-xs text-slate-500 mt-1">No students are assigned to this section yet.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                {rosterStudents.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-3 p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 w-5 text-center shrink-0">{i + 1}</span>
                    <Avatar name={s.name} src={s.photoURL} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{s.name}</p>
                      <p className="text-[11px] text-slate-500 font-mono">{s.admissionNumber || s.schoolNumber}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
