import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, getDocs, query, where, doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, handleFirestoreError, OperationType } from '../../firebase';
import { logActivity } from '../../services/activityService';
import { Exam, Class, Subject, GradingScale, Student, UserProfile } from '../../types';
import {
  Plus,
  Calendar,
  Clock,
  ChevronRight,
  X,
  Download,
  CheckSquare,
  FileText,
  AlertTriangle,
  Search,
} from 'lucide-react';
import { validateExamSchedule, findExamConflicts, ExamConflict, ValidationIssue } from '../../services/examService';
import { useToast } from '../../components/Toast';
import { cn } from '../../lib/utils';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { RefObject } from 'react';
import { usePermissions } from '../../hooks/usePermissions';
import {
  Modal, FormField, Input, Select, Textarea, Button,
} from '../../components/ui';

export default function ExamManagement({ user }: { user: UserProfile }) {
  const navigate = useNavigate();
  const [exams, setExams] = useState<Exam[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [gradingScales, setGradingScales] = useState<GradingScale[]>([]);
  const [isExamModalOpen, setIsExamModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [search, setSearch] = useState('');

  const { isReadOnly } = usePermissions(user.role);
  const readOnly = isReadOnly('exams');
  const { showToast } = useToast();
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [conflicts, setConflicts] = useState<ExamConflict[]>([]);
  const [overrideConflicts, setOverrideConflicts] = useState(false);

  // Form State for New Exam
  const [examForm, setExamForm] = useState({
    name: '',
    term: 'Term 1',
    startDate: '',
    endDate: '',
    classIds: [] as string[],
    subjectId: '',
    maxMarks: 100,
    gradingScaleId: '',
    type: 'scheduled' as 'scheduled',
    syllabusText: '',
    syllabusPhoto: null as File | null,
  });

  useEffect(() => {
    fetchExams();
    fetchClasses();
    fetchSubjects();
    fetchGradingScales();
  }, []);

  const fetchExams = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'exams'));
      setExams(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Exam)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'exams');
    }
  };

  const fetchClasses = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'classes'));
      setClasses(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Class)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'classes');
    }
  };

  const fetchSubjects = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'subjects'));
      setSubjects(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Subject)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'subjects');
    }
  };

  const fetchGradingScales = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'gradingScales'));
      const scales = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GradingScale));
      setGradingScales(scales);
      if (scales.length > 0) {
        setExamForm(prev => ({ ...prev, gradingScaleId: scales[0].id }));
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'gradingScales');
    }
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();

    const issues = validateExamSchedule({
      startDate: examForm.startDate,
      endDate: examForm.endDate || examForm.startDate,
      classIds: examForm.classIds,
    });
    setValidationIssues(issues);
    if (issues.some(i => i.level === 'error')) {
      showToast(issues.find(i => i.level === 'error')!.message, 'error');
      return;
    }

    if (!overrideConflicts) {
      try {
        const found = await findExamConflicts({
          startDate: examForm.startDate,
          endDate: examForm.endDate || examForm.startDate,
          classIds: examForm.classIds,
        });
        setConflicts(found);
        if (found.length > 0) {
          showToast(`${found.length} scheduling conflict(s) — review and override to proceed`, 'error');
          return;
        }
      } catch (err) { console.warn('Conflict check failed:', err); }
    }

    setLoading(true);
    try {
      let syllabusPhotoUrl = '';
      let storagePath = '';
      if (examForm.syllabusPhoto) {
        const timestamp = new Date().getTime();
        storagePath = `exams/syllabus/${user.uid}/${timestamp}_${examForm.syllabusPhoto.name}`;
        const storageRef = ref(storage, storagePath);

        const uploadResult = await uploadBytes(storageRef, examForm.syllabusPhoto);
        syllabusPhotoUrl = await getDownloadURL(uploadResult.ref);
      }

      const examRef = await addDoc(collection(db, 'exams'), {
        name: examForm.name,
        term: examForm.term,
        startDate: examForm.startDate || new Date().toISOString().split('T')[0],
        endDate: examForm.endDate || examForm.startDate || new Date().toISOString().split('T')[0],
        classIds: examForm.classIds,
        subjectId: examForm.subjectId,
        maxMarks: examForm.maxMarks,
        gradingScaleId: examForm.gradingScaleId,
        type: 'scheduled',
        status: 'scheduled',
        syllabus: {
          text: examForm.syllabusText,
          photoUrl: syllabusPhotoUrl,
          storagePath: storagePath || undefined
        },
        createdAt: new Date().toISOString(),
        createdBy: user.uid
      });
      logActivity(
        user,
        'Exam Created',
        'Exam',
        `Scheduled exam "${examForm.name}" (${examForm.term}) for ${examForm.classIds.length} class(es) starting ${examForm.startDate}`,
        {
          examId: examRef.id,
          name: examForm.name,
          term: examForm.term,
          startDate: examForm.startDate,
          classCount: examForm.classIds.length,
        }
      );
      setIsExamModalOpen(false);
      setValidationIssues([]);
      setConflicts([]);
      setOverrideConflicts(false);
      showToast('Exam scheduled', 'success');
      fetchExams();
      setExamForm({
        name: '',
        term: 'Term 1',
        startDate: '',
        endDate: '',
        classIds: [],
        subjectId: '',
        maxMarks: 100,
        gradingScaleId: gradingScales[0]?.id || '',
        type: 'scheduled',
        syllabusText: '',
        syllabusPhoto: null,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'exams');
    } finally {
      setLoading(false);
    }
  };

  const calculateGrade = (percentage: number) => {
    const scale = gradingScales[0];
    if (!scale) return 'N/A';
    const range = scale.ranges.find(r => percentage >= r.min && percentage <= r.max);
    return range ? range.grade : 'F';
  };

  const statusColor = (status: string) => {
    if (status === 'scheduled') return 'var(--accent)';
    if (status === 'ongoing') return 'var(--coral)';
    if (status === 'completed') return 'var(--leaf)';
    return 'var(--ink)';
  };

  const upcomingCount = exams.filter(e => e.status === 'scheduled').length;

  const statusFilters = ['all', 'scheduled', 'ongoing', 'completed'];

  const filteredExams = exams.filter(exam => {
    const matchStatus = filterStatus === 'all' || exam.status === filterStatus;
    const matchSearch = !search || exam.name.toLowerCase().includes(search.toLowerCase()) || exam.term.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  return (
    <>
      <div className="topbar">
        <div>
          <div className="eyebrow">{upcomingCount} upcoming</div>
          <h1>Exams</h1>
        </div>
        <div>
          {!readOnly && (
            <button className="btn accent" onClick={() => setIsExamModalOpen(true)}>
              <Plus size={15} /> Create Exam
            </button>
          )}
        </div>
      </div>

      <div className="pad stack">
        {/* Search + Filters */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="card flex" style={{ gap: 10, padding: '10px 14px', alignItems: 'center', flex: 1, minWidth: 200 }}>
            <Search size={16} className="muted" style={{ flexShrink: 0 }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search exams..."
              style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, fontSize: 14, fontFamily: 'var(--body)', color: 'var(--ink)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {statusFilters.map(s => (
              <button
                key={s}
                className={filterStatus === s ? 'chip solid' : 'chip'}
                onClick={() => setFilterStatus(s)}
                style={{ textTransform: 'capitalize' }}
              >
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>
        </div>

        {/* Exam Cards */}
        {filteredExams.length === 0 ? (
          <div className="card" style={{ padding: 48, textAlign: 'center' }}>
            <Calendar size={36} className="muted" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontWeight: 700, marginBottom: 4 }}>No exams found</p>
            <p className="muted tiny">Schedule your first exam to get started.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {filteredExams.map(exam => {
              const subject = subjects.find(s => s.id === exam.subjectId);
              return (
                <div key={exam.id} className="card" style={{ padding: 18 }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="display" style={{ fontWeight: 800, fontSize: 16, marginBottom: 4, lineHeight: 1.2 }}>{exam.name}</p>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                        {subject && (
                          <span className="chip" style={{ fontSize: 11 }}>{subject.name}</span>
                        )}
                        {exam.classIds.slice(0, 3).map(cid => {
                          const cls = classes.find(c => c.id === cid);
                          return (
                            <span key={cid} className="chip" style={{ fontSize: 11 }}>
                              {cls ? `Class ${cls.name}` : cid}
                            </span>
                          );
                        })}
                        {exam.classIds.length > 3 && (
                          <span className="chip" style={{ fontSize: 11 }}>+{exam.classIds.length - 3} more</span>
                        )}
                      </div>
                    </div>
                    <span
                      className="chip solid"
                      style={{
                        background: statusColor(exam.status),
                        color: '#fff',
                        fontSize: 11,
                        textTransform: 'capitalize',
                        flexShrink: 0,
                        marginLeft: 8,
                      }}
                    >
                      {exam.status}
                    </span>
                  </div>

                  {/* Date range */}
                  <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 12 }}>
                    <Calendar size={12} />
                    {new Date(exam.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    {exam.endDate !== exam.startDate && (
                      <> — {new Date(exam.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</>
                    )}
                    <span className="muted" style={{ marginLeft: 4 }}>{exam.term}</span>
                  </div>

                  {/* Marks entry link */}
                  <button
                    className="icon-btn"
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: 'var(--cream-2)', border: '1px solid var(--line)', fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}
                    onClick={() => {
                      const basePath = user.role === 'super_admin' ? '/superadmin' : '/principal';
                      navigate(`${basePath}/exams/${exam.id}/marks`);
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckSquare size={14} /> Enter Marks
                    </span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Exam Modal */}
      <Modal
        isOpen={isExamModalOpen}
        onClose={() => setIsExamModalOpen(false)}
        title="Schedule New Exam"
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => setIsExamModalOpen(false)}>Cancel</Button>
            <Button form="exam-form" type="submit" loading={loading} icon={Calendar}>
              Schedule Exam
            </Button>
          </div>
        }
      >
        <form id="exam-form" onSubmit={handleCreateExam} className="space-y-4">
          {validationIssues.length > 0 && (
            <div className="space-y-1">
              {validationIssues.map((iss, i) => (
                <div key={i} className={cn(
                  'flex items-start gap-2 px-3 py-2 rounded-xl text-xs',
                  iss.level === 'error' ? 'bg-rose-50 border border-rose-200 text-rose-700' : 'bg-amber-50 border border-amber-200 text-amber-700',
                )}>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{iss.message}</span>
                </div>
              ))}
            </div>
          )}
          {conflicts.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-rose-800">Scheduling conflict{conflicts.length !== 1 ? 's' : ''} detected</p>
                  <ul className="text-xs text-rose-700 mt-1 space-y-0.5">
                    {conflicts.map((c, i) => <li key={i}>• {c.detail}</li>)}
                  </ul>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-rose-800 font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={overrideConflicts}
                  onChange={e => setOverrideConflicts(e.target.checked)}
                  className="rounded"
                />
                I understand — schedule anyway
              </label>
            </div>
          )}
          <FormField label="Exam Name" required>
            <Input
              type="text"
              required
              value={examForm.name}
              onChange={(e) => setExamForm({ ...examForm, name: e.target.value })}
              placeholder="e.g. Mid-Term Examination"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Subject" required>
              <Select
                required
                value={examForm.subjectId}
                onChange={(e) => setExamForm({ ...examForm, subjectId: e.target.value })}
              >
                <option value="">Select Subject</option>
                {subjects.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Term">
              <Select
                value={examForm.term}
                onChange={(e) => setExamForm({ ...examForm, term: e.target.value })}
              >
                <option>Term 1</option>
                <option>Term 2</option>
                <option>Final Term</option>
              </Select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Start Date" required>
              <Input
                type="date"
                required
                value={examForm.startDate}
                onChange={(e) => setExamForm({ ...examForm, startDate: e.target.value })}
              />
            </FormField>
            <FormField label="End Date" required>
              <Input
                type="date"
                required
                value={examForm.endDate}
                onChange={(e) => setExamForm({ ...examForm, endDate: e.target.value })}
              />
            </FormField>
          </div>

          <FormField label="Syllabus (Text)">
            <Textarea
              value={examForm.syllabusText}
              onChange={(e) => setExamForm({ ...examForm, syllabusText: e.target.value })}
              placeholder="Type the syllabus here..."
              rows={3}
            />
          </FormField>

          <FormField label="Syllabus (Photo)">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setExamForm({ ...examForm, syllabusPhoto: e.target.files?.[0] || null })}
              className="w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
            />
          </FormField>

          <FormField label="Select Classes">
            <div className="grid grid-cols-2 gap-2 mt-1">
              {classes.map(cls => (
                <label key={cls.id} className="flex items-center gap-2 p-2.5 border border-slate-100 rounded-xl cursor-pointer hover:bg-slate-50 transition-all">
                  <input
                    type="checkbox"
                    checked={examForm.classIds.includes(cls.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setExamForm({ ...examForm, classIds: [...examForm.classIds, cls.id] });
                      } else {
                        setExamForm({ ...examForm, classIds: examForm.classIds.filter(id => id !== cls.id) });
                      }
                    }}
                    className="rounded text-indigo-600"
                  />
                  <span className="text-xs font-medium text-slate-700">Class {cls.name}</span>
                </label>
              ))}
            </div>
          </FormField>
        </form>
      </Modal>
    </>
  );
}
