import { differenceInDays, parseISO } from 'date-fns';
import { FineConfig, FeeRequest } from '../types';

/**
 * Calculates the fine for a given invoice based on the current configuration.
 *
 * Formula:
 * 1. daysOverdue = today − dueDate (so the due date itself = day 0,
 *    the day after the due date = day 1)
 * 2. If daysOverdue < 1, fine = 0 (not yet past due date)
 * 3. Find the slab where startDay ≤ daysOverdue ≤ endDay
 * 4. penalty = max(fixedPenalty, totalAmount × percentagePenalty / 100)
 *    if isHigherOf is true, else fixed + percent
 * 5. Add escalation if applicable (open-ended slab only)
 *
 * Note: the legacy gracePeriodDays field is ignored — fines now start
 * on day 1 (the day immediately after the due date).
 */
export const calculateFine = (invoice: FeeRequest, config: FineConfig, today: Date = new Date()): number => {
  if (!config.isEnabled) return 0;

  // Already-paid requests never accrue fresh fines. Critical for advance
  // payments: when a fee request is generated for a month that was paid
  // ahead, status flips to 'paid' on creation and no penalty should apply
  // even if the dueDate later passes or the request was generated late.
  if (invoice.status === 'paid') return 0;

  const dueDate = parseISO(invoice.dueDate);
  const daysOverdue = differenceInDays(today, dueDate);

  // Fines start on day 1 (the day after the due date)
  if (daysOverdue < 1) return 0;

  // Find applicable slab
  const slab = config.slabs.find(s => {
    const isAfterStart = daysOverdue >= s.startDay;
    const isBeforeEnd = s.endDay ? daysOverdue <= s.endDay : true;
    return isAfterStart && isBeforeEnd;
  });
  
  if (!slab) return 0;
  
  const netAmount = invoice.totalAmount - (invoice.waivedAmount || 0);
  let fixed = slab.fixedPenalty;
  let percent = (netAmount * slab.percentagePenalty) / 100;
  
  let penalty = slab.isHigherOf ? Math.max(fixed, percent) : (fixed + percent);
  
  // Optional escalation (e.g. for Beyond 60 days)
  if (slab.escalationRate && !slab.endDay) {
    const extraDays = daysOverdue - slab.startDay;
    penalty += extraDays * slab.escalationRate;
  }
  
  return Math.round(penalty);
};

export const getEffectiveTotal = (invoice: FeeRequest, config: FineConfig | null): number => {
  if (!config) return invoice.totalAmount - (invoice.waivedAmount || 0);
  
  // Only calculate dynamic fine if unpaid/overdue
  if (invoice.status === 'paid') {
    return invoice.totalAmount + (invoice.fineAmount || 0) - (invoice.waivedAmount || 0);
  }
  
  const dynamicFine = calculateFine(invoice, config);
  return invoice.totalAmount + dynamicFine - (invoice.waivedAmount || 0);
};
