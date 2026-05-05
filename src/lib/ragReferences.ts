export interface RagRetrievedReference {
  reference_type: 'official' | 'internal';
  source_area: string;
  source_area_label: string;
  title: string;
  summary?: string;
  source_url?: string;
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
    ? raw.officialReferences.map(sanitizeReference).filter((item): item is RagRetrievedReference => Boolean(item))
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
    reference.source_url ? `  출처: ${reference.source_url}` : '',
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
