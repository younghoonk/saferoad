/**
 * probeProcedureName.ts
 * extractReimbursementContext의 수정된 procedureName 로직을
 * reimbursement 7건(075/076/077/078/079/083/085)에 로컬 재현.
 *
 * ★ index.ts L3221-3224와 글자단위 동일한 코드를 사용할 것★
 * 실행: npx tsx scripts/probeProcedureName.ts
 */

import { readFileSync } from 'fs';

interface EvalCase {
  id: string;
  input: {
    damageDetails?: string;
    damageDescription?: string;
    insurerPosition?: string;
    diagnosisText?: string;
  };
}

const allCases: EvalCase[] = JSON.parse(
  readFileSync('ai_eval/assessment_cases_100_v1.json', 'utf8'),
);

const TARGETS = ['ASSESS_075','ASSESS_076','ASSESS_077','ASSESS_078','ASSESS_079','ASSESS_083','ASSESS_085'];

// ★ index.ts L3221-3224 원문과 글자단위 동일 ★
const PROC_REGEX = /(?:자가골수흡인농축물|BMAC|골수흡인농축물|전립선동맥색전술|전립선결찰술|UroLift|PAE|고강도집속초음파|HIFU|PRP|혈소판풍부혈장|줄기세포|자가지방유래)[^\n。은는이가을를로에의,]{0,25}/i;

// buildPayload와 동일한 damageDetails 매핑
function getDamageDetails(inp: EvalCase['input']): string {
  return inp.damageDetails || inp.damageDescription || '';
}

// 비문 꼬리 패턴: 30자 초과 또는 잔여 서술어/숫자 혼입
function hasTail(name: string): boolean {
  if (name.length > 30) return true;
  if (/시행\s*\.|원\s*\(비급여|남성\.|여성\.|년|\d{1,4}만/.test(name)) return true;
  return false;
}

console.log('=== probeProcedureName: reimbursement 7건 procedureName 검증 ===\n');

for (const id of TARGETS) {
  const c = allCases.find(x => x.id === id);
  if (!c) { console.log(id + ' | 케이스 없음'); continue; }

  const damageDetails = getDamageDetails(c.input);
  const insurerPosition = c.input.insurerPosition || '';

  // ★ index.ts L3221-3224 동일 로직 ★
  const procFromInsurer = insurerPosition.match(PROC_REGEX)?.[0]?.trim();
  const procFromDamage = damageDetails.match(PROC_REGEX)?.[0]?.trim();
  const procedureName = procFromInsurer || procFromDamage || '해당 신의료기술 비급여 시술';

  const source = procFromInsurer ? 'insurerPosition' : procFromDamage ? 'damageDetails' : 'fallback';
  const warn = hasTail(procedureName) ? ' ⚠️' : ' ✅';

  console.log(`${id} | source: ${source} | procedureName: "${procedureName}"${warn}`);
}

console.log('\n판정기준: 길이>30자 또는 "시행.", "원(비급여)", "남성." 등 서술 꼬리 있으면 ⚠️');
