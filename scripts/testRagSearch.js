const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config({ path: path.resolve(process.cwd(), '.env.rag.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_QUERY = 'M47.26 1회 통원 미고지로 실손보험 계약해지 고지의무 중대한 과실';
const MIN_SIMILARITY = Number(process.env.RAG_TEST_MIN_SIMILARITY || 0.45);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.rag.local');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in .env.rag.local. This key is used only for local RAG search testing.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const sourceAreaLabels = {
  fss_dispute_cases: '금융감독원 분쟁조정례',
  legal_statutes: '법령',
  medical_knowledge: '의료 참고자료',
  precedents: '판례',
  terms_standards: '약관/지급기준',
  issue_playbooks: '내부 쟁점 플레이북',
  medical_issue_codes: '질병코드별 의료쟁점',
  real_case_patterns: '익명 사건 패턴',
  real_case_documents: '익명 문서 요약',
};

const officialSourceAreas = new Set([
  'legal_statutes',
  'terms_standards',
  'fss_dispute_cases',
  'precedents',
]);

const sourceDomainDisplayNames = {
  'law.go.kr': '국가법령정보센터',
  'open.law.go.kr': '국가법령정보 공동활용',
  'fss.or.kr': '금융감독원',
  'fine.fss.or.kr': '금융감독원',
  'fsc.go.kr': '금융위원회',
  'health.kdca.go.kr': '질병관리청 국가건강정보포털',
  'kdca.go.kr': '질병관리청',
  'data.go.kr': '공공데이터포털',
  'hira.or.kr': '건강보험심사평가원',
  'cancer.go.kr': '국가암정보센터',
  'kostat.go.kr': '통계청',
  'carinfo.knia.or.kr': '손해보험협회 자동차보험 종합포털',
  'knia.or.kr': '손해보험협회',
  'klia.or.kr': '생명보험협회',
  'samsungfire.com': '삼성화재',
  'hi.co.kr': '현대해상',
  'hyundai.co.kr': '현대해상',
  'dbins.co.kr': 'DB손해보험',
  'idbins.com': 'DB손해보험',
  'kbinsure.co.kr': 'KB손해보험',
  'meritzfire.com': '메리츠화재',
  'hanwhalife.com': '한화생명',
};

const allowedOfficialDomains = Object.keys(sourceDomainDisplayNames);
const blockedOfficialDomains = [
  'okclaim.com',
  'insclaim.co.kr',
  'blog.naver.com',
  'm.blog.naver.com',
  'tistory.com',
  'brunch.co.kr',
];

const internalReviewSourceAreas = new Set([
  'medical_knowledge',
  'medical_issue_codes',
  'issue_playbooks',
  'real_case_patterns',
  'real_case_documents',
]);

const groupedSearchPlan = [
  { label: '공식 근거 / 법령', source_area: 'legal_statutes', count: 3, section: 'official' },
  { label: '공식 근거 / 약관·지급기준', source_area: 'terms_standards', count: 3, section: 'official' },
  { label: '준공식 근거 / 금감원 분쟁조정례', source_area: 'fss_dispute_cases', count: 3, section: 'official' },
  { label: '공식 근거 / 판례', source_area: 'precedents', count: 3, section: 'official' },
  { label: '의료 검토자료 / 의료지식', source_area: 'medical_knowledge', count: 3, section: 'internal' },
  { label: '의료 검토자료 / 질병코드별 의료쟁점', source_area: 'medical_issue_codes', count: 3, section: 'internal' },
  { label: '내부 검토자료 / 쟁점 플레이북', source_area: 'issue_playbooks', count: 2, section: 'internal' },
  { label: '내부 검토자료 / 익명 사건 패턴', source_area: 'real_case_patterns', count: 2, section: 'internal' },
  { label: '내부 검토자료 / 익명 문서 요약', source_area: 'real_case_documents', count: 2, section: 'internal' },
];

const internalIdPattern = /\b(?:RQ|RSF|RCP|RCD|MIC|PIP|RKA|PST|FSS|PREC|PREC_API|FSS_LATEST)[-_]?\d{3,6}\b/g;
const chunkReferencePattern = /\b(?:medical_issue_code|real_case_pattern|real_case_document|issue_playbook|precedent|fss_latest|terms_raw|fss_dispute_case):[A-Za-z0-9:_-]+\b/g;

function publicText(value) {
  return String(value || '')
    .replace(chunkReferencePattern, '')
    .replace(internalIdPattern, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hostnameFromUrl(sourceUrl) {
  const value = publicText(sourceUrl);
  if (!value) return '';
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function matchDomain(hostname, domains) {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function isBlockedOfficialSource(row) {
  const hostname = hostnameFromUrl(row.source_url);
  return Boolean(hostname && matchDomain(hostname, blockedOfficialDomains));
}

function isAllowedOfficialSource(row) {
  const hostname = hostnameFromUrl(row.source_url);
  if (!hostname) return ['legal_statutes', 'fss_dispute_cases', 'precedents'].includes(row.source_area);
  return matchDomain(hostname, allowedOfficialDomains);
}

function getSourceDisplayName(row) {
  const hostname = hostnameFromUrl(row.source_url);
  if (hostname) {
    const matched = Object.entries(sourceDomainDisplayNames)
      .find(([domain]) => hostname === domain || hostname.endsWith(`.${domain}`));
    if (matched) return matched[1];
  }
  return sourceAreaLabels[row.source_area] || row.source_area || '참고자료';
}

function clip(value, length = 220) {
  const text = publicText(value);
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function extractDiagnosisCodes(query) {
  return Array.from(new Set(String(query).match(/\b[A-Z]\d{2}(?:\.\d{1,3})?\b/g) || []));
}

function parseDate(value) {
  const normalized = publicText(value).replace(/[.\/]/g, '-').match(/\d{4}-\d{1,2}-\d{1,2}|\d{4}년/)?.[0];
  if (!normalized) return null;
  const dateText = normalized.endsWith('년') ? `${normalized.slice(0, 4)}-01-01` : normalized;
  const date = new Date(`${dateText}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function inferIndemnityInsuranceGeneration(contractDate) {
  const date = parseDate(contractDate);
  if (!date) return 'unknown';
  if (date < new Date('2009-10-01T00:00:00Z')) return '1세대';
  if (date < new Date('2017-04-01T00:00:00Z')) return '2세대';
  if (date < new Date('2021-07-01T00:00:00Z')) return '3세대';
  return '4세대';
}

function contextFromQuery(query) {
  const contractDate = publicText(query).match(/\d{4}[년.-](?:\d{1,2}[월.-]?)?(?:\d{1,2}일?)?/)?.[0] || '';
  const insurerName = ['메리츠화재', '삼성화재', '현대해상', 'DB손해보험', 'KB손해보험', '한화생명']
    .find((name) => query.includes(name)) || '';
  const insuranceType = query.includes('실손') ? '실손보험' : '';
  return {
    contractDate,
    insurerName,
    insuranceType,
    policyGeneration: inferIndemnityInsuranceGeneration(contractDate),
    isLifeInsurance: /생명보험|한화생명/.test(query),
    isNonLifeInsurance: /손해보험|화재|실손/.test(query),
  };
}

function rowText(row) {
  return [
    row.title,
    row.summary,
    row.chunk_text,
    row.keywords,
  ].filter(Boolean).join(' ');
}

function exactCodeMatches(row, diagnosisCodes) {
  const text = rowText(row);
  return diagnosisCodes.filter((code) => new RegExp(`(^|[^A-Z0-9.])${code.replace('.', '\\.')}(?=$|[^A-Z0-9.])`).test(text));
}

function hasSimilarButNotExactCode(row, diagnosisCodes) {
  if (!diagnosisCodes.length) return false;
  const text = rowText(row);
  return diagnosisCodes.some((code) => {
    const group = code.split('.')[0];
    return new RegExp(`\\b${group}\\.\\d+\\b`).test(text) && !exactCodeMatches(row, [code]).length;
  });
}

function sourceStatus(row) {
  return row.source_status || row.metadata?.source_status || row.metadata?.sourceStatus || '';
}

function isTitleSeedFss(row) {
  if (row.source_area !== 'fss_dispute_cases') return false;
  const status = sourceStatus(row);
  return status === 'title_seed_needs_full_text'
    || /title_seed_needs_full_text/i.test(rowText(row))
    || /제목 기반|title seed|원문 .*확인|full text/i.test(rowText(row));
}

function displayRole(row) {
  if (officialSourceAreas.has(row.source_area) && !isBlockedOfficialSource(row) && isAllowedOfficialSource(row)) return '공식/준공식 근거';
  if (officialSourceAreas.has(row.source_area)) return '공식근거 제외 출처';
  if (internalReviewSourceAreas.has(row.source_area)) return '내부 검토자료';
  return '기타 참고자료';
}

function scoreRow(row, diagnosisCodes, context = {}) {
  let score = Number(row.similarity || 0);
  if (officialSourceAreas.has(row.source_area) && !isBlockedOfficialSource(row) && isAllowedOfficialSource(row)) score += 0.08;
  if (officialSourceAreas.has(row.source_area) && (isBlockedOfficialSource(row) || !isAllowedOfficialSource(row))) score -= 0.2;
  if (row.source_area === 'issue_playbooks') score -= 0.05;
  if (row.source_area === 'medical_issue_codes') score -= 0.03;
  if (exactCodeMatches(row, diagnosisCodes).length) score += 0.12;
  if (hasSimilarButNotExactCode(row, diagnosisCodes)) score -= 0.08;
  if (isTitleSeedFss(row)) score -= 0.2;
  if (row.source_area === 'terms_standards') {
    const text = rowText(row);
    if (context.insurerName && text.includes(context.insurerName)) score += 0.1;
    if (context.policyGeneration !== 'unknown' && text.includes(context.policyGeneration)) score += 0.08;
    if (context.isLifeInsurance && text.includes('생명보험')) score += 0.05;
    if (context.isNonLifeInsurance && text.includes('손해보험')) score += 0.05;
  }
  return score;
}

function sortRows(rows, diagnosisCodes, context) {
  return [...rows].sort((a, b) => scoreRow(b, diagnosisCodes, context) - scoreRow(a, diagnosisCodes, context));
}

async function createEmbedding(query) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: query,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI embedding failed: ${response.status} ${message.slice(0, 300)}`);
  }

  const json = await response.json();
  const embedding = json.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== 1536) {
    throw new Error(`Unexpected embedding dimension: ${embedding?.length || 0}`);
  }
  return embedding;
}

async function rpcSearch(embedding, matchCount, sourceAreaFilter = null) {
  const { data, error } = await supabase.rpc('match_rag_master_chunks', {
    query_embedding: embedding,
    match_count: matchCount,
    source_area_filter: sourceAreaFilter,
    min_similarity: MIN_SIMILARITY,
  });

  if (error) throw new Error(`match_rag_master_chunks failed: ${error.message}`);
  return enrichRows(data || []);
}

async function enrichRows(rows) {
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (!ids.length) return rows;

  const { data, error } = await supabase
    .from('rag_master_chunks')
    .select('id,source_reference,source_document_id,source_record_id,metadata,review_status,trust_level')
    .in('id', ids);

  if (error) {
    console.warn(`[warn] Could not enrich rows: ${error.message}`);
    return rows;
  }

  const byId = new Map((data || []).map((row) => [row.id, row]));
  return rows.map((row) => ({ ...row, ...(byId.get(row.id) || {}) }));
}

function printRow(row, index, diagnosisCodes, context) {
  const exact = exactCodeMatches(row, diagnosisCodes);
  const similarOnly = hasSimilarButNotExactCode(row, diagnosisCodes);
  const titleSeed = isTitleSeedFss(row);

  console.log(`\n[${index + 1}] similarity=${Number(row.similarity || 0).toFixed(4)} adjusted=${scoreRow(row, diagnosisCodes, context).toFixed(4)}`);
  console.log(`role=${displayRole(row)}`);
  console.log(`source_area=${sourceAreaLabels[row.source_area] || row.source_area || '(empty)'}`);
  if (exact.length) console.log(`diagnosis_code_match=exact:${exact.join(',')}`);
  if (similarOnly) console.log('diagnosis_code_match=similar_code_only');
  if (titleSeed) console.log('fss_status=title_seed_needs_full_text (공식근거 후보에서 낮은 우선순위)');
  console.log(`title=${publicText(row.title) || '(empty)'}`);
  console.log(`summary=${clip(row.summary || row.chunk_text)}`);
  console.log(`source=${getSourceDisplayName(row)}`);
}

function printSection(title, rows, diagnosisCodes, context) {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  if (!rows.length) {
    console.log('No results.');
    return;
  }
  rows.forEach((row, index) => printRow(row, index, diagnosisCodes, context));
}

async function main() {
  const query = process.argv.slice(2).join(' ').trim() || DEFAULT_QUERY;
  const diagnosisCodes = extractDiagnosisCodes(query);
  const context = contextFromQuery(query);
  console.log(`Query: ${query}`);
  console.log(`Diagnosis codes in query: ${diagnosisCodes.join(', ') || '(none)'}`);
  console.log(`Policy context: insurer=${context.insurerName || '(unknown)'} contractDate=${context.contractDate || '(unknown)'} indemnityGeneration=${context.policyGeneration}`);
  console.log(`Min similarity: ${MIN_SIMILARITY}`);

  const embedding = await createEmbedding(query);

  const integratedRows = sortRows(await rpcSearch(embedding, 30, null), diagnosisCodes, context).slice(0, 10);
  printSection('통합 top10 (adjusted ranking preview)', integratedRows, diagnosisCodes, context);

  const groupedResults = [];
  for (const plan of groupedSearchPlan) {
    const rows = sortRows(await rpcSearch(embedding, Math.max(plan.count * 4, 10), plan.source_area), diagnosisCodes, context);
    const filtered = rows
      .filter((row) => !(plan.section === 'official' && isTitleSeedFss(row)))
      .filter((row) => !(plan.section === 'official' && isBlockedOfficialSource(row)))
      .filter((row) => !(plan.section === 'official' && !isAllowedOfficialSource(row)))
      .slice(0, plan.count);
    const titleSeeds = rows.filter(isTitleSeedFss).slice(0, 2);
    groupedResults.push({ ...plan, rows: filtered, titleSeeds });
  }

  const officialRows = groupedResults
    .filter((group) => group.section === 'official')
    .flatMap((group) => group.rows.map((row) => ({ ...row, group_label: group.label })));
  const internalRows = groupedResults
    .filter((group) => group.section === 'internal')
    .flatMap((group) => group.rows.map((row) => ({ ...row, group_label: group.label })));

  printSection('공식/준공식 근거 grouped search', officialRows, diagnosisCodes, context);
  printSection('의료/내부 검토자료 grouped search', internalRows, diagnosisCodes, context);

  const titleSeedRows = groupedResults.flatMap((group) => group.titleSeeds);
  printSection('금감원 title seed 보조 결과 (공식근거 후보 제외)', titleSeedRows, diagnosisCodes, context);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
