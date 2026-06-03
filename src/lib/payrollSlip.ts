import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Salary } from '../types';
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
const RED: [number, number, number] = [185, 28, 28];
const BORDER: [number, number, number] = [203, 213, 225];

const INR = (n: number) => `Rs. ${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  if (rupees === 0) return 'Zero Rupees Only';
  let out = '';
  if (rupees >= 10000000) out += h(Math.floor(rupees / 10000000)) + 'Crore ';
  if (rupees % 10000000 >= 100000) out += h(Math.floor((rupees % 10000000) / 100000)) + 'Lakh ';
  if (rupees % 100000 >= 1000) out += h(Math.floor((rupees % 100000) / 1000)) + 'Thousand ';
  out += h(rupees % 1000);
  return out.trim() + ' Rupees Only';
}

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
        canvas.width = Math.round(img.width * ratio);
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

export async function generatePayrollSlip(salary: Salary, displayEmployeeId?: string, slipNumberOverride?: string): Promise<void> {
  const [logo, schoolSettings] = await Promise.all([fetchLogo(), getSchoolSettings()]);
  const academicYear = schoolSettings.academicYear || '2026-27';

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const PW = pdf.internal.pageSize.width;
  const PH = pdf.internal.pageSize.height;
  const ML = 14, MR = 14;
  const CW = PW - ML - MR;

  // ═════════════════════════════════════════════════════════════════════════
  //  HEADER
  // ═════════════════════════════════════════════════════════════════════════
  pdf.setDrawColor(...NAVY);
  pdf.setLineWidth(0.8); pdf.line(ML, 10, PW - MR, 10);
  pdf.setLineWidth(0.2); pdf.line(ML, 12, PW - MR, 12);

  if (logo) {
    try { pdf.addImage(logo, 'JPEG', ML, 15, 20, 20); } catch { /* skip */ }
  }

  pdf.setFontSize(16); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...NAVY);
  pdf.text('THE ELDEN HEIGHTS SCHOOL', PW / 2, 20, { align: 'center' });
  pdf.setFontSize(8); pdf.setFont('helvetica', 'italic'); pdf.setTextColor(...GOLD);
  pdf.text('Towards Eternal Glory', PW / 2, 25, { align: 'center' });
  pdf.setFontSize(6.5); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...SLATE);
  pdf.text('Hazaribagh, Jharkhand 825301  ·  +91 9431904333  ·  contact@eldenheights.org', PW / 2, 30, { align: 'center' });

  pdf.setDrawColor(...NAVY);
  pdf.setLineWidth(0.2); pdf.line(ML, 37, PW - MR, 37);
  pdf.setLineWidth(0.8); pdf.line(ML, 39, PW - MR, 39);

  // ═════════════════════════════════════════════════════════════════════════
  //  TITLE BANNER
  // ═════════════════════════════════════════════════════════════════════════
  const monthLabel = fmtMonthYear(salary.month);

  pdf.setFillColor(...NAVY);
  pdf.rect(ML, 44, CW, 11, 'F');
  pdf.setFontSize(12); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...WHITE);
  pdf.text('SALARY SLIP', ML + 4, 51);
  pdf.setFontSize(9); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...GOLD);
  pdf.text(monthLabel.toUpperCase(), PW - MR - 4, 51, { align: 'right' });

  let y = 60;

  // ═════════════════════════════════════════════════════════════════════════
  //  EMPLOYEE DETAILS — two-column key/value
  // ═════════════════════════════════════════════════════════════════════════
  const slipNo = slipNumberOverride || salary.receiptNumber || `PS-${salary.month.replace('-', '')}-${(salary.id || '').slice(-6).toUpperCase() || Date.now().toString().slice(-6)}`;
  const issueDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const empRows: [string, string, string, string][] = [
    ['Employee Name', salary.employeeName,           'Pay Slip No.',  slipNo],
    ['Designation',   salary.employeeRole || '-',    'Pay Period',    monthLabel],
    ['Employee ID',   (displayEmployeeId || salary.employeeId || '-').slice(0, 14), 'Date of Issue', issueDate],
    ['Academic Year', academicYear,                  'Status',        salary.status.replace('_', ' ').toUpperCase()],
  ];

  pdf.setFillColor(...LIGHT);
  pdf.rect(ML, y, CW, empRows.length * 7 + 4, 'F');
  pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.2);
  pdf.rect(ML, y, CW, empRows.length * 7 + 4);

  const half = CW / 2;
  empRows.forEach(([l1, v1, l2, v2], i) => {
    const ry = y + 6 + i * 7;
    pdf.setFontSize(7.5); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...SLATE);
    pdf.text(l1, ML + 3, ry);
    pdf.text(':', ML + 32, ry);
    pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...DARK);
    pdf.text(v1, ML + 35, ry);

    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...SLATE);
    pdf.text(l2, ML + half + 3, ry);
    pdf.text(':', ML + half + 32, ry);
    pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...DARK);
    pdf.text(v2, ML + half + 35, ry);
  });

  y += empRows.length * 7 + 8;

  // ═════════════════════════════════════════════════════════════════════════
  //  EARNINGS & DEDUCTIONS — side-by-side tables
  // ═════════════════════════════════════════════════════════════════════════
  const earnings: [string, number][] = [
    ['Basic Salary', salary.baseAmount || 0],
    ['Allowances / Bonus', salary.allowances || 0],
  ];
  const totalEarnings = earnings.reduce((s, [, a]) => s + a, 0);

  const deductions: [string, number][] = [
    ['Provident Fund (EPF)', salary.deductions?.pf || 0],
    ['Professional Tax / TDS', salary.deductions?.tax || 0],
    [`Leave Deduction (${salary.deductions?.leaves || 0} days)`, salary.deductions?.leaveDeduction || 0],
    ['Other Deductions', salary.deductions?.other || 0],
    ['Advance Adjustment', (salary.deductions as any)?.advanceAdjusted || 0],
  ];
  const totalDeductions = deductions.reduce((s, [, a]) => s + a, 0);

  const colW = (CW - 4) / 2;
  const tableStartY = y;

  // Left: Earnings
  autoTable(pdf, {
    startY: tableStartY,
    head: [['EARNINGS', 'AMOUNT (INR)']],
    body: earnings.map(([label, amt]) => [label, INR(amt)]),
    foot: [[
      { content: 'GROSS EARNINGS', styles: { fontStyle: 'bold', fillColor: LIGHT as any, textColor: DARK as any } },
      { content: INR(totalEarnings), styles: { fontStyle: 'bold', fillColor: LIGHT as any, textColor: GREEN as any, halign: 'right' } },
    ]],
    headStyles: { fillColor: GREEN as any, textColor: WHITE as any, fontStyle: 'bold', fontSize: 8.5, cellPadding: 3 },
    bodyStyles: { fontSize: 9, cellPadding: 3 },
    footStyles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 1: { halign: 'right', cellWidth: 36 } },
    theme: 'grid',
    tableLineColor: BORDER as any,
    tableLineWidth: 0.15,
    margin: { left: ML, right: PW - ML - colW },
    tableWidth: colW,
  });
  const leftEndY = (pdf as any).lastAutoTable.finalY;

  // Right: Deductions
  autoTable(pdf, {
    startY: tableStartY,
    head: [['DEDUCTIONS', 'AMOUNT (INR)']],
    body: deductions.map(([label, amt]) => [label, INR(amt)]),
    foot: [[
      { content: 'TOTAL DEDUCTIONS', styles: { fontStyle: 'bold', fillColor: LIGHT as any, textColor: DARK as any } },
      { content: INR(totalDeductions), styles: { fontStyle: 'bold', fillColor: LIGHT as any, textColor: RED as any, halign: 'right' } },
    ]],
    headStyles: { fillColor: RED as any, textColor: WHITE as any, fontStyle: 'bold', fontSize: 8.5, cellPadding: 3 },
    bodyStyles: { fontSize: 9, cellPadding: 3 },
    footStyles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 1: { halign: 'right', cellWidth: 36 } },
    theme: 'grid',
    tableLineColor: BORDER as any,
    tableLineWidth: 0.15,
    margin: { left: ML + colW + 4, right: MR },
    tableWidth: colW,
  });
  const rightEndY = (pdf as any).lastAutoTable.finalY;

  y = Math.max(leftEndY, rightEndY) + 6;

  // ═════════════════════════════════════════════════════════════════════════
  //  NET PAY — large emphasised banner
  // ═════════════════════════════════════════════════════════════════════════
  pdf.setFillColor(...NAVY);
  pdf.rect(ML, y, CW, 22, 'F');
  pdf.setFillColor(...GOLD);
  pdf.rect(ML, y, 3, 22, 'F');

  pdf.setFontSize(8); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(255, 255, 255, 0.85 as any);
  pdf.setTextColor(200, 215, 235);
  pdf.text('NET PAY (TAKE HOME)', ML + 8, y + 8);
  pdf.setFontSize(7); pdf.setFont('helvetica', 'italic'); pdf.setTextColor(180, 195, 215);
  pdf.text('Gross Earnings minus Total Deductions', ML + 8, y + 14);

  pdf.setFontSize(18); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...GOLD);
  pdf.text(INR(salary.netAmount || 0), PW - MR - 5, y + 14, { align: 'right' });

  y += 26;

  // Amount in words
  pdf.setFillColor(...LIGHT);
  pdf.rect(ML, y, CW, 10, 'F');
  pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.2);
  pdf.rect(ML, y, CW, 10);
  pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...SLATE);
  pdf.text('IN WORDS:', ML + 3, y + 6.5);
  pdf.setFontSize(8.5); pdf.setFont('helvetica', 'bolditalic'); pdf.setTextColor(...DARK);
  pdf.text(toWords(salary.netAmount || 0), ML + 22, y + 6.5);
  y += 14;

  // ═════════════════════════════════════════════════════════════════════════
  //  PAYMENT SUMMARY
  // ═════════════════════════════════════════════════════════════════════════
  const summaryY = y;
  const sumColW = (CW - 4) / 3;
  const summaryItems: [string, string, [number, number, number]][] = [
    ['Net Payable',  INR(salary.netAmount || 0),  NAVY],
    ['Amount Paid',  INR(salary.paidAmount || 0), GREEN],
    ['Balance Due',  INR(salary.balanceAmount || 0), salary.balanceAmount > 0 ? RED : SLATE],
  ];
  summaryItems.forEach(([label, value, color], i) => {
    const bx = ML + i * (sumColW + 2);
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(...BORDER); pdf.setLineWidth(0.3);
    pdf.rect(bx, summaryY, sumColW, 18);
    pdf.setFillColor(...color);
    pdf.rect(bx, summaryY, sumColW, 2, 'F');

    pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...SLATE);
    pdf.text(label.toUpperCase(), bx + 3, summaryY + 8);
    pdf.setFontSize(11); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...color);
    pdf.text(value, bx + 3, summaryY + 15);
  });
  y += 22;

  // ═════════════════════════════════════════════════════════════════════════
  //  PAYMENT HISTORY
  // ═════════════════════════════════════════════════════════════════════════
  const history = salary.paymentHistory || [];
  if (history.length > 0) {
    pdf.setFontSize(9); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...DARK);
    pdf.text('PAYMENT HISTORY', ML, y);
    pdf.setDrawColor(...NAVY); pdf.setLineWidth(0.3);
    pdf.line(ML, y + 1.5, ML + 35, y + 1.5);
    y += 4;

    autoTable(pdf, {
      startY: y,
      head: [['#', 'DATE', 'METHOD', 'TRANSACTION REF', 'AMOUNT']],
      body: history.map((h, i) => [
        String(i + 1).padStart(2, '0'),
        new Date(h.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        (h.method || '').replace(/_/g, ' ').toUpperCase(),
        h.transactionId || '-',
        INR(h.amount),
      ]),
      headStyles: { fillColor: NAVY as any, textColor: WHITE as any, fontStyle: 'bold', fontSize: 8, cellPadding: 2.5 },
      bodyStyles: { fontSize: 8.5, cellPadding: 2.5 },
      alternateRowStyles: { fillColor: LIGHT as any },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        1: { cellWidth: 30 },
        2: { cellWidth: 32 },
        4: { halign: 'right', fontStyle: 'bold', cellWidth: 36 },
      },
      theme: 'grid',
      tableLineColor: BORDER as any,
      tableLineWidth: 0.15,
      margin: { left: ML, right: MR },
    });
    y = (pdf as any).lastAutoTable.finalY + 6;
  }

  // Remarks
  if (salary.remarks) {
    pdf.setFontSize(7.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...DARK);
    pdf.text('Remarks:', ML, y);
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...SLATE);
    const remarkLines = pdf.splitTextToSize(salary.remarks, CW - 20);
    pdf.text(remarkLines, ML + 18, y);
    y += remarkLines.length * 4 + 4;
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  SIGNATORIES
  // ═════════════════════════════════════════════════════════════════════════
  const sigY = Math.min(y + 6, PH - 50);
  const sigColW = (CW - 8) / 2;

  // Employee
  pdf.setDrawColor(...SLATE); pdf.setLineWidth(0.3);
  pdf.line(ML, sigY + 14, ML + sigColW - 6, sigY + 14);
  pdf.setFontSize(7.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...DARK);
  pdf.text('Employee Signature', ML, sigY + 19);
  pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...SLATE);
  pdf.text(salary.employeeName, ML, sigY + 24);

  // Authorised
  const ax = ML + sigColW + 8;
  pdf.line(ax, sigY + 14, ax + sigColW - 6, sigY + 14);
  pdf.setFontSize(7.5); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...DARK);
  pdf.text('Authorised Signatory', ax, sigY + 19);
  pdf.setFontSize(7); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...SLATE);
  pdf.text('Accounts & Finance Office', ax, sigY + 24);

  // ═════════════════════════════════════════════════════════════════════════
  //  FOOTER
  // ═════════════════════════════════════════════════════════════════════════
  const footY = PH - 14;
  pdf.setDrawColor(...NAVY); pdf.setLineWidth(0.2); pdf.line(ML, footY - 2, PW - MR, footY - 2);
  pdf.setLineWidth(0.6); pdf.line(ML, footY, PW - MR, footY);

  pdf.setFontSize(7); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(...NAVY);
  pdf.text('EHS  ·  THE ELDEN HEIGHTS SCHOOL', ML, footY + 4);
  pdf.setFont('helvetica', 'italic'); pdf.setTextColor(...GOLD);
  pdf.text('This is a computer-generated salary slip and does not require a signature.', PW / 2, footY + 4, { align: 'center' });
  pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...SLATE);
  pdf.text('Page 1 of 1', PW - MR, footY + 4, { align: 'right' });

  pdf.setFontSize(6.5); pdf.setFont('helvetica', 'italic'); pdf.setTextColor(...SLATE);
  pdf.text('A unit of Bhagwati Educational And Charitable Trust', PW / 2, footY + 9, { align: 'center' });

  const fileSafeMonth = monthLabel.replace(/\s+/g, '_');
  const fileName = `PaySlip_${salary.employeeName.replace(/\s+/g, '_')}_${fileSafeMonth}.pdf`;
  await savePdf(pdf, fileName);
}
