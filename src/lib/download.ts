import { Capacitor } from '@capacitor/core';
import type { jsPDF } from 'jspdf';

// On the web, files download via a normal anchor click. Inside the Capacitor
// Android WebView that mechanism is blocked, so we write the file to the app's
// cache and open the native Share sheet — letting the user save it to Files,
// Drive, WhatsApp, etc. These helpers paper over that platform difference so
// call sites stay simple.

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function saveNative(filename: string, blob: Blob): Promise<void> {
  const base64 = await blobToBase64(blob);
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const written = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({ title: filename, url: written.uri });
}

function saveWeb(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Save an arbitrary Blob (PDF, image, etc.). */
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  if (Capacitor.isNativePlatform()) await saveNative(filename, blob);
  else saveWeb(filename, blob);
}

/** Save text content (CSV, JSON, etc.). */
export async function saveText(
  content: string,
  filename: string,
  mime = 'text/csv;charset=utf-8;'
): Promise<void> {
  await saveBlob(new Blob([content], { type: mime }), filename);
}

/** Save a jsPDF document — replaces `doc.save(filename)`. */
export async function savePdf(doc: jsPDF, filename: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await saveNative(filename, doc.output('blob'));
  } else {
    doc.save(filename);
  }
}

/** Open an external URL (attachment, report link). */
export async function openExternalUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
