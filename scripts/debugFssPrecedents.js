/**
 * Simulates officialGroundsByArea and fssPrecedents for ASSESS_101
 * to check if 2013다208661 appears in the generated text
 */
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const MIN_SIMILARITY = 0.45;

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

function cleanPublicText(value) {
  const INTERNAL_ID_PATTERN = /\b(?:RQ|RSF|RCP|RCD|MIC|PIP|RKA|PST|FSS|PREC|PREC_API|FSS_LATEST)[-_]?\d{3,6}\b/g;
  const CHUNK_REFERENCE_PATTERN = /\b(?:medical_issue_code|real_case_pattern|real_case_document|issue_playbook|precedent|fss_latest|terms_raw|fss_dispute_case):[A-Za-z0-9:_-]+\b/g;
  const INTERNAL_FIELD_LINE_PATTERN = /^\s*(?:chunk_id|source_id|record_id|source_record_id|source_document_id|embedding_status|review_status|trust_level|source_type)\s*[:=].*$/gim;
  const INTERNAL_SOURCE_TYPE_PATTERN = /\binternal_[A-Za-z0-9_:-]*\b/g;
  return String(value || '').trim()
    .replace(INTERNAL_FIELD_LINE_PATTERN, '')
    .replace(CHUNK_REFERENCE_PATTERN, '')
    .replace(INTERNAL_ID_PATTERN, '')
    .replace(INTERNAL_SOURCE_TYPE_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
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
  return metadataValue(row, 'source_status');
}

function officialCitationAllowed(row) {
  return metadataBoolean(row, 'official_citation_allowed');
}

function officialCitationDenied(row) {
  const v = row.metadata?.official_citation_allowed;
  return v === false || (typeof v === 'string' && v.toLowerCase() === 'false');
}

function releaseStage(row) {
  return metadataValue(row, 'release_stage');
}

function isActiveRelease(row) {
  const stage = releaseStage(row);
  return !stage || stage === 'active' || metadataBoolean(row, 'is_active');
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

// referenceDisplayName for precedents
function referenceDisplayName(ref) {
  const caseNumber = cleanPublicText(ref.case_number);
  const court = cleanPublicText(ref.court_or_agency);
  const decisionDate = cleanPublicText(ref.decision_date);
  if (ref.source_area === 'precedents') {
    if (caseNumber && court && decisionDate) return `${court} ${decisionDate} 선고 ${caseNumber} 판결`;
    return ref.title ? `${ref.title}(사건번호·법원·선고일자 추가 확인 필요)` : '관련 판례 추가 확인 필요';
  }
  return ref.title || '';
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
    body: JSON.stringify({ query_embedding: embedding, match_count: matchCount, source_area_filter: sourceArea, min_similarity: MIN_SIMILARITY }),
  });
  if (!res.ok) throw new Error(`RPC failed: ${res.status}`);
  return res.json();
}

async function enrichRows(ids) {
  if (!ids.length) return [];
  const quoted = ids.map(id => `"${id}"`).join(',');
  const select = 'id,source_type,source_reference,metadata,review_status,trust_level';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rag_master_chunks?select=${select}&id=in.(${quoted})`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) return [];
  return res.json();
}

// Convert row to reference (simplified version of toReference)
function toReference(row) {
  const metadata = row.metadata || {};
  const clip500 = (v) => {
    const t = publicText(v);
    return t.length > 500 ? t.slice(0, 500) + '...' : t;
  };
  return {
    reference_type: 'official',
    source_area: row.source_area,
    source_area_label: '판례',
    title: publicText(row.title).slice(0, 180),
    summary: clip500(row.summary || row.chunk_text),
    case_number: publicText(metadata.case_number),
    court_or_agency: publicText(metadata.court || metadata.court_or_agency),
    decision_date: publicText(metadata.decision_date),
    official_citation_allowed: metadataBoolean(metadata, 'official_citation_allowed') ||
      (metadata.official_citation_allowed === true),
    keyHolding: publicText(metadata.key_holding || metadata.keyHolding),
    excerpt: publicText(metadata.excerpt),
    applicableReason: publicText(metadata.applicable_reason || metadata.applicableReason),
  };
}

async function main() {
  console.log('=== fssPrecedents Simulation for ASSESS_101 ===\n');

  const query = '급성심근경색 NSTEMI I21.4 심근경색 진단확정 보험금 트로포닌 CAG PCI 부지급 증명책임';

  // Create embedding
  console.log('[1] Creating embedding...');
  const embedding = await createEmbedding(query);
  console.log('Done.\n');

  // Search precedents (count=3, so fetch 6)
  console.log('[2] Fetching precedents...');
  const rawRows = await rpcSearch(embedding, 'precedents', 6);
  const enriched = await enrichRows(rawRows.map(r => r.id));
  const enrichedMap = new Map(enriched.map(r => [r.id, r]));
  const rows = rawRows.map(r => ({ ...r, ...(enrichedMap.get(r.id) || {}) }));
  console.log(`Got ${rows.length} precedent rows\n`);

  // Filter and convert to references
  const officialRefs = rows
    .filter(r => isActiveRelease(r) && isOfficialReference(r))
    .slice(0, 3)
    .map(toReference);

  console.log(`[3] Official precedent refs (${officialRefs.length}):`);
  for (const ref of officialRefs) {
    console.log(`  case_number: ${ref.case_number}`);
    console.log(`  court: ${ref.court_or_agency}`);
    console.log(`  date: ${ref.decision_date}`);
    console.log(`  displayName: ${referenceDisplayName(ref)}`);
    console.log();
  }

  // Simulate officialGroundsByArea.precedents
  const lines = officialRefs.map(ref => {
    const name = referenceDisplayName(ref);
    const summary = cleanPublicText(ref.keyHolding || ref.summary || ref.excerpt || ref.applicableReason);
    return `- ${name}${summary ? `: ${summary.slice(0, 100)}...` : ''}`;
  });

  console.log('[4] fssPrecedents output:');
  const fssPrecedents = lines.length
    ? `판례:\n${lines.join('\n')}`
    : '판례: 직접 적용 가능한 판례는 확인되지 않았습니다.';
  console.log(fssPrecedents);

  console.log('\n[5] Contains 2013다208661:', fssPrecedents.includes('2013다208661'));
  console.log('[6] Contains 대법원:', fssPrecedents.includes('대법원'));

  // Test cleanPublicText on the display name
  const displayName = '대법원 2014-06-12 선고 2013다208661 판결';
  const cleaned = cleanPublicText(displayName);
  console.log('\n[7] cleanPublicText("대법원 2014-06-12 선고 2013다208661 판결"):', JSON.stringify(cleaned));
  console.log('[8] cleaned still has 2013다208661:', cleaned.includes('2013다208661'));
}

main().catch(e => { console.error(e); process.exit(1); });
