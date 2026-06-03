import { Routes, Route, Navigate } from 'react-router-dom';
import GrievanceShell from '../../components/GrievanceShell';
import { UserProfile } from '../../types';
import GrievanceDashboard from './GrievanceDashboard';
import GrievanceTracker from './GrievanceTracker';
import FeeFollowup from './FeeFollowup';
import BroadcastCenter from './BroadcastCenter';
import ProfileSettings from '../shared/ProfileSettings';
export default function GrievancePortal({ user }: { user: UserProfile }) {
  const basePath = user.role === 'grievance_officer' ? '/grievance' :
                   user.role === 'principal' ? '/principal' : '/superadmin';

  return (
    <GrievanceShell user={user}>
      <Routes>
        <Route path="/" element={<GrievanceDashboard user={user} />} />
        <Route path="/tracker" element={<GrievanceTracker user={user} />} />
        <Route path="/fee-followup" element={<FeeFollowup user={user} />} />
        <Route path="/broadcast" element={<BroadcastCenter user={user} />} />
        <Route path="/profile" element={<ProfileSettings user={user} />} />
        <Route path="*" element={<Navigate to={basePath} />} />
      </Routes>
    </GrievanceShell>
  );
}
