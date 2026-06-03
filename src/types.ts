export type UserRole = 'super_admin' | 'student' | 'parent' | 'accounts' | 'teacher' | 'principal' | 'office_staff' | 'grievance_officer';

// ─── Grievance Types ──────────────────────────────────────────────────────────

export type GrievanceCategory = 'academic' | 'fee' | 'facility' | 'staff_conduct' | 'transport' | 'other';
export type GrievancePriority = 'low' | 'medium' | 'high' | 'urgent';
export type GrievanceStatus = 'open' | 'in_progress' | 'awaiting_response' | 'resolved' | 'closed';

export interface GrievanceNote {
  id: string;
  content: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
  isInternal: boolean;
}

export interface Grievance {
  id: string;
  title: string;
  description: string;
  category: GrievanceCategory;
  priority: GrievancePriority;
  status: GrievanceStatus;
  submittedByUid: string;
  parentName: string;
  parentPhone?: string;
  studentId: string;
  studentName: string;
  classSection: string;
  isEscalated: boolean;
  escalatedAt?: string;
  escalatedBy?: string;
  notes: GrievanceNote[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface FollowupLog {
  id: string;
  note: string;
  contactMethod: 'phone' | 'whatsapp' | 'in_person' | 'email';
  loggedBy: string;
  createdAt: string;
}

export interface FeeFollowupRecord {
  id: string;
  feeRequestId: string;
  studentId: string;
  studentName: string;
  parentPhone: string;
  parentName: string;
  classSection: string;
  amountDue: number;
  status: string;
  logs: FollowupLog[];
  promisedPaymentDate?: string;
  isEscalated: boolean;
  lastContactedAt?: string;
  updatedAt: string;
}

export interface BroadcastLog {
  id: string;
  templateName: string;
  audience: string;
  totalSent: number;
  totalFailed: number;
  sentAt: string;
  sentBy: string;
  message?: string;
}

export interface ModulePermission {
  enabled: boolean;
  readOnly: boolean;
}

export interface RolePermissions {
  id: string; // role name e.g., 'principal'
  modules: Record<string, ModulePermission>;
  updatedAt: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  schoolNumber?: string; // 7-digit school number (without 'p' for parents)
  classId?: string;
  section?: string;
  parentId?: string;
  studentId?: string;
  teacherId?: string;
  studentIds?: string[]; // Array of student IDs for parents
  photoURL?: string;
  phone?: string;
  address?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Student {
  id: string;
  schoolNumber: string; // Same as admissionNumber
  admissionNumber: string; // Same as schoolNumber
  name: string;
  classId: string;
  section: string;
  parentId: string;
  parentDetails?: {
    fatherName: string;
    motherName: string;
    phone: string;
    email: string;
  };
  transportDetails?: string;
  documents?: string[];
  medicalNotes?: string;
  academicHistory?: string;
  houseId?: string;
  gender: 'male' | 'female' | 'other' | '';
  feeStatus: 'paid' | 'pending' | 'overdue';
  photoURL?: string;
}

export interface Teacher {
  id: string;
  employeeId?: string; // Human-readable ID assigned at onboarding (e.g. TCH001)
  name: string;
  email: string;
  phone?: string;
  role?: string; // For categorization
  subjects: string[]; // Subject IDs
  classes: string[]; // Class IDs or formatted strings
  salaryStructure: number;
  joiningDetails: string;
  category?: 'Teacher';
  houseInchargeId?: string;
  isHouseIncharge?: boolean;
  classTeacherOf?: {
    classId: string;
    section: string;
  };
  tags?: string[];
  photoURL?: string;
  // Optimistic-concurrency token incremented on every update.
  version?: number;
  updatedAt?: string;
  // Per-teacher casual leave quota override (falls back to the policy default if absent).
  casualLeaveQuota?: number;
}

export interface StaffMember {
  id: string;
  employeeId?: string; // Human-readable ID assigned at onboarding (e.g. EMP001)
  name: string;
  email: string;
  phone?: string;
  role: string; // 'principal', 'accounts', 'security', etc.
  joiningDate: string;
  salary: number;
  status: 'active' | 'on-leave' | 'resigned';
  category?: 'Staff' | 'Management' | 'Administration';
  updatedAt?: string;
  photoURL?: string;
  // Optimistic-concurrency token incremented on every update.
  version?: number;
}

export type UnifiedStaff = (Teacher | StaffMember) & {
  staffCategory: 'Teacher' | 'Principal' | 'Accounts' | 'Grievance' | 'Admin' | 'Other Staff';
  baseSalary: number;
};

export interface Class {
  id: string;
  name: string;
  sections: {
    name: string;
    capacity: number;
    classTeacherId?: string;
  }[];
  subjects: string[]; // Subject IDs
}

export interface Subject {
  id: string;
  name: string;
  code: string;
  type: 'theory' | 'practical' | 'both';
  teacherId?: string;
}

export interface House {
  id: string;
  name: string;
  color: string;
  teacherInchargeId?: string;
}

export interface TimeSlot {
  id: string;
  label: string; // e.g. "1st Period", "Break", "Lunch"
  startTime: string; // e.g. "08:30 AM"
  endTime: string; // e.g. "09:30 AM"
  type: 'period' | 'break' | 'lunch';
}

export interface TimetableConfig {
  id: string;
  slots: TimeSlot[];
  days: string[]; // e.g. ["Monday", "Tuesday", ...]
  updatedAt: string;
}

export interface Timetable {
  id: string;
  classId: string;
  schedule: {
    day: string;
    periods: {
      slotId: string;
      subjectId: string;
      teacherId: string;
      room?: string;
    }[];
  }[];
  updatedAt: string;
  // Versioning metadata (optional, additive)
  academicYear?: string;        // e.g. '2025-26'
  version?: number;             // monotonically increases when a new version is published
  effectiveFrom?: string;       // ISO date this version became active
  effectiveTo?: string;         // ISO date this version stopped (only set on archive copies)
  archivedAt?: string;          // ISO timestamp when archived (only on docs in `timetableArchive`)
  archivedBy?: string;          // user UID who triggered the archive
}

export interface FeeHead {
  name: string;
  amount: number;
  description?: string;
}

export interface FeeStructure {
  id: string;
  classId: string;
  heads: FeeHead[];
  updatedAt: string;
}

export interface FineSlab {
  startDay: number;
  endDay?: number;
  fixedPenalty: number;
  percentagePenalty: number;
  isHigherOf: boolean;
  escalationRate?: number;
}

export interface FineConfig {
  id: string;
  isEnabled: boolean;
  gracePeriodDays: number;
  slabs: FineSlab[];
  updatedBy: string;
  updatedAt: string;
}

export interface FeeRequest {
  id: string;
  studentId: string;
  classId: string;
  academicYear: string;
  month: string;
  heads: {
    name: string;
    amount: number;
    discount: number;
    discountReason?: string;
    finalAmount: number;
    isCustom?: boolean;
  }[];
  totalAmount: number;
  fineAmount: number;
  waivedAmount: number;
  paidAmount: number;
  status: 'paid' | 'pending' | 'partially_paid' | 'overdue';
  dueDate: string;
  createdAt: string;
  waivedBy?: string;
  waivedAt?: string;
  waiverReason?: string;
  partialPaymentRequest?: {
    requestedAmount: number;
    reason: string;
    committedDate: string;
    requestedAt: string;
    status: 'pending' | 'acknowledged';
  };
}

export type PaymentMethod = 'bank_transfer' | 'cheque' | 'cash' | 'upi' | 'net_banking' | 'online';

export interface PaymentHistory {
  id: string;
  feeRequestId: string;
  studentId: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  referenceNumber?: string;
  transactionId?: string;
  status: 'success' | 'failed' | 'pending';
  receiptUrl?: string;
}

export interface Fee {
  id: string;
  studentId: string;
  structure: {
    head: string;
    amount: number;
  }[];
  status: 'paid' | 'pending' | 'overdue';
  receipts: string[];
}

export interface Attendance {
  id: string;
  date: string;
  studentId: string;
  status: 'present' | 'absent' | 'late' | 'approved_leave' | 'leave_pending' | 'uninformed_absence' | 'regularized';
  type: 'student' | 'staff';
  remarks?: string;
  classId?: string; // Add classId for better searching
}

export interface Homework {
  id: string;
  classId: string;
  subjectId: string;
  teacherId: string;
  content: string;
  dueDate: string;
  attachmentUrl?: string;
  attachmentName?: string;
  submissions: {
    studentId: string;
    content: string;
    submittedAt: string;
    remarks?: string;
  }[];
}

export interface Exam {
  id: string;
  name: string;
  term: string;
  startDate: string;
  endDate: string;
  classIds: string[];
  subjectId: string;
  maxMarks: number;
  gradingScaleId: string;
  status: 'scheduled' | 'ongoing' | 'completed' | 'published';
  type: 'scheduled' | 'surprise' | 'internal' | 'practical';
  syllabus?: {
    text?: string;
    photoUrl?: string;
    storagePath?: string;
  };
  topic?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  room?: string;
  invigilatorId?: string;
  isMakeup?: boolean;
  originalExamId?: string; // For makeup exams — links back to the original
  createdAt: string;
  createdBy: string;
  // Publication metadata
  publishedAt?: string;
  publishedBy?: string;
}

export type SubjectResultStatus = 'present' | 'absent' | 'exempt';

export interface ExamResult {
  id: string;
  examId: string;
  studentId: string;
  classId: string;
  subjectResults: {
    subjectId: string;
    marksObtained: number;
    maxMarks: number;
    grade: string;
    remarks?: string;
    status?: SubjectResultStatus; // 'absent'/'exempt' mean marksObtained is not graded
  }[];
  totalMarks: number;
  percentage: number;
  overallGrade: string;
  rank?: number;
  published: boolean;
  updatedAt: string;
  // Audit trail
  createdBy?: string;
  createdByName?: string;
  updatedBy?: string;
  updatedByName?: string;
  version?: number; // optimistic concurrency token
}

export interface GradingScale {
  id: string;
  name: string;
  ranges: {
    min: number;
    max: number;
    grade: string;
    point: number;
    description: string;
  }[];
}

export interface NoticeAttachment {
  name: string;
  url: string;
  storagePath: string;
  type: string;
  size: number;
}

export interface Notice {
  id: string;
  title: string;
  content: string;
  targetRoles: UserRole[];
  priority: 'low' | 'medium' | 'high';
  authorId: string;
  authorName: string;
  createdAt: string;
  expiresAt?: string;
  attachments?: NoticeAttachment[];
}

// ─── Notification Center ──────────────────────────────────────────────────────
export type NotificationCategory = 'exam' | 'fee' | 'notice' | 'event' | 'general';
export type NotificationTargetType = 'all' | 'role' | 'class' | 'individual';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  category: NotificationCategory;
  priority: 'normal' | 'high';
  // Audience tokens a recipient matches against: 'all', 'role:<role>',
  // 'class:<classId>', 'class:<classId>:<section>', 'user:<uid>'.
  audience: string[];
  targetType: NotificationTargetType;
  targetSummary: string;     // human-readable description of who it went to
  link?: string;             // optional in-app route to open on tap
  createdAt: string;         // ISO timestamp
  createdBy: { uid: string; name: string };
}

export interface UserNotificationState {
  lastReadAt: string;        // notifications created after this are unread
  dismissedIds: string[];
  updatedAt: string;
}


export interface SchoolEvent {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  type: 'holiday' | 'exam' | 'event' | 'meeting';
  allDay: boolean;
  location?: string;
  color?: string;
}

export interface Communication {
  id: string;
  type: 'sms' | 'whatsapp' | 'email' | 'notification';
  content: string;
  recipientId: string;
  sentAt: string;
}

export interface Expense {
  id: string;
  category: string;
  biller: string;
  amount: number;
  date: string;
  status: 'paid' | 'pending';
  description?: string;
  receiptUrl?: string;
  receiptNumber?: string;
  phone?: string;
  address?: string;
  paymentMode?: 'cash' | 'bank_transfer' | 'upi' | 'cheque' | 'card' | 'other';
}

export interface PayrollConfig {
  id: string;
  workingDaysInYear: number; // e.g. 240
  leaveDeductionPerDay?: number; // Fixed override if set
  pfRate: number; // percentage
  professionalTax: number; // flat amount
  updatedBy: string;
  updatedAt: string;
}

export interface Salary {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  month: string;
  baseAmount: number;
  allowances: number;
  deductions: {
    pf: number;
    tax: number;
    leaves: number;
    leaveDeduction: number;
    other: number;
  };
  netAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: 'pending' | 'partially_paid' | 'paid';
  remarks?: string;
  paymentHistory?: {
    amount: number;
    date: string;
    method: string;
    transactionId?: string;
  }[];
  receiptNumber?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentAllocation {
  headName: string;        // Must match a name in the parent FeeRequest.heads[]
  amount: number;          // Portion of FeePayment.amount applied to this head
}

// ─── Advance Payment ──────────────────────────────────────────────────────────
// Parents can pay 1+ months of fees in advance for one or more fee heads.
// When the fee request for a covered month is later generated, the matching
// heads are auto-deducted (consumed) from the advance, in FIFO order across
// any active advance payments for the student.

export interface AdvanceMonthlyEntry {
  month: string;                                  // e.g. "June 2025" — must match FeeRequest.month verbatim
  heads: { name: string; amount: number }[];      // heads paid for this month at this advance
  consumed: boolean;                              // true once a feeRequest for this month was generated and applied
  consumedAt?: string;
  consumedRequestId?: string;                     // back-link to the feeRequest
  consumedPaymentId?: string;                     // back-link to the synthetic feePayment that applied the advance
}

export interface AdvancePayment {
  id: string;
  studentId: string;
  classId: string;
  parentId?: string;            // populated when parent initiated, undefined when accountant recorded
  academicYear: string;
  monthlyBreakdown: AdvanceMonthlyEntry[];
  totalAmount: number;
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
  voucherNumber?: string;
  voucherImageUrl?: string;
  receiptNumber: string;
  date: string;                 // payment date (yyyy-mm-dd)
  remarks?: string;
  createdBy: string;            // uid
  createdAt: string;            // ISO timestamp
  status: 'active' | 'fully_consumed';
}

export interface FeePayment {
  id: string;
  studentId: string;
  classId: string;
  feeRequestId: string;
  feeHead: string;                  // Primary head label (kept for backwards-compatibility)
  amount: number;
  fineAmount?: number;              // Fine snapshotted into this payment (if any)
  allocations?: PaymentAllocation[]; // Breakdown across the request's heads
  date: string;
  method: PaymentMethod;
  referenceNumber?: string;
  transactionId?: string;
  receiptNumber: string;
  remarks?: string;
  // Cash payments only — voucher number written on the physical receipt + optional photo
  voucherNumber?: string;
  voucherImageUrl?: string;
  // Set when payment was recorded from an advance payment top-up (not a normal request)
  advancePaymentId?: string;
}

export interface LessonLog {
  id: string;
  classId: string;
  subjectId: string;
  teacherId: string;
  date: string;
  slotId: string;
  // Snapshotted slot details so logs stay readable even if the timetable slot is later changed/deleted
  slotLabel?: string;
  slotStartTime?: string;
  slotEndTime?: string;
  timetableVersion?: number;
  topic: string;
  classwork: string;
  classworkFileUrl?: string;
  classworkFileName?: string;
  homework: string;
  homeworkFileUrl?: string;
  homeworkFileName?: string;
  createdAt: string;
  // Robustness metadata
  createdBy?: string;            // uid of author
  createdByName?: string;        // display name snapshot
  updatedAt?: string;
  updatedBy?: string;            // uid of last editor
  updatedByName?: string;        // display name snapshot
  version?: number;              // optimistic concurrency token
}

export type LeaveType = 'planned' | 'medical' | 'emergency' | 'half_day' | 'regularization';
export type LeaveStatus = 'submitted' | 'pending' | 'approved' | 'rejected' | 'document_required' | 'regularized' | 'cancelled';
export type LeaveReasonCategory = 'Medical' | 'Family Function' | 'Travel' | 'Emergency' | 'Religious Reason' | 'Personal Reason' | 'Exam-related' | 'Other';

export interface StudentLeaveRequest {
  id: string;
  studentId: string;
  parentId: string;
  studentName: string;
  classId: string;
  section: string;
  leaveType: LeaveType;
  reasonCategory: LeaveReasonCategory;
  reason: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  documentUrl?: string;
  documentName?: string;
  isEmergency: boolean;
  parentDeclaration: boolean;
  status: LeaveStatus;
  adminRemarks?: string;
  submittedAt: string;
  updatedAt: string;
  processedBy?: string;
  processedAt?: string;
  attendanceConnectionStatus: 'pending' | 'connected' | 'failed';
}

// ─── Teacher Leave Management ─────────────────────────────────────────────────

export type TeacherLeaveType = 'casual' | 'medical' | 'emergency' | 'half_day' | 'comp_off' | 'earned';
export type TeacherLeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface TeacherLeaveRequest {
  id: string;
  teacherId: string;
  teacherName: string;
  leaveType: TeacherLeaveType;
  startDate: string;          // ISO date  e.g. '2025-12-01'
  endDate: string;            // ISO date
  totalDays: number;
  reason: string;
  substitutePreference?: string; // teacher-suggested substitute name/note
  status: TeacherLeaveStatus;
  principalRemarks?: string;
  approvedBy?: string;
  approvedAt?: string;
  submittedAt: string;
  updatedAt: string;
  // Set by principal during approval:
  substituteAssigned?: boolean; // true once substitute periods are created in Firestore
  attendanceSynced?: boolean;   // true once attendance docs are written for leave days
}

export interface SubstituteAssignment {
  id: string;
  leaveId: string;
  date: string;               // ISO date — one doc per day per period
  slotId: string;
  classId: string;
  originalTeacherId: string;
  substituteTeacherId?: string; // undefined = TBD
  substituteTeacherName?: string;
  status: 'assigned' | 'unassigned'; // unassigned = period marked free
  assignedBy: string;         // principal uid
  createdAt: string;
  updatedAt: string;
}

export type ActivitySection = 'Super Admin' | 'Accounts' | 'Parents' | 'Students' | 'Academic' | 'Teachers' | 'Exam' | 'Staff' | 'Principal';

export interface ActivityLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  action: string;
  section: ActivitySection;
  details: string;
  aiDescription?: string;
  ip?: string;
  location?: string;
  isp?: string;
  userAgent?: string;
  metadata?: any;
}

// ─── Extended Student Profile ─────────────────────────────────────────────────
export interface ExtendedStudentProfile {
  studentId: string;
  // Personal
  dateOfBirth?: string;
  bloodGroup?: 'A+' | 'A-' | 'B+' | 'B-' | 'O+' | 'O-' | 'AB+' | 'AB-' | '';
  religion?: string;
  category?: 'General' | 'OBC' | 'SC' | 'ST' | 'EWS' | '';
  nationality?: string;
  motherTongue?: string;
  languagesKnown?: string;
  identificationMarks?: string;
  aadhaarNumber?: string;
  passportNumber?: string;
  // Permanent Address
  permanentAddress?: {
    house?: string;
    street?: string;
    city?: string;
    state?: string;
    pinCode?: string;
    country?: string;
  };
  // Family
  father?: {
    name?: string;
    dob?: string;
    qualification?: string;
    occupation?: string;
    organization?: string;
    annualIncome?: string;
    phone?: string;
    email?: string;
    aadhaar?: string;
    idCardFrontUrl?: string;
    idCardFrontPath?: string;
    idCardBackUrl?: string;
    idCardBackPath?: string;
  };
  mother?: {
    name?: string;
    dob?: string;
    qualification?: string;
    occupation?: string;
    organization?: string;
    annualIncome?: string;
    phone?: string;
    email?: string;
    aadhaar?: string;
    idCardFrontUrl?: string;
    idCardFrontPath?: string;
    idCardBackUrl?: string;
    idCardBackPath?: string;
  };
  hasGuardian?: boolean;
  guardian?: {
    name?: string;
    relation?: string;
    phone?: string;
    address?: string;
    idCardFrontUrl?: string;
    idCardFrontPath?: string;
    idCardBackUrl?: string;
    idCardBackPath?: string;
  };
  // Academic background
  previousSchool?: {
    name?: string;
    board?: string;
    lastClass?: string;
    yearOfPassing?: string;
    tcNumber?: string;
    reasonForTransfer?: string;
  };
  // Health
  health?: {
    height?: string;
    weight?: string;
    medicalConditions?: string;
    allergies?: string;
    vision?: string;
    hearingIssues?: boolean;
    emergencyNotes?: string;
  };
  // Siblings in school
  siblings?: { name: string; admissionNumber: string; class: string }[];
  // ID card photos (mandatory)
  idCardFrontUrl?: string;
  idCardFrontPath?: string;
  idCardBackUrl?: string;
  idCardBackPath?: string;
  // Metadata
  completionPercentage?: number;
  updatedAt?: string;
  updatedBy?: string;
  updatedByName?: string;
}
