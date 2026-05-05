const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_API_URL = 'https://api.openai.com/v1/embeddings';
const MIN_SIMILARITY = 0.45;

export interface RetrievedReference {
  reference_type: 'official' | 'internal';
  source_area: string;
  source_area_label: string;
  title: string;
  summary?: string;
  source_url?: string;
  sourceDisplayName?: string;
  similarity?: number;
  case_number?: string;
  court_or_agency?: string;
  decision_date?: string;
  law_name?: string;
  article_title?: string;
  diagnosis_code?: string;
  diagnosis_name?: string;
  note?: string;
}

export interface RagSearchResult {
  query: string;
  officialReferences: RetrievedReference[];
  internalReviewMaterials: RetrievedReference[];
}

interface RpcRow {
  id: string;
  source_area: string;
  source_type?: string;
  title?: string;
  summary?: string;
  chunk_text?: string;
  keywords?: string;
  source_url?: string;
  trust_level?: string;
  similarity?: number;
}

interface EnrichedRow extends RpcRow {
  metadata?: Record<string, unknown>;
  review_status?: string;
  source_reference?: string;
  source_document_id?: string;
  source_record_id?: string;
}

const sourceAreaLabels: Record<string, string> = {
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

const sourceDomainDisplayNames: Record<string, string> = {
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

const searchPlan = [
  { source_area: 'legal_statutes', count: 3 },
  { source_area: 'terms_standards', count: 3 },
  { source_area: 'fss_dispute_cases', count: 3 },
  { source_area: 'precedents', count: 3 },
  { source_area: 'medical_knowledge', count: 3 },
  { source_area: 'medical_issue_codes', count: 3 },
  { source_area: 'issue_playbooks', count: 2 },
  { source_area: 'real_case_patterns', count: 2 },
  { source_area: 'real_case_documents', count: 2 },
];

const internalIdPattern = /\b(?:RQ|RSF|RCP|RCD|MIC|PIP|RKA|PST|FSS|PREC|PREC_API|FSS_LATEST)[-_]?\d{3,6}\b/g;
const chunkReferencePattern = /\b(?:medical_issue_code|real_case_pattern|real_case_document|issue_playbook|precedent|fss_latest|terms_raw|fss_dispute_case):[A-Za-z0-9:_-]+\b/g;
const internalSourceTypePattern = /\binternal_[A-Za-z0-9_:-]*\b/g;

function publicText(value: unknown) {
  return String(value || '')
    .replace(chunkReferencePattern, '')
    .replace(internalIdPattern, '')
    .replace(internalSourceTypePattern, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hostnameFromUrl(sourceUrl: unknown) {
  const value = publicText(sourceUrl);
  if (!value) return '';
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function matchDomain(hostname: string, domains: string[]) {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function isBlockedOfficialSource(row: EnrichedRow) {
  const hostname = hostnameFromUrl(row.source_url);
  return Boolean(hostname && matchDomain(hostname, blockedOfficialDomains));
}

function isAllowedOfficialSource(row: EnrichedRow) {
  const hostname = hostnameFromUrl(row.source_url);
  if (!hostname) {
    return row.source_area === 'legal_statutes'
      || row.source_area === 'fss_dispute_cases'
      || row.source_area === 'precedents';
  }
  return matchDomain(hostname, allowedOfficialDomains);
}

function getSourceDisplayName(sourceUrl: unknown, sourceArea?: string, title?: unknown) {
  const hostname = hostnameFromUrl(sourceUrl);
  if (hostname) {
    const matched = Object.entries(sourceDomainDisplayNames)
      .find(([domain]) => hostname === domain || hostname.endsWith(`.${domain}`));
    if (matched) return matched[1];
  }
  const areaDisplayNames: Record<string, string> = {
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
  if (sourceArea && areaDisplayNames[sourceArea]) return areaDisplayNames[sourceArea];
  if (sourceArea && sourceAreaLabels[sourceArea]) return sourceAreaLabels[sourceArea];
  const safeTitle = publicText(title);
  if (/상법|민법|보험업법|법령|조문/.test(safeTitle)) return '국가법령정보센터';
  if (/금융감독원|분쟁조정/.test(safeTitle)) return '금융감독원';
  if (/질병관리청|국가건강정보/.test(safeTitle)) return '질병관리청 국가건강정보포털';
  return sourceArea || '참고자료';
}

function clip(value: unknown, maxLength = 700) {
  const text = publicText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function restHeaders(serviceRoleKey: string) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
}

function extractDiagnosisCodes(query: string) {
  return Array.from(new Set(query.match(/\b[A-Z]\d{2}(?:\.\d{1,3})?\b/g) || []));
}

function rowText(row: RpcRow) {
  return [row.title, row.summary, row.chunk_text, row.keywords].filter(Boolean).join(' ');
}

function exactCodeMatches(row: RpcRow, diagnosisCodes: string[]) {
  const text = rowText(row);
  return diagnosisCodes.filter((code) => new RegExp(`(^|[^A-Z0-9.])${code.replace('.', '\\.')}(?=$|[^A-Z0-9.])`).test(text));
}

function hasSimilarButNotExactCode(row: RpcRow, diagnosisCodes: string[]) {
  if (!diagnosisCodes.length) return false;
  const text = rowText(row);
  return diagnosisCodes.some((code) => {
    const group = code.split('.')[0];
    return new RegExp(`\\b${group}\\.\\d+\\b`).test(text) && !exactCodeMatches(row, [code]).length;
  });
}

function metadataValue(row: EnrichedRow, key: string) {
  const value = row.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

function sourceStatus(row: EnrichedRow) {
  return metadataValue(row, 'source_status') || metadataValue(row, 'sourceStatus');
}

function isTitleSeedFss(row: EnrichedRow) {
  if (row.source_area !== 'fss_dispute_cases') return false;
  const text = rowText(row);
  const status = sourceStatus(row);
  return status === 'title_seed_needs_full_text'
    || /title_seed_needs_full_text/i.test(text)
    || /제목 기반|title seed|원문 .*확인|full text/i.test(text)
    || /제목 기반|title seed|원문 .*확인|full text/i.test(text);
}

function isOfficialReference(row: EnrichedRow) {
  if (isBlockedOfficialSource(row) || !isAllowedOfficialSource(row)) return false;
  if (row.source_area === 'legal_statutes' || row.source_area === 'terms_standards') return true;
  if (row.source_area === 'fss_dispute_cases') {
    return sourceStatus(row) === 'official_fss_full_text';
  }
  if (row.source_area === 'precedents') {
    return sourceStatus(row) === 'official_law_api_full_text';
  }
  return false;
}

function isInternalReviewMaterial(row: EnrichedRow) {
  return ['issue_playbooks', 'medical_issue_codes', 'real_case_patterns', 'real_case_documents', 'medical_knowledge'].includes(row.source_area)
    || String(row.source_type || '').startsWith('internal_');
}

function scoreRow(row: EnrichedRow, diagnosisCodes: string[]) {
  let score = Number(row.similarity || 0);
  if (isOfficialReference(row)) score += 0.08;
  if (row.source_area === 'issue_playbooks') score -= 0.05;
  if (row.source_area === 'medical_issue_codes') score -= 0.03;
  if (exactCodeMatches(row, diagnosisCodes).length) score += 0.12;
  if (hasSimilarButNotExactCode(row, diagnosisCodes)) score -= 0.08;
  if (isTitleSeedFss(row)) score -= 0.2;
  return score;
}

function isDirectlyRelevantTerms(row: EnrichedRow, query: string) {
  if (row.source_area !== 'terms_standards') return true;
  const text = rowText(row);
  const queryText = query.replace(/\s+/g, ' ');
  const diagnosisCodes = extractDiagnosisCodes(query);
  if (diagnosisCodes.length && exactCodeMatches(row, diagnosisCodes).length) return true;

  const normalizedIssueGroups = [
    {
      query: /고지|알릴|미고지|계약해지|중요한 사항|중대한 과실/,
      terms: /고지|알릴|미고지|계약해지|해지|질문사항|중요한 사항|중대한 과실/,
    },
    {
      query: /도수|백내장|다초점|요양병원|비급여|주사|체외충격파|치료목적/,
      terms: /도수|백내장|다초점|요양병원|비급여|주사|체외충격파|치료목적|보상하지/,
    },
    {
      query: /후유장해|장해|지급률|운동범위|동요관절/,
      terms: /후유장해|장해|지급률|운동범위|동요|장해분류표/,
    },
    {
      query: /암|뇌경색|뇌출혈|심근경색|협심증|진단비|경계성|제자리/,
      terms: /암|뇌경색|뇌출혈|심근경색|협심증|진단비|경계성|제자리|진단확정/,
    },
    {
      query: /면책|자살|이륜|통지의무|책임개시|설명의무/,
      terms: /면책|자살|이륜|통지의무|책임개시|설명의무|보상하지/,
    },
  ];
  const normalizedMatchedGroups = normalizedIssueGroups.filter((group) => group.query.test(queryText));
  if (normalizedMatchedGroups.length) return normalizedMatchedGroups.some((group) => group.terms.test(text));

  const issueGroups = [
    {
      query: /고지|알릴|미고지|계약해지|중요한 사항|중대한 과실/,
      terms: /고지|알릴|미고지|계약해지|해지|질문사항|중요한 사항|중대한 과실/,
    },
    {
      query: /도수|백내장|다초점|요양병원|비급여|주사|체외충격파|치료목적/,
      terms: /도수|백내장|다초점|요양병원|비급여|주사|체외충격파|치료목적|보상하지/,
    },
    {
      query: /후유장해|장해|지급률|운동범위|동요관절/,
      terms: /후유장해|장해|지급률|운동범위|동요|장해분류표/,
    },
    {
      query: /암|뇌경색|뇌출혈|심근경색|협심증|진단비|경계성|제자리/,
      terms: /암|뇌경색|뇌출혈|심근경색|협심증|진단비|경계성|제자리|진단확정/,
    },
    {
      query: /면책|자살|이륜|통지의무|책임개시|설명의무/,
      terms: /면책|자살|이륜|통지의무|책임개시|설명의무|보상하지/,
    },
  ];

  const matchedGroups = issueGroups.filter((group) => group.query.test(queryText));
  if (matchedGroups.length) return matchedGroups.some((group) => group.terms.test(text));

  const queryTokens = Array.from(new Set(queryText.match(/[가-힣A-Za-z0-9.]{3,}/g) || []))
    .filter((token) => !['보험', '실손보험', '의료비', '계약', '청구'].includes(token));
  if (!queryTokens.length) return true;
  return queryTokens.some((token) => text.includes(token));
}

async function createEmbedding(openAiKey: string, query: string) {
  const response = await fetch(EMBEDDING_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: query.slice(0, 8000) }),
  });
  if (!response.ok) throw new Error(`Embedding request failed: ${response.status}`);
  const json = await response.json() as { data?: { embedding?: number[] }[] };
  const embedding = json.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== 1536) {
    throw new Error(`Unexpected embedding dimension: ${embedding?.length || 0}`);
  }
  return embedding;
}

async function rpcSearch(
  supabaseUrl: string,
  serviceRoleKey: string,
  embedding: number[],
  sourceArea: string,
  matchCount: number,
) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/match_rag_master_chunks`, {
    method: 'POST',
    headers: restHeaders(serviceRoleKey),
    body: JSON.stringify({
      query_embedding: embedding,
      match_count: matchCount,
      source_area_filter: sourceArea,
      min_similarity: MIN_SIMILARITY,
    }),
  });
  if (!response.ok) throw new Error(`RAG RPC failed: ${response.status}`);
  return await response.json() as RpcRow[];
}

async function enrichRows(supabaseUrl: string, serviceRoleKey: string, rows: RpcRow[]) {
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (!ids.length) return [] as EnrichedRow[];
  const quoted = ids.map((id) => `"${id}"`).join(',');
  const select = 'id,source_type,source_reference,source_document_id,source_record_id,metadata,review_status,trust_level';
  const response = await fetch(`${supabaseUrl}/rest/v1/rag_master_chunks?select=${select}&id=in.(${quoted})`, {
    headers: restHeaders(serviceRoleKey),
  });
  if (!response.ok) return rows as EnrichedRow[];
  const details = await response.json() as EnrichedRow[];
  const byId = new Map(details.map((row) => [row.id, row]));
  return rows.map((row) => ({ ...row, ...(byId.get(row.id) || {}) }));
}

function toReference(row: EnrichedRow, referenceType: 'official' | 'internal'): RetrievedReference {
  const metadata = row.metadata || {};
  return {
    reference_type: referenceType,
    source_area: row.source_area,
    source_area_label: getSourceDisplayName(undefined, row.source_area, row.title),
    title: clip(row.title, 180),
    summary: clip(row.summary || row.chunk_text, 700),
    source_url: publicText(row.source_url),
    sourceDisplayName: getSourceDisplayName(row.source_url, row.source_area, row.title),
    similarity: Number(row.similarity || 0),
    case_number: publicText(metadata.case_number),
    court_or_agency: publicText(metadata.court || metadata.court_or_agency || metadata.courtOrAgency),
    decision_date: publicText(metadata.decision_date || metadata.decisionDate),
    law_name: publicText(metadata.law_name || metadata.lawName),
    article_title: publicText(metadata.article_title || metadata.articleTitle),
    diagnosis_code: publicText(metadata.diagnosis_code || metadata.diagnosisCode),
    diagnosis_name: publicText(metadata.diagnosis_name || metadata.diagnosisName),
    note: referenceType === 'internal' ? '내부 검토자료이며 공식 근거로 인용하지 않음' : undefined,
  };
}

function dedupeReferences(rows: EnrichedRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.source_area}:${publicText(row.title)}:${publicText(row.source_url)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildRagQueryFromObject(value: unknown) {
  return publicText(JSON.stringify(value)).slice(0, 2500);
}

export async function searchRagReferences(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  openAiKey: string;
  query: string;
}): Promise<RagSearchResult> {
  const query = publicText(params.query);
  if (!query) return { query: '', officialReferences: [], internalReviewMaterials: [] };

  const embedding = await createEmbedding(params.openAiKey, query);
  const diagnosisCodes = extractDiagnosisCodes(query);
  const officialRows: EnrichedRow[] = [];
  const internalRows: EnrichedRow[] = [];

  for (const plan of searchPlan) {
    const rawRows = await rpcSearch(params.supabaseUrl, params.serviceRoleKey, embedding, plan.source_area, Math.max(plan.count * 4, 10));
    const rows = await enrichRows(params.supabaseUrl, params.serviceRoleKey, rawRows);
    const sorted = rows.sort((a, b) => scoreRow(b, diagnosisCodes) - scoreRow(a, diagnosisCodes));

    for (const row of sorted) {
      if (isTitleSeedFss(row)) continue;
      if (row.source_area === 'terms_standards' && !isDirectlyRelevantTerms(row, query)) continue;
      if (isOfficialReference(row) && officialRows.filter((item) => item.source_area === plan.source_area).length < plan.count) {
        officialRows.push(row);
      } else if (isInternalReviewMaterial(row) && internalRows.filter((item) => item.source_area === plan.source_area).length < plan.count) {
        internalRows.push(row);
      }
    }
  }

  return {
    query,
    officialReferences: dedupeReferences(officialRows).map((row) => toReference(row, 'official')),
    internalReviewMaterials: dedupeReferences(internalRows).map((row) => toReference(row, 'internal')),
  };
}

export function formatRagForPrompt(result: RagSearchResult) {
  const official = result.officialReferences.length
    ? result.officialReferences.map((ref, index) => [
      `[공식근거 ${index + 1}] ${ref.title}`,
      `자료구분: ${ref.source_area_label}`,
      ref.law_name ? `법령명: ${ref.law_name}` : '',
      ref.article_title ? `조문명: ${ref.article_title}` : '',
      ref.case_number ? `사건번호: ${ref.case_number}` : '',
      ref.court_or_agency ? `법원/기관: ${ref.court_or_agency}` : '',
      ref.decision_date ? `선고/결정일: ${ref.decision_date}` : '',
      `출처: ${ref.sourceDisplayName || getSourceDisplayName(ref.source_url, ref.source_area, ref.title)}`,
      ref.summary ? `요약: ${ref.summary}` : '',
    ].filter(Boolean).join('\n')).join('\n\n')
    : '검색된 공식/준공식 근거 없음.';

  const internal = result.internalReviewMaterials.length
    ? result.internalReviewMaterials.map((ref, index) => [
      `[내부검토 ${index + 1}] ${ref.title}`,
      `자료구분: ${ref.source_area_label}`,
      ref.diagnosis_code ? `질병코드: ${ref.diagnosis_code}` : '',
      ref.diagnosis_name ? `진단명: ${ref.diagnosis_name}` : '',
      ref.summary ? `요약: ${ref.summary}` : '',
      '주의: 내부 검토자료이며 공식 근거로 인용하지 마세요.',
    ].filter(Boolean).join('\n')).join('\n\n')
    : '검색된 내부 검토자료 없음.';

  return [
    '[RAG 검색 질의]',
    result.query,
    '',
    '[공식/준공식 근거 - 인용 가능]',
    official,
    '',
    '[내부 검토자료 - 공식 근거로 인용 금지]',
    internal,
  ].join('\n');
}
