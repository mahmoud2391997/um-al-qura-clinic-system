import PDFDocument from 'pdfkit';
import { zipSync, strToU8 } from 'fflate';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPORT_ROW_LIMIT = 1000;
const text = value => typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
const xml = value => text(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function columns(rows) { return [...new Set(rows.flatMap(row => Object.keys(row)))]; }
function validate(rows) {
  if (rows.length > REPORT_ROW_LIMIT) throw Error('التقرير يتجاوز ١٠٠٠ سجل؛ ضيّق نطاق البيانات أو استخدم CSV');
  if (Buffer.byteLength(JSON.stringify(rows)) > 250000) throw Error('حجم التقرير كبير جدًا؛ استخدم CSV');
  if (rows.some(row => Object.values(row).some(value => text(value).length > 32000))) throw Error('أحد حقول التقرير طويل جدًا؛ استخدم CSV');
}
function columnName(index) {
  let name = '';
  for (index++; index; index = Math.floor((index - 1) / 26)) name = String.fromCharCode(65 + (index - 1) % 26) + name;
  return name;
}

export function toXlsx(rows) {
  validate(rows);
  const keys = columns(rows);
  // Inline strings are never interpreted as spreadsheet formulas, including =,+,-,@ prefixes.
  const lines = [keys, ...rows.map(row => keys.map(key => row[key]))];
  const sheet = lines.map((line, row) => `<row r="${row + 1}">${line.map((value, col) => {
    const ref = `${columnName(col)}${row + 1}`;
    return typeof value === 'number' && Number.isFinite(value)
      ? `<c r="${ref}"><v>${value}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="التقرير" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews><sheetData>${sheet}</sheetData></worksheet>`,
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, body]) => [name, strToU8(body)]))));
}

export async function toPdf(rows) {
  validate(rows);
  const font = readFileSync(join(process.cwd(), 'public/fonts/Amiri-Regular.ttf'));
  const doc = new PDFDocument({ size: 'A4', margin: 40, font, info: { Title: 'تقرير العيادة' } });
  const chunks = [];
  const result = new Promise((resolve, reject) => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  doc.fontSize(20).text('تقرير العيادة', { align: 'right', features: ['liga', 'rlig'] });
  doc.fontSize(11).text(String(rows.length), { align: 'right', features: ['liga', 'rlig'] }).moveDown();
  if (!rows.length) doc.text('لا توجد سجلات', { align: 'right', features: ['liga', 'rlig'] });
  // A record layout preserves long clinical fields without squeezing a wide table or clipping cells.
  for (let index = 0; index < rows.length; index++) {
    if (doc.y > 700) doc.addPage();
    doc.fontSize(13).fillColor('#125b59').text(`# ${index + 1}`, { align: 'right', features: ['liga', 'rlig'] });
    for (const [key, value] of Object.entries(rows[index])) {
      doc.fontSize(10).fillColor('#555555').text(key, { align: 'right', features: ['liga', 'rlig'] });
      doc.fontSize(12).fillColor('#111111').text(text(value), { align: /[\u0600-\u06ff]/.test(text(value)) ? 'right' : 'left', features: ['liga', 'rlig'] });
      doc.moveDown(0.25);
    }
    doc.moveDown();
  }
  doc.end();
  return result;
}
