/**
 * Simulates the exact Edge Function query for ASSESS_101 and shows top precedent rows.
 */
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const MIN_SIMILARITY = 0.45;

// Mirrors publicText from ragSearch.ts
function publicText(value) {
  const internalIdPattern = /\b(?:RQ|RSF|RCP|RCD|MIC|PIP|RKA|PST|FSS|PREC|PREC_API|FSS_LATEST)[-_]?\d{3,6}\b/g;
  const chunkReferencePattern = /\b(?:medical_issue_code|real_case_pattern|real_case_document|issue_playbook|practice_playbook|precedent|fss_latest|terms_raw|fss_dispute_case):[A-Za-z0-9:_-]+\b/g;
  const internalSourceTypePattern = /\binternal_[A-Za-z0-9_:-]*\b/g;
  return String(value || '')
    .replace(chunkReferencePattern, '')
    .replace(internalIdPattern, '')
    .replace(internalSourceTypePattern, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ASSESS_101 input (from evalAssessmentDrafts)
const input = {
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

// ACUTE_MI_POLICY_SEARCH_TERMS (from create-assessment-draft/index.ts)
const ACUTE_MI_POLICY_SEARCH_TERMS = [
  '급성심근경색', '급성 심근경색', '급성심근경색증진단', '심근경색증진단', '허혈심장질환',
];

// Build the same query as the Edge Function
const baseQuery = publicText(JSON.stringify(input)).slice(0, 2500);
const contextParts = [
  `보험회사 ${input.insurerName}`,
  `보험종류 ${input.insuranceType}`,
  `보험가입일 ${input.contractDate}`,
].join(' ');
const query = [baseQuery, contextParts, ACUTE_MI_POLICY_SEARCH_TERMS.join(' ')].join('\n');

console.log('Query preview (first 300 chars):', query.substring(0, 300));
console.log('Query length:', query.length);
console.log('Contains 2013다208661:', query.includes('2013다208661'));

function metadataValue(row, key) {
  const value = row.metadata?.[key];
  return typeof value === 'string' ? value : '';
}
function metadataBoolean(row, key) {
  const value = row.metadata?.[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
}
function reviewStatus(row) {
  return publicText(row.review_status) || metadataValue(row, 'review_status') || metadataValue(row, 'reviewStatus');
}
function sourceStatus(row) {
  return metadataValue(row, 'source_status') || metadataValue(row, 'sourceStatus');
}
function officialCitationAllowed(row) {
  return metadataBoolean(row, 'official_citation_allowed') || metadataBoolean(row, 'officialCitationAllowed');
}
function officialCitationDenied(row) {
  const s = row.metadata?.official_citation_allowed;
  const c = row.metadata?.officialCitationAllowed;
  return s === false || c === false
    || (typeof s === 'string' && s.toLowerCase() === 'false')
    || (typeof c === 'string' && c.toLowerCase() === 'false');
}
function releaseStage(row) {
  return metadataValue(row, 'release_stage') || metadataValue(row, 'releaseStage');
}
function isActiveRelease(row) {
  const stage = releaseStage(row);
  return !stage || stage === 'active' || metadataBoolean(row, 'is_active') || metadataBoolean(row, 'isActive');
}
function strongPrecedentCitation(row) {
  if (row.source_area !== 'precedents') return false;
  return sourceStatus(row) === 'official_law_api_full_text'
    || (reviewStatus(row) === 'reviewed' && officialCitationAllowed(row));
}
function isOfficialReference(row) {
  if (officialCitationDenied(row)) return false;
  if (row.source_area === 'precedents') return strongPrecedentCitation(row);
  return false;
}
function rowText(row) {
  return [row.title, row.summary, row.chunk_text].filter(Boolean).join(' ');
}
function administrativePrecedentText(row) {
  return /산업재해보상보험|산재보험|근로복지공단|업무상\s*재해|재해근로자|장해보상연금|휴업급여|요양급여|평균임금정정|보험급여차액|장기요양|건강보험약제|급여비용|환수결정처분|보험료부과처분취소|국민건강보험공단|건강보험심사평가원|부당해고|구제재심판정취소|요양불승인|행정처분취소/i.test(rowText(row));
}

async function createEmbedding(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 7000) }),
  });
  const data = await res.json();
  return data.data[0].embedding;
}

async function rpcSearch(embedding, sourceArea, matchCount) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_rag_master_chunks`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query_embedding: embedding, match_count: matchCount, source_area_filter: sourceArea, min_similarity: MIN_SIMILARITY }),
  });
  if (!res.ok) throw new Error(`RPC failed: ${res.status}`);
  return res.json();
}

async function enrichRows(ids) {
  if (!ids.length) return [];
  const quoted = ids.map(id => `"${id}"`).join(',');
  const select = 'id,source_type,source_reference,source_document_id,source_record_id,metadata,review_status,trust_level';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rag_master_chunks?select=${select}&id=in.(${quoted})`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) return [];
  return res.json();
}

async function main() {
  console.log('\n=== Diagnosing exact Edge Function query for ASSESS_101 ===\n');

  console.log('[1] Creating embedding for actual Edge Function query...');
  const embedding = await createEmbedding(query);
  console.log('Done.\n');

  console.log('[2] Fetching top 6 precedent rows (count*2)...');
  const rawRows = await rpcSearch(embedding, 'precedents', 6);
  const enriched = await enrichRows(rawRows.map(r => r.id));
  const enrichedMap = new Map(enriched.map(r => [r.id, r]));
  const rows = rawRows.map(r => ({ ...r, ...(enrichedMap.get(r.id) || {}) }));
  console.log(`Got ${rows.length} rows\n`);

  console.log('[3] Row analysis:');
  let officialCount = 0;
  for (const row of rows) {
    const isActive = isActiveRelease(row);
    const isOfficial = isOfficialReference(row);
    const isAdmin = administrativePrecedentText(row);
    const qualifiesOfficial = isActive && isOfficial && !isAdmin;
    const has2013 = JSON.stringify(row).includes('2013다208661');

    console.log(`\n  Rank ${rows.indexOf(row)+1}: similarity=${row.similarity?.toFixed(4)}`);
    console.log(`  Title: ${(row.title || '').substring(0, 80)}`);
    console.log(`  case_number: ${metadataValue(row, 'case_number')}`);
    console.log(`  source_status: ${metadataValue(row, 'source_status')}`);
    console.log(`  review_status: ${row.review_status}`);
    console.log(`  official_citation_allowed: ${row.metadata?.official_citation_allowed}`);
    console.log(`  isActiveRelease: ${isActive}`);
    console.log(`  isOfficialReference: ${isOfficial}`);
    console.log(`  isAdminPrecedent: ${isAdmin}`);
    console.log(`  qualifiesForOfficialSlot: ${qualifiesOfficial}`);
    if (has2013) console.log(`  *** HAS 2013다208661 ***`);

    if (qualifiesOfficial) {
      officialCount++;
      if (officialCount <= 3) {
        console.log(`  => SLOT ${officialCount}/3 - INCLUDED in officialRows`);
      } else {
        console.log(`  => SLOT FULL (>3) - EXCLUDED`);
      }
    }
  }

  console.log('\n[4] Summary:');
  console.log(`  Official precedent slots used: ${Math.min(officialCount, 3)}/3`);
  const target = rows.find(r => JSON.stringify(r).includes('2013다208661'));
  if (target) {
    const idx = rows.indexOf(target);
    console.log(`  2013다208661 rank: ${idx+1}`);
    console.log(`  2013다208661 isOfficialReference: ${isOfficialReference(target)}`);
    console.log(`  2013다208661 qualifies: ${isActiveRelease(target) && isOfficialReference(target) && !administrativePrecedentText(target)}`);
  } else {
    console.log(`  2013다208661 NOT in top-6 results!`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
