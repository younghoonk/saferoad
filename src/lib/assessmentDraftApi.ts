import { supabase } from './supabase';
import { formatRagReferencesForText, sanitizeRagSearchResult, type RagSearchResult } from './ragReferences';

export type AssessmentDraftTone = 'concise' | 'professional' | 'detailed';

export interface RetrievedReference {
  source_area?: string;
  source_type?: string;
  chunk_id?: string;
  source_id?: string;
  record_id?: string;
  source_record_id?: string;
  source_document_id?: string;
  title?: string;
  case_number?: string;
  court_or_agency?: string;
  decision_date?: string;
  law_name?: string;
  article_title?: string;
  diagnosis_code?: string;
  diagnosis_name?: string;
  accident_type?: string;
  issue?: string;
  summary?: string;
  chunk_text?: string;
  key_points?: string[];
  conclusion?: string;
  keywords?: string[];
  source_url?: string;
  embedding_status?: string;
  review_status?: string;
  trust_level?: string;
}

export interface AssessmentDraftInput {
  caseTitle?: string;
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
  accidentType: string;
  accidentDate: string;
  accidentLocation: string;
  damageDetails: string;
  insurerPosition: string;
  customerStatement: string;
  adjusterMemo?: string;
  sourceAnalysis?: {
    summary?: string;
    insurerPosition?: string;
    denialReason?: string;
    keyIssues?: string[];
    requiredAdditionalChecks?: string[];
    customerMedicalSummary?: string;
    diagnosisSummary?: string;
    testResultSummary?: string;
    treatmentSummary?: string;
    damageEvidenceSummary?: string;
    draftSupportingFacts?: string[];
  };
  tone: AssessmentDraftTone;
  retrievedReferences: RetrievedReference[];
}

export interface AssessmentDraftResult {
  title: string;
  overview: string;
  facts: string;
  issues: string;
  legalAndReferenceBasis: string;
  damageAssessment: string;
  insurerPositionReview: string;
  adjusterOpinionDraft: string;
  requiredAdditionalChecks: string;
  simpleClientSummary: string;
  disclaimer: string;
  retrievedReferences?: RagSearchResult;
}

const INTERNAL_ID_PATTERN = /\b(?:RQ|RSF|RCP|RCD|MIC|PIP|RKA|PST|FSS|PREC|PREC_API|FSS_LATEST)[-_]?\d{3,6}\b/g;
const CHUNK_REFERENCE_PATTERN = /\b(?:medical_issue_code|real_case_pattern|real_case_document|issue_playbook|precedent|fss_latest|terms_raw|fss_dispute_case):[A-Za-z0-9:_-]+\b/g;
const INTERNAL_FIELD_LINE_PATTERN = /^\s*(?:chunk_id|source_id|record_id|source_record_id|source_document_id|embedding_status|review_status|trust_level|source_type)\s*[:=].*$/gim;
const INTERNAL_SOURCE_TYPE_PATTERN = /\binternal_[A-Za-z0-9_:-]*\b/g;

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

function cleanPublicText(value?: string) {
  return (value ?? '')
    .replace(INTERNAL_FIELD_LINE_PATTERN, '')
    .replace(CHUNK_REFERENCE_PATTERN, '')
    .replace(INTERNAL_ID_PATTERN, '')
    .replace(INTERNAL_SOURCE_TYPE_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function cleanPublicArray(values?: string[]) {
  if (!Array.isArray(values)) return [];
  return values.map(cleanPublicText).filter(Boolean);
}

function publicSourceLabel(reference: RetrievedReference) {
  if (reference.source_area && sourceAreaLabels[reference.source_area]) {
    return sourceAreaLabels[reference.source_area];
  }
  if (reference.source_type?.startsWith('internal_')) return '';
  return cleanPublicText(reference.source_type);
}

function sanitizeRetrievedReferences(references?: RetrievedReference[]) {
  return (references ?? []).map((reference) => ({
    source_area_label: publicSourceLabel(reference),
    title: cleanPublicText(reference.title),
    case_number: cleanPublicText(reference.case_number),
    court_or_agency: cleanPublicText(reference.court_or_agency),
    decision_date: cleanPublicText(reference.decision_date),
    law_name: cleanPublicText(reference.law_name),
    article_title: cleanPublicText(reference.article_title),
    diagnosis_code: cleanPublicText(reference.diagnosis_code),
    diagnosis_name: cleanPublicText(reference.diagnosis_name),
    accident_type: cleanPublicText(reference.accident_type),
    issue: cleanPublicText(reference.issue),
    summary: cleanPublicText(reference.summary || reference.chunk_text),
    key_points: cleanPublicArray(reference.key_points),
    conclusion: cleanPublicText(reference.conclusion),
    keywords: cleanPublicArray(reference.keywords),
    source_url: cleanPublicText(reference.source_url),
  }));
}

function sanitizeAssessmentDraftResult(result: AssessmentDraftResult): AssessmentDraftResult {
  return {
    title: cleanPublicText(result.title),
    overview: cleanPublicText(result.overview),
    facts: cleanPublicText(result.facts),
    issues: cleanPublicText(result.issues),
    legalAndReferenceBasis: cleanPublicText(result.legalAndReferenceBasis),
    damageAssessment: cleanPublicText(result.damageAssessment),
    insurerPositionReview: cleanPublicText(result.insurerPositionReview),
    adjusterOpinionDraft: cleanPublicText(result.adjusterOpinionDraft),
    requiredAdditionalChecks: cleanPublicText(result.requiredAdditionalChecks),
    simpleClientSummary: cleanPublicText(result.simpleClientSummary),
    disclaimer: cleanPublicText(result.disclaimer),
    retrievedReferences: sanitizeRagSearchResult(result.retrievedReferences),
  };
}

export function formatAssessmentDraftResult(result: AssessmentDraftResult) {
  const safeResult = sanitizeAssessmentDraftResult(result);
  return [
    `# ${safeResult.title}`,
    '',
    '## 사건 개요',
    safeResult.overview,
    '',
    '## 사실관계',
    safeResult.facts,
    '',
    '## 주요 쟁점',
    safeResult.issues,
    '',
    '## 법률 및 참고자료 근거',
    safeResult.legalAndReferenceBasis,
    '',
    '## 손해 내용 및 평가',
    safeResult.damageAssessment,
    '',
    '## 보험사 주장 검토',
    safeResult.insurerPositionReview,
    '',
    '## 손해사정 의견 초안',
    safeResult.adjusterOpinionDraft,
    '',
    '## 추가 확인 필요 사항',
    safeResult.requiredAdditionalChecks,
    '',
    '## 고객에게 안내할 쉬운 요약',
    safeResult.simpleClientSummary,
    '',
    '## 안내',
    safeResult.disclaimer,
    '',
    formatRagReferencesForText(safeResult.retrievedReferences),
  ].join('\n');
}

export async function createAssessmentDraft(
  input: AssessmentDraftInput,
): Promise<AssessmentDraftResult> {
  if (!input.accidentType.trim()) throw new Error('사고 유형을 입력해 주세요.');
  if (!input.accidentDate.trim()) throw new Error('사고 일자를 입력해 주세요.');
  if (!input.accidentLocation.trim()) throw new Error('사고 장소를 입력해 주세요.');
  if (!input.damageDetails.trim()) throw new Error('피해 내용을 입력해 주세요.');
  if (!input.insurerPosition.trim()) throw new Error('보험사 주장 또는 면책 사유를 입력해 주세요.');
  if (!input.customerStatement.trim()) throw new Error('고객 진술 요약을 입력해 주세요.');

  const { data, error } = await supabase.functions.invoke('create-assessment-draft', {
    body: {
      ...input,
      retrievedReferences: sanitizeRetrievedReferences(input.retrievedReferences),
    },
  });

  if (error) {
    throw new Error(error.message ?? '사정서 초안 생성 중 오류가 발생했습니다.');
  }

  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error((data as { error: string }).error);
  }

  const result = sanitizeAssessmentDraftResult(data as AssessmentDraftResult);
  if (
    !result?.title?.trim()
    || !result.legalAndReferenceBasis?.trim()
    || !result.adjusterOpinionDraft?.trim()
  ) {
    throw new Error('사정서 초안 생성에 실패했습니다. 다시 시도해 주세요.');
  }

  return result;
}
