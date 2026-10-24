import 'server-only';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import QRCode from 'qrcode';

const ORANGE = rgb(0.83, 0.33, 0.06);
const INK = rgb(0.11, 0.14, 0.13);
const GREY = rgb(0.36, 0.4, 0.39);

export type StampInfo = {
  number: string;
  revision: number;
  title: string;
  effectiveDate: string;   // 2026-11-03
  approvedBy: string;
  approvedAt: string;
  verifyUrl: string;
};

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const rev = (n: number) => `Rev.${String(n).padStart(2, '0')}`;

const tanggal = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Makassar' });

// Stempel "CONTROLLED DOCUMENT" di halaman pertama + QR verifikasi, dan identitas dokumen di kaki setiap halaman.
export async function stampControlled(source: Uint8Array, info: StampInfo): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(source, { updateMetadata: false });
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const qrPng = await QRCode.toBuffer(info.verifyUrl, { margin: 0, width: 240, errorCorrectionLevel: 'M' });
  const qr = await pdf.embedPng(qrPng);
  const pages = pdf.getPages();

  pages.forEach((page, i) => {
    const { width } = page.getSize();
    const footer = `${info.number} · ${rev(info.revision)} · Berlaku ${tanggal(info.effectiveDate)} · Hal. ${i + 1}/${pages.length} · Dokumen terkendali BSB IMS`;
    page.drawText(footer, { x: 36, y: 18, size: 7, font: mono, color: GREY });

    if (i > 0) return;
    const w = 196, h = 86, x = width - w - 28, y = page.getHeight() - h - 24;
    page.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1), opacity: 0.92, borderColor: ORANGE, borderWidth: 1.6 });
    page.drawRectangle({ x: x + 3, y: y + 3, width: w - 6, height: h - 6, borderColor: ORANGE, borderWidth: 0.6 });
    page.drawText('CONTROLLED DOCUMENT', { x: x + 10, y: y + h - 18, size: 10, font: bold, color: ORANGE });
    const lines = [
      info.number,
      `${rev(info.revision)} · EFFECTIVE`,
      `Berlaku: ${tanggal(info.effectiveDate)}`,
      `Disetujui: ${info.approvedBy.slice(0, 22)}`,
      `${tanggal(info.approvedAt)}`,
    ];
    lines.forEach((t, k) => page.drawText(t, { x: x + 10, y: y + h - 31 - k * 10, size: 7, font: mono, color: INK }));
    page.drawImage(qr, { x: x + w - 54, y: y + 8, width: 46, height: 46 });
  });

  pdf.setSubject(`${info.number} ${rev(info.revision)}`);
  pdf.setTitle(info.title);
  pdf.setProducer('BSB IMS Document Control');
  return pdf.save();
}

// Salinan unduhan diberi label tidak terkendali agar cetakan lama tidak dianggap versi berlaku.
export async function stampUncontrolled(source: Uint8Array, who: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(source, { updateMetadata: false });
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const when = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Makassar' });
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    page.drawText('SALINAN TIDAK TERKENDALI', {
      x: width / 2 - 170, y: height / 2 - 60, size: 34, font: bold, color: rgb(0.7, 0.15, 0.12), opacity: 0.12, rotate: degrees(35),
    });
    page.drawText(`Salinan tidak terkendali bila dicetak · diunduh ${who} · ${when} WITA · cek versi berlaku di BSB IMS`, {
      x: 36, y: 8, size: 6, font: mono, color: GREY,
    });
  }
  return pdf.save();
}
