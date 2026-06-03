import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { FineConfig, FineSlab, UserProfile } from '../../types';
import { useToast } from '../../components/Toast';
import { Button, Input, FormField } from '../../components/ui';
import { logActivity } from '../../services/activityService';

const defaultSlabs: FineSlab[] = [
  { startDay: 1, endDay: 10, fixedPenalty: 100, percentagePenalty: 1, isHigherOf: true },
  { startDay: 11, endDay: 20, fixedPenalty: 250, percentagePenalty: 2, isHigherOf: true },
  { startDay: 21, endDay: 30, fixedPenalty: 500, percentagePenalty: 4, isHigherOf: true },
  { startDay: 31, fixedPenalty: 1000, percentagePenalty: 6, isHigherOf: true, escalationRate: 0 },
];

interface SlabErrors {
  startDay?: string;
  endDay?: string;
  penalty?: string;
  order?: string;
}

function validateConfig(config: FineConfig): { global: string[]; slabs: SlabErrors[] } {
  const global: string[] = [];
  const slabErrors: SlabErrors[] = config.slabs.map(() => ({}));

  if (config.slabs.length === 0) {
    global.push('Add at least one penalty slab.');
  }

  config.slabs.forEach((slab, i) => {
    if (slab.fixedPenalty < 0 || slab.percentagePenalty < 0) {
      slabErrors[i].penalty = 'Penalty amounts cannot be negative.';
    }
    if (slab.endDay !== undefined && slab.endDay <= slab.startDay) {
      slabErrors[i].endDay = 'End day must be greater than start day.';
    }
    if (i === 0) {
      if (slab.startDay !== 1) {
        slabErrors[i].startDay = 'First slab must start on day 1 (the day after the due date).';
      }
    } else {
      const prev = config.slabs[i - 1];
      if (prev.endDay === undefined) {
        slabErrors[i].order = `Cannot add a slab after slab ${i} because slab ${i} has no End Day.`;
      } else if (slab.startDay !== prev.endDay + 1) {
        slabErrors[i].order = `Start day must be ${prev.endDay + 1} (one day after slab ${i}'s end day of ${prev.endDay}).`;
      }
    }
  });

  return { global, slabs: slabErrors };
}

function hasBlockingErrors(validation: ReturnType<typeof validateConfig>): boolean {
  if (validation.global.length > 0) return true;
  return validation.slabs.some(e => e.startDay || e.endDay || e.penalty || e.order);
}

export default function FineSettings({ user }: { user: UserProfile }) {
  const [config, setConfig] = useState<FineConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const docRef = doc(db, 'fine-config', 'global');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setConfig(docSnap.data() as FineConfig);
        } else {
          const initialConfig: FineConfig = {
            id: 'global',
            isEnabled: true,
            gracePeriodDays: 0,
            slabs: defaultSlabs,
            updatedBy: user?.uid || '',
            updatedAt: new Date().toISOString(),
          };
          setConfig(initialConfig);
        }
      } catch (err) {
        console.error('Error fetching fine config:', err);
        showToast('Failed to load settings', 'error');
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, [user]);

  const validation = config ? validateConfig(config) : { global: [], slabs: [] };
  const isInvalid = hasBlockingErrors(validation);

  const handleSave = async () => {
    if (!config || !user) return;
    if (isInvalid) {
      showToast('Fix the errors highlighted below before saving.', 'error');
      return;
    }
    setSaving(true);
    try {
      const updatedConfig = {
        ...config,
        gracePeriodDays: 0,
        updatedBy: user.uid,
        updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'fine-config', 'global'), updatedConfig);
      logActivity(user, 'Updated Fine Settings', 'Super Admin', 'Changed late payment penalty rules.');
      showToast('Fine settings saved successfully', 'success');
      setConfig(updatedConfig);
    } catch (err) {
      console.error('Error saving config:', err);
      showToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const addSlab = () => {
    if (!config) return;
    const lastSlab = config.slabs[config.slabs.length - 1];
    const newStart = !lastSlab
      ? 1
      : (lastSlab.endDay !== undefined ? lastSlab.endDay + 1 : lastSlab.startDay + 1);
    const newSlab: FineSlab = { startDay: newStart, fixedPenalty: 0, percentagePenalty: 0, isHigherOf: true };
    setConfig({ ...config, slabs: [...config.slabs, newSlab] });
  };

  const removeSlab = (index: number) => {
    if (!config) return;
    setConfig({ ...config, slabs: config.slabs.filter((_, i) => i !== index) });
  };

  const updateSlab = (index: number, updates: Partial<FineSlab>) => {
    if (!config) return;
    const newSlabs = [...config.slabs];
    newSlabs[index] = { ...newSlabs[index], ...updates };
    setConfig({ ...config, slabs: newSlabs });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <div className="pad stack">
      {/* Topbar */}
      <div className="topbar">
        <div>
          <h1>Fine Settings</h1>
        </div>
        <div>
          <button
            className="btn accent"
            onClick={handleSave}
            disabled={saving || isInvalid}
            style={{ opacity: saving || isInvalid ? 0.6 : 1 }}
          >
            <Save size={14} style={{ marginRight: 6 }} />
            {saving ? 'Saving…' : isInvalid ? 'Fix Errors First' : 'Save'}
          </button>
        </div>
      </div>

      {/* Global Settings card */}
      <div className="card" style={{ padding: 24 }}>
        <div className="section-head" style={{ marginBottom: 16 }}>Global Settings</div>

        {/* Enable / disable toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--cream-2)', borderRadius: 10, border: '1px solid var(--line)', marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>Penalty System</div>
            <div className="tiny muted" style={{ marginTop: 2 }}>Enable or disable all fine calculations</div>
          </div>
          <div
            onClick={() => setConfig(prev => prev ? { ...prev, isEnabled: !prev.isEnabled } : null)}
            style={{
              width: 44,
              height: 24,
              borderRadius: 12,
              padding: 2,
              cursor: 'pointer',
              transition: 'background 0.2s',
              background: config?.isEnabled ? 'var(--accent)' : 'var(--line)',
              flexShrink: 0,
            }}
          >
            <div style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: '#fff',
              transition: 'transform 0.2s',
              transform: config?.isEnabled ? 'translateX(20px)' : 'translateX(0)',
            }} />
          </div>
        </div>

        {/* Info note */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', background: '#eef2ff', borderRadius: 10, border: '1px solid #c7d2fe', marginBottom: 8 }}>
          <Info size={15} style={{ color: '#6366f1', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12, color: '#4338ca', lineHeight: 1.5 }}>
            <strong>Day 1</strong> = the day AFTER the due date. The first slab must start at day 1, and every next slab must start exactly the day after the previous slab's End Day — no gaps, no overlaps. Leave the last slab's End Day blank to make it open-ended.
          </p>
        </div>
      </div>

      {/* Penalty Slabs card */}
      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div className="section-head">Penalty Slabs</div>
          <button className="btn ghost" onClick={addSlab} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <Plus size={14} />
            Add Slab
          </button>
        </div>

        {/* Global validation errors */}
        {validation.global.map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 8, marginBottom: 12 }}>
            <AlertTriangle size={14} style={{ color: '#e11d48', flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 12, color: '#be123c', fontWeight: 600 }}>{e}</p>
          </div>
        ))}

        <div className="stack">
          {config?.slabs.map((slab, index) => {
            const err = validation.slabs[index] || {};
            const hasError = !!(err.startDay || err.endDay || err.penalty || err.order);
            return (
              <div
                key={index}
                style={{
                  padding: 16,
                  borderRadius: 10,
                  border: `1px solid ${hasError ? '#fca5a5' : 'var(--line)'}`,
                  background: hasError ? '#fff7f7' : 'var(--cream)',
                }}
              >
                {/* Slab header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: hasError ? '#fee2e2' : '#fef3c7', color: hasError ? '#dc2626' : '#92400e' }}>
                      Slab {index + 1}
                    </span>
                    {hasError && (
                      <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <AlertTriangle size={12} /> Fix errors
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => removeSlab(index)}
                    className="icon-btn"
                    title="Remove slab"
                    style={{ color: 'var(--coral)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Fields */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
                  <div>
                    <FormField label="Start Day" hint={err.startDay}>
                      <Input
                        type="number"
                        min={1}
                        value={slab.startDay}
                        onChange={(e) => updateSlab(index, { startDay: Number(e.target.value) })}
                        className={err.startDay ? 'border-rose-400 bg-rose-50 focus:ring-rose-300' : ''}
                      />
                    </FormField>
                  </div>
                  <div>
                    <FormField label="End Day" hint={err.endDay || 'Leave blank = open-ended'}>
                      <Input
                        type="number"
                        min={slab.startDay + 1}
                        value={slab.endDay || ''}
                        onChange={(e) => updateSlab(index, { endDay: e.target.value ? Number(e.target.value) : undefined })}
                        placeholder="∞"
                        className={err.endDay ? 'border-rose-400 bg-rose-50 focus:ring-rose-300' : ''}
                      />
                    </FormField>
                  </div>
                  <div>
                    <FormField label="Fixed Penalty (₹)" hint={err.penalty}>
                      <Input
                        type="number"
                        min={0}
                        value={slab.fixedPenalty}
                        onChange={(e) => updateSlab(index, { fixedPenalty: Number(e.target.value) })}
                        className={err.penalty ? 'border-rose-400 bg-rose-50 focus:ring-rose-300' : ''}
                      />
                    </FormField>
                  </div>
                  <div>
                    <FormField label="% of Dues">
                      <Input
                        type="number"
                        min={0}
                        value={slab.percentagePenalty}
                        onChange={(e) => updateSlab(index, { percentagePenalty: Number(e.target.value) })}
                        className={err.penalty ? 'border-rose-400 bg-rose-50 focus:ring-rose-300' : ''}
                      />
                    </FormField>
                  </div>
                  <div>
                    <FormField label="Logic">
                      <select
                        className="w-full h-11 px-4 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 transition-all outline-none text-sm"
                        value={slab.isHigherOf ? 'higher' : 'sum'}
                        onChange={(e) => updateSlab(index, { isHigherOf: e.target.value === 'higher' })}
                      >
                        <option value="higher">Whichever is Higher</option>
                        <option value="sum">Sum of Both</option>
                      </select>
                    </FormField>
                  </div>
                </div>

                {err.order && (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <AlertTriangle size={12} style={{ color: '#dc2626', flexShrink: 0, marginTop: 1 }} />
                    <p style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>{err.order}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Warning note */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', background: '#fffbeb', borderRadius: 10, border: '1px solid #fde68a', marginTop: 16 }}>
          <AlertCircle size={15} style={{ color: '#d97706', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 12, color: '#92400e' }}>Changes reflect instantly on all overdue invoices.</p>
        </div>

        {/* Save All */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            className="btn accent"
            onClick={handleSave}
            disabled={saving || isInvalid}
            style={{ opacity: saving || isInvalid ? 0.6 : 1 }}
          >
            <Save size={14} style={{ marginRight: 6 }} />
            {saving ? 'Saving…' : isInvalid ? 'Fix Errors to Save' : 'Save All'}
          </button>
        </div>
      </div>
    </div>
  );
}
