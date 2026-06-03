import { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { PayrollConfig, UserProfile } from '../../types';
import { useToast } from '../../components/Toast';
import { logActivity } from '../../services/activityService';
import { Save, RefreshCcw, HelpCircle, Percent, Calculator, ShieldCheck, CreditCard, DollarSign } from 'lucide-react';

export default function PayrollSettings({ user }: { user: UserProfile }) {
  const [config, setConfig] = useState<PayrollConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const docRef = doc(db, 'payroll-config', 'global');
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setConfig(docSnap.data() as PayrollConfig);
      } else {
        setConfig({ id: 'global', workingDaysInYear: 240, pfRate: 12, professionalTax: 200, updatedBy: user.uid, updatedAt: new Date().toISOString() });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'payroll-config/global');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchConfig(); }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const updatedConfig = { ...config, updatedBy: user.uid, updatedAt: new Date().toISOString() };
      await setDoc(doc(db, 'payroll-config', 'global'), updatedConfig);
      logActivity(user, 'Updated Payroll Settings', 'Super Admin', 'Changed global salary calculation variables.');
      showToast('Payroll settings updated successfully', 'success');
      setConfig(updatedConfig);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'payroll-config/global');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="pad" style={{ padding: 32, textAlign: 'center' }}><span className="muted">Loading…</span></div>;

  return (
    <div className="pb-2">
      <div className="topbar">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Payroll Config</h1>
        </div>
        <button className="btn accent" onClick={handleSave} disabled={saving} style={{ gap: 8 }}>
          {saving ? <RefreshCcw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="pad stack" style={{ marginTop: 14 }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--cream-2)', display: 'grid', placeItems: 'center' }}>
              <Calculator size={18} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Leave Deduction Logic</div>
              <div className="eyebrow">Per-day deduction calculation</div>
            </div>
          </div>

          <div className="stack" style={{ gap: 14 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Standard Daily Deduction (₹)</div>
              <div style={{ position: 'relative' }}>
                <DollarSign size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
                <input
                  type="number"
                  value={config?.leaveDeductionPerDay ?? 0}
                  onChange={e => setConfig(prev => prev ? { ...prev, leaveDeductionPerDay: Number(e.target.value) } : null)}
                  placeholder="Fixed amount, e.g. 500"
                  style={{ width: '100%', paddingLeft: 36, paddingRight: 12, height: 40, border: '1px solid var(--line)', borderRadius: 10, fontSize: 14, background: 'var(--cream)', outline: 'none', fontFamily: 'var(--body)', color: 'var(--ink)', boxSizing: 'border-box' }}
                />
              </div>
              <div className="tiny muted" style={{ marginTop: 4 }}>Leave 0 to use annual formula.</div>
            </div>

            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Working Days in Year</div>
              <div style={{ position: 'relative' }}>
                <RefreshCcw size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
                <input
                  type="number"
                  value={config?.workingDaysInYear ?? 240}
                  onChange={e => setConfig(prev => prev ? { ...prev, workingDaysInYear: Number(e.target.value) } : null)}
                  style={{ width: '100%', paddingLeft: 36, paddingRight: 12, height: 40, border: '1px solid var(--line)', borderRadius: 10, fontSize: 14, background: 'var(--cream)', outline: 'none', fontFamily: 'var(--body)', color: 'var(--ink)', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div className="card" style={{ background: 'var(--cream-2)', border: 0, padding: '10px 14px', display: 'flex', gap: 8 }}>
              <HelpCircle size={14} className="muted" style={{ flexShrink: 0, marginTop: 1 }} />
              <span className="tiny muted">Formula: (Salary × 12) / {config?.workingDaysInYear || 240} = Per day deduction.</span>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--cream-2)', display: 'grid', placeItems: 'center' }}>
              <Percent size={18} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Statutory Deductions</div>
              <div className="eyebrow">PF and professional tax</div>
            </div>
          </div>

          <div className="stack" style={{ gap: 14 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>PF Contribution (%)</div>
              <div style={{ position: 'relative' }}>
                <ShieldCheck size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
                <input
                  type="number"
                  value={config?.pfRate ?? 12}
                  onChange={e => setConfig(prev => prev ? { ...prev, pfRate: Number(e.target.value) } : null)}
                  style={{ width: '100%', paddingLeft: 36, paddingRight: 12, height: 40, border: '1px solid var(--line)', borderRadius: 10, fontSize: 14, background: 'var(--cream)', outline: 'none', fontFamily: 'var(--body)', color: 'var(--ink)', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Professional Tax (₹ flat)</div>
              <div style={{ position: 'relative' }}>
                <CreditCard size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
                <input
                  type="number"
                  value={config?.professionalTax ?? 200}
                  onChange={e => setConfig(prev => prev ? { ...prev, professionalTax: Number(e.target.value) } : null)}
                  style={{ width: '100%', paddingLeft: 36, paddingRight: 12, height: 40, border: '1px solid var(--line)', borderRadius: 10, fontSize: 14, background: 'var(--cream)', outline: 'none', fontFamily: 'var(--body)', color: 'var(--ink)', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          </div>
        </div>

        {config?.updatedAt && (
          <div className="mono tiny muted" style={{ textAlign: 'center', padding: '8px 0' }}>
            Last updated: {new Date(config.updatedAt).toLocaleString()}
          </div>
        )}
      </div>
      <div style={{ height: 16 }} />
    </div>
  );
}
