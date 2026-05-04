// Supabase Edge Function: create-assessment-draft
// OpenAI API key is read only from Edge Function environment variables.

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

type Tone = 'concise' | 'professional' | 'detailed';

interface RetrievedReference {
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

interface SourceAnalysis {
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
}

interface AssessmentDraftInput {
  caseTitle?: string;
  accidentType?: string;
  accidentDate?: string;
  accidentLocation?: string;
  damageDetails?: string;
  insurerPosition?: string;
  customerStatement?: string;
  adjusterMemo?: string;
  sourceAnalysis?: SourceAnalysis;
  tone?: Tone;
  retrievedReferences?: RetrievedReference[];
}

interface AssessmentDraftResult {
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

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o';
const MAX_FIELD_LENGTH = 1800;
const MAX_SHORT_FIELD_LENGTH = 200;
const MAX_REFERENCES = 8;
const MAX_REFERENCE_TEXT_LENGTH = 1200;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function requiredEnv(key: string) {
  const value = Deno.env.get(key);
  if (!value) throw new HttpError(500, `${key} 환경변수가 설정되지 않았습니다.`);
  return value;
}

async function requireAdjuster(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HttpError(401, '로그인이 필요합니다.');
  }

  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const anonKey = requiredEnv('SUPABASE_ANON_KEY');

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: authHeader,
    },
  });

  if (!userRes.ok) throw new HttpError(401, '유효하지 않은 로그인 세션입니다.');

  const user = await userRes.json() as { id?: string };
  if (!user.id) throw new HttpError(401, '사용자 정보를 확인할 수 없습니다.');

  const profileRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=id,user_type`,
    {
      headers: {
        apikey: anonKey,
        authorization: authHeader,
        accept: 'application/json',
      },
    },
  );

  if (!profileRes.ok) throw new HttpError(403, '프로필 권한을 확인할 수 없습니다.');

  const profiles = await profileRes.json() as { id: string; user_type: string }[];
  if (profiles[0]?.user_type !== 'adjuster') {
    throw new HttpError(403, '손해사정사 계정만 사정서 초안을 생성할 수 있습니다.');
  }

  return user;
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function clip(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function cleanStringArray(value: unknown, maxItems = 12) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item))
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => clip(item, MAX_SHORT_FIELD_LENGTH));
}

function validateReferences(rawReferences: unknown): RetrievedReference[] {
  if (rawReferences == null) return [];
  if (!Array.isArray(rawReferences)) {
    throw new HttpError(400, 'retrievedReferences는 배열이어야 합니다.');
  }
  if (rawReferences.length > MAX_REFERENCES) {
    throw new HttpError(400, `참고자료는 최대 ${MAX_REFERENCES}개까지 사용할 수 있습니다.`);
  }

  return rawReferences.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new HttpError(400, `참고자료 ${index + 1} 형식이 올바르지 않습니다.`);
    }

    const ref = item as RetrievedReference;
    return {
      source_type: clip(cleanText(ref.source_type), MAX_SHORT_FIELD_LENGTH),
      title: clip(cleanText(ref.title) || `참고자료 ${index + 1}`, MAX_SHORT_FIELD_LENGTH),
      case_number: clip(cleanText(ref.case_number), MAX_SHORT_FIELD_LENGTH),
      court_or_agency: clip(cleanText(ref.court_or_agency), MAX_SHORT_FIELD_LENGTH),
      decision_date: clip(cleanText(ref.decision_date), MAX_SHORT_FIELD_LENGTH),
      accident_type: clip(cleanText(ref.accident_type), MAX_SHORT_FIELD_LENGTH),
      issue: clip(cleanText(ref.issue), MAX_REFERENCE_TEXT_LENGTH),
      summary: clip(cleanText(ref.summary), MAX_REFERENCE_TEXT_LENGTH),
      key_points: cleanStringArray(ref.key_points),
      conclusion: clip(cleanText(ref.conclusion), MAX_REFERENCE_TEXT_LENGTH),
      keywords: cleanStringArray(ref.keywords),
      source_url: clip(cleanText(ref.source_url), 500),
    };
  });
}

function validateSourceAnalysis(raw: unknown): SourceAnalysis | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as SourceAnalysis;
  return {
    summary: clip(cleanText(value.summary), MAX_REFERENCE_TEXT_LENGTH),
    insurerPosition: clip(cleanText(value.insurerPosition), MAX_REFERENCE_TEXT_LENGTH),
    denialReason: clip(cleanText(value.denialReason), MAX_REFERENCE_TEXT_LENGTH),
    keyIssues: cleanStringArray(value.keyIssues),
    requiredAdditionalChecks: cleanStringArray(value.requiredAdditionalChecks),
    customerMedicalSummary: clip(cleanText(value.customerMedicalSummary), MAX_REFERENCE_TEXT_LENGTH),
    diagnosisSummary: clip(cleanText(value.diagnosisSummary), MAX_REFERENCE_TEXT_LENGTH),
    testResultSummary: clip(cleanText(value.testResultSummary), MAX_REFERENCE_TEXT_LENGTH),
    treatmentSummary: clip(cleanText(value.treatmentSummary), MAX_REFERENCE_TEXT_LENGTH),
    damageEvidenceSummary: clip(cleanText(value.damageEvidenceSummary), MAX_REFERENCE_TEXT_LENGTH),
    draftSupportingFacts: cleanStringArray(value.draftSupportingFacts),
  };
}

function validateInput(input: AssessmentDraftInput) {
  const cleaned = {
    caseTitle: cleanText(input.caseTitle),
    accidentType: cleanText(input.accidentType),
    accidentDate: cleanText(input.accidentDate),
    accidentLocation: cleanText(input.accidentLocation),
    damageDetails: cleanText(input.damageDetails),
    insurerPosition: cleanText(input.insurerPosition),
    customerStatement: cleanText(input.customerStatement),
    adjusterMemo: cleanText(input.adjusterMemo),
    sourceAnalysis: validateSourceAnalysis(input.sourceAnalysis),
    tone: input.tone ?? 'professional',
    retrievedReferences: validateReferences(input.retrievedReferences ?? []),
  };

  if (!['concise', 'professional', 'detailed'].includes(cleaned.tone)) {
    throw new HttpError(400, '문체 값이 올바르지 않습니다.');
  }

  const required: [keyof typeof cleaned, string][] = [
    ['accidentType', '사고 유형'],
    ['accidentDate', '사고 일자'],
    ['accidentLocation', '사고 장소'],
    ['damageDetails', '피해 내용'],
    ['insurerPosition', '보험사 주장/면책 사유'],
    ['customerStatement', '고객 진술 요약'],
  ];

  for (const [key, label] of required) {
    if (!cleaned[key]) throw new HttpError(400, `${label}을 입력해 주세요.`);
  }

  const shortFields: (keyof typeof cleaned)[] = ['caseTitle', 'accidentType', 'accidentDate', 'accidentLocation'];
  for (const key of shortFields) {
    if (String(cleaned[key]).length > MAX_SHORT_FIELD_LENGTH) {
      throw new HttpError(400, `${key} 입력값이 너무 깁니다.`);
    }
  }

  const longFields: (keyof typeof cleaned)[] = ['damageDetails', 'insurerPosition', 'customerStatement', 'adjusterMemo'];
  for (const key of longFields) {
    if (String(cleaned[key]).length > MAX_FIELD_LENGTH) {
      throw new HttpError(400, `${key} 입력값은 ${MAX_FIELD_LENGTH}자 이하로 입력해 주세요.`);
    }
  }

  return cleaned;
}

function toneInstruction(tone: Tone) {
  if (tone === 'concise') return '간결하고 핵심 위주로 작성하되, 쟁점과 추가 확인 사항은 빠뜨리지 마세요.';
  if (tone === 'detailed') return '상세하고 체계적으로 작성하되, 사실관계와 추정 의견을 명확히 구분하세요.';
  return '전문적인 손해사정 문체로 작성하되, 실무자가 검토하기 쉽게 구조화하세요.';
}

function formatReferences(references: RetrievedReference[]) {
  if (references.length === 0) {
    return '제공된 판례, 결정례, 분쟁조정례, 약관, 참고자료 없음.';
  }

  return references.map((ref, index) => [
    `[${index + 1}] ${ref.title ?? '제목 없음'}`,
    ref.source_type ? `자료 유형: ${ref.source_type}` : '',
    ref.case_number ? `사건/결정 번호: ${ref.case_number}` : '',
    ref.court_or_agency ? `법원/기관: ${ref.court_or_agency}` : '',
    ref.decision_date ? `선고/결정일: ${ref.decision_date}` : '',
    ref.accident_type ? `사고 유형: ${ref.accident_type}` : '',
    ref.issue ? `쟁점: ${ref.issue}` : '',
    ref.summary ? `요약: ${ref.summary}` : '',
    ref.key_points?.length ? `핵심 포인트: ${ref.key_points.join(' / ')}` : '',
    ref.conclusion ? `결론: ${ref.conclusion}` : '',
    ref.keywords?.length ? `키워드: ${ref.keywords.join(', ')}` : '',
    ref.source_url ? `출처 URL: ${ref.source_url}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}

function buildDraftPrompt(input: ReturnType<typeof validateInput>) {
  const source = input.sourceAnalysis;
  return `당신은 보험 손해사정 실무 문서 작성 보조자입니다.
아래 사건 정보, 면책공문 분석 요약, 고객 의학/손해자료 요약, 참고자료 범위 안에서만 손해사정사가 검토할 "사정서 초안"을 작성하세요.

[핵심 원칙]
- AI 결과는 참고용 초안입니다.
- 최종 판단은 손해사정사가 합니다.
- 제공된 사건 정보와 제공된 참고자료 범위 내에서 작성합니다.
- 제공된 참고자료 외 판례/결정례를 지어내지 마세요.
- 참고자료가 없으면 구체적인 판례번호, 사건번호, 결정례 번호, 출처 URL을 쓰지 마세요.
- 의료 자료를 확정 진단처럼 과장하지 마세요.
- 자료에 없는 병명, 검사결과, 장해율, 치료기간, 금액을 지어내지 마세요.
- 고객 의학자료와 손해자료는 제공된 요약 범위에서만 사정서 근거로 반영하세요.
- 근거가 부족한 부분은 "추가 확인 필요"로 표시하세요.
- 개인정보, 주민등록번호, 연락처 등 민감정보를 새로 추정하거나 반복하지 마세요.
- 실제 제출용 완성본이 아니라 검토용 초안임을 명확히 표현하세요.

[문체]
${toneInstruction(input.tone)}

[사건 정보]
사건명/메모: ${input.caseTitle || '미입력'}
사고 유형: ${input.accidentType}
사고 일자: ${input.accidentDate}
사고 장소: ${input.accidentLocation}
피해 내용: ${input.damageDetails}
보험사 주장/면책 사유: ${input.insurerPosition}
고객 진술 요약: ${input.customerStatement}
손해사정사 추가 메모: ${input.adjusterMemo || '없음'}

[면책공문 분석 요약]
문서 요약: ${source?.summary || '없음'}
보험사 주장 요약: ${source?.insurerPosition || '없음'}
면책 사유 요약: ${source?.denialReason || '없음'}
주요 쟁점: ${source?.keyIssues?.join(' / ') || '없음'}
추가 확인 필요: ${source?.requiredAdditionalChecks?.join(' / ') || '없음'}

[고객 의학자료/손해자료 요약]
자료 요약: ${source?.customerMedicalSummary || '없음'}
진단/상병 요약: ${source?.diagnosisSummary || '없음'}
검사결과 요약: ${source?.testResultSummary || '없음'}
치료/입퇴원 요약: ${source?.treatmentSummary || '없음'}
손해 입증자료 요약: ${source?.damageEvidenceSummary || '없음'}
사정서 반영 핵심 근거: ${source?.draftSupportingFacts?.join(' / ') || '없음'}

[제공된 참고자료]
${formatReferences(input.retrievedReferences)}

응답은 아래 JSON 형식으로만 반환하세요. JSON 외 텍스트는 포함하지 마세요.
{
  "title": "제목",
  "overview": "사건 개요",
  "facts": "사실관계",
  "issues": "주요 쟁점",
  "legalAndReferenceBasis": "법률 및 참고자료 근거. 제공된 참고자료가 없으면 구체적인 판례번호나 출처를 쓰지 말고 추가 확인 필요로 표시",
  "damageAssessment": "손해 내용 및 평가. 고객 의학자료/손해자료 요약을 함께 반영하되 과장하지 말 것",
  "insurerPositionReview": "보험사 주장 검토",
  "adjusterOpinionDraft": "손해사정 의견 초안",
  "requiredAdditionalChecks": "추가 확인 필요 사항",
  "simpleClientSummary": "고객에게 안내할 쉬운 요약",
  "disclaimer": "AI 결과는 참고용 초안이며 최종 판단과 제출 전 검토는 손해사정사가 해야 한다는 안내"
}`;
}

function buildReviewPrompt(draft: AssessmentDraftResult, references: RetrievedReference[]) {
  return `아래 사정서 초안 JSON을 검증하고 보정하세요.

[검증 기준]
- 제공된 참고자료 외 판례/결정례/출처/사건번호가 있으면 삭제하거나 "추가 확인 필요"로 바꾸세요.
- 참고자료가 없으면 구체적인 판례번호, 결정례 번호, 출처 URL을 쓰지 마세요.
- 의료 자료를 확정 진단처럼 과장한 표현을 제거하세요.
- 자료에 없는 병명, 검사결과, 장해율, 치료기간, 금액을 지어내지 마세요.
- 근거 없는 단정, 논리 비약, 사실관계에 없는 개인정보 추정을 제거하세요.
- 근거가 부족한 부분은 "추가 확인 필요"로 표시하세요.
- disclaimer에는 참고용 초안이며 최종 검토는 손해사정사가 해야 한다는 취지가 반드시 포함되어야 합니다.
- 응답은 같은 JSON 구조로만 반환하세요.

[제공된 참고자료]
${formatReferences(references)}

[초안 JSON]
${JSON.stringify(draft)}`;
}

async function callOpenAI(apiKey: string, prompt: string, temperature: number) {
  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
      temperature,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('OpenAI API error', res.status, errText);
    throw new HttpError(502, 'AI 사정서 초안 생성 서버 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  }

  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? '';
}

function parseJsonResponse(text: string): AssessmentDraftResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new HttpError(502, 'AI 응답을 분석할 수 없습니다. 다시 시도해 주세요.');

  try {
    const parsed = JSON.parse(match[0]) as Partial<AssessmentDraftResult>;
    const requiredKeys: (keyof AssessmentDraftResult)[] = [
      'title',
      'overview',
      'facts',
      'issues',
      'legalAndReferenceBasis',
      'damageAssessment',
      'insurerPositionReview',
      'adjusterOpinionDraft',
      'requiredAdditionalChecks',
      'simpleClientSummary',
      'disclaimer',
    ];

    for (const key of requiredKeys) {
      if (!parsed[key]?.trim()) {
        throw new HttpError(502, `AI 응답에 ${key} 필드가 없습니다. 다시 시도해 주세요.`);
      }
    }

    return parsed as AssessmentDraftResult;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, 'AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.');
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST 요청만 지원합니다.' }, 405);
  }

  try {
    await requireAdjuster(req);

    const apiKey = requiredEnv('OPENAI_API_KEY');
    const body = await req.json() as AssessmentDraftInput;
    const input = validateInput(body);

    const draftText = await callOpenAI(apiKey, buildDraftPrompt(input), 0.2);
    const draft = parseJsonResponse(draftText);

    const reviewedText = await callOpenAI(
      apiKey,
      buildReviewPrompt(draft, input.retrievedReferences),
      0,
    );
    const reviewed = parseJsonResponse(reviewedText);

    return jsonResponse(reviewed);
  } catch (error: unknown) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    return jsonResponse({ error: message }, status);
  }
});
