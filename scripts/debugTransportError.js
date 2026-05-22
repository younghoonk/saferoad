#!/usr/bin/env node
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.TEST_ADJUSTER_EMAIL;
const PASSWORD = process.env.TEST_ADJUSTER_PASSWORD;

const TEST_CASES = {
  ASSESS_004: {
    insurerName: '현대해상',
    insuranceType: '질병보험',
    contractDate: '2020-09-05',
    accidentDate: 'unknown',
    accidentType: '고지의무/계약해지',
    diagnosisText: 'E78 고지혈증',
    damageDetails: '건강검진에서 콜레스테롤 수치 이상이 있었으나 치료나 투약은 없었음.',
    insurerPosition: '건강검진 이상소견 미고지로 계약해지 주장',
    customerStatement: '단순 수치 이상으로 치료 필요성을 듣지 못함',
    adjusterMemo: '검진결과, 재검권유 여부, 투약 여부 확인',
  },
  ASSESS_007: {
    insurerName: '한화손해보험',
    insuranceType: '질병보험',
    contractDate: '2019-08-14',
    accidentDate: 'unknown',
    accidentType: '고지의무/계약해지',
    diagnosisText: 'D25 자궁근종',
    damageDetails: '가입 전 자궁근종 소견이 있었으나 증상과 치료가 없어 고지하지 않음. 이후 수술비 청구.',
    insurerPosition: '자궁근종 미고지로 계약해지 및 수술비 부지급 주장',
    customerStatement: '무증상 검진 소견이었고 수술 권유를 받지 못함',
    adjusterMemo: '검진결과, 크기 변화, 수술 권유 시점 확인',
  },
  // E78 minimal 질병보험 고지의무 (baseline comparison)
  E78_MIN: {
    insurerName: '현대해상',
    insuranceType: '질병보험',
    contractDate: '2020-09-05',
    accidentDate: 'unknown',
    accidentType: '고지의무/계약해지',
    diagnosisText: 'E78',
    damageDetails: '치료비 청구.',
    insurerPosition: '미고지로 계약해지',
    customerStatement: '무증상이었음',
    adjusterMemo: '',
  },
  // E78 with 실손보험 (to test if 실손 is the issue for K29)
  E78_SILSON: {
    insurerName: 'KB손해보험',
    insuranceType: '실손보험',
    contractDate: '2020-09-05',
    accidentDate: 'unknown',
    accidentType: '고지의무/계약해지',
    diagnosisText: 'E78 고지혈증',
    damageDetails: '건강검진에서 콜레스테롤 수치 이상이 있었으나 치료나 투약은 없었음.',
    insurerPosition: '건강검진 이상소견 미고지로 계약해지 주장',
    customerStatement: '단순 수치 이상으로 치료 필요성을 듣지 못함',
    adjusterMemo: '검진결과, 재검권유 여부, 투약 여부 확인',
  },
  // D25 minimal
  D25_MIN: {
    insurerName: '한화손해보험',
    insuranceType: '질병보험',
    contractDate: '2019-08-14',
    accidentDate: 'unknown',
    accidentType: '고지의무/계약해지',
    diagnosisText: 'D25',
    damageDetails: '수술비 청구.',
    insurerPosition: '미고지로 계약해지',
    customerStatement: '무증상이었음',
    adjusterMemo: '',
  },
  ASSESS_005: {
    insurerName: 'KB손해보험',
    insuranceType: '실손보험',
    contractDate: '2023-02-01',
    accidentDate: 'unknown',
    accidentType: '고지의무/계약해지',
    diagnosisText: 'K29 위염',
    damageDetails: '보험가입 전 속쓰림으로 내과 1회 치료 후 약 처방. 내시경, 입원, 반복치료 없음.',
    insurerPosition: '최근 3개월 내 내과 진료기록 미고지로 계약해지 주장',
    customerStatement: '일시적 증상으로 생각했고 중요한 병력으로 인식하지 못함',
    adjusterMemo: '1회성 치료인지 반복치료인지 구분',
  },
  ASSESS_011: {
    insurerName: '메리츠화재',
    insuranceType: '실손보험',
    contractDate: '2024-01-30',
    accidentDate: 'unknown',
    accidentType: '고지의무/계약해지',
    diagnosisText: 'M54 요통 / MRI 권유',
    damageDetails: '가입 전 허리통증으로 MRI 권유를 받았으나 실제 검사는 받지 않음.',
    insurerPosition: '정밀검사 권유 사실 미고지로 계약해지 주장',
    customerStatement: '검사를 실제 받지 않았고 단순 권유로 이해함',
    adjusterMemo: '정밀검사 권유가 청약서 질문사항인지 검토',
  },
};

const caseArg = process.argv[2] || 'ASSESS_007';
const payload = TEST_CASES[caseArg];
if (!payload) {
  console.error(`Unknown case: ${caseArg}. Available: ${Object.keys(TEST_CASES).join(', ')}`);
  process.exit(1);
}

async function main() {
  console.log(`Testing ${caseArg}...`);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (authError) throw authError;
  const token = authData.session?.access_token;
  console.log('Auth: OK');

  const url = `${SUPABASE_URL}/functions/v1/create-assessment-draft`;
  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`HTTP ${res.status} in ${elapsed}s`);

  const body = await res.text();
  try {
    const json = JSON.parse(body);
    if (json.error) {
      console.log(`ERROR: "${json.error}"`);
    } else {
      console.log(`SUCCESS: detectedProfile=${json.detectedProfile}`);
      console.log(`  fields: ${Object.keys(json).join(', ')}`);
    }
  } catch {
    console.log(`RAW BODY (${body.length} chars): ${body.slice(0, 500)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
