import { supabase } from './supabase';
import { ImagePayload } from './openaiApi';
import { formatRagReferencesForText, sanitizeRagSearchResult, type RagSearchResult } from './ragReferences';

export type ClosingReportType = 'interim' | 'final';
export type ClosingFinalOpinion = 'pay' | 'deny' | 'partial' | 'investigate';

export interface ClosingReportInput {
  reportType: ClosingReportType;
  insurerName: string;
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
  caseInfo: {
    receivedDate?: string;
    assignedDate?: string;
    reportDate?: string;
    insuredName?: string;
    claimNumber?: string;
    policyNumber?: string;
    policyName?: string;
    insuranceType?: string;
    coverageType?: string;
    contractDate?: string;
    policyStartDate?: string;
    enrollmentDate?: string;
    policyGeneration?: string;
    policyVersion?: string;
    productName?: string;
    coveragePeriod?: string;
    contractorName?: string;
    accidentDate?: string;
    accidentType?: string;
    diagnosisName?: string;
    diagnosisCode?: string;
    jobClassAtEnrollment?: string;
    jobClassAtAccident?: string;
    claimedCoverage?: string;
    claimSummary?: string;
    investigator?: string;
    claimManager?: string;
  };
  uploadedDocumentAnalysis?: {
    medicalSummary?: string;
    diagnosisSummary?: string;
    testResultSummary?: string;
    treatmentSummary?: string;
    hospitalizationSummary?: string;
    preExistingConditionFindings?: string;
    disclosureDutyIssues?: string;
    investigationSummary?: string;
    additionalCheckItems?: string[];
  };
  adjusterMemo?: string;
  finalOpinion: ClosingFinalOpinion;
  hospitalDocuments?: ImagePayload[];
  insurerDocuments?: ImagePayload[];
  otherDocuments?: ImagePayload[];
}

export interface ClosingReportResult {
  title: string;
  basicInfo: {
    receivedDate: string;
    assignedDate: string;
    reportDate: string;
    insurerName: string;
    insuredName: string;
    claimNumber: string;
    investigator: string;
    claimManager: string;
  };
  contractInfo: string;
  lossInfo: string;
  claimAndInvestigationResult: string;
  keyIssues: string;
  investigationChecklist: string;
  medicalFindings: string;
  disclosureDutyReview: string;
  otherInsuranceInfo: string;
  interviewAndSpecialNotes: string;
  investigationProcessTimeline: string;
  finalOpinion: string;
  requiredAdditionalChecks: string[];
  disclaimer: string;
  retrievedReferences?: RagSearchResult;
}

const INTERNAL_ID_PATTERN = /\b(?:RQ|RSF|RCP|RCD|MIC|PIP|RKA|PST|FSS|PREC|PREC_API|FSS_LATEST)[-_]?\d{3,6}\b/g;
const CHUNK_REFERENCE_PATTERN = /\b(?:medical_issue_code|real_case_pattern|real_case_document|issue_playbook|precedent|fss_latest|terms_raw|fss_dispute_case):[A-Za-z0-9:_-]+\b/g;
const INTERNAL_FIELD_LINE_PATTERN = /^\s*(?:chunk_id|source_id|record_id|source_record_id|source_document_id|embedding_status|review_status|trust_level|source_type)\s*[:=].*$/gim;
const INTERNAL_SOURCE_TYPE_PATTERN = /\binternal_[A-Za-z0-9_:-]*\b/g;

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

function sanitizeClosingReportResult(result: ClosingReportResult): ClosingReportResult {
  return {
    title: cleanPublicText(result.title),
    basicInfo: {
      receivedDate: cleanPublicText(result.basicInfo.receivedDate),
      assignedDate: cleanPublicText(result.basicInfo.assignedDate),
      reportDate: cleanPublicText(result.basicInfo.reportDate),
      insurerName: cleanPublicText(result.basicInfo.insurerName),
      insuredName: cleanPublicText(result.basicInfo.insuredName),
      claimNumber: cleanPublicText(result.basicInfo.claimNumber),
      investigator: cleanPublicText(result.basicInfo.investigator),
      claimManager: cleanPublicText(result.basicInfo.claimManager),
    },
    contractInfo: cleanPublicText(result.contractInfo),
    lossInfo: cleanPublicText(result.lossInfo),
    claimAndInvestigationResult: cleanPublicText(result.claimAndInvestigationResult),
    keyIssues: cleanPublicText(result.keyIssues),
    investigationChecklist: cleanPublicText(result.investigationChecklist),
    medicalFindings: cleanPublicText(result.medicalFindings),
    disclosureDutyReview: cleanPublicText(result.disclosureDutyReview),
    otherInsuranceInfo: cleanPublicText(result.otherInsuranceInfo),
    interviewAndSpecialNotes: cleanPublicText(result.interviewAndSpecialNotes),
    investigationProcessTimeline: cleanPublicText(result.investigationProcessTimeline),
    finalOpinion: cleanPublicText(result.finalOpinion),
    requiredAdditionalChecks: (result.requiredAdditionalChecks ?? []).map(cleanPublicText).filter(Boolean),
    disclaimer: cleanPublicText(result.disclaimer),
    retrievedReferences: sanitizeRagSearchResult(result.retrievedReferences),
  };
}

export function formatClosingReportResult(result: ClosingReportResult) {
  result = sanitizeClosingReportResult(result);
  return [
    `# ${result.title}`,
    '',
    '## 기본정보',
    `보험사명: ${result.basicInfo.insurerName}`,
    `접수일: ${result.basicInfo.receivedDate}`,
    `위임일: ${result.basicInfo.assignedDate}`,
    `보고일자: ${result.basicInfo.reportDate}`,
    `피보험자: ${result.basicInfo.insuredName}`,
    `사고/접수번호: ${result.basicInfo.claimNumber}`,
    `조사자: ${result.basicInfo.investigator}`,
    `보상담당자: ${result.basicInfo.claimManager}`,
    '',
    '## 계약사항',
    result.contractInfo,
    '',
    '## 손해사항',
    result.lossInfo,
    '',
    '## 청구내용 및 조사결과',
    result.claimAndInvestigationResult,
    '',
    '## 주요 쟁점사항',
    result.keyIssues,
    '',
    '## 조사자 확인사항',
    result.investigationChecklist,
    '',
    '## 의학적 확인사항',
    result.medicalFindings,
    '',
    '## 고지의무 검토',
    result.disclosureDutyReview,
    '',
    '## 타사 가입사항',
    result.otherInsuranceInfo,
    '',
    '## 관련자 면담 및 특이사항',
    result.interviewAndSpecialNotes,
    '',
    '## 조사처리과정',
    result.investigationProcessTimeline,
    '',
    '## 최종 조사 의견',
    result.finalOpinion,
    '',
    '## 추가 확인 필요 사항',
    result.requiredAdditionalChecks.map((item) => `- ${item}`).join('\n') || '없음',
    '',
    '## 안내',
    result.disclaimer,
    '',
    formatRagReferencesForText(result.retrievedReferences),
  ].join('\n');
}

export async function createClosingReport(input: ClosingReportInput): Promise<ClosingReportResult> {
  if (!input.insurerName.trim()) throw new Error('보험사명을 입력해 주세요.');
  if (!input.reportType) throw new Error('보고서 유형을 선택해 주세요.');

  const { data, error } = await supabase.functions.invoke('create-closing-report', {
    body: {
      ...input,
      contractDate: input.contractDate?.trim() || 'unknown',
      caseInfo: {
        ...input.caseInfo,
        contractDate: input.caseInfo.contractDate?.trim() || input.contractDate?.trim() || 'unknown',
      },
    },
  });

  if (error) {
    throw new Error(error.message ?? '종결보고서 생성 중 오류가 발생했습니다.');
  }

  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error((data as { error: string }).error);
  }

  const result = sanitizeClosingReportResult(data as ClosingReportResult);
  if (!result?.title?.trim() || !result.finalOpinion?.trim()) {
    throw new Error('종결보고서 생성에 실패했습니다. 다시 시도해 주세요.');
  }

  return result;
}
