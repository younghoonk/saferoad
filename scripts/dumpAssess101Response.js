/**
 * Calls Edge Function via Supabase client (same as eval) and dumps officialReferences.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.rag.local') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const payload = {
  requestId: `dump-ASSESS_101-${Date.now()}`,
  caseTitle: 'I21.4 NSTEMI 급성심내막하심근경색 진단비 부지급 — v2 gold 케이스',
  insurerName: '[보험사]',
  insuranceType: '급성심근경색 진단비',
  contractDate: '2022-03-01',
  accidentType: '급성심근경색 진단비',
  accidentDate: 'unknown',
  diagnosisText: 'I21.4 급성 심내막하심근경색증 (NSTEMI)',
  damageDetails: 'D-44: 흉통 발생으로 내원. D-30: 운동부하검사(TMT) ST depression 확인. D-22: 관상동맥 CT — Ca score 532.9, LM 협착 >90%, LAD 70%, LCx >70%. D-1: 관상동맥조영술(CAG) + PCI(스텐트 삽입) — LM-LAD 협착 95% 확인. CAG 시행 전 혈액검사: CK-MB 2.1, Troponin T 0.021. 이후 외래 SOAP 기록: hs-troponin 0.037, 주치의 소견 「cardiac marker 상승, EKG로 UA-NSTEMI 진단서 가능」. 담당 전문의 I21.4 (NSTEMI) 진단서 발급.',
  insurerPosition: '흉통 발생 이후 관상동맥조영술 시행 전까지 시행한 혈액검사상 심근효소 상승이 확인되지 않아, 심근경색까지 진행하지 않은 것으로 검토되는 바, 급성 심내막하심근경색증(I21.4) 진단 불인 의견, 죽상경화성 심장병(I25.1) 진단 인정 의견',
  customerStatement: '전문의 진단서와 SOAP 기록, 심근효소 수치, 심전도 소견이 모두 일치하며, 주치의가 직접 NSTEMI 진단서 발급 의사를 SOAP 기록에 명시하였음',
  adjusterMemo: '결정적 증거: 외래 SOAP 기록("cardiac marker 상승, EKG로 UA-NSTEMI 진단서 가능"). 보험사는 CAG 시행 전 단일 시점 심근효소 수치만 문제 삼으나, Fourth Universal Definition of Myocardial Infarction 2018 기준 적용 시 요건 충족. 대법원 2013다208661 역공 논리 필수.',
  tone: 'professional',
  retrievedReferences: [],
};

async function main() {
  console.log('Signing in...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: process.env.TEST_ADJUSTER_EMAIL,
    password: process.env.TEST_ADJUSTER_PASSWORD,
  });
  if (authError) { console.error('Auth error:', authError.message); process.exit(1); }
  console.log('Signed in as:', authData.user?.email);

  console.log('\nCalling Edge Function...');
  const { data, error } = await supabase.functions.invoke('create-assessment-draft', { body: payload });
  if (error) { console.error('Function error:', error.message || String(error)); process.exit(1); }
  if (!data) { console.error('No data returned'); process.exit(1); }

  // Check for 2013다208661
  const fullJson = JSON.stringify(data);
  console.log('\n=== KEY FINDINGS ===');
  console.log('Has 2013다208661 ANYWHERE:', fullJson.includes('2013다208661'));
  console.log('Has 대법원 in finalReport:', (data.finalSubmissionAssessmentReport || '').includes('대법원'));
  console.log('Has 판례 in finalReport:', (data.finalSubmissionAssessmentReport || '').includes('판례'));

  // Official references
  const offRefs = data.retrievedReferences?.officialReferences || [];
  console.log('\n=== officialReferences ===');
  console.log('Count:', offRefs.length);
  for (let i = 0; i < offRefs.length; i++) {
    const ref = offRefs[i];
    const has2013 = JSON.stringify(ref).includes('2013다208661');
    console.log(`\n  [${i+1}] source_area: ${ref.source_area}`);
    console.log(`       title: ${(ref.title || '').substring(0, 70)}`);
    console.log(`       case_number: ${ref.case_number || '(none)'}`);
    if (has2013) console.log(`       *** HAS 2013다208661 ***`);
  }

  // Check finalSubmissionAssessmentReport section V
  const report = data.finalSubmissionAssessmentReport || '';
  const sectionV = report.indexOf('Ⅴ');
  if (sectionV !== -1) {
    console.log('\n=== Section Ⅴ (first 600 chars) ===');
    console.log(report.substring(sectionV, sectionV + 600));
  } else {
    console.log('\nSection Ⅴ not found in finalSubmissionAssessmentReport');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
