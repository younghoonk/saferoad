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

export type IndemnityInsuranceGeneration = '1세대' | '2세대' | '3세대' | '4세대' | 'unknown';

export interface RagSearchContext {
  insurerName?: string;
  productName?: string;
  policyName?: string;
  policyNumber?: string;
  insuranceType?: string;
  coverageType?: string;
  contractDate?: string;
  policyGeneration?: string;
  policyVersion?: string;
  isLifeInsurance?: boolean;
  isNonLifeInsurance?: boolean;
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

function firstMetadataValue(row: EnrichedRow, keys: string[]) {
  for (const key of keys) {
    const value = metadataValue(row, key);
    if (value) return value;
  }
  return '';
}

function parseDate(value: unknown) {
  const text = publicText(value);
  if (!text) return null;
  const normalized = text.replace(/[.\/]/g, '-').match(/\d{4}-\d{1,2}-\d{1,2}/)?.[0];
  if (!normalized) return null;
  const date = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function inferIndemnityInsuranceGeneration(contractDate: string): IndemnityInsuranceGeneration {
  const date = parseDate(contractDate);
  if (!date) return 'unknown';
  if (date < new Date('2009-10-01T00:00:00Z')) return '1세대';
  if (date < new Date('2017-04-01T00:00:00Z')) return '2세대';
  if (date < new Date('2021-07-01T00:00:00Z')) return '3세대';
  return '4세대';
}

function effectiveDateScore(row: EnrichedRow, contractDate?: string) {
  const contract = parseDate(contractDate);
  if (!contract) return 0;
  const from = parseDate(firstMetadataValue(row, ['effective_from', 'effectiveFrom', 'applicable_from', 'start_date']));
  const to = parseDate(firstMetadataValue(row, ['effective_to', 'effectiveTo', 'applicable_to', 'end_date']));
  if (from && contract < from) return -0.12;
  if (to && contract > to) return -0.12;
  if (from || to) return 0.12;
  return 0;
}

function contextText(context?: RagSearchContext) {
  return [
    context?.insurerName,
    context?.productName,
    context?.policyName,
    context?.insuranceType,
    context?.coverageType,
    context?.policyGeneration,
    context?.policyVersion,
    context?.contractDate,
    context?.isLifeInsurance ? '생명보험' : '',
    context?.isNonLifeInsurance ? '손해보험' : '',
  ].map(publicText).filter(Boolean).join(' ');
}

function rowMatchesText(row: EnrichedRow, value?: string) {
  const needle = publicText(value);
  if (!needle) return false;
  return rowText(row).includes(needle) || JSON.stringify(row.metadata || {}).includes(needle);
}

function policyGeneration(context?: RagSearchContext) {
  return publicText(context?.policyGeneration) || inferIndemnityInsuranceGeneration(publicText(context?.contractDate));
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

function disclosureQuery(query: string) {
  return /계약\s*전\s*알릴\s*의무|계약전\s*알릴\s*의무|고지\s*의무|미고지|중요한\s*사항|중대한\s*과실|계약\s*해지|알릴의무|고지의무/i.test(query);
}

function disclosureRelevantText(row: EnrichedRow) {
  return /계약\s*전\s*알릴\s*의무|계약전\s*알릴\s*의무|고지\s*의무|알릴\s*의무|미고지|계약\s*해지|해지|청약서|질문\s*사항|중요한\s*사항|중대한\s*과실|보험사고.{0,12}인과관계|인과관계|상법\s*제?\s*651|제\s*651\s*조|제\s*651\s*조의\s*2|제\s*655\s*조/i.test(rowText(row));
}

function irrelevantDisclosureText(row: EnrichedRow) {
  return /백내장|다초점|이륜차|오토바이|자동차\s*손해배상|자동차\s*보험|대인배상|대물배상|자기신체사고|차량\s*전손|예금자\s*보호|비례\s*보상|중지\s*\/?\s*재개|보험계약\s*중지|색인|목차/i.test(rowText(row));
}

function preferredDisclosureStatute(row: EnrichedRow) {
  if (row.source_area !== 'legal_statutes') return false;
  return /상법|보험/i.test(rowText(row)) && /제\s*651\s*조(?:의\s*2)?|제\s*655\s*조|651조(?:의2)?|655조/i.test(rowText(row));
}

function postContractNoticeStatute(row: EnrichedRow) {
  if (row.source_area !== 'legal_statutes') return false;
  return /제\s*652\s*조|제\s*653\s*조|652조|653조|위험\s*변경|계약\s*후\s*알릴\s*의무|통지\s*의무/i.test(rowText(row));
}

const insurerNames = [
  '삼성화재',
  '메리츠화재',
  '현대해상',
  'DB손해보험',
  'KB손해보험',
  '한화손해보험',
  '롯데손해보험',
  '흥국화재',
  'MG손해보험',
  '농협손해보험',
  '메리츠',
  '삼성',
  '현대',
  'DB',
  'KB',
];

function normalizedInsurer(value?: string) {
  const text = publicText(value).replace(/\s+/g, '');
  if (!text) return '';
  if (/메리츠/.test(text)) return '메리츠';
  if (/삼성/.test(text)) return '삼성';
  if (/현대/.test(text)) return '현대';
  if (/DB|디비/.test(text)) return 'DB';
  if (/KB|케이비/.test(text)) return 'KB';
  if (/한화/.test(text)) return '한화';
  if (/롯데/.test(text)) return '롯데';
  if (/흥국/.test(text)) return '흥국';
  if (/농협|NH/.test(text)) return '농협';
  return text;
}

function rowInsurer(row: EnrichedRow) {
  const text = rowText(row);
  return normalizedInsurer(insurerNames.find((name) => text.includes(name)));
}

function isStandardTerms(row: EnrichedRow) {
  return /표준약관|보험업감독업무시행세칙|금융감독원|손해보험협회|생명보험협회/i.test(rowText(row));
}

function isOtherInsurerTerms(row: EnrichedRow, context?: RagSearchContext) {
  if (row.source_area !== 'terms_standards') return false;
  const expected = normalizedInsurer(context?.insurerName);
  if (!expected) return false;
  const found = rowInsurer(row);
  return Boolean(found && found !== expected && !isStandardTerms(row));
}

function directlyRelevantOfficial(row: EnrichedRow, query: string) {
  if (!isOfficialReference(row)) return false;
  if (disclosureQuery(query)) {
    if (row.source_area === 'legal_statutes') return preferredDisclosureStatute(row);
    if (postContractNoticeStatute(row)) return false;
    if (['fss_dispute_cases', 'precedents', 'terms_standards'].includes(row.source_area)) {
      return disclosureRelevantText(row) && !irrelevantDisclosureText(row);
    }
  }
  if (row.source_area === 'terms_standards') return isDirectlyRelevantTerms(row, query);
  return true;
}

function directlyRelevantInternal(row: EnrichedRow, query: string, diagnosisCodes: string[]) {
  if (!isInternalReviewMaterial(row)) return false;
  const text = rowText(row);
  if (disclosureQuery(query) && diagnosisCodes.includes('M47.26')) {
    if (/M17(?:\.\d+)?|M75(?:\.\d+)?|M48\.3|무릎|슬관절|어깨|어깨병변|회전근개|척추협착|심장|뇌|암진단|암진단비|백내장|체외충격파|장기\s*재활|R10|입원비|복통|급성심근경색|뇌경색|뇌출혈/i.test(text)) {
      return false;
    }
    const directCode = exactCodeMatches(row, ['M47.26']).length > 0;
    const spineRelated = /\bM47(?:\.|$)|척추증|요추증|요통|M54|허리/i.test(text);
    const m4726DisclosurePattern = /M47\.26|요추증|요통|허리/i.test(text)
      && /고지의무|알릴의무|미고지|1회\s*통원|계약해지/i.test(text);
    return directCode || spineRelated || m4726DisclosurePattern;
  }
  if (diagnosisCodes.length) return exactCodeMatches(row, diagnosisCodes).length > 0 || !hasSimilarButNotExactCode(row, diagnosisCodes);
  return true;
}

function scoreRow(row: EnrichedRow, diagnosisCodes: string[], context?: RagSearchContext, query = '') {
  let score = Number(row.similarity || 0);
  if (isOfficialReference(row)) score += 0.08;
  if (row.source_area === 'issue_playbooks') score -= 0.05;
  if (row.source_area === 'medical_issue_codes') score -= 0.03;
  if (exactCodeMatches(row, diagnosisCodes).length) score += 0.12;
  if (hasSimilarButNotExactCode(row, diagnosisCodes)) score -= 0.08;
  if (isTitleSeedFss(row)) score -= 0.2;
  if (disclosureQuery(query)) {
    if (preferredDisclosureStatute(row)) score += 0.35;
    if (postContractNoticeStatute(row)) score -= 0.45;
    if (disclosureRelevantText(row)) score += 0.12;
    if (irrelevantDisclosureText(row) && !disclosureRelevantText(row)) score -= 0.35;
  }
  if (row.source_area === 'terms_standards') {
    if (rowMatchesText(row, context?.insurerName)) score += 0.1;
    if (rowMatchesText(row, context?.productName) || rowMatchesText(row, context?.policyName)) score += 0.1;
    score += effectiveDateScore(row, context?.contractDate);
    const generation = policyGeneration(context);
    if (generation !== 'unknown' && rowMatchesText(row, generation)) score += 0.08;
    if (context?.isLifeInsurance && rowMatchesText(row, '생명보험')) score += 0.05;
    if (context?.isNonLifeInsurance && rowMatchesText(row, '손해보험')) score += 0.05;
    if ((/후유장해|장해|지급률/.test(contextText(context)) || /후유장해|장해|지급률/.test(rowText(row)))
      && /장해분류표|장해지급률|지급률/.test(rowText(row))) score += 0.08;
    if ((/질병코드|KCD|질병분류|진단비/.test(contextText(context)) || /질병코드|KCD|질병분류|진단비/.test(rowText(row)))
      && /질병분류표|KCD|한국표준질병/.test(rowText(row))) score += 0.08;
  }
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

async function fetchDisclosureStatuteRows(supabaseUrl: string, serviceRoleKey: string) {
  const targets = [
    { key: '651', patterns: ['제651조', '651조'] },
    { key: '651-2', patterns: ['제651조의2', '651조의2'] },
    { key: '655', patterns: ['제655조', '655조'] },
  ];
  const rows: EnrichedRow[] = [];
  const select = 'id,source_area,source_type,title,summary,chunk_text,keywords,source_url,metadata,review_status,trust_level';
  for (const target of targets) {
    const filters = target.patterns.flatMap((pattern) => [
      `title.ilike.*${pattern}*`,
      `summary.ilike.*${pattern}*`,
      `chunk_text.ilike.*${pattern}*`,
    ]).join(',');
    const url = `${supabaseUrl}/rest/v1/rag_master_chunks?select=${select}&source_area=eq.legal_statutes&or=(${encodeURIComponent(filters)})&limit=1`;
    const response = await fetch(url, { headers: restHeaders(serviceRoleKey) });
    if (!response.ok) continue;
    const data = await response.json() as EnrichedRow[];
    if (data[0]) rows.push({ ...data[0], similarity: 1 });
  }
  return rows;
}

function fallbackDisclosureStatuteRows() {
  const statutes = [
    {
      key: '651',
      title: '상법 제651조 고지의무위반으로 인한 계약해지',
      summary: '상법 제651조는 보험계약 당시 중요한 사항에 관하여 고의 또는 중대한 과실로 고지하지 않거나 부실고지를 한 경우 보험자가 일정 기간 내 계약을 해지할 수 있다는 취지의 조항이다.',
      articleTitle: '제651조 고지의무위반으로 인한 계약해지',
    },
    {
      key: '651-2',
      title: '상법 제651조의2 서면에 의한 질문의 효력',
      summary: '상법 제651조의2는 보험자가 서면으로 질문한 사항은 중요한 사항으로 추정한다는 취지의 조항이다.',
      articleTitle: '제651조의2 서면에 의한 질문의 효력',
    },
    {
      key: '655',
      title: '상법 제655조 계약해지와 보험금청구권',
      summary: '상법 제655조는 고지의무 위반 등으로 계약을 해지한 경우 보험금청구권 및 고지의무 위반 사실과 보험사고 발생 사이의 인과관계를 검토할 때 문제되는 조항이다.',
      articleTitle: '제655조 계약해지와 보험금청구권',
    },
  ];
  return statutes.map((statute) => ({
    id: `fallback-commercial-act-${statute.key}`,
    source_area: 'legal_statutes',
    source_type: 'legal_statute_fallback',
    title: statute.title,
    summary: statute.summary,
    chunk_text: statute.summary,
    source_url: 'https://www.law.go.kr/법령/상법',
    similarity: 1,
    metadata: {
      law_name: '상법',
      article_title: statute.articleTitle,
      source_status: 'official_law_fallback',
    },
  })) as EnrichedRow[];
}

function ensureDisclosureStatuteRows(rows: EnrichedRow[]) {
  const combined = [...rows];
  for (const fallback of fallbackDisclosureStatuteRows()) {
    const fallbackText = rowText(fallback);
    const exists = combined.some((row) => {
      const text = rowText(row);
      if (/651조의2|651\s*조의\s*2|651-2/.test(fallbackText)) return /651조의2|651\s*조의\s*2|651-2/.test(text);
      if (/655/.test(fallbackText)) return /655/.test(text);
      return /651/.test(text) && !/651조의2|651\s*조의\s*2|651-2/.test(text);
    });
    if (!exists) combined.unshift(fallback);
  }
  return combined;
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

export function buildRagSearchQuery(value: unknown, context?: RagSearchContext) {
  const generation = policyGeneration(context);
  const parts = [
    buildRagQueryFromObject(value),
    context?.insurerName ? `보험회사 ${context.insurerName}` : '',
    context?.insuranceType ? `보험종류 ${context.insuranceType}` : '',
    context?.productName ? `상품명 ${context.productName}` : '',
    context?.policyName ? `약관명 ${context.policyName}` : '',
    context?.coverageType ? `담보명 ${context.coverageType}` : '',
    context?.contractDate ? `보험가입일 ${context.contractDate}` : '',
    generation !== 'unknown' ? `추정 실손보험 ${generation}` : '',
    context?.policyVersion ? `약관버전 ${context.policyVersion}` : '',
    context?.isLifeInsurance ? '생명보험' : '',
    context?.isNonLifeInsurance ? '손해보험' : '',
    '가입 당시 약관 질병분류표 장해분류표 적용기간',
  ];
  return publicText(parts.filter(Boolean).join(' ')).slice(0, 3000);
}

export async function searchRagReferences(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  openAiKey: string;
  query: string;
  context?: RagSearchContext;
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
    const sorted = rows.sort((a, b) => scoreRow(b, diagnosisCodes, params.context, query) - scoreRow(a, diagnosisCodes, params.context, query));

    for (const row of sorted) {
      if (isTitleSeedFss(row)) continue;
      if (isOtherInsurerTerms(row, params.context)) continue;
      if (directlyRelevantOfficial(row, query) && officialRows.filter((item) => item.source_area === plan.source_area).length < plan.count) {
        officialRows.push(row);
      } else if (directlyRelevantInternal(row, query, diagnosisCodes) && internalRows.filter((item) => item.source_area === plan.source_area).length < plan.count) {
        internalRows.push(row);
      }
    }
  }

  if (disclosureQuery(query)) {
    const statuteRows = await fetchDisclosureStatuteRows(params.supabaseUrl, params.serviceRoleKey);
    for (const row of statuteRows) {
      if (!officialRows.some((item) => item.id === row.id)) officialRows.unshift(row);
    }
    const ensuredRows = ensureDisclosureStatuteRows(officialRows);
    officialRows.splice(0, officialRows.length, ...ensuredRows);
  }

  return {
    query,
    officialReferences: dedupeReferences(officialRows).map((row) => toReference(row, 'official')),
    internalReviewMaterials: dedupeReferences(internalRows).slice(0, disclosureQuery(query) ? 4 : 12).map((row) => toReference(row, 'internal')),
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
    '[약관 적용 주의]',
    '약관, 질병분류표, 장해분류표는 보험가입일과 해당 상품 원약관 기준으로 확인해야 합니다. 실손 세대 추정은 검색 보조용이며 최종 판단 근거가 아닙니다. 회사/상품 원약관이 없으면 표준약관 또는 유사자료는 참고자료로만 사용합니다.',
    '',
    '[공식/준공식 근거 - 인용 가능]',
    official,
    '',
    '[내부 검토자료 - 공식 근거로 인용 금지]',
    internal,
  ].join('\n');
}
