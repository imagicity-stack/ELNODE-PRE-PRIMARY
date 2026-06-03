import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { FeePayment, FeeRequest, Student } from '../types';
import { getSchoolSettings } from '../services/settingsService';
import { fmtMonthYear } from './utils';
import { savePdf } from './download';

const NAVY: [number, number, number] = [26, 45, 80];
const GOLD: [number, number, number] = [180, 145, 45];
const WHITE: [number, number, number] = [255, 255, 255];
const DARK: [number, number, number] = [15, 23, 42];
const LIGHT: [number, number, number] = [245, 248, 252];
const SLATE: [number, number, number] = [100, 116, 139];
const GREEN: [number, number, number] = [5, 150, 105];

function toWords(n: number): string {
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
    'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const h = (num: number): string => {
    if (num === 0) return '';
    if (num < 20) return ones[num] + ' ';
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '') + ' ';
    return ones[Math.floor(num / 100)] + ' Hundred ' + h(num % 100);
  };
  const rupees = Math.floor(n);
  const paise  = Math.round((n - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Zero Rupees Only';
  let out = '';
  if (rupees >= 10000000) out += h(Math.floor(rupees / 10000000)) + 'Crore ';
  if (rupees % 10000000 >= 100000) out += h(Math.floor((rupees % 10000000) / 100000)) + 'Lakh ';
  if (rupees % 100000  >= 1000)    out += h(Math.floor((rupees % 100000) / 1000)) + 'Thousand ';
  out += h(rupees % 1000);
  out = out.trim() + ' Rupees';
  if (paise > 0) out += ' and ' + h(paise).trim() + ' Paise';
  return out + ' Only';
}

// Compress logo via canvas — resize to ≤150px and encode as JPEG to keep PDF size small
async function fetchLogo(): Promise<string | null> {
  try {
    const res = await fetch('/logo high res tp-01.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    const imgURL = URL.createObjectURL(blob);
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const maxSize = 150;
        const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(imgURL);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => { URL.revokeObjectURL(imgURL); resolve(null); };
      img.src = imgURL;
    });
  } catch { return null; }
}

async function fetchClassName(classId: string): Promise<string> {
  try {
    const snap = await getDoc(doc(db, 'classes', classId));
    if (snap.exists()) return (snap.data().name as string) || classId;
  } catch { /* fallback */ }
  return classId;
}

async function fetchHouseName(houseId?: string): Promise<string> {
  if (!houseId) return '-';
  try {
    const snap = await getDoc(doc(db, 'houses', houseId));
    if (snap.exists()) return (snap.data().name as string) || '-';
  } catch { /* fallback */ }
  return '-';
}

export const generateFeeReceipt = async (
  payment: FeePayment,
  request: FeeRequest,
  student: Student,
): Promise<void> => {
  const [logo, className, houseName, schoolSettings] = await Promise.all([
    fetchLogo(),
    fetchClassName(student.classId),
    fetchHouseName(student.houseId),
    getSchoolSettings(),
  ]);
  const academicYear = schoolSettings.academicYear || '2026-27';

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const PW = doc.internal.pageSize.width;
  const PH = doc.internal.pageSize.height;
  const ML = 12, MR = 12;
  const CW = PW - ML - MR;

  // ── HEADER ──────────────────────────────────────────────────────────────────
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.8); doc.line(ML, 8, PW - MR, 8);
  doc.setLineWidth(0.2); doc.line(ML, 10, PW - MR, 10);

  // Logo (top-left)
  if (logo) {
    try { doc.addImage(logo, 'JPEG', ML, 13, 22, 22); } catch { /* skip */ }
  } else {
    doc.setFillColor(...NAVY);
    doc.roundedRect(ML, 13, 22, 22, 2, 2, 'F');
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...WHITE);
    doc.text('EH', ML + 11, 26, { align: 'center' });
  }

  // "FEE RECEIPT" label top-right — no border box
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...NAVY);
  doc.text('FEE RECEIPT', PW - MR, 19, { align: 'right' });
  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...SLATE);
  doc.text('OFFICIAL DOCUMENT', PW - MR, 24, { align: 'right' });

  // School name
  doc.setFontSize(17); doc.setFont('helvetica', 'bold'); doc.setTextColor(...NAVY);
  doc.text('THE ELDEN HEIGHTS SCHOOL', PW / 2, 19, { align: 'center' });

  // Tagline
  doc.setFontSize(8); doc.setFont('helvetica', 'italic'); doc.setTextColor(...GOLD);
  doc.text('Towards Eternal Glory', PW / 2, 25, { align: 'center' });

  // Address
  doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...SLATE);
  doc.text(
    'Hazaribagh, Jharkhand · 825301   ·   +91 9431904333 / 9288483677   ·   contact@eldenheights.org   ·   eldenheights.org',
    PW / 2, 31, { align: 'center' },
  );

  // Double bottom rule
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.2); doc.line(ML, 35, PW - MR, 35);
  doc.setLineWidth(0.8); doc.line(ML, 37, PW - MR, 37);

  // ── TITLE ───────────────────────────────────────────────────────────────────
  let y = 46;
  const titleText = 'OFFICIAL FEE RECEIPT';
  const titleW = doc.getTextWidth(titleText) * (13 / 10);
  const titleX = PW / 2;

  doc.setDrawColor(...NAVY); doc.setLineWidth(0.4);
  doc.line(ML, y + 0.5, titleX - titleW / 2 - 4, y + 0.5);
  doc.line(titleX + titleW / 2 + 4, y + 0.5, PW - MR, y + 0.5);

  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK);
  doc.text(titleText, PW / 2, y, { align: 'center' });

  y += 5;
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...SLATE);
  doc.text(`ACADEMIC SESSION ${academicYear}`, PW / 2, y, { align: 'center' });
  y += 6;

  // ── RECEIPT META — 3 boxes ───────────────────────────────────────────────────
  const boxW = (CW - 4) / 3;
  const metaFields = [
    { label: 'RECEIPT NO.',    value: payment.receiptNumber },
    { label: 'DATE OF ISSUE',  value: new Date(payment.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) },
    { label: 'TERM / QUARTER', value: fmtMonthYear(request.month) || '-' },
  ];
  metaFields.forEach((f, i) => {
    const bx = ML + i * (boxW + 2);
    doc.setFillColor(...LIGHT);
    doc.rect(bx, y, boxW, 14, 'F');
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...SLATE);
    doc.text(f.label, bx + 3, y + 5);
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK);
    doc.text(f.value, bx + 3, y + 11);
  });
  y += 18;

  // ── STUDENT PARTICULARS ──────────────────────────────────────────────────────
  const sectionHeader = (label: string) => {
    doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK);
    doc.text(label, ML, y);
    doc.setDrawColor(...SLATE); doc.setLineWidth(0.2);
    doc.line(ML, y + 1.5, PW - MR, y + 1.5);
    y += 6;
  };

  sectionHeader('STUDENT PARTICULARS');

  const half = CW / 2;
  const studentRows: [string, string, string, string][] = [
    ['Student Name',    student.name,                                     'Admission No.',  student.admissionNumber || student.schoolNumber || '-'],
    ['Class & Section', `${className} - ${student.section}`,             "Father's Name",  student.parentDetails?.fatherName || '-'],
    ['Contact No.',     student.parentDetails?.phone || '-',              'Academic Year',  academicYear],
    ['House',           houseName,                                        "Mother's Name",  student.parentDetails?.motherName || '-'],
  ];

  studentRows.forEach(([l1, v1, l2, v2]) => {
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...SLATE);
    doc.text(l1, ML + 2, y);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK);
    doc.text(v1, ML + 38, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...SLATE);
    doc.text(l2, ML + half + 2, y);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK);
    doc.text(v2, ML + half + 38, y);
    y += 6.5;
  });
  y += 2;

  // ── FEE PARTICULARS TABLE ────────────────────────────────────────────────────
  sectionHeader('FEE PARTICULARS');

  const grossTotal    = request.heads.reduce((s, h) => s + (h.amount ?? 0), 0);
  const headDiscounts = request.heads.reduce((s, h) => s + (h.discount ?? 0), 0);
  const netFeeTotal   = request.heads.reduce((s, h) => s + (h.finalAmount ?? h.amount ?? 0), 0);
  const fineWaiver    = request.waivedAmount || 0;
  const netPayable    = Math.max(0, netFeeTotal - fineWaiver);
  // Balance = net payable minus all payments INCLUDING this one
  const totalPaid     = request.paidAmount || 0;
  const balanceDue    = Math.max(0, netPayable - totalPaid);
  const hasDiscount   = headDiscounts > 0;

  // Build table rows — 5 cols when any discount exists, 4 cols otherwise
  const tableRows = request.heads.map((head, i) => {
    const gross    = head.amount ?? 0;
    const disc     = head.discount ?? 0;
    const net      = head.finalAmount ?? gross;
    const rowBase  = [
      String(i + 1).padStart(2, '0'),
      head.name + (head.discountReason && disc > 0 ? `\n  Discount reason: ${head.discountReason}` : ''),
      fmtMonthYear(request.month) || 'Annual',
      gross.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
    ];
    if (hasDiscount) {
      rowBase.push(disc > 0 ? disc.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '—');
      rowBase.push(net.toLocaleString('en-IN', { minimumFractionDigits: 2 }));
      return rowBase;
    }
    rowBase.push(net.toLocaleString('en-IN', { minimumFractionDigits: 2 }));
    return rowBase;
  });

  const colStyles5: any = {
    0: { halign: 'center', cellWidth: 14 },
    2: { halign: 'center', cellWidth: 30 },
    3: { halign: 'right',  cellWidth: 30 },
    4: { halign: 'right',  cellWidth: 28, textColor: [5, 150, 105] },
    5: { halign: 'right',  cellWidth: 34, fontStyle: 'bold' },
  };
  const colStyles4: any = {
    0: { halign: 'center', cellWidth: 16 },
    2: { halign: 'center', cellWidth: 36 },
    3: { halign: 'right',  cellWidth: 40, fontStyle: 'bold' },
  };

  const footRows: any[] = [];
  const pad = hasDiscount ? 4 : 2;

  // Sub-total (gross)
  footRows.push([
    { content: '', colSpan: pad, styles: { fillColor: WHITE as any, lineWidth: 0 } },
    { content: 'Gross Sub Total', styles: { halign: 'right', fontStyle: 'bold', fillColor: LIGHT as any, textColor: DARK as any } },
    { content: `Rs. ${grossTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, styles: { halign: 'right', fontStyle: 'bold', fillColor: LIGHT as any, textColor: DARK as any } },
  ]);

  // Discount row (only if any)
  if (hasDiscount) {
    footRows.push([
      { content: '', colSpan: pad, styles: { fillColor: WHITE as any, lineWidth: 0 } },
      { content: 'Total Discount Applied', styles: { halign: 'right', fillColor: WHITE as any, textColor: [5, 150, 105] as any } },
      { content: `- Rs. ${headDiscounts.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, styles: { halign: 'right', fillColor: WHITE as any, textColor: [5, 150, 105] as any } },
    ]);
    footRows.push([
      { content: '', colSpan: pad, styles: { fillColor: WHITE as any, lineWidth: 0 } },
      { content: 'Net Fee Total', styles: { halign: 'right', fontStyle: 'bold', fillColor: WHITE as any, textColor: DARK as any } },
      { content: `Rs. ${netFeeTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, styles: { halign: 'right', fontStyle: 'bold', fillColor: WHITE as any, textColor: DARK as any } },
    ]);
  }

  // Fine waiver row (only if applicable)
  if (fineWaiver > 0) {
    footRows.push([
      { content: '', colSpan: pad, styles: { fillColor: WHITE as any, lineWidth: 0 } },
      { content: 'Fine Waiver', styles: { halign: 'right', fillColor: WHITE as any, textColor: SLATE as any } },
      { content: `- Rs. ${fineWaiver.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, styles: { halign: 'right', fillColor: WHITE as any, textColor: SLATE as any } },
    ]);
  }

  // Amount paid this receipt
  footRows.push([
    { content: 'AMOUNT PAID (THIS RECEIPT)', colSpan: hasDiscount ? 5 : 3, styles: { fontStyle: 'bold', halign: 'right', fillColor: NAVY as any, textColor: WHITE as any, fontSize: 10 } },
    { content: `Rs. ${payment.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, styles: { fontStyle: 'bold', halign: 'right', fillColor: NAVY as any, textColor: WHITE as any, fontSize: 10 } },
  ]);

  // Balance due (only if unpaid balance remains)
  if (balanceDue > 0.01) {
    footRows.push([
      { content: '', colSpan: pad, styles: { fillColor: WHITE as any, lineWidth: 0 } },
      { content: 'Balance Due', styles: { halign: 'right', fillColor: WHITE as any, textColor: [220, 38, 38] as any, fontStyle: 'bold' } },
      { content: `Rs. ${balanceDue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, styles: { halign: 'right', fillColor: WHITE as any, textColor: [220, 38, 38] as any, fontStyle: 'bold' } },
    ]);
  }

  const tableHead = hasDiscount
    ? [['S.NO.', 'PARTICULARS', 'PERIOD', 'GROSS AMT', 'DISCOUNT', 'NET AMT (INR)']]
    : [['S.NO.', 'PARTICULARS', 'PERIOD', 'AMOUNT (INR)']];

  autoTable(doc, {
    startY: y,
    head: tableHead,
    body: tableRows,
    foot: footRows,
    headStyles: { fillColor: NAVY as any, textColor: WHITE as any, fontStyle: 'bold', fontSize: 8, cellPadding: 3.5 },
    bodyStyles: { fontSize: 8.5, cellPadding: 3 },
    alternateRowStyles: { fillColor: LIGHT as any },
    footStyles: { fontSize: 8.5, cellPadding: 3 },
    columnStyles: hasDiscount ? colStyles5 : colStyles4,
    theme: 'grid',
    tableLineColor: [200, 210, 225] as any,
    tableLineWidth: 0.15,
    margin: { left: ML, right: MR },
  });

  y = (doc as any).lastAutoTable.finalY + 5;

  // ── AMOUNT IN WORDS (uses amount actually paid in this receipt) ──────────────
  doc.setFillColor(...LIGHT);
  doc.rect(ML, y, CW, 16, 'F');
  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...SLATE);
  doc.text('AMOUNT RECEIVED (IN WORDS)', ML + 3, y + 5.5);
  doc.setFontSize(9.5); doc.setFont('helvetica', 'bolditalic'); doc.setTextColor(...DARK);
  doc.text(toWords(payment.amount), ML + 3, y + 12);
  y += 20;

  // ── PAYMENT INFORMATION ──────────────────────────────────────────────────────
  sectionHeader('PAYMENT INFORMATION');

  const payRows: [string, string, boolean?][] = [
    ['Payment Mode',   payment.method.toUpperCase().replace(/_/g, ' / ')],
    ['Transaction ID', payment.transactionId || (payment as any).referenceNumber || 'N/A'],
    ['Status',         'PAID & VERIFIED', true],
    ['Received By',    'Accounts Department'],
  ];
  const payStartY = y;
  payRows.forEach(([label, value, green], i) => {
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...SLATE);
    doc.text(label, ML + 2, y + i * 7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(green ? GREEN : DARK));
    doc.text(value, ML + 40, y + i * 7);
  });

  // Authorised Signatory box
  const sigX = PW - MR - 60, sigY = payStartY - 3, sigH = 32;
  doc.setDrawColor(...SLATE); doc.setLineWidth(0.3);
  doc.rect(sigX, sigY, 60, sigH);
  doc.line(sigX, sigY + sigH - 10, sigX + 60, sigY + sigH - 10);
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK);
  doc.text('AUTHORISED SIGNATORY', sigX + 30, sigY + 16, { align: 'center' });
  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...SLATE);
  doc.text('Accounts & Finance Office', sigX + 30, sigY + 27, { align: 'center' });

  y = payStartY + payRows.length * 7 + 4;

  // ── IMPORTANT NOTES ──────────────────────────────────────────────────────────
  doc.setDrawColor(...SLATE); doc.setLineWidth(0.25);
  const noteText = "This receipt is computer-generated and valid without a physical signature. Please retain this receipt for the entire academic session. Fees once paid are non-refundable except as per the school's official refund policy. For any discrepancy, contact the Accounts Office within 7 working days at accounts@eldenheights.org.";
  const noteLines = doc.splitTextToSize(noteText, CW - 8);
  const noteH = noteLines.length * 4.2 + 12;
  doc.rect(ML, y, CW, noteH);
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK);
  doc.text('IMPORTANT NOTES', ML + 4, y + 6);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...SLATE); doc.setFontSize(7);
  doc.text(noteLines, ML + 4, y + 11.5);
  y += noteH + 4;

  // ── FOOTER ───────────────────────────────────────────────────────────────────
  const footY = PH - 14;
  doc.setDrawColor(...NAVY); doc.setLineWidth(0.2); doc.line(ML, footY - 2, PW - MR, footY - 2);
  doc.setLineWidth(0.6); doc.line(ML, footY, PW - MR, footY);

  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...NAVY);
  doc.text('EHS  ·  THE ELDEN HEIGHTS SCHOOL', ML, footY + 4);

  doc.setFont('helvetica', 'italic'); doc.setTextColor(...GOLD);
  doc.text('Thank you for being part of our legacy', PW / 2, footY + 4, { align: 'center' });

  doc.setFont('helvetica', 'normal'); doc.setTextColor(...SLATE);
  doc.text('Page 1 of 1  ·  System Generated', PW - MR, footY + 4, { align: 'right' });

  // Trust line
  doc.setFontSize(6.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(...SLATE);
  doc.text('A unit of Bhagwati Educational And Charitable Trust', PW / 2, footY + 9, { align: 'center' });

  await savePdf(doc, `Receipt_${payment.receiptNumber}.pdf`);
};
