import { UserProfile, Student } from '../../types';
import { useState, useEffect } from 'react';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase';
import { Eye, EyeOff } from 'lucide-react';
import { FormField, Input, Modal } from '../../components/ui';

interface StudentProfileProps {
  user: UserProfile;
  student: Student | null;
}

export default function StudentProfile({ user, student }: StudentProfileProps) {
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [show, setShow] = useState({ current: false, next: false, confirm: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [className, setClassName] = useState<string>('');

  useEffect(() => {
    if (student?.classId) {
      const fetchClass = async () => {
        try {
          const classDoc = await getDoc(doc(db, 'classes', student.classId));
          if (classDoc.exists()) {
            setClassName(classDoc.data().name);
          } else {
            setClassName(student.classId);
          }
        } catch (err) {
          setClassName(student.classId);
        }
      };
      fetchClass();
    }
  }, [student?.classId]);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser || !currentUser.email) throw new Error('No user logged in.');

      const credential = EmailAuthProvider.credential(currentUser.email, passwordData.currentPassword);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, passwordData.newPassword);

      setSuccess('Password updated successfully!');
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Current password is incorrect.');
      } else {
        setError(err.message || 'Failed to update password.');
      }
    } finally {
      setLoading(false);
    }
  };

  const initials = user.name
    ? user.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  return (
    <div>
      {/* Topbar */}
      <div className="topbar">
        <div>
          <div className="eyebrow">Student Portal</div>
          <h1>Profile</h1>
        </div>
      </div>

      <div className="pad" style={{ paddingTop: 16, paddingBottom: 32 }}>
        <div className="stack">

          {/* Identity card */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  width: 80, height: 80, borderRadius: '50%',
                  background: 'var(--ink)', color: 'var(--cream)',
                  display: 'grid', placeItems: 'center',
                  fontFamily: 'var(--display)', fontWeight: 700, fontSize: 28,
                  flexShrink: 0,
                }}
              >
                {initials}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 20, lineHeight: 1.1 }} className="display">
                  {user.name}
                </div>
                <div className="mono" style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 4 }}>
                  {student?.admissionNumber || student?.schoolNumber || '—'}
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {className && (
                    <span className="chip solid" style={{ fontSize: 11 }}>
                      Class {className}{student?.section ? `–${student.section}` : ''}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Info rows */}
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 12 }}>Account Details</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {[
                { label: 'Admission No.', value: student?.admissionNumber || student?.schoolNumber || '—' },
                { label: 'Class', value: className ? `Class ${className}` : '—' },
                { label: 'Section', value: student?.section || '—' },
                ...(student?.houseId ? [{ label: 'House', value: student.houseId }] : []),
                { label: 'Email', value: user.email },
              ].map((row, i, arr) => (
                <div
                  key={row.label}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 0',
                    borderBottom: i < arr.length - 1 ? '1px solid var(--line-2)' : 'none',
                  }}
                >
                  <span className="muted tiny">{row.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 500, textAlign: 'right', maxWidth: '60%', wordBreak: 'break-all' }}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Password change card */}
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 14 }}>Change Password</div>
            <form onSubmit={handlePasswordChange}>
              <div className="stack">
                <FormField label="Current Password" required>
                  <div style={{ position: 'relative' }}>
                    <Input
                      type={show.current ? 'text' : 'password'}
                      placeholder="Enter current password"
                      required
                      value={passwordData.currentPassword}
                      onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => setShow(s => ({ ...s, current: !s.current }))}
                      style={{
                        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)',
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      {show.current ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </FormField>

                <FormField label="New Password" required>
                  <div style={{ position: 'relative' }}>
                    <Input
                      type={show.next ? 'text' : 'password'}
                      placeholder="Enter new password"
                      required
                      value={passwordData.newPassword}
                      onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => setShow(s => ({ ...s, next: !s.next }))}
                      style={{
                        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)',
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      {show.next ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </FormField>

                <FormField label="Confirm New Password" required>
                  <div style={{ position: 'relative' }}>
                    <Input
                      type={show.confirm ? 'text' : 'password'}
                      placeholder="Confirm new password"
                      required
                      value={passwordData.confirmPassword}
                      onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => setShow(s => ({ ...s, confirm: !s.confirm }))}
                      style={{
                        position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)',
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      {show.confirm ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </FormField>

                {/* Inline status — not a full-width alert */}
                {error && (
                  <p style={{ fontSize: 13, color: 'var(--coral)', marginTop: 4 }}>{error}</p>
                )}
                {success && (
                  <p style={{ fontSize: 13, color: 'var(--leaf)', marginTop: 4 }}>{success}</p>
                )}

                <button type="submit" className="btn accent" disabled={loading}>
                  {loading ? 'Updating…' : 'Change Password'}
                </button>
              </div>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}
