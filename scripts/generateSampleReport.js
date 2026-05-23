#!/usr/bin/env node
/**
 * 사정서 샘플 생성 통합 스크립트
 *
 * 사용법:
 *   node scripts/generateSampleReport.js ASSESS_035 ASSESS_101
 *   node scripts/generateSampleReport.js --all-cancer   # cancer 케이스 전체
 *
 * 출력:
 *   audit/samples/ASSESS_XXX.md      (덮어쓰기)
 *   audit/samples/ASSESS_XXX_raw.json (덮어쓰기)
 *
 * 파일 상단에 생성일시 + git HEAD 해시 자동 기록
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });
dotenv.config();

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const TEST_EMAIL = process.env.TEST_ADJUSTER_EMAIL;
const TEST_PASSWORD = process.env.TEST_ADJUSTER_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD) {
  console.error('Missing env: SUPABASE_URL/ANON_KEY/TEST_ADJUSTER_EMAIL/TEST_ADJUSTER_PASSWORD');
  process.exit(1);
}

// 케이스 DB 통합 로드 (100건 + 암 전용 파일)
function loadAllCases() {
  const files = [
    'ai_eval/assessment_cases_100_v1.json',
    'ai_eval/assessment_cases_cancer_claim_10_v1.json',
    'ai_eval/assessment_cases_cancer_claim_40_v1.json',
  ];
  const seen = new Set();
  const cases = [];
  for (const f of files) {
    const full = path.resolve(process.cwd(), f);
    if (!fs.existsSync(full)) continue;
    for (const c of JSON.parse(fs.readFileSync(full, 'utf8'))) {
      if (!seen.has(c.id)) { seen.add(c.id); cases.push(c); }
    }
  }
  return cases;
}

function getGitHead() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function buildPayload(tc) {
  const i = tc.input || {};
  return {
    requestId: `sample-${tc.id}-${Date.now()}`,
    caseTitle: i.caseTitle || tc.title || tc.id,
    insurerName: i.insurerName || '',
    insuranceType: i.insuranceType || '',
    contractDate: i.contractDate || 'unknown',
    accidentType: i.accidentType || tc.category || '기타',
    accidentDate: i.accidentDate || 'unknown',
    diagnosisText: i.diagnosisText || i.diagnosisName || i.diagnosisCode || '',
    diagnosisName: i.diagnosisName || '',
    diagnosisCode: i.diagnosisCode || '',
    damageDetails: i.damageDetails || i.damageDescription || '',
    insurerPosition: i.insurerPosition || '',
    customerStatement: i.customerStatement || '',
    adjusterMemo: i.adjusterMemo || '',
    tone: i.tone || 'professional',
    retrievedReferences: [],
  };
}

function flattenRefs(refs) {
  if (!refs) return { official: 0, internal: 0, auxiliary: 0, followUp: 0, list: [] };
  const official = refs.officialReferences || [];
  const internal = refs.internalReviewMaterials || [];
  const auxiliary = refs.auxiliaryReferences || [];
  const followUp = refs.followUpChecks || [];
  const list = [
    ...official.map(r => `[official] ${r.source_area} | ${(r.title || '').slice(0, 80)}`),
    ...internal.map(r => `[internal] ${r.source_area} | ${(r.title || '').slice(0, 80)}`),
  ];
  return { official: official.length, internal: internal.length, auxiliary: auxiliary.length, followUp: followUp.length, list };
}

function buildMarkdown(caseId, tc, result, gitHead) {
  const generatedAt = new Date().toISOString();
  const refs = flattenRefs(result.retrievedReferences);
  const lines = [];

  lines.push(`# 사정서 샘플: ${caseId}`);
  lines.push('');
  lines.push(`생성일시: ${generatedAt}`);
  lines.push(`배포커밋: ${gitHead}`);
  lines.push(`Profile: ${result.detectedProfile || '(없음)'}`);
  lines.push('');
  lines.push('## 입력');
  lines.push(`- **제목**: ${tc.title}`);
  lines.push(`- **진단**: ${(tc.input || {}).diagnosisText || ''}`);
  lines.push(`- **계약일**: ${(tc.input || {}).contractDate || ''}`);
  lines.push('');
  lines.push('## RAG 인용 현황');
  lines.push(`- official ${refs.official}건, internal ${refs.internal}건`);
  for (const r of refs.list) lines.push(`  - ${r}`);
  lines.push('');
  lines.push('## 사정서 전문');
  lines.push('');
  lines.push(result.finalSubmissionAssessmentReport || result.draftBody || '(전문 없음)');
  lines.push('');

  return lines.join('\n');
}

async function main() {
  const allCases = loadAllCases();
  const args = process.argv.slice(2);

  let targetIds;
  if (args.includes('--all-cancer')) {
    targetIds = allCases.filter(c => c.category === '암진단비' || /cancer|암/.test(c.category || '')).map(c => c.id);
    console.log(`암 케이스 ${targetIds.length}건: ${targetIds.join(', ')}`);
  } else {
    targetIds = args.filter(a => !a.startsWith('--'));
    if (!targetIds.length) {
      console.error('사용법: node scripts/generateSampleReport.js ASSESS_035 ASSESS_101 ...');
      process.exit(1);
    }
  }

  const gitHead = getGitHead();
  console.log(`배포 커밋 HEAD: ${gitHead}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: authError } = await supabase.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (authError) throw authError;
  console.log('Auth OK:', TEST_EMAIL);

  const outDir = path.resolve(process.cwd(), 'audit', 'samples');
  fs.mkdirSync(outDir, { recursive: true });

  for (const id of targetIds) {
    const tc = allCases.find(c => c.id === id);
    if (!tc) { console.error(`[${id}] 케이스 없음 — 건너뜀`); continue; }

    console.log(`\n[${id}] 생성 중... (${tc.title})`);
    let result = null;

    for (let attempt = 1; attempt <= 4; attempt++) {
      const { data, error } = await supabase.functions.invoke('create-assessment-draft', {
        body: { ...buildPayload(tc), requestId: `sample-${id}-${Date.now()}` },
      });
      if (!error && data && !data.error) { result = data; break; }
      const msg = error?.message || data?.error || 'unknown';
      console.warn(`  시도 ${attempt}/4 실패: ${msg}`);
      if (attempt < 4) await new Promise(r => setTimeout(r, 6000));
    }

    if (!result) { console.error(`[${id}] 4회 실패. 건너뜀.`); continue; }

    const refs = flattenRefs(result.retrievedReferences);
    console.log(`  Profile: ${result.detectedProfile}`);
    console.log(`  refs: official ${refs.official}, internal ${refs.internal}`);
    console.log(`  report length: ${(result.finalSubmissionAssessmentReport || '').length} chars`);

    const md = buildMarkdown(id, tc, result, gitHead);
    const mdPath = path.join(outDir, `${id}.md`);
    const rawPath = path.join(outDir, `${id}_raw.json`);

    fs.writeFileSync(mdPath, md, 'utf8');
    fs.writeFileSync(rawPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(`  → ${mdPath}`);
  }

  console.log('\n완료.');
}

main().catch(err => { console.error('[fatal]', err); process.exit(1); });
