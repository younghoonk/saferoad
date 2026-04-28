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

// ── Edge Function 호출 헬퍼 ───────────────────────────────────────────────────

async function invokeEdgeFunction<T>(body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke('analyze-document', { body });

  if (error) {
    throw new Error(error.message ?? 'Edge Function 호출 오류가 발생했습니다.');
  }

  // Edge Function이 { error: string } 형태로 오류를 반환하는 경우 처리
  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error((data as { error: string }).error);
  }

  return data as T;
}

// ── 공개 함수 ─────────────────────────────────────────────────────────────────

/** 면책 공문 이미지 분석 */
export async function analyzeDocument(
  base64: string,
  mimeType: string,
): Promise<AnalysisResult> {
  if (!base64) throw new Error('파일 데이터가 없습니다. 파일을 다시 선택해주세요.');

  return invokeEdgeFunction<AnalysisResult>({
    action:   'analyze',
    base64,
    mimeType,
  });
}

/** 반박 공문 자동 생성 */
export async function generateCounterDocument(
  analysis: AnalysisResult,
): Promise<string> {
  const result = await invokeEdgeFunction<{ document: string }>({
    action:   'counter-doc',
    analysis: analysis as unknown as Record<string, unknown>,
  });

  if (!result.document?.trim()) {
    throw new Error('공문 생성에 실패했습니다. 다시 시도해주세요.');
  }

  return result.document;
}
