import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { toPdf, toXlsx, REPORT_ROW_LIMIT } from '../lib/report-files.js';
import { exportRows } from '../lib/exports.js';
import { createDatabase } from '../lib/db.js';

test('XLSX is an RTL OOXML workbook: Arabic, XML escaping, numeric cells and formula-safe strings', () => {
  const archive = unzipSync(toXlsx([{name:'أحمد <محمد> & علي',formula:'=HYPERLINK("https://invalid")',plus:'+1',amount:-12.5}]));
  assert.ok(archive['[Content_Types].xml']);
  const sheet = strFromU8(archive['xl/worksheets/sheet1.xml']);
  assert.match(sheet,/rightToLeft="1"/);
  assert.match(sheet,/أحمد &lt;محمد&gt; &amp; علي/);
  assert.match(sheet,/t="inlineStr"><is><t xml:space="preserve">=HYPERLINK/);
  assert.doesNotMatch(sheet,/<f[ >]/);
  assert.match(sheet,/<v>-12.5<\/v>/);
});

test('PDF is a complete embedded-font PDF and both formats handle empty datasets and limits', async () => {
  const pdf = await toPdf([{name:'أحمد محمد',notes:'تقرير متابعة المريض ونتائج العلاج'}]);
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  assert.match(pdf.toString('latin1'),/\/FontFile2/);
  assert.match(pdf.subarray(-30).toString(),/%%EOF/);
  assert.ok((await toPdf([])).length > 1000);
  assert.ok(unzipSync(toXlsx([]))['xl/worksheets/sheet1.xml']);
  const rows = Array.from({length:REPORT_ROW_LIMIT+1},()=>({id:1}));
  assert.throws(()=>toXlsx(rows),/١٠٠٠/);
  await assert.rejects(toPdf(rows),/١٠٠٠/);
  assert.throws(()=>toXlsx([{value:'a'.repeat(32001)}]),/طويل/);
  assert.throws(()=>toXlsx(Array.from({length:100},()=>({value:'a'.repeat(3000)}))),/حجم/);
});

test('binary render happens only after scope and permission filtering; audit records format/count without values', async () => {
  const db = createDatabase(':memory:');
  try {
    await db.exec("INSERT INTO users(id,name,email,password,role) VALUES('physio','P','p@invalid','disabled','physio');INSERT INTO patients(id,name,phone) VALUES(1,'Visible','DEMO'),(2,'Hidden','DEMO');INSERT INTO appointments(patient_id,provider,start,end,room,service) VALUES(1,'physio','2026-10-17T10:00','2026-10-17T11:00','Room','Service')");
    const actor = {id:'physio',role:'physio',active:1,permissions:['patients.view','patients.export']};
    let rendered;
    const file = await exportRows(db,'patients',actor,{format:'xlsx',render:rows=>{rendered=rows;return toXlsx(rows);}});
    assert.deepEqual(rendered.map(r=>r.name),['Visible']);
    const sheet = strFromU8(unzipSync(file)['xl/worksheets/sheet1.xml']);
    assert.match(sheet,/Visible/);assert.doesNotMatch(sheet,/Hidden/);
    const audit = await db.prepare("SELECT * FROM audit WHERE action='data.export' ORDER BY id DESC LIMIT 1").get();
    const payload=JSON.stringify(audit);
    assert.match(payload,/xlsx/);assert.doesNotMatch(payload,/Visible|Hidden/);
    let called=false;
    await assert.rejects(exportRows(db,'patients',{...actor,permissions:['patients.view']},{format:'pdf',render:()=>{called=true;}}),/التصدير/);
    assert.equal(called,false);
    await assert.rejects(exportRows(db,'patients',actor,{format:'pdf',render:()=>{throw Error('render failed');}}),/render failed/);
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit WHERE action='data.export'").get()).n,1);
  } finally {db.close();}
});
