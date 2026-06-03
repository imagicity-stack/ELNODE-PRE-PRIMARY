import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebase';
import { UserProfile, Student, ExtendedStudentProfile } from '../../types';
import { getSiblingsByParent, SiblingInfo } from '../../services/siblingsService';
import { FormField, Input } from '../../components/ui';
import {
  X, Edit2, Save, User, Heart, Home as HomeIcon, Briefcase, BookOpen,
  Activity, Users, CreditCard, Camera, CheckCircle, AlertCircle,
  ExternalLink, Loader2, Image as ImageIcon,
} from 'lucide-react';

// ── Constants (same as student form) ─────────────────────────────────────────
const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa',
  'Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala',
  'Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland',
  'Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura',
  'Uttar Pradesh','Uttarakhand','West Bengal',
  'Delhi (NCT)','Jammu & Kashmir','Ladakh','Chandigarh','Puducherry',
  'Andaman & Nicobar Islands','Dadra & Nagar Haveli and Daman & Diu','Lakshadweep',
];
const QUALIFICATIONS = [
  'Illiterate','Below Primary','Primary (Class 1–5)','Middle (Class 6–8)',
  'Secondary / Matric (10th)','Senior Secondary (12th)','Diploma / ITI',
  'Graduate (BA/BSc/BCom)','Post Graduate (MA/MSc/MCom)',
  'Professional Degree (MBBS/BTech/LLB/CA)','Doctorate (PhD)',
];
const INCOME_BRACKETS = [
  'Below ₹1 Lakh','₹1–2 Lakh','₹2–5 Lakh','₹5–10 Lakh',
  '₹10–20 Lakh','₹20–50 Lakh','Above ₹50 Lakh',
];

const COMPLETION_CHECKS = [
  (p: Partial<ExtendedStudentProfile>) => !!p.dateOfBirth,
  (p: Partial<ExtendedStudentProfile>) => !!p.bloodGroup,
  (p: Partial<ExtendedStudentProfile>) => !!p.religion,
  (p: Partial<ExtendedStudentProfile>) => !!p.category,
  (p: Partial<ExtendedStudentProfile>) => !!p.nationality,
  (p: Partial<ExtendedStudentProfile>) => !!p.motherTongue,
  (p: Partial<ExtendedStudentProfile>) => !!p.aadhaarNumber,
  (p: Partial<ExtendedStudentProfile>) => !!p.permanentAddress?.city,
  (p: Partial<ExtendedStudentProfile>) => !!p.permanentAddress?.state,
  (p: Partial<ExtendedStudentProfile>) => !!p.permanentAddress?.pinCode,
  (p: Partial<ExtendedStudentProfile>) => !!p.father?.name,
  (p: Partial<ExtendedStudentProfile>) => !!p.father?.phone,
  (p: Partial<ExtendedStudentProfile>) => !!p.father?.occupation,
  (p: Partial<ExtendedStudentProfile>) => !!p.father?.qualification,
  (p: Partial<ExtendedStudentProfile>) => !!p.mother?.name,
  (p: Partial<ExtendedStudentProfile>) => !!p.mother?.phone,
  (p: Partial<ExtendedStudentProfile>) => !!p.previousSchool?.name,
  (p: Partial<ExtendedStudentProfile>) => !!p.health?.height,
  (p: Partial<ExtendedStudentProfile>) => !!p.health?.weight,
  (p: Partial<ExtendedStudentProfile>) => !!p.idCardFrontUrl,
  (p: Partial<ExtendedStudentProfile>) => !!p.idCardBackUrl,
];
function computeCompletion(p: Partial<ExtendedStudentProfile>) {
  return Math.round((COMPLETION_CHECKS.filter(fn => fn(p)).length / COMPLETION_CHECKS.length) * 100);
}

// ── Info row (read-only display) ──────────────────────────────────────────────
function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--line-2)' }}>
      <span style={{ fontSize: 12, color: 'var(--ink-3)', flexShrink: 0, paddingTop: 2, minWidth: 130 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, textAlign: 'right', color: value ? 'var(--ink)' : 'var(--ink-4)', wordBreak: 'break-word', maxWidth: '60%' }}>
        {value || '—'}
      </span>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
      <div className="section-icon" style={{ width: 28, height: 28, borderRadius: 7 }}>
        <Icon size={14} style={{ color: 'var(--ink-2)' }} />
      </div>
      <p style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
interface StudentProfileViewProps {
  student: Student;
  user: UserProfile;
  className?: string;
  onClose: () => void;
}

export default function StudentProfileView({ student, user, onClose }: StudentProfileViewProps) {
  const [profile, setProfile] = useState<Partial<ExtendedStudentProfile> | null>(null);
  const [editedProfile, setEditedProfile] = useState<Partial<ExtendedStudentProfile>>({});
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingIdCard, setUploadingIdCard] = useState<string | null>(null); // e.g. 'student-front', 'father-back'
  const [idCardProgress, setIdCardProgress] = useState(0);
  const [error, setError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  // Shared pair for all ID card uploads, routed via pendingPickerRef
  const idCardCameraRef = React.useRef<HTMLInputElement>(null);
  const idCardGalleryRef = React.useRef<HTMLInputElement>(null);
  const pendingPickerRef = React.useRef<string | null>(null);

  // Student profile photo (avatar)
  const [photoURL, setPhotoURL] = useState(student.photoURL || '');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoProgress, setPhotoProgress] = useState(0);
  const photoGalleryRef = React.useRef<HTMLInputElement>(null);
  const photoCameraRef = React.useRef<HTMLInputElement>(null);

  // Camera / Gallery chooser ('photo' or e.g. 'student-front', 'father-back')
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const openPicker = (kind: 'camera' | 'gallery') => {
    const target = pickerFor;
    setPickerFor(null);
    if (target === 'photo') {
      (kind === 'camera' ? photoCameraRef : photoGalleryRef).current?.click();
    } else {
      pendingPickerRef.current = target;
      (kind === 'camera' ? idCardCameraRef : idCardGalleryRef).current?.click();
    }
  };

  useEffect(() => {
    getDoc(doc(db, 'studentProfiles', student.id)).then(snap => {
      const data = snap.exists() ? (snap.data() as ExtendedStudentProfile) : null;
      setProfile(data);
      setEditedProfile(data || {
        father: { name: student.parentDetails?.fatherName, phone: student.parentDetails?.phone, email: student.parentDetails?.email },
        mother: { name: student.parentDetails?.motherName },
        nationality: 'Indian',
      });
    }).catch(() => {
      setProfile(null);
      setEditedProfile({});
    }).finally(() => setLoading(false));
  }, [student.id]);

  // Auto-detected siblings (other students sharing this student's parent).
  const [autoSiblings, setAutoSiblings] = useState<SiblingInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    getSiblingsByParent(student).then(sibs => {
      if (cancelled) return;
      setAutoSiblings(sibs);
      // Persist onto this student's profile so the student's own portal (which
      // cannot enumerate the roster) can display siblings too.
      const stored = (profile?.siblings || []).map(s => s.admissionNumber).sort().join('|');
      const fresh = sibs.map(s => s.admissionNumber).sort().join('|');
      if (sibs.length > 0 && stored !== fresh) {
        setDoc(
          doc(db, 'studentProfiles', student.id),
          { siblings: sibs.map(({ name, admissionNumber, class: cls }) => ({ name, admissionNumber, class: cls })) },
          { merge: true },
        ).catch(() => {});
      }
    });
    return () => { cancelled = true; };
  }, [student.id, profile]);

  const displayed = editMode ? editedProfile : (profile || {});

  const set = (path: string, value: any) => {
    setEditedProfile(prev => {
      const next = { ...prev } as any;
      const parts = path.split('.');
      let obj = next;
      for (let i = 0; i < parts.length - 1; i++) {
        obj[parts[i]] = { ...obj[parts[i]] };
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
      return next;
    });
  };

  // Resumable upload helper. Admin uploads go under profiles/{adminUid}/ which
  // the Storage rule allows via request.auth.uid == userId — no studentProfiles
  // rule / Firestore lookup needed, so this works regardless of rule deploy state.
  const resumableUpload = (
    file: File,
    path: string,
    onProgress: (pct: number) => void,
  ) => new Promise<string>((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, path), file, { contentType: file.type || 'image/jpeg' });
    task.on('state_changed',
      snap => onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      reject,
      async () => { try { resolve(await getDownloadURL(task.snapshot.ref)); } catch (e) { reject(e); } },
    );
  });

  const uploadIdCard = async (file: File, target: string) => {
    const mimeType = file.type || 'image/jpeg';
    if (!mimeType.startsWith('image/')) { setError('Please choose an image file.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Image must be under 5 MB.'); return; }
    const dashIdx = target.indexOf('-');
    const person = target.slice(0, dashIdx); // 'student' | 'father' | 'mother' | 'guardian'
    const side = target.slice(dashIdx + 1) as 'front' | 'back';
    setUploadingIdCard(target);
    setIdCardProgress(0);
    setError('');
    try {
      const safeName = (file.name || `${target}-id`).replace(/[^\w.\-]/g, '_');
      const path = `profiles/${user.uid}/studentIdCards/${student.id}/${target}-${Date.now()}_${safeName}`;
      const url = await resumableUpload(file, path, setIdCardProgress);
      const urlKey = side === 'front' ? 'idCardFrontUrl' : 'idCardBackUrl';
      const pathKey = side === 'front' ? 'idCardFrontPath' : 'idCardBackPath';
      if (person === 'student') {
        setEditedProfile(prev => ({ ...prev, [urlKey]: url, [pathKey]: path }));
        // Also update displayed profile so it reflects immediately even outside editMode
        setProfile(prev => prev ? { ...prev, [urlKey]: url, [pathKey]: path } : prev);
      } else {
        setEditedProfile(prev => ({
          ...prev,
          [person]: { ...(prev as any)[person], [urlKey]: url, [pathKey]: path },
        }));
        setProfile(prev => prev ? {
          ...prev,
          [person]: { ...(prev as any)[person], [urlKey]: url, [pathKey]: path },
        } : prev);
      }
    } catch (err: any) {
      setError(err?.code === 'storage/unauthorized'
        ? 'Upload not permitted. Please re-login and retry.'
        : `Photo upload failed${err?.message ? `: ${err.message}` : ''}.`);
    } finally {
      setUploadingIdCard(null);
      setIdCardProgress(0);
    }
  };

  const handleIdCardPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    const target = pendingPickerRef.current;
    pendingPickerRef.current = null;
    if (f && target) uploadIdCard(f, target);
  };

  const uploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const mimeType = file.type || 'image/jpeg';
    if (!mimeType.startsWith('image/')) { setError('Please choose an image file.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Image must be under 5 MB.'); return; }
    setUploadingPhoto(true);
    setPhotoProgress(0);
    setError('');
    try {
      const safeName = (file.name || 'photo').replace(/[^\w.\-]/g, '_');
      const path = `profiles/${user.uid}/studentPhotos/${student.id}/${Date.now()}_${safeName}`;
      const url = await resumableUpload(file, path, setPhotoProgress);
      await updateDoc(doc(db, 'students', student.id), { photoURL: url, updatedAt: new Date().toISOString() });
      setPhotoURL(url);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setError(err?.code === 'storage/unauthorized'
        ? 'Photo upload not permitted. Please re-login and retry.'
        : `Failed to update photo${err?.message ? `: ${err.message}` : ''}.`);
    } finally {
      setUploadingPhoto(false);
      setPhotoProgress(0);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const completion = computeCompletion(editedProfile);
      const data: ExtendedStudentProfile = {
        ...(editedProfile as ExtendedStudentProfile),
        studentId: student.id,
        completionPercentage: completion,
        updatedAt: new Date().toISOString(),
        updatedBy: user.uid,
        updatedByName: user.name,
      };
      await setDoc(doc(db, 'studentProfiles', student.id), data, { merge: true });
      setProfile(data);
      setEditedProfile(data);
      setEditMode(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch { setError('Failed to save. Please retry.'); }
    finally { setSaving(false); }
  };

  const completion = computeCompletion(displayed);
  const completionColor = completion === 100 ? 'var(--leaf)' : completion >= 60 ? 'var(--accent)' : 'var(--coral)';

  return (
    <>
      {/* Backdrop */}
      <div
        className="lg:hidden fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
      />
      <div
        className="profile-drawer fixed inset-y-0 right-0 z-50 flex flex-col"
        style={{ width: '100%', maxWidth: 640, background: 'var(--paper)', borderLeft: '1px solid var(--line)', boxShadow: '-8px 0 32px rgba(0,0,0,0.1)' }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {uploadingPhoto
              ? <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--cream-2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent)' }} />
                  <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--accent)' }}>{photoProgress}%</span>
                </div>
              : photoURL
                ? <img src={photoURL} alt={student.name} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
                : <div className="avatar" style={{ width: 44, height: 44, fontSize: 16 }}>{student.name.charAt(0).toUpperCase()}</div>
            }
            <button
              type="button"
              disabled={uploadingPhoto}
              onClick={() => setPickerFor('photo')}
              title="Change student photo"
              style={{ position: 'absolute', bottom: -4, right: -4, width: 22, height: 22, borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--paper)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
            >
              <Camera size={11} style={{ color: 'var(--accent-ink)' }} />
            </button>
            <input ref={photoCameraRef} type="file" accept="image/*" capture="user" style={{ display: 'none' }} onChange={uploadAvatar} />
            <input ref={photoGalleryRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={uploadAvatar} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink)' }} className="display">{student.name}</p>
            <p style={{ fontSize: 12, color: 'var(--ink-3)' }} className="mono">{student.admissionNumber}</p>
          </div>
          {/* Completion ring */}
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', border: `3px solid ${completionColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: completionColor, fontFamily: 'var(--display)' }}>{completion}%</span>
            </div>
            <p style={{ fontSize: 9, color: 'var(--ink-3)', marginTop: 2 }}>Profile</p>
          </div>
          {/* Actions */}
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {!editMode ? (
              <button className="btn ghost" style={{ fontSize: 13, padding: '6px 12px' }} onClick={() => { setEditMode(true); setEditedProfile(profile || {}); }}>
                <Edit2 size={14} /> Edit
              </button>
            ) : (
              <>
                <button className="btn ghost" style={{ fontSize: 13, padding: '6px 12px' }} onClick={() => { setEditMode(false); setEditedProfile(profile || {}); setError(''); }}>
                  Cancel
                </button>
                <button className="btn accent" style={{ fontSize: 13, padding: '6px 12px' }} onClick={handleSave} disabled={saving}>
                  <Save size={14} /> {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
            <button className="icon-btn" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', paddingTop: 60 }}>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto" style={{ borderColor: 'var(--ink)' }} />
            </div>
          ) : (
            <div className="stack">
              {/* Status */}
              {saveSuccess && (
                <div style={{ background: '#f0fdf4', border: '1px solid var(--leaf)', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={16} style={{ color: 'var(--leaf)' }} />
                  <span style={{ fontSize: 13, color: 'var(--leaf)', fontWeight: 600 }}>Profile saved successfully!</span>
                </div>
              )}
              {error && (
                <div style={{ background: '#fef2f2', border: '1px solid var(--coral)', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertCircle size={16} style={{ color: 'var(--coral)' }} />
                  <span style={{ fontSize: 13, color: 'var(--coral)' }}>{error}</span>
                </div>
              )}
              {!profile && !editMode && (
                <div style={{ background: 'var(--cream-2)', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <AlertCircle size={16} style={{ color: 'var(--ink-3)' }} />
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600 }}>Profile not yet filled</p>
                    <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>The student hasn't updated their extended profile. Click Edit to fill it manually.</p>
                  </div>
                </div>
              )}

              {/* Student's ID Card Photos — always visible to admin */}
              <div className="card">
                <SectionTitle icon={CreditCard} title="Student's Identity Document" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                  {(['front', 'back'] as const).map(side => {
                    const target = `student-${side}`;
                    const url = side === 'front' ? displayed.idCardFrontUrl : displayed.idCardBackUrl;
                    const uploading = uploadingIdCard === target;
                    const progress = uploading ? idCardProgress : 0;
                    return (
                      <div key={side}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 6, textTransform: 'uppercase' }}>
                          {side === 'front' ? 'Front' : 'Back'} {!url && <span style={{ color: 'var(--coral)' }}>Missing</span>}
                        </p>
                        <div
                          onClick={() => !uploading && !url && setPickerFor(target)}
                          style={{ border: `2px dashed ${url ? 'var(--leaf)' : 'var(--line)'}`, borderRadius: 10, minHeight: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: !url ? 'pointer' : 'default', overflow: 'hidden', position: 'relative', background: 'var(--cream)', padding: 8 }}
                        >
                          {uploading ? (
                            <>
                              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--accent)', marginBottom: 6 }} />
                              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>Uploading… {progress}%</p>
                              <div className="profile-completion-bar" style={{ width: '80%' }}>
                                <div className="profile-completion-fill" style={{ width: `${progress}%`, background: 'var(--accent)' }} />
                              </div>
                            </>
                          ) : url ? (
                            <img src={url} alt={`ID ${side}`} style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} />
                          ) : (
                            <div style={{ textAlign: 'center' }}>
                              <Camera size={20} style={{ color: 'var(--ink-3)', margin: '0 auto 4px' }} />
                              <p style={{ fontSize: 11, color: 'var(--ink-3)' }}>Click to upload</p>
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                          {!uploading && (
                            <button type="button" className="btn ghost" style={{ fontSize: 11, padding: '3px 10px', width: 'auto' }} onClick={() => setPickerFor(target)}>
                              <Camera size={11} /> {url ? 'Replace' : 'Upload'}
                            </button>
                          )}
                          {url && <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 3 }}><ExternalLink size={10} /> View full</a>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Personal Information */}
              <div className="card">
                <SectionTitle icon={User} title="Personal Information" />
                {editMode ? (
                  <div className="form-grid" style={{ marginTop: 12 }}>
                    <FormField label="Date of Birth"><Input type="date" value={displayed.dateOfBirth || ''} onChange={e => set('dateOfBirth', e.target.value)} /></FormField>
                    <FormField label="Blood Group">
                      <select className="input" value={displayed.bloodGroup || ''} onChange={e => set('bloodGroup', e.target.value)}>
                        <option value="">Select</option>
                        {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(g => <option key={g}>{g}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Religion">
                      <select className="input" value={displayed.religion || ''} onChange={e => set('religion', e.target.value)}>
                        <option value="">Select</option>
                        {['Hindu','Muslim','Christian','Sikh','Buddhist','Jain','Parsi','Jewish','Other'].map(r => <option key={r}>{r}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Category">
                      <select className="input" value={displayed.category || ''} onChange={e => set('category', e.target.value)}>
                        <option value="">Select</option>
                        {['General','OBC','SC','ST','EWS'].map(c => <option key={c}>{c}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Nationality"><Input value={displayed.nationality || ''} onChange={e => set('nationality', e.target.value)} /></FormField>
                    <FormField label="Mother Tongue"><Input value={displayed.motherTongue || ''} onChange={e => set('motherTongue', e.target.value)} /></FormField>
                    <FormField label="Languages Known"><Input value={displayed.languagesKnown || ''} onChange={e => set('languagesKnown', e.target.value)} /></FormField>
                    <FormField label="Aadhaar Number"><Input value={displayed.aadhaarNumber || ''} maxLength={12} onChange={e => set('aadhaarNumber', e.target.value.replace(/\D/g,''))} /></FormField>
                    <FormField label="Passport No."><Input value={displayed.passportNumber || ''} onChange={e => set('passportNumber', e.target.value)} /></FormField>
                    <FormField label="Identification Marks"><Input value={displayed.identificationMarks || ''} onChange={e => set('identificationMarks', e.target.value)} /></FormField>
                  </div>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    <InfoRow label="Date of Birth" value={displayed.dateOfBirth} />
                    <InfoRow label="Blood Group" value={displayed.bloodGroup} />
                    <InfoRow label="Religion" value={displayed.religion} />
                    <InfoRow label="Category" value={displayed.category} />
                    <InfoRow label="Nationality" value={displayed.nationality} />
                    <InfoRow label="Mother Tongue" value={displayed.motherTongue} />
                    <InfoRow label="Languages Known" value={displayed.languagesKnown} />
                    <InfoRow label="Aadhaar Number" value={displayed.aadhaarNumber} />
                    <InfoRow label="Passport No." value={displayed.passportNumber} />
                    <InfoRow label="Identification Marks" value={displayed.identificationMarks} />
                  </div>
                )}
              </div>

              {/* Permanent Address */}
              <div className="card">
                <SectionTitle icon={HomeIcon} title="Permanent Address" />
                {editMode ? (
                  <div className="form-grid" style={{ marginTop: 12 }}>
                    <FormField label="House/Flat No."><Input value={displayed.permanentAddress?.house || ''} onChange={e => set('permanentAddress.house', e.target.value)} /></FormField>
                    <FormField label="Street/Colony"><Input value={displayed.permanentAddress?.street || ''} onChange={e => set('permanentAddress.street', e.target.value)} /></FormField>
                    <FormField label="City"><Input value={displayed.permanentAddress?.city || ''} onChange={e => set('permanentAddress.city', e.target.value)} /></FormField>
                    <FormField label="State">
                      <select className="input" value={displayed.permanentAddress?.state || ''} onChange={e => set('permanentAddress.state', e.target.value)}>
                        <option value="">Select</option>
                        {INDIAN_STATES.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </FormField>
                    <FormField label="PIN Code"><Input value={displayed.permanentAddress?.pinCode || ''} maxLength={6} onChange={e => set('permanentAddress.pinCode', e.target.value.replace(/\D/g,''))} /></FormField>
                    <FormField label="Country"><Input value={displayed.permanentAddress?.country || 'India'} onChange={e => set('permanentAddress.country', e.target.value)} /></FormField>
                  </div>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    <InfoRow label="House/Flat" value={displayed.permanentAddress?.house} />
                    <InfoRow label="Street/Colony" value={displayed.permanentAddress?.street} />
                    <InfoRow label="City" value={displayed.permanentAddress?.city} />
                    <InfoRow label="State" value={displayed.permanentAddress?.state} />
                    <InfoRow label="PIN Code" value={displayed.permanentAddress?.pinCode} />
                    <InfoRow label="Country" value={displayed.permanentAddress?.country} />
                  </div>
                )}
              </div>

              {/* Father */}
              <div className="card">
                <SectionTitle icon={Briefcase} title="Father's Details" />
                {editMode ? (
                  <div className="form-grid" style={{ marginTop: 12 }}>
                    <FormField label="Full Name"><Input value={displayed.father?.name || ''} onChange={e => set('father.name', e.target.value)} /></FormField>
                    <FormField label="Date of Birth"><Input type="date" value={displayed.father?.dob || ''} onChange={e => set('father.dob', e.target.value)} /></FormField>
                    <FormField label="Qualification">
                      <select className="input" value={displayed.father?.qualification || ''} onChange={e => set('father.qualification', e.target.value)}>
                        <option value="">Select</option>{QUALIFICATIONS.map(q => <option key={q}>{q}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Occupation"><Input value={displayed.father?.occupation || ''} onChange={e => set('father.occupation', e.target.value)} /></FormField>
                    <FormField label="Organization"><Input value={displayed.father?.organization || ''} onChange={e => set('father.organization', e.target.value)} /></FormField>
                    <FormField label="Annual Income">
                      <select className="input" value={displayed.father?.annualIncome || ''} onChange={e => set('father.annualIncome', e.target.value)}>
                        <option value="">Select</option>{INCOME_BRACKETS.map(b => <option key={b}>{b}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Mobile"><Input value={displayed.father?.phone || ''} onChange={e => set('father.phone', e.target.value)} /></FormField>
                    <FormField label="Email"><Input type="email" value={displayed.father?.email || ''} onChange={e => set('father.email', e.target.value)} /></FormField>
                    <FormField label="Aadhaar"><Input value={displayed.father?.aadhaar || ''} maxLength={12} onChange={e => set('father.aadhaar', e.target.value.replace(/\D/g,''))} /></FormField>
                  </div>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    <InfoRow label="Full Name" value={displayed.father?.name} />
                    <InfoRow label="Date of Birth" value={displayed.father?.dob} />
                    <InfoRow label="Qualification" value={displayed.father?.qualification} />
                    <InfoRow label="Occupation" value={displayed.father?.occupation} />
                    <InfoRow label="Organization" value={displayed.father?.organization} />
                    <InfoRow label="Annual Income" value={displayed.father?.annualIncome} />
                    <InfoRow label="Mobile" value={displayed.father?.phone} />
                    <InfoRow label="Email" value={displayed.father?.email} />
                    <InfoRow label="Aadhaar" value={displayed.father?.aadhaar} />
                  </div>
                )}
                {/* Father ID card — upload in edit mode, view-only otherwise */}
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line-2)' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Father's ID Card <span style={{ color: 'var(--ink-4)', fontWeight: 500, textTransform: 'none' }}>(Aadhaar / PAN)</span>
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {(['front', 'back'] as const).map(side => {
                      const target = `father-${side}`;
                      const url = displayed.father?.[side === 'front' ? 'idCardFrontUrl' : 'idCardBackUrl'];
                      const uploading = uploadingIdCard === target;
                      const pct = uploading ? idCardProgress : 0;
                      return (
                        <div key={side}>
                          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 4, textTransform: 'uppercase' }}>{side === 'front' ? 'Front' : 'Back'}</p>
                          <div style={{ border: `2px dashed ${url ? 'var(--leaf)' : 'var(--line)'}`, borderRadius: 8, minHeight: 80, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative', background: 'var(--cream)', padding: 6 }}>
                            {uploading ? (
                              <>
                                <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent)', marginBottom: 4 }} />
                                <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)' }}>{pct}%</p>
                                <div className="profile-completion-bar" style={{ width: '80%', marginTop: 4 }}>
                                  <div className="profile-completion-fill" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
                                </div>
                              </>
                            ) : url ? (
                              <img src={url} alt={`Father ID ${side}`} style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} />
                            ) : (
                              <div style={{ textAlign: 'center' }}>
                                <CreditCard size={16} style={{ color: 'var(--ink-4)', margin: '0 auto 2px' }} />
                                <p style={{ fontSize: 10, color: 'var(--ink-4)' }}>{editMode ? 'Click Upload' : 'Not uploaded'}</p>
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            {editMode && !uploading && (
                              <button type="button" className="btn ghost" style={{ fontSize: 10, padding: '2px 8px', width: 'auto' }} onClick={() => setPickerFor(target)}>
                                <Camera size={10} /> {url ? 'Replace' : 'Upload'}
                              </button>
                            )}
                            {url && <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 2 }}><ExternalLink size={9} /> View</a>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Mother */}
              <div className="card">
                <SectionTitle icon={Heart} title="Mother's Details" />
                {editMode ? (
                  <div className="form-grid" style={{ marginTop: 12 }}>
                    <FormField label="Full Name"><Input value={displayed.mother?.name || ''} onChange={e => set('mother.name', e.target.value)} /></FormField>
                    <FormField label="Date of Birth"><Input type="date" value={displayed.mother?.dob || ''} onChange={e => set('mother.dob', e.target.value)} /></FormField>
                    <FormField label="Qualification">
                      <select className="input" value={displayed.mother?.qualification || ''} onChange={e => set('mother.qualification', e.target.value)}>
                        <option value="">Select</option>{QUALIFICATIONS.map(q => <option key={q}>{q}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Occupation"><Input value={displayed.mother?.occupation || ''} onChange={e => set('mother.occupation', e.target.value)} /></FormField>
                    <FormField label="Organization"><Input value={displayed.mother?.organization || ''} onChange={e => set('mother.organization', e.target.value)} /></FormField>
                    <FormField label="Annual Income">
                      <select className="input" value={displayed.mother?.annualIncome || ''} onChange={e => set('mother.annualIncome', e.target.value)}>
                        <option value="">Select</option>{INCOME_BRACKETS.map(b => <option key={b}>{b}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Mobile"><Input value={displayed.mother?.phone || ''} onChange={e => set('mother.phone', e.target.value)} /></FormField>
                    <FormField label="Email"><Input type="email" value={displayed.mother?.email || ''} onChange={e => set('mother.email', e.target.value)} /></FormField>
                    <FormField label="Aadhaar"><Input value={displayed.mother?.aadhaar || ''} maxLength={12} onChange={e => set('mother.aadhaar', e.target.value.replace(/\D/g,''))} /></FormField>
                  </div>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    <InfoRow label="Full Name" value={displayed.mother?.name} />
                    <InfoRow label="Date of Birth" value={displayed.mother?.dob} />
                    <InfoRow label="Qualification" value={displayed.mother?.qualification} />
                    <InfoRow label="Occupation" value={displayed.mother?.occupation} />
                    <InfoRow label="Organization" value={displayed.mother?.organization} />
                    <InfoRow label="Annual Income" value={displayed.mother?.annualIncome} />
                    <InfoRow label="Mobile" value={displayed.mother?.phone} />
                    <InfoRow label="Email" value={displayed.mother?.email} />
                    <InfoRow label="Aadhaar" value={displayed.mother?.aadhaar} />
                  </div>
                )}
                {/* Mother ID card */}
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line-2)' }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Mother's ID Card <span style={{ color: 'var(--ink-4)', fontWeight: 500, textTransform: 'none' }}>(Aadhaar / PAN)</span>
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {(['front', 'back'] as const).map(side => {
                      const target = `mother-${side}`;
                      const url = displayed.mother?.[side === 'front' ? 'idCardFrontUrl' : 'idCardBackUrl'];
                      const uploading = uploadingIdCard === target;
                      const pct = uploading ? idCardProgress : 0;
                      return (
                        <div key={side}>
                          <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 4, textTransform: 'uppercase' }}>{side === 'front' ? 'Front' : 'Back'}</p>
                          <div style={{ border: `2px dashed ${url ? 'var(--leaf)' : 'var(--line)'}`, borderRadius: 8, minHeight: 80, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative', background: 'var(--cream)', padding: 6 }}>
                            {uploading ? (
                              <>
                                <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent)', marginBottom: 4 }} />
                                <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)' }}>{pct}%</p>
                                <div className="profile-completion-bar" style={{ width: '80%', marginTop: 4 }}>
                                  <div className="profile-completion-fill" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
                                </div>
                              </>
                            ) : url ? (
                              <img src={url} alt={`Mother ID ${side}`} style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} />
                            ) : (
                              <div style={{ textAlign: 'center' }}>
                                <CreditCard size={16} style={{ color: 'var(--ink-4)', margin: '0 auto 2px' }} />
                                <p style={{ fontSize: 10, color: 'var(--ink-4)' }}>{editMode ? 'Click Upload' : 'Not uploaded'}</p>
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                            {editMode && !uploading && (
                              <button type="button" className="btn ghost" style={{ fontSize: 10, padding: '2px 8px', width: 'auto' }} onClick={() => setPickerFor(target)}>
                                <Camera size={10} /> {url ? 'Replace' : 'Upload'}
                              </button>
                            )}
                            {url && <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 2 }}><ExternalLink size={9} /> View</a>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Guardian (if any) */}
              {(displayed.hasGuardian || editMode) && (
                <div className="card">
                  <SectionTitle icon={Users} title="Guardian Details" />
                  {editMode && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!editedProfile.hasGuardian} onChange={e => set('hasGuardian', e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Guardian is different from parents</span>
                    </label>
                  )}
                  {displayed.hasGuardian && (
                    editMode ? (
                      <div className="form-grid">
                        <FormField label="Name"><Input value={displayed.guardian?.name || ''} onChange={e => set('guardian.name', e.target.value)} /></FormField>
                        <FormField label="Relation"><Input value={displayed.guardian?.relation || ''} onChange={e => set('guardian.relation', e.target.value)} /></FormField>
                        <FormField label="Mobile"><Input value={displayed.guardian?.phone || ''} onChange={e => set('guardian.phone', e.target.value)} /></FormField>
                        <FormField label="Address"><Input value={displayed.guardian?.address || ''} onChange={e => set('guardian.address', e.target.value)} /></FormField>
                      </div>
                    ) : (
                      <div style={{ marginTop: 10 }}>
                        <InfoRow label="Name" value={displayed.guardian?.name} />
                        <InfoRow label="Relation" value={displayed.guardian?.relation} />
                        <InfoRow label="Mobile" value={displayed.guardian?.phone} />
                        <InfoRow label="Address" value={displayed.guardian?.address} />
                      </div>
                    )
                  )}
                  {displayed.hasGuardian && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line-2)' }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Guardian's ID Card <span style={{ color: 'var(--ink-4)', fontWeight: 500, textTransform: 'none' }}>(Aadhaar / PAN)</span>
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {(['front', 'back'] as const).map(side => {
                          const target = `guardian-${side}`;
                          const url = displayed.guardian?.[side === 'front' ? 'idCardFrontUrl' : 'idCardBackUrl'];
                          const uploading = uploadingIdCard === target;
                          const pct = uploading ? idCardProgress : 0;
                          return (
                            <div key={side}>
                              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink-3)', marginBottom: 4, textTransform: 'uppercase' }}>{side === 'front' ? 'Front' : 'Back'}</p>
                              <div style={{ border: `2px dashed ${url ? 'var(--leaf)' : 'var(--line)'}`, borderRadius: 8, minHeight: 80, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative', background: 'var(--cream)', padding: 6 }}>
                                {uploading ? (
                                  <>
                                    <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent)', marginBottom: 4 }} />
                                    <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)' }}>{pct}%</p>
                                    <div className="profile-completion-bar" style={{ width: '80%', marginTop: 4 }}>
                                      <div className="profile-completion-fill" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
                                    </div>
                                  </>
                                ) : url ? (
                                  <img src={url} alt={`Guardian ID ${side}`} style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} />
                                ) : (
                                  <div style={{ textAlign: 'center' }}>
                                    <CreditCard size={16} style={{ color: 'var(--ink-4)', margin: '0 auto 2px' }} />
                                    <p style={{ fontSize: 10, color: 'var(--ink-4)' }}>{editMode ? 'Click Upload' : 'Not uploaded'}</p>
                                  </div>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                {editMode && !uploading && (
                                  <button type="button" className="btn ghost" style={{ fontSize: 10, padding: '2px 8px', width: 'auto' }} onClick={() => setPickerFor(target)}>
                                    <Camera size={10} /> {url ? 'Replace' : 'Upload'}
                                  </button>
                                )}
                                {url && <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 2 }}><ExternalLink size={9} /> View</a>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Previous School */}
              <div className="card">
                <SectionTitle icon={BookOpen} title="Previous Academic Record" />
                {editMode ? (
                  <div className="form-grid" style={{ marginTop: 12 }}>
                    <FormField label="School Name"><Input value={displayed.previousSchool?.name || ''} onChange={e => set('previousSchool.name', e.target.value)} /></FormField>
                    <FormField label="Board">
                      <select className="input" value={displayed.previousSchool?.board || ''} onChange={e => set('previousSchool.board', e.target.value)}>
                        <option value="">Select</option>
                        {['CBSE','ICSE','IGCSE','IB','State Board','Madrassa','Other'].map(b => <option key={b}>{b}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Last Class"><Input value={displayed.previousSchool?.lastClass || ''} onChange={e => set('previousSchool.lastClass', e.target.value)} /></FormField>
                    <FormField label="Year of Leaving"><Input value={displayed.previousSchool?.yearOfPassing || ''} maxLength={4} onChange={e => set('previousSchool.yearOfPassing', e.target.value)} /></FormField>
                    <FormField label="TC Number"><Input value={displayed.previousSchool?.tcNumber || ''} onChange={e => set('previousSchool.tcNumber', e.target.value)} /></FormField>
                    <FormField label="Reason for Transfer"><Input value={displayed.previousSchool?.reasonForTransfer || ''} onChange={e => set('previousSchool.reasonForTransfer', e.target.value)} /></FormField>
                  </div>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    <InfoRow label="School Name" value={displayed.previousSchool?.name} />
                    <InfoRow label="Board" value={displayed.previousSchool?.board} />
                    <InfoRow label="Last Class" value={displayed.previousSchool?.lastClass} />
                    <InfoRow label="Year of Leaving" value={displayed.previousSchool?.yearOfPassing} />
                    <InfoRow label="TC Number" value={displayed.previousSchool?.tcNumber} />
                    <InfoRow label="Reason for Transfer" value={displayed.previousSchool?.reasonForTransfer} />
                  </div>
                )}
              </div>

              {/* Health */}
              <div className="card">
                <SectionTitle icon={Activity} title="Health Information" />
                {editMode ? (
                  <div className="form-grid" style={{ marginTop: 12 }}>
                    <FormField label="Height (cm)"><Input type="number" value={displayed.health?.height || ''} onChange={e => set('health.height', e.target.value)} /></FormField>
                    <FormField label="Weight (kg)"><Input type="number" value={displayed.health?.weight || ''} onChange={e => set('health.weight', e.target.value)} /></FormField>
                    <FormField label="Vision">
                      <select className="input" value={displayed.health?.vision || ''} onChange={e => set('health.vision', e.target.value)}>
                        <option value="">Select</option>
                        <option>None — Normal vision</option>
                        <option>Spectacles</option>
                        <option>Contact Lens</option>
                      </select>
                    </FormField>
                    <FormField label="Hearing">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!displayed.health?.hearingIssues} onChange={e => set('health.hearingIssues', e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
                        <span style={{ fontSize: 13 }}>Hearing impairment</span>
                      </label>
                    </FormField>
                    <FormField label="Medical Conditions"><Input value={displayed.health?.medicalConditions || ''} onChange={e => set('health.medicalConditions', e.target.value)} /></FormField>
                    <FormField label="Allergies"><Input value={displayed.health?.allergies || ''} onChange={e => set('health.allergies', e.target.value)} /></FormField>
                    <FormField label="Emergency Notes"><Input value={displayed.health?.emergencyNotes || ''} onChange={e => set('health.emergencyNotes', e.target.value)} /></FormField>
                  </div>
                ) : (
                  <div style={{ marginTop: 10 }}>
                    <InfoRow label="Height" value={displayed.health?.height ? `${displayed.health.height} cm` : null} />
                    <InfoRow label="Weight" value={displayed.health?.weight ? `${displayed.health.weight} kg` : null} />
                    <InfoRow label="Vision" value={displayed.health?.vision} />
                    <InfoRow label="Hearing Impairment" value={displayed.health?.hearingIssues != null ? (displayed.health.hearingIssues ? 'Yes' : 'No') : null} />
                    <InfoRow label="Medical Conditions" value={displayed.health?.medicalConditions} />
                    <InfoRow label="Allergies" value={displayed.health?.allergies} />
                    <InfoRow label="Emergency Notes" value={displayed.health?.emergencyNotes} />
                  </div>
                )}
              </div>

              {/* Siblings — auto-detected from students sharing the same parent */}
              <div className="card">
                <SectionTitle icon={Users} title="Siblings in School" />
                <p style={{ fontSize: 11, color: 'var(--ink-4)', margin: '4px 0 8px' }}>
                  Automatically detected from other students linked to the same parent.
                </p>
                {autoSiblings.length > 0 ? (
                  <div style={{ marginTop: 4 }}>
                    {autoSiblings.map(s => (
                      <div key={s.id} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--line-2)', alignItems: 'center' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{s.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--ink-3)' }} className="mono">{s.admissionNumber}</span>
                        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{s.class}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }}>No siblings found in school.</p>
                )}
              </div>

              {/* Last updated */}
              {profile?.updatedAt && (
                <p style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'center' }}>
                  Last updated {new Date(profile.updatedAt).toLocaleString()} by {profile.updatedByName || 'Unknown'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Shared hidden inputs for all ID card uploads */}
      <input ref={idCardCameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleIdCardPick} />
      <input ref={idCardGalleryRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleIdCardPick} />

      {/* ── Camera / Gallery chooser popup ── */}
      {pickerFor && (
        <div
          onClick={() => setPickerFor(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="card"
            style={{ width: '100%', maxWidth: 420, margin: 12, borderRadius: 18, padding: 18 }}
          >
            <p style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', marginBottom: 2 }}>
              {pickerFor === 'photo' ? 'Update Student Photo' : {
                'student-front': "Student's ID Card — Front",
                'student-back': "Student's ID Card — Back",
                'father-front': "Father's ID Card — Front",
                'father-back': "Father's ID Card — Back",
                'mother-front': "Mother's ID Card — Front",
                'mother-back': "Mother's ID Card — Back",
                'guardian-front': "Guardian's ID Card — Front",
                'guardian-back': "Guardian's ID Card — Back",
              }[pickerFor] || 'Upload Photo'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 16 }}>Choose how you’d like to add the image.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn" style={{ flex: 1, flexDirection: 'column', gap: 6, padding: '16px 10px', height: 'auto' }} onClick={() => openPicker('camera')}>
                <Camera size={22} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Camera</span>
              </button>
              <button type="button" className="btn" style={{ flex: 1, flexDirection: 'column', gap: 6, padding: '16px 10px', height: 'auto' }} onClick={() => openPicker('gallery')}>
                <ImageIcon size={22} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Gallery</span>
              </button>
            </div>
            <button type="button" className="btn ghost" style={{ marginTop: 12, width: '100%' }} onClick={() => setPickerFor(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
