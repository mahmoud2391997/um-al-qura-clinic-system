import assert from 'node:assert/strict';
export async function verifyAttachmentScan({ call, db, cookie, setScanMode }) {
  for (const mode of ['Clean', 'Infected', 'Unavailable', 'WrongDigest']) {
    setScanMode(mode);
    const data = Buffer.from('%PDF-1.4\nSynthetic scanner ' + mode).toString(
      'base64',
    );
    const name = 'scan-' + mode + '.pdf';
    const uploaded = await call(
      'patients/attachments',
      { target_id: 1, name, mime: 'application/pdf', data },
      cookie,
    );
    assert.equal(uploaded.status, 200);
    const row = db.prepare('SELECT id FROM documents WHERE name=?').get(name);
    assert.equal(
      db
        .prepare(
          "SELECT state FROM attachment_scans WHERE store_table='documents' AND attachment_id=?",
        )
        .get(row.id).state,
      mode === 'Clean'
        ? 'Clean'
        : mode === 'Infected'
          ? 'Infected'
          : 'Unscanned',
    );
    const download = await call(
      'patients/attachments',
      { id: row.id, action: 'download' },
      cookie,
    );
    assert.equal(download.status, mode === 'Clean' ? 200 : 400);
    if (mode === 'Clean') {
      assert.equal(download.value.file.data, data);
      db.prepare('UPDATE documents SET data=? WHERE id=?').run(
        Buffer.from('Tampered').toString('base64'),
        row.id,
      );
      assert.equal(
        (
          await call(
            'patients/attachments',
            { id: row.id, action: 'download' },
            cookie,
          )
        ).status,
        400,
      );
    }
  }
  setScanMode('Clean');
  console.log(
    'PASS: actual app -> local trusted HTTPS scanner -> digest-bound clean download; infected/unavailable/wrong digest/tampered content remain blocked.',
  );
}
