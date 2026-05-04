import { supabase } from './supabase';

export interface ImagePayload {
  base64: string;
  mimeType: string;
  name?: string;
}

export interface AnalysisStructuredData {
  insurerPosition: string;
  denialReason: string;
  keyIssues: string[];
  accidentTypeGuess: string;
  customerClaimSummary: string;
  requiredAdditionalChecks: string[];
  customerMedicalSummary?: string;
  diagnosisSummary?: string;
  testResultSummary?: string;
  treatmentSummary?: string;
  damageEvidenceSummary?: string;
  draftSupportingFacts?: string[];
}

export interface AnalysisResult {
  summary: string;
  denial_reasons: string[];
  weak_points: string[];
  counter_arguments: { point: string; argument: string }[];
  relevant_laws: string[];
  precedents: string[];
  recommended_action: string;
  customer_document_summary?: string;
  medical_findings?: string[];
  damage_evidence?: string[];
  draft_supporting_facts?: string[];
  structuredData?: AnalysisStructuredData;
}

async function invokeAnalyzeDocument<T>(body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke('analyze-document', { body });

  if (error) {
    throw new Error(error.message ?? 'Edge Function 호출 중 오류가 발생했습니다.');
  }

  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error((data as { error: string }).error);
  }

  return data as T;
}

export async function analyzeDocument(
  base64: string,
  mimeType: string,
): Promise<AnalysisResult> {
  if (!base64) throw new Error('파일 데이터가 없습니다. 이미지를 다시 선택해 주세요.');

  return invokeAnalyzeDocument<AnalysisResult>({
    action: 'analyze',
    base64,
    mimeType,
  });
}

export async function analyzeDocuments(input: {
  denialDocuments: ImagePayload[];
  customerDocuments: ImagePayload[];
}): Promise<AnalysisResult> {
  if (!input.denialDocuments.length && !input.customerDocuments.length) {
    throw new Error('분석할 이미지를 1장 이상 선택해 주세요.');
  }

  return invokeAnalyzeDocument<AnalysisResult>({
    action: 'analyze',
    denialDocuments: input.denialDocuments,
    customerDocuments: input.customerDocuments,
  });
}

export async function generateCounterDocument(
  analysis: AnalysisResult,
): Promise<string> {
  const result = await invokeAnalyzeDocument<{ document: string }>({
    action: 'counter-doc',
    analysis: analysis as unknown as Record<string, unknown>,
  });

  if (!result.document?.trim()) {
    throw new Error('공문 생성에 실패했습니다. 다시 시도해 주세요.');
  }

  return result.document;
}
