import test from 'node:test';
import assert from 'node:assert/strict';
import {validateClinical} from '../lib/clinical.js';
test('assessment requires measured pain and action for red flag',()=>{const b={kind:'Assessment',structured:{symptoms:'Demo',findings:'Demo',pain:0,red_flag:'Present'}};assert.throws(()=>validateClinical(b),/الإجراء/);b.structured.flag_action='إحالة موثقة';assert.equal(validateClinical(b).pain,0);b.structured.pain=11;assert.throws(()=>validateClinical(b),/عشرة/);});
test('plan requires goals and review date',()=>{assert.throws(()=>validateClinical({kind:'Plan',structured:{}}),/الأهداف/);assert.doesNotThrow(()=>validateClinical({kind:'Plan',structured:{goals:'Demo',interventions:'Demo',frequency:'Demo',duration:'Demo',review:'2026-11-01'}}));});

test('discharge requires outcome, reason and follow-up recommendations',()=>{const b={kind:'Discharge',structured:{outcome:'تحسن القياسات',discharge_reason:'تحقيق الأهداف'}};assert.throws(()=>validateClinical(b),/التوصيات/);b.structured.recommendations='برنامج منزلي ومتابعة';assert.doesNotThrow(()=>validateClinical(b));});
