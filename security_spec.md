# Security Specification: EL Node ERP

## Data Invariants
1. A Student document must be linked to a Class.
2. A Teacher document must have a valid email matching a User profile.
3. Notices must have valid target roles.
4. Timetable entries must link to existing Teachers, Subjects, and Classes.
5. User Profiles are the source of truth for Roles.

## Key Relationships
- **Admin/Principal**: Full read/write access to academic and staff data.
- **Teacher**: Read access to students in their classes, write access to attendance/homework for their classes.
- **Student/Parent**: Read access to their own profile, attendance, results, and homework.

## The "Dirty Dozen" (Test Payloads)
1. **Identity Theft**: User A tries to read User B's profile.
2. **Role Escalation**: Student tries to update their role to 'admin'.
3. **Ghost Attendance**: Teacher tries to mark attendance for a class they don't teach.
4. **Grade Tampering**: Student tries to update their own exam result.
5. **Notice Spam**: Student tries to create a school-wide notice.
6. **Timetable Sabotage**: Teacher tries to delete the global timetable config.
7. **PII Leak**: Unauthorized user tries to list all students' parent phone numbers.
8. **Shadow Field Injection**: User tries to add `isVerified: true` to their profile.
9. **Orphaned Record**: User tries to create notice with non-existent authorId.
10. **Timestamp Spoofing**: User tries to set `createdAt` to a future date.
11. **ID Poisoning**: User tries to create a document with a 2MB string as an ID.
12. **Cross-Tenant Access**: User from one school number (if multi-tenant) tries to read data from another (N/A here but good to consider).
