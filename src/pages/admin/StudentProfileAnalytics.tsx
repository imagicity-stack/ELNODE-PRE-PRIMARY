import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import { UserProfile, ExtendedStudentProfile } from '../../types';
import { BarChart3, Users, CheckCircle, AlertCircle, TrendingUp, Heart, Activity, BookOpen, Briefcase, CreditCard } from 'lucide-react';

interface Props { user: UserProfile }

// ── Distribution bar ──────────────────────────────────────────────────────────
function DistBar({ label, count, total, color = 'var(--accent)' }: { label: string; count: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: 'var(--ink-2)', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{count} ({pct}%)</span>
      </div>
      <div style={{ height: 7, background: 'var(--cream-2)', borderRadius: 99 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color = 'var(--ink)' }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--cream-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={20} style={{ color }} />
      </div>
      <div>
        <p style={{ fontSize: 24, fontWeight: 800, color, fontFamily: 'var(--display)', lineHeight: 1 }}>{value}</p>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>{label}</p>
        {sub && <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>{sub}</p>}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, number> {
  return arr.reduce((acc, item) => {
    const k = key(item) || 'Not Specified';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

function topEntries(obj: Record<string, number>, limit = 8) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

const COLORS = ['var(--accent)', 'var(--leaf)', 'var(--coral)', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16'];

// ── Main ──────────────────────────────────────────────────────────────────────
export default function StudentProfileAnalytics({ user }: Props) {
  const [profiles, setProfiles] = useState<ExtendedStudentProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDocs(collection(db, 'studentProfiles')).then(snap => {
      setProfiles(snap.docs.map(d => d.data() as ExtendedStudentProfile));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="pad" style={{ textAlign: 'center', paddingTop: 60 }}>
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto" style={{ borderColor: 'var(--ink)' }} />
        <p className="muted" style={{ marginTop: 12 }}>Loading profile data…</p>
      </div>
    );
  }

  const total = profiles.length;
  const complete = profiles.filter(p => (p.completionPercentage || 0) >= 80).length;
  const idCardComplete = profiles.filter(p => p.idCardFrontUrl && p.idCardBackUrl).length;
  const avgCompletion = total > 0 ? Math.round(profiles.reduce((s, p) => s + (p.completionPercentage || 0), 0) / total) : 0;

  // Distributions
  const bloodGroups = groupBy(profiles.filter(p => p.bloodGroup), p => p.bloodGroup!);
  const religions = groupBy(profiles.filter(p => p.religion), p => p.religion!);
  const categories = groupBy(profiles.filter(p => p.category), p => p.category!);
  const fatherQuals = groupBy(profiles.filter(p => p.father?.qualification), p => p.father!.qualification!);
  const motherQuals = groupBy(profiles.filter(p => p.mother?.qualification), p => p.mother!.qualification!);
  const fatherIncome = groupBy(profiles.filter(p => p.father?.annualIncome), p => p.father!.annualIncome!);
  const visions = groupBy(profiles.filter(p => p.health?.vision), p => p.health!.vision!);
  const states = groupBy(profiles.filter(p => p.permanentAddress?.state), p => p.permanentAddress!.state!);

  const withMedical = profiles.filter(p => p.health?.medicalConditions && p.health.medicalConditions.toLowerCase() !== 'none').length;
  const withAllergies = profiles.filter(p => p.health?.allergies && p.health.allergies.toLowerCase() !== 'none').length;
  const withHearing = profiles.filter(p => p.health?.hearingIssues).length;
  const withGuardian = profiles.filter(p => p.hasGuardian).length;
  const withSiblings = profiles.filter(p => (p.siblings || []).length > 0).length;

  const prevBoards = groupBy(profiles.filter(p => p.previousSchool?.board), p => p.previousSchool!.board!);
  const nationalities = groupBy(profiles.filter(p => p.nationality), p => p.nationality!);

  if (total === 0) {
    return (
      <div>
        <div className="topbar">
          <div><div className="eyebrow">Admin</div><h1>Profile Analytics</h1></div>
        </div>
        <div className="pad" style={{ paddingTop: 40, textAlign: 'center' }}>
          <BarChart3 size={48} style={{ color: 'var(--ink-4)', margin: '0 auto 12px' }} />
          <p style={{ fontWeight: 700, fontSize: 16 }}>No profiles yet</p>
          <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>Students haven't filled their extended profiles yet. Analytics will appear once data is available.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="topbar">
        <div><div className="eyebrow">Admin</div><h1>Student Profile Analytics</h1></div>
        <span className="chip" style={{ fontSize: 12 }}>{total} profiles</span>
      </div>

      <div className="pad" style={{ paddingTop: 16, paddingBottom: 40 }}>
        <div className="stack">

          {/* ── Completion Stats ── */}
          <div>
            <p className="eyebrow" style={{ marginBottom: 12 }}>Profile Completion</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <StatCard icon={Users} label="Total Profiles Submitted" value={total} color="var(--ink)" />
              <StatCard icon={CheckCircle} label="Profiles ≥ 80% Complete" value={complete} sub={`${Math.round((complete/total)*100)}% of submitted`} color="var(--leaf)" />
              <StatCard icon={CreditCard} label="ID Cards Uploaded" value={idCardComplete} sub={`${Math.round((idCardComplete/total)*100)}% compliance`} color="var(--accent)" />
              <StatCard icon={TrendingUp} label="Avg. Completion" value={`${avgCompletion}%`} sub="across all profiles" color={avgCompletion >= 70 ? 'var(--leaf)' : 'var(--coral)'} />
            </div>
          </div>

          {/* Completion Progress */}
          <div className="card">
            <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Completion Distribution</p>
            {[
              { label: 'Complete (80–100%)', count: profiles.filter(p => (p.completionPercentage || 0) >= 80).length, color: 'var(--leaf)' },
              { label: 'In Progress (50–79%)', count: profiles.filter(p => (p.completionPercentage || 0) >= 50 && (p.completionPercentage || 0) < 80).length, color: 'var(--accent)' },
              { label: 'Minimal (1–49%)', count: profiles.filter(p => (p.completionPercentage || 0) > 0 && (p.completionPercentage || 0) < 50).length, color: '#f59e0b' },
              { label: 'Empty (0%)', count: profiles.filter(p => !(p.completionPercentage || 0)).length, color: 'var(--coral)' },
            ].map(({ label, count, color }) => (
              <DistBar key={label} label={label} count={count} total={total} color={color} />
            ))}
          </div>

          {/* ── Demographics ── */}
          <p className="eyebrow">Demographics</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>

            {/* Blood Groups */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Activity size={16} style={{ color: 'var(--coral)' }} />
                <p style={{ fontWeight: 700, fontSize: 14 }}>Blood Group Distribution</p>
              </div>
              {topEntries(bloodGroups).map(([key, count], i) => (
                <DistBar key={key} label={key} count={count} total={profiles.filter(p => p.bloodGroup).length} color={COLORS[i % COLORS.length]} />
              ))}
              {Object.keys(bloodGroups).length === 0 && <p className="muted" style={{ fontSize: 13 }}>No data yet</p>}
            </div>

            {/* Religion */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Users size={16} style={{ color: 'var(--accent)' }} />
                <p style={{ fontWeight: 700, fontSize: 14 }}>Religion Distribution</p>
              </div>
              {topEntries(religions).map(([key, count], i) => (
                <DistBar key={key} label={key} count={count} total={profiles.filter(p => p.religion).length} color={COLORS[i % COLORS.length]} />
              ))}
              {Object.keys(religions).length === 0 && <p className="muted" style={{ fontSize: 13 }}>No data yet</p>}
            </div>

            {/* Category */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <BarChart3 size={16} style={{ color: 'var(--leaf)' }} />
                <p style={{ fontWeight: 700, fontSize: 14 }}>Category / Reservation</p>
              </div>
              {['General', 'OBC', 'SC', 'ST', 'EWS'].map((cat, i) => (
                <DistBar key={cat} label={cat} count={categories[cat] || 0} total={profiles.filter(p => p.category).length} color={COLORS[i % COLORS.length]} />
              ))}
              {Object.keys(categories).length === 0 && <p className="muted" style={{ fontSize: 13 }}>No data yet</p>}
            </div>

            {/* Top States */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <BookOpen size={16} style={{ color: '#8b5cf6' }} />
                <p style={{ fontWeight: 700, fontSize: 14 }}>Top States (Permanent Address)</p>
              </div>
              {topEntries(states, 6).map(([key, count], i) => (
                <DistBar key={key} label={key} count={count} total={profiles.filter(p => p.permanentAddress?.state).length} color={COLORS[i % COLORS.length]} />
              ))}
              {Object.keys(states).length === 0 && <p className="muted" style={{ fontSize: 13 }}>No data yet</p>}
            </div>
          </div>

          {/* ── Parents' Profile ── */}
          <p className="eyebrow">Parent Profiles</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>

            {/* Father's Qualification */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Briefcase size={16} style={{ color: 'var(--accent)' }} />
                <p style={{ fontWeight: 700, fontSize: 14 }}>Father's Education</p>
              </div>
              {topEntries(fatherQuals, 6).map(([key, count], i) => (
                <DistBar key={key} label={key} count={count} total={profiles.filter(p => p.father?.qualification).length} color={COLORS[i % COLORS.length]} />
              ))}
              {Object.keys(fatherQuals).length === 0 && <p className="muted" style={{ fontSize: 13 }}>No data yet</p>}
            </div>

            {/* Mother's Qualification */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Heart size={16} style={{ color: 'var(--coral)' }} />
                <p style={{ fontWeight: 700, fontSize: 14 }}>Mother's Education</p>
              </div>
              {topEntries(motherQuals, 6).map(([key, count], i) => (
                <DistBar key={key} label={key} count={count} total={profiles.filter(p => p.mother?.qualification).length} color={COLORS[i % COLORS.length]} />
              ))}
              {Object.keys(motherQuals).length === 0 && <p className="muted" style={{ fontSize: 13 }}>No data yet</p>}
            </div>

            {/* Father's Income */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <TrendingUp size={16} style={{ color: 'var(--leaf)' }} />
                <p style={{ fontWeight: 700, fontSize: 14 }}>Family Income Bracket</p>
              </div>
              {['Below ₹1 Lakh','₹1–2 Lakh','₹2–5 Lakh','₹5–10 Lakh','₹10–20 Lakh','₹20–50 Lakh','Above ₹50 Lakh'].map((bracket, i) => (
                <DistBar key={bracket} label={bracket} count={fatherIncome[bracket] || 0} total={profiles.filter(p => p.father?.annualIncome).length} color={COLORS[i % COLORS.length]} />
              ))}
              {Object.keys(fatherIncome).length === 0 && <p className="muted" style={{ fontSize: 13 }}>No data yet</p>}
            </div>

            {/* Previous School Boards */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <BookOpen size={16} style={{ color: '#f59e0b' }} />
                <p style={{ fontWeight: 700, fontSize: 14 }}>Previous School Board</p>
              </div>
              {topEntries(prevBoards).map(([key, count], i) => (
                <DistBar key={key} label={key} count={count} total={profiles.filter(p => p.previousSchool?.board).length} color={COLORS[i % COLORS.length]} />
              ))}
              {Object.keys(prevBoards).length === 0 && <p className="muted" style={{ fontSize: 13 }}>No data yet</p>}
            </div>
          </div>

          {/* ── Health Overview ── */}
          <p className="eyebrow">Health Overview</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <StatCard icon={Activity} label="Medical Conditions Reported" value={withMedical} sub={`${Math.round((withMedical/total)*100)}% of profiles`} color="var(--coral)" />
            <StatCard icon={AlertCircle} label="Known Allergies" value={withAllergies} sub={`${Math.round((withAllergies/total)*100)}% of profiles`} color="#f59e0b" />
            <StatCard icon={Activity} label="Hearing Impairment" value={withHearing} sub={`${Math.round((withHearing/total)*100)}% of profiles`} color="#8b5cf6" />
          </div>
          <div className="card">
            <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Vision Distribution</p>
            {topEntries(visions).map(([key, count], i) => (
              <DistBar key={key} label={key} count={count} total={profiles.filter(p => p.health?.vision).length} color={COLORS[i % COLORS.length]} />
            ))}
            {Object.keys(visions).length === 0 && <p className="muted" style={{ fontSize: 13 }}>No data yet</p>}
          </div>

          {/* ── Miscellaneous ── */}
          <p className="eyebrow">Miscellaneous</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <StatCard icon={Users} label="With Guardian (Non-Parent)" value={withGuardian} sub={`${Math.round((withGuardian/total)*100)}% of profiles`} color="var(--accent)" />
            <StatCard icon={Users} label="Have Siblings in School" value={withSiblings} sub={`${Math.round((withSiblings/total)*100)}% of profiles`} color="var(--leaf)" />
          </div>

          {/* Nationalities */}
          {Object.keys(nationalities).length > 1 && (
            <div className="card">
              <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Nationality Distribution</p>
              {topEntries(nationalities, 6).map(([key, count], i) => (
                <DistBar key={key} label={key} count={count} total={profiles.filter(p => p.nationality).length} color={COLORS[i % COLORS.length]} />
              ))}
            </div>
          )}

          <p style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'center', paddingTop: 8 }}>
            Analytics based on {total} submitted student profiles · Refreshes on page load
          </p>
        </div>
      </div>
    </div>
  );
}
