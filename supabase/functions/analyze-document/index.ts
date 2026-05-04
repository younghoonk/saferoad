// Supabase Edge Function: analyze-document
// OpenAI API key is read only from Edge Function environment variables.

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

interface ImagePayload {
  base64?: string;
  mimeType?: string;
  name?: string;
}

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENTS_PER_GROUP = 5;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANALYSIS_PROMPT = `당신은 보험 보상과 손해사정 실무에 밝은 전문가입니다.
업로드된 이미지는 두 그룹입니다.
- denialDocuments: 보험사 면책공문, 안내문, 거절 통지 등. 보험사 주장, 면책 사유, 거절 사유를 중심으로 분석합니다.
- customerDocuments: 진단서, 의사 소견서, 검사결과지, 진료기록, 입퇴원확인서, 사고/손해 관련 서류. 진단명, 의학적 소견, 검사결과, 치료내용, 손해 입증 자료를 중심으로 분석합니다.

[안전 규칙]
- PDF는 지원하지 않으며, 제공된 이미지 내용만 근거로 분석합니다.
- 의료 자료를 확정 진단처럼 과장하지 마세요.
- 자료에 없는 병명, 검사결과, 장해율, 치료기간, 금액을 지어내지 마세요.
- 근거가 부족한 부분은 "추가 확인 필요"로 표시하세요.
- 민감정보는 불필요하게 반복하지 말고 요약 중심으로 작성하세요.
- 판례/결정례가 이미지에 명확히 제공되지 않았으면 구체적인 판례번호를 지어내지 마세요.

아래 JSON 형식으로만 답변하세요. JSON 외 설명은 포함하지 마세요.
{
  "summary": "전체 자료 요약",
  "denial_reasons": ["보험사가 주장하는 면책 또는 거절 사유"],
  "weak_points": ["보험사 논리의 취약점 또는 추가 검토 지점"],
  "counter_arguments": [
    { "point": "반박 포인트", "argument": "제공 자료 범위 내 구체적인 반박 근거" }
  ],
  "relevant_laws": ["이미지에 명확히 나타나거나 일반적 검토가 필요한 법령/약관. 불명확하면 추가 확인 필요"],
  "precedents": ["이미지에 명확히 제공된 판례/결정례만 기재. 없으면 빈 배열"],
  "recommended_action": "지금 취해야 할 다음 조치",
  "customer_document_summary": "고객 의학자료/손해자료 요약",
  "medical_findings": ["진단, 소견, 검사, 치료 관련 핵심 내용"],
  "damage_evidence": ["사고 또는 손해를 뒷받침하는 자료상 근거"],
  "draft_supporting_facts": ["사정서 초안에 반영할 핵심 근거"],
  "structuredData": {
    "insurerPosition": "보험사 주장의 핵심 요약",
    "denialReason": "면책 사유 요약",
    "keyIssues": ["사정서 초안에 반영할 주요 쟁점"],
    "accidentTypeGuess": "자료에서 추정 가능한 사고 유형. 근거가 부족하면 빈 문자열",
    "customerClaimSummary": "고객 주장 또는 청구 취지 요약. 자료에 없으면 빈 문자열",
    "requiredAdditionalChecks": ["초안 작성 전 추가 확인이 필요한 사항"],
    "customerMedicalSummary": "고객 의학자료/손해자료 핵심 요약",
    "diagnosisSummary": "진단명/상병명 요약. 자료에 없으면 빈 문자열",
    "testResultSummary": "검사결과 요약. 자료에 없으면 빈 문자열",
    "treatmentSummary": "치료 및 입퇴원 내용 요약. 자료에 없으면 빈 문자열",
    "damageEvidenceSummary": "손해 입증자료 요약",
    "draftSupportingFacts": ["사정서 초안에 넣을 수 있는 자료 기반 근거"]
  }
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

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeImagePayloads(raw: unknown, label: string) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, `${label}는 배열이어야 합니다.`);
  if (raw.length > MAX_DOCUMENTS_PER_GROUP) {
    throw new HttpError(400, `${label}는 최대 ${MAX_DOCUMENTS_PER_GROUP}장까지 업로드할 수 있습니다.`);
  }

  return raw.map((item, index) => {
    const image = item as ImagePayload;
    if (!image?.base64) throw new HttpError(400, `${label} ${index + 1}번 이미지 데이터가 없습니다.`);
    if (!image.mimeType) throw new HttpError(400, `${label} ${index + 1}번 이미지 형식 정보가 없습니다.`);
    if (image.mimeType === 'application/pdf') {
      throw new HttpError(415, 'PDF는 현재 지원하지 않습니다. 문서를 이미지로 캡처해 업로드해 주세요.');
    }
    if (!SUPPORTED_IMAGE_TYPES.includes(image.mimeType)) {
      throw new HttpError(415, 'JPG, PNG, WEBP, GIF 이미지만 업로드할 수 있습니다.');
    }

    const size = estimateBase64Bytes(image.base64);
    if (size > MAX_FILE_BYTES) {
      throw new HttpError(413, `${label} ${index + 1}번 이미지가 8MB를 초과합니다.`);
    }

    return {
      base64: image.base64.replace(/^data:[^;]+;base64,/, ''),
      mimeType: image.mimeType,
      name: typeof image.name === 'string' ? image.name : `${label}-${index + 1}`,
      size,
    };
  });
}

function buildImageContent(denialDocuments: ReturnType<typeof normalizeImagePayloads>, customerDocuments: ReturnType<typeof normalizeImagePayloads>) {
  const content: unknown[] = [
    { type: 'text', text: ANALYSIS_PROMPT },
    { type: 'text', text: `[denialDocuments] ${denialDocuments.length}장` },
  ];

  denialDocuments.forEach((image, index) => {
    content.push({ type: 'text', text: `denialDocuments ${index + 1}: ${image.name}` });
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${image.mimeType};base64,${image.base64}`,
        detail: 'high',
      },
    });
  });

  content.push({ type: 'text', text: `[customerDocuments] ${customerDocuments.length}장` });
  customerDocuments.forEach((image, index) => {
    content.push({ type: 'text', text: `customerDocuments ${index + 1}: ${image.name}` });
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${image.mimeType};base64,${image.base64}`,
        detail: 'high',
      },
    });
  });

  return content;
}

function normalizeAnalysisResult(parsed: Record<string, unknown>) {
  const structured = parsed.structuredData && typeof parsed.structuredData === 'object'
    ? parsed.structuredData as Record<string, unknown>
    : {};
  const denialReasons = stringArray(parsed.denial_reasons);
  const weakPoints = stringArray(parsed.weak_points);
  const medicalFindings = stringArray(parsed.medical_findings);
  const damageEvidence = stringArray(parsed.damage_evidence);
  const draftSupportingFacts = stringArray(parsed.draft_supporting_facts);
  const counterArguments = Array.isArray(parsed.counter_arguments)
    ? parsed.counter_arguments
      .map((item) => item && typeof item === 'object' ? item as Record<string, unknown> : null)
      .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];

  return {
    ...parsed,
    denial_reasons: denialReasons,
    weak_points: weakPoints,
    medical_findings: medicalFindings,
    damage_evidence: damageEvidence,
    draft_supporting_facts: draftSupportingFacts,
    structuredData: {
      insurerPosition: typeof structured.insurerPosition === 'string'
        ? structured.insurerPosition
        : typeof parsed.summary === 'string' ? parsed.summary : '',
      denialReason: typeof structured.denialReason === 'string'
        ? structured.denialReason
        : denialReasons.join('\n'),
      keyIssues: stringArray(structured.keyIssues).length
        ? stringArray(structured.keyIssues)
        : [
          ...weakPoints,
          ...counterArguments
            .map((item) => typeof item.point === 'string' ? item.point : '')
            .filter(Boolean),
        ],
      accidentTypeGuess: typeof structured.accidentTypeGuess === 'string'
        ? structured.accidentTypeGuess
        : '',
      customerClaimSummary: typeof structured.customerClaimSummary === 'string'
        ? structured.customerClaimSummary
        : '',
      requiredAdditionalChecks: stringArray(structured.requiredAdditionalChecks).length
        ? stringArray(structured.requiredAdditionalChecks)
        : typeof parsed.recommended_action === 'string' ? [parsed.recommended_action] : [],
      customerMedicalSummary: typeof structured.customerMedicalSummary === 'string'
        ? structured.customerMedicalSummary
        : typeof parsed.customer_document_summary === 'string' ? parsed.customer_document_summary : '',
      diagnosisSummary: typeof structured.diagnosisSummary === 'string' ? structured.diagnosisSummary : '',
      testResultSummary: typeof structured.testResultSummary === 'string' ? structured.testResultSummary : '',
      treatmentSummary: typeof structured.treatmentSummary === 'string' ? structured.treatmentSummary : '',
      damageEvidenceSummary: typeof structured.damageEvidenceSummary === 'string'
        ? structured.damageEvidenceSummary
        : damageEvidence.join('\n'),
      draftSupportingFacts: stringArray(structured.draftSupportingFacts).length
        ? stringArray(structured.draftSupportingFacts)
        : draftSupportingFacts,
    },
  };
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

async function analyzeDocuments(denialDocuments: ImagePayload[], customerDocuments: ImagePayload[], apiKey: string) {
  const denialImages = normalizeImagePayloads(denialDocuments, '면책공문');
  const customerImages = normalizeImagePayloads(customerDocuments, '고객자료');

  if (!denialImages.length && !customerImages.length) {
    throw new HttpError(400, '분석할 이미지를 1장 이상 업로드해 주세요.');
  }

  const totalBytes = [...denialImages, ...customerImages].reduce((sum, image) => sum + image.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new HttpError(413, '전체 업로드 용량은 24MB 이하로 제한됩니다.');
  }

  const messages = [{
    role: 'user',
    content: buildImageContent(denialImages, customerImages),
  }];

  const text = await callOpenAI(apiKey, messages, 4096);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new HttpError(502, 'AI 응답을 분석할 수 없습니다. 다시 시도해 주세요.');
  }

  try {
    return normalizeAnalysisResult(JSON.parse(match[0]));
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

  const prompt = `당신은 보험 보상과 손해사정 실무에 밝은 전문가입니다.
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
      denialDocuments?: ImagePayload[];
      customerDocuments?: ImagePayload[];
      analysis?: Record<string, unknown>;
    };

    if (body.action === 'analyze') {
      if (body.denialDocuments || body.customerDocuments) {
        return jsonResponse(await analyzeDocuments(
          body.denialDocuments ?? [],
          body.customerDocuments ?? [],
          apiKey,
        ));
      }

      if (!body.base64) throw new HttpError(400, '이미지 데이터가 없습니다.');
      if (!body.mimeType) throw new HttpError(400, '이미지 형식 정보가 없습니다.');
      return jsonResponse(await analyzeDocuments(
        [{ base64: body.base64, mimeType: body.mimeType, name: 'insurance-document' }],
        [],
        apiKey,
      ));
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
