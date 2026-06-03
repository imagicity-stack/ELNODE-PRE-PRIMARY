import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

const EMERALD: [number, number, number] = [5, 150, 105];
const EMERALD_LIGHT: [number, number, number] = [209, 250, 229];
const DARK: [number, number, number] = [15, 23, 42];
const SLATE: [number, number, number] = [100, 116, 139];
const LIGHT: [number, number, number] = [248, 250, 252];
const WHITE: [number, number, number] = [255, 255, 255];

export const TABLE_STYLES = {
  headStyles: {
    fillColor: EMERALD,
    textColor: WHITE,
    fontStyle: 'bold' as const,
    fontSize: 9,
  },
  alternateRowStyles: { fillColor: LIGHT },
  styles: { fontSize: 9, cellPadding: 4 },
  theme: 'striped' as const,
};

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

export async function createPdf(
  title: string,
  subtitle?: string,
): Promise<{ doc: jsPDF; contentY: number; pageWidth: number }> {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;

  const logo = await getLogoBase64();

  // Header background
  doc.setFillColor(...LIGHT);
  doc.rect(0, 0, pageWidth, 38, 'F');

  // Logo
  if (logo) {
    try {
      doc.addImage(logo, 'PNG', 12, 7, 22, 22);
    } catch {
      // ignore
    }
  }

  const textX = logo ? 38 : pageWidth / 2;
  const textAlign = logo ? 'left' : 'center';

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text('The Elden Heights School', textX, 17, { align: textAlign });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...SLATE);
  doc.text('Excellence · Integrity · Innovation', textX, 24, { align: textAlign });

  // Emerald accent strip
  doc.setFillColor(...EMERALD);
  doc.rect(0, 37, pageWidth, 3, 'F');

  // Document title
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...DARK);
  doc.text(title, pageWidth / 2, 51, { align: 'center' });

  let contentY = 58;
  if (subtitle) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...SLATE);
    doc.text(subtitle, pageWidth / 2, 58, { align: 'center' });
    contentY = 65;
  }

  return { doc, contentY, pageWidth };
}

export function addFooter(doc: jsPDF): void {
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;

  doc.setFillColor(...EMERALD);
  doc.rect(0, pageHeight - 14, pageWidth, 14, 'F');

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...WHITE);
  doc.text(
    'Computer-generated document — no signature required.',
    pageWidth / 2,
    pageHeight - 7,
    { align: 'center' },
  );
  doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, 12, pageHeight - 7);
  doc.text('The Elden Heights School', pageWidth - 12, pageHeight - 7, { align: 'right' });
}

export function drawInfoBox(
  doc: jsPDF,
  fields: { label: string; value: string }[],
  startY: number,
  pageWidth: number,
  columns = 2,
): number {
  doc.setFillColor(...LIGHT);
  const boxHeight = Math.ceil(fields.length / columns) * 8 + 8;
  doc.roundedRect(12, startY, pageWidth - 24, boxHeight, 2, 2, 'F');

  const colWidth = (pageWidth - 24) / columns;
  let row = 0;
  let col = 0;

  fields.forEach((field, i) => {
    const x = 18 + col * colWidth;
    const y = startY + 7 + row * 8;

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...SLATE);
    doc.text(field.label + ':', x, y);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...DARK);
    doc.text(field.value, x + 28, y);

    col++;
    if (col >= columns) { col = 0; row++; }
  });

  return startY + boxHeight + 4;
}
