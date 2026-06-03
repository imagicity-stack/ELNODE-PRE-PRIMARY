import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { Search, Plus, Trash2, Edit2 } from 'lucide-react';
import { House, Teacher, UserProfile } from '../../types';
import { logActivity } from '../../services/activityService';
import { usePermissions } from '../../hooks/usePermissions';
import { Modal, ConfirmModal, FormField, Input, Select, Button } from '../../components/ui';

export default function HouseManagement({ user }: { user: UserProfile }) {
  const [houses, setHouses] = useState<House[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingHouse, setEditingHouse] = useState<House | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const { isReadOnly } = usePermissions(user.role);
  const readOnly = isReadOnly('houses');

  const [formData, setFormData] = useState({
    name: '',
    color: '#4f46e5',
    teacherInchargeId: '',
  });

  const fetchData = async () => {
    try {
      const houseSnapshot = await getDocs(collection(db, 'houses'));
      setHouses(houseSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as House)));
      const teacherSnapshot = await getDocs(collection(db, 'teachers'));
      setTeachers(teacherSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Teacher)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'houses/teachers');
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const prevTeacherId = editingHouse?.teacherInchargeId || '';
      const newTeacherId = formData.teacherInchargeId;

      let houseId: string;
      if (isEditMode && editingHouse) {
        await updateDoc(doc(db, 'houses', editingHouse.id), formData);
        houseId = editingHouse.id;
      } else {
        const ref = await addDoc(collection(db, 'houses'), formData);
        houseId = ref.id;
        logActivity(user, 'House Created', 'Academic', `Created house "${formData.name}"`, { name: formData.name, color: formData.color });
      }

      // Sync teacher documents: clear previous incharge, set new one
      if (prevTeacherId && prevTeacherId !== newTeacherId) {
        await updateDoc(doc(db, 'teachers', prevTeacherId), {
          houseInchargeId: '',
          isHouseIncharge: false,
        });
      }
      if (newTeacherId) {
        await updateDoc(doc(db, 'teachers', newTeacherId), {
          houseInchargeId: houseId,
          isHouseIncharge: true,
        });
      }

      setIsModalOpen(false);
      setIsEditMode(false);
      setEditingHouse(null);
      fetchData();
      setFormData({ name: '', color: '#4f46e5', teacherInchargeId: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, isEditMode ? `houses/${editingHouse?.id}` : 'houses');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (house: House) => {
    setEditingHouse(house);
    setIsEditMode(true);
    setFormData({ name: house.name, color: house.color, teacherInchargeId: house.teacherInchargeId || '' });
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
    setIsDeleteModalOpen(true);
  };

  const performDelete = async () => {
    if (!deletingId) return;
    try {
      const deleted = houses.find(h => h.id === deletingId);
      await deleteDoc(doc(db, 'houses', deletingId));
      // Clear the assigned teacher's house incharge status
      if (deleted?.teacherInchargeId) {
        await updateDoc(doc(db, 'teachers', deleted.teacherInchargeId), {
          houseInchargeId: '',
          isHouseIncharge: false,
        });
      }
      logActivity(user, 'House Deleted', 'Academic', `Deleted house "${deleted?.name || deletingId}"`, { houseId: deletingId, name: deleted?.name });
      fetchData();
      setIsDeleteModalOpen(false);
      setDeletingId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `houses/${deletingId}`);
    }
  };

  const filteredHouses = houses.filter(h =>
    h.name.toLowerCase().includes(search.toLowerCase())
  );

  const openAdd = () => {
    setIsEditMode(false);
    setEditingHouse(null);
    setFormData({ name: '', color: '#4f46e5', teacherInchargeId: '' });
    setIsModalOpen(true);
  };

  return (
    <>
      <div className="pad stack">
        {/* Topbar */}
        <div className="topbar">
          <div>
            <div className="eyebrow">{houses.length} {houses.length === 1 ? 'house' : 'houses'}</div>
            <h1>Houses</h1>
          </div>
          <div>
            {!readOnly && (
              <button className="btn accent" onClick={openAdd}>
                <Plus size={15} style={{ marginRight: 6 }} />
                Add House
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
            placeholder="Search houses…"
            style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, fontSize: 14, fontFamily: 'var(--body)', color: 'var(--ink)' }}
          />
        </div>

        {/* Grid */}
        {filteredHouses.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <p className="muted">{search ? 'No results found.' : 'No houses created yet.'}</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {filteredHouses.map(house => {
              const incharge = teachers.find(t => t.id === house.teacherInchargeId);
              return (
                <div key={house.id} className="card" style={{ padding: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    {/* Swatch + name */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 8,
                          background: house.color,
                          flexShrink: 0,
                          border: '1px solid rgba(0,0,0,0.08)',
                        }}
                      />
                      <div>
                        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2 }}>{house.name}</div>
                        <div className="mono tiny muted" style={{ marginTop: 2 }}>{house.color}</div>
                      </div>
                    </div>
                    {/* Actions */}
                    {!readOnly && (
                      <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
                        <button className="icon-btn" onClick={() => handleEdit(house)} title="Edit">
                          <Edit2 size={14} />
                        </button>
                        <button className="icon-btn" onClick={() => handleDelete(house.id)} title="Delete" style={{ color: 'var(--coral)' }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Teacher incharge */}
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                    <div className="eyebrow" style={{ marginBottom: 4 }}>Teacher Incharge</div>
                    <div style={{ fontSize: 13, color: incharge ? 'var(--ink)' : undefined }}>
                      {incharge ? incharge.name : <span className="muted" style={{ fontStyle: 'italic' }}>Not assigned</span>}
                    </div>
                  </div>
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
        title="Delete House?"
        message="This action cannot be undone. All data associated with this house will be removed."
      />

      {/* Add / Edit modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setIsEditMode(false); setEditingHouse(null); }}
        title={isEditMode ? 'Edit House' : 'New House'}
        subtitle="Define house parameters"
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button form="house-form" type="submit" loading={loading}>
              {isEditMode ? 'Update House' : 'Create House'}
            </Button>
          </div>
        }
      >
        <form id="house-form" onSubmit={handleSubmit} className="space-y-4">
          <FormField label="House Name" required>
            <Input
              type="text"
              required
              placeholder="e.g. Red House"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </FormField>
          <FormField label="House Color" required>
            <div className="flex gap-3">
              <input
                type="color"
                required
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-11 h-11 p-1 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer"
              />
              <Input
                type="text"
                required
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="font-mono"
              />
            </div>
          </FormField>
          <FormField label="Teacher Incharge">
            <Select
              value={formData.teacherInchargeId}
              onChange={(e) => setFormData({ ...formData, teacherInchargeId: e.target.value })}
            >
              <option value="">Select Teacher</option>
              {teachers.map(teacher => (
                <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
              ))}
            </Select>
          </FormField>
        </form>
      </Modal>
    </>
  );
}
