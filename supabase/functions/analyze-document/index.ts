// Supabase Edge Function: analyze-document
// OpenAI GPT-4o vision API를 서버 측에서 호출 (모바일 직접 호출 차단 우회)

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL   = 'gpt-4o';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANALYSIS_PROMPT = `당신은 대한민국 보험법 전문 손해사정사입니다.
업로드된 보험사 면책 공문 이미지를 분석하여 아래 JSON 형식으로만 응답하세요.
JSON 외 다른 텍스트는 절대 포함하지 마세요.

{
  "summary": "문서 전체 요약 (2~3문장, 면책 핵심 내용 포함)",
  "denial_reasons": [
    "보험사가 주장하는 면책 이유 1",
    "면책 이유 2"
  ],
  "weak_points": [
    "보험사 논리의 법적·사실적 취약점 1",
    "취약점 2"
  ],
  "counter_arguments": [
    { "point": "반박 포인트 제목", "argument": "구체적인 반박 논거 (법령·판례 근거 포함)" }
  ],
  "relevant_laws": [
    "상법 제XXX조 (내용 요약)",
    "보험업법 제XX조 (내용 요약)"
  ],
  "precedents": [
    "대법원 XXXX.XX.XX. 선고 XXXX다XXXXX 판결 — 요지"
  ],
  "recommended_action": "피해자가 지금 당장 취해야 할 구체적인 다음 조치"
}`;

// ── OpenAI 요청 헬퍼 ──────────────────────────────────────────
async function callOpenAI(
  apiKey: string,
  messages: unknown[],
  maxTokens = 4096,
): Promise<string> {
  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:       OPENAI_MODEL,
      messages,
      max_tokens:  maxTokens,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API 오류 (${res.status}): ${errText}`);
  }

  const json = await res.json() as { choices: { message: { content: string } }[] };
  return json.choices?.[0]?.message?.content ?? '';
}

// ── 문서 분석 ─────────────────────────────────────────────────
async function analyzeDocument(base64: string, mimeType: string, apiKey: string) {
  if (mimeType === 'application/pdf') {
    throw new Error('PDF는 직접 분석이 지원되지 않습니다.\n문서를 사진으로 촬영하여 업로드해주세요.');
  }

  const supported = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const imageType = supported.includes(mimeType) ? mimeType : 'image/jpeg';

  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url:    `data:${imageType};base64,${base64}`,
            detail: 'high',
          },
        },
        { type: 'text', text: ANALYSIS_PROMPT },
      ],
    },
  ];

  const text = await callOpenAI(apiKey, messages, 4096);

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('AI 응답을 파싱할 수 없습니다. 다시 시도해주세요.');
  return JSON.parse(match[0]);
}

// ── 반박 공문 생성 ────────────────────────────────────────────
async function generateCounterDoc(analysis: Record<string, unknown>, apiKey: string) {
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const denialReasons = (analysis.denial_reasons as string[] | undefined ?? []).join(' / ');
  const counterArgs   = (analysis.counter_arguments as { point: string; argument: string }[] | undefined ?? [])
    .map((a, i) => `  ${i + 1}. ${a.point}: ${a.argument}`).join('\n');
  const laws          = (analysis.relevant_laws as string[] | undefined ?? []).join(', ');
  const precedents    = (analysis.precedents    as string[] | undefined ?? []).join(', ');

  const prompt = `당신은 대한민국 보험법 전문 손해사정사입니다.
아래 분석 결과를 바탕으로 보험사에 발송할 공식 반박 공문을 작성해주세요.
공문 텍스트만 출력하고 다른 설명은 절대 포함하지 마세요.

[분석 결과]
면책 이유: ${denialReasons}
반박 논거:
${counterArgs}
관련 법령: ${laws}
관련 판례: ${precedents}

[공문 작성 기준]
- 날짜: ${today}
- 수신: [보험사명] 귀중
- 발신: [의뢰인 성명] (날인)
- 제목 명시
- 본문에 면책 결정 경위 → 법적 근거 반박 → 판례 인용 순으로 작성
- 보상 이행 기한(수신 후 14일) 명시
- 불응 시 금융감독원 민원·소송 제기 예고
- 공식 법률 문서 문체 사용`;

  const text = await callOpenAI(apiKey, [{ role: 'user', content: prompt }], 2048);
  if (!text.trim()) throw new Error('공문 생성에 실패했습니다. 다시 시도해주세요.');
  return { document: text };
}

// ── 엔트리포인트 ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) throw new Error('서버에 OpenAI API 키가 설정되지 않았습니다.');

    const body = await req.json() as {
      action:    'analyze' | 'counter-doc';
      base64?:   string;
      mimeType?: string;
      analysis?: Record<string, unknown>;
    };

    let result: unknown;

    if (body.action === 'analyze') {
      if (!body.base64)   throw new Error('base64 파일 데이터가 없습니다.');
      if (!body.mimeType) throw new Error('mimeType이 없습니다.');
      result = await analyzeDocument(body.base64, body.mimeType, apiKey);

    } else if (body.action === 'counter-doc') {
      if (!body.analysis) throw new Error('분석 결과가 없습니다.');
      result = await generateCounterDoc(body.analysis, apiKey);

    } else {
      throw new Error(`알 수 없는 action: ${(body as { action: string }).action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.';
    return new Response(JSON.stringify({ error: message }), {
      status:  500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
