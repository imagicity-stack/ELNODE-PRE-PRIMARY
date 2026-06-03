import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { Plus, Search, Edit2, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Subject, UserProfile } from '../../types';
import { logActivity } from '../../services/activityService';
import { usePermissions } from '../../hooks/usePermissions';
import { Modal, ConfirmModal, FormField, Input, Button } from '../../components/ui';

export default function SubjectManagement({ user }: { user: UserProfile }) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const { isReadOnly } = usePermissions(user.role);
  const readOnly = isReadOnly('subjects');

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    type: 'theory' as 'theory' | 'practical' | 'both',
  });

  const fetchSubjects = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'subjects'));
      const list = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Subject));
      setSubjects(list);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'subjects');
    }
  };

  useEffect(() => {
    fetchSubjects();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isEditMode && editingSubject) {
        await updateDoc(doc(db, 'subjects', editingSubject.id), formData);
      } else {
        await addDoc(collection(db, 'subjects'), formData);
        logActivity(
          user,
          'Subject Created',
          'Academic',
          `Created subject "${formData.name}" (${formData.code})`,
          { name: formData.name, code: formData.code, type: formData.type }
        );
      }
      setIsModalOpen(false);
      setIsEditMode(false);
      setEditingSubject(null);
      fetchSubjects();
      setFormData({ name: '', code: '', type: 'theory' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, isEditMode ? `subjects/${editingSubject?.id}` : 'subjects');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (subject: Subject) => {
    setEditingSubject(subject);
    setIsEditMode(true);
    setFormData({
      name: subject.name,
      code: subject.code,
      type: subject.type || 'theory',
    });
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
    setIsDeleteModalOpen(true);
  };

  const performDelete = async () => {
    if (!deletingId) return;
    try {
      const deleted = subjects.find(s => s.id === deletingId);
      await deleteDoc(doc(db, 'subjects', deletingId));
      logActivity(
        user,
        'Subject Deleted',
        'Academic',
        `Deleted subject "${deleted?.name || deletingId}"`,
        { subjectId: deletingId, name: deleted?.name, code: deleted?.code }
      );
      fetchSubjects();
      setIsDeleteModalOpen(false);
      setDeletingId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `subjects/${deletingId}`);
    }
  };

  const filteredSubjects = subjects.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.code.toLowerCase().includes(search.toLowerCase())
  );

  const openAdd = () => {
    setIsEditMode(false);
    setEditingSubject(null);
    setFormData({ name: '', code: '', type: 'theory' });
    setIsModalOpen(true);
  };

  const typeChipClass = (type: string) => {
    if (type === 'theory') return 'chip solid' ;
    if (type === 'practical') return 'chip';
    return 'chip';
  };

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">{subjects.length} subject{subjects.length !== 1 ? 's' : ''}</div>
          <h1>Subjects</h1>
        </div>
        {!readOnly && (
          <button className="btn accent" onClick={openAdd}>
            <Plus size={15} /> Add Subject
          </button>
        )}
      </div>

      <div className="pad stack">
        {/* Search */}
        <div className="card flex" style={{ gap: 10, padding: '10px 14px', alignItems: 'center' }}>
          <Search size={16} className="muted" style={{ flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search subjects..."
            style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, fontSize: 14, fontFamily: 'var(--body)', color: 'var(--ink)' }}
          />
        </div>

        {/* Two-up grid */}
        {filteredSubjects.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <p className="muted" style={{ fontSize: 14 }}>
              {search ? 'No subjects match your search.' : 'No subjects yet. Add one to get started.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {filteredSubjects.map(subject => (
              <div key={subject.id} className="card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', marginBottom: 4, wordBreak: 'break-word' }}>
                    {subject.name}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="mono tiny" style={{ color: 'var(--accent)' }}>{subject.code}</span>
                    <span className={subject.type === 'theory' ? 'chip solid' : 'chip'} style={{ fontSize: 11 }}>
                      {subject.type === 'practical' ? 'Practical' : subject.type === 'both' ? 'Theory + Practical' : 'Theory'}
                    </span>
                  </div>
                </div>
                {!readOnly && (
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button className="icon-btn" onClick={() => handleEdit(subject)} title="Edit">
                      <Edit2 size={14} />
                    </button>
                    <button className="icon-btn" onClick={() => handleDelete(subject.id)} title="Delete" style={{ color: 'var(--coral)' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
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
        title="Delete Subject?"
        message="This action cannot be undone. This subject will be removed from the repository."
      />

      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setIsEditMode(false); setEditingSubject(null); }}
        title={isEditMode ? 'Edit Subject' : 'New Subject'}
        subtitle="Define academic parameters"
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button form="subject-form" type="submit" loading={loading}>
              {isEditMode ? 'Update Subject' : 'Create Subject'}
            </Button>
          </div>
        }
      >
        <form id="subject-form" onSubmit={handleSubmit} className="space-y-4">
          <FormField label="Subject Name" required>
            <Input
              type="text"
              required
              placeholder="e.g. Mathematics"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </FormField>
          <FormField label="Subject Code" required>
            <Input
              type="text"
              required
              placeholder="e.g. MATH101"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
            />
          </FormField>
          <FormField label="Subject Type" required>
            <div className="grid grid-cols-3 gap-2">
              {(['theory', 'practical', 'both'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFormData({ ...formData, type })}
                  className={cn(
                    'py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide transition-all border-2',
                    formData.type === type
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                      : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300'
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
          </FormField>
        </form>
      </Modal>
    </>
  );
}
