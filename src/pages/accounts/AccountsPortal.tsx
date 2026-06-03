import { Routes, Route, Navigate } from 'react-router-dom';
import AccountsShell from '../../components/AccountsShell';
import { UserProfile } from '../../types';
import AccountsDashboard from './AccountsDashboard';
import FeeCollection from './FeeCollection';
import PaymentHistory from './PaymentHistory';
import ExpenseManagement from './ExpenseManagement';
import SalaryManagement from './SalaryManagement';
import FinancialReports from './FinancialReports';
import PaymentAnalytics from './PaymentAnalytics';
import PaymentReconciliation from './PaymentReconciliation';
import ProfileSettings from '../shared/ProfileSettings';
import WhatsAppNotifications from '../admin/WhatsAppNotifications';

export default function AccountsPortal({ user }: { user: UserProfile }) {
  return (
    <AccountsShell user={user}>
      <Routes>
        <Route path="/" element={<AccountsDashboard user={user} />} />
        <Route path="/fee-collection" element={<FeeCollection user={user} />} />
        <Route path="/payment-history" element={<PaymentHistory user={user} />} />
        <Route path="/expenses" element={<ExpenseManagement user={user} />} />
        <Route path="/salaries" element={<SalaryManagement user={user} />} />
        <Route path="/reports" element={<FinancialReports user={user} />} />
        <Route path="/analytics" element={<PaymentAnalytics user={user} />} />
        <Route path="/reconciliation" element={<PaymentReconciliation user={user} />} />
        <Route path="/profile" element={<ProfileSettings user={user} />} />
        <Route path="/whatsapp" element={<WhatsAppNotifications user={user} />} />
        <Route path="*" element={<Navigate to="/accounts" />} />
      </Routes>
    </AccountsShell>
  );
}
