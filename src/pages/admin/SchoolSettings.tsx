import React, { useState, useEffect } from 'react';
import { Save, RotateCw, AlertTriangle, Database } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { UserProfile } from '../../types';
import { getSchoolSettings, saveSchoolSettings, SchoolSettings, ReceiptTypeConfig, getReceiptTypeConfig } from '../../services/settingsService';
import { useToast } from '../../components/Toast';
import { FormField, Input } from '../../components/ui';
import { logActivity } from '../../services/activityService';
import { migrateLegacyResults } from '../../services/examService';

const YEAR_REGEX = /^\d{4}-\d{2}$/;

type CounterKey = 'fee' | 'advance' | 'expense' | 'salary';
type ReceiptType = keyof NonNullable<SchoolSettings['receiptConfig']>;

const RECEIPT_TYPES: { key: ReceiptType; counterId: CounterKey; label: string }[] = [
  { key: 'feeReceipt',     counterId: 'fee',     label: 'Fee Receipt'     },
  { key: 'advanceReceipt', counterId: 'advance',  label: 'Advance Receipt' },
  { key: 'expenseReceipt', counterId: 'expense',  label: 'Expense Receipt' },
  { key: 'salarySlip',     counterId: 'salary',   label: 'Salary Slip'     },
];

export default function SchoolSettings({ user }: { user: UserProfile }) {
  const [settings, setSettings] = useState<SchoolSettings>({ academicYear: '2026-27' });
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrationReport, setMigrationReport] = useState<{ copied: number; skipped: number } | null>(null);
  const [counters, setCounters] = useState<Record<CounterKey, number>>({ fee: 0, advance: 0, expense: 0, salary: 0 });
  const { showToast } = useToast();

  const isSuperAdmin = user.role === 'super_admin';

  const handleMigrateResults = async () => {
    if (migrating) return;
    const ok = window.confirm(
      'Copy any orphaned exam results from the legacy "results" collection into "examResults"?\n\n' +
      'This is safe to run repeatedly — existing canonical records will not be overwritten.',
    );
    if (!ok) return;
    setMigrating(true);
    setMigrationReport(null);
    try {
      const report = await migrateLegacyResults();
      setMigrationReport(report);
      await logActivity(user, 'Legacy Results Migrated', 'Super Admin',
        `Copied ${report.copied} legacy result(s), skipped ${report.skipped}`);
      showToast(`Migrated ${report.copied} result(s) (${report.skipped} skipped)`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Migration failed', 'error');
    } finally {
      setMigrating(false);
    }
  };

  useEffect(() => {
    const loadAll = async () => {
      const [s, fee, advance, expense, salary] = await Promise.all([
        getSchoolSettings(),
        getDoc(doc(db, 'counters', 'fee')),
        getDoc(doc(db, 'counters', 'advance')),
        getDoc(doc(db, 'counters', 'expense')),
        getDoc(doc(db, 'counters', 'salary')),
      ]);
      setSettings(s);
      setCounters({
        fee:     fee.exists()     ? (fee.data()?.lastNumber     || 0) : 0,
        advance: advance.exists() ? (advance.data()?.lastNumber || 0) : 0,
        expense: expense.exists() ? (expense.data()?.lastNumber || 0) : 0,
        salary:  salary.exists()  ? (salary.data()?.lastNumber  || 0) : 0,
      });
    };
    loadAll()
      .catch(() => showToast('Failed to load settings', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const set = (field: keyof SchoolSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSettings(prev => ({ ...prev, [field]: e.target.value }));

  const setReceiptField = (
    type: ReceiptType,
    field: keyof ReceiptTypeConfig,
    value: string | number,
  ) => setSettings(prev => {
    const current = getReceiptTypeConfig(prev, type);
    return {
      ...prev,
      receiptConfig: {
        feeReceipt:     getReceiptTypeConfig(prev, 'feeReceipt'),
        advanceReceipt: getReceiptTypeConfig(prev, 'advanceReceipt'),
        expenseReceipt: getReceiptTypeConfig(prev, 'expenseReceipt'),
        salarySlip:     getReceiptTypeConfig(prev, 'salarySlip'),
        [type]: { ...current, [field]: value },
      },
    };
  });

  // Each section saves the full settings doc (Firestore merge), but validates only
  // its own fields and shows its own spinner — so sections save independently.
  const persistSection = async (
    section: string,
    label: string,
    validate?: () => string | null,
  ) => {
    if (validate) {
      const err = validate();
      if (err) { showToast(err, 'error'); return; }
    }
    setSavingSection(section);
    try {
      await saveSchoolSettings({ ...settings, updatedBy: user.uid });
      await logActivity(user, 'School Settings Updated', 'Super Admin', `${label} updated`, { section });
      showToast(`${label} saved`, 'success');
    } catch {
      showToast(`Failed to save ${label.toLowerCase()}`, 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const validateAcademic = () =>
    YEAR_REGEX.test(settings.academicYear)
      ? null
      : 'Academic year must be in format YYYY-YY (e.g. 2026-27)';

  const validateFeeSettings = () =>
    settings.defaultFeeDueDay != null && (settings.defaultFeeDueDay < 1 || settings.defaultFeeDueDay > 28)
      ? 'Default fee due day must be between 1 and 28'
      : null;

  // Small reusable save button rendered inside each section header.
  const SectionSave = ({ section, label, validate }: { section: string; label: string; validate?: () => string | null }) => (
    <button
      className="btn accent"
      onClick={() => persistSection(section, label, validate)}
      disabled={savingSection !== null}
      style={{ opacity: savingSection !== null && savingSection !== section ? 0.5 : 1, padding: '6px 14px', fontSize: 13 }}
    >
      <Save size={14} />
      {savingSection === section ? 'Saving…' : 'Save'}
    </button>
  );

  if (loading) {
    return (
      <div className="pad stack" style={{ gap: 16 }}>
        <div style={{ height: 32, width: 192, background: 'var(--cream-2)', borderRadius: 8 }} />
        <div style={{ height: 160, background: 'var(--cream-2)', borderRadius: 16 }} />
      </div>
    );
  }

  return (
    <div className="pad stack" style={{ gap: 24, maxWidth: 680 }}>
      <div className="topbar">
        <div>
          <div className="eyebrow">{user.role.replace('_', ' ')}</div>
          <h1>School Settings</h1>
        </div>
      </div>

      {/* Academic */}
      <div className="card stack" style={{ gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="eyebrow">Academic</div>
          <SectionSave section="academic" label="Academic Settings" validate={validateAcademic} />
        </div>
        <FormField
          label="Current Academic Year"
          hint="Format: YYYY-YY (e.g. 2026-27). Appears on fee receipts, reports and all portals."
        >
          <Input
            value={settings.academicYear}
            onChange={set('academicYear')}
            placeholder="2026-27"
            className="mono"
            style={{ maxWidth: 200 }}
          />
        </FormField>
      </div>

      {/* School Information */}
      <div className="card stack" style={{ gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="eyebrow">School Information</div>
          <SectionSave section="school-info" label="School Information" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <FormField label="School Name">
            <Input value={settings.schoolName || ''} onChange={set('schoolName')} placeholder="The Elden Heights School" />
          </FormField>
          <FormField label="Address">
            <Input value={settings.address || ''} onChange={set('address')} placeholder="Hazaribagh, Jharkhand · 825301" />
          </FormField>
          <FormField label="Phone">
            <Input value={settings.phone || ''} onChange={set('phone')} placeholder="9431904333 / 9288483677" />
          </FormField>
          <FormField label="Website">
            <Input value={settings.website || ''} onChange={set('website')} placeholder="eldenheights.org" />
          </FormField>
          <FormField label="Email">
            <Input value={settings.email || ''} onChange={set('email')} placeholder="contact@eldenheights.org" />
          </FormField>
        </div>
      </div>

      {/* Receipt Numbering */}
      <div className="card stack" style={{ gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div className="eyebrow">Receipt Numbering</div>
            <p className="muted tiny" style={{ marginTop: 4 }}>
              Each receipt type has its own prefix and counter.
              "Start from" only takes effect before any receipt of that type has been generated.
            </p>
          </div>
          <SectionSave section="receipts" label="Receipt Numbering" />
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 110px 130px', gap: '8px 16px', alignItems: 'center' }}>
          <span className="muted tiny" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Type</span>
          <span className="muted tiny" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Prefix</span>
          <span className="muted tiny" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Start From</span>
          <span className="muted tiny" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Last Generated</span>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', marginTop: -8 }} />

        {RECEIPT_TYPES.map(({ key, counterId, label }) => {
          const cfg = getReceiptTypeConfig(settings, key);
          const last = counters[counterId];
          const nextPreview = last > 0
            ? `${cfg.prefix}${String(last + 1).padStart(4, '0')}`
            : `${cfg.prefix}${String(cfg.startFrom).padStart(4, '0')}`;
          return (
            <div
              key={key}
              style={{ display: 'grid', gridTemplateColumns: '1fr 140px 110px 130px', gap: '8px 16px', alignItems: 'center' }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
              <Input
                value={cfg.prefix}
                onChange={e => setReceiptField(key, 'prefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="EHSREC"
                className="mono"
                style={{ fontSize: 13 }}
              />
              <Input
                type="number"
                min={1}
                value={cfg.startFrom}
                onChange={e => setReceiptField(key, 'startFrom', Math.max(1, Number(e.target.value)))}
                className="mono"
                style={{ fontSize: 13 }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {last > 0 ? (
                  <>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--ink)' }}>
                      {cfg.prefix}{String(last).padStart(4, '0')}
                    </span>
                    <span className="muted tiny">next: {nextPreview}</span>
                  </>
                ) : (
                  <span className="muted tiny">none yet → {nextPreview}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Fee Settings */}
      <div className="card stack" style={{ gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="eyebrow">Fee Settings</div>
          <SectionSave section="fee" label="Fee Settings" validate={validateFeeSettings} />
        </div>
        <FormField
          label="Default Fee Due Day"
          hint="Day of the following month that new fee requests default to. Range 1–28. Accountant can still override per request."
        >
          <Input
            type="number"
            min={1}
            max={28}
            value={settings.defaultFeeDueDay ?? 10}
            onChange={(e) => setSettings(prev => ({ ...prev, defaultFeeDueDay: Number(e.target.value) }))}
            className="mono"
            style={{ maxWidth: 120 }}
          />
        </FormField>
      </div>

      {/* Migration — super_admin only */}
      {isSuperAdmin && (
        <div className="card stack" style={{ gap: 16, borderColor: 'var(--coral)', background: 'rgba(239,68,68,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Database size={15} style={{ color: 'var(--coral)' }} />
            <div className="eyebrow" style={{ color: 'var(--coral)' }}>Maintenance</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <AlertTriangle size={16} style={{ color: 'var(--coral)', flexShrink: 0, marginTop: 2 }} />
            <div className="stack" style={{ gap: 4, flex: 1 }}>
              <p style={{ fontWeight: 700, fontSize: 14 }}>Migrate Legacy Exam Results</p>
              <p className="muted tiny">
                A pre-fix version of the marks-entry page wrote to a <code style={{ background: 'var(--cream-2)', padding: '1px 4px', borderRadius: 4 }}>results</code> collection
                instead of <code style={{ background: 'var(--cream-2)', padding: '1px 4px', borderRadius: 4 }}>examResults</code>. This tool copies any orphaned rows over. Safe to run repeatedly — existing records are preserved.
              </p>
            </div>
          </div>

          {migrationReport && (
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.3)', fontSize: 13, color: 'var(--leaf)' }}>
              <strong>Migration complete:</strong> {migrationReport.copied} record(s) copied, {migrationReport.skipped} skipped.
            </div>
          )}

          <button
            className="btn ghost"
            onClick={handleMigrateResults}
            disabled={migrating}
            style={{ alignSelf: 'flex-start', borderColor: 'var(--coral)', color: 'var(--coral)' }}
          >
            <RotateCw size={14} style={migrating ? { animation: 'spin 1s linear infinite' } : {}} />
            {migrating ? 'Migrating...' : 'Run Migration'}
          </button>
        </div>
      )}
    </div>
  );
}
