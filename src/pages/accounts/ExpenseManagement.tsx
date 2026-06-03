import { UserProfile, Expense } from '../../types';
import { generateExpenseAcknowledgement } from '../../lib/expenseReceipt';
import { saveText } from '../../lib/download';
import { getSchoolSettings, getReceiptTypeConfig } from '../../services/settingsService';
import { getNextReceiptNumber } from '../../services/receiptCounterService';
import { Plus, Receipt, TrendingDown, Edit2, FileText, FileDown, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useState, useEffect } from 'react';
import { collection, addDoc, doc, deleteDoc, updateDoc, query, orderBy, getDoc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { logActivity } from '../../services/activityService';
import {
  Modal,
  ConfirmModal,
  FormField,
  Input,
  Select,
  Button,
} from '../../components/ui';

interface ExpenseManagementProps {
  user: UserProfile;
}

const CATEGORIES = ['all', 'utilities', 'maintenance', 'stationery', 'events', 'salary', 'other'];

const CATEGORY_COLORS: Record<string, string> = {
  utilities: 'var(--accent)',
  maintenance: 'var(--leaf)',
  stationery: '#8b5cf6',
  events: '#f59e0b',
  salary: 'var(--coral)',
  other: 'var(--ink-3)',
};

export default function ExpenseManagement({ user }: ExpenseManagementProps) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    category: 'utilities',
    biller: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    status: 'paid' as 'paid' | 'pending',
    description: '',
    phone: '',
    address: '',
    paymentMode: 'cash' as 'cash' | 'bank_transfer' | 'upi' | 'cheque' | 'card' | 'other',
  });

  const fetchExpenses = () => {
    // No-op: expenses are live via onSnapshot.
  };

  useEffect(() => {
    const q = query(collection(db, 'expenses'), orderBy('date', 'desc'));
    const unsub = onSnapshot(q, (snapshot) => {
      setExpenses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'expenses');
    });
    return () => unsub();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = {
        ...formData,
        amount: Number(formData.amount),
      };

      let expenseId: string;
      if (isEditMode && editingExpense) {
        await updateDoc(doc(db, 'expenses', editingExpense.id), data);
        expenseId = editingExpense.id;
        logActivity(
          user,
          'Expense Updated',
          'Accounts',
          `Updated expense "${formData.category}" of ₹${formData.amount}`,
          { expenseId, amount: Number(formData.amount), category: formData.category }
        );
      } else {
        const newRef = await addDoc(collection(db, 'expenses'), data);
        expenseId = newRef.id;
        logActivity(
          user,
          'Expense Created',
          'Accounts',
          `Recorded expense "${formData.category}" of ₹${formData.amount}`,
          { expenseId, amount: Number(formData.amount), category: formData.category }
        );
      }

      if (!isEditMode && data.status === 'paid' && data.phone && data.category !== 'salary') {
        try {
          await fetch('/api/whatsapp/send-template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: data.phone,
              templateName: 'expense_paid_1',
              parameters: [
                data.biller || 'Vendor',
                `₹${Number(data.amount).toLocaleString('en-IN')}`,
                data.description || data.category,
                data.category,
                new Date(data.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
                (data.paymentMode || 'cash').replace(/_/g, ' '),
              ],
            }),
          });
        } catch { /* non-fatal */ }
      }

      setIsModalOpen(false);
      resetForm();
      fetchExpenses();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, isEditMode ? `expenses/${editingExpense?.id}` : 'expenses');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      category: 'utilities',
      biller: '',
      amount: '',
      date: new Date().toISOString().split('T')[0],
      status: 'paid',
      description: '',
      phone: '',
      address: '',
      paymentMode: 'cash',
    });
    setIsEditMode(false);
    setEditingExpense(null);
  };

  const handleEdit = (exp: Expense) => {
    setEditingExpense(exp);
    setIsEditMode(true);
    setFormData({
      category: exp.category,
      biller: exp.biller,
      amount: exp.amount.toString(),
      date: exp.date,
      status: exp.status,
      description: exp.description || '',
      phone: exp.phone || '',
      address: exp.address || '',
      paymentMode: (exp.paymentMode as any) || 'cash',
    });
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
    setIsDeleteModalOpen(true);
  };

  const performDelete = async () => {
    if (!deletingId) return;
    try {
      const expense = expenses.find(e => e.id === deletingId) as any;
      if (expense?.salaryId) {
        try {
          const salaryRef = doc(db, 'salaries', expense.salaryId);
          const salarySnap = await getDoc(salaryRef);
          if (salarySnap.exists()) {
            const salary = salarySnap.data() as any;
            const history: any[] = salary.paymentHistory || [];
            const filteredHistory = expense.salaryPaymentDate
              ? history.filter(h => h.date !== expense.salaryPaymentDate)
              : history.slice(0, -1);
            const newPaid = Math.max(0, (salary.paidAmount || 0) - expense.amount);
            const newBalance = Math.max(0, (salary.netAmount || 0) - newPaid);
            const newStatus = newPaid <= 0 ? 'pending' : (newBalance <= 0 ? 'paid' : 'partially_paid');
            await updateDoc(salaryRef, {
              paidAmount: newPaid,
              balanceAmount: newBalance,
              status: newStatus,
              paymentHistory: filteredHistory,
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `salaries/${expense.salaryId}`);
        }
      }

      await deleteDoc(doc(db, 'expenses', deletingId));
      const deletedExpense = expenses.find(e => e.id === deletingId);
      logActivity(
        user,
        'Expense Deleted',
        'Accounts',
        deletedExpense
          ? `Deleted expense "${deletedExpense.category}" of ₹${deletedExpense.amount}`
          : `Deleted expense ${deletingId}`,
        {
          expenseId: deletingId,
          amount: deletedExpense?.amount,
          category: deletedExpense?.category,
        }
      );
      fetchExpenses();
      setIsDeleteModalOpen(false);
      setDeletingId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `expenses/${deletingId}`);
    }
  };

  const handleDownloadReceipt = async (exp: Expense) => {
    setDownloadingReceiptId(exp.id);
    try {
      let receiptNumber = exp.receiptNumber;
      if (!receiptNumber) {
        const settings = await getSchoolSettings();
        const cfg = getReceiptTypeConfig(settings, 'expenseReceipt');
        receiptNumber = await getNextReceiptNumber('expense', cfg.prefix, cfg.startFrom);
        await updateDoc(doc(db, 'expenses', exp.id), { receiptNumber });
        setExpenses(prev => prev.map(e => e.id === exp.id ? { ...e, receiptNumber } : e));
      }
      await generateExpenseAcknowledgement(exp, receiptNumber);
    } catch { /* ignore */ }
    setDownloadingReceiptId(null);
  };

  const handleDownloadCSV = async () => {
    const headers = ['Date', 'Category', 'Biller', 'Description', 'Mode', 'Status', 'Amount', 'Phone', 'Address'];
    const rows = filteredExpenses.map(e => [
      e.date,
      e.category,
      `"${(e.biller || '').replace(/"/g, '""')}"`,
      `"${(e.description || '').replace(/"/g, '""')}"`,
      (e.paymentMode || '').replace(/_/g, ' '),
      e.status,
      e.amount,
      e.phone || '',
      `"${(e.address || '').replace(/"/g, '""')}"`,
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    await saveText(csv, `expenses_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const filteredExpenses = expenses.filter(e => {
    const matchesSearch =
      e.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.biller.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCat = categoryFilter === 'all' || e.category === categoryFilter;
    return matchesSearch && matchesCat;
  });

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const filteredTotal = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <>
      <div className="pad stack" style={{ gap: 'var(--space-5)' }}>
        {/* Topbar */}
        <div className="topbar">
          <div>
            <div className="eyebrow">
              Total ₹{totalExpenses.toLocaleString('en-IN')}
            </div>
            <h1>Expenses</h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost icon-btn" onClick={handleDownloadCSV} title="Export CSV">
              <FileDown style={{ width: 16, height: 16 }} />
            </button>
            <button className="btn accent" onClick={() => { resetForm(); setIsModalOpen(true); }}>
              <Plus style={{ width: 14, height: 14 }} />
              Add Expense
            </button>
          </div>
        </div>

        {/* Category filter chips */}
        <div className="hscroll" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={cn('chip', categoryFilter === c ? 'solid' : '')}
              style={{
                cursor: 'pointer',
                ...(c !== 'all' && categoryFilter === c ? { background: CATEGORY_COLORS[c] || 'var(--accent)' } : {}),
              }}
            >
              {c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search category or biller..."
          style={{
            width: '100%', height: 40, border: '1px solid var(--line)', borderRadius: 10,
            padding: '0 14px', fontSize: 13, outline: 'none',
            background: 'var(--cream-2)', color: 'var(--ink)', boxSizing: 'border-box',
          }}
        />

        {/* Expense cards */}
        {filteredExpenses.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <Receipt style={{ width: 36, height: 36, margin: '0 auto 8px', color: 'var(--line)' }} />
            <p className="muted">No expenses found</p>
            <p className="tiny muted">Add your first expense to get started</p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            {filteredExpenses.map(exp => (
              <div key={exp.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* Category chip + info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span
                      className="chip"
                      style={{
                        fontSize: 11,
                        background: CATEGORY_COLORS[exp.category] ? `color-mix(in srgb, ${CATEGORY_COLORS[exp.category]} 15%, transparent)` : 'var(--cream-2)',
                        color: CATEGORY_COLORS[exp.category] || 'var(--ink)',
                        border: `1px solid ${CATEGORY_COLORS[exp.category] ? `color-mix(in srgb, ${CATEGORY_COLORS[exp.category]} 30%, transparent)` : 'var(--line)'}`,
                      }}
                    >
                      {exp.category}
                    </span>
                    <span className={cn('chip', '')} style={{
                      fontSize: 11,
                      background: exp.status === 'paid' ? 'color-mix(in srgb, var(--leaf) 15%, transparent)' : '#fef3c7',
                      color: exp.status === 'paid' ? 'var(--leaf)' : '#92400e',
                    }}>
                      {exp.status}
                    </span>
                  </div>
                  <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)', marginBottom: 2 }}>{exp.biller}</p>
                  {exp.description && <p className="tiny muted">{exp.description}</p>}
                </div>
                {/* Amount + date */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p className="t-num" style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
                    ₹{(exp.amount || 0).toLocaleString('en-IN')}
                  </p>
                  <p className="mono tiny muted">
                    {new Date(exp.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                  </p>
                </div>
                {/* Actions */}
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button
                    onClick={() => handleDownloadReceipt(exp)}
                    disabled={downloadingReceiptId === exp.id}
                    className="icon-btn"
                    title="Download receipt"
                  >
                    <FileText style={{ width: 15, height: 15 }} />
                  </button>
                  <button
                    onClick={() => handleEdit(exp)}
                    className="icon-btn"
                    title="Edit"
                  >
                    <Edit2 style={{ width: 15, height: 15 }} />
                  </button>
                  <button
                    onClick={() => handleDelete(exp.id)}
                    className="icon-btn"
                    style={{ color: 'var(--coral)' }}
                    title="Delete"
                  >
                    <Trash2 style={{ width: 15, height: 15 }} />
                  </button>
                </div>
              </div>
            ))}

            {/* Total row */}
            <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--ink)', color: 'var(--cream)' }}>
              <p style={{ fontWeight: 600, fontSize: 13 }}>
                {categoryFilter === 'all' ? 'All Expenses' : `${categoryFilter} total`} ({filteredExpenses.length} items)
              </p>
              <p className="t-num" style={{ fontSize: 18, fontWeight: 800 }}>
                ₹{filteredTotal.toLocaleString('en-IN')}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={performDelete}
        title="Delete Expense?"
        message="This action cannot be undone. This expense record will be permanently removed."
        confirmLabel="Delete"
      />

      {/* Add/Edit Expense Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); resetForm(); }}
        title={isEditMode ? 'Edit Expense' : 'Add Expense'}
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); resetForm(); }}>Cancel</Button>
            <Button variant="danger" loading={loading} onClick={(e: any) => {
              const form = document.querySelector('form[data-expense-form]') as HTMLFormElement;
              if (form) form.requestSubmit();
            }}>
              {isEditMode ? 'Update Expense' : 'Add Expense'}
            </Button>
          </div>
        }
      >
        <form onSubmit={handleSubmit} data-expense-form className="space-y-5">
          <FormField label="Expense Category" required>
            <Select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            >
              <option value="utilities">Utilities</option>
              <option value="maintenance">Maintenance</option>
              <option value="stationery">Stationery</option>
              <option value="events">Events</option>
              <option value="salary">Salary</option>
              <option value="other">Other</option>
            </Select>
          </FormField>
          <FormField label="Biller/Vendor" required>
            <Input
              type="text"
              required
              value={formData.biller}
              onChange={(e) => setFormData({ ...formData, biller: e.target.value })}
            />
          </FormField>
          <FormField label="What was this paid for?" required>
            <Input
              type="text"
              required
              placeholder="e.g. May electricity bill, 50 reams of A4 paper, AC servicing"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Amount (₹)" required>
              <Input
                type="number"
                required
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
              />
            </FormField>
            <FormField label="Date" required>
              <Input
                type="date"
                required
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="Status">
            <div className="flex gap-4">
              {['paid', 'pending'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFormData({ ...formData, status: s as any })}
                  className={cn(
                    "flex-1 py-2 rounded-xl text-xs font-bold uppercase transition-all border-2",
                    formData.status === s
                      ? "bg-red-600 border-red-600 text-white"
                      : "bg-white border-slate-100 text-slate-400 hover:border-red-200"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </FormField>
          <FormField label="Mode of Payment">
            <Select
              value={formData.paymentMode}
              onChange={(e) => setFormData({ ...formData, paymentMode: e.target.value as any })}
            >
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="upi">UPI</option>
              <option value="cheque">Cheque</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </Select>
          </FormField>
          <FormField label="Vendor Phone (for WhatsApp confirmation)">
            <Input
              type="tel"
              placeholder="10-digit mobile number"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </FormField>
          <FormField label="Vendor Address">
            <Input
              type="text"
              placeholder="Full address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </FormField>
        </form>
      </Modal>
    </>
  );
}
