<div align="center">
<img width="1200" height="475" alt="EL-NODE Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# EL-NODE — The Elden Heights School ERP

A full-featured, cloud-native school ERP built on React 19, Firebase, and Gemini AI. It covers every operational domain of The Elden Heights School — from daily attendance and fee collection to payroll, grievances, and AI-powered analytics.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 |
| Routing | React Router v7 |
| Backend / DB | Firebase Firestore (NoSQL), Firebase Auth (Google OAuth) |
| Server API | Vercel Serverless Functions (`/api/*`) |
| AI | Google Gemini 2.5 Flash (`/api/ai/chat.ts`) |
| PDF Generation | jsPDF + jsPDF-AutoTable |
| CSV | PapaParser |
| Charts | Recharts |
| Animations | Motion (Framer Motion successor) |
| Mobile | Capacitor (Android) |
| Push/Notifications | WATI (WhatsApp Business API) |
| Payments | Razorpay |

---

## Project Structure

```
ELNODE-ERP-GEMINI/
├── api/                          # Vercel serverless endpoints
│   ├── ai/
│   │   ├── chat.ts               # Gemini 2.5 Flash streaming chat
│   │   └── describe-activity.ts
│   ├── admin/
│   │   └── deploy-rules.ts
│   ├── razorpay/
│   │   ├── create-order.ts
│   │   ├── verify-payment.ts
│   │   └── verify-advance-payment.ts
│   ├── ip-info.ts
│   └── whatsapp/ + _wati.ts
├── src/
│   ├── App.tsx                   # Root: auth bootstrap, role-based routing
│   ├── constants.ts              # School config, roles, SUPER_ADMIN_UIDS
│   ├── firebase.ts               # Firebase app + Firestore + Auth init
│   ├── types.ts                  # All TypeScript interfaces and enums
│   ├── components/
│   │   ├── AIInsightsPanel.tsx   # Sliding AI chat panel (super admin)
│   │   ├── PortalLayout.tsx      # Shared sidebar + header shell
│   │   ├── ErrorBoundary.tsx
│   │   ├── Toast.tsx
│   │   ├── UpdatesSection.tsx
│   │   └── ui.tsx                # Shared UI primitives
│   ├── contexts/
│   │   └── DataContext.tsx       # Global Firestore data subscriptions
│   ├── hooks/
│   │   └── usePermissions.ts     # Role-based feature flags
│   ├── lib/
│   │   ├── aiContext.ts          # Builds full data snapshot for Gemini
│   │   ├── utils.ts
│   │   ├── pdfTemplate.ts
│   │   ├── receiptGenerator.ts
│   │   ├── payrollSlip.ts
│   │   └── expenseReceipt.ts
│   ├── services/                 # Firestore service helpers
│   │   ├── activityService.ts
│   │   ├── advancePaymentService.ts
│   │   ├── examService.ts
│   │   ├── fineService.ts
│   │   ├── lessonLogService.ts
│   │   ├── notificationService.ts
│   │   ├── receiptCounterService.ts
│   │   ├── settingsService.ts
│   │   └── staffService.ts
│   └── pages/
│       ├── Login.tsx
│       ├── shared/               # Cross-role pages (Profile, Results, LessonLogs)
│       ├── admin/                # Super Admin + Admin + Principal portals
│       ├── accounts/             # Accounts portal
│       ├── teacher/              # Teacher portal
│       ├── student/              # Student portal
│       ├── parent/               # Parent portal
│       └── grievance/            # Grievance Officer portal
├── firestore.rules               # Security rules (deploy with Firebase CLI)
├── firestore.indexes.json
└── vercel.json
```

---

## User Roles & Portals

| Role | Portal | Key Capabilities |
|---|---|---|
| `super_admin` | Admin Portal | Full access to all modules + AI Insights panel |
| `principal` | Principal Portal | Academic oversight, leave approvals, substitute assignments |
| `accounts` | Accounts Portal | Fee collection, expenses, salaries, financial reports |
| `teacher` | Teacher Portal | Attendance, homework, exams, result entry, lesson logs |
| `student` | Student Portal | View attendance, fees, homework, results, timetable |
| `parent` | Parent Portal | Track child's attendance, fees, leave requests, grievances |
| `grievance_officer` | Grievance Portal | Manage grievances, fee follow-ups, broadcast messages |
| `office_staff` | (limited) | Shared views as configured via Role Permissions Manager |

Super admins are identified by UID — see `src/constants.ts` → `SUPER_ADMIN_UIDS`.

---

## Modules

### Student Management
- Add, edit, delete students with full profile: name, admission number, school number, class, section, house, gender (optional), transport mode (School/Private), address, medical notes, academic history, student email, parent details
- Bulk CSV import with full field support (template downloadable from the UI)
- Advanced filtering: class, section, house, gender, transport — with active filter chips and count badge
- Export filtered or full list as CSV
- Expandable row detail view showing all student fields inline

### Teacher Management
- Teacher profiles with subject assignments, class allotments, class-teacher designation, house incharge flag
- Casual leave quota tracking per teacher

### Staff Management
- Non-teaching staff records: role, category, salary, employment status

### Class & Subject Management
- Class and section definitions
- Subject creation and teacher assignment

### House Management
- School houses with color coding and house incharge assignment

### Attendance
- Teacher-marked class attendance (present / absent / late)
- Today's snapshot + 30-day rolling class-wise statistics
- Chronic absentee detection (< 75% attendance over 30 days)

### Exam & Results
- Exam creation and scheduling (pending → approved)
- Result entry by teachers
- Grading scale configuration (per school)
- Result view for students and parents

### Timetable
- Period slot definitions per class per day
- Teacher-slot assignment
- Lesson log per slot: topic, classwork, homework with optional file attachments
- Substitute assignment when a teacher is on approved leave

### Leave Management
- **Student leaves**: parent-submitted, admin-approved; types: planned, medical, emergency, half-day, regularization; document upload supported
- **Teacher leaves**: submitted by teacher, approved by principal; types: casual, medical, emergency, half-day, comp-off, earned; casual leave quota auto-deducted

### Fee Management
- Fee structure per class with multiple heads (tuition, transport, etc.)
- Monthly fee request generation per student
- Payment methods: cash (with voucher number), online (UPI/card), Razorpay gateway
- Advance payment booking with FIFO auto-consumption against future months
- Per-head discounts
- Fine settings with per-head grace periods and auto-calculation
- Overdue detection and tracking
- Receipt PDF generation with full breakdown

### Salary & Payroll
- Monthly payroll records per employee
- Components: base salary, allowances (HRA, DA, etc.), deductions (PF, ESI, tax, leave deduction, other)
- Partial payment support with running balance
- Payroll slip PDF generation

### Expense Management
- Expense recording: category, amount, description, payment mode, status, receipt image upload
- Expense receipt PDF generation

### Financial Reports
- Income vs expense charts
- Payment analytics with method breakdown
- Reconciliation views

### Grievances
- Parent-submitted tickets with category (academic, fee, facility, staff conduct, transport, other) and priority (low/medium/high/urgent)
- Internal notes (visible to staff only), public replies, and escalation
- Status workflow: open → in_progress → awaiting_response → resolved/closed
- Fee follow-up log: contact method, promised payment date, escalation flag
- Broadcast center: WhatsApp/SMS mass notifications via WATI

### Notices
- School-wide notice board with create/edit/delete

### Academic Calendar
- School events and academic milestone dates

### Role Permissions Manager
- Per-role feature flags: which modules are enabled and whether they are read-only

### Activity Tracker
- Full audit log of all major system actions with AI-generated plain-English descriptions, IP address, ISP, and geolocation

### WhatsApp Notifications
- WATI-powered notifications to parents: fee reminders, attendance alerts, broadcast messages

### AI Insights Panel (Super Admin only)
- Sliding chat panel powered by Gemini 2.5 Flash via SSE streaming
- Full real-time data snapshot injected at chat start (see Data Coverage below)
- Fault-tolerant: blocked or empty collections degrade gracefully — partial data loads with a warning banner
- Suggested prompts covering all data domains
- Indian currency formatting (₹1,23,456), Indian academic terminology

---

## Firebase Firestore Collections

| Collection | Description |
|---|---|
| `users` | All user profiles (auth source of truth) |
| `students` | Student records |
| `teachers` | Teacher profiles |
| `staff` | Non-teaching staff |
| `classes` | Class definitions |
| `subjects` | Subject definitions |
| `houses` | School houses |
| `timetables` | Period slot definitions |
| `lessonLogs` | Lesson log entries per slot |
| `attendance` | Daily attendance records |
| `exams` | Exam definitions |
| `examResults` | Per-student per-exam results |
| `feeStructures` | Fee heads per class |
| `feeRequests` | Monthly fee requests per student |
| `feePayments` | Individual payment records |
| `advancePayments` | Advance payment bookings |
| `salaries` | Payroll records per employee per month |
| `expenses` | Expense records |
| `homework` | Homework assignments |
| `notices` | Notice board entries |
| `studentLeaves` | Student leave requests |
| `teacherLeaves` | Teacher leave requests |
| `substituteAssignments` | Substitute period assignments |
| `grievances` | Grievance tickets |
| `feeFollowups` | Fee follow-up logs |
| `activityLogs` | Audit trail |
| `broadcastLogs` | WhatsApp/SMS broadcast history |
| `rolePermissions` | Per-role module permission config |
| `schoolSettings` | School-level configuration |
| `payrollSettings` | Payroll configuration |
| `fineSettings` | Late fee configuration |
| `gradingScales` | Grading scale definitions |

---

## Local Development

**Prerequisites:** Node.js 18+, Firebase CLI

```bash
# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Fill in Firebase config keys and GEMINI_API_KEY

# Start dev server
npm run dev
# → http://localhost:3000
```

### Environment Variables

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
GEMINI_API_KEY=         # Server-side only (Vercel env / api/ functions)
```

### Deploy Firestore Security Rules

After any edit to `firestore.rules`:

```bash
firebase deploy --only firestore:rules
```

### Build & Deploy

```bash
npm run build
# Push to Vercel-linked repository for auto-deploy
```

### Android (Capacitor)

```bash
npm run cap:sync    # Build and sync native project
npm run cap:open    # Open in Android Studio
```

---

## Super Admin Access

Super admins are granted by Firebase UID in two places that **must stay in sync**:

1. `src/constants.ts` → `SUPER_ADMIN_UIDS` array
2. `firestore.rules` → `isSuperAdminByUID()` helper function

**Auto-provisioning:** on first Google sign-in, if the UID is in `SUPER_ADMIN_UIDS` but has no Firestore `users` document, the app creates one automatically using the Google profile (display name, email, photoURL). No manual Firestore setup is needed for super admin accounts.

---

## CSV Bulk Student Import

Download the template from **Super Admin → Students → Import CSV**.

Expected column headers (case-insensitive):

```
name, admissionNumber, class, section, gender, fatherName, motherName,
phone, email, studentEmail, house, transport, medicalNotes,
academicHistory, address
```

- `gender` — optional; leave blank if not applicable
- `transport` — `School` or `Private` (blank = none recorded)
- `house` — house name as defined in House Management (matched case-insensitively)
- `class` — class name as defined in Class Management
- Backwards-compatible: old column name `transportDetails` is also accepted

---

## AI Insights — Data Coverage

The panel injects a full real-time snapshot into the Gemini context at chat start:

- **All students** — name, admission/school number, class, section, house, gender, transport, address, medical notes, academic history, parent details (father name, mother name, phone, email), student email, fee status
- **All teachers** — full profile, subjects taught, classes assigned, class-teacher role, house incharge flag, leave quota
- **All staff** — role, category, salary, employment status
- **Finance** — every fee request (with resolved student names and parent phones), all payments, all expenses (with descriptions and payment modes), all salary records per employee per month, advance payments, overdue breakdown
- **Attendance** — today's class-wise rates, 30-day rolling rates, chronic absentees list with parent contact details
- **Exams & Results** — upcoming exams, per-student result records with student names resolved
- **Leaves** — all teacher leave records, all student leave records with statuses
- **Grievances** — all tickets with descriptions, internal notes, and resolution details
- **Homework** — recent assignments with resolved teacher names
- **Notices** — full notice board content
