import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { logActivity } from '../../services/activityService';
import {
  Plus,
  UserPlus,
  Mail,
  Phone,
  CheckCircle2,
  XCircle,
  Search,
} from 'lucide-react';
import { fmtDate } from '../../lib/utils';
import { Class } from '../../types';
import { Modal, FormField, Input, Select, Button } from '../../components/ui';
import { usePermissions } from '../../hooks/usePermissions';

interface AdmissionLead {
  id: string;
  studentName: string;
  parentName: string;
  email: string;
  phone: string;
  classInterested: string;
  status: 'enquiry' | 'follow-up' | 'registered' | 'admitted' | 'rejected';
  date: string;
  notes: string;
}

const STATUS_LABELS: Record<string, string> = {
  enquiry: 'Enquiry',
  'follow-up': 'Follow-up',
  registered: 'Registered',
  admitted: 'Admitted',
  rejected: 'Rejected',
};

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  enquiry:   { bg: '#e0f2fe', color: '#0369a1' },
  'follow-up': { bg: '#fef9c3', color: '#854d0e' },
  registered: { bg: '#ede9fe', color: '#5b21b6' },
  admitted:  { bg: '#dcfce7', color: '#15803d' },
  rejected:  { bg: '#fee2e2', color: '#b91c1c' },
};

export default function AdmissionManagement({ user }: { user: any }) {
  const [leads, setLeads] = useState<AdmissionLead[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { isReadOnly } = usePermissions(user.role);
  const readOnly = isReadOnly('admissions');

  const [formData, setFormData] = useState({
    studentName: '',
    parentName: '',
    email: '',
    phone: '',
    classInterested: '',
    notes: '',
  });

  const fetchData = async () => {
    try {
      const [leadsSnap, classesSnap] = await Promise.all([
        getDocs(collection(db, 'admission_leads')),
        getDocs(collection(db, 'classes')),
      ]);
      setLeads(leadsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as AdmissionLead)));
      setClasses(classesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Class)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'admission_leads');
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await addDoc(collection(db, 'admission_leads'), {
        ...formData,
        status: 'enquiry',
        date: new Date().toISOString().split('T')[0],
      });
      setIsModalOpen(false);
      fetchData();
      logActivity(user, 'Admission Enquiry Added', 'Super Admin', `New enquiry for ${formData.studentName} (parent: ${formData.parentName}) — ${formData.classInterested}`, { studentName: formData.studentName, parentName: formData.parentName });
      setFormData({ studentName: '', parentName: '', email: '', phone: '', classInterested: '', notes: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'admission_leads');
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (leadId: string, newStatus: AdmissionLead['status']) => {
    const lead = leads.find(l => l.id === leadId);
    try {
      await updateDoc(doc(db, 'admission_leads', leadId), { status: newStatus });
      fetchData();
      logActivity(user, 'Admission Status Updated', 'Super Admin', `${lead?.studentName || leadId} → ${newStatus}`, { leadId, studentName: lead?.studentName, fromStatus: lead?.status, toStatus: newStatus });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `admission_leads/${leadId}`);
    }
  };

  const getClassName = (id: string) => {
    const cls = classes.find(c => c.id === id);
    return cls ? `Class ${cls.name}` : id;
  };

  const newEnquiryCount = leads.filter(l => l.status === 'enquiry').length;

  const filteredLeads = leads.filter(l => {
    const matchSearch = l.studentName.toLowerCase().includes(search.toLowerCase()) || l.parentName.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || l.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const statusOptions = ['all', 'enquiry', 'follow-up', 'registered', 'admitted', 'rejected'];

  return (
    <>
      {/* Topbar */}
      <div className="topbar">
        <div>
          <div className="eyebrow">{newEnquiryCount} new enquiries</div>
          <h1>Admissions</h1>
        </div>
        {!readOnly && (
          <button
            className="btn accent"
            style={{ width: 'auto', padding: '10px 16px', fontSize: 13 }}
            onClick={() => setIsModalOpen(true)}
          >
            <Plus size={15} /> Add Enquiry
          </button>
        )}
      </div>

      <div className="pad stack" style={{ paddingBottom: 32 }}>
        {/* Search */}
        <div className="card flex" style={{ gap: 10, padding: '10px 14px', alignItems: 'center' }}>
          <Search size={16} className="muted" style={{ flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search student or parent name…"
            style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, fontSize: 14, fontFamily: 'var(--body)', color: 'var(--ink)' }}
          />
        </div>

        {/* Status filter chips */}
        <div className="hscroll" style={{ padding: 0 }}>
          {statusOptions.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={statusFilter === s ? 'chip solid' : 'chip'}
              style={{ textTransform: 'capitalize' }}
            >
              {s === 'all' ? 'All' : STATUS_LABELS[s] || s}
            </button>
          ))}
        </div>

        {/* Enquiry cards */}
        {filteredLeads.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <UserPlus size={36} style={{ margin: '0 auto 12px', color: 'var(--ink-3)' }} />
            <p style={{ fontWeight: 700, marginBottom: 4 }}>No enquiries found</p>
            <p className="muted tiny">Add your first admission enquiry to get started.</p>
          </div>
        ) : (
          <div className="stack">
            {filteredLeads.map(lead => {
              const ss = STATUS_STYLE[lead.status] || { bg: 'var(--cream-2)', color: 'var(--ink-2)' };
              return (
                <div key={lead.id} className="card" style={{ padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{lead.studentName}</span>
                        <span className="chip" style={{ fontSize: 11, padding: '2px 8px' }}>
                          {getClassName(lead.classInterested)}
                        </span>
                      </div>
                      <p className="muted tiny" style={{ marginBottom: 6 }}>Parent: {lead.parentName}</p>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {lead.email && (
                          <span className="muted tiny" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Mail size={11} /> {lead.email}
                          </span>
                        )}
                        {lead.phone && (
                          <span className="muted tiny" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Phone size={11} /> {lead.phone}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      <div className="eyebrow" style={{ fontSize: 10 }}>{fmtDate(lead.date)}</div>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: ss.bg, color: ss.color }}>
                        {STATUS_LABELS[lead.status] || lead.status}
                      </span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  {!readOnly && lead.status !== 'admitted' && lead.status !== 'rejected' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12, borderTop: '1px solid var(--line-2)', paddingTop: 12 }}>
                      <button
                        onClick={() => updateStatus(lead.id, 'admitted')}
                        style={{ padding: '7px 0', borderRadius: 10, background: 'var(--leaf)', color: '#fff', border: 0, fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, cursor: 'pointer' }}
                      >
                        <CheckCircle2 size={13} /> Admit
                      </button>
                      <button
                        onClick={() => updateStatus(lead.id, 'rejected')}
                        style={{ padding: '7px 0', borderRadius: 10, background: 'transparent', border: '1px solid var(--coral)', color: 'var(--coral)', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, cursor: 'pointer' }}
                      >
                        <XCircle size={13} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Enquiry Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="New Admission Enquiry"
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button form="admission-form" type="submit" loading={loading} icon={UserPlus}>Submit Enquiry</Button>
          </div>
        }
      >
        <form id="admission-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Student Name" required>
              <Input type="text" required value={formData.studentName} onChange={e => setFormData({ ...formData, studentName: e.target.value })} />
            </FormField>
            <FormField label="Parent Name" required>
              <Input type="text" required value={formData.parentName} onChange={e => setFormData({ ...formData, parentName: e.target.value })} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Email" required>
              <Input type="email" required value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
            </FormField>
            <FormField label="Phone" required>
              <Input type="tel" required value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
            </FormField>
          </div>
          <FormField label="Class Interested In" required>
            <Select required value={formData.classInterested} onChange={e => setFormData({ ...formData, classInterested: e.target.value })}>
              <option value="">Select Class</option>
              {classes.map(cls => <option key={cls.id} value={cls.id}>Class {cls.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Notes">
            <textarea
              rows={3}
              value={formData.notes}
              onChange={e => setFormData({ ...formData, notes: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 resize-none"
            />
          </FormField>
        </form>
      </Modal>
    </>
  );
}
