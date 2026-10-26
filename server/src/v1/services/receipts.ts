import PDFDocument from 'pdfkit';

export type ReceiptDetails = {
  receiptNumber: string;
  studentName: string;
  studentId: string;
  roomNumber: string;
  amountPesewas: number;
  totalPaidPesewas: number;
  balancePesewas: number;
  network: string;
  reference: string;
  paidAt: Date | string;
};

export function createReceiptPdf(details: ReceiptDetails) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 54, info: { Title: `Receipt ${details.receiptNumber}` } });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    const money = (pesewas: number) => `GHS ${(pesewas / 100).toFixed(2)}`;
    document.fontSize(10).fillColor('#2874a6').text('HOSTEL MANAGEMENT', { characterSpacing: 1.2 });
    document.moveDown(0.6).fontSize(24).fillColor('#173550').text('Payment receipt');
    document.moveDown(0.25).fontSize(11).fillColor('#63798c').text(`Receipt ${details.receiptNumber}`);
    document.moveDown(2);
    document.fontSize(12).fillColor('#173550').text(`Student: ${details.studentName}`);
    document.moveDown(0.5).text(`Student ID: ${details.studentId}`);
    document.moveDown(0.5).text(`Room: ${details.roomNumber}`);
    document.moveDown(0.5).text(`Network: ${details.network.replace('_', ' ')}`);
    document.moveDown(0.5).text(`Reference: ${details.reference}`);
    document.moveDown(0.5).text(`Date: ${new Date(details.paidAt).toISOString()}`);
    document.moveDown(1.5).fontSize(14).text(`This payment: ${money(details.amountPesewas)}`);
    document.moveDown(0.5).fontSize(12).text(`Total paid: ${money(details.totalPaidPesewas)}`);
    document.moveDown(0.5).text(`Remaining balance: ${money(details.balancePesewas)}`);
    document.moveDown(2).fontSize(9).fillColor('#63798c').text('Keep this receipt for your records. Payment is confirmed by the hostel after provider verification.');
    document.end();
  });
}