import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { UserProfile, Grievance } from '../../types';
import {
  MessageSquare, AlertCircle, CheckCircle2, Clock,
  TrendingUp, Wallet, Users, ArrowUpRight,
} from 'lucide-react';
import { Link } from 'react-router-dom';

const statusDot: Record<string, string> = {
  open: 'var(--coral)',
  in_progress: '#f59e0b',
  awaiting_response: '#3b82f6',
  resolved: 'var(--leaf)',
  closed: 'var(--ink-3)',
};

const statusLabel: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  awaiting_response: 'Awaiting',
  resolved: 'Resolved',
  closed: 'Closed',
};

const statusChipStyle: Record<string, React.CSSProperties> = {
  open: { background: '#fee2e2', color: '#b91c1c' },
  in_progress: { background: '#fef3c7', color: '#92400e' },
  awaiting_response: { background: '#dbeafe', color: '#1e40af' },
  resolved: { background: '#d1fae5', color: '#065f46' },
  closed: { background: 'var(--cream-2)', color: 'var(--ink-3)' },
};

export default function GrievanceDashboard({ user }: { user: UserProfile }) {
  const [grievances, setGrievances] = useState<Grievance[]>([]);
  const [loading, setLoading] = useState(true);

  const isSuperAdmin = user.role === 'super_admin';
  const isPrincipal = user.role === 'principal';
  const isOfficer = user.role === 'grievance_officer';

  useEffect(() => {
    let q;
    if (isSuperAdmin) {
      q = query(collection(db, 'grievances'), orderBy('createdAt', 'desc'));
    } else if (isPrincipal) {
      q = query(collection(db, 'grievances'), where('isEscalated', '==', true), orderBy('createdAt', 'desc'));
    } else {
      q = query(collection(db, 'grievances'), where('isEscalated', '==', false), orderBy('createdAt', 'desc'));
    }

    const unsub = onSnapshot(q, snap => {
      setGrievances(snap.docs.map(d => ({ id: d.id, ...d.data() } as Grievance)));
      setLoading(false);
    }, () => setLoading(false));

    return unsub;
  }, [isSuperAdmin, isPrincipal]);

  const open = grievances.filter(g => g.status === 'open').length;
  const inProgress = grievances.filter(g => g.status === 'in_progress').length;
  const resolved = grievances.filter(g => g.status === 'resolved' || g.status === 'closed').length;
  const urgent = grievances.filter(g => g.priority === 'urgent' && g.status !== 'resolved' && g.status !== 'closed').length;

  const avgResolutionHours = (() => {
    const resolvedWithTime = grievances.filter(g => g.resolvedAt && g.createdAt);
    if (resolvedWithTime.length === 0) return null;
    const totalHours = resolvedWithTime.reduce((sum, g) => {
      const diff = new Date(g.resolvedAt!).getTime() - new Date(g.createdAt).getTime();
      return sum + diff / 3600000;
    }, 0);
    return Math.round(totalHours / resolvedWithTime.length);
  })();

  const pending = open + inProgress;
  const recent = grievances.slice(0, 6);

  const trackerPath = user.role === 'grievance_officer' ? '/grievance/tracker'
    : user.role === 'principal' ? '/principal/tracker'
    : '/superadmin/tracker';

  if (loading) {
    return (
      <div>
        <div className="topbar">
          <div>
            <div className="eyebrow">Loading…</div>
            <h1>Grievance</h1>
          </div>
        </div>
        <div className="pad" style={{ paddingTop: 40, textAlign: 'center' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid var(--line)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ── Topbar ── */}
      <div className="topbar">
        <div>
          <div className="eyebrow">
            {pending > 0 ? `${pending} pending` : 'All clear'}
            {isPrincipal ? ' · Escalated view' : ''}
          </div>
          <h1>Grievance</h1>
        </div>
        <div>
          <Link to={trackerPath} className="btn accent" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ArrowUpRight size={15} />
            View All
          </Link>
        </div>
      </div>

      <div className="pad">
        {/* ── Stats row ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          {/* Total */}
          <div className="card" style={{ textAlign: 'center', padding: '16px 12px' }}>
            <div className="eyebrow">Total</div>
            <div className="t-num" style={{ fontSize: 32, margin: '4px 0' }}>{grievances.length}</div>
            <div className="muted" style={{ fontSize: 11 }}>all time</div>
          </div>
          {/* Open */}
          <div className="card" style={{ textAlign: 'center', padding: '16px 12px', borderColor: open > 0 ? 'var(--coral)' : 'var(--line)' }}>
            <div className="eyebrow" style={{ color: open > 0 ? 'var(--coral)' : undefined }}>Open</div>
            <div className="t-num" style={{ fontSize: 32, margin: '4px 0', color: open > 0 ? 'var(--coral)' : undefined }}>{open}</div>
            {urgent > 0 && <div style={{ fontSize: 11, color: 'var(--coral)', fontWeight: 700 }}>{urgent} urgent</div>}
          </div>
          {/* Resolved */}
          <div className="card" style={{ textAlign: 'center', padding: '16px 12px', borderColor: resolved > 0 ? 'var(--leaf)' : 'var(--line)' }}>
            <div className="eyebrow" style={{ color: 'var(--leaf)' }}>Resolved</div>
            <div className="t-num" style={{ fontSize: 32, margin: '4px 0', color: 'var(--leaf)' }}>{resolved}</div>
            {avgResolutionHours !== null && <div className="muted" style={{ fontSize: 11 }}>avg {avgResolutionHours}h</div>}
          </div>
        </div>

        {/* ── Recent grievances ── */}
        <div className="section-head">
          <h2>Recent Grievances</h2>
        </div>

        {recent.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <MessageSquare size={32} style={{ color: 'var(--line)', margin: '0 auto 8px' }} />
            <p className="muted" style={{ fontSize: 14 }}>No grievances found</p>
          </div>
        ) : (
          <div className="stack" style={{ marginBottom: 20 }}>
            {recent.map(g => (
              <div key={g.id} className="card" style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  {/* Status dot */}
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0,
                    background: statusDot[g.status] || 'var(--ink-3)',
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontWeight: 700, fontSize: 14, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {g.studentName}
                        </p>
                        <div className="eyebrow" style={{ marginTop: 2 }}>
                          {g.category.replace('_', ' ')} · {g.parentName}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700,
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                          ...statusChipStyle[g.status],
                        }}>
                          {statusLabel[g.status] || g.status}
                        </span>
                        <span className="mono tiny" style={{ fontSize: 11 }}>
                          {new Date(g.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        </span>
                      </div>
                    </div>
                    {g.isEscalated && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--coral)', marginTop: 4, display: 'inline-block' }}>
                        ESCALATED
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Quick action tiles ── */}
        <div className="section-head">
          <h2>Quick Actions</h2>
        </div>
        <div className="hscroll" style={{ marginBottom: 8 }}>
          {isOfficer && (
            <>
              <Link
                to="/grievance/tracker"
                style={{
                  display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  padding: '14px 18px', borderRadius: 14,
                  background: '#f0fdf4', border: '1px solid #bbf7d0', textDecoration: 'none',
                  minWidth: 100, flexShrink: 0,
                }}
              >
                <MessageSquare size={20} style={{ color: 'var(--leaf)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#065f46', textAlign: 'center' }}>Manage Grievances</span>
              </Link>
              <Link
                to="/grievance/fee-followup"
                style={{
                  display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  padding: '14px 18px', borderRadius: 14,
                  background: '#fffbeb', border: '1px solid #fde68a', textDecoration: 'none',
                  minWidth: 100, flexShrink: 0,
                }}
              >
                <Wallet size={20} style={{ color: '#d97706' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#92400e', textAlign: 'center' }}>Fee Follow-up</span>
              </Link>
              <Link
                to="/grievance/broadcast"
                style={{
                  display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  padding: '14px 18px', borderRadius: 14,
                  background: '#eff6ff', border: '1px solid #bfdbfe', textDecoration: 'none',
                  minWidth: 100, flexShrink: 0,
                }}
              >
                <Users size={20} style={{ color: '#2563eb' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', textAlign: 'center' }}>WA Broadcast</span>
              </Link>
            </>
          )}
          {isPrincipal && (
            <Link
              to="/principal/tracker"
              style={{
                display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '14px 18px', borderRadius: 14,
                background: '#fff1f2', border: '1px solid #fecdd3', textDecoration: 'none',
                minWidth: 100, flexShrink: 0,
              }}
            >
              <AlertCircle size={20} style={{ color: 'var(--coral)' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#9f1239', textAlign: 'center' }}>Escalated</span>
            </Link>
          )}
          <Link
            to={trackerPath}
            style={{
              display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              padding: '14px 18px', borderRadius: 14,
              background: 'var(--cream-2)', border: '1px solid var(--line)', textDecoration: 'none',
              minWidth: 100, flexShrink: 0,
            }}
          >
            <TrendingUp size={20} style={{ color: 'var(--ink-3)' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', textAlign: 'center' }}>All Tracker</span>
          </Link>
        </div>

        {/* ── By category ── */}
        <div className="section-head" style={{ marginTop: 20 }}>
          <h2>By Category</h2>
        </div>
        <div className="card">
          {(['academic', 'fee', 'facility', 'staff_conduct', 'transport', 'other'] as const).map(cat => {
            const count = grievances.filter(g => g.category === cat).length;
            const pct = grievances.length > 0 ? Math.round((count / grievances.length) * 100) : 0;
            return (
              <div key={cat} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>{cat.replace('_', ' ')}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{count}</span>
                </div>
                <div className="bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
