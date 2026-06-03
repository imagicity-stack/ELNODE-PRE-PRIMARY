import { UserProfile, Subject } from '../../types';
import { FileText, Download, Search } from 'lucide-react';
import { openExternalUrl } from '../../lib/download';
import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';

interface StudyMaterial {
  id: string;
  title: string;
  description?: string;
  subjectId: string;
  classId: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize: string;
  teacherId: string;
  createdAt: string;
}

interface StudentNotesProps {
  user: UserProfile;
}

export default function StudentNotes({ user }: StudentNotesProps) {
  const [search, setSearch] = useState('');
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);

  useEffect(() => { fetchData(); }, [user.classId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'studyMaterials'), where('classId', '==', user.classId || ''), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setMaterials(snap.docs.map(d => ({ id: d.id, ...d.data() } as StudyMaterial)));
      const subSnap = await getDocs(collection(db, 'subjects'));
      setSubjects(subSnap.docs.map(d => ({ id: d.id, ...d.data() } as Subject)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'studyMaterials');
    } finally {
      setLoading(false);
    }
  };

  const filteredMaterials = materials.filter(m => {
    const matchesSearch = m.title.toLowerCase().includes(search.toLowerCase()) || m.description?.toLowerCase().includes(search.toLowerCase());
    const matchesSubject = selectedSubject ? m.subjectId === selectedSubject : true;
    return matchesSearch && matchesSubject;
  });

  const subjectCounts = materials.reduce((acc, m) => { acc[m.subjectId] = (acc[m.subjectId] || 0) + 1; return acc; }, {} as Record<string, number>);
  const activeSubjects = subjects.filter(s => subjectCounts[s.id] > 0);

  return (
    <div className="pb-2">
      <div className="topbar">
        <div>
          <div className="eyebrow">{materials.length} resource{materials.length !== 1 ? 's' : ''}</div>
          <h1>Materials</h1>
        </div>
      </div>

      {/* Search */}
      <div className="pad" style={{ marginTop: 6 }}>
        <div className="card flex center" style={{ gap: 10, padding: '10px 14px' }}>
          <Search size={16} className="muted" style={{ flexShrink: 0 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search materials…"
            style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, fontSize: 14, fontFamily: 'var(--body)', color: 'var(--ink)' }}
          />
        </div>
      </div>

      {/* Subject chips */}
      <div className="hscroll" style={{ marginTop: 12 }}>
        <button className={'chip' + (!selectedSubject ? ' solid' : '')} onClick={() => setSelectedSubject(null)}>All {materials.length}</button>
        {activeSubjects.map(subject => (
          <button key={subject.id} className={'chip' + (selectedSubject === subject.id ? ' solid' : '')} onClick={() => setSelectedSubject(selectedSubject === subject.id ? null : subject.id)}>
            {subject.name} {subjectCounts[subject.id]}
          </button>
        ))}
      </div>

      <div className="pad stack" style={{ marginTop: 14 }}>
        {loading ? (
          <div className="card muted small" style={{ textAlign: 'center', padding: 24 }}>Loading…</div>
        ) : filteredMaterials.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 28 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--cream-2)', display: 'grid', placeItems: 'center', margin: '0 auto 10px' }}>
              <FileText size={22} className="muted" />
            </div>
            <div className="bold">No materials found</div>
            <div className="small muted" style={{ marginTop: 2 }}>Nothing uploaded yet, or none match your search.</div>
          </div>
        ) : (
          filteredMaterials.map((note) => (
            <div key={note.id} className="card flex" style={{ gap: 14, padding: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 40, height: 48, borderRadius: 6, background: 'var(--cream-2)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <span className="mono tiny bold" style={{ fontSize: 9 }}>{(note.fileType || 'FILE').toUpperCase().slice(0, 4)}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.25 }}>{note.title}</div>
                <div className="tiny muted" style={{ marginTop: 2 }}>
                  {subjects.find(s => s.id === note.subjectId)?.name || note.subjectId} · {new Date(note.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                </div>
                {note.description && <div className="small muted" style={{ marginTop: 6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{note.description}</div>}
                {note.fileSize && <div className="mono tiny muted" style={{ marginTop: 6 }}>{note.fileSize}</div>}
              </div>
              <button
                onClick={() => openExternalUrl(note.fileUrl)}
                className="icon-btn"
                aria-label="Open material"
                title="Open"
              >
                <Download size={16} />
              </button>
            </div>
          ))
        )}
      </div>

      <div style={{ height: 16 }} />
    </div>
  );
}
