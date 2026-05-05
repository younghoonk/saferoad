export interface RagRetrievedReference {
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
  officialReferences: RagRetrievedReference[];
  internalReviewMaterials: RagRetrievedReference[];
}

const INTERNAL_ID_PATTERN = /\b(?:RQ|RSF|RCP|RCD|MIC|PIP|RKA|PST|FSS|PREC|PREC_API|FSS_LATEST)[-_]?\d{3,6}\b/g;
const CHUNK_REFERENCE_PATTERN = /\b(?:medical_issue_code|real_case_pattern|real_case_document|issue_playbook|precedent|fss_latest|terms_raw|fss_dispute_case):[A-Za-z0-9:_-]+\b/g;
const INTERNAL_FIELD_LINE_PATTERN = /^\s*(?:chunk_id|source_id|record_id|source_record_id|source_document_id|embedding_status|review_status|trust_level|source_type)\s*[:=].*$/gim;
const INTERNAL_SOURCE_TYPE_PATTERN = /\binternal_[A-Za-z0-9_:-]*\b/g;

export const ragSourceAreaLabels: Record<string, string> = {
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

export const blockedOfficialSourceDomains = [
  'okclaim.com',
  'insclaim.co.kr',
  'blog.naver.com',
  'm.blog.naver.com',
  'tistory.com',
  'brunch.co.kr',
];

function hostnameFromUrl(sourceUrl?: string) {
  const value = cleanRagPublicText(sourceUrl);
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

export function isBlockedOfficialSource(sourceUrl?: string) {
  const hostname = hostnameFromUrl(sourceUrl);
  return Boolean(hostname && matchDomain(hostname, blockedOfficialSourceDomains));
}

export function getSourceDisplayName(sourceUrl?: string, sourceArea?: string, title?: string) {
  const hostname = hostnameFromUrl(sourceUrl);
  if (hostname) {
    const matched = Object.entries(sourceDomainDisplayNames)
      .find(([domain]) => hostname === domain || hostname.endsWith(`.${domain}`));
    if (matched) return matched[1];
  }

  const area = cleanRagPublicText(sourceArea);
  if (area && ragSourceAreaLabels[area]) return ragSourceAreaLabels[area];
  const safeTitle = cleanRagPublicText(title);
  if (/상법|민법|보험업법|법령|조문/.test(safeTitle)) return '국가법령정보센터';
  if (/금융감독원|분쟁조정/.test(safeTitle)) return '금융감독원';
  if (/질병관리청|국가건강정보/.test(safeTitle)) return '질병관리청 국가건강정보포털';
  return area || '참고자료';
}

export function cleanRagPublicText(value?: string | number | null) {
  return String(value ?? '')
    .replace(INTERNAL_FIELD_LINE_PATTERN, '')
    .replace(CHUNK_REFERENCE_PATTERN, '')
    .replace(INTERNAL_ID_PATTERN, '')
    .replace(INTERNAL_SOURCE_TYPE_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function sanitizeReference(reference: Partial<RagRetrievedReference>): RagRetrievedReference | null {
  const sourceArea = cleanRagPublicText(reference.source_area);
  const title = cleanRagPublicText(reference.title);
  const summary = cleanRagPublicText(reference.summary);
  if (!sourceArea && !title && !summary) return null;

  return {
    reference_type: reference.reference_type === 'internal' ? 'internal' : 'official',
    source_area: sourceArea,
    source_area_label: cleanRagPublicText(reference.source_area_label) || ragSourceAreaLabels[sourceArea] || sourceArea,
    title: title || '참고자료',
    summary,
    source_url: cleanRagPublicText(reference.source_url),
    sourceDisplayName: cleanRagPublicText(reference.sourceDisplayName)
      || getSourceDisplayName(reference.source_url, sourceArea, title),
    similarity: typeof reference.similarity === 'number' ? reference.similarity : undefined,
    case_number: cleanRagPublicText(reference.case_number),
    court_or_agency: cleanRagPublicText(reference.court_or_agency),
    decision_date: cleanRagPublicText(reference.decision_date),
    law_name: cleanRagPublicText(reference.law_name),
    article_title: cleanRagPublicText(reference.article_title),
    diagnosis_code: cleanRagPublicText(reference.diagnosis_code),
    diagnosis_name: cleanRagPublicText(reference.diagnosis_name),
    note: cleanRagPublicText(reference.note),
  };
}

export function sanitizeRagSearchResult(value: unknown): RagSearchResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Partial<RagSearchResult>;
  const officialReferences = Array.isArray(raw.officialReferences)
    ? raw.officialReferences
      .filter((item) => !isBlockedOfficialSource(item.source_url))
      .map(sanitizeReference)
      .filter((item): item is RagRetrievedReference => Boolean(item))
    : [];
  const internalReviewMaterials = Array.isArray(raw.internalReviewMaterials)
    ? raw.internalReviewMaterials.map((item) => sanitizeReference({ ...item, reference_type: 'internal' })).filter((item): item is RagRetrievedReference => Boolean(item))
    : [];

  return {
    query: cleanRagPublicText(raw.query),
    officialReferences,
    internalReviewMaterials,
  };
}

function formatReferenceLines(reference: RagRetrievedReference) {
  return [
    `- ${reference.source_area_label}: ${reference.title}`,
    reference.law_name ? `  법령명: ${reference.law_name}` : '',
    reference.article_title ? `  조문명: ${reference.article_title}` : '',
    reference.case_number ? `  사건번호: ${reference.case_number}` : '',
    reference.court_or_agency ? `  법원/기관: ${reference.court_or_agency}` : '',
    reference.decision_date ? `  선고/결정일자: ${reference.decision_date}` : '',
    reference.diagnosis_code ? `  질병코드: ${reference.diagnosis_code}` : '',
    reference.diagnosis_name ? `  진단명: ${reference.diagnosis_name}` : '',
    `  출처: ${reference.sourceDisplayName || getSourceDisplayName(reference.source_url, reference.source_area, reference.title)}`,
    reference.summary ? `  요약: ${reference.summary}` : '',
  ].filter(Boolean);
}

export function formatRagReferencesForText(references?: RagSearchResult) {
  const safe = sanitizeRagSearchResult(references);
  if (!safe || (!safe.officialReferences.length && !safe.internalReviewMaterials.length)) {
    return '검색된 RAG 참고근거 없음';
  }

  const lines = ['## RAG 참고 근거'];
  if (safe.officialReferences.length) {
    lines.push('', '### 공식/준공식 근거');
    safe.officialReferences.forEach((reference) => lines.push(...formatReferenceLines(reference)));
  }
  if (safe.internalReviewMaterials.length) {
    lines.push('', '### 내부 검토자료', '아래 자료는 쟁점 검토용이며 공식 근거로 인용하지 않습니다.');
    safe.internalReviewMaterials.forEach((reference) => lines.push(...formatReferenceLines(reference)));
  }
  return lines.join('\n');
}
