// Supabase Edge Function: analyze-document
// OpenAI API key is read only from Edge Function environment variables.

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANALYSIS_PROMPT = `당신은 교통사고 보험 보상과 손해사정 실무에 밝은 전문가입니다.
업로드된 보험사 면책 공문 이미지를 분석해 아래 JSON 형식으로만 답변하세요.
JSON 외의 설명은 포함하지 마세요.

{
  "summary": "문서 전체 요약",
  "denial_reasons": ["보험사가 주장하는 면책 사유"],
  "weak_points": ["보험사 논리의 취약점"],
  "counter_arguments": [
    { "point": "반박 포인트", "argument": "구체적인 반박 근거" }
  ],
  "relevant_laws": ["관련 법령 또는 약관"],
  "precedents": ["관련 판례 또는 실무상 참고점"],
  "recommended_action": "지금 취해야 할 다음 조치"
}`;

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

async function requireAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HttpError(401, '로그인이 필요합니다.');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    throw new HttpError(500, '서버 인증 환경변수가 설정되지 않았습니다.');
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: authHeader,
    },
  });

  if (!res.ok) {
    throw new HttpError(401, '유효하지 않은 로그인 세션입니다.');
  }

  return res.json();
}

function estimateBase64Bytes(base64: string) {
  const normalized = base64.replace(/^data:[^;]+;base64,/, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

async function callOpenAI(apiKey: string, messages: unknown[], maxTokens = 4096): Promise<string> {
  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('OpenAI API error', res.status, errText);
    throw new HttpError(502, 'AI 분석 서버 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  }

  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? '';
}

async function analyzeDocument(base64: string, mimeType: string, apiKey: string) {
  if (mimeType === 'application/pdf') {
    throw new HttpError(415, 'PDF는 현재 지원하지 않습니다. 문서를 이미지로 캡처해 업로드해 주세요.');
  }

  if (!SUPPORTED_IMAGE_TYPES.includes(mimeType)) {
    throw new HttpError(415, 'JPG, PNG, WEBP, GIF 이미지만 업로드할 수 있습니다.');
  }

  if (estimateBase64Bytes(base64) > MAX_FILE_BYTES) {
    throw new HttpError(413, '파일 크기는 8MB 이하만 지원합니다.');
  }

  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64}`,
            detail: 'high',
          },
        },
        { type: 'text', text: ANALYSIS_PROMPT },
      ],
    },
  ];

  const text = await callOpenAI(apiKey, messages, 4096);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new HttpError(502, 'AI 응답을 분석할 수 없습니다. 다시 시도해 주세요.');
  }

  try {
    return JSON.parse(match[0]);
  } catch {
    throw new HttpError(502, 'AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.');
  }
}

async function generateCounterDoc(analysis: Record<string, unknown>, apiKey: string) {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const denialReasons = (analysis.denial_reasons as string[] | undefined ?? []).join(' / ');
  const counterArgs = (analysis.counter_arguments as { point: string; argument: string }[] | undefined ?? [])
    .map((item, index) => `${index + 1}. ${item.point}: ${item.argument}`)
    .join('\n');
  const laws = (analysis.relevant_laws as string[] | undefined ?? []).join(', ');
  const precedents = (analysis.precedents as string[] | undefined ?? []).join(', ');

  const prompt = `당신은 교통사고 보험 보상과 손해사정 실무에 밝은 전문가입니다.
아래 분석 결과를 바탕으로 보험사에 보낼 공식 반박 공문 초안을 작성하세요.
공문 본문만 출력하고 별도 설명은 포함하지 마세요.

[분석 결과]
면책 사유: ${denialReasons}
반박 근거:
${counterArgs}
관련 법령: ${laws}
관련 판례: ${precedents}

[작성 기준]
- 날짜: ${today}
- 수신, 발신, 제목을 포함
- 면책 결정 경위와 법적 근거 반박을 구체적으로 작성
- 보상 이행 기한과 미이행 시 후속 조치를 명시
- 공식 문서 문체 사용`;

  const text = await callOpenAI(apiKey, [{ role: 'user', content: prompt }], 2048);
  if (!text.trim()) {
    throw new HttpError(502, '공문 생성에 실패했습니다. 다시 시도해 주세요.');
  }

  return { document: text };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST 요청만 지원합니다.' }, 405);
  }

  try {
    await requireAuthenticatedUser(req);

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      throw new HttpError(500, '서버에 OpenAI API 키가 설정되지 않았습니다.');
    }

    const body = await req.json() as {
      action?: 'analyze' | 'counter-doc';
      base64?: string;
      mimeType?: string;
      analysis?: Record<string, unknown>;
    };

    if (body.action === 'analyze') {
      if (!body.base64) throw new HttpError(400, '이미지 데이터가 없습니다.');
      if (!body.mimeType) throw new HttpError(400, '이미지 형식 정보가 없습니다.');
      return jsonResponse(await analyzeDocument(body.base64, body.mimeType, apiKey));
    }

    if (body.action === 'counter-doc') {
      if (!body.analysis) throw new HttpError(400, '분석 결과가 없습니다.');
      return jsonResponse(await generateCounterDoc(body.analysis, apiKey));
    }

    throw new HttpError(400, '지원하지 않는 작업입니다.');
  } catch (error: unknown) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error
      ? error.message
      : '알 수 없는 오류가 발생했습니다.';
    return jsonResponse({ error: message }, status);
  }
});
