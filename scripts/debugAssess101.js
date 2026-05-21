/**
 * ASSESS_101 end-to-end RAG trace script
 * Checks if 2013다208661 ends up in officialReferences after all filters
 */
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const MIN_SIMILARITY = 0.45;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OPENAI_API_KEY) {
  console.error('Missing env vars');
  process.exit(1);
}

// ASSESS_101 input
const input = {
  insurerName: '[보험사]',
  insuranceType: '급성심근경색 진단비',
  contractDate: '2022-03-01',
  accidentType: '급성심근경색 진단비',
  diagnosisText: 'I21.4 급성 심내막하심근경색증 (NSTEMI)',
  damageDetails: 'D-44: 흉통 발생으로 내원. D-30: 운동부하검사(TMT) ST depression 확인. D-22: 관상동맥 CT — Ca score 532.9, LM 협착 >90%, LAD 70%, LCx >70%. D-1: 관상동맥조영술(CAG) + PCI(스텐트 삽입) — LM-LAD 협착 95% 확인. CAG 시행 전 혈액검사: CK-MB 2.1, Troponin T 0.021. 이후 외래 SOAP 기록: hs-troponin 0.037, 주치의 소견 「cardiac marker 상승, EKG로 UA-NSTEMI 진단서 가능」. 담당 전문의 I21.4 (NSTEMI) 진단서 발급.',
  insurerPosition: '흉통 발생 이후 관상동맥조영술 시행 전까지 시행한 혈액검사상 심근효소 상승이 확인되지 않아, 심근경색까지 진행하지 않은 것으로 검토되는 바, 급성 심내막하심근경색증(I21.4) 진단 불인 의견, 죽상경화성 심장병(I25.1) 진단 인정 의견',
  customerStatement: '전문의 진단서와 SOAP 기록, 심근효소 수치, 심전도 소견이 모두 일치하며, 주치의가 직접 NSTEMI 진단서 발급 의사를 SOAP 기록에 명시하였음',
  adjusterMemo: '결정적 증거: 외래 SOAP 기록(\"cardiac marker 상승, EKG로 UA-NSTEMI 진단서 가능\"). 보험사는 CAG 시행 전 단일 시점 심근효소 수치만 문제 삼으나, Fourth Universal Definition of Myocardial Infarction 2018 기준 적용 시 요건 충족. 대법원 2013다208661 역공 논리 필수.',
};

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
  return publicText(row.review_status) || metadataValue(row, 'review_status');
}

function sourceStatus(row) {
  return metadataValue(row, 'source_status') || metadataValue(row, 'sourceStatus');
}

function officialCitationAllowed(row) {
  return metadataBoolean(row, 'official_citation_allowed') || metadataBoolean(row, 'officialCitationAllowed');
}

function officialCitationDenied(row) {
  const snakeValue = row.metadata?.official_citation_allowed;
  const camelValue = row.metadata?.officialCitationAllowed;
  return snakeValue === false || camelValue === false
    || (typeof snakeValue === 'string' && snakeValue.toLowerCase() === 'false')
    || (typeof camelValue === 'string' && camelValue.toLowerCase() === 'false');
}

function trustLevel(row) {
  return publicText(row.trust_level);
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

function isAllowedOfficialSource(row) {
  if (row.source_area === 'legal_statutes' || row.source_area === 'fss_dispute_cases' || row.source_area === 'precedents') {
    const hostname = row.source_url ? (() => { try { return new URL(row.source_url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } })() : '';
    if (!hostname) return true; // no URL = allowed for these areas
  }
  return false;
}

function isOfficialReference(row) {
  if (officialCitationDenied(row)) return false;
  if (row.source_area === 'precedents') return strongPrecedentCitation(row);
  return false;
}

function isAcuteMiPrecedentReference(ref) {
  const text = [
    ref.source_area,
    ref.source_area_label || '',
    ref.title,
    ref.summary,
    ref.case_number,
    ref.court_or_agency,
    ref.diagnosis_code,
    ref.diagnosis_name,
  ].filter(Boolean).join(' ');
  if (/형사|횡령|배임|허위진단서|허위\s*진단서|요추부골절|요추|정형외과|골절|상해진단서|사기/i.test(text)) return false;
  return /급성심근경색|심근경색|허혈성심장질환|협심증|진단비|심전도|심근효소|troponin|트로포닌|관상동맥|CAG|PCI|I21|I20|I25/i.test(text);
}

async function createEmbedding(text) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
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
    body: JSON.stringify({
      query_embedding: embedding,
      match_count: matchCount,
      source_area_filter: sourceArea,
      min_similarity: MIN_SIMILARITY,
    }),
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

// Build query similar to what the Edge Function does for ASSESS_101
const queryParts = [
  JSON.stringify(input).slice(0, 2500),
  '보험종류 급성심근경색 진단비',
  '보험가입일 2022-03-01',
  '추정 실손보험 4세대',
  '가입 당시 약관 질병분류표 장해분류표 적용기간',
  'I21.4 NSTEMI 급성심근경색 심내막하심근경색 트로포닌 CAG PCI 관상동맥조영술',
];
const query = queryParts.filter(Boolean).join(' ').slice(0, 3000);

async function main() {
  console.log('=== ASSESS_101 RAG Trace ===\n');
  console.log('Query (first 300 chars):', query.substring(0, 300), '...\n');

  // Step 1: Create embedding
  console.log('[Step 1] Creating embedding...');
  const embedding = await createEmbedding(query);
  console.log('Embedding created (first 5 dims):', embedding.slice(0, 5));

  // Step 2: Search precedents
  console.log('\n[Step 2] Searching precedents...');
  const rawRows = await rpcSearch(embedding, 'precedents', 6); // count*2 = 6
  console.log(`Got ${rawRows.length} rows from RPC`);

  // Step 3: Enrich rows
  const ids = rawRows.map(r => r.id);
  const enriched = await enrichRows(ids);
  const enrichedMap = new Map(enriched.map(r => [r.id, r]));
  const rows = rawRows.map(r => ({ ...r, ...(enrichedMap.get(r.id) || {}) }));

  // Step 4: Filter release + check each row
  console.log('\n[Step 3] Row analysis:');
  for (const row of rows) {
    const isActive = isActiveRelease(row);
    const isOfficial = isOfficialReference(row);
    const isAcuteMi = isOfficial && isAcuteMiPrecedentReference({
      source_area: row.source_area,
      source_area_label: '판례',
      title: row.title,
      summary: row.summary,
      case_number: metadataValue(row, 'case_number'),
      court_or_agency: metadataValue(row, 'court') || metadataValue(row, 'court_or_agency'),
      diagnosis_code: metadataValue(row, 'diagnosis_code'),
      diagnosis_name: metadataValue(row, 'diagnosis_name'),
    });
    const has2013 = [row.title, row.summary, row.chunk_text, JSON.stringify(row.metadata)].join(' ').includes('2013다208661');
    console.log(`\n  ID: ${row.id}`);
    console.log(`  Title: ${(row.title || '').substring(0, 80)}`);
    console.log(`  Similarity: ${row.similarity?.toFixed(4)}`);
    console.log(`  source_status: ${metadataValue(row, 'source_status')}`);
    console.log(`  review_status: ${row.review_status || metadataValue(row, 'review_status')}`);
    console.log(`  official_citation_allowed: ${metadataBoolean(row, 'official_citation_allowed')}`);
    console.log(`  trust_level: ${row.trust_level}`);
    console.log(`  release_stage: ${metadataValue(row, 'release_stage') || '(null)'}`);
    console.log(`  isActiveRelease: ${isActive}`);
    console.log(`  isOfficialReference: ${isOfficial}`);
    console.log(`  isAcuteMiPrecedent: ${isAcuteMi}`);
    console.log(`  has 2013다208661: ${has2013}`);
    if (has2013) {
      console.log('  *** THIS IS THE TARGET ROW ***');
    }
  }

  // Step 5: Filter to officialRows
  const diagnosisCodes = ['I21.4'];
  const officialRows = [];
  for (const row of rows) {
    if (!isActiveRelease(row)) continue;
    if (!isOfficialReference(row)) continue;

    // isAcuteMiPrecedentReference check (from sanitizeRagResultForAssessment line 3640)
    const ref = {
      source_area: row.source_area,
      source_area_label: '판례',
      title: publicText(row.title),
      summary: publicText(row.summary || row.chunk_text || '').slice(0, 500),
      case_number: publicText(metadataValue(row, 'case_number')),
      court_or_agency: publicText(metadataValue(row, 'court') || metadataValue(row, 'court_or_agency')),
      diagnosis_code: publicText(metadataValue(row, 'diagnosis_code')),
      diagnosis_name: publicText(metadataValue(row, 'diagnosis_name')),
    };
    if (!isAcuteMiPrecedentReference(ref)) {
      console.log(`\nFiltered by isAcuteMiPrecedentReference: ${row.title?.substring(0, 60)}`);
      continue;
    }
    officialRows.push(row);
  }

  console.log(`\n[Step 4] officialRows for precedents: ${officialRows.length}`);
  for (const row of officialRows) {
    console.log(`  - ${(row.title || '').substring(0, 100)}`);
    console.log(`    case_number: ${metadataValue(row, 'case_number')}`);
  }

  const has2013inOfficial = officialRows.some(r => {
    const cn = metadataValue(r, 'case_number');
    return cn.includes('2013다208661') || (r.title || '').includes('2013다208661');
  });
  console.log(`\n[RESULT] 2013다208661 in officialRows: ${has2013inOfficial}`);

  if (has2013inOfficial) {
    console.log('\n=== 2013다208661 IS in officialRows ===');
    console.log('Issue must be in prompt formatting or GPT not using it.');
  } else {
    console.log('\n=== 2013다208661 NOT in officialRows — search/filter issue ===');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
