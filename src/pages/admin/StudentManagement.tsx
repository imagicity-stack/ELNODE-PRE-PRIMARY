import React, { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, query, where, doc, setDoc, deleteDoc, orderBy, onSnapshot } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { createUserWithEmailAndPassword, getAuth, signOut, signInWithEmailAndPassword } from 'firebase/auth';
import { initializeApp, getApp } from 'firebase/app';
import { db, auth, storage, firebaseConfig, handleFirestoreError, OperationType } from '../../firebase';
import { Student, UserProfile, Class, House } from '../../types';
import { logActivity } from '../../services/activityService';
import { SCHOOL_DOMAIN } from '../../constants';
import { createPdf, addFooter, drawInfoBox, TABLE_STYLES } from '../../lib/pdfTemplate';
import { savePdf, saveText } from '../../lib/download';
import {
  Plus,
  Edit2,
  Trash2,
  User,
  Download,
  Upload,
  UserPlus,
  Phone,
  FileText,
  Activity,
  Users,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileDown,
  SlidersHorizontal,
  X,
  ChevronDown,
  ChevronRight,
  Mail,
  MapPin,
  Home as HomeIcon,
  Bus,
  Heart,
  GraduationCap,
  Hash,
  Check,
  ImageIcon,
  Filter as FilterIcon,
  Search,
} from 'lucide-react';
import { cn, sortByClassName, sortByName } from '../../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { usePermissions } from '../../hooks/usePermissions';
import {
  Modal, FormField, Input, Select, Textarea,
  EmptyState, Avatar,
  Button, IconButton, Badge,
} from '../../components/ui';
import { useToast } from '../../components/Toast';
import { StaggeredList } from '../../components/animations';
import StudentProfileView from './StudentProfileView';

export default function StudentManagement({ user }: { user: UserProfile }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [deletingStudent, setDeletingStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // ─── Advanced filters (multi-select arrays + presence tri-state) ────────────
  type TriState = 'any' | 'yes' | 'no';
  const [filterClass, setFilterClass] = useState<string[]>([]);
  const [filterSection, setFilterSection] = useState<string[]>([]);
  const [filterHouse, setFilterHouse] = useState<string[]>([]);
  const [filterGender, setFilterGender] = useState<string[]>([]);
  const [filterTransport, setFilterTransport] = useState<string[]>([]);
  const [filterPhoto, setFilterPhoto] = useState<TriState>('any');
  const [filterMedical, setFilterMedical] = useState<TriState>('any');
  const [filterAcademic, setFilterAcademic] = useState<TriState>('any');
  const [filterAddress, setFilterAddress] = useState<TriState>('any');
  const [filterStudentEmail, setFilterStudentEmail] = useState<TriState>('any');
  const [filterParentEmail, setFilterParentEmail] = useState<TriState>('any');
  const [showFilters, setShowFilters] = useState(false);
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [profileStudent, setProfileStudent] = useState<Student | null>(null);

  // ─── Export modal state ─────────────────────────────────────────────────────
  const ALL_EXPORT_COLUMNS = [
    { key: 'name', label: 'Name' },
    { key: 'admissionNumber', label: 'Admission Number' },
    { key: 'schoolNumber', label: 'School Number' },
    { key: 'class', label: 'Class' },
    { key: 'section', label: 'Section' },
    { key: 'gender', label: 'Gender' },
    { key: 'house', label: 'House' },
    { key: 'fatherName', label: 'Father Name' },
    { key: 'motherName', label: 'Mother Name' },
    { key: 'phone', label: 'Parent Phone' },
    { key: 'parentEmail', label: 'Parent Email' },
    { key: 'studentEmail', label: 'Student Email' },
    { key: 'transport', label: 'Transport' },
    { key: 'address', label: 'Address' },
    { key: 'medicalNotes', label: 'Medical Notes' },
    { key: 'academicHistory', label: 'Academic History' },
  ] as const;
  type ExportColKey = typeof ALL_EXPORT_COLUMNS[number]['key'];
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'filtered' | 'all'>('filtered');
  const [exportCols, setExportCols] = useState<Record<ExportColKey, boolean>>(
    Object.fromEntries(ALL_EXPORT_COLUMNS.map(c => [c.key, true])) as Record<ExportColKey, boolean>
  );

  const toggleArrayValue = (arr: string[], value: string): string[] =>
    arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];

  const { isReadOnly } = usePermissions(user.role);
  const readOnly = isReadOnly('students');
  const { showToast } = useToast();

  // Bulk import state
  type ImportResult = {
    name: string;
    admissionNumber: string;
    status: 'ok' | 'incomplete' | 'duplicate' | 'error';
    message?: string;
    warnings?: string[];
  };
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number; failed: number; skipped: number } | null>(null);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [importRowWarnings, setImportRowWarnings] = useState<Record<number, string[]>>({});
  // Per-row blocking issues (missing required fields, bad class, duplicates) → row will be skipped, not block the batch
  const [importRowIssues, setImportRowIssues] = useState<Record<number, string[]>>({});

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    schoolNumber: '',
    admissionNumber: '',
    classId: '',
    section: '',
    gender: '',
    fatherName: '',
    motherName: '',
    phone: '',
    email: '',
    studentEmail: '',
    transportDetails: '',
    medicalNotes: '',
    academicHistory: '',
    houseId: '',
    address: '',
    photoURL: '',
  });

  const fetchData = async () => {
    try {
      const [studentSnapshot, classSnapshot, houseSnapshot] = await Promise.all([
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'classes')),
        getDocs(collection(db, 'houses'))
      ]);

      setStudents(sortByName(studentSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student))));
      setClasses(sortByClassName(classSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Class))));
      setHouses(houseSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as House)));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'students/classes/houses');
    }
  };

  const fetchStudents = fetchData;

  useEffect(() => {
    fetchData();
    // Real-time class list so newly added classes appear instantly in dropdowns/filters
    const unsubClasses = onSnapshot(collection(db, 'classes'), (snap) => {
      setClasses(sortByClassName(snap.docs.map(d => ({ id: d.id, ...d.data() } as Class))));
    });
    return () => unsubClasses();
  }, []);

  const getClassName = (id: string) => {
    const cls = classes.find(c => c.id === id);
    return cls ? `Class ${cls.name}` : id;
  };

  const getHouseName = (id?: string) => {
    if (!id) return '';
    return houses.find(h => h.id === id)?.name || '';
  };

  const generateSchoolNumber = () => {
    // Randomizer removed as requested. Returning empty string to force manual entry or handle elsewhere.
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const studentData = {
        name: formData.name,
        schoolNumber: formData.schoolNumber,
        admissionNumber: formData.admissionNumber,
        classId: formData.classId,
        section: formData.section,
        gender: formData.gender,
        houseId: formData.houseId,
        photoURL: formData.photoURL,
        email: formData.studentEmail,
        address: formData.address,
        transportDetails: formData.transportDetails,
        medicalNotes: formData.medicalNotes,
        academicHistory: formData.academicHistory,
        parentDetails: {
          fatherName: formData.fatherName,
          motherName: formData.motherName,
          phone: formData.phone,
          email: formData.email,
        }
      };

      if (isEditMode && editingStudent) {
        // Update existing student
        await setDoc(doc(db, 'students', editingStudent.id), {
          ...studentData,
          updatedAt: new Date().toISOString(),
        }, { merge: true });

        // Update student user profile
        const studentQuery = query(collection(db, 'users'), where('schoolNumber', '==', editingStudent.schoolNumber), where('role', '==', 'student'));
        const studentDocs = await getDocs(studentQuery);
        if (!studentDocs.empty) {
          await setDoc(doc(db, 'users', studentDocs.docs[0].id), {
            name: formData.name,
            classId: formData.classId,
            section: formData.section,
            photoURL: formData.photoURL,
          }, { merge: true });
        }

        await logActivity(
          user,
          'UPDATE_STUDENT',
          'Students',
          `Updated student profile for ${formData.name} (${formData.schoolNumber})`
        );

        setIsModalOpen(false);
        setIsEditMode(false);
        setEditingStudent(null);
        fetchStudents();
        return;
      }

      const schoolNumber = formData.admissionNumber || formData.schoolNumber;
      if (!schoolNumber) {
        throw new Error('Admission / School Number is required.');
      }

      // Duplicate check — prevent two students sharing the same school number
      const dupSnap = await getDocs(
        query(collection(db, 'students'),
          where('admissionNumber', '==', schoolNumber)
        )
      );
      if (!dupSnap.empty) {
        const existing = dupSnap.docs[0].data() as Student;
        throw new Error(
          `School number ${schoolNumber} is already assigned to ${existing.name}. Each student must have a unique number.`
        );
      }

      const admissionNumber = schoolNumber;
      const studentEmail = `${schoolNumber}@${SCHOOL_DOMAIN}`;
      const parentEmail = `p${schoolNumber}@${SCHOOL_DOMAIN}`;
      const defaultPassword = 'password123';

      // Initialize secondary app for user creation without signing out admin
      let secondaryApp;
      try {
        secondaryApp = getApp('Secondary');
      } catch (e) {
        secondaryApp = initializeApp(firebaseConfig, 'Secondary');
      }
      const secondaryAuth = getAuth(secondaryApp);

      const getOrCreateUser = async (email: string) => {
        try {
          const cred = await createUserWithEmailAndPassword(secondaryAuth, email, defaultPassword);
          const uid = cred.user.uid;
          await signOut(secondaryAuth);
          return uid;
        } catch (err: any) {
          if (err.code === 'auth/email-already-in-use') {
            try {
              const cred = await signInWithEmailAndPassword(secondaryAuth, email, defaultPassword);
              const uid = cred.user.uid;
              await signOut(secondaryAuth);
              return uid;
            } catch (signInErr: any) {
              if (signInErr.code === 'auth/invalid-credential' || signInErr.code === 'auth/wrong-password') {
                throw new Error(`The email ${email} is already in use with a different password. Please contact support to reset it.`);
              }
              throw signInErr;
            }
          }
          throw err;
        }
      };

      // Create Student Auth Account
      const studentUid = await getOrCreateUser(studentEmail);

      // Look up existing parent by phone number (multi-child families share one login)
      const normalizePhone = (p: string) => (p || '').replace(/\D/g, '').slice(-10);
      const normalizedPhone = normalizePhone(formData.phone);

      const allParentsSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'parent')));
      const existingParentDoc = normalizedPhone
        ? allParentsSnap.docs.find(d => normalizePhone((d.data() as any).phone || '') === normalizedPhone)
        : undefined;

      let parentUid: string;
      let isNewParent: boolean;
      let existingParentData: UserProfile | null = null;

      if (existingParentDoc) {
        parentUid = existingParentDoc.id;
        existingParentData = existingParentDoc.data() as UserProfile;
        isNewParent = false;
      } else {
        parentUid = await getOrCreateUser(parentEmail);
        isNewParent = true;
      }

      // 2. Save Student Document
      const studentRef = await addDoc(collection(db, 'students'), {
        ...studentData,
        schoolNumber: schoolNumber,
        admissionNumber: admissionNumber,
        parentId: parentUid,
        // feeStatus intentionally omitted — set only when a fee request is created
        createdAt: new Date().toISOString(),
      });

      // 3. Create/Update User Profiles
      // Student User
      await setDoc(doc(db, 'users', studentUid), {
        uid: studentUid,
        email: studentEmail,
        name: formData.name,
        role: 'student',
        schoolNumber: schoolNumber,
        classId: formData.classId,
        section: formData.section,
        parentId: parentUid,
        studentId: studentRef.id, // Linked student record ID
        photoURL: formData.photoURL,
        createdAt: new Date().toISOString(),
      });

      // Parent User
      if (isNewParent) {
        await setDoc(doc(db, 'users', parentUid), {
          uid: parentUid,
          email: parentEmail,
          name: formData.fatherName?.trim() || formData.motherName?.trim() || `Parent of ${formData.name}`,
          role: 'parent',
          schoolNumber: schoolNumber, // Base school number for login
          studentIds: [studentRef.id],
          phone: formData.phone,
          address: formData.address,
          createdAt: new Date().toISOString(),
        });
      } else {
        // Update existing parent with new student ID
        await setDoc(doc(db, 'users', parentUid), {
          ...(existingParentData || {}),
          studentIds: [...((existingParentData?.studentIds) || []), studentRef.id]
        }, { merge: true });
      }

      setIsModalOpen(false);
      fetchStudents();

      await logActivity(
        user,
        'ADMIT_STUDENT',
        'Students',
        `Admitted new student ${formData.name} (${schoolNumber})`
      );
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/operation-not-allowed') {
        showToast('Email/Password sign-in is not enabled. Enable it in Firebase Console → Authentication → Sign-in method.', 'error');
      } else {
        showToast('Error creating student: ' + (err.message || 'Unknown error'), 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  // ─── Bulk import helpers ──────────────────────────────────────────────────

  const CSV_HEADERS = [
    'name', 'admissionNumber', 'class', 'section', 'gender',
    'fatherName', 'motherName', 'phone', 'email',
    'studentEmail', 'house', 'transport', 'medicalNotes', 'academicHistory', 'address',
  ];

  const getColumnValue = (s: Student, col: ExportColKey): string => {
    switch (col) {
      case 'name':            return s.name || '';
      case 'admissionNumber': return s.admissionNumber || '';
      case 'schoolNumber':    return s.schoolNumber || '';
      case 'class':           return classes.find(c => c.id === s.classId)?.name || '';
      case 'section':         return s.section || '';
      case 'gender':          return s.gender || '';
      case 'house':           return houses.find(h => h.id === s.houseId)?.name || '';
      case 'fatherName':      return s.parentDetails?.fatherName || '';
      case 'motherName':      return s.parentDetails?.motherName || '';
      case 'phone':           return s.parentDetails?.phone || '';
      case 'parentEmail':     return s.parentDetails?.email || '';
      case 'studentEmail':    return (s as any).email || '';
      case 'transport':       return s.transportDetails || '';
      case 'address':         return (s as any).address || '';
      case 'medicalNotes':    return s.medicalNotes || '';
      case 'academicHistory': return s.academicHistory || '';
      default:                return '';
    }
  };

  const handleExportCSV = async () => {
    const selectedCols = ALL_EXPORT_COLUMNS.filter(c => exportCols[c.key]);
    if (selectedCols.length === 0) {
      showToast('Select at least one column to export', 'error');
      return;
    }
    const sourceRows = exportScope === 'filtered' ? filteredStudents : students;
    const headers = selectedCols.map(c => c.label);
    const rows = sourceRows.map(s => selectedCols.map(c => getColumnValue(s, c.key)));
    const lines = [
      headers.join(','),
      ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    ];
    const suffix = exportScope === 'filtered' && activeFilterCount > 0 ? '_filtered' : '_all';
    await saveText(lines.join('\n'), `students${suffix}_${new Date().toISOString().slice(0, 10)}.csv`);
    setExportModalOpen(false);
    showToast(`Exported ${sourceRows.length} student${sourceRows.length !== 1 ? 's' : ''}`, 'success');
  };

  const handleDownloadTemplate = async () => {
    const exampleRows = [
      ['Ravi Kumar', '1001', '5', 'A', 'male', 'Suresh Kumar', 'Priya Kumar', '9876543210', 'parent@example.com', 'ravi@example.com', 'Red House', 'School', '', '', '123 Main Street'],
      ['Anita Sharma', '1002', '3', 'B', 'female', 'Ramesh Sharma', 'Sunita Sharma', '9123456789', 'sharma@example.com', '', '', 'Private', '', '', ''],
    ];
    const lines = [CSV_HEADERS.join(','), ...exampleRows.map(r => r.map(v => `"${v}"`).join(','))];
    await saveText(lines.join('\n'), 'student_import_template.csv');
  };

  // Strip ".0" suffix that Excel adds when saving numeric IDs to CSV (e.g. 1234 → "1234.0")
  const normalizeId = (v: string) => /^\d+\.0+$/.test(v) ? String(parseInt(v, 10)) : v;

  const parseCSV = (text: string): Record<string, string>[] => {
    const lines = text.trim().split('\n').filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
    return lines.slice(1).map(line => {
      // Handle quoted fields with commas
      const values: string[] = [];
      let cur = '', inQuote = false;
      for (const ch of line) {
        if (ch === '"') { inQuote = !inQuote; }
        else if (ch === ',' && !inQuote) { values.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      values.push(cur.trim());
      const record = Object.fromEntries(headers.map((h, i) => [h, (values[i] || '').replace(/^"|"$/g, '').trim()]));
      // Normalize numeric ID fields so Excel-exported floats ("1234.0") match stored strings
      if (record.admissionnumber) record.admissionnumber = normalizeId(record.admissionnumber);
      if (record.schoolnumber) record.schoolnumber = normalizeId(record.schoolnumber);
      return record;
    });
  };

  // Returns the list of blocking issues for a single parsed row (empty = row is importable)
  const getRowIssues = (
    row: Record<string, string>,
    index: number,
    seenInFile: Map<string, number>,
    existingAdmNos: Set<string>,
  ): string[] => {
    const issues: string[] = [];
    if (!row.name?.trim()) issues.push('name');
    if (!row.admissionnumber?.trim()) issues.push('admission number');
    if (!row.class?.trim()) issues.push('class');
    if (!row.section?.trim()) issues.push('section');
    if (!row.fathername?.trim()) issues.push("father's name");
    if (!row.mothername?.trim()) issues.push("mother's name");
    if (!row.phone?.trim()) issues.push('phone');
    if (row.gender?.trim() && !['male', 'female', 'other'].includes(row.gender.trim().toLowerCase()))
      issues.push('invalid gender (use male/female/other)');
    // Class must exist in the system
    if (row.class?.trim()) {
      const classObj = classes.find(c => c.name === row.class || c.name.toLowerCase() === row.class?.trim().toLowerCase());
      if (!classObj) issues.push(`class "${row.class}" not found`);
    }
    // Duplicate detection
    const admNo = row.admissionnumber?.trim();
    if (admNo) {
      if (seenInFile.has(admNo)) {
        issues.push(`duplicate of row ${seenInFile.get(admNo)! + 2} in this file`);
      } else {
        seenInFile.set(admNo, index);
        if (existingAdmNos.has(admNo)) issues.push('already exists in database');
      }
    }
    return issues;
  };

  const handleCSVFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseCSV(text);
      const rowIssues: Record<number, string[]> = {};
      const rowWarnings: Record<number, string[]> = {};

      const existingAdmNos = new Set(
        students.flatMap(s => [s.admissionNumber, s.schoolNumber].filter(Boolean).map(normalizeId))
      );
      const seenInFile = new Map<string, number>();

      rows.forEach((row, i) => {
        const issues = getRowIssues(row, i, seenInFile, existingAdmNos);
        if (issues.length) rowIssues[i] = issues;

        // Optional field warnings (row still imports)
        const warns: string[] = [];
        if (!row.gender?.trim()) warns.push('gender missing');
        if (!row.house?.trim()) warns.push('house not assigned');
        if (!row.address?.trim()) warns.push('address missing');
        if (!row.transport?.trim()) warns.push('transport not set');
        if (warns.length) rowWarnings[i] = warns;
      });

      setImportRows(rows);
      setImportRowIssues(rowIssues);
      setImportRowWarnings(rowWarnings);
      setImportProgress(null);
      setImportResults([]);
    };
    reader.readAsText(file);
  };

  const handleBulkImport = async () => {
    if (importRows.length === 0) return;

    // Fresh duplicate check from DB at import time (in case DB changed since CSV was loaded)
    const existingSnap = await getDocs(collection(db, 'students'));
    const existingAdmNos = new Set(
      existingSnap.docs.flatMap(d => [d.data().admissionNumber, d.data().schoolNumber].filter(Boolean).map(normalizeId))
    );
    const seenInFile = new Map<string, number>();

    let secondaryApp;
    try { secondaryApp = getApp('Secondary'); }
    catch (e) { secondaryApp = initializeApp(firebaseConfig, 'Secondary'); }
    const secondaryAuth = getAuth(secondaryApp);

    const getOrCreateUser = async (email: string) => {
      const defaultPassword = 'password123';
      try {
        const cred = await createUserWithEmailAndPassword(secondaryAuth, email, defaultPassword);
        await signOut(secondaryAuth);
        return cred.user.uid;
      } catch (err: any) {
        if (err.code === 'auth/email-already-in-use') {
          const cred = await signInWithEmailAndPassword(secondaryAuth, email, defaultPassword);
          await signOut(secondaryAuth);
          return cred.user.uid;
        }
        throw err;
      }
    };

    setImportProgress({ done: 0, total: importRows.length, failed: 0, skipped: 0 });
    const results: ImportResult[] = [];
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < importRows.length; i++) {
      const row = importRows[i];
      const name = row.name?.trim();
      const admissionNumber = row.admissionnumber?.trim();
      const rowWarns = importRowWarnings[i] || [];

      // ── Validate required fields & data integrity — skip the row if it fails,
      //    but never abort the whole batch ────────────────────────────────────
      const missing: string[] = [];
      if (!name) missing.push('name');
      if (!admissionNumber) missing.push('admission number');
      if (!row.class?.trim()) missing.push('class');
      if (!row.section?.trim()) missing.push('section');
      if (!row.fathername?.trim()) missing.push("father's name");
      if (!row.mothername?.trim()) missing.push("mother's name");
      if (!row.phone?.trim()) missing.push('phone');
      if (row.gender?.trim() && !['male', 'female', 'other'].includes(row.gender.trim().toLowerCase()))
        missing.push('invalid gender');

      const classObj = classes.find(c => c.name === row.class || c.name.toLowerCase() === row.class?.trim().toLowerCase());
      if (row.class?.trim() && !classObj) missing.push(`class "${row.class}" not found`);

      if (missing.length) {
        skipped++;
        results.push({
          name: name || `Row ${i + 2}`,
          admissionNumber: admissionNumber || '',
          status: 'incomplete',
          message: `Missing / invalid: ${missing.join(', ')}`,
        });
        setImportProgress({ done: i + 1, total: importRows.length, failed, skipped });
        setImportResults([...results]);
        continue;
      }

      // ── Skip duplicates (within file or already in DB) ────────────────────
      if (seenInFile.has(admissionNumber!)) {
        skipped++;
        results.push({
          name: name || `Row ${i + 2}`,
          admissionNumber: admissionNumber || '',
          status: 'duplicate',
          message: `Duplicate of row ${seenInFile.get(admissionNumber!)! + 2} in this file — skipped`,
        });
        setImportProgress({ done: i + 1, total: importRows.length, failed, skipped });
        setImportResults([...results]);
        continue;
      }
      seenInFile.set(admissionNumber!, i);

      if (existingAdmNos.has(admissionNumber!)) {
        skipped++;
        results.push({
          name: name || `Row ${i + 2}`,
          admissionNumber: admissionNumber || '',
          status: 'duplicate',
          message: 'Already exists in database — skipped',
        });
        setImportProgress({ done: i + 1, total: importRows.length, failed, skipped });
        setImportResults([...results]);
        continue;
      }

      try {
        const gender = row.gender?.toLowerCase();
        const houseObj = houses.find(h => h.name.toLowerCase() === (row.house || '').toLowerCase());

        const schoolNumber = admissionNumber;
        const studentEmail = `${schoolNumber}@${SCHOOL_DOMAIN}`;
        const parentEmail = `p${schoolNumber}@${SCHOOL_DOMAIN}`;

        const studentUid = await getOrCreateUser(studentEmail);

        const normalizePhone = (p: string) => (p || '').replace(/\D/g, '').slice(-10);
        const normalizedPhone = normalizePhone(row.phone || '');
        const allParentsSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'parent')));
        const existingParentDoc = normalizedPhone
          ? allParentsSnap.docs.find(d => normalizePhone((d.data() as any).phone || '') === normalizedPhone)
          : undefined;

        let parentUid: string;
        let isNewParent: boolean;
        let existingParentData: UserProfile | null = null;

        if (existingParentDoc) {
          parentUid = existingParentDoc.id;
          existingParentData = existingParentDoc.data() as UserProfile;
          isNewParent = false;
        } else {
          parentUid = await getOrCreateUser(parentEmail);
          isNewParent = true;
        }

        const studentRef = await addDoc(collection(db, 'students'), {
          name,
          schoolNumber,
          admissionNumber,
          classId: classObj!.id,
          section: row.section,
          gender,
          houseId: houseObj?.id || '',
          email: (row.studentemail as string) || '',
          transportDetails: row.transport || row.transportdetails || '',
          medicalNotes: row.medicalnotes || '',
          academicHistory: row.academichistory || '',
          address: row.address || '',
          parentId: parentUid,
          photoURL: '',
          parentDetails: {
            fatherName: row.fathername,
            motherName: row.mothername,
            phone: row.phone,
            email: row.email,
          },
          createdAt: new Date().toISOString(),
        });

        await setDoc(doc(db, 'users', studentUid), {
          uid: studentUid,
          email: studentEmail,
          name,
          role: 'student',
          schoolNumber,
          classId: classObj!.id,
          section: row.section,
          parentId: parentUid,
          studentId: studentRef.id,
          photoURL: '',
          createdAt: new Date().toISOString(),
        });

        if (isNewParent) {
          await setDoc(doc(db, 'users', parentUid), {
            uid: parentUid,
            email: parentEmail,
            name: (row.fathername as string)?.trim() || (row.mothername as string)?.trim() || `Parent of ${name}`,
            role: 'parent',
            schoolNumber,
            studentIds: [studentRef.id],
            phone: row.phone,
            address: row.address || '',
            createdAt: new Date().toISOString(),
          });
        } else {
          await setDoc(doc(db, 'users', parentUid), {
            ...(existingParentData || {}),
            studentIds: [...((existingParentData?.studentIds) || []), studentRef.id],
          }, { merge: true });
        }

        results.push({ name: name || `Row ${i + 2}`, admissionNumber: admissionNumber || '', status: 'ok', warnings: rowWarns });
      } catch (err: any) {
        failed++;
        results.push({ name: name || `Row ${i + 2}`, admissionNumber: admissionNumber || '', status: 'error', message: err.message || 'Unknown error' });
      }

      setImportProgress({ done: i + 1, total: importRows.length, failed, skipped });
      setImportResults([...results]);
    }

    fetchStudents();
    const imported = results.filter(r => r.status === 'ok').length;
    const incomplete = results.filter(r => r.status === 'incomplete').length;
    const duplicates = results.filter(r => r.status === 'duplicate').length;
    await logActivity(
      user, 'BULK_IMPORT_STUDENTS', 'Students',
      `Bulk import: ${imported} imported, ${incomplete} skipped (incomplete), ${duplicates} skipped (duplicate), ${failed} failed — ${importRows.length} total rows`,
    );
  };

  const statusLabel = (s: ImportResult['status']) =>
    s === 'ok' ? 'Imported'
    : s === 'incomplete' ? 'Skipped (Missing Data)'
    : s === 'duplicate' ? 'Skipped (Duplicate)'
    : 'Failed';

  const handleDownloadImportReport = async () => {
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [
      'Name,Admission Number,Result,Reason / Missing Fields,Warnings',
      ...importResults.map(r => [
        esc(r.name),
        esc(r.admissionNumber),
        esc(statusLabel(r.status)),
        esc(r.message || ''),
        esc((r.warnings || []).join('; ')),
      ].join(','))
    ];
    await saveText(lines.join('\n'), `import_report_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const handleEdit = (student: Student) => {
    setEditingStudent(student);
    setIsEditMode(true);

    // Find IDs if they were stored as names
    const classObj = classes.find(c => c.id === student.classId || c.name === student.classId);
    const houseObj = houses.find(h => h.id === student.houseId || h.name === student.houseId);

    setFormData({
      name: student.name,
      schoolNumber: student.schoolNumber,
      admissionNumber: student.admissionNumber,
      classId: classObj?.id || student.classId,
      section: student.section,
      gender: student.gender || '',
      fatherName: student.parentDetails?.fatherName || '',
      motherName: student.parentDetails?.motherName || '',
      phone: student.parentDetails?.phone || '',
      email: student.parentDetails?.email || '',
      studentEmail: (student as any).email || '',
      transportDetails: student.transportDetails || '',
      medicalNotes: student.medicalNotes || '',
      academicHistory: student.academicHistory || '',
      houseId: houseObj?.id || student.houseId || '',
      address: '',
      photoURL: student.photoURL || ''
    });
    setIsModalOpen(true);
  };

  const generateStudentPDF = async (student: Student) => {
    const { doc, contentY, pageWidth } = await createPdf(
      'Complete Student Record',
      `Generated on ${new Date().toLocaleDateString('en-IN')}`,
    );

    let y = contentY + 4;

    // Basic info
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(5, 150, 105);
    doc.text('BASIC INFORMATION', 12, y);
    y += 3;

    y = drawInfoBox(
      doc,
      [
        { label: 'Name', value: student.name },
        { label: 'Admission No', value: student.admissionNumber || '-' },
        { label: 'School No', value: student.schoolNumber || '-' },
        { label: 'Class & Section', value: `${getClassName(student.classId)} – ${student.section}` },
        { label: 'House', value: student.houseId || 'N/A' },
      ],
      y,
      pageWidth,
      2,
    );

    y += 6;
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(5, 150, 105);
    doc.text('PARENT INFORMATION', 12, y);
    y += 3;

    y = drawInfoBox(
      doc,
      [
        { label: "Father's Name", value: student.parentDetails?.fatherName || 'N/A' },
        { label: "Mother's Name", value: student.parentDetails?.motherName || 'N/A' },
        { label: 'Phone', value: student.parentDetails?.phone || 'N/A' },
        { label: 'Email', value: student.parentDetails?.email || 'N/A' },
      ],
      y,
      pageWidth,
      2,
    );

    y += 6;
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(5, 150, 105);
    doc.text('ADDITIONAL DETAILS', 12, y);
    y += 3;

    y = drawInfoBox(
      doc,
      [
        { label: 'Transport', value: student.transportDetails || 'None' },
        { label: 'Medical Notes', value: student.medicalNotes || 'None' },
        { label: 'Academic History', value: student.academicHistory || 'None' },
        { label: 'Gender', value: student.gender || 'N/A' },
      ],
      y,
      pageWidth,
      2,
    );

    y += 6;

    // Recent fee payments
    const paymentsSnap = await getDocs(
      query(collection(db, 'feePayments'), where('studentId', '==', student.id), orderBy('date', 'desc')),
    );

    if (!paymentsSnap.empty) {
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(5, 150, 105);
      doc.text('PAYMENT HISTORY', 12, y);
      y += 3;

      const paymentData = paymentsSnap.docs.slice(0, 10).map((d) => {
        const p = d.data();
        return [
          p.receiptNumber || '-',
          p.date || '-',
          `₹${(p.amount || 0).toLocaleString('en-IN')}`,
          (p.method || 'N/A').replace('_', ' ').toUpperCase(),
          p.feeHead || '-',
        ];
      });

      (doc as any).autoTable({
        startY: y,
        head: [['Receipt No', 'Date', 'Amount', 'Method', 'Fee Head']],
        body: paymentData,
        ...TABLE_STYLES,
        margin: { left: 12, right: 12 },
      });
    }

    addFooter(doc);
    await savePdf(doc, `student_record_${student.schoolNumber || student.admissionNumber}.pdf`);
  };

  const performDelete = async (options: {
    deleteStudent: boolean;
    deleteParent: boolean;
    deleteEverything: boolean;
    downloadFirst: boolean;
  }) => {
    if (!deletingStudent) return;
    setLoading(true);

    try {
      if (options.downloadFirst) {
        await generateStudentPDF(deletingStudent);
      }

      // 1. Delete Student Document
      if (options.deleteStudent || options.deleteEverything) {
        await deleteDoc(doc(db, 'students', deletingStudent.id));

        await logActivity(
          user,
          'DELETE_STUDENT',
          'Super Admin',
          `Deleted student record for ${deletingStudent.name} (${deletingStudent.schoolNumber}). Options: ${JSON.stringify(options)}`
        );

        // Delete related data if everything
        if (options.deleteEverything) {
          const collectionsToDelete = ['fees', 'attendance', 'examResults'];
          for (const coll of collectionsToDelete) {
            const q = query(collection(db, coll), where('studentId', '==', deletingStudent.id));
            const snapshot = await getDocs(q);
            for (const d of snapshot.docs) {
              await deleteDoc(doc(db, coll, d.id));
            }
          }
        }
      }

      // 2. Delete User Profiles
      if ((options.deleteStudent || options.deleteEverything) && deletingStudent.schoolNumber) {
        const studentUserQuery = query(collection(db, 'users'), where('schoolNumber', '==', deletingStudent.schoolNumber), where('role', '==', 'student'));
        const studentUserDocs = await getDocs(studentUserQuery);
        for (const d of studentUserDocs.docs) {
          await deleteDoc(doc(db, 'users', d.id));
        }
      }

      if ((options.deleteParent || options.deleteEverything) && deletingStudent.parentId) {
        // Check if other students use this parent
        const otherStudentsQuery = query(collection(db, 'students'), where('parentId', '==', deletingStudent.parentId));
        const otherStudentsDocs = await getDocs(otherStudentsQuery);

        // If deleting everything, we don't care about other students unless we want to keep parent for them
        // But usually "delete parent" means delete that parent profile
        if (otherStudentsDocs.size <= 1 || options.deleteParent) {
          const parentUserQuery = query(collection(db, 'users'), where('uid', '==', deletingStudent.parentId));
          const parentUserDocs = await getDocs(parentUserQuery);
          for (const d of parentUserDocs.docs) {
            await deleteDoc(doc(db, 'users', d.id));
          }
        }
      }

      setIsDeleteModalOpen(false);
      setDeletingStudent(null);
      fetchStudents();
    } catch (error) {
      console.error("Error deleting student data:", error);
      showToast('An error occurred while deleting student data.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const presenceFilters: TriState[] = [filterPhoto, filterMedical, filterAcademic, filterAddress, filterStudentEmail, filterParentEmail];
  const activeFilterCount =
    (filterClass.length ? 1 : 0) +
    (filterSection.length ? 1 : 0) +
    (filterHouse.length ? 1 : 0) +
    (filterGender.length ? 1 : 0) +
    (filterTransport.length ? 1 : 0) +
    presenceFilters.filter(p => p !== 'any').length;

  const clearFilters = () => {
    setFilterClass([]);
    setFilterSection([]);
    setFilterHouse([]);
    setFilterGender([]);
    setFilterTransport([]);
    setFilterPhoto('any');
    setFilterMedical('any');
    setFilterAcademic('any');
    setFilterAddress('any');
    setFilterStudentEmail('any');
    setFilterParentEmail('any');
  };

  // Sections available across the selected classes (or all unique sections if none selected)
  const availableSections = filterClass.length > 0
    ? Array.from(new Set(
        filterClass.flatMap(cid =>
          (classes.find(c => c.id === cid)?.sections.map(s => s.name || 'A')) ?? []
        )
      ))
    : Array.from(new Set(students.map(s => s.section).filter(Boolean)));

  const matchTri = (state: TriState, hasValue: boolean) =>
    state === 'any' || (state === 'yes' && hasValue) || (state === 'no' && !hasValue);

  const filteredStudents = students.filter(s => {
    const q = searchTerm.toLowerCase();
    const matchesSearch = !q ||
      s.name.toLowerCase().includes(q) ||
      s.admissionNumber.includes(searchTerm) ||
      s.schoolNumber.includes(searchTerm) ||
      (s.parentDetails?.fatherName || '').toLowerCase().includes(q) ||
      (s.parentDetails?.motherName || '').toLowerCase().includes(q) ||
      (s.parentDetails?.phone || '').includes(searchTerm) ||
      (s.parentDetails?.email || '').toLowerCase().includes(q) ||
      ((s as any).email || '').toLowerCase().includes(q) ||
      ((s as any).address || '').toLowerCase().includes(q);

    const matchesClass     = filterClass.length === 0     || filterClass.includes(s.classId);
    const matchesSection   = filterSection.length === 0   || filterSection.includes(s.section || '');
    const matchesHouse     = filterHouse.length === 0     || filterHouse.includes(s.houseId || '');
    const matchesGender    = filterGender.length === 0    || filterGender.includes((s.gender || '').toLowerCase());
    const matchesTransport = filterTransport.length === 0 || filterTransport.includes(s.transportDetails || '');

    const matchesPhoto         = matchTri(filterPhoto,         Boolean(s.photoURL));
    const matchesMedical       = matchTri(filterMedical,       Boolean(s.medicalNotes && s.medicalNotes.trim()));
    const matchesAcademic      = matchTri(filterAcademic,      Boolean(s.academicHistory && s.academicHistory.trim()));
    const matchesAddress       = matchTri(filterAddress,       Boolean(((s as any).address || '').toString().trim()));
    const matchesStudentEmail  = matchTri(filterStudentEmail,  Boolean(((s as any).email || '').toString().trim()));
    const matchesParentEmail   = matchTri(filterParentEmail,   Boolean((s.parentDetails?.email || '').trim()));

    return matchesSearch && matchesClass && matchesSection && matchesHouse && matchesGender && matchesTransport
      && matchesPhoto && matchesMedical && matchesAcademic && matchesAddress && matchesStudentEmail && matchesParentEmail;
  });

  const openAddModal = () => {
    setIsEditMode(false);
    setEditingStudent(null);
    setFormData({ name: '', schoolNumber: '', admissionNumber: '', classId: '', section: '', gender: '', fatherName: '', motherName: '', phone: '', email: '', studentEmail: '', transportDetails: '', medicalNotes: '', academicHistory: '', houseId: '', address: '', photoURL: '' });
    setIsModalOpen(true);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please upload an image file', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('Image must be under 5MB', 'error');
      return;
    }

    setLoading(true);
    try {
      // Always upload under the admin's own uid so request.auth.uid == userId in storage rules.
      const adminUid = (user as any)?.uid;
      const studentFolder = editingStudent?.id || 'new';
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storageRef = ref(storage, `profiles/${adminUid}/students/${studentFolder}/${Date.now()}_${safeName}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setFormData(prev => ({ ...prev, photoURL: url }));
      showToast('Photo uploaded', 'success');
    } catch (err: any) {
      console.error('Error uploading photo:', err);
      const msg = err?.code === 'storage/unauthorized'
        ? 'Storage permission denied. Check Firebase Storage rules for the profiles/ path.'
        : (err?.message || 'Failed to upload photo');
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  // ─── initials helper ──────────────────────────────────────────────────────
  const getInitials = (name: string) =>
    name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <>
      {/* ─── Topbar ─────────────────────────────────────────────────────── */}
      <div className="topbar">
        <div>
          <div className="eyebrow">{filteredStudents.length} students</div>
          <h1>Students</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn ghost" style={{ width: 'auto', padding: '8px 14px', fontSize: 13 }} title="Export CSV" onClick={() => setExportModalOpen(true)}>
            <Download size={14} /> Export
          </button>
          {!readOnly && (
            <button
              className="btn ghost"
              style={{ width: 'auto', padding: '8px 14px', fontSize: 13 }}
              onClick={() => { setImportRows([]); setImportProgress(null); setImportResults([]); setImportRowWarnings({}); setImportRowIssues({}); setImportModalOpen(true); }}
            >
              <Upload size={14} /> Bulk Import
            </button>
          )}
          {!readOnly && (
            <button className="btn accent" style={{ width: 'auto', padding: '8px 16px', fontSize: 13 }} onClick={openAddModal}>
              <Plus size={14} /> Add Student
            </button>
          )}
        </div>
      </div>

      <div className="pad" style={{ paddingBottom: 24 }}>
        {/* ─── Search + filter toggle ──────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div className="card flex center" style={{ gap: 10, padding: '10px 14px', flex: 1 }}>
            <Search size={16} className="muted" style={{ flexShrink: 0 }} />
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search name, admission no., parent…"
              style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, fontSize: 14, fontFamily: 'var(--body)', color: 'var(--ink)' }}
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 0 }}>
                <X size={14} />
              </button>
            )}
          </div>
          <button
            className={cn('btn', showFilters || activeFilterCount > 0 ? 'accent' : 'ghost')}
            style={{ gap: 6, flexShrink: 0 }}
            onClick={() => setShowFilters(v => !v)}
          >
            <FilterIcon size={14} />
            Filters
            {activeFilterCount > 0 && (
              <span style={{ background: 'var(--ink)', color: 'var(--cream)', borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '1px 6px', marginLeft: 2 }}>
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* ─── Advanced filter panel ───────────────────────────────────────── */}
        {showFilters && (
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>Filters</span>
              {activeFilterCount > 0 && (
                <button className="btn ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={clearFilters}>
                  Clear all
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Class */}
              <div>
                <div className="eyebrow" style={{ marginBottom: 6 }}>Class</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {classes.map(cls => (
                    <button key={cls.id} className={cn('chip', filterClass.includes(cls.id) && 'solid')}
                      onClick={() => setFilterClass(toggleArrayValue(filterClass, cls.id))}>
                      Class {cls.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Section — only shown when classes are selected */}
              {filterClass.length > 0 && availableSections.length > 0 && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Section</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {availableSections.map(sec => (
                      <button key={sec} className={cn('chip', filterSection.includes(sec) && 'solid')}
                        onClick={() => setFilterSection(toggleArrayValue(filterSection, sec!))}>
                        {sec}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* House + Gender in one row on desktop */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>House</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {houses.map(h => (
                      <button key={h.id} className={cn('chip', filterHouse.includes(h.id) && 'accent')}
                        onClick={() => setFilterHouse(toggleArrayValue(filterHouse, h.id))}>
                        {h.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>Gender</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['male', 'female'] as const).map(g => (
                      <button key={g} className={cn('chip', filterGender.includes(g) && 'solid')}
                        onClick={() => setFilterGender(toggleArrayValue(filterGender, g))}
                        style={{ textTransform: 'capitalize' }}>
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Profile completeness — tri-state */}
              <div>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Profile Completeness</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                  {([
                    { label: 'Photo', state: filterPhoto, set: setFilterPhoto },
                    { label: 'Medical Notes', state: filterMedical, set: setFilterMedical },
                    { label: 'Academic History', state: filterAcademic, set: setFilterAcademic },
                    { label: 'Address', state: filterAddress, set: setFilterAddress },
                    { label: 'Student Email', state: filterStudentEmail, set: setFilterStudentEmail },
                    { label: 'Parent Email', state: filterParentEmail, set: setFilterParentEmail },
                  ] as { label: string; state: TriState; set: (v: TriState) => void }[]).map(({ label, state, set }) => (
                    <div key={label} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(['any', 'yes', 'no'] as TriState[]).map(opt => (
                          <button key={opt} onClick={() => set(opt)}
                            style={{
                              flex: 1, padding: '4px 0', borderRadius: 6, border: '1px solid',
                              fontSize: 11, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize',
                              background: state === opt ? (opt === 'yes' ? 'var(--leaf)' : opt === 'no' ? 'var(--coral)' : 'var(--ink)') : 'transparent',
                              borderColor: state === opt ? 'transparent' : 'var(--line)',
                              color: state === opt ? (opt === 'any' ? 'var(--cream)' : 'white') : 'var(--ink-3)',
                            }}>
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Mobile card list ────────────────────────────────────────────── */}
        <div className="stack mobile-only">
          {filteredStudents.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <Users size={40} style={{ color: 'var(--line)', margin: '0 auto 12px' }} />
              <p style={{ fontWeight: 700, color: 'var(--ink)' }}>No students found</p>
              <p className="tiny muted" style={{ marginTop: 4 }}>Try adjusting filters or add a student</p>
            </div>
          ) : (
            filteredStudents.map(student => (
              <button
                key={student.id}
                className="card flex center"
                style={{ gap: 12, width: '100%', textAlign: 'left', cursor: 'pointer' }}
                onClick={() => !readOnly && handleEdit(student)}
              >
                {student.photoURL ? (
                  <img src={student.photoURL} alt={student.name} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div className="avatar" style={{ flexShrink: 0 }}>{getInitials(student.name)}</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', marginBottom: 2 }}>{student.name}</p>
                  <p className="eyebrow" style={{ marginBottom: 4 }}>{student.admissionNumber}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="chip" style={{ padding: '2px 8px', fontSize: 11 }}>
                      {getClassName(student.classId)}{student.section ? ` · ${student.section}` : ''}
                    </span>
                    {student.parentDetails?.phone && (
                      <span className="tiny muted">{student.parentDetails.phone}</span>
                    )}
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
              </button>
            ))
          )}
        </div>

        {/* ─── Desktop table ───────────────────────────────────────────────── */}
        <div className="hidden lg:block overflow-x-auto">
          <div className="card flush">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th style={thStyle}>Student</th>
                  <th style={thStyle}>Admission / School No.</th>
                  <th style={thStyle}>Class &amp; Section</th>
                  <th style={thStyle}>House</th>
                  <th style={thStyle}>Parent Details</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center' }}>
                      <Users size={32} style={{ color: 'var(--line)', margin: '0 auto 8px' }} />
                      <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>No students found</p>
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map(student => {
                    const houseName = getHouseName(student.houseId);
                    const isExpanded = expandedStudentId === student.id;
                    return (
                      <React.Fragment key={student.id}>
                        <tr
                          style={{ borderBottom: '1px solid var(--line-2)', cursor: 'pointer', background: isExpanded ? 'var(--cream-2)' : 'transparent' }}
                          onClick={() => setExpandedStudentId(isExpanded ? null : student.id)}
                        >
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              {student.photoURL ? (
                                <img src={student.photoURL} alt={student.name} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                              ) : (
                                <div className="avatar" style={{ width: 32, height: 32, fontSize: 11 }}>{getInitials(student.name)}</div>
                              )}
                              <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{student.name}</span>
                            </div>
                          </td>
                          <td style={tdStyle}><span className="mono" style={{ fontSize: 13, color: 'var(--ink-2)' }}>{student.admissionNumber}</span></td>
                          <td style={tdStyle}><span style={{ color: 'var(--ink-2)', fontSize: 13 }}>{getClassName(student.classId)}{student.section ? ` · ${student.section}` : ''}</span></td>
                          <td style={tdStyle}>
                            {houseName ? (
                              <span className="chip" style={{ padding: '2px 8px', fontSize: 11 }}>{houseName}</span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td style={tdStyle}>
                            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{student.parentDetails?.fatherName || 'N/A'}</p>
                            <p className="tiny muted">{student.parentDetails?.phone || ''}</p>
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                              <button className="icon-btn" title="View Profile" onClick={() => setProfileStudent(student)}>
                                <User size={14} />
                              </button>
                              {!readOnly && (
                                <>
                                  <button className="icon-btn" title="Edit" onClick={() => handleEdit(student)}>
                                    <Edit2 size={14} />
                                  </button>
                                  <button className="icon-btn" title="Delete" style={{ borderColor: 'var(--coral)', color: 'var(--coral)' }} onClick={() => { setDeletingStudent(student); setIsDeleteModalOpen(true); }}>
                                    <Trash2 size={14} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr style={{ background: 'var(--cream-2)' }}>
                            <td colSpan={6} style={{ padding: '16px 20px' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
                                <div>
                                  <p className="eyebrow" style={{ marginBottom: 10 }}>Student</p>
                                  <DetailRow icon={Hash} label="Admission No." value={student.admissionNumber} />
                                  <DetailRow icon={Hash} label="School No." value={student.schoolNumber} />
                                  <DetailRow icon={GraduationCap} label="Class &amp; Section" value={`${getClassName(student.classId)}${student.section ? ` · ${student.section}` : ''}`} />
                                  <DetailRow icon={HomeIcon} label="House" value={houseName || 'Not Assigned'} />
                                  <DetailRow icon={Mail} label="Student Email" value={(student as any).email || '—'} />
                                </div>
                                <div>
                                  <p className="eyebrow" style={{ marginBottom: 10 }}>Parents &amp; Contact</p>
                                  <DetailRow icon={UserPlus} label="Father" value={student.parentDetails?.fatherName || '—'} />
                                  <DetailRow icon={UserPlus} label="Mother" value={student.parentDetails?.motherName || '—'} />
                                  <DetailRow icon={Phone} label="Phone" value={student.parentDetails?.phone || '—'} />
                                  <DetailRow icon={Mail} label="Parent Email" value={student.parentDetails?.email || '—'} />
                                </div>
                                <div>
                                  <p className="eyebrow" style={{ marginBottom: 10 }}>Additional</p>
                                  <DetailRow icon={Bus} label="Transport" value={student.transportDetails || '—'} />
                                  <DetailRow icon={Heart} label="Medical Notes" value={student.medicalNotes || '—'} />
                                  <DetailRow icon={FileText} label="Academic History" value={student.academicHistory || '—'} multiline />
                                  <DetailRow icon={MapPin} label="Address" value={(student as any).address || '—'} multiline />
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ─── Add / Edit Modal ─────────────────────────────────────────────── */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setIsEditMode(false); setEditingStudent(null); }}
        title={isEditMode ? 'Edit Student Details' : 'New Student Admission'}
        subtitle={isEditMode ? 'Update student information' : 'Fill in all details to register a new student'}
        size="xl"
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); setIsEditMode(false); setEditingStudent(null); }}>Cancel</Button>
            <Button form="student-form" loading={loading} icon={isEditMode ? Edit2 : UserPlus}>
              {isEditMode ? 'Update Student' : 'Register Student'}
            </Button>
          </div>
        }
      >
        <form id="student-form" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <p className="text-xs font-bold text-indigo-600 uppercase tracking-wider flex items-center gap-2">
                <UserPlus className="w-3.5 h-3.5" /> Basic Information
              </p>

              <div className="flex items-center gap-6 mb-6">
                <div className="relative group">
                  <Avatar name={formData.name || 'S'} src={formData.photoURL} size="lg" className="w-20 h-20 shadow-lg" />
                  <label className="absolute -bottom-1 -right-1 w-8 h-8 bg-white rounded-lg shadow-md border border-slate-100 flex items-center justify-center cursor-pointer hover:bg-slate-50 transition-all">
                    <Plus className="w-4 h-4 text-indigo-600" />
                    <input type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} />
                  </label>
                </div>
                <div>
                   <p className="text-sm font-bold text-slate-900">Student Photo</p>
                   <p className="text-[10px] text-slate-400">Click the + to upload</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Full Name" required className="col-span-2">
                  <Input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Student's full name" />
                </FormField>
                <FormField label="Admission / School No." required className="col-span-2">
                  <Input required value={formData.admissionNumber} onChange={e => setFormData({...formData, admissionNumber: e.target.value, schoolNumber: e.target.value})} placeholder="e.g. 1234567" className="font-mono" />
                </FormField>
                <FormField label="Class" required>
                  <Select required value={formData.classId} onChange={e => setFormData({...formData, classId: e.target.value, section: ''})}>
                    <option value="">Select Class</option>
                    {classes.map(cls => <option key={cls.id} value={cls.id}>Class {cls.name}</option>)}
                  </Select>
                </FormField>
                <FormField label="Section" required>
                  <Select required value={formData.section} onChange={e => setFormData({...formData, section: e.target.value})} disabled={!formData.classId}>
                    <option value="">Section</option>
                    {classes.find(c => c.id === formData.classId)?.sections.map((sec, i) => (
                      <option key={i} value={sec.name || 'A'}>Section {sec.name || 'A'}</option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Gender">
                  <Select value={formData.gender} onChange={e => setFormData({...formData, gender: e.target.value})}>
                    <option value="">Select Gender (optional)</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </Select>
                </FormField>
                <FormField label="House">
                  <Select value={formData.houseId} onChange={e => setFormData({...formData, houseId: e.target.value})}>
                    <option value="">Select House (optional)</option>
                    {houses.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </Select>
                </FormField>
                <FormField label="Student Email" className="col-span-2">
                  <Input type="email" value={formData.studentEmail} onChange={e => setFormData({...formData, studentEmail: e.target.value})} placeholder="Optional" />
                </FormField>
              </div>
            </div>

            {/* Parent Info */}
            <div className="space-y-4">
              <p className="text-xs font-bold text-indigo-600 uppercase tracking-wider flex items-center gap-2">
                <Users className="w-3.5 h-3.5" /> Parent Information
              </p>
              <div className="space-y-3">
                <FormField label="Father's Name" required>
                  <Input required value={formData.fatherName} onChange={e => setFormData({...formData, fatherName: e.target.value})} />
                </FormField>
                <FormField label="Mother's Name" required>
                  <Input required value={formData.motherName} onChange={e => setFormData({...formData, motherName: e.target.value})} />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Phone" required>
                    <Input type="tel" required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                  </FormField>
                  <FormField label="Email">
                    <Input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="Optional" />
                  </FormField>
                </div>
              </div>
            </div>

            {/* Additional Details */}
            <div className="md:col-span-2 space-y-4">
              <p className="text-xs font-bold text-indigo-600 uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-3.5 h-3.5" /> Additional Details
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <FormField label="Transport">
                  <Select value={formData.transportDetails} onChange={e => setFormData({...formData, transportDetails: e.target.value})}>
                    <option value="">Select transport</option>
                    <option value="School">School</option>
                    <option value="Private">Private</option>
                  </Select>
                </FormField>
                <FormField label="Medical Notes">
                  <Textarea rows={2} value={formData.medicalNotes} onChange={e => setFormData({...formData, medicalNotes: e.target.value})} />
                </FormField>
                <FormField label="Academic History" className="md:col-span-2">
                  <Textarea rows={2} value={formData.academicHistory} onChange={e => setFormData({...formData, academicHistory: e.target.value})} />
                </FormField>
                <FormField label="Parent Address" className="md:col-span-2">
                  <Textarea rows={2} value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} />
                </FormField>
              </div>
            </div>
          </div>
        </form>
      </Modal>

      {/* Bulk Import Modal */}
      <Modal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Bulk Import Students"
        subtitle="Upload a CSV file to add multiple students at once"
        size="xl"
        footer={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 12 }}>
            <button className="btn ghost" style={{ width: 'auto', padding: '8px 14px', fontSize: 13 }} onClick={handleDownloadTemplate}>
              <FileDown size={14} /> Download Template
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost" style={{ width: 'auto', padding: '8px 14px', fontSize: 13 }} onClick={() => setImportModalOpen(false)}>
                Cancel
              </button>
              {(() => {
                const skipCount = Object.keys(importRowIssues).length;
                const importable = importRows.length - skipCount;
                return (
                  <button
                    className="btn accent"
                    style={{ width: 'auto', padding: '8px 16px', fontSize: 13, opacity: (importable <= 0 || !!importProgress) ? 0.45 : 1 }}
                    onClick={handleBulkImport}
                    disabled={importable <= 0 || !!importProgress}
                  >
                    <Upload size={14} />
                    {importRows.length > 0
                      ? `Import ${importable} Student${importable !== 1 ? 's' : ''}${skipCount > 0 ? ` (${skipCount} will skip)` : ''}`
                      : 'Import'}
                  </button>
                );
              })()}
            </div>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* File drop zone */}
          {!importProgress && (
            <label
              className="card"
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                height: 140, border: '2px dashed var(--line)', cursor: 'pointer', gap: 8, transition: 'border-color .15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--ink-3)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--line)')}
            >
              <Upload size={28} style={{ color: 'var(--ink-4)' }} />
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>Click to upload CSV file</p>
              <p className="eyebrow">or drag and drop</p>
              <input
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={e => e.target.files?.[0] && handleCSVFile(e.target.files[0])}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) handleCSVFile(f); }}
              />
            </label>
          )}

          {/* Preview table — nothing blocks the import; rows with issues are simply skipped */}
          {importRows.length > 0 && !importProgress && (() => {
            const skipCount = Object.keys(importRowIssues).length;
            const importable = importRows.length - skipCount;
            return (
            <div>
              {/* Summary badges */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-3)' }}>
                  Preview
                </span>
                <span style={{ background: 'oklch(0.95 0.07 145)', color: 'var(--leaf)', borderRadius: 99, fontSize: 11, fontWeight: 700, padding: '2px 8px' }}>
                  ✓ {importable} will import
                </span>
                {skipCount > 0 && (
                  <span style={{ background: 'oklch(0.96 0.08 85)', color: 'oklch(0.52 0.18 85)', borderRadius: 99, fontSize: 11, fontWeight: 700, padding: '2px 8px' }}>
                    ⊘ {skipCount} will skip (missing data / duplicate)
                  </span>
                )}
                {Object.keys(importRowWarnings).length > 0 && (
                  <span style={{ background: 'oklch(0.96 0.05 60)', color: 'oklch(0.52 0.15 60)', borderRadius: 99, fontSize: 11, fontWeight: 700, padding: '2px 8px' }}>
                    ⚠ {Object.keys(importRowWarnings).length} missing optional fields
                  </span>
                )}
              </div>
              {skipCount > 0 && (
                <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 10 }}>
                  Rows with missing required data or duplicate admission numbers will be skipped automatically. A full report is downloadable after import.
                </p>
              )}
              <div className="card" style={{ padding: 0, overflow: 'hidden', maxHeight: 250, overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--cream-2)', position: 'sticky', top: 0 }}>
                      {['', 'Name', 'Adm. No.', 'Class', 'Sec.', 'Father', 'Phone', 'Status'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-3)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((row, i) => {
                      const issues = importRowIssues[i];
                      const willSkip = !!issues;
                      const warns = importRowWarnings[i];
                      return (
                        <tr key={i} style={{ borderTop: '1px solid var(--line)', background: willSkip ? 'oklch(0.97 0.04 30)' : 'transparent', opacity: willSkip ? 0.85 : 1 }}>
                          <td style={{ padding: '7px 8px 7px 12px', width: 24 }}>
                            {willSkip ? (
                              <span title={issues.join(', ')} style={{ fontSize: 14, lineHeight: 1, cursor: 'help', color: 'var(--coral)' }}>⊘</span>
                            ) : warns ? (
                              <span title={warns.join(', ')} style={{ fontSize: 14, lineHeight: 1, cursor: 'help' }}>⚠</span>
                            ) : (
                              <span style={{ fontSize: 14, lineHeight: 1, color: 'var(--leaf)' }}>✓</span>
                            )}
                          </td>
                          <td style={{ padding: '7px 12px', fontWeight: 600, color: row.name ? 'var(--ink)' : 'var(--ink-4)', fontStyle: row.name ? 'normal' : 'italic' }}>{row.name || '(no name)'}</td>
                          <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', color: 'var(--ink-2)' }}>{row.admissionnumber || '—'}</td>
                          <td style={{ padding: '7px 12px', color: 'var(--ink-2)' }}>{row.class || '—'}</td>
                          <td style={{ padding: '7px 12px', color: 'var(--ink-2)' }}>{row.section || '—'}</td>
                          <td style={{ padding: '7px 12px', color: 'var(--ink-2)' }}>{row.fathername || '—'}</td>
                          <td style={{ padding: '7px 12px', color: 'var(--ink-2)' }}>{row.phone || '—'}</td>
                          <td style={{ padding: '7px 12px', fontSize: 11, color: willSkip ? 'var(--coral)' : 'var(--leaf)' }}>
                            {willSkip ? `Skip — ${issues[0]}${issues.length > 1 ? ` +${issues.length - 1}` : ''}` : 'Import'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            );
          })()}

          {/* Progress + Report */}
          {importProgress && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Progress bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                  {importProgress.done < importProgress.total ? `Importing… ${importProgress.done} / ${importProgress.total}` : 'Done'}
                </span>
                <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                  {importProgress.skipped > 0 && <span style={{ fontWeight: 700, color: 'oklch(0.52 0.18 85)' }}>{importProgress.skipped} skipped</span>}
                  {importProgress.failed > 0 && <span style={{ fontWeight: 700, color: 'var(--coral)' }}>{importProgress.failed} failed</span>}
                </div>
              </div>
              <div style={{ height: 6, background: 'var(--line)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: 6, background: 'var(--accent)', borderRadius: 99, transition: 'width .3s', width: `${(importProgress.done / importProgress.total) * 100}%` }} />
              </div>

              {/* Live result rows */}
              {importResults.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 200, overflowY: 'auto' }}>
                  {importResults.map((r, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, padding: '6px 12px', borderRadius: 8,
                      background: r.status === 'ok' ? 'oklch(0.95 0.07 145)' : r.status === 'error' ? 'oklch(0.97 0.02 30)' : 'oklch(0.96 0.05 85)',
                    }}>
                      <span style={{ marginTop: 1, flexShrink: 0 }}>
                        {r.status === 'ok' ? <CheckCircle2 size={13} style={{ color: 'var(--leaf)' }} /> : r.status === 'error' ? <XCircle size={13} style={{ color: 'var(--coral)' }} /> : <span style={{ fontSize: 13, color: 'oklch(0.52 0.18 85)' }}>⊘</span>}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{r.name}</span>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 6 }}>{r.admissionNumber}</span>
                        {r.message && <div style={{ fontSize: 11, color: r.status === 'error' ? 'var(--coral)' : 'var(--ink-3)', marginTop: 1 }}>{r.message}</div>}
                        {r.warnings && r.warnings.length > 0 && r.status === 'ok' && (
                          <div style={{ fontSize: 11, color: 'oklch(0.52 0.15 60)', marginTop: 1 }}>⚠ {r.warnings.join(' · ')}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Summary + Download Report */}
              {importProgress.done === importProgress.total && (() => {
                const imported   = importResults.filter(r => r.status === 'ok').length;
                const incomplete = importResults.filter(r => r.status === 'incomplete').length;
                const duplicate  = importResults.filter(r => r.status === 'duplicate').length;
                const failed     = importResults.filter(r => r.status === 'error').length;
                const withWarns  = importResults.filter(r => r.status === 'ok' && r.warnings?.length).length;
                const tiles = [
                  { n: imported,   label: 'Imported',     bg: 'oklch(0.95 0.07 145)', fg: 'var(--leaf)' },
                  { n: incomplete, label: 'Missing Data', bg: 'oklch(0.96 0.05 85)',  fg: 'oklch(0.52 0.18 85)' },
                  { n: duplicate,  label: 'Duplicates',   bg: 'oklch(0.96 0.05 85)',  fg: 'oklch(0.52 0.18 85)' },
                  { n: failed,     label: 'Failed',       bg: 'oklch(0.97 0.02 30)',  fg: 'var(--coral)' },
                ];
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                      {tiles.map(t => (
                        <div key={t.label} style={{ background: t.n > 0 ? t.bg : 'var(--cream-2)', borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
                          <div style={{ fontSize: 22, fontWeight: 800, color: t.n > 0 ? t.fg : 'var(--ink-3)' }}>{t.n}</div>
                          <div style={{ fontSize: 10, fontWeight: 600, color: t.n > 0 ? t.fg : 'var(--ink-3)', opacity: 0.85 }}>{t.label}</div>
                        </div>
                      ))}
                    </div>
                    {(incomplete > 0 || failed > 0) && (
                      <div style={{ fontSize: 12, color: 'var(--ink-2)', padding: '8px 12px', background: 'var(--cream-2)', borderRadius: 8 }}>
                        {incomplete > 0 && <>⊘ {incomplete} row{incomplete > 1 ? 's were' : ' was'} not imported due to missing required data. </>}
                        Download the report below for the exact missing fields per student.
                      </div>
                    )}
                    {withWarns > 0 && (
                      <div style={{ fontSize: 12, color: 'oklch(0.52 0.15 60)', padding: '8px 12px', background: 'oklch(0.96 0.05 60)', borderRadius: 8 }}>
                        ⚠ {withWarns} imported student{withWarns > 1 ? 's' : ''} had missing optional fields (listed in the report).
                      </div>
                    )}
                    <button
                      className="btn ghost"
                      style={{ width: '100%', justifyContent: 'center', fontSize: 13, gap: 6 }}
                      onClick={handleDownloadImportReport}
                    >
                      <FileDown size={14} /> Download Import Report (.csv)
                    </button>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Format rules */}
          {!importProgress && importRows.length === 0 && (
            <div className="card" style={{ padding: 14, background: 'var(--cream-2)' }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>CSV format rules</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ink-3)' }}>
                <p>• First row must be the header row exactly as in the template</p>
                <p>• <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>Required:</span> name, admissionNumber, class, section, fatherName, motherName, phone</p>
                <p>• <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>Optional:</span> gender, email, studentEmail, house, transport (School/Private), medicalNotes, academicHistory, address</p>
                <p>• <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>class</span> must match an existing class name (e.g. "5", "10A")</p>
                <p>• Rows missing required data or with duplicate admission numbers are <span style={{ fontWeight: 600, color: 'var(--ink-2)' }}>skipped automatically</span> — the rest still import</p>
                <p>• A downloadable report lists exactly what imported and what was skipped (with reasons)</p>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="Delete Student Data"
        subtitle={`Select deletion scope for ${deletingStudent?.name}`}
        size="sm"
        footer={<div className="flex justify-end"><Button variant="ghost" onClick={() => setIsDeleteModalOpen(false)}>Cancel</Button></div>}
      >
        {deletingStudent && (
          <div className="space-y-3">
            <button onClick={() => performDelete({ deleteStudent: true, deleteParent: true, deleteEverything: true, downloadFirst: false })} disabled={loading}
              className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-red-50 border border-slate-200 hover:border-red-200 rounded-xl transition-all group text-left">
              <div><p className="font-semibold text-slate-900 group-hover:text-red-700 text-sm">Delete Entire Database</p><p className="text-xs text-slate-400 mt-0.5">Student, parent, and all related records</p></div>
              <Trash2 className="w-4 h-4 text-slate-400 group-hover:text-red-500 shrink-0" />
            </button>
            <button onClick={() => performDelete({ deleteStudent: true, deleteParent: true, deleteEverything: true, downloadFirst: true })} disabled={loading}
              className="w-full flex items-center justify-between p-4 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-all group text-left">
              <div><p className="font-semibold text-indigo-900 text-sm">Download &amp; Delete Everything</p><p className="text-xs text-indigo-500 mt-0.5">Generates PDF record before deletion</p></div>
              <Download className="w-4 h-4 text-indigo-500 shrink-0" />
            </button>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => performDelete({ deleteStudent: true, deleteParent: false, deleteEverything: false, downloadFirst: false })} disabled={loading}
                className="p-3 bg-white border border-slate-200 hover:border-slate-300 rounded-xl text-left transition-all">
                <p className="font-semibold text-slate-900 text-sm">Student Only</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Keep parent active</p>
              </button>
              <button onClick={() => performDelete({ deleteStudent: false, deleteParent: true, deleteEverything: false, downloadFirst: false })} disabled={loading}
                className="p-3 bg-white border border-slate-200 hover:border-slate-300 rounded-xl text-left transition-all">
                <p className="font-semibold text-slate-900 text-sm">Parent Only</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Keep student active</p>
              </button>
            </div>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">These actions are permanent and cannot be undone.</p>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Export CSV Modal ─────────────────────────────────────────────── */}
      <Modal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        title="Export Students to CSV"
        size="md"
      >
        <div className="space-y-5">
          {/* Scope selection */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Scope</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setExportScope('filtered')}
                className={cn(
                  'p-3 rounded-xl border text-left transition-all',
                  exportScope === 'filtered'
                    ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                )}
              >
                <p className="text-sm font-bold text-slate-900">Current filter</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{filteredStudents.length} student{filteredStudents.length !== 1 ? 's' : ''}</p>
              </button>
              <button
                type="button"
                onClick={() => setExportScope('all')}
                className={cn(
                  'p-3 rounded-xl border text-left transition-all',
                  exportScope === 'all'
                    ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-200'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                )}
              >
                <p className="text-sm font-bold text-slate-900">All students</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{students.length} student{students.length !== 1 ? 's' : ''}</p>
              </button>
            </div>
          </div>

          {/* Column selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Columns ({Object.values(exportCols).filter(Boolean).length}/{ALL_EXPORT_COLUMNS.length})</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setExportCols(Object.fromEntries(ALL_EXPORT_COLUMNS.map(c => [c.key, true])) as Record<ExportColKey, boolean>)}
                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() => setExportCols(Object.fromEntries(ALL_EXPORT_COLUMNS.map(c => [c.key, false])) as Record<ExportColKey, boolean>)}
                  className="text-[11px] font-semibold text-slate-500 hover:text-rose-600"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 max-h-72 overflow-y-auto p-2 bg-slate-50 rounded-xl border border-slate-200">
              {ALL_EXPORT_COLUMNS.map(col => (
                <label
                  key={col.key}
                  className="flex items-center gap-2 px-2.5 py-1.5 bg-white rounded-lg border border-slate-100 hover:border-indigo-200 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={exportCols[col.key]}
                    onChange={() => setExportCols(prev => ({ ...prev, [col.key]: !prev[col.key] }))}
                    className="w-4 h-4 rounded text-indigo-600"
                  />
                  <span className="font-medium text-slate-700">{col.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setExportModalOpen(false)}>Cancel</Button>
            <Button size="sm" icon={FileDown} onClick={handleExportCSV}>
              Download CSV
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Student Profile Drawer ── */}
      {profileStudent && (
        <StudentProfileView
          student={profileStudent}
          user={user}
          onClose={() => setProfileStudent(null)}
        />
      )}
    </>
  );
}

// ─── Table styles ─────────────────────────────────────────────────────────────
const thStyle: React.CSSProperties = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--ink-3)',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 14px',
  fontSize: 13,
  verticalAlign: 'middle',
};

// ─── Detail row ───────────────────────────────────────────────────────────────
function DetailRow({ icon: Icon, label, value, multiline = false }: { icon: any; label: string; value: string; multiline?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
      <div style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
        <Icon size={12} style={{ color: 'var(--ink-3)' }} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p className="eyebrow" style={{ marginBottom: 2 }}>{label}</p>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', ...(multiline ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word' } : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }) }}>
          {value}
        </p>
      </div>
    </div>
  );
}
