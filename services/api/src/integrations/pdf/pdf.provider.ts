import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit') as typeof import('pdfkit');
import type { PdfProvider } from '../ports';

function bufferFromDoc(doc: InstanceType<typeof PDFDocument>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

@Injectable()
export class PdfKitProvider implements PdfProvider {
  readonly name = 'pdfkit';

  async generateLr(params: {
    tripId: string;
    from: string;
    to: string;
    vehicleReg?: string;
    weightKg?: number;
  }) {
    const doc = new PDFDocument({ margin: 50 });
    const done = bufferFromDoc(doc);
    doc.fontSize(18).text('ShareHaul — Lorry Receipt (LR)', { underline: true });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Trip ID: ${params.tripId}`);
    doc.text(`From: ${params.from}`);
    doc.text(`To: ${params.to}`);
    if (params.vehicleReg) doc.text(`Vehicle: ${params.vehicleReg}`);
    if (params.weightKg != null) doc.text(`Weight: ${params.weightKg} kg`);
    doc.moveDown();
    doc.text(`Issued: ${new Date().toISOString()}`);
    doc.text('GST / e-way metadata hooks attached in API meta.');
    doc.end();
    return done;
  }

  async generateInvoice(params: {
    tripId: string;
    amountPaisa: number;
    shipperName?: string;
  }) {
    const doc = new PDFDocument({ margin: 50 });
    const done = bufferFromDoc(doc);
    doc.fontSize(18).text('ShareHaul — Tax Invoice', { underline: true });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Invoice for trip: ${params.tripId}`);
    doc.text(`Bill to: ${params.shipperName ?? 'Shipper'}`);
    doc.text(`Amount: ₹${(params.amountPaisa / 100).toFixed(2)} INR`);
    doc.text(`Date: ${new Date().toISOString().slice(0, 10)}`);
    doc.moveDown();
    doc.text('This is a system-generated invoice. GSTIN fields configurable via env.');
    doc.end();
    return done;
  }
}
