import { collection, getDocs, query, orderBy, where, limit } from 'firebase/firestore';
import { db } from '../firebase';

function pad(n: number) { return String(n).padStart(2, '0'); }
function fmt(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function monthKey(dateStr: string) { return (dateStr || '').slice(0, 7); }
function pct(num: number, den: number) { return den > 0 ? Math.round((num / den) * 100) : 0; }
function avg(arr: number[]) { return arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0; }
function inr(n: number) { return Math.round(n); }
function str(v: any) { return v ? String(v).trim() : ''; }

// A single failed collection never crashes the whole context load.
async function safeGet(q: any): Promise<{ docs: any[] }> {
  try {
    return await getDocs(q);
  } catch (e: any) {
    console.warn('[aiContext] fetch failed:', e?.code || e?.message);
    return { docs: [] };
  }
}

// ─── Super Admin / Full-School Context ───────────────────────────────────────

export async function buildAIContext(periodLabel = 'This Month') {
  const now = new Date();
  const today = fmt(now);
  const todayMinus30 = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));

  let from: Date, to: Date;
  if (periodLabel === 'This Month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (periodLabel === 'Last Month') {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to   = new Date(now.getFullYear(), now.getMonth(), 0);
  } else if (periodLabel === 'This Quarter') {
    const q = Math.floor(now.getMonth() / 3);
    from = new Date(now.getFullYear(), q * 3, 1);
    to   = new Date(now.getFullYear(), q * 3 + 3, 0);
  } else {
    from = new Date(now.getFullYear(), 0, 1);
    to   = new Date(now.getFullYear(), 11, 31);
  }

  const range      = { from: fmt(from), to: fmt(to), label: periodLabel };
  const monthPrefix = range.from.slice(0, 7);
  const inRange    = (date: string) => date >= range.from && date <= range.to;

  // ── All Firestore fetches in parallel ─────────────────────────────────────
  const [
    studSnap, classSnap, houseSnap, subjectSnap, teacherSnap, staffSnap,
    expSnap, paySnap, salSnap, reqSnap, advSnap,
    attTodaySnap, attMonthSnap,
    teachLeaveSnap, studLeaveSnap,
    examSnap, examResultSnap,
    grievanceSnap, noticeSnap, homeworkSnap,
    feeStructSnap, feeHeadsSnap, gradingScaleSnap, lessonLogSnap, admissionSnap,
  ] = await Promise.all([
    safeGet(collection(db, 'students')),
    safeGet(collection(db, 'classes')),
    safeGet(collection(db, 'houses')),
    safeGet(collection(db, 'subjects')),
    safeGet(collection(db, 'teachers')),
    safeGet(collection(db, 'staff')),
    safeGet(query(collection(db, 'expenses'), orderBy('date', 'desc'), limit(300))),
    safeGet(query(collection(db, 'feePayments'), orderBy('date', 'desc'), limit(500))),
    safeGet(collection(db, 'salaries')),
    safeGet(collection(db, 'feeRequests')),
    safeGet(query(collection(db, 'advancePayments'), orderBy('createdAt', 'desc'), limit(200))),
    safeGet(query(collection(db, 'attendance'), where('date', '==', today))),
    safeGet(query(collection(db, 'attendance'), where('date', '>=', todayMinus30))),
    safeGet(query(collection(db, 'teacherLeaves'), orderBy('createdAt', 'desc'), limit(100))),
    safeGet(query(collection(db, 'studentLeaves'), orderBy('createdAt', 'desc'), limit(100))),
    safeGet(query(collection(db, 'exams'), orderBy('startDate', 'desc'), limit(50))),
    safeGet(query(collection(db, 'examResults'), limit(500))),
    safeGet(query(collection(db, 'grievances'), orderBy('createdAt', 'desc'), limit(100))),
    safeGet(query(collection(db, 'notices'), orderBy('createdAt', 'desc'), limit(30))),
    safeGet(query(collection(db, 'homework'), orderBy('dueDate', 'desc'), limit(100))),
    safeGet(collection(db, 'feeStructures')),
    safeGet(collection(db, 'feeHeads')),
    safeGet(collection(db, 'gradingScales')),
    safeGet(query(collection(db, 'lessonLogs'), orderBy('date', 'desc'), limit(100))),
    safeGet(query(collection(db, 'admissions'), orderBy('createdAt', 'desc'), limit(50))),
  ]);

  // ── Raw arrays ────────────────────────────────────────────────────────────
  const students    = studSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const classes     = classSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const houses      = houseSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const subjects    = subjectSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const teachers    = teacherSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const staffList   = staffSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const expenses    = expSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const payments    = paySnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const salaries    = salSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const feeReqs     = reqSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const advPayments = advSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const attToday    = attTodaySnap.docs.map(d => d.data() as any);
  const attMonth    = attMonthSnap.docs.map(d => d.data() as any);
  const tLeaves     = teachLeaveSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const sLeaves     = studLeaveSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const exams       = examSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const examResults = examResultSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const grievances    = grievanceSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const notices       = noticeSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const homework      = homeworkSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const feeStructures = feeStructSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const feeHeads      = feeHeadsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const gradingScales = gradingScaleSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const lessonLogs    = lessonLogSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const admissions    = admissionSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  // ── Lookup maps ───────────────────────────────────────────────────────────
  const classMap:   Record<string, string> = {};
  const houseMap:   Record<string, string> = {};
  const subjectMap: Record<string, string> = {};
  const studentMap: Record<string, any>    = {};

  for (const c of classes)  classMap[c.id]   = c.name;
  for (const h of houses)   houseMap[h.id]   = h.name;
  for (const s of subjects) subjectMap[s.id] = s.name;
  for (const s of students) studentMap[s.id] = s;

  // ── Warning: track empty collections ─────────────────────────────────────
  const emptyCollections: string[] = [];
  const chk = (name: string, snap: { docs: any[] }, mustHaveData = true) => {
    if (mustHaveData && snap.docs.length === 0) emptyCollections.push(name);
  };
  chk('attendance-today', attTodaySnap);
  chk('grievances', grievanceSnap);
  chk('teacherLeaves', teachLeaveSnap);
  chk('studentLeaves', studLeaveSnap);
  chk('examResults', examResultSnap);

  // ── Period filters ────────────────────────────────────────────────────────
  const periodExpenses = expenses.filter(e => e.date && inRange(e.date));
  const periodPayments = payments.filter(p => p.date && inRange(p.date));
  const periodSalaries = salaries.filter(s => s.month && s.month.startsWith(monthPrefix));

  // ── Finance ───────────────────────────────────────────────────────────────
  const totalIncome   = periodPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const totalExpenses = periodExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const totalSalaries = periodSalaries.reduce((s, s2) => s + (s2.netAmount || 0), 0);
  const netProfit     = totalIncome - totalExpenses - totalSalaries;

  const expensesByCategory: Record<string, number> = {};
  for (const e of periodExpenses) {
    const k = e.category || 'other';
    expensesByCategory[k] = (expensesByCategory[k] || 0) + (e.amount || 0);
  }

  const paymentMethodBreakdown: Record<string, number> = {};
  for (const p of periodPayments) {
    const k = p.method || p.paymentMethod || 'unknown';
    paymentMethodBreakdown[k] = (paymentMethodBreakdown[k] || 0) + (p.amount || 0);
  }

  const discountsGiven = periodPayments.reduce((s, p) => s + (p.discountAmount || 0), 0);
  const fineCollected  = periodPayments.reduce((s, p) => s + (p.fineAmount || 0), 0);
  const advTotal       = advPayments
    .filter(a => inRange((a.createdAt || '').slice(0, 10)))
    .reduce((s, a) => s + (a.amount || 0), 0);

  const overdueFeeReqs = feeReqs.filter(r => r.dueDate && r.dueDate < today && r.status !== 'paid');
  const pendingFeeReqs = feeReqs.filter(r => r.status !== 'paid');
  const overdueAmount  = overdueFeeReqs.reduce(
    (s, r) => s + Math.max(0, (r.totalAmount || 0) - (r.paidAmount || 0) - (r.waivedAmount || 0)), 0
  );
  const collectionRate = pct(feeReqs.filter(r => r.status === 'paid').length, feeReqs.length);

  // Monthly 6-month trend
  const monthlyMap: Record<string, { income: number; expenses: number; salaries: number }> = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    monthlyMap[k] = { income: 0, expenses: 0, salaries: 0 };
  }
  for (const p of payments) { const k = monthKey(p.date);  if (monthlyMap[k]) monthlyMap[k].income   += p.amount    || 0; }
  for (const e of expenses) { const k = monthKey(e.date);  if (monthlyMap[k]) monthlyMap[k].expenses += e.amount    || 0; }
  for (const s of salaries) { const k = s.month;           if (monthlyMap[k]) monthlyMap[k].salaries += s.netAmount || 0; }

  // ── Attendance ────────────────────────────────────────────────────────────
  const attPresent = attToday.filter(a => a.status === 'present').length;
  const attAbsent  = attToday.filter(a => a.status === 'absent').length;
  const attLate    = attToday.filter(a => a.status === 'late').length;

  const attByClass: Record<string, { present: number; absent: number; total: number }> = {};
  for (const a of attToday) {
    if (!attByClass[a.classId]) attByClass[a.classId] = { present: 0, absent: 0, total: 0 };
    attByClass[a.classId].total++;
    if (a.status === 'present') attByClass[a.classId].present++;
    if (a.status === 'absent')  attByClass[a.classId].absent++;
  }

  const studentAttMap: Record<string, { present: number; total: number }> = {};
  for (const a of attMonth) {
    if (!studentAttMap[a.studentId]) studentAttMap[a.studentId] = { present: 0, total: 0 };
    studentAttMap[a.studentId].total++;
    if (a.status === 'present') studentAttMap[a.studentId].present++;
  }
  const chronicAbsenteeIds = Object.entries(studentAttMap)
    .filter(([, v]) => pct(v.present, v.total) < 75)
    .map(([id]) => id);

  // ── Exam results ──────────────────────────────────────────────────────────
  const resultPcts = examResults.map(r => r.percentage || 0).filter(p => p > 0);
  const avgExamPct = avg(resultPcts);
  const passRate   = pct(resultPcts.filter(p => p >= 40).length, resultPcts.length);

  const resultByClass: Record<string, number[]> = {};
  for (const r of examResults) {
    if (!resultByClass[r.classId]) resultByClass[r.classId] = [];
    if (r.percentage > 0) resultByClass[r.classId].push(r.percentage);
  }

  // ── Build full context ────────────────────────────────────────────────────
  return {
    generatedAt: now.toISOString(),
    period: range,
    _dataWarnings: emptyCollections.length > 0
      ? `Some collections returned no data (permission issue or empty): ${emptyCollections.join(', ')}. Run: firebase deploy --only firestore:rules`
      : null,

    // ── STUDENTS — full individual records ───────────────────────────────────
    students: students.map(s => ({
      id:              s.id,
      name:            str(s.name),
      admissionNumber: str(s.admissionNumber),
      schoolNumber:    str(s.schoolNumber),
      class:           classMap[s.classId] ? `Class ${classMap[s.classId]}` : str(s.classId),
      section:         str(s.section),
      gender:          str(s.gender),
      house:           houseMap[s.houseId] || '',
      transport:       str(s.transportDetails),
      address:         str(s.address),
      studentEmail:    str(s.email),
      medicalNotes:    str(s.medicalNotes),
      academicHistory: str(s.academicHistory),
      feeStatus:       str(s.feeStatus),
      parent: {
        fatherName: str(s.parentDetails?.fatherName),
        motherName: str(s.parentDetails?.motherName),
        phone:      str(s.parentDetails?.phone),
        email:      str(s.parentDetails?.email),
      },
    })),

    // ── TEACHERS — full individual records ───────────────────────────────────
    teachers: teachers.map(t => ({
      id:              t.id,
      name:            str(t.name),
      email:           str(t.email),
      phone:           str(t.phone),
      employeeId:      str(t.employeeId),
      joiningDetails:  str(t.joiningDetails),
      subjects:        (t.subjects || []).map((id: string) => subjectMap[id] || id),
      classes:         (t.classes  || []).map((id: string) => classMap[id]   ? `Class ${classMap[id]}` : id),
      classTeacherOf:  classMap[t.classTeacherOf] ? `Class ${classMap[t.classTeacherOf]}` : str(t.classTeacherOf),
      isHouseIncharge: !!t.isHouseIncharge,
      casualLeaveQuota: t.casualLeaveQuota ?? null,
    })),

    // ── STAFF — full individual records ──────────────────────────────────────
    staff: staffList.map(s => ({
      id:          s.id,
      name:        str(s.name),
      email:       str(s.email),
      phone:       str(s.phone),
      employeeId:  str(s.employeeId),
      role:        str(s.role),
      category:    str(s.category),
      status:      str(s.status),
      joiningDate: str(s.joiningDate),
      salary:      s.salary ?? null,
    })),

    // ── SCHOOL OVERVIEW (aggregates) ─────────────────────────────────────────
    school: {
      totalStudents: students.length,
      totalTeachers: teachers.length,
      totalStaff:    staffList.length,
      totalClasses:  classes.length,
      totalHouses:   houses.length,
      enrollmentByClass: classes.map(c => ({
        class:    `Class ${c.name}`,
        students: students.filter(s => s.classId === c.id).length,
        sections: [...new Set(students.filter(s => s.classId === c.id).map(s => s.section).filter(Boolean))].join(', '),
      })).filter(c => c.students > 0).sort((a, b) => b.students - a.students),
      genderBreakdown: {
        male:    students.filter(s => (s.gender || '').toLowerCase() === 'male').length,
        female:  students.filter(s => (s.gender || '').toLowerCase() === 'female').length,
        other:   students.filter(s => (s.gender || '').toLowerCase() === 'other').length,
        unknown: students.filter(s => !s.gender).length,
      },
      transportBreakdown: {
        school:  students.filter(s => (s.transportDetails || '').toLowerCase() === 'school').length,
        private: students.filter(s => (s.transportDetails || '').toLowerCase() === 'private').length,
        unknown: students.filter(s => !s.transportDetails).length,
      },
      houseBreakdown: houses.map(h => ({
        house: h.name, count: students.filter(s => s.houseId === h.id).length,
      })),
      subjects: subjects.map(s => ({ id: s.id, name: s.name })),
      classes:  classes.map(c => ({ id: c.id, name: `Class ${c.name}`, sections: (c.sections || []).map((sec: any) => sec.name || sec) })),
    },

    // ── FINANCE ───────────────────────────────────────────────────────────────
    finance: {
      period: {
        income:   inr(totalIncome),
        expenses: inr(totalExpenses),
        salaries: inr(totalSalaries),
        net:      inr(netProfit),
      },
      feeCollection: {
        totalRequests:           feeReqs.length,
        paidCount:               feeReqs.filter(r => r.status === 'paid').length,
        pendingCount:            pendingFeeReqs.length,
        overdueCount:            overdueFeeReqs.length,
        overdueAmount:           inr(overdueAmount),
        collectedThisPeriod:     inr(totalIncome),
        collectionRate,
        discountsGiven:          inr(discountsGiven),
        fineCollected:           inr(fineCollected),
        advancePaymentsThisPeriod: inr(advTotal),
      },
      paymentMethods: Object.fromEntries(
        Object.entries(paymentMethodBreakdown).map(([k, v]) => [k, inr(v)])
      ),
      expensesByCategory: Object.fromEntries(
        Object.entries(expensesByCategory).map(([k, v]) => [k, inr(v)])
      ),
      allExpenses: periodExpenses.map(e => ({
        date:        e.date,
        category:    e.category,
        biller:      e.biller,
        amount:      inr(e.amount || 0),
        description: str(e.description),
        paymentMode: str(e.paymentMode),
        status:      str(e.status),
      })),
      allSalaryRecords: periodSalaries.map(s => ({
        employeeName: str(s.employeeName),
        role:         str(s.employeeRole),
        month:        str(s.month),
        baseAmount:   inr(s.baseAmount || 0),
        allowances:   inr(s.allowances || 0),
        deductions:   inr((s.deductions?.pf || 0) + (s.deductions?.tax || 0) + (s.deductions?.leaves || 0)),
        netAmount:    inr(s.netAmount || 0),
        paidAmount:   inr(s.paidAmount || 0),
        status:       str(s.status),
        remarks:      str(s.remarks),
      })),
      overdueFeeRequests: overdueFeeReqs.map(r => {
        const stu = studentMap[r.studentId];
        return {
          studentName:    stu ? str(stu.name) : str(r.studentId),
          admissionNumber: stu ? str(stu.admissionNumber) : '',
          class:          stu ? (classMap[stu.classId] ? `Class ${classMap[stu.classId]}` : '') : '',
          parentPhone:    stu ? str(stu.parentDetails?.phone) : '',
          month:          r.month,
          dueDate:        r.dueDate,
          outstanding:    inr(Math.max(0, (r.totalAmount || 0) - (r.paidAmount || 0) - (r.waivedAmount || 0))),
          heads:          (r.heads || []).map((h: any) => ({ name: h.name, amount: inr(h.finalAmount ?? h.amount ?? 0) })),
        };
      }),
      recentPayments: periodPayments.slice(0, 30).map(p => {
        const stu = studentMap[p.studentId];
        return {
          date:           p.date,
          studentName:    stu ? str(stu.name) : str(p.studentId),
          amount:         inr(p.amount || 0),
          method:         str(p.method),
          receiptNumber:  str(p.receiptNumber),
          discount:       inr(p.discountAmount || 0),
        };
      }),
      advancePayments: advPayments.slice(0, 50).map(a => {
        const stu = studentMap[a.studentId];
        return {
          studentName: stu ? str(stu.name) : str(a.studentId),
          amount:      inr(a.amount || 0),
          date:        (a.createdAt || '').slice(0, 10),
          status:      str(a.status),
        };
      }),
      monthlyTrend: Object.entries(monthlyMap).map(([month, v]) => ({
        month,
        income:   inr(v.income),
        expenses: inr(v.expenses),
        salaries: inr(v.salaries),
        net:      inr(v.income - v.expenses - v.salaries),
      })),
    },

    // ── ATTENDANCE ────────────────────────────────────────────────────────────
    attendance: {
      today: {
        date:    today,
        present: attPresent,
        absent:  attAbsent,
        late:    attLate,
        total:   attToday.length,
        rate:    pct(attPresent, attToday.length),
      },
      last30Days: {
        avgAttendanceRate:    pct(attMonth.filter(a => a.status === 'present').length, attMonth.length),
        totalRecordsAnalyzed: attMonth.length,
        chronicAbsenteesCount: chronicAbsenteeIds.length,
        chronicAbsentees: chronicAbsenteeIds.slice(0, 20).map(id => {
          const stu = studentMap[id];
          const stats = studentAttMap[id];
          return {
            name:            stu ? str(stu.name) : id,
            admissionNumber: stu ? str(stu.admissionNumber) : '',
            class:           stu ? (classMap[stu.classId] ? `Class ${classMap[stu.classId]}` : '') : '',
            parentPhone:     stu ? str(stu.parentDetails?.phone) : '',
            attendanceRate:  pct(stats.present, stats.total),
          };
        }),
      },
      classwiseToday: Object.entries(attByClass).map(([cId, v]) => ({
        class:   classMap[cId] ? `Class ${classMap[cId]}` : cId,
        present: v.present,
        absent:  v.absent,
        total:   v.total,
        rate:    pct(v.present, v.total),
      })).sort((a, b) => a.rate - b.rate),
    },

    // ── LEAVES ────────────────────────────────────────────────────────────────
    leaves: {
      teachers: {
        pendingApproval:   tLeaves.filter(l => l.status === 'pending').length,
        approvedThisMonth: tLeaves.filter(l => l.status === 'approved' && (l.createdAt || '').startsWith(monthPrefix)).length,
        byType: tLeaves.reduce((acc: Record<string, number>, l) => {
          const t = l.leaveType || 'other'; acc[t] = (acc[t] || 0) + 1; return acc;
        }, {}),
        allLeaves: tLeaves.slice(0, 50).map(l => ({
          teacher:  str(l.teacherName),
          type:     str(l.leaveType),
          from:     str(l.startDate),
          to:       str(l.endDate),
          days:     l.totalDays ?? null,
          reason:   str(l.reason),
          status:   str(l.status),
          remarks:  str(l.adminRemarks),
        })),
      },
      students: {
        pendingApproval:   sLeaves.filter(l => l.status === 'pending' || l.status === 'submitted').length,
        approvedThisMonth: sLeaves.filter(l => l.status === 'approved' && (l.createdAt || '').startsWith(monthPrefix)).length,
        allLeaves: sLeaves.slice(0, 50).map(l => ({
          student:     str(l.studentName),
          class:       classMap[l.classId] ? `Class ${classMap[l.classId]}` : str(l.classId),
          section:     str(l.section),
          type:        str(l.leaveType),
          reason:      str(l.reason),
          from:        str(l.startDate),
          to:          str(l.endDate),
          days:        l.totalDays ?? null,
          status:      str(l.status),
          remarks:     str(l.adminRemarks),
        })),
      },
    },

    // ── EXAMS ─────────────────────────────────────────────────────────────────
    exams: {
      all: exams.map(e => ({
        name:      str(e.name),
        type:      str(e.type),
        startDate: str(e.startDate),
        endDate:   str(e.endDate),
        status:    str(e.status),
        maxMarks:  e.maxMarks ?? null,
        classes:   (e.classIds || []).map((c: string) => classMap[c] ? `Class ${classMap[c]}` : c),
        subject:   subjectMap[e.subjectId] || str(e.subjectId),
      })),
      results: {
        totalRecorded: examResults.length,
        avgPercentage: avgExamPct,
        passingRate:   passRate,
        classwiseAverage: Object.entries(resultByClass).map(([cId, pcts]) => ({
          class:    classMap[cId] ? `Class ${classMap[cId]}` : cId,
          avgScore: avg(pcts),
          count:    pcts.length,
        })).sort((a, b) => b.avgScore - a.avgScore),
        individualResults: examResults.slice(0, 100).map(r => {
          const stu = studentMap[r.studentId];
          return {
            studentName:    stu ? str(stu.name) : str(r.studentId),
            admissionNumber: stu ? str(stu.admissionNumber) : '',
            class:          classMap[r.classId] ? `Class ${classMap[r.classId]}` : str(r.classId),
            exam:           exams.find(e => e.id === r.examId)?.name || str(r.examId),
            subject:        subjectMap[r.subjectId] || str(r.subjectId),
            percentage:     r.percentage ?? null,
            grade:          str(r.overallGrade),
            obtainedMarks:  r.obtainedMarks ?? null,
            totalMarks:     r.totalMarks ?? null,
            published:      !!r.published,
          };
        }),
      },
    },

    // ── GRIEVANCES ────────────────────────────────────────────────────────────
    grievances: {
      total:          grievances.length,
      open:           grievances.filter(g => g.status !== 'resolved' && g.status !== 'closed').length,
      resolved:       grievances.filter(g => g.status === 'resolved' || g.status === 'closed').length,
      resolutionRate: pct(
        grievances.filter(g => g.status === 'resolved' || g.status === 'closed').length,
        grievances.length
      ),
      byType: grievances.reduce((acc: Record<string, number>, g) => {
        const t = g.type || g.category || 'other'; acc[t] = (acc[t] || 0) + 1; return acc;
      }, {}),
      all: grievances.slice(0, 50).map(g => ({
        type:        str(g.type || g.category),
        description: str(g.description || g.message),
        submittedBy: str(g.parentName || g.submittedBy),
        studentName: str(g.studentName),
        date:        (g.createdAt || '').slice(0, 10),
        status:      str(g.status),
        resolution:  str(g.resolution || g.adminResponse),
      })),
    },

    // ── ACADEMIC ──────────────────────────────────────────────────────────────
    academic: {
      homework: {
        total: homework.length,
        assignedThisWeek: homework.filter(h => {
          const weekAgo = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
          return (h.dueDate || '') >= weekAgo;
        }).length,
        recent: homework.slice(0, 20).map(h => ({
          class:       classMap[h.classId] ? `Class ${classMap[h.classId]}` : str(h.classId),
          subject:     subjectMap[h.subjectId] || str(h.subjectId),
          dueDate:     str(h.dueDate),
          description: str(h.content || h.description),
          teacher:     teachers.find(t => t.id === h.teacherId)?.name || str(h.teacherId),
        })),
      },
      notices: {
        total: notices.length,
        all: notices.map(n => ({
          title:   str(n.title),
          content: str(n.content),
          date:    (n.createdAt || '').slice(0, 10),
          targets: n.targetRoles || [],
        })),
      },
    },

    // ── FEE STRUCTURES ────────────────────────────────────────────────────────
    feeStructures: feeStructures.map(fs => ({
      class:      classMap[fs.classId] || str(fs.classId),
      academicYear: str(fs.academicYear),
      heads: (fs.heads || []).map((h: any) => ({
        name:    str(h.name),
        amount:  inr(h.amount || 0),
      })),
      totalAmount: inr((fs.heads || []).reduce((s: number, h: any) => s + (h.amount || 0), 0)),
    })),

    // ── FEE HEADS ─────────────────────────────────────────────────────────────
    feeHeads: feeHeads.map(fh => ({
      name:        str(fh.name),
      amount:      inr(fh.amount || 0),
      description: str(fh.description),
    })),

    // ── GRADING SCALES ────────────────────────────────────────────────────────
    gradingScales: gradingScales.map(gs => ({
      name:   str(gs.name),
      ranges: (gs.ranges || []).map((r: any) => ({
        min:   r.min ?? null,
        max:   r.max ?? null,
        grade: str(r.grade),
        point: r.point ?? null,
      })),
    })),

    // ── LESSON LOGS ───────────────────────────────────────────────────────────
    lessonLogs: {
      totalRecent: lessonLogs.length,
      bySubject: Object.entries(
        lessonLogs.reduce((acc: Record<string, number>, l) => {
          const s = subjectMap[l.subjectId] || str(l.subjectId);
          acc[s] = (acc[s] || 0) + 1;
          return acc;
        }, {})
      ).map(([subject, count]) => ({ subject, count })).sort((a, b) => b.count - a.count),
      recent: lessonLogs.slice(0, 30).map(l => ({
        date:    str(l.date),
        class:   classMap[l.classId] ? `Class ${classMap[l.classId]}` : str(l.classId),
        subject: subjectMap[l.subjectId] || str(l.subjectId),
        teacher: teachers.find(t => t.id === l.teacherId)?.name || str(l.teacherId),
        topic:   str(l.topic || l.title),
        content: str(l.content || l.description),
      })),
    },

    // ── ADMISSIONS ────────────────────────────────────────────────────────────
    admissions: {
      total:     admissions.length,
      pending:   admissions.filter(a => a.status === 'pending' || a.status === 'under_review').length,
      approved:  admissions.filter(a => a.status === 'approved' || a.status === 'enrolled').length,
      rejected:  admissions.filter(a => a.status === 'rejected').length,
      thisMonth: admissions.filter(a => (a.createdAt || '').startsWith(monthPrefix)).length,
      all: admissions.slice(0, 50).map(a => ({
        applicantName: str(a.studentName || a.applicantName || a.name),
        class:         classMap[a.classId] ? `Class ${classMap[a.classId]}` : str(a.classId || a.applyingForClass),
        date:          (a.createdAt || '').slice(0, 10),
        status:        str(a.status),
        parentName:    str(a.parentName || a.fatherName),
        phone:         str(a.phone || a.parentPhone || a.contactNumber),
      })),
    },
  };
}

// ─── Teacher context ──────────────────────────────────────────────────────────

export async function buildTeacherContext(teacherId: string, classIds: string[] = []) {
  const now = new Date();
  const today = fmt(now);
  const safeClassIds = classIds.slice(0, 10);

  const baseQueries = [
    safeGet(query(collection(db, 'homework'), where('teacherId', '==', teacherId), orderBy('dueDate', 'desc'), limit(20))),
    safeGet(query(collection(db, 'attendance'), where('date', '==', today))),
    safeGet(query(collection(db, 'exams'), where('status', '==', 'scheduled'), orderBy('startDate', 'asc'), limit(5))),
    safeGet(query(collection(db, 'notices'), orderBy('createdAt', 'desc'), limit(5))),
  ] as const;

  const classQueries = safeClassIds.length > 0 ? [
    safeGet(query(collection(db, 'students'), where('classId', 'in', safeClassIds))),
    safeGet(query(collection(db, 'examResults'), where('classId', 'in', safeClassIds), limit(50))),
  ] : [];

  const [hwSnap, attSnap, examSnap, noticeSnap] = await Promise.all(baseQueries);
  const [studSnap, examResultsSnap] = classQueries.length > 0
    ? await Promise.all(classQueries)
    : [null, null];

  const homework    = hwSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const todayAtt    = attSnap.docs.map(d => d.data() as any);
  const exams       = examSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const notices     = noticeSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const students    = studSnap ? studSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) : [];
  const examResults = examResultsSnap ? examResultsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) : [];

  const myAtt        = safeClassIds.length > 0 ? todayAtt.filter(a => safeClassIds.includes(a.classId)) : todayAtt;
  const presentToday = myAtt.filter(a => a.status === 'present').length;
  const absentToday  = myAtt.filter(a => a.status === 'absent').length;
  const avgExamScore = examResults.length > 0
    ? Math.round(examResults.reduce((s: number, r: any) => s + (r.percentage || 0), 0) / examResults.length)
    : null;

  return {
    role: 'teacher', generatedAt: now.toISOString(), teacherId,
    summary: {
      classCount: classIds.length, studentCount: students.length,
      homeworkAssigned: homework.length, presentToday, absentToday,
      upcomingExams: exams.length, avgExamScore,
    },
    recentHomework: homework.slice(0, 10).map((h: any) => ({
      subject: h.subjectId, classId: h.classId, dueDate: h.dueDate,
      description: h.content, submissionsCount: h.submissions?.length || 0,
    })),
    upcomingExams: exams.map((e: any) => ({ name: e.name, type: e.type, startDate: e.startDate, classIds: e.classIds })),
    recentNotices: notices.map((n: any) => ({ title: n.title, date: n.createdAt, content: n.content })),
    todayAttendance: { present: presentToday, absent: absentToday, total: myAtt.length },
    classPerformance: classIds.map(cId => {
      const res = examResults.filter((r: any) => r.classId === cId);
      const avgScore = res.length > 0
        ? Math.round(res.reduce((s: number, r: any) => s + (r.percentage || 0), 0) / res.length)
        : null;
      return { classId: cId, avgScore, examResultCount: res.length };
    }),
  };
}

// ─── Student context ──────────────────────────────────────────────────────────

export async function buildStudentContext(studentId: string, classId: string) {
  const now = new Date();
  const today = fmt(now);

  const [attSnap, feeSnap, hwSnap, resultSnap, noticeSnap] = await Promise.all([
    safeGet(query(collection(db, 'attendance'), where('studentId', '==', studentId))),
    safeGet(query(collection(db, 'feeRequests'), where('studentId', '==', studentId), orderBy('dueDate', 'desc'), limit(10))),
    classId ? safeGet(query(collection(db, 'homework'), where('classId', '==', classId), orderBy('dueDate', 'desc'), limit(10))) : Promise.resolve({ docs: [] }),
    safeGet(query(collection(db, 'examResults'), where('studentId', '==', studentId), limit(10))),
    safeGet(query(collection(db, 'notices'), where('targetRoles', 'array-contains', 'student'), orderBy('createdAt', 'desc'), limit(5))),
  ]);

  const attendance  = attSnap.docs.map(d => d.data() as any);
  const feeRequests = feeSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const homework    = hwSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const examResults = resultSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const notices     = noticeSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  const totalDays     = attendance.length;
  const presentDays   = attendance.filter(a => a.status === 'present').length;
  const attendancePct = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;
  const pendingFees   = feeRequests.filter(f => f.status !== 'paid');
  const overdueFees   = pendingFees.filter(f => f.dueDate && f.dueDate < today);
  const avgScore      = examResults.length > 0
    ? Math.round(examResults.reduce((s: number, r: any) => s + (r.percentage || 0), 0) / examResults.length)
    : null;

  return {
    role: 'student', generatedAt: now.toISOString(), studentId, classId,
    summary: {
      attendancePct, totalDays, presentDays, absentDays: totalDays - presentDays,
      pendingFeeAmount: pendingFees.reduce((s: number, f: any) => s + ((f.totalAmount || 0) - (f.paidAmount || 0)), 0),
      pendingFeeCount: pendingFees.length, overdueFeeCount: overdueFees.length,
      homeworkPending: homework.length, avgExamScore: avgScore,
    },
    feeRequests: feeRequests.map((f: any) => ({
      month: f.month, totalAmount: f.totalAmount, paidAmount: f.paidAmount || 0,
      outstanding: (f.totalAmount || 0) - (f.paidAmount || 0),
      dueDate: f.dueDate, status: f.status,
    })),
    recentHomework: homework.map((h: any) => ({ subject: h.subjectId, dueDate: h.dueDate, description: h.content })),
    examResults: examResults.map((r: any) => ({
      examId: r.examId, percentage: r.percentage, grade: r.overallGrade,
      totalMarks: r.totalMarks, obtainedMarks: r.obtainedMarks,
    })),
    recentNotices: notices.map((n: any) => ({ title: n.title, date: n.createdAt, content: n.content })),
  };
}

// ─── Parent context ────────────────────────────────────────────────────────────

export async function buildParentContext(studentId: string, studentName?: string, classId = '') {
  const now = new Date();
  const today = fmt(now);

  const [attSnap, feeSnap, hwSnap, resultSnap, noticeSnap] = await Promise.all([
    safeGet(query(collection(db, 'attendance'), where('studentId', '==', studentId))),
    safeGet(query(collection(db, 'feeRequests'), where('studentId', '==', studentId), orderBy('dueDate', 'desc'), limit(10))),
    classId ? safeGet(query(collection(db, 'homework'), where('classId', '==', classId), orderBy('dueDate', 'desc'), limit(5))) : Promise.resolve({ docs: [] }),
    safeGet(query(collection(db, 'examResults'), where('studentId', '==', studentId), limit(10))),
    safeGet(query(collection(db, 'notices'), where('targetRoles', 'array-contains', 'parent'), orderBy('createdAt', 'desc'), limit(5))),
  ]);

  const attendance  = attSnap.docs.map(d => d.data() as any);
  const feeRequests = feeSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const homework    = hwSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const examResults = resultSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const notices     = noticeSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  const totalDays     = attendance.length;
  const presentDays   = attendance.filter(a => a.status === 'present').length;
  const attendancePct = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;
  const pendingFees   = feeRequests.filter(f => f.status !== 'paid');
  const overdueFees   = pendingFees.filter(f => f.dueDate && f.dueDate < today);
  const avgScore      = examResults.length > 0
    ? Math.round(examResults.reduce((s: number, r: any) => s + (r.percentage || 0), 0) / examResults.length)
    : null;

  return {
    role: 'parent', generatedAt: now.toISOString(), studentId,
    studentName: studentName || 'your child', classId,
    summary: {
      attendancePct, totalDays, presentDays, absentDays: totalDays - presentDays,
      pendingFeeAmount: pendingFees.reduce((s: number, f: any) => s + ((f.totalAmount || 0) - (f.paidAmount || 0)), 0),
      pendingFeeCount: pendingFees.length, overdueFeeCount: overdueFees.length,
      homeworkActive: homework.length, avgExamScore: avgScore,
    },
    feeRequests: feeRequests.map((f: any) => ({
      month: f.month, totalAmount: f.totalAmount, paidAmount: f.paidAmount || 0,
      outstanding: (f.totalAmount || 0) - (f.paidAmount || 0), dueDate: f.dueDate, status: f.status,
    })),
    recentHomework: homework.map((h: any) => ({ subject: h.subjectId, dueDate: h.dueDate, description: h.content })),
    examResults: examResults.map((r: any) => ({ examId: r.examId, percentage: r.percentage, grade: r.overallGrade })),
    recentNotices: notices.map((n: any) => ({ title: n.title, date: n.createdAt, content: n.content })),
  };
}
