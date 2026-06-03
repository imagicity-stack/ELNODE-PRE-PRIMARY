import { jsPDF } from 'jspdf';
import { Expense } from '../types';
import { savePdf } from './download';

const EMERALD: [number, number, number] = [5, 150, 105];
const DARK: [number, number, number] = [15, 23, 42];
const SLATE: [number, number, number] = [100, 116, 139];
const LIGHT: [number, number, number] = [248, 250, 252];
const WHITE: [number, number, number] = [255, 255, 255];
const BORDER: [number, number, number] = [203, 213, 225];

let cachedLogo: string | null = null;
async function getLogoBase64(): Promise<string | null> {
  if (cachedLogo !== null) return cachedLogo || null;
  try {
    const res = await fetch('/logo high res tp-01.png');
    if (!res.ok) { cachedLogo = ''; return null; }
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => { cachedLogo = reader.result as string; resolve(cachedLogo); };
      reader.onerror = () => { cachedLogo = ''; resolve(null); };
      reader.readAsDataURL(blob);
    });
  } catch {
    cachedLogo = '';
    return null;
  }
}

export async function generateExpenseAcknowledgement(expense: Expense, receiptNumber?: string): Promise<void> {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;

  const logo = await getLogoBase64();

  // ── Header ──────────────────────────────────────────────────────────────
  doc.setFillColor(...LIGHT);
  doc.rect(0, 0, pageWidth, 40, 'F');

  if (logo) {
    try { doc.addImage(logo, 'PNG', 12, 7, 22, 22); } catch { /* ignore */ }
  }

  const tx = logo ? 40 : pageWidth / 2;
  const ta = logo ? 'left' : 'center';

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text('The Elden Heights School', tx, 18, { align: ta });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...SLATE);
  doc.text('Excellence · Integrity · Innovation', tx, 25, { align: ta });

  doc.setFillColor(...EMERALD);
  doc.rect(0, 39, pageWidth, 3, 'F');

  // ── Title ────────────────────────────────────────────────────────────────
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text('EXPENSE ACKNOWLEDGEMENT RECEIPT', pageWidth / 2, 54, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...SLATE);
  doc.text('This document serves as acknowledgement of payment made by The Elden Heights School.', pageWidth / 2, 61, { align: 'center' });

  // ── Info box ─────────────────────────────────────────────────────────────
  let y = 72;
  const boxW = pageWidth - 24;

  const infoFields: [string, string][] = [
    ['Receipt Date', new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })],
    ['Receipt No.', receiptNumber || expense.receiptNumber || `EXP-${expense.id?.slice(-8).toUpperCase() || Date.now().toString().slice(-8)}`],
    ['Payment Date', expense.date ? new Date(expense.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '-'],
    ['Category', expense.category ? expense.category.charAt(0).toUpperCase() + expense.category.slice(1) : '-'],
    ['Mode of Payment', expense.paymentMode ? expense.paymentMode.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Cash'],
    ['Status', expense.status?.toUpperCase() || 'PAID'],
  ];

  doc.setFillColor(...LIGHT);
  doc.roundedRect(12, y, boxW, 48, 2, 2, 'F');

  const colW = boxW / 2;
  infoFields.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const fx = 18 + col * colW;
    const fy = y + 10 + row * 14;

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...SLATE);
    doc.text(label + ':', fx, fy);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...DARK);
    doc.text(value, fx + 38, fy);
  });

  y += 54;

  // ── Vendor details ───────────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text('VENDOR / BILLER DETAILS', 14, y + 8);

  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.roundedRect(12, y + 11, boxW, 30, 2, 2, 'S');

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(expense.biller || 'Vendor', 18, y + 21);

  if (expense.phone) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...SLATE);
    doc.text(`Phone: ${expense.phone}`, 18, y + 29);
  }
  if (expense.address) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...SLATE);
    const addr = doc.splitTextToSize(`Address: ${expense.address}`, boxW - 16);
    doc.text(addr, 18, expense.phone ? y + 37 : y + 29);
  }

  y += 48;

  // ── Amount box ───────────────────────────────────────────────────────────
  doc.setFillColor(...EMERALD);
  doc.roundedRect(12, y, boxW, 28, 2, 2, 'F');

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...WHITE);
  doc.text('TOTAL AMOUNT PAID', pageWidth / 2, y + 10, { align: 'center' });

  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(`Rs. ${(expense.amount || 0).toLocaleString('en-IN')}`, pageWidth / 2, y + 22, { align: 'center' });

  y += 34;

  // ── Purpose ──────────────────────────────────────────────────────────────
  if (expense.description) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...DARK);
    doc.text('PURPOSE / DESCRIPTION', 14, y + 8);

    doc.setFillColor(...LIGHT);
    doc.roundedRect(12, y + 11, boxW, 18, 2, 2, 'F');

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...DARK);
    const descLines = doc.splitTextToSize(expense.description, boxW - 16);
    doc.text(descLines, 18, y + 20);
    y += 34;
  }

  y += 6;

  // ── Signature section ────────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text('VENDOR ACKNOWLEDGEMENT', 14, y);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...SLATE);
  doc.text('Please sign below to confirm receipt of the above payment and return to the school accounts office.', 14, y + 7);

  y += 14;

  // Two signature boxes side by side
  const halfW = (boxW - 8) / 2;

  // Left: vendor signature
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.roundedRect(12, y, halfW, 44, 2, 2, 'S');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...SLATE);
  doc.text('Vendor Signature', 12 + halfW / 2, y + 6, { align: 'center' });

  // Signature line
  doc.setDrawColor(...SLATE);
  doc.setLineWidth(0.5);
  doc.line(22, y + 34, 12 + halfW - 10, y + 34);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...SLATE);
  doc.text('Sign here', 12 + halfW / 2, y + 40, { align: 'center' });

  // Right: date + stamp
  const rx = 12 + halfW + 8;
  doc.roundedRect(rx, y, halfW, 44, 2, 2, 'S');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...SLATE);
  doc.text('Date & Stamp', rx + halfW / 2, y + 6, { align: 'center' });

  doc.setDrawColor(...SLATE);
  doc.setLineWidth(0.5);
  doc.line(rx + 10, y + 34, rx + halfW - 10, y + 34);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...SLATE);
  doc.text('Date / Stamp', rx + halfW / 2, y + 40, { align: 'center' });

  y += 50;

  // Received by (school accounts)
  doc.setFillColor(...LIGHT);
  doc.roundedRect(12, y, boxW, 22, 2, 2, 'F');

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...SLATE);
  doc.text('Received & Verified by (School Accounts):', 18, y + 8);

  doc.setDrawColor(...SLATE);
  doc.setLineWidth(0.5);
  doc.line(18, y + 17, 100, y + 17);

  doc.text('Name / Designation / Date', 120, y + 17);

  // ── Footer ───────────────────────────────────────────────────────────────
  doc.setFillColor(...EMERALD);
  doc.rect(0, pageHeight - 14, pageWidth, 14, 'F');

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...WHITE);
  doc.text('This is a computer-generated payment acknowledgement by The Elden Heights School.', pageWidth / 2, pageHeight - 7, { align: 'center' });
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 12, pageHeight - 7);
  doc.text('EHS Accounts', pageWidth - 12, pageHeight - 7, { align: 'right' });

  const safeBiller = (expense.biller || 'vendor').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  await savePdf(doc, `expense_ack_${safeBiller}_${expense.date || new Date().toISOString().split('T')[0]}.pdf`);
}
