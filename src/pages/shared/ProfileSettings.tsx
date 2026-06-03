import { useState, useEffect, useRef } from 'react';
import {
  Lock,
  Camera,
  Eye,
  EyeOff,
  Loader2,
} from 'lucide-react';
import { doc, getDoc, updateDoc, runTransaction } from 'firebase/firestore';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, auth, storage, handleFirestoreError, OperationType } from '../../firebase';
import { Button, Input, FormField, Avatar } from '../../components/ui';
import { UserProfile, Student, Teacher, House } from '../../types';
import { logActivity } from '../../services/activityService';
import type { ActivitySection } from '../../types';

interface ProfileSettingsProps {
  user: UserProfile;
}

export default function ProfileSettings({ user }: ProfileSettingsProps) {
  const [loading, setLoading] = useState(false);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  const [studentData, setStudentData] = useState<Student | null>(null);
  const [teacherData, setTeacherData] = useState<Teacher | null>(null);
  const [parentStudents, setParentStudents] = useState<Student[]>([]);
  const [houseName, setHouseName] = useState<string>('');
  const [className, setClassName] = useState<string>('');
  const [subjectNames, setSubjectNames] = useState<string[]>([]);
  const [assignedClasses, setAssignedClasses] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profileData, setProfileData] = useState({
    name: user.name || '',
    phone: user.phone || '',
    email: user.email || '',
    photoURL: user.photoURL || '',
    address: user.address || '',
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  useEffect(() => {
    const fetchExtraData = async () => {
      try {
        if (user.role === 'student') {
          const sid = user.studentId || user.uid;
          const studentDoc = await getDoc(doc(db, 'students', sid));
          if (studentDoc.exists()) {
            const sData = { id: studentDoc.id, ...studentDoc.data() } as Student;
            setStudentData(sData);
            if (sData.houseId) {
              const houseDoc = await getDoc(doc(db, 'houses', sData.houseId));
              if (houseDoc.exists()) setHouseName((houseDoc.data() as House).name);
            }
            if (sData.classId) {
              const classDoc = await getDoc(doc(db, 'classes', sData.classId));
              if (classDoc.exists()) setClassName(classDoc.data().name);
            }
          }
        } else if (user.role === 'parent') {
          if (user.studentIds && user.studentIds.length > 0) {
            const list: Student[] = [];
            for (const id of user.studentIds) {
              const docSnap = await getDoc(doc(db, 'students', id));
              if (docSnap.exists()) list.push({ id: docSnap.id, ...docSnap.data() } as Student);
            }
            setParentStudents(list);
          }
        } else if (user.role === 'teacher' || user.role === 'principal' || user.role === 'accounts') {
          const tid = user.teacherId || user.uid;
          const teacherDoc = await getDoc(doc(db, 'teachers', tid));
          if (teacherDoc.exists()) {
            const tData = { id: teacherDoc.id, ...teacherDoc.data() } as Teacher;
            setTeacherData(tData);
            if (tData.subjects) {
              const names = await Promise.all(tData.subjects.map(async (id: string) => {
                const docSnap = await getDoc(doc(db, 'subjects', id));
                return docSnap.exists() ? docSnap.data().name : id;
              }));
              setSubjectNames(names);
            }
            if (tData.classes) {
              const names = await Promise.all(tData.classes.map(async (id: string) => {
                const docSnap = await getDoc(doc(db, 'classes', id));
                return docSnap.exists() ? docSnap.data().name : id;
              }));
              setAssignedClasses(names);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching extra profile data:', err);
      }
    };
    fetchExtraData();
  }, [user]);

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdateLoading(true);
    setProfileError(null);
    setProfileSuccess(null);

    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        name: profileData.name,
        phone: profileData.phone,
        address: profileData.address,
        updatedAt: new Date().toISOString()
      });

      if (user.role === 'student') {
        const sid = user.studentId || user.uid;
        const studentRef = doc(db, 'students', sid);
        const studentDoc = await getDoc(studentRef);
        if (studentDoc.exists()) {
          await updateDoc(studentRef, {
            name: profileData.name,
            phone: profileData.phone,
            updatedAt: new Date().toISOString(),
          });
        }
      } else if (user.role === 'parent') {
        const linkedIds: string[] = [
          ...(user.studentIds ?? []),
          ...(user.studentId ? [user.studentId] : []),
        ].filter(Boolean);
        const uniqueIds = [...new Set(linkedIds)];
        await Promise.all(
          uniqueIds.map(async (sid) => {
            const studentRef = doc(db, 'students', sid);
            const snap = await getDoc(studentRef);
            if (!snap.exists()) return;
            await updateDoc(studentRef, {
              'parentDetails.phone': profileData.phone,
              updatedAt: new Date().toISOString(),
            });
          }),
        );
      } else if (user.role === 'teacher') {
        const tid = user.teacherId || user.uid;
        const teacherRef = doc(db, 'teachers', tid);
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(teacherRef);
          if (!snap.exists()) return;
          const currentVersion = (snap.data().version ?? 0) as number;
          tx.update(teacherRef, {
            name: profileData.name,
            phone: profileData.phone,
            version: currentVersion + 1,
            updatedAt: new Date().toISOString(),
          });
        });
      }

      const roleSectionMap: Record<string, ActivitySection> = {
        super_admin: 'Super Admin',
        accountant: 'Accounts',
        teacher: 'Teachers',
        student: 'Students',
        parent: 'Parents',
        principal: 'Principal',
      };
      const section: ActivitySection = roleSectionMap[user.role] || 'Staff';
      const fieldsChanged: string[] = [];
      if (profileData.name !== (user.name || '')) fieldsChanged.push('name');
      if (profileData.phone !== (user.phone || '')) fieldsChanged.push('phone');
      if (profileData.address !== (user.address || '')) fieldsChanged.push('address');
      logActivity(user, 'Profile Updated', section, `Updated own profile`, { fieldsChanged });

      setProfileSuccess('Profile updated successfully!');
      setTimeout(() => setProfileSuccess(null), 3000);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'users');
      setProfileError('Failed to update profile');
    } finally {
      setUpdateLoading(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setProfileError('Please upload an image file');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileError('Image size should be less than 2MB');
      return;
    }

    setUploading(true);
    setProfileError(null);

    try {
      const storageRef = ref(storage, `profiles/${user.uid}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);

      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { photoURL: downloadURL });

      setProfileData(prev => ({ ...prev, photoURL: downloadURL }));
      setProfileSuccess('Profile photo updated!');
      setTimeout(() => setProfileSuccess(null), 3000);
    } catch (err) {
      console.error('Error uploading photo:', err);
      setProfileError('Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    setPasswordError(null);
    setPasswordSuccess(null);

    try {
      const currentUser = auth.currentUser;
      if (!currentUser || !currentUser.email) return;

      const credential = EmailAuthProvider.credential(currentUser.email, passwordForm.currentPassword);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, passwordForm.newPassword);

      setPasswordSuccess('Password changed successfully!');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => setPasswordSuccess(null), 3000);
    } catch (err: any) {
      if (err.code === 'auth/wrong-password') {
        setPasswordError('Current password is incorrect');
      } else {
        setPasswordError('Failed to change password. Please try logging in again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const isSuperAdmin = user.role === 'super_admin';
  const canUploadPhoto = user.role === 'super_admin' || user.role === 'principal' || user.role === 'office_staff';
  const initials = (user.name || user.email || 'U')[0].toUpperCase();

  return (
    <div className="stack pad">
      <div className="topbar">
        <div>
          <div className="eyebrow">{user.role.replace('_', ' ')}</div>
          <h1>Profile</h1>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {uploading ? (
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--cream-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader2 style={{ width: 28, height: 28, color: 'var(--accent)' }} className="animate-spin" />
            </div>
          ) : profileData.photoURL ? (
            <img
              src={profileData.photoURL}
              alt={user.name || user.email || 'User'}
              style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--line)' }}
            />
          ) : (
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--cream-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem', fontWeight: 700, color: 'var(--ink)' }}>
              {initials}
            </div>
          )}
          {canUploadPhoto && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="icon-btn"
                title="Change Photo"
                style={{ position: 'absolute', bottom: -4, right: -4, width: 28, height: 28, borderRadius: '50%', background: 'var(--paper)', border: '1px solid var(--line)' }}
              >
                <Camera style={{ width: 14, height: 14 }} />
              </button>
              <input type="file" ref={fileInputRef} onChange={handlePhotoUpload} accept="image/*" style={{ display: 'none' }} />
            </>
          )}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--ink)' }}>{user.name || user.email || 'User'}</div>
          <span className="chip solid" style={{ marginTop: '0.25rem', display: 'inline-block' }}>{user.role.replace('_', ' ')}</span>
          <div className="muted" style={{ fontSize: '0.78rem', marginTop: '0.25rem' }}>{user.email}</div>
        </div>
      </div>

      <div className="card stack">
        <div className="eyebrow">Identity Details</div>

        {user.schoolNumber && (
          <IdentityRow label="School Number" value={user.schoolNumber} />
        )}

        {user.role === 'student' && studentData && (
          <>
            <IdentityRow label="Admission Number" value={studentData.admissionNumber} />
            <IdentityRow label="Class & Section" value={`${className} – ${studentData.section}`} />
            <IdentityRow label="House" value={houseName || 'Not Assigned'} />
          </>
        )}

        {user.role === 'parent' && parentStudents.length > 0 && (
          <div className="stack">
            <div className="eyebrow" style={{ marginTop: '0.5rem' }}>Linked Students</div>
            {parentStudents.map(s => (
              <div key={s.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem' }}>
                <Avatar name={s.name} size="sm" />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{s.name}</div>
                  <div className="muted" style={{ fontSize: '0.7rem' }}>{s.schoolNumber}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {user.role === 'teacher' && teacherData && (
          <>
            <IdentityRow label="Employee ID" value={teacherData.id} />
            {teacherData.joiningDetails && <IdentityRow label="Joining Details" value={teacherData.joiningDetails} />}
            {assignedClasses.length > 0 && <IdentityRow label="Assigned Classes" value={assignedClasses.join(', ')} />}
            {subjectNames.length > 0 && <IdentityRow label="Subjects" value={subjectNames.join(', ')} />}
            {teacherData.isHouseIncharge && <IdentityRow label="Special Role" value="House In-charge" />}
          </>
        )}

        {(user.role === 'principal' || user.role === 'accounts' || user.role === 'super_admin') && (
          <IdentityRow label="Staff Role" value={user.role.replace('_', ' ').toUpperCase()} />
        )}
      </div>

      <div className="card stack">
        <div className="section-head">
          General Information
          {!isSuperAdmin && <span className="muted" style={{ fontSize: '0.7rem', fontWeight: 400, marginLeft: '0.5rem' }}>read-only</span>}
        </div>

        <form onSubmit={handleProfileUpdate} className="stack">
          <FormField label="Full Name">
            <Input
              value={profileData.name}
              onChange={(e) => setProfileData({ ...profileData, name: e.target.value })}
              placeholder="Full name"
              required
              disabled={!isSuperAdmin}
            />
          </FormField>

          <FormField label="Phone Number">
            <Input
              value={profileData.phone}
              onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
              placeholder="Contact number"
              disabled={!isSuperAdmin}
            />
          </FormField>

          <FormField label="Email Address (Login Identity)">
            <Input value={profileData.email} disabled />
          </FormField>

          <FormField label="Physical Address">
            <textarea
              value={profileData.address}
              onChange={(e) => setProfileData({ ...profileData, address: e.target.value })}
              style={{ width: '100%', minHeight: 90, padding: '0.625rem 0.75rem', background: 'var(--cream)', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit', fontSize: '0.875rem', resize: 'vertical', color: 'var(--ink)' }}
              placeholder="Enter residence address"
              disabled={!isSuperAdmin}
            />
          </FormField>

          {isSuperAdmin && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexDirection: 'column' }}>
              {profileError && <span style={{ color: 'var(--coral)', fontSize: '0.8rem' }}>{profileError}</span>}
              {profileSuccess && <span style={{ color: 'var(--leaf)', fontSize: '0.8rem' }}>{profileSuccess}</span>}
              <Button type="submit" loading={updateLoading}>
                Update Profile
              </Button>
            </div>
          )}
        </form>
      </div>

      <div className="card stack">
        <div className="section-head">
          <Lock style={{ width: 16, height: 16, display: 'inline', marginRight: '0.4rem' }} />
          Change Password
        </div>

        <form onSubmit={handlePasswordChange} className="stack">
          <FormField label="Current Password">
            <div style={{ position: 'relative' }}>
              <Input
                type={showCurrentPassword ? 'text' : 'password'}
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', opacity: 0.5 }}
              >
                {showCurrentPassword ? <EyeOff style={{ width: 16, height: 16 }} /> : <Eye style={{ width: 16, height: 16 }} />}
              </button>
            </div>
          </FormField>

          <FormField label="New Password">
            <div style={{ position: 'relative' }}>
              <Input
                type={showNewPassword ? 'text' : 'password'}
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                placeholder="Min. 6 characters"
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', opacity: 0.5 }}
              >
                {showNewPassword ? <EyeOff style={{ width: 16, height: 16 }} /> : <Eye style={{ width: 16, height: 16 }} />}
              </button>
            </div>
          </FormField>

          <FormField label="Confirm New Password">
            <Input
              type="password"
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
              placeholder="Repeat new password"
              required
            />
          </FormField>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {passwordError && <span style={{ color: 'var(--coral)', fontSize: '0.8rem' }}>{passwordError}</span>}
            {passwordSuccess && <span style={{ color: 'var(--leaf)', fontSize: '0.8rem' }}>{passwordSuccess}</span>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit" variant="secondary" disabled={loading}>
                {loading ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : 'Confirm Change'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function IdentityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <span className="muted" style={{ fontSize: '0.78rem' }}>{label}</span>
      <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{value || 'N/A'}</span>
    </div>
  );
}
