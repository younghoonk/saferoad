/**
 * Calls the Edge Function for ASSESS_101 and dumps key fields for debugging.
 */
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Load from app .env too
const appEnv = require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const EDGE_URL = `${SUPABASE_URL}/functions/v1/create-assessment-draft`;

const payload = {
  requestId: `debug-ASSESS_101-${Date.now()}`,
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
  adjusterMemo: '결정적 증거: 외래 SOAP 기록(\"cardiac marker 상승, EKG로 UA-NSTEMI 진단서 가능\"). 보험사는 CAG 시행 전 단일 시점 심근효소 수치만 문제 삼으나, Fourth Universal Definition of Myocardial Infarction 2018 기준 적용 시 요건 충족. 대법원 2013다208661 역공 논리 필수.',
  tone: 'professional',
  retrievedReferences: [],
};

async function main() {
  console.log('Edge URL:', EDGE_URL);
  console.log('ANON_KEY present:', !!ANON_KEY);
  console.log('SERVICE_ROLE_KEY present:', !!SERVICE_ROLE_KEY);

  // Try service role key first, then anon key
  const authKey = SERVICE_ROLE_KEY || ANON_KEY;
  if (!authKey) {
    console.error('No auth key found');
    process.exit(1);
  }

  console.log('\nCalling Edge Function...');
  const res = await fetch(EDGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authKey}`,
      apikey: authKey,
    },
    body: JSON.stringify(payload),
  });

  console.log('Status:', res.status);
  if (!res.ok) {
    const err = await res.text();
    console.error('Error:', err);
    process.exit(1);
  }

  const data = await res.json();

  // Check for 2013다208661 everywhere
  const fullJson = JSON.stringify(data);
  console.log('\n=== KEY FINDINGS ===');
  console.log('Has 2013다208661 anywhere in response:', fullJson.includes('2013다208661'));
  console.log('Has 대법원 anywhere:', fullJson.includes('대법원'));
  console.log('Has 판례 anywhere in finalReport:', (data.finalSubmissionAssessmentReport || '').includes('판례'));

  // Check official references
  const officialRefs = data.retrievedReferences?.officialReferences || [];
  console.log('\n=== retrievedReferences.officialReferences ===');
  console.log(`Count: ${officialRefs.length}`);
  for (const ref of officialRefs) {
    console.log(`\n  source_area: ${ref.source_area}`);
    console.log(`  title: ${(ref.title || '').substring(0, 80)}`);
    console.log(`  case_number: ${ref.case_number}`);
    const has2013 = JSON.stringify(ref).includes('2013다208661');
    if (has2013) console.log('  *** HAS 2013다208661 ***');
  }

  // Check fssPrecedents in finalReport
  const report = data.finalSubmissionAssessmentReport || '';
  const precedentIdx = report.indexOf('판례');
  console.log('\n=== finalSubmissionAssessmentReport ===');
  console.log('Length:', report.length);
  console.log('Contains 판례:', precedentIdx !== -1);
  if (precedentIdx !== -1) {
    console.log('판례 context:', report.substring(Math.max(0, precedentIdx - 50), precedentIdx + 300));
  }

  // Check section V
  const sectionV = report.indexOf('Ⅴ.');
  if (sectionV !== -1) {
    console.log('\nSection V:', report.substring(sectionV, sectionV + 500));
  } else {
    console.log('\nSection V not found');
    // Try roman numerals
    const altV = report.indexOf('V.');
    if (altV !== -1) console.log('Alt V.:', report.substring(altV, altV + 500));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
