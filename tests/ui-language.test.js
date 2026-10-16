import test from 'node:test';
import assert from 'node:assert/strict';
import {translateLabel,englishLabels} from '../lib/ui-translations.js';
test('Arabic is the default; explicit core UI labels translate without mutating stored strings',()=>{
 for(const label of ['اسم المريض','المواعيد والاستقبال','التوثيق السريري','قيمة الفاتورة','إتمام المهمة','البريد الإلكتروني','حالة الموعد']){
  assert.equal(translateLabel(label,'ar'),label);
  assert.ok(englishLabels[label]);assert.notEqual(translateLabel(label,'en'),label);
 }
 assert.equal(translateLabel(' عرض ','en'),' Showing ');
 assert.equal(translateLabel('نص سريري خاص بالمريض','en'),'نص سريري خاص بالمريض');
 assert.equal(translateLabel('Arrived','en'),'Arrived');
});
