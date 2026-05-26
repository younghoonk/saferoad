const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_API_URL = 'https://api.openai.com/v1/embeddings';
const MIN_SIMILARITY = 0.45;
// Per-RPC-call hard cap. Guards against MATERIALIZED-CTE full-scans (e.g. medical_issue_codes 16万件)
// hanging indefinitely when no statement_timeout is set in PostgreSQL.
// If this fires, the worker try/catch returns { sorted: [] } — the function continues normally.
const RPC_FETCH_TIMEOUT_MS = 8000;

export interface RetrievedReference {
  reference_type: 'official' | 'internal';
  source_area: string;
  source_type?: string;
  source_area_label: string;
  title: string;
  id?: string;
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
  review_status?: string;
  official_citation_allowed?: boolean;
  source_provider?: string;
  provider_prec_id?: string;
  release_stage?: string;
  dataset_version?: string;
  sourceType?: string;
  citationLabel?: string;
  sourceArea?: string;
  issueTags?: string[];
  keyHolding?: string;
  excerpt?: string;
  applicableReason?: string;
  limitation?: string;
  policySource?: 'uploaded' | 'server_default';
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

export interface RagSearchOptions {
  includeStaging?: boolean;
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
  medical_guideline: '의학 기준',
  medical_knowledge: '의료 참고자료',
  precedents: '판례',
  terms_standards: '약관/지급기준',
  issue_playbooks: '내부 쟁점 플레이북',
  practice_playbooks: '내부 실무 플레이북',
  medical_issue_codes: '질병코드별 의료쟁점',
  dispute_resolution_cases: '금융감독원 분쟁조정례/민원사례',
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
  'jacc.org': 'JACC',
  'acc.org': 'American College of Cardiology',
  'heart.org': 'American Heart Association',
  'professional.heart.org': 'American Heart Association',
  'pubmed.ncbi.nlm.nih.gov': 'PubMed',
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
  { source_area: 'medical_guideline', count: 3 },
  { source_area: 'medical_knowledge', count: 3 },
  { source_area: 'medical_issue_codes', count: 3 },
  { source_area: 'issue_playbooks', count: 2 },
  { source_area: 'practice_playbooks', count: 2 },
  { source_area: 'real_case_patterns', count: 2 },
  { source_area: 'real_case_documents', count: 2 },
];

const internalIdPattern = /\b(?:RQ|RSF|RCP|RCD|MIC|PIP|RKA|PST|FSS|PREC|PREC_API|FSS_LATEST)[-_]?\d{3,6}\b/g;
const chunkReferencePattern = /\b(?:medical_issue_code|real_case_pattern|real_case_document|issue_playbook|practice_playbook|precedent|fss_latest|terms_raw|fss_dispute_case):[A-Za-z0-9:_-]+\b/g;
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
  if (isPolicyTermsReference(row)) return true;
  const hostname = hostnameFromUrl(row.source_url);
  if (!hostname) {
    return row.source_area === 'legal_statutes'
      || row.source_area === 'fss_dispute_cases'
      || row.source_area === 'precedents'
      || (row.source_area === 'medical_guideline' && reviewStatus(row) === 'reviewed' && officialCitationAllowed(row))
      || (row.source_area === 'terms_standards' && isTrustedTermsReference(row));
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
    medical_guideline: '의학 기준',
    medical_knowledge: '의료 참고자료',
    precedents: '판례',
    terms_standards: '약관/지급기준',
    issue_playbooks: '내부 쟁점 플레이북',
    practice_playbooks: '내부 실무 플레이북',
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

function metadataBoolean(row: EnrichedRow, key: string) {
  const value = row.metadata?.[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
}

function metadataNumber(row: EnrichedRow, key: string): number | null {
  const value = row.metadata?.[key];
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
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
  // effective_from/to가 없는 경우: metadata.policy_year로 가입 시점 약관 우선 원칙 적용
  // 원칙: 계약 성립 시점 이전 약관 중 가장 최신을 우선, 이후 약관은 가입 당시 미존재로 강배제
  // hard-false 대신 강패널티 사용: 이전 약관이 DB에 없는 케이스에서 약관 0건 방지
  const policyYear = metadataNumber(row, 'policy_year');
  if (policyYear !== null) {
    const contractYear = contract.getFullYear();
    if (policyYear > contractYear) return -0.60;           // 계약일 이후 약관: 강배제 (미존재)
    const yearsBefore = contractYear - policyYear;
    if (yearsBefore <= 2) return +0.20;                    // 가입 직전 2년: 최우선
    if (yearsBefore <= 5) return +0.10;                    // 가입 직전 5년: 우대
  }
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

function reviewStatus(row: EnrichedRow) {
  return publicText(row.review_status) || metadataValue(row, 'review_status') || metadataValue(row, 'reviewStatus');
}

function officialCitationAllowed(row: EnrichedRow) {
  return metadataBoolean(row, 'official_citation_allowed') || metadataBoolean(row, 'officialCitationAllowed');
}

function releaseStage(row: EnrichedRow) {
  return metadataValue(row, 'release_stage') || metadataValue(row, 'releaseStage');
}

function isActiveRelease(row: EnrichedRow) {
  const stage = releaseStage(row);
  return !stage || stage === 'active' || metadataBoolean(row, 'is_active') || metadataBoolean(row, 'isActive');
}

function filterReleaseRows(rows: EnrichedRow[], options?: RagSearchOptions) {
  return options?.includeStaging ? rows : rows.filter(isActiveRelease);
}

function officialCitationDenied(row: EnrichedRow) {
  const snakeValue = row.metadata?.official_citation_allowed;
  const camelValue = row.metadata?.officialCitationAllowed;
  return snakeValue === false
    || camelValue === false
    || (typeof snakeValue === 'string' && snakeValue.toLowerCase() === 'false')
    || (typeof camelValue === 'string' && camelValue.toLowerCase() === 'false');
}

function trustLevel(row: EnrichedRow) {
  return publicText(row.trust_level);
}

function isPolicyTermsReference(row: EnrichedRow) {
  return row.source_area === 'terms_standards'
    && ['policy_terms_bundle', 'silson_policy_terms'].includes(publicText(row.source_type))
    && trustLevel(row) === 'policy_reference'
    && officialCitationAllowed(row);
}

function explicitOfficialTermsSourceType(row: EnrichedRow) {
  const sourceType = publicText(row.source_type);
  return /official|standard_terms|standard_policy|policy_standard|legal|statute|regulatory|fss|fsc|標準|표준약관|법령|금감원|금융감독원|금융위원회/i.test(sourceType);
}

function isTrustedTermsReference(row: EnrichedRow) {
  if (row.source_area !== 'terms_standards') return false;
  if (isPolicyTermsReference(row)) return true;
  if (officialCitationDenied(row)) return false;
  if (reviewStatus(row) === 'unreviewed' && !trustLevel(row)) return false;
  if (['official', 'policy_reference', 'legal_reference', 'regulatory_reference'].includes(trustLevel(row))) return true;
  if (['reviewed', 'approved'].includes(reviewStatus(row))) return true;
  return explicitOfficialTermsSourceType(row);
}

function strongPrecedentCitation(row: EnrichedRow) {
  if (row.source_area !== 'precedents') return false;
  return sourceStatus(row) === 'official_law_api_full_text'
    || (reviewStatus(row) === 'reviewed' && officialCitationAllowed(row));
}

function needsReviewPrecedent(row: EnrichedRow) {
  return row.source_area === 'precedents' && !strongPrecedentCitation(row);
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
  if (officialCitationDenied(row)) return false;
  if (row.source_area === 'medical_issue_codes' || row.source_area === 'practice_playbooks' || row.source_area === 'dispute_resolution_cases') return false;
  if (['classification_reference', 'internal_practice'].includes(trustLevel(row))) return false;
  if (isBlockedOfficialSource(row) || !isAllowedOfficialSource(row)) return false;
  if (row.source_area === 'legal_statutes') return true;
  if (row.source_area === 'terms_standards') return isTrustedTermsReference(row);
  if (row.source_area === 'fss_dispute_cases') {
    return sourceStatus(row) === 'official_fss_full_text';
  }
  if (row.source_area === 'precedents') {
    return strongPrecedentCitation(row);
  }
  if (row.source_area === 'medical_guideline') {
    return reviewStatus(row) === 'reviewed' && officialCitationAllowed(row);
  }
  return false;
}

function isInternalReviewMaterial(row: EnrichedRow) {
  return (row.source_area === 'precedents' && !strongPrecedentCitation(row))
    || (row.source_area === 'terms_standards' && !isOfficialReference(row))
    || ['issue_playbooks', 'practice_playbooks', 'medical_issue_codes', 'real_case_patterns', 'real_case_documents', 'medical_knowledge', 'dispute_resolution_cases'].includes(row.source_area)
    || String(row.source_type || '').startsWith('internal_');
}

function disclosureQuery(query: string) {
  return /계약\s*전\s*알릴\s*의무|계약전\s*알릴\s*의무|고지\s*의무|미고지|중요한\s*사항|중대한\s*과실|계약\s*해지|알릴의무|고지의무/i.test(query);
}

function cancerInsuranceQuery(query: string) {
  return /암보험|암진단비|갑상선암|갑상선\s*결절|C73|E04|D34/i.test(query);
}

// terms_standards 필터 전용 — 비갑상선 암 케이스(림프종/유방암/대장암 등) 포함 감지
// cancerInsuranceQuery(갑상선 특화)는 FSS/판례 블록에서 그대로 사용
function generalCancerDiagnosisQuery(query: string) {
  if (cancerInsuranceQuery(query)) return true;
  return /일반암|소액암|유사암|제자리암|경계성종양|혈액암|림프종|백혈병|유방암|대장암|위암|폐암|췌장암|간암|신장암|골수종|흑색종|\bC[0-8]\d\b|\bC9[0-7]\b|\bD0[0-9]\b|\bD3[7-9]\b|\bD4[0-8]\b/i.test(query);
}

function brainInsuranceQuery(query: string) {
  return /뇌혈관|뇌졸중|뇌경색|뇌출혈|지주막하출혈|뇌동맥류|\bI6[0-9]\b|\bG45\b|뇌진단비/i.test(query);
}

function cataractQuery(query: string) {
  return /백내장|H25|H26|다초점|다초점렌즈|다초점\s*인공수정체|인공수정체|IOL|intraocular\s*lens|백내장\s*수술|안과|시력교정|수정체/i.test(query);
}

function manualTherapyQuery(query: string) {
  if (cataractQuery(query)) return false;
  return /도수치료|manual\s*therapy|비급여\s*치료|치료\s*목적|치료목적|의학적\s*필요성|과잉진료|반복치료|진료비\s*세부내역|치료계획|실손보험|실손의료/i.test(query)
    && !/고지의무|미고지|계약해지|갑상선|암진단비/i.test(query);
}

function heartDiagnosisQuery(query: string) {
  return /급성심근경색|심근경색|\bI21\b|\bI22\b|트로포닌|troponin|CK-MB|심전도|\bECG\b|\bEKG\b|관상동맥조영술|\bCAG\b|\bPCI\b|협심증|\bI20\b|스텐트|관상동맥|심근효소/i.test(query);
}

function rectalCarcinoidQuery(query: string) {
  return /직장유암종|신경내분비종양|\bNET\b|\bD37\.5\b|\bC20\b|\bD12\.8\b|경계성종양|행동양식|암진단비|병리보고서|조직검사/i.test(query);
}

function heartInternalText(row: EnrichedRow) {
  return /급성심근경색|심근경색|\bI21\b|\bI22\b|트로포닌|troponin|CK-MB|심전도|\bECG\b|\bEKG\b|관상동맥조영술|\bCAG\b|\bPCI\b|협심증|\bI20\b|스텐트|관상동맥|심근효소/i.test(rowText(row));
}

function irrelevantHeartInternalText(row: EnrichedRow) {
  return /뇌경색|뇌출혈|대뇌동맥류|뇌동맥류|뇌MRA|MRI\s*판독|\bDWI\b|\bADC\b|직장유암종|갑상선암|백내장|도수치료|후유장해/i.test(rowText(row));
}

function rectalCarcinoidInternalText(row: EnrichedRow) {
  return /직장유암종|신경내분비종양|\bNET\b|\bD37\.5\b|\bC20\b|\bD12\.8\b|\/3/i.test(rowText(row));
}

function irrelevantRectalCarcinoidInternalText(row: EnrichedRow) {
  return /자궁경부암|유방암|유방결절|갑상선암|심근경색|뇌경색|도수치료|백내장|후유장해/i.test(rowText(row));
}

function cataractText(row: EnrichedRow) {
  return /백내장|H25|H26|인공수정체|다초점렌즈|다초점\s*인공수정체|입원|통원|실손의료비|실손보험|시력교정|보상\s*제외|약관해석|입원의\s*정의|안과|수정체|진료비\s*세부내역/i.test(rowText(row));
}

function irrelevantCataractText(row: EnrichedRow) {
  return /도수치료|manual\s*therapy|M54|요통|허리통증|체외충격파|고지의무|계약해지|M47\.26|후유장해|갑상선|자동차보험|자동차/i.test(rowText(row));
}

function manualTherapyText(row: EnrichedRow) {
  return /도수치료|manual\s*therapy|실손보험|실손의료|비급여|치료\s*목적|치료목적|의학적\s*필요성|과잉진료|반복치료|진료비\s*세부내역|치료계획|의료비\s*지급|보상\s*제외|M54|요통|허리통증/i.test(rowText(row));
}

function irrelevantManualTherapyText(row: EnrichedRow) {
  return /계약전\s*알릴의무|고지의무|미고지|계약해지|청약서|인수거절|부담보|할증|M47\.26|M54\.26\s*1회\s*통원|자동차|손해배상|후유장해|암진단비|백내장|갑상선암|입원비|이륜차|요양불승인|산재/i.test(rowText(row));
}

function disclosureRelevantText(row: EnrichedRow) {
  return /계약\s*전\s*알릴\s*의무|계약전\s*알릴\s*의무|고지\s*의무|알릴\s*의무|미고지|계약\s*해지|해지|청약서|질문\s*사항|중요한\s*사항|중대한\s*과실|보험사고.{0,12}인과관계|인과관계|상법\s*제?\s*651|제\s*651\s*조|제\s*651\s*조의\s*2|제\s*655\s*조/i.test(rowText(row));
}

function irrelevantDisclosureText(row: EnrichedRow) {
  return /요양불승인|산재|CRPS|회전근개|견관절|교통사고|자동차|손해배상|백내장|다초점|이륜차|오토바이|종합소득세|부과처분|자동차\s*손해배상|자동차\s*보험|대인배상|대물배상|자기신체사고|차량\s*전손|예금자\s*보호|비례\s*보상|중지\s*\/?\s*재개|보험계약\s*중지|색인|목차/i.test(rowText(row));
}

function disclosurePrecedentText(row: EnrichedRow) {
  return /고지의무|계약\s*전\s*알릴\s*의무|계약전\s*알릴\s*의무|중요한\s*사항|중대한\s*과실|부실고지|보험계약\s*해지|보험사고\s*인과관계|상법\s*제?\s*651|상법\s*제?\s*655/i.test(rowText(row));
}

function administrativePrecedentText(row: EnrichedRow) {
  return /산업재해보상보험|산재보험|근로복지공단|업무상\s*재해|재해근로자|장해보상연금|휴업급여|요양급여|평균임금정정|보험급여차액|장기요양|건강보험약제|급여비용|환수결정처분|보험료부과처분취소|국민건강보험공단|건강보험심사평가원|부당해고|구제재심판정취소|요양불승인|행정처분취소/i.test(rowText(row));
}

function thyroidOfficialText(row: EnrichedRow) {
  return /갑상선\s*결절|갑상선암|갑상선|C73|E04|D34|건강검진|추적관찰|미세침흡인검사|초음파|양성신생물|정밀검사|암진단비/i.test(rowText(row));
}

function thyroidFssText(row: EnrichedRow) {
  const text = rowText(row);
  return /갑상선|결절|갑상선암|C73|E04|D34|건강검진|추적관찰|미세침흡인검사|초음파|양성신생물|정밀검사/i.test(text)
    && /고지의무|알릴의무|미고지|계약전|중요한\s*사항|중대한\s*과실|인과관계/i.test(text);
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
  if (row.source_area === 'precedents' && administrativePrecedentText(row)) return false;
  if (cataractQuery(query)) {
    if (irrelevantCataractText(row)) return false;
    if (row.source_area === 'legal_statutes') return false;
    if (row.source_area === 'fss_dispute_cases') return cataractText(row);
    if (row.source_area === 'precedents') return cataractText(row);
    if (row.source_area === 'terms_standards') return cataractText(row);
  }
  if (manualTherapyQuery(query)) {
    if (irrelevantManualTherapyText(row)) return false;
    if (row.source_area === 'legal_statutes') return false;
    if (row.source_area === 'fss_dispute_cases') return manualTherapyText(row);
    if (row.source_area === 'precedents') return manualTherapyText(row);
    if (row.source_area === 'terms_standards') return manualTherapyText(row);
  }
  if (cancerInsuranceQuery(query)) {
    if (row.source_area === 'fss_dispute_cases') return thyroidFssText(row) && !irrelevantDisclosureText(row);
    if (row.source_area === 'precedents') {
      const text = rowText(row);
      return (/2009다103349|2009다103356|2023다274056/.test(text) || thyroidOfficialText(row) || disclosurePrecedentText(row))
        && !irrelevantDisclosureText(row);
    }
  }
  if (row.source_area === 'terms_standards' && generalCancerDiagnosisQuery(query)) {
    const text = rowText(row);
    // 암과 무관한 약관 조항 차단 (실손/콩팥병/희귀난치성 등)
    if (/실손|실손보험|실손의료|도수치료|백내장|체외충격파/i.test(text)) return false;
    if (/\bN18\b|만성콩팥병|신대체요법|복막투석|혈액투석|희귀난치성\s*7대/i.test(text)) return false;
    if (!/암보험|질병보험|표준약관|암진단비|진단확정|갑상선암|유사암|소액암|제자리암|고지의무|알릴의무/i.test(text)) return false;
  }
  // 암 쿼리에 심장 판례(2013다208661 NSTEMI 등) 혼입 차단 — allowlist 방식
  if (row.source_area === 'precedents' && generalCancerDiagnosisQuery(query)) {
    const text = rowText(row);
    // 심장 키워드 포함 판례 차단 (blocklist first — 고속 경로)
    if (/심근경색|관상동맥|협심증|NSTEMI|STEMI|\bI21\b|트로포닌|troponin|심근효소|CK-MB|심전도/i.test(text)) return false;
    // 암 관련 키워드 없는 판례 차단 (allowlist — 희귀암 GIST/발덴스트롬 포함)
    if (!/암|악성|종양|병리|carcinoma|lymphoma|leukemia|GIST|신경내분비|경계성|제자리|행동양식|암진단비|혈액암|림프종|백혈병|책임개시일|발병시점/i.test(text)) return false;
  }
  if (row.source_area === 'terms_standards' && brainInsuranceQuery(query)) {
    const text = rowText(row);
    // 암 전용 병리/조직검사 조항 차단 — 뇌혈관 케이스와 무관
    if (/암의\s*진단확정|병리\s*전문의|병리\s*또는\s*진단검사의학|fixed\s*tissue/i.test(text)) return false;
    // 뇌혈관 관련 키워드 없는 약관 청크 차단
    if (!/뇌혈관|뇌졸중|뇌경색|뇌출혈|지주막하|뇌동맥류|I6[0-9]|G45|뇌진단비/i.test(text)) return false;
  }
  if (disclosureQuery(query)) {
    if (row.source_area === 'legal_statutes') return preferredDisclosureStatute(row);
    if (postContractNoticeStatute(row)) return false;
    if (row.source_area === 'precedents') {
      return disclosurePrecedentText(row) && !irrelevantDisclosureText(row);
    }
    if (['fss_dispute_cases', 'precedents', 'terms_standards'].includes(row.source_area)) {
      return disclosureRelevantText(row) && !irrelevantDisclosureText(row);
    }
  }
  if (row.source_area === 'terms_standards') return isDirectlyRelevantTerms(row, query);
  // Cardiac-specific precedents/guidelines must not appear in non-cardiac queries (e.g. 2013다208661 in cancer cases)
  if (!heartDiagnosisQuery(query) && heartInternalText(row)) return false;
  return true;
}

function directlyRelevantInternal(row: EnrichedRow, query: string, diagnosisCodes: string[]) {
  if (!isInternalReviewMaterial(row)) return false;
  const text = rowText(row);
  if (row.source_area === 'precedents') {
    if (administrativePrecedentText(row)) return false;
    if (cataractQuery(query)) return cataractText(row) && !irrelevantCataractText(row);
    if (manualTherapyQuery(query)) return manualTherapyText(row) && !irrelevantManualTherapyText(row);
    if (disclosureQuery(query)) return disclosurePrecedentText(row) && !irrelevantDisclosureText(row);
    if (cancerInsuranceQuery(query)) return (thyroidOfficialText(row) || disclosurePrecedentText(row)) && !irrelevantDisclosureText(row);
    if (heartDiagnosisQuery(query)) return heartInternalText(row) && !irrelevantHeartInternalText(row);
    if (rectalCarcinoidQuery(query)) return rectalCarcinoidInternalText(row) && !irrelevantRectalCarcinoidInternalText(row);
    // Cardiac-specific precedents must not appear in non-cardiac queries
    if (!heartDiagnosisQuery(query) && heartInternalText(row)) return false;
    return true;
  }
  if (heartDiagnosisQuery(query)) {
    if (irrelevantHeartInternalText(row)) return false;
    return heartInternalText(row) || exactCodeMatches(row, ['I20', 'I21', 'I22']).length > 0;
  }
  if (rectalCarcinoidQuery(query)) {
    if (irrelevantRectalCarcinoidInternalText(row)) return false;
    return rectalCarcinoidInternalText(row) || exactCodeMatches(row, ['D37.5', 'C20', 'D12.8']).length > 0;
  }
  if (cataractQuery(query)) {
    return cataractText(row) && !irrelevantCataractText(row);
  }
  if (manualTherapyQuery(query)) {
    return manualTherapyText(row) && !irrelevantManualTherapyText(row);
  }
  if (disclosureQuery(query) && diagnosisCodes.includes('M47.26')) {
    if (/M17(?:\.\d+)?|M75(?:\.\d+)?|M48\.3|무릎|슬관절|어깨|어깨병변|회전근개|견관절|중심정맥관|암수술|척추협착|심장|뇌|암진단|암진단비|백내장|체외충격파|장기\s*재활|R10|입원비|복통|급성심근경색|뇌경색|뇌출혈/i.test(text)) {
      return false;
    }
    const directCode = exactCodeMatches(row, ['M47.26']).length > 0;
    const spineRelated = /\bM47(?:\.|$)|\bM54(?:\.|$)|척추증|요추증|요통|허리통증|신경뿌리병증/i.test(text);
    const m4726DisclosurePattern = /M47\.26|DISCLOSURE_M4726_SINGLE_VISIT|요추증|요통|허리통증|신경뿌리병증/i.test(text)
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
  if (cataractQuery(query)) {
    if (cataractText(row)) score += 0.18;
    if (irrelevantCataractText(row)) score -= 0.5;
  }
  if (manualTherapyQuery(query)) {
    if (manualTherapyText(row)) score += 0.18;
    if (irrelevantManualTherapyText(row)) score -= 0.5;
  }
  if (heartDiagnosisQuery(query)) {
    if (heartInternalText(row)) score += row.source_area === 'practice_playbooks' ? 0.22 : 0.14;
    if (irrelevantHeartInternalText(row)) score -= 0.55;
  }
  if (rectalCarcinoidQuery(query)) {
    if (rectalCarcinoidInternalText(row)) score += row.source_area === 'practice_playbooks' ? 0.22 : 0.14;
    if (irrelevantRectalCarcinoidInternalText(row)) score -= 0.55;
  }
  if (cancerInsuranceQuery(query)) {
    if (row.source_area === 'fss_dispute_cases' && thyroidFssText(row)) score += 0.28;
    if (row.source_area === 'precedents' && /2009다103349|2009다103356/.test(rowText(row))) score += 0.25;
    if (row.source_area === 'precedents' && /2023다274056/.test(rowText(row))) score += 0.08;
    if (thyroidOfficialText(row)) score += 0.12;
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

  // 뇌혈관 쿼리에 암 전용 병리/조직검사 약관 청크 조기 차단
  if (brainInsuranceQuery(queryText) && /암의\s*진단확정|병리\s*전문의|병리\s*또는\s*진단검사의학|fixed\s*tissue/i.test(text)) {
    return false;
  }

  // NMT 신의료기술 고시 청크: normalizedIssueGroups/issueGroups 단락평가 우회 → token fallback으로 직행
  // NMT 본문은 임상·규제 언어(골수흡인농축물/BMAC/KL Grade 등)로 구성돼 약관 용어 그룹에 매칭되지 않음
  if (metadataValue(row, 'dataset_version') === 'nmt_v1') {
    const nmtTokens = Array.from(new Set(queryText.match(/[가-힣A-Za-z0-9.]{3,}/g) || []))
      .filter((token) => !['보험', '실손보험', '의료비', '계약', '청구'].includes(token));
    if (!nmtTokens.length) return true;
    return nmtTokens.some((token) => text.includes(token));
  }

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
      query: /암|심근경색|협심증|진단비|경계성|제자리/,
      terms: /암|심근경색|협심증|진단비|경계성|제자리|진단확정/,
    },
    {
      query: /뇌경색|뇌출혈|뇌혈관|뇌졸중/,
      terms: /뇌경색|뇌출혈|뇌혈관|뇌졸중|I6[0-9]|분류표|뇌진단비/,
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
      query: /암|심근경색|협심증|진단비|경계성|제자리/,
      terms: /암|심근경색|협심증|진단비|경계성|제자리|진단확정/,
    },
    {
      query: /뇌경색|뇌출혈|뇌혈관|뇌졸중/,
      terms: /뇌경색|뇌출혈|뇌혈관|뇌졸중|I6[0-9]|분류표|뇌진단비/,
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
  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/rpc/match_rag_master_chunks`, {
      method: 'POST',
      headers: restHeaders(serviceRoleKey),
      body: JSON.stringify({
        query_embedding: embedding,
        match_count: matchCount,
        source_area_filter: sourceArea,
        min_similarity: MIN_SIMILARITY,
      }),
      signal: AbortSignal.timeout(RPC_FETCH_TIMEOUT_MS),
    });
  } catch (fetchErr) {
    // TimeoutError: Deno 1.33+, AbortError: Deno 1.29-1.32 (AbortSignal.timeout이 AbortError로 던지는 버전)
    const isTimeout = fetchErr instanceof DOMException
      && (fetchErr.name === 'TimeoutError' || fetchErr.name === 'AbortError');
    throw new Error(isTimeout
      ? `RAG RPC timeout after ${RPC_FETCH_TIMEOUT_MS}ms source_area=${sourceArea}`
      : `RAG RPC network error source_area=${sourceArea}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`RAG RPC failed: ${response.status} source_area=${sourceArea}${body ? ` body=${body.slice(0, 300)}` : ''}`);
  }
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
  const isWeakPrecedent = referenceType === 'internal' && row.source_area === 'precedents';
  return {
    reference_type: referenceType,
    source_area: row.source_area,
    source_type: publicText(row.source_type),
    source_area_label: isWeakPrecedent ? '유사 판례 참고자료' : getSourceDisplayName(undefined, row.source_area, row.title),
    title: clip(row.title, 180),
    summary: clip(row.summary || row.chunk_text, 500),
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
    note: isWeakPrecedent
      ? '유사 판례 참고자료입니다. 검토 전 판례이므로 공식근거 또는 확정 근거로 인용하지 말고 판례상 법리 참고로만 사용하세요.'
      : referenceType === 'internal' ? '내부 검토자료이며 공식 근거로 인용하지 않음' : undefined,
    review_status: reviewStatus(row),
    official_citation_allowed: officialCitationAllowed(row),
    source_provider: publicText(metadata.source_provider || metadata.sourceProvider),
    provider_prec_id: publicText(metadata.provider_prec_id || metadata.providerPrecId),
    release_stage: releaseStage(row) || 'active',
    dataset_version: publicText(metadata.dataset_version || metadata.datasetVersion),
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
  const fallbacks = fallbackDisclosureStatuteRows();
  const fallbackIds = new Set(fallbacks.map((row) => row.id));
  const withoutDuplicateFallbacks = rows.filter((row) => !fallbackIds.has(String(row.id || '')));
  return [...fallbacks, ...withoutDuplicateFallbacks];
}

function dedupeReferences(rows: EnrichedRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const text = rowText(row);
    let key = `${row.source_area}:${publicText(row.title)}:${publicText(row.source_url)}`;
    if (row.source_area === 'legal_statutes') {
      if (/상법/.test(text) && /제\s*651\s*조의\s*2|651\s*조의\s*2|651조의2|651-2/i.test(text)) {
        key = 'legal_statutes:상법:제651조의2';
      } else if (/상법/.test(text) && /제\s*651\s*조|651조/i.test(text)) {
        key = 'legal_statutes:상법:제651조';
      } else if (/상법/.test(text) && /제\s*655\s*조|655조/i.test(text)) {
        key = 'legal_statutes:상법:제655조';
      }
    }
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

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<(R | undefined)[]> {
  const results = new Array<R | undefined>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  // allSettled: one slot failure does not abort other slots
  const settled = await Promise.allSettled(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        console.error('[mapWithConcurrency] worker threw at index', index, err instanceof Error ? err.message : String(err));
      }
    }
  }));

  for (const s of settled) {
    if (s.status === 'rejected') {
      console.error('[mapWithConcurrency] slot rejected unexpectedly', s.reason instanceof Error ? s.reason.message : String(s.reason));
    }
  }

  return results;
}

export async function searchRagReferences(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  openAiKey: string;
  query: string;
  context?: RagSearchContext;
  options?: RagSearchOptions;
}): Promise<RagSearchResult> {
  const query = publicText(params.query);
  if (!query) return { query: '', officialReferences: [], internalReviewMaterials: [] };

  const embedding = await createEmbedding(params.openAiKey, query);
  const diagnosisCodes = extractDiagnosisCodes(query);
  const officialRows: EnrichedRow[] = [];
  const internalRows: EnrichedRow[] = [];

  const planResults = await mapWithConcurrency(searchPlan, 4, async (plan) => {
    try {
      const rawRows = await rpcSearch(params.supabaseUrl, params.serviceRoleKey, embedding, plan.source_area, Math.max(plan.count * 2, 6));
      const rows = filterReleaseRows(await enrichRows(params.supabaseUrl, params.serviceRoleKey, rawRows), params.options);
      const sorted = rows.sort((a, b) => scoreRow(b, diagnosisCodes, params.context, query) - scoreRow(a, diagnosisCodes, params.context, query));
      if (sorted.length === 0 && (plan.source_area === 'precedents' || plan.source_area === 'terms_standards')) {
        console.error('[ragSearch] SILENT_EMPTY source_area returned 0 rows', { source_area: plan.source_area, query: query.slice(0, 80) });
      }
      return { plan, sorted };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isTimeout = msg.includes('timeout');
      console.error(
        isTimeout ? '[ragSearch] RPC_TIMEOUT' : '[ragSearch] RPC_FAIL',
        { source_area: plan.source_area, error: msg },
      );
      return { plan, sorted: [] as EnrichedRow[] };
    }
  });

  for (const entry of planResults) {
    if (!entry) continue; // guard: allSettled slot may yield undefined on unexpected throw
    const { plan, sorted } = entry;

    for (const row of sorted) {
      if (isTitleSeedFss(row)) continue;
      if (row.source_area === 'precedents' && administrativePrecedentText(row)) continue;
      if (isOtherInsurerTerms(row, params.context)) continue;
      if (directlyRelevantOfficial(row, query) && officialRows.filter((item) => item.source_area === plan.source_area).length < plan.count) {
        officialRows.push(row);
      } else if (directlyRelevantInternal(row, query, diagnosisCodes) && internalRows.filter((item) => item.source_area === plan.source_area).length < plan.count) {
        internalRows.push(row);
      }
    }
  }

  if (disclosureQuery(query)) {
    try {
      const statuteRows = await fetchDisclosureStatuteRows(params.supabaseUrl, params.serviceRoleKey);
      for (const row of statuteRows) {
        if (!officialRows.some((item) => item.id === row.id)) officialRows.unshift(row);
      }
    } catch (fetchErr) {
      console.error('[ragSearch] fetchDisclosureStatuteRows failed, proceeding with fallback only', fetchErr instanceof Error ? fetchErr.message : fetchErr);
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
    : '직접 관련 공식근거는 충분히 검색되지 않았으며, 가입 당시 약관, 질병분류표, 판례/분쟁조정례 또는 공식 의학자료 추가 확인이 필요합니다.';

  const internal = result.internalReviewMaterials.length
    ? result.internalReviewMaterials.map((ref, index) => {
      const weakPrecedent = ref.source_area === 'precedents';
      return [
        `[${weakPrecedent ? '판례 참고자료' : '내부검토'} ${index + 1}] ${ref.title}`,
        `자료구분: ${ref.source_area_label}`,
        ref.case_number ? `사건번호: ${ref.case_number}` : '',
        ref.court_or_agency ? `법원/기관: ${ref.court_or_agency}` : '',
        ref.decision_date ? `선고/결정일: ${ref.decision_date}` : '',
        ref.diagnosis_code ? `질병코드: ${ref.diagnosis_code}` : '',
        ref.diagnosis_name ? `진단명: ${ref.diagnosis_name}` : '',
        ref.summary ? `요약: ${ref.summary}` : '',
        weakPrecedent
          ? '주의: 유사 판례 참고자료입니다. review_status 또는 official_citation_allowed 상태상 공식근거, 확정 근거, 지급 확정 근거로 쓰지 말고 판례상 법리 참고로만 사용하세요.'
          : '주의: 내부 검토자료이며 공식 근거로 인용하지 마세요.',
      ].filter(Boolean).join('\n');
    }).join('\n\n')
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
