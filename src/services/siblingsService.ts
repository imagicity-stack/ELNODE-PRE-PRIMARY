import { collection, getDoc, getDocs, query, where, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { Student } from '../types';

export interface SiblingInfo {
  id: string;
  name: string;
  admissionNumber: string;
  class: string;
}

const normalizePhone = (p: string) => (p || '').replace(/\D/g, '').slice(-10);

// Resolve readable class names ("Class 5 · A") for a set of student records.
async function resolveClasses(students: Student[]): Promise<Record<string, string>> {
  const classMap: Record<string, string> = {};
  try {
    const classSnap = await getDocs(collection(db, 'classes'));
    classSnap.forEach(c => { classMap[c.id] = (c.data() as any).name || c.id; });
  } catch { /* fall back to raw classId */ }
  return classMap;
}

function toSiblingInfo(students: Student[], selfId: string, classMap: Record<string, string>): SiblingInfo[] {
  return students
    .filter(s => s.id !== selfId)
    .map(s => ({
      id: s.id,
      name: s.name,
      admissionNumber: s.admissionNumber,
      class: `${classMap[s.classId] || s.classId || ''}${s.section ? ` · ${s.section}` : ''}`.trim(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Admin / staff path ──────────────────────────────────────────────────────
// Queries the students collection for everyone sharing this student's parent
// (by parentId, with a phone-number fallback). Requires list permission, so
// this is only usable from admin/teacher/accountant contexts.
export async function getSiblingsByParent(student: Student): Promise<SiblingInfo[]> {
  if (!student?.id) return [];
  const matches = new Map<string, Student>();

  if (student.parentId) {
    try {
      const snap = await getDocs(query(collection(db, 'students'), where('parentId', '==', student.parentId)));
      snap.forEach(d => matches.set(d.id, { id: d.id, ...d.data() } as Student));
    } catch { /* permission or index issue — ignore */ }
  }

  // Fallback: match on the parent's phone number (covers older records created
  // before parentId linkage was consistent).
  const phone = normalizePhone(student.parentDetails?.phone || '');
  if (phone && matches.size <= 1) {
    try {
      const all = await getDocs(collection(db, 'students'));
      all.forEach(d => {
        const s = { id: d.id, ...d.data() } as Student;
        if (normalizePhone(s.parentDetails?.phone || '') === phone) matches.set(d.id, s);
      });
    } catch { /* not permitted to list — ignore */ }
  }

  if (matches.size <= 1) return [];
  const classMap = await resolveClasses(Array.from(matches.values()));
  return toSiblingInfo(Array.from(matches.values()), student.id, classMap);
}

// ── Parent path ───────────────────────────────────────────────────────────────
// Uses the parent's own studentIds array (the children linked to their account).
// Parents can `get` each linked student even though they can't list the roster.
export async function getSiblingsForParent(
  selfStudentId: string,
  linkedStudentIds: string[],
): Promise<SiblingInfo[]> {
  const ids = (linkedStudentIds || []).filter(id => id && id !== selfStudentId);
  if (ids.length === 0) return [];
  const students: Student[] = [];
  await Promise.all(ids.map(async id => {
    try {
      const snap = await getDoc(doc(db, 'students', id));
      if (snap.exists()) students.push({ id: snap.id, ...snap.data() } as Student);
    } catch { /* not linked / not permitted — skip */ }
  }));
  if (students.length === 0) return [];
  const classMap = await resolveClasses(students);
  // selfStudentId already excluded from ids, but pass it through toSiblingInfo for safety.
  return toSiblingInfo(students, selfStudentId, classMap);
}
