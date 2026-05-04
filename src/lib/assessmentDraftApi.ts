import { supabase } from './supabase';

export type AssessmentDraftTone = 'concise' | 'professional' | 'detailed';

export interface RetrievedReference {
  source_type?: string;
  title?: string;
  case_number?: string;
  court_or_agency?: string;
  decision_date?: string;
  accident_type?: string;
  issue?: string;
  summary?: string;
  key_points?: string[];
  conclusion?: string;
  keywords?: string[];
  source_url?: string;
}

export interface AssessmentDraftInput {
  caseTitle?: string;
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
}

export function formatAssessmentDraftResult(result: AssessmentDraftResult) {
  return [
    `# ${result.title}`,
    '',
    '## 사건 개요',
    result.overview,
    '',
    '## 사실관계',
    result.facts,
    '',
    '## 주요 쟁점',
    result.issues,
    '',
    '## 법률 및 참고자료 근거',
    result.legalAndReferenceBasis,
    '',
    '## 손해 내용 및 평가',
    result.damageAssessment,
    '',
    '## 보험사 주장 검토',
    result.insurerPositionReview,
    '',
    '## 손해사정 의견 초안',
    result.adjusterOpinionDraft,
    '',
    '## 추가 확인 필요 사항',
    result.requiredAdditionalChecks,
    '',
    '## 고객에게 안내할 쉬운 요약',
    result.simpleClientSummary,
    '',
    '## 안내',
    result.disclaimer,
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
      retrievedReferences: input.retrievedReferences ?? [],
    },
  });

  if (error) {
    throw new Error(error.message ?? '사정서 초안 생성 중 오류가 발생했습니다.');
  }

  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error((data as { error: string }).error);
  }

  const result = data as AssessmentDraftResult;
  if (
    !result?.title?.trim()
    || !result.legalAndReferenceBasis?.trim()
    || !result.adjusterOpinionDraft?.trim()
  ) {
    throw new Error('사정서 초안 생성에 실패했습니다. 다시 시도해 주세요.');
  }

  return result;
}
