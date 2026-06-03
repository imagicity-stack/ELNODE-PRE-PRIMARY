import { useState, useEffect, useMemo } from 'react';
import {
  History as HistoryIcon,
  Search,
  Download,
  Globe,
  Wifi,
  ChevronLeft,
  ChevronRight,
  X,
  Activity,
  Users,
  Layers,
  Calendar,
  MonitorSmartphone,
  Sparkles,
} from 'lucide-react';
import { ActivityLog, ActivitySection, UserProfile } from '../../types';
import { subscribeActivityLogs } from '../../services/activityService';
import { saveText } from '../../lib/download';
import { format, isAfter, isBefore, startOfDay, endOfDay, isToday } from 'date-fns';

const toDate = (ts: any): Date | null => {
  if (!ts) return null;
  if (typeof ts?.toDate === 'function') return ts.toDate();
  if (typeof ts?.seconds === 'number') return new Date(ts.seconds * 1000);
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
};

const safeFormat = (ts: any, pattern: string) => {
  const d = toDate(ts);
  return d ? format(d, pattern) : '—';
};

const SECTIONS: ActivitySection[] = [
  'Super Admin', 'Accounts', 'Parents', 'Students', 'Academic', 'Teachers', 'Exam', 'Staff', 'Principal',
];

const ROLES = ['super_admin', 'accountant', 'parent', 'teacher', 'student', 'principal', 'grievance_officer'];

const SECTION_COLORS: Record<string, { bg: string; color: string }> = {
  'Super Admin': { bg: '#fee2e2', color: '#b91c1c' },
  'Accounts':   { bg: '#dcfce7', color: '#15803d' },
  'Academic':   { bg: '#dbeafe', color: '#1d4ed8' },
  'Students':   { bg: '#fef9c3', color: '#854d0e' },
  'Teachers':   { bg: '#e0e7ff', color: '#4338ca' },
  'Exam':       { bg: '#f3e8ff', color: '#7e22ce' },
  'Staff':      { bg: '#cffafe', color: '#0e7490' },
  'Parents':    { bg: '#fce7f3', color: '#9d174d' },
  'Principal':  { bg: '#ffedd5', color: '#9a3412' },
};

export default function ActivityTracker({ user }: { user: UserProfile }) {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [subError, setSubError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [selectedSection, setSelectedSection] = useState<string>('all');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [page, setPage] = useState(1);
  const itemsPerPage = 25;

  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setSubError(null);
    const unsub = subscribeActivityLogs({
      limitCount: 1000,
      onData: (docs) => { setLogs(docs); setLoading(false); setSubError(null); },
      onError: (err) => {
        setLoading(false);
        const code = err?.code || '';
        const msg = err?.message || String(err);
        if (code === 'permission-denied' || /Missing or insufficient permissions/i.test(msg)) {
          setSubError('Firestore denied read access to activityLogs. The new security rules have not been deployed yet. Run: firebase deploy --only firestore:rules');
        } else {
          setSubError(`Could not load activity logs: ${msg}`);
        }
      },
    });
    return unsub;
  }, []);

  useEffect(() => { setPage(1); }, [search, selectedSection, selectedRole, dateFrom, dateTo]);

  const filteredLogs = useMemo(() => logs.filter(log => {
    if (selectedSection !== 'all' && log.section !== selectedSection) return false;
    if (selectedRole !== 'all' && log.userRole !== selectedRole) return false;
    if (dateFrom) { const d = toDate(log.timestamp); if (!d || isBefore(d, startOfDay(new Date(dateFrom)))) return false; }
    if (dateTo) { const d = toDate(log.timestamp); if (!d || isAfter(d, endOfDay(new Date(dateTo)))) return false; }
    if (search) {
      const q = search.toLowerCase();
      return (log.userName || '').toLowerCase().includes(q) || (log.action || '').toLowerCase().includes(q) || (log.details || '').toLowerCase().includes(q) || (log.aiDescription || '').toLowerCase().includes(q) || (log.ip || '').toLowerCase().includes(q) || (log.location || '').toLowerCase().includes(q);
    }
    return true;
  }), [logs, search, selectedSection, selectedRole, dateFrom, dateTo]);

  const paginatedLogs = filteredLogs.slice((page - 1) * itemsPerPage, page * itemsPerPage);
  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);

  const stats = useMemo(() => {
    const todayLogs = logs.filter(l => { const d = toDate(l.timestamp); return d ? isToday(d) : false; });
    const uniqueUsers = new Set(logs.map(l => l.userId)).size;
    const sectionsUsed = new Set(logs.map(l => l.section)).size;
    const uniqueIPs = new Set(logs.filter(l => l.ip).map(l => l.ip)).size;
    return { total: logs.length, today: todayLogs.length, uniqueUsers, sectionsUsed, uniqueIPs };
  }, [logs]);

  const exportCSV = async () => {
    const headers = ['Timestamp', 'User', 'Role', 'Section', 'Action', 'Details', 'IP', 'Location', 'ISP'];
    const rows = filteredLogs.map(log => [
      safeFormat(log.timestamp, 'dd/MM/yyyy HH:mm:ss'),
      log.userName, log.userRole, log.section, log.action,
      `"${(log.details || '').replace(/"/g, '""')}"`,
      log.ip || '', log.location || '', log.isp || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    await saveText(csv, `activity_log_${format(new Date(), 'yyyy-MM-dd_HHmm')}.csv`);
  };

  const clearFilters = () => {
    setSearch(''); setSelectedSection('all'); setSelectedRole('all'); setDateFrom(''); setDateTo('');
  };

  const hasActiveFilters = search || selectedSection !== 'all' || selectedRole !== 'all' || dateFrom || dateTo;

  return (
    <>
      {/* Topbar */}
      <div className="topbar">
        <div>
          <div className="eyebrow">{filteredLogs.length} entries</div>
          <h1>Activity</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--leaf)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--leaf)', display: 'inline-block', animation: 'pulse 2s infinite' }} />
            Live
          </span>
          <button
            className="icon-btn"
            onClick={exportCSV}
            disabled={filteredLogs.length === 0}
            title="Export CSV"
          >
            <Download size={15} />
          </button>
        </div>
      </div>

      <div className="pad stack" style={{ paddingBottom: 32 }}>
        {/* Error banner */}
        {subError && (
          <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 12, padding: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <X size={16} style={{ color: '#dc2626', flexShrink: 0, marginTop: 1 }} />
            <div>
              <p style={{ fontWeight: 700, color: '#b91c1c', fontSize: 13 }}>Activity log unavailable</p>
              <p style={{ fontSize: 11, color: '#dc2626', fontFamily: 'var(--mono)', marginTop: 3 }}>{subError}</p>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
          {[
            { label: 'Total Logs', value: stats.total, icon: Activity },
            { label: "Today's Activity", value: stats.today, icon: Calendar },
            { label: 'Unique Users', value: stats.uniqueUsers, icon: Users },
            { label: 'Unique IPs', value: stats.uniqueIPs, icon: Globe },
          ].map(s => (
            <div key={s.label} className="card flex" style={{ gap: 10, alignItems: 'center', padding: 14 }}>
              <s.icon size={18} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
              <div>
                <div className="eyebrow" style={{ marginBottom: 2 }}>{s.label}</div>
                <div className="t-num" style={{ fontSize: 22 }}>{s.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="card flex" style={{ gap: 10, padding: '10px 14px', alignItems: 'center' }}>
          <Search size={16} className="muted" style={{ flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by user, action, details, IP or location…"
            style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, fontSize: 14, fontFamily: 'var(--body)', color: 'var(--ink)' }}
          />
          {hasActiveFilters && (
            <button onClick={clearFilters} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--coral)', fontWeight: 600 }}>
              <X size={12} /> Clear
            </button>
          )}
        </div>

        {/* Section filter chips */}
        <div className="hscroll" style={{ padding: 0 }}>
          {['all', ...SECTIONS].map(s => (
            <button
              key={s}
              onClick={() => setSelectedSection(s)}
              className={selectedSection === s ? 'chip solid' : 'chip'}
            >
              {s === 'all' ? 'All Sections' : s}
            </button>
          ))}
        </div>

        {/* Role filter chips */}
        <div className="hscroll" style={{ padding: 0 }}>
          {['all', ...ROLES].map(r => (
            <button
              key={r}
              onClick={() => setSelectedRole(r)}
              className={selectedRole === r ? 'chip solid' : 'chip'}
            >
              {r === 'all' ? 'All Roles' : r.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Date range filters */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>From date</div>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, padding: '9px 12px', fontSize: 13, fontFamily: 'var(--body)', color: 'var(--ink)', background: 'var(--paper)', outline: 'none' }}
            />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>To date</div>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 10, padding: '9px 12px', fontSize: 13, fontFamily: 'var(--body)', color: 'var(--ink)', background: 'var(--paper)', outline: 'none' }}
            />
          </div>
        </div>

        {/* Log entries */}
        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <p className="muted">Loading…</p>
          </div>
        ) : paginatedLogs.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <HistoryIcon size={36} style={{ margin: '0 auto 12px', color: 'var(--ink-3)' }} />
            <p style={{ fontWeight: 700, marginBottom: 4 }}>No activities found</p>
            <p className="muted tiny">Adjust your search or filters to see more results.</p>
          </div>
        ) : (
          <div className="stack">
            {paginatedLogs.map(log => {
              const sc = SECTION_COLORS[log.section] || { bg: 'var(--cream-2)', color: 'var(--ink-2)' };
              const isExpanded = expandedId === log.id;
              return (
                <div key={log.id} className="card" style={{ padding: 14, cursor: 'pointer' }}
                  onClick={() => setExpandedId(isExpanded ? null : log.id)}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    {/* User initial circle */}
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--ink)', color: 'var(--cream)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0, fontFamily: 'var(--display)' }}>
                      {(log.userName || '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{log.action}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: sc.bg, color: sc.color }}>
                          {log.section}
                        </span>
                      </div>
                      {log.aiDescription ? (
                        <div style={{ display: 'flex', gap: 5, alignItems: 'flex-start', marginBottom: 3 }}>
                          <Sparkles size={11} style={{ color: '#7c3aed', flexShrink: 0, marginTop: 1 }} />
                          <p style={{ fontSize: 12, color: 'var(--ink-2)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{log.aiDescription}</p>
                        </div>
                      ) : (
                        <p className="muted" style={{ fontSize: 12, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', marginBottom: 3 }}>{log.details}</p>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span className="muted" style={{ fontSize: 11 }}>{log.userName} · <span style={{ textTransform: 'capitalize' }}>{(log.userRole || '').replace('_', ' ')}</span></span>
                        <span className="mono tiny muted">{safeFormat(log.timestamp, 'dd MMM, HH:mm')}</span>
                      </div>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line-2)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          {log.aiDescription && (
                            <div style={{ marginBottom: 10, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: 10 }}>
                              <div className="eyebrow" style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4, color: '#7c3aed' }}>
                                <Sparkles size={10} /> AI Description
                              </div>
                              <p style={{ fontSize: 12, color: '#4c1d95', lineHeight: 1.5 }}>{log.aiDescription}</p>
                            </div>
                          )}
                          <div className="eyebrow" style={{ marginBottom: 4 }}>Raw Details</div>
                          <p style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5 }}>{log.details}</p>
                          {log.metadata && (
                            <div style={{ marginTop: 8 }}>
                              <div className="eyebrow" style={{ marginBottom: 4 }}>Metadata</div>
                              <pre style={{ fontSize: 10, color: 'var(--ink-2)', background: 'var(--cream-2)', border: '1px solid var(--line)', borderRadius: 8, padding: 8, overflow: 'auto', maxHeight: 120 }}>
                                {JSON.stringify(log.metadata, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                        <div>
                          {log.ip && (
                            <div style={{ marginBottom: 8 }}>
                              <div className="eyebrow" style={{ marginBottom: 4 }}>IP / Location</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                                <Globe size={12} style={{ color: 'var(--ink-3)' }} />
                                <span className="mono" style={{ fontSize: 11 }}>{log.ip}</span>
                              </div>
                              {log.location && <p className="muted tiny" style={{ marginTop: 2 }}>{log.location}</p>}
                              {log.isp && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                                  <Wifi size={11} style={{ color: 'var(--ink-3)' }} />
                                  <span className="muted tiny">{log.isp}</span>
                                </div>
                              )}
                            </div>
                          )}
                          {log.userAgent && (
                            <div style={{ marginBottom: 8 }}>
                              <div className="eyebrow" style={{ marginBottom: 4 }}>User Agent</div>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                                <MonitorSmartphone size={12} style={{ color: 'var(--ink-3)', flexShrink: 0, marginTop: 1 }} />
                                <p className="muted" style={{ fontSize: 10, wordBreak: 'break-all', lineHeight: 1.5 }}>{log.userAgent}</p>
                              </div>
                            </div>
                          )}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div>
                              <div className="eyebrow" style={{ marginBottom: 3 }}>User ID</div>
                              <p className="mono muted" style={{ fontSize: 10, wordBreak: 'break-all' }}>{log.userId}</p>
                            </div>
                            <div>
                              <div className="eyebrow" style={{ marginBottom: 3 }}>Exact Time</div>
                              <p className="mono muted" style={{ fontSize: 10 }}>{safeFormat(log.timestamp, 'dd MMM yyyy, HH:mm:ss')}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 }}>
            <button
              className="icon-btn"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)' }}>{page} / {totalPages}</span>
            <button
              className="icon-btn"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {totalPages > 1 && page < totalPages && (
          <button
            className="btn ghost"
            style={{ fontSize: 13 }}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            Load More
          </button>
        )}
      </div>
    </>
  );
}
