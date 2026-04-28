import { supabase } from './supabase';

export interface AnalysisResult {
  summary: string;
  denial_reasons: string[];
  weak_points: string[];
  counter_arguments: { point: string; argument: string }[];
  relevant_laws: string[];
  precedents: string[];
  recommended_action: string;
}

// Edge Function 호출 헬퍼
async function invokeEdge<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('analyze-document', { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as T;
}

// 면책 공문 분석
export async function analyzeDocument(
  base64: string,
  mimeType: string
): Promise<AnalysisResult> {
  if (!base64) throw new Error('파일 데이터가 없습니다. 파일을 다시 선택해주세요.');
  return invokeEdge<AnalysisResult>({ action: 'analyze', base64, mimeType });
}

// 반박 공문 생성
export async function generateCounterDocument(
  analysis: AnalysisResult
): Promise<string> {
  const result = await invokeEdge<{ document: string }>({
    action: 'counter-doc',
    analysis,
  });
  return result.document;
}
