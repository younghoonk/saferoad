/**
 * probeProfiles.ts
 * ASSESS_075~089 케이스의 detectAssessmentProfile 실측 라우팅 확인용 1회성 probe.
 * 실행: npx tsx scripts/probeProfiles.ts
 */

import { readFileSync } from 'fs';
import { detectAssessmentProfile } from '../supabase/functions/_shared/detectAssessmentProfile.ts';

interface EvalCase {
  id: string;
  expectedProfile: string;
  input: {
    insurerName?: string;
    caseTitle?: string;
    insuranceType?: string;
    contractDate?: string;
    accidentType?: string;
    diagnosisText?: string;
    diagnosisName?: string;
    diagnosisCode?: string;
    coverageType?: string;
    damageDescription?: string;
    damageDetails?: string;
    insurerPosition?: string;
    customerStatement?: string;
    adjusterMemo?: string;
    sourceAnalysis?: {
      summary?: string;
      denialReason?: string;
      diagnosisSummary?: string;
      keyIssues?: string[];
    };
  };
}

const allCases: EvalCase[] = JSON.parse(
  readFileSync('ai_eval/assessment_cases_100_v1.json', 'utf8'),
);

const REGRESSION_IDS = new Set(['ASSESS_035', 'ASSESS_051', 'ASSESS_101']);
const targets = allCases.filter(
  (c) => (c.id >= 'ASSESS_075' && c.id <= 'ASSESS_089') || REGRESSION_IDS.has(c.id),
);

let matchCount = 0;
let mismatchCount = 0;
const mismatches: string[] = [];

console.log('=== probeProfiles: ASSESS_075~089 + 회귀(035/051/101) 라우팅 실측 ===\n');

for (const c of targets) {
  const actual = detectAssessmentProfile(c.input);
  const expected = c.expectedProfile ?? '(none)';
  const ok = actual === expected;
  if (ok) {
    matchCount++;
  } else {
    mismatchCount++;
    mismatches.push(c.id);
  }
  const mark = ok ? '✅' : '⚠️';
  console.log(`${c.id} | expected: ${expected} | actual: ${actual} | ${mark}`);
}

console.log(`\n합계: ✅ ${matchCount}건 일치 / ⚠️ ${mismatchCount}건 불일치`);

if (mismatches.length) {
  console.log(`불일치 케이스: ${mismatches.join(', ')}`);
}
