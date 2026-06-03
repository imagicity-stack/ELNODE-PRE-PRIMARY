import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { logActivity } from '../../services/activityService';
import { GradingScale, UserProfile } from '../../types';
import { usePermissions } from '../../hooks/usePermissions';
import { Plus, Trash2, Edit2, PlusCircle, AlertTriangle } from 'lucide-react';
import { Modal, ConfirmModal, FormField, Input, Button, IconButton } from '../../components/ui';
import { validateGradingScale, ValidationIssue } from '../../services/examService';
import { useToast } from '../../components/Toast';

export default function GradingScaleManagement({ user }: { user: UserProfile }) {
  const [scales, setScales] = useState<GradingScale[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingScale, setEditingScale] = useState<GradingScale | null>(null);

  const { isReadOnly } = usePermissions(user.role);
  const readOnly = isReadOnly('grading-scales');
  const { showToast } = useToast();
  const [issues, setIssues] = useState<ValidationIssue[]>([]);

  const [formData, setFormData] = useState({
    name: '',
    ranges: [
      { grade: 'A+', min: 90, max: 100, point: 4.0, description: 'Excellent' },
      { grade: 'A', min: 80, max: 89, point: 3.7, description: 'Very Good' },
      { grade: 'B', min: 70, max: 79, point: 3.0, description: 'Good' },
      { grade: 'C', min: 60, max: 69, point: 2.0, description: 'Satisfactory' },
      { grade: 'D', min: 50, max: 59, point: 1.0, description: 'Pass' },
      { grade: 'F', min: 0, max: 49, point: 0.0, description: 'Fail' },
    ],
  });

  useEffect(() => {
    fetchScales();
  }, []);

  const fetchScales = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'gradingScales'));
      setScales(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GradingScale)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'gradingScales');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateGradingScale(formData.ranges);
    setIssues(validation);
    const errors = validation.filter(i => i.level === 'error');
    if (errors.length > 0) {
      showToast(errors[0].message, 'error');
      return;
    }
    if (!formData.name.trim()) {
      showToast('Scale name is required', 'error');
      return;
    }
    setLoading(true);
    try {
      if (editingScale) {
        await updateDoc(doc(db, 'gradingScales', editingScale.id), formData);
        logActivity(user, 'Grading Scale Updated', 'Academic', `Updated grading scale "${formData.name}"`, { scaleId: editingScale.id, name: formData.name, rangeCount: formData.ranges.length });
      } else {
        const newRef = await addDoc(collection(db, 'gradingScales'), { ...formData, createdAt: new Date().toISOString() });
        logActivity(user, 'Grading Scale Created', 'Academic', `Created grading scale "${formData.name}"`, { scaleId: newRef.id, name: formData.name, rangeCount: formData.ranges.length });
      }
      setIsModalOpen(false);
      setEditingScale(null);
      setIssues([]);
      fetchScales();
      setFormData({ name: '', ranges: [{ grade: '', min: 0, max: 0, point: 0, description: '' }] });
      showToast('Grading scale saved', 'success');
    } catch (err) {
      handleFirestoreError(err, editingScale ? OperationType.UPDATE : OperationType.CREATE, editingScale ? `gradingScales/${editingScale.id}` : 'gradingScales');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
    setIsDeleteModalOpen(true);
  };

  const performDelete = async () => {
    if (!deletingId) return;
    try {
      const deletedScale = scales.find(s => s.id === deletingId);
      await deleteDoc(doc(db, 'gradingScales', deletingId));
      logActivity(user, 'Grading Scale Deleted', 'Academic', deletedScale ? `Deleted grading scale "${deletedScale.name}"` : `Deleted grading scale ${deletingId}`, { scaleId: deletingId, name: deletedScale?.name });
      fetchScales();
      setIsDeleteModalOpen(false);
      setDeletingId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `gradingScales/${deletingId}`);
    }
  };

  const addRange = () => {
    setFormData({ ...formData, ranges: [...formData.ranges, { grade: '', min: 0, max: 0, point: 0, description: '' }] });
  };

  const removeRange = (index: number) => {
    setFormData({ ...formData, ranges: formData.ranges.filter((_, i) => i !== index) });
  };

  const updateRange = (index: number, field: string, value: any) => {
    const newRanges = [...formData.ranges];
    newRanges[index] = { ...newRanges[index], [field]: value };
    setFormData({ ...formData, ranges: newRanges });
  };

  const openCreate = () => {
    setEditingScale(null);
    setFormData({
      name: '',
      ranges: [
        { grade: 'A+', min: 90, max: 100, point: 4.0, description: 'Excellent' },
        { grade: 'A', min: 80, max: 89, point: 3.7, description: 'Very Good' },
        { grade: 'B', min: 70, max: 79, point: 3.0, description: 'Good' },
        { grade: 'C', min: 60, max: 69, point: 2.0, description: 'Satisfactory' },
        { grade: 'D', min: 50, max: 59, point: 1.0, description: 'Pass' },
        { grade: 'F', min: 0, max: 49, point: 0.0, description: 'Fail' },
      ],
    });
    setIsModalOpen(true);
  };

  return (
    <>
      <div className="pad stack">
        {/* Topbar */}
        <div className="topbar">
          <div>
            <div className="eyebrow">{scales.length} {scales.length === 1 ? 'scale' : 'scales'}</div>
            <h1>Grading Scales</h1>
          </div>
          <div>
            {!readOnly && (
              <button className="btn accent" onClick={openCreate}>
                <Plus size={15} style={{ marginRight: 6 }} />
                Add Scale
              </button>
            )}
          </div>
        </div>

        {/* Scale cards grid */}
        {scales.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <p className="muted">No grading scales defined. Create your first scale to get started.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {scales.map(scale => (
              <div key={scale.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                {/* Card header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line)', background: 'var(--cream)' }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>{scale.name}</div>
                  {!readOnly && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        className="icon-btn"
                        onClick={() => { setEditingScale(scale); setFormData({ name: scale.name, ranges: scale.ranges }); setIsModalOpen(true); }}
                        title="Edit"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button className="icon-btn" onClick={() => handleDelete(scale.id)} title="Delete" style={{ color: 'var(--coral)' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Grade rows */}
                <div style={{ padding: '8px 0' }}>
                  {/* Column headers */}
                  <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr 72px', gap: 0, padding: '4px 18px 6px', borderBottom: '1px solid var(--line)' }}>
                    <span className="eyebrow">Grade</span>
                    <span className="eyebrow">Range</span>
                    <span className="eyebrow" style={{ textAlign: 'right' }}>Points</span>
                  </div>
                  {scale.ranges.sort((a, b) => b.min - a.min).map((range, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '56px 1fr 72px',
                        gap: 0,
                        padding: '7px 18px',
                        borderBottom: idx < scale.ranges.length - 1 ? '1px solid var(--cream-2)' : 'none',
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{range.grade}</span>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--ink)', opacity: 0.65, alignSelf: 'center' }}>
                        {range.min}% – {range.max}%
                      </span>
                      <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)', textAlign: 'right', alignSelf: 'center' }}>
                        {range.point.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirm */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={performDelete}
        title="Delete Grading Scale?"
        message="This action cannot be undone. This grading scale will be permanently removed."
      />

      {/* Add / Edit modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setEditingScale(null); }}
        title={editingScale ? 'Edit Grading Scale' : 'Create New Grading Scale'}
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button form="grading-form" type="submit" loading={loading}>
              {editingScale ? 'Update Scale' : 'Create Scale'}
            </Button>
          </div>
        }
      >
        <form id="grading-form" onSubmit={handleSubmit} className="space-y-6">
          {issues.length > 0 && (
            <div className="space-y-1">
              {issues.map((iss, i) => (
                <div key={i} className={
                  'flex items-start gap-2 px-3 py-2 rounded-xl text-xs ' +
                  (iss.level === 'error' ? 'bg-rose-50 border border-rose-200 text-rose-700' : 'bg-amber-50 border border-amber-200 text-amber-700')
                }>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{iss.message}</span>
                </div>
              ))}
            </div>
          )}
          <FormField label="Scale Name" required>
            <Input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Standard High School Scale"
            />
          </FormField>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-700">Grade Ranges</label>
              <Button variant="ghost" size="xs" icon={PlusCircle} type="button" onClick={addRange}>
                Add Range
              </Button>
            </div>
            <div className="space-y-2">
              {formData.ranges.map((range, idx) => (
                <div key={idx} className="grid grid-cols-4 gap-3 items-end p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Grade</label>
                    <Input
                      type="text"
                      required
                      value={range.grade}
                      onChange={(e) => updateRange(idx, 'grade', e.target.value)}
                      placeholder="A+"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Min %</label>
                    <Input
                      type="number"
                      required
                      value={range.min}
                      onChange={(e) => updateRange(idx, 'min', parseInt(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Max %</label>
                    <Input
                      type="number"
                      required
                      value={range.max}
                      onChange={(e) => updateRange(idx, 'max', parseInt(e.target.value))}
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Point</label>
                      <Input
                        type="number"
                        step="0.1"
                        required
                        value={range.point}
                        onChange={(e) => updateRange(idx, 'point', parseFloat(e.target.value))}
                      />
                    </div>
                    <IconButton
                      icon={Trash2}
                      variant="danger"
                      size="sm"
                      type="button"
                      onClick={() => removeRange(idx)}
                      className="mb-0.5"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}
