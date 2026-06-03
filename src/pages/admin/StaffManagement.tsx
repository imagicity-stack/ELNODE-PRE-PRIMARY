import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, doc, setDoc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { logActivity } from '../../services/activityService';
import {
  validateStaffInput,
  ensureUniqueEmail,
  provisionStaffAuthAccount,
  updateStaffWithUserSync,
  normalizeEmail,
  ConcurrentEditError,
} from '../../services/staffService';
import { Plus, Search, Edit2, Mail, Phone, UserPlus } from 'lucide-react';
import { useToast } from '../../components/Toast';
import { usePermissions } from '../../hooks/usePermissions';
import { fmtDate } from '../../lib/utils';
import { Modal, FormField, Input, Select, Button } from '../../components/ui';

interface StaffMember {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: 'principal' | 'accounts' | 'admin' | 'security' | 'transport' | 'grievance_officer' | 'store_keeper' | 'guard' | 'maid';
  joiningDate: string;
  salary: number;
  status: 'active' | 'on-leave' | 'resigned';
  version?: number;
  employeeId?: string;
}

const ALLOWED_ROLES: ReadonlyArray<StaffMember['role']> = [
  'principal', 'accounts', 'admin', 'security', 'transport', 'grievance_officer', 'store_keeper', 'guard', 'maid',
];

// These roles have no portal access and no email/auth account
const INTERNAL_ROLES: ReadonlyArray<string> = ['security', 'transport', 'store_keeper', 'guard', 'maid'];

// These roles get full portal access + auth account
const PORTAL_ROLES: ReadonlyArray<string> = ['principal', 'accounts', 'grievance_officer'];

const DEFAULT_PASSWORD = 'password123';

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

const roleLabel: Record<string, string> = {
  principal: 'Principal',
  accounts: 'Accounts',
  admin: 'Admin',
  grievance_officer: 'Grievance Officer',
  security: 'Security',
  transport: 'Transport',
  store_keeper: 'Store Keeper',
  guard: 'Guard',
  maid: 'Maid / Housekeeping',
};

// Sections for the staff list display
const STAFF_SECTIONS: { heading: string; roles: string[] }[] = [
  { heading: 'Portal Access', roles: ['principal', 'accounts', 'grievance_officer'] },
  { heading: 'Administration', roles: ['admin'] },
  { heading: 'Support & Operations', roles: ['security', 'transport', 'store_keeper', 'guard', 'maid'] },
];

export default function StaffManagement({ user }: { user: any }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const { showToast } = useToast();

  const { isReadOnly } = usePermissions(user.role);
  const readOnly = isReadOnly('staff');

  const [formData, setFormData] = useState({
    employeeId: '',
    name: '',
    email: '',
    phone: '',
    role: 'accounts' as StaffMember['role'],
    joiningDate: '',
    salary: '',
  });

  const isInternalRole = INTERNAL_ROLES.includes(formData.role);

  const fetchStaff = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'staff'));
      const list = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StaffMember));
      setStaff(list);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'staff');
    }
  };

  useEffect(() => {
    fetchStaff();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const salaryNum = Number(formData.salary);
      const isInternal = INTERNAL_ROLES.includes(formData.role);

      if (!formData.name.trim()) {
        showToast('Name is required', 'error');
        return;
      }
      if (!isInternal) {
        const validationErr = validateStaffInput({
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          salary: salaryNum,
        });
        if (validationErr) {
          showToast(validationErr, 'error');
          return;
        }
      } else {
        if (isNaN(salaryNum) || salaryNum < 0) {
          showToast('Salary must be a valid number', 'error');
          return;
        }
      }

      if (!ALLOWED_ROLES.includes(formData.role)) {
        showToast('Invalid role selected', 'error');
        return;
      }
      if (!formData.joiningDate) {
        showToast('Joining date is required', 'error');
        return;
      }

      // ── EDIT PATH ──────────────────────────────────────────────
      if (isEditMode && editingStaff) {
        const wasInternal = INTERNAL_ROLES.includes(editingStaff.role);
        if (wasInternal || isInternal) {
          // Internal staff: skip user sync, just update staff doc directly
          await updateDoc(doc(db, 'staff', editingStaff.id), {
            employeeId: formData.employeeId.trim(),
            name: formData.name.trim(),
            phone: formData.phone,
            role: formData.role,
            joiningDate: formData.joiningDate,
            salary: salaryNum,
          });
          showToast('Staff member updated successfully!', 'success');
        } else {
          const normalizedEmail = normalizeEmail(formData.email);
          const portalRole = PORTAL_ROLES.includes(formData.role) ? formData.role : 'office_staff';
          try {
            await updateStaffWithUserSync({
              collectionName: 'staff',
              docId: editingStaff.id,
              expectedVersion: editingStaff.version ?? 0,
              updates: {
                employeeId: formData.employeeId.trim(),
                name: formData.name.trim(),
                email: normalizedEmail,
                phone: formData.phone,
                role: formData.role,
                joiningDate: formData.joiningDate,
                salary: salaryNum,
              },
              originalEmail: editingStaff.email,
              userProfileUpdates: {
                name: formData.name.trim(),
                email: normalizedEmail,
                phone: formData.phone,
                role: portalRole,
              },
            });
            showToast('Staff member updated successfully!', 'success');
          } catch (err: any) {
            if (err instanceof ConcurrentEditError) {
              showToast(err.message, 'error');
              fetchStaff();
              return;
            }
            throw err;
          }
        }
        setIsModalOpen(false);
        setIsEditMode(false);
        setEditingStaff(null);
        fetchStaff();
        return;
      }

      // ── CREATE PATH ────────────────────────────────────────────
      if (isInternal) {
        // Internal-only: no email, no auth account
        await addDoc(collection(db, 'staff'), {
          employeeId: formData.employeeId.trim(),
          name: formData.name.trim(),
          email: '',
          phone: formData.phone,
          role: formData.role,
          joiningDate: formData.joiningDate,
          salary: salaryNum,
          status: 'active',
          version: 1,
          createdAt: new Date().toISOString(),
        });
        logActivity(user, 'Staff Member Added', 'Staff', `Added ${formData.role} ${formData.name.trim()}`, {
          name: formData.name.trim(),
          role: formData.role,
          employeeId: formData.employeeId.trim(),
        });
      } else {
        const normalizedEmail = normalizeEmail(formData.email);
        const portalRole = PORTAL_ROLES.includes(formData.role) ? formData.role : 'office_staff';

        // Duplicate-email check before we create an orphaned auth user
        await ensureUniqueEmail(normalizedEmail);

        const staffUid = await provisionStaffAuthAccount(normalizedEmail, DEFAULT_PASSWORD);

        let staffRef;
        try {
          staffRef = await addDoc(collection(db, 'staff'), {
            employeeId: formData.employeeId.trim(),
            name: formData.name.trim(),
            email: normalizedEmail,
            phone: formData.phone,
            role: formData.role,
            joiningDate: formData.joiningDate,
            salary: salaryNum,
            status: 'active',
            version: 1,
            createdAt: new Date().toISOString(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, 'staff');
          throw err;
        }

        try {
          await setDoc(doc(db, 'users', staffUid), {
            uid: staffUid,
            email: normalizedEmail,
            name: formData.name.trim(),
            phone: formData.phone,
            role: portalRole,
            staffId: staffRef.id,
            createdAt: new Date().toISOString(),
          });
          logActivity(user, 'Staff User Provisioned', 'Staff', `Provisioned portal user for ${normalizedEmail}`, {
            email: normalizedEmail,
            role: portalRole,
            staffId: staffRef.id,
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${staffUid}`);
          throw err;
        }

        logActivity(user, 'Staff Member Added', 'Staff', `Added staff member ${formData.name.trim()} as ${formData.role}`, {
          name: formData.name.trim(),
          role: formData.role,
          email: normalizedEmail,
          employeeId: formData.employeeId.trim(),
        });
      }

      setIsModalOpen(false);
      fetchStaff();
      setFormData({ employeeId: '', name: '', email: '', phone: '', role: 'accounts', joiningDate: '', salary: '' });
      showToast('Staff member created successfully!', 'success');
    } catch (err: any) {
      console.error(err);
      if (err?.code === 'auth/operation-not-allowed') {
        showToast('Firebase Error: Email/Password sign-in is not enabled in your Firebase Console.', 'error');
      } else {
        showToast(err?.message || 'Unknown error', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (member: StaffMember) => {
    setEditingStaff(member);
    setIsEditMode(true);
    setFormData({
      employeeId: member.employeeId || '',
      name: member.name,
      email: member.email || '',
      phone: member.phone || '',
      role: member.role,
      joiningDate: member.joiningDate,
      salary: member.salary.toString(),
    });
    setIsModalOpen(true);
  };

  const openAddModal = () => {
    setIsEditMode(false);
    setEditingStaff(null);
    setFormData({ employeeId: '', name: '', email: '', phone: '', role: 'accounts', joiningDate: '', salary: '' });
    setIsModalOpen(true);
  };

  const filteredStaff = staff.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    (m.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (m.role || '').toLowerCase().includes(search.toLowerCase()) ||
    (m.phone || '').includes(search)
  );

  // Group filtered staff by section
  const staffBySection = STAFF_SECTIONS.map(section => ({
    ...section,
    members: filteredStaff.filter(m => section.roles.includes(m.role)),
  })).filter(s => s.members.length > 0);

  // Catch-all for any roles not in a defined section
  const allSectionRoles = STAFF_SECTIONS.flatMap(s => s.roles);
  const ungrouped = filteredStaff.filter(m => !allSectionRoles.includes(m.role));

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">{staff.length} member{staff.length !== 1 ? 's' : ''}</div>
          <h1>Staff</h1>
        </div>
        {!readOnly && (
          <button className="btn accent" onClick={openAddModal}>
            <Plus size={15} /> Add Staff
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
            placeholder="Search staff…"
            style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, fontSize: 14, fontFamily: 'var(--body)', color: 'var(--ink)' }}
          />
        </div>

        {/* Sectioned staff cards */}
        {filteredStaff.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <p className="muted" style={{ fontSize: 14 }}>
              {search ? 'No staff match your search.' : 'No staff members yet. Add one to get started.'}
            </p>
          </div>
        ) : (
          <>
            {staffBySection.map(section => (
              <div key={section.heading}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', padding: '4px 2px 8px' }}>
                  {section.heading}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 20 }}>
                  {section.members.map(member => (
                    <StaffCard key={member.id} member={member} readOnly={readOnly} onEdit={handleEdit} />
                  ))}
                </div>
              </div>
            ))}
            {ungrouped.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', padding: '4px 2px 8px' }}>
                  Other
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 20 }}>
                  {ungrouped.map(member => (
                    <StaffCard key={member.id} member={member} readOnly={readOnly} onEdit={handleEdit} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setIsEditMode(false); setEditingStaff(null); }}
        title={isEditMode ? 'Edit Staff Member' : 'Add Staff Member'}
        subtitle={isEditMode ? 'Update staff information.' : 'Register a new staff member.'}
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setIsEditMode(false); setEditingStaff(null); }}>
              Cancel
            </Button>
            <Button form="staff-form" type="submit" loading={loading} icon={isEditMode ? Edit2 : UserPlus}>
              {isEditMode ? 'Update Staff' : 'Add Staff'}
            </Button>
          </div>
        }
      >
        <form id="staff-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Employee ID" required hint="e.g. EMP001 — used on payslips">
              <Input
                type="text"
                required
                placeholder="EMP001"
                value={formData.employeeId}
                onChange={(e) => setFormData({ ...formData, employeeId: e.target.value.toUpperCase() })}
              />
            </FormField>
            <FormField label="Full Name" required>
              <Input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Role" required>
              <Select
                required
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value as StaffMember['role'], email: '' })}
              >
                <optgroup label="Portal Access">
                  <option value="principal">Principal</option>
                  <option value="accounts">Accounts</option>
                  <option value="grievance_officer">Grievance Officer</option>
                </optgroup>
                <optgroup label="Administration">
                  <option value="admin">Admin Staff</option>
                </optgroup>
                <optgroup label="Support & Operations">
                  <option value="security">Security</option>
                  <option value="transport">Transport</option>
                  <option value="store_keeper">Store Keeper</option>
                  <option value="guard">Guard</option>
                  <option value="maid">Maid / Housekeeping</option>
                </optgroup>
              </Select>
            </FormField>
            <FormField label="Salary" required>
              <Input
                type="number"
                required
                value={formData.salary}
                onChange={(e) => setFormData({ ...formData, salary: e.target.value })}
              />
            </FormField>
          </div>

          {/* Email only for portal/admin roles */}
          {!isInternalRole && (
            <FormField label="Email Address" required hint="Used to create a portal login account">
              <Input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </FormField>
          )}

          <FormField label="Phone Number" hint={isInternalRole ? 'Optional — for internal records only' : undefined}>
            <Input
              type="tel"
              placeholder="10-digit number"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
            />
          </FormField>

          <FormField label="Joining Date" required>
            <Input
              type="date"
              required
              value={formData.joiningDate}
              onChange={(e) => setFormData({ ...formData, joiningDate: e.target.value })}
            />
          </FormField>

          {isInternalRole && (
            <div style={{ background: 'var(--cream-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: 'var(--ink-3)' }}>
              This role is for internal record-keeping only. No portal login will be created.
            </div>
          )}
        </form>
      </Modal>
    </>
  );
}

function StaffCard({ member, readOnly, onEdit }: { member: StaffMember; readOnly: boolean; onEdit: (m: StaffMember) => void }) {
  const isInternal = INTERNAL_ROLES.includes(member.role);
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0,
        }}>
          {member.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', marginBottom: 4 }}>
            {member.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            <span className="chip solid" style={{ fontSize: 11 }}>{roleLabel[member.role] || member.role}</span>
            {member.status === 'active' && (
              <span className="chip" style={{ fontSize: 11, color: 'var(--leaf)', borderColor: 'var(--leaf)' }}>Active</span>
            )}
            {member.status === 'on-leave' && (
              <span className="chip" style={{ fontSize: 11, color: 'var(--coral)', borderColor: 'var(--coral)' }}>On Leave</span>
            )}
            {member.status === 'resigned' && (
              <span className="chip" style={{ fontSize: 11 }}>Resigned</span>
            )}
          </div>
          {isInternal ? (
            <div className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <Phone size={11} />
              {member.phone ? member.phone : <span style={{ fontStyle: 'italic' }}>No phone on record</span>}
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <Mail size={11} /> {member.email || '—'}
            </div>
          )}
          {member.joiningDate && (
            <div className="mono tiny" style={{ marginTop: 2 }}>
              Joined {fmtDate(member.joiningDate)}
            </div>
          )}
        </div>
        {!readOnly && (
          <button className="icon-btn" onClick={() => onEdit(member)} title="Edit" style={{ flexShrink: 0 }}>
            <Edit2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
