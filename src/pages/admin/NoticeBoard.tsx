import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, query, orderBy, deleteDoc, doc, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage, handleFirestoreError, OperationType } from '../../firebase';
import { Notice, NoticeAttachment, UserRole, UserProfile } from '../../types';
import { logActivity } from '../../services/activityService';
import { sanitizeFileName } from '../../services/lessonLogService';
import {
  Plus,
  Bell,
  Trash2,
  Search,
  Paperclip,
  FileText,
  X,
  Download,
  Megaphone,
} from 'lucide-react';
import {
  Modal, ConfirmModal,
  FormField, Input, Select, Textarea, Button,
} from '../../components/ui';
import { usePermissions } from '../../hooks/usePermissions';

interface NoticeBoardProps {
  user: UserProfile;
}

export default function NoticeBoard({ user }: NoticeBoardProps) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState<UserRole | 'all'>('all');
  const [files, setFiles] = useState<File[]>([]);

  const { isReadOnly } = usePermissions(user.role);
  const readOnly = isReadOnly('notices');

  const isAdmin = user.role === 'super_admin' || user.role === 'principal';
  const canWrite = user.role === 'super_admin' || (user.role === 'principal' && !readOnly);

  const [formData, setFormData] = useState({
    title: '',
    content: '',
    priority: 'medium' as 'low' | 'medium' | 'high',
    targetRoles: [] as UserRole[],
    expiresAt: '',
  });

  const roles: UserRole[] = ['super_admin', 'teacher', 'student', 'parent', 'accounts', 'principal', 'grievance_officer'];

  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  const MAX_FILES = 5;
  const ACCEPT_TYPES = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt';
  const isAllowedType = (type: string) =>
    type.startsWith('image/') ||
    type === 'application/pdf' ||
    type === 'application/msword' ||
    type.startsWith('application/vnd.openxmlformats-officedocument.') ||
    type === 'text/plain';

  const addFiles = (selected: FileList | null) => {
    if (!selected) return;
    const incoming = Array.from(selected);
    const tooBig = incoming.find(f => f.size > MAX_FILE_SIZE);
    if (tooBig) {
      handleFirestoreError(new Error(`"${tooBig.name}" exceeds the 10 MB limit.`), OperationType.CREATE, 'notices');
      return;
    }
    const badType = incoming.find(f => !isAllowedType(f.type));
    if (badType) {
      handleFirestoreError(new Error(`"${badType.name}" is not an allowed file type. Use images, PDF, Office docs, or text.`), OperationType.CREATE, 'notices');
      return;
    }
    setFiles(prev => [...prev, ...incoming].slice(0, MAX_FILES));
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  useEffect(() => {
    fetchNotices();
  }, []);

  const fetchNotices = async () => {
    try {
      let q = query(collection(db, 'notices'), orderBy('createdAt', 'desc'));
      if (!isAdmin) {
        q = query(
          collection(db, 'notices'),
          where('targetRoles', 'array-contains', user.role),
          orderBy('createdAt', 'desc')
        );
      }
      const querySnapshot = await getDocs(q);
      setNotices(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notice)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'notices');
    }
  };

  const sanitize = (text: string) => text.replace(/<[^>]*>/g, '').trim();

  const handleCreateNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setLoading(true);
    try {
      const attachments: NoticeAttachment[] = [];
      for (const file of files) {
        const storagePath = `notices/${user.uid}/${Date.now()}_${sanitizeFileName(file.name)}`;
        const uploadResult = await uploadBytes(ref(storage, storagePath), file);
        const url = await getDownloadURL(uploadResult.ref);
        attachments.push({
          name: file.name,
          url,
          storagePath,
          type: file.type || 'application/octet-stream',
          size: file.size,
        });
      }

      await addDoc(collection(db, 'notices'), {
        ...formData,
        title: sanitize(formData.title),
        content: sanitize(formData.content),
        authorId: user.uid,
        authorName: user.name,
        createdAt: new Date().toISOString(),
        ...(attachments.length > 0 ? { attachments } : {}),
      });

      await logActivity(
        user,
        'POST_NOTICE',
        'Academic',
        `Posted notice: ${formData.title} for ${formData.targetRoles.join(', ')}`
      );

      setIsModalOpen(false);
      fetchNotices();
      setFormData({ title: '', content: '', priority: 'medium', targetRoles: [], expiresAt: '' });
      setFiles([]);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'notices');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNotice = (id: string) => {
    if (!isAdmin) return;
    setDeletingId(id);
    setIsDeleteModalOpen(true);
  };

  const performDelete = async () => {
    if (!deletingId) return;
    try {
      const notice = notices.find(n => n.id === deletingId);
      await deleteDoc(doc(db, 'notices', deletingId));
      for (const att of notice?.attachments || []) {
        if (att.storagePath) {
          try { await deleteObject(ref(storage, att.storagePath)); } catch { /* ignore */ }
        }
      }
      await logActivity(
        user,
        'DELETE_NOTICE',
        'Super Admin',
        `Deleted notice: ${notice?.title || deletingId}`
      );
      fetchNotices();
      setIsDeleteModalOpen(false);
      setDeletingId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `notices/${deletingId}`);
    }
  };

  const filteredNotices = notices.filter(notice => {
    const matchesSearch = notice.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      notice.content.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = filterRole === 'all' || notice.targetRoles.includes(filterRole as UserRole);
    return matchesSearch && matchesRole;
  });

  const prioritySwatch = (priority: string) => {
    if (priority === 'high') return 'var(--coral)';
    if (priority === 'medium') return 'var(--accent)';
    return 'var(--ink)';
  };

  return (
    <>
      <div className="stack pad">
        <div className="topbar">
          <div>
            <div className="eyebrow">{notices.length} notice{notices.length === 1 ? '' : 's'}</div>
            <h1>Notices</h1>
          </div>
          {canWrite && (
            <div>
              <button className="btn accent" onClick={() => setIsModalOpen(true)}>
                <Plus style={{ width: 16, height: 16 }} /> New
              </button>
            </div>
          )}
        </div>

        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <Search style={{ width: 16, height: 16, color: 'var(--ink)', opacity: 0.4, flexShrink: 0 }} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search notices…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: '0.875rem', color: 'var(--ink)' }}
          />
        </div>

        {isAdmin && (
          <div className="hscroll" style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className={`chip${filterRole === 'all' ? ' solid' : ''}`}
              onClick={() => setFilterRole('all')}
            >
              All
            </button>
            {roles.map(role => (
              <button
                key={role}
                className={`chip${filterRole === role ? ' solid' : ''}`}
                onClick={() => setFilterRole(role)}
                style={{ textTransform: 'capitalize', whiteSpace: 'nowrap' }}
              >
                {role.replace('_', ' ')}
              </button>
            ))}
          </div>
        )}

        {filteredNotices.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
            <Bell style={{ width: 40, height: 40, margin: '0 auto 0.75rem', opacity: 0.25 }} />
            <div style={{ fontWeight: 600, color: 'var(--ink)' }}>No notices found</div>
            <div className="muted" style={{ fontSize: '0.82rem', marginTop: '0.25rem' }}>
              {searchTerm ? 'Try a different search term.' : 'Post the first notice to the board.'}
            </div>
          </div>
        ) : (
          <div className="stack">
            {filteredNotices.map((notice) => (
              <div key={notice.id} className="card" style={{ position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: prioritySwatch(notice.priority), borderRadius: '4px 0 0 4px' }} />
                <div style={{ paddingLeft: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="eyebrow" style={{ marginBottom: '0.25rem' }}>
                        {new Date(notice.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        {notice.authorName && <> · {notice.authorName}</>}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--ink)' }}>{notice.title}</div>
                      <div className="muted" style={{ fontSize: '0.82rem', marginTop: '0.25rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {notice.content}
                      </div>
                    </div>
                    {canWrite && (
                      <button className="icon-btn" onClick={() => handleDeleteNotice(notice.id)} title="Delete notice" style={{ flexShrink: 0 }}>
                        <Trash2 style={{ width: 15, height: 15, color: 'var(--coral)' }} />
                      </button>
                    )}
                  </div>

                  {notice.targetRoles && notice.targetRoles.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.625rem' }}>
                      {notice.targetRoles.map(role => (
                        <span key={role} className="chip" style={{ fontSize: '0.7rem', textTransform: 'capitalize' }}>
                          {role.replace('_', ' ')}
                        </span>
                      ))}
                    </div>
                  )}

                  {notice.attachments && notice.attachments.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.625rem' }}>
                      {notice.attachments.map((att, i) => (
                        <a
                          key={i}
                          href={att.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent)', background: 'var(--cream-2)', padding: '0.25rem 0.625rem', borderRadius: 6, textDecoration: 'none' }}
                        >
                          <FileText style={{ width: 13, height: 13 }} />
                          <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name}</span>
                          <Download style={{ width: 13, height: 13 }} />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={performDelete}
        title="Delete Notice?"
        message="This action cannot be undone. This notice will be removed from the board."
      />

      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setFiles([]); }}
        title="Post New Notice"
        size="lg"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setFiles([]); }}>Cancel</Button>
            <Button form="notice-form" type="submit" loading={loading} icon={Megaphone}>
              Post Notice
            </Button>
          </div>
        }
      >
        <form id="notice-form" onSubmit={handleCreateNotice} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-4">
              <FormField label="Title" required>
                <Input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g. School Reopening Date"
                />
              </FormField>
              <FormField label="Priority" required>
                <div className="flex gap-2">
                  {(['low', 'medium', 'high'] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setFormData({ ...formData, priority: p })}
                      className={formData.priority === p ? 'btn accent' : 'btn ghost'}
                      style={{ flex: 1, fontSize: '0.75rem', textTransform: 'capitalize' }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </FormField>
              <FormField label="Expiry Date (Optional)">
                <Input
                  type="date"
                  value={formData.expiresAt}
                  onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
                />
              </FormField>
            </div>

            <div>
              <FormField label="Target Audience">
                <div className="space-y-1.5 mt-1">
                  {roles.map(role => (
                    <label key={role} className="flex items-center gap-3 p-2.5 border border-slate-100 rounded-xl cursor-pointer hover:bg-slate-50 transition-all">
                      <input
                        type="checkbox"
                        checked={formData.targetRoles.includes(role)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFormData({ ...formData, targetRoles: [...formData.targetRoles, role] });
                          } else {
                            setFormData({ ...formData, targetRoles: formData.targetRoles.filter(r => r !== role) });
                          }
                        }}
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                        {role.replace('_', ' ')}
                      </span>
                    </label>
                  ))}
                </div>
              </FormField>
            </div>
          </div>

          <FormField label="Notice Content" required>
            <Textarea
              required
              rows={4}
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              placeholder="Write the details of the announcement here..."
            />
          </FormField>

          <FormField label="Attachments (Optional)">
            <div className="space-y-2">
              <label className="flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition-all text-sm font-semibold text-slate-500">
                <Paperclip className="w-4 h-4" />
                {files.length >= MAX_FILES ? `Max ${MAX_FILES} files reached` : 'Click to attach files'}
                <input
                  type="file"
                  multiple
                  accept={ACCEPT_TYPES}
                  className="hidden"
                  disabled={files.length >= MAX_FILES}
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
                />
              </label>
              <p className="text-[11px] text-slate-400">Up to {MAX_FILES} files, 10 MB each.</p>
              {files.length > 0 && (
                <div className="space-y-1.5">
                  {files.map((file, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-100 rounded-lg">
                      <FileText className="w-4 h-4 text-slate-500 shrink-0" />
                      <span className="text-xs font-semibold text-slate-700 truncate flex-1">{file.name}</span>
                      <span className="text-[10px] text-slate-400 shrink-0">{formatSize(file.size)}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="text-slate-400 hover:text-red-600 transition-colors shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </FormField>
        </form>
      </Modal>
    </>
  );
}
