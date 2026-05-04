import { supabase } from './supabase';
import { ImagePayload } from './openaiApi';

export type ClosingReportType = 'interim' | 'final';
export type ClosingFinalOpinion = 'pay' | 'deny' | 'partial' | 'investigate';

export interface ClosingReportInput {
  reportType: ClosingReportType;
  insurerName: string;
  caseInfo: {
    receivedDate?: string;
    assignedDate?: string;
    reportDate?: string;
    insuredName?: string;
    claimNumber?: string;
    policyNumber?: string;
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
}

export function formatClosingReportResult(result: ClosingReportResult) {
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
  ].join('\n');
}

export async function createClosingReport(input: ClosingReportInput): Promise<ClosingReportResult> {
  if (!input.insurerName.trim()) throw new Error('보험사명을 입력해 주세요.');
  if (!input.reportType) throw new Error('보고서 유형을 선택해 주세요.');

  const { data, error } = await supabase.functions.invoke('create-closing-report', {
    body: input,
  });

  if (error) {
    throw new Error(error.message ?? '종결보고서 생성 중 오류가 발생했습니다.');
  }

  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error((data as { error: string }).error);
  }

  const result = data as ClosingReportResult;
  if (!result?.title?.trim() || !result.finalOpinion?.trim()) {
    throw new Error('종결보고서 생성에 실패했습니다. 다시 시도해 주세요.');
  }

  return result;
}
