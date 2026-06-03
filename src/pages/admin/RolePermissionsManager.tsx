import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { RolePermissions, ModulePermission, UserRole, UserProfile } from '../../types';
import {
  ShieldCheck, Eye, Edit3, Save, RefreshCcw, Users, GraduationCap, BookOpen,
  Calendar, ClipboardCheck, FileText, Megaphone, History, LayoutGrid, Briefcase,
  UserPlus, Home, Clock, CheckSquare, Shield,
} from 'lucide-react';
import { useToast } from '../../components/Toast';
import { logActivity } from '../../services/activityService';

const MODULES = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { id: 'students', label: 'Students', icon: Users },
  { id: 'teachers', label: 'Faculty', icon: Briefcase },
  { id: 'staff', label: 'Staff', icon: Shield },
  { id: 'classes', label: 'Classes', icon: GraduationCap },
  { id: 'subjects', label: 'Subjects', icon: BookOpen },
  { id: 'houses', label: 'Houses', icon: Home },
  { id: 'admissions', label: 'Admissions', icon: UserPlus },
  { id: 'exams', label: 'Exams', icon: FileText },
  { id: 'timetable', label: 'Timetable', icon: Clock },
  { id: 'leaves', label: 'Leaves', icon: ClipboardCheck },
  { id: 'grading-scales', label: 'Grading Scales', icon: CheckSquare },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'diary', label: 'Class Diary', icon: BookOpen },
  { id: 'notices', label: 'Notices', icon: Megaphone },
  { id: 'activity-logs', label: 'Activity Logs', icon: History },
];

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'principal', label: 'Principal' },
  { value: 'office_staff', label: 'Office Staff' },
  { value: 'teacher', label: 'Teacher' },
  { value: 'accounts', label: 'Accountant' },
  { value: 'grievance_officer', label: 'Grievance' },
];

export default function RolePermissionsManager({ user }: { user: UserProfile }) {
  const [targetRole, setTargetRole] = useState<UserRole>('principal');
  const [permissions, setPermissions] = useState<RolePermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  useEffect(() => { fetchPermissions(); }, [targetRole]);

  const fetchPermissions = async () => {
    setLoading(true);
    try {
      const docRef = doc(db, 'rolePermissions', targetRole);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setPermissions(docSnap.data() as RolePermissions);
      } else {
        const defaultModules: Record<string, ModulePermission> = {};
        MODULES.forEach(md => {
          const readOnly = targetRole === 'principal' && md.id !== 'leaves';
          defaultModules[md.id] = { enabled: true, readOnly };
        });
        setPermissions({ id: targetRole, modules: defaultModules, updatedAt: new Date().toISOString() });
      }
    } catch (error) {
      console.error('Error fetching permissions:', error);
      showToast('Failed to load permissions', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleModule = (moduleId: string, field: keyof ModulePermission) => {
    if (!permissions) return;
    setPermissions({
      ...permissions,
      modules: {
        ...permissions.modules,
        [moduleId]: { ...permissions.modules[moduleId], [field]: !permissions.modules[moduleId][field] },
      },
    });
  };

  const savePermissions = async () => {
    if (!permissions) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'rolePermissions', targetRole), { ...permissions, updatedAt: new Date().toISOString() });
      const enabledModules = Object.entries(permissions.modules).filter(([_, m]) => m.enabled).map(([id]) => id);
      const readOnlyModules = Object.entries(permissions.modules).filter(([_, m]) => m.enabled && m.readOnly).map(([id]) => id);
      logActivity(user, 'Role Permissions Updated', 'Super Admin', `Updated permissions for role: ${targetRole}`, { role: targetRole, enabledCount: enabledModules.length, readOnlyCount: readOnlyModules.length });
      showToast('Permissions updated successfully', 'success');
    } catch (error) {
      console.error('Error saving permissions:', error);
      showToast('Failed to save permissions', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-2">
      <div className="topbar">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Permissions</h1>
        </div>
        <button className="btn accent" onClick={savePermissions} disabled={saving || loading} style={{ gap: 8 }}>
          {saving ? <RefreshCcw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Role selector */}
      <div className="hscroll" style={{ marginTop: 8 }}>
        {ROLES.map(r => (
          <button
            key={r.value}
            className={'chip' + (targetRole === r.value ? ' solid' : '')}
            onClick={() => setTargetRole(r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="pad" style={{ marginTop: 14 }}>
        {loading ? (
          <div className="card muted small" style={{ textAlign: 'center', padding: 32 }}>
            <RefreshCcw size={20} style={{ margin: '0 auto', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {MODULES.map(module => {
              const cfg = permissions?.modules[module.id] || { enabled: true, readOnly: false };
              return (
                <div
                  key={module.id}
                  className="card"
                  style={{ padding: 14, opacity: cfg.enabled ? 1 : 0.5, transition: 'opacity 0.15s' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--cream-2)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <module.icon size={16} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{module.label}</div>
                        <div className="mono tiny muted">{module.id}</div>
                      </div>
                    </div>
                    {/* Enable toggle */}
                    <div
                      onClick={() => handleToggleModule(module.id, 'enabled')}
                      style={{ width: 38, height: 22, borderRadius: 999, background: cfg.enabled ? 'var(--ink)' : 'var(--line)', position: 'relative', cursor: 'pointer', transition: 'background 0.15s', flexShrink: 0 }}
                    >
                      <div style={{ position: 'absolute', top: 3, left: cfg.enabled ? 19 : 3, width: 16, height: 16, borderRadius: 999, background: 'var(--cream)', transition: 'left 0.15s' }} />
                    </div>
                  </div>

                  <button
                    disabled={!cfg.enabled}
                    onClick={() => handleToggleModule(module.id, 'readOnly')}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      padding: '6px 0',
                      borderRadius: 8,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      cursor: cfg.enabled ? 'pointer' : 'not-allowed',
                      border: '1px solid',
                      background: !cfg.enabled ? 'var(--cream-2)' : cfg.readOnly ? 'oklch(0.97 0.05 105)' : 'oklch(0.95 0.05 145)',
                      borderColor: !cfg.enabled ? 'var(--line)' : cfg.readOnly ? 'var(--accent)' : 'var(--leaf)',
                      color: !cfg.enabled ? 'var(--ink-3)' : cfg.readOnly ? 'oklch(0.45 0.12 105)' : 'var(--leaf)',
                    }}
                  >
                    {cfg.readOnly ? <Eye size={12} /> : <Edit3 size={12} />}
                    {cfg.readOnly ? 'View Only' : 'Full Access'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="card" style={{ marginTop: 12, padding: '12px 14px', background: 'oklch(0.98 0.04 80)', border: '1px solid oklch(0.88 0.08 80)', display: 'flex', gap: 10 }}>
          <ShieldCheck size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
          <span className="small" style={{ color: 'oklch(0.35 0.08 80)' }}>
            Permissions apply immediately to the {targetRole.replace('_', ' ')} portal.
          </span>
        </div>
      </div>
      <div style={{ height: 16 }} />
    </div>
  );
}
