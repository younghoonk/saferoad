// Supabase Edge Function: create-closing-report
// OpenAI API key is read only from Edge Function environment variables.

import {
  buildRagQueryFromObject,
  formatRagForPrompt,
  searchRagReferences,
  type RagSearchResult,
} from '../_shared/ragSearch.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

type ReportType = 'interim' | 'final';
type FinalOpinion = 'pay' | 'deny' | 'partial' | 'investigate';

interface ImagePayload {
  base64?: string;
  mimeType?: string;
  name?: string;
}

interface ClosingReportInput {
  reportType?: ReportType;
  insurerName?: string;
  caseInfo?: Record<string, unknown>;
  uploadedDocumentAnalysis?: Record<string, unknown>;
  adjusterMemo?: string;
  finalOpinion?: FinalOpinion;
  hospitalDocuments?: ImagePayload[];
  insurerDocuments?: ImagePayload[];
  otherDocuments?: ImagePayload[];
}

interface ClosingReportResult {
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

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_IMAGES_PER_GROUP = 5;
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const INTERNAL_ID_PATTERN = /\b(?:RQ|RSF|RCP|RCD|MIC|PIP|RKA|PST|FSS|PREC|PREC_API|FSS_LATEST)[-_]?\d{3,6}\b/g;
const CHUNK_REFERENCE_PATTERN = /\b(?:medical_issue_code|real_case_pattern|real_case_document|issue_playbook|precedent|fss_latest|terms_raw|fss_dispute_case):[A-Za-z0-9:_-]+\b/g;
const INTERNAL_FIELD_LINE_PATTERN = /^\s*(?:chunk_id|source_id|record_id|source_record_id|source_document_id|embedding_status|review_status|trust_level|source_type)\s*[:=].*$/gim;
const INTERNAL_SOURCE_TYPE_PATTERN = /\binternal_[A-Za-z0-9_:-]*\b/g;

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
  if (!authHeader?.startsWith('Bearer ')) throw new HttpError(401, '로그인이 필요합니다.');

  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const anonKey = requiredEnv('SUPABASE_ANON_KEY');
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: authHeader },
  });
  if (!userRes.ok) throw new HttpError(401, '유효하지 않은 로그인 세션입니다.');
  const user = await userRes.json() as { id?: string };
  if (!user.id) throw new HttpError(401, '사용자 정보를 확인할 수 없습니다.');

  const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=id,user_type`, {
    headers: { apikey: anonKey, authorization: authHeader, accept: 'application/json' },
  });
  if (!profileRes.ok) throw new HttpError(403, '프로필 권한을 확인할 수 없습니다.');
  const profiles = await profileRes.json() as { user_type: string }[];
  if (profiles[0]?.user_type !== 'adjuster') {
    throw new HttpError(403, '손해사정사 계정만 종결보고서를 생성할 수 있습니다.');
  }
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanPublicText(value: unknown) {
  return cleanText(value)
    .replace(INTERNAL_FIELD_LINE_PATTERN, '')
    .replace(CHUNK_REFERENCE_PATTERN, '')
    .replace(INTERNAL_ID_PATTERN, '')
    .replace(INTERNAL_SOURCE_TYPE_PATTERN, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function estimateBase64Bytes(base64: string) {
  const normalized = base64.replace(/^data:[^;]+;base64,/, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

function normalizeImages(raw: unknown, label: string) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, `${label}는 배열이어야 합니다.`);
  if (raw.length > MAX_IMAGES_PER_GROUP) throw new HttpError(400, `${label}는 최대 ${MAX_IMAGES_PER_GROUP}장까지 업로드할 수 있습니다.`);

  return raw.map((item, index) => {
    const image = item as ImagePayload;
    if (!image?.base64) throw new HttpError(400, `${label} ${index + 1}번 이미지 데이터가 없습니다.`);
    if (!image.mimeType) throw new HttpError(400, `${label} ${index + 1}번 이미지 형식 정보가 없습니다.`);
    if (image.mimeType === 'application/pdf') throw new HttpError(415, 'PDF는 현재 지원하지 않습니다. 이미지를 업로드해 주세요.');
    if (!SUPPORTED_IMAGE_TYPES.includes(image.mimeType)) throw new HttpError(415, 'JPG, PNG, WEBP, GIF 이미지만 업로드할 수 있습니다.');
    const size = estimateBase64Bytes(image.base64);
    if (size > MAX_FILE_BYTES) throw new HttpError(413, `${label} ${index + 1}번 이미지가 8MB를 초과합니다.`);
    return {
      base64: image.base64.replace(/^data:[^;]+;base64,/, ''),
      mimeType: image.mimeType,
      name: cleanText(image.name) || `${label}-${index + 1}`,
      size,
    };
  });
}

function validateInput(body: ClosingReportInput) {
  const reportType = body.reportType ?? 'final';
  if (!['interim', 'final'].includes(reportType)) throw new HttpError(400, '보고서 유형이 올바르지 않습니다.');
  const finalOpinion = body.finalOpinion ?? 'investigate';
  if (!['pay', 'deny', 'partial', 'investigate'].includes(finalOpinion)) throw new HttpError(400, '최종 의견 값이 올바르지 않습니다.');

  const hospitalDocuments = normalizeImages(body.hospitalDocuments, '병원자료');
  const insurerDocuments = normalizeImages(body.insurerDocuments, '보험사자료');
  const otherDocuments = normalizeImages(body.otherDocuments, '기타자료');
  const totalBytes = [...hospitalDocuments, ...insurerDocuments, ...otherDocuments].reduce((sum, image) => sum + image.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new HttpError(413, '전체 업로드 용량은 24MB 이하로 제한됩니다.');

  return {
    reportType,
    insurerName: cleanText(body.insurerName),
    caseInfo: body.caseInfo && typeof body.caseInfo === 'object' ? body.caseInfo : {},
    uploadedDocumentAnalysis: body.uploadedDocumentAnalysis && typeof body.uploadedDocumentAnalysis === 'object'
      ? body.uploadedDocumentAnalysis
      : {},
    adjusterMemo: cleanText(body.adjusterMemo),
    finalOpinion,
    hospitalDocuments,
    insurerDocuments,
    otherDocuments,
  };
}

function imageContent(label: string, images: ReturnType<typeof normalizeImages>) {
  const items: unknown[] = [{ type: 'text', text: `[${label}] ${images.length}장` }];
  images.forEach((image, index) => {
    items.push({ type: 'text', text: `${label} ${index + 1}: ${image.name}` });
    items.push({
      type: 'image_url',
      image_url: {
        url: `data:${image.mimeType};base64,${image.base64}`,
        detail: 'high',
      },
    });
  });
  return items;
}

async function callOpenAI(apiKey: string, messages: unknown[], temperature: number, maxTokens = 4096) {
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
      temperature,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('OpenAI API error', res.status, errText);
    throw new HttpError(502, 'AI 종결보고서 생성 서버 호출에 실패했습니다.');
  }
  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? '';
}

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new HttpError(502, 'AI 응답을 분석할 수 없습니다.');
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    throw new HttpError(502, 'AI 응답 형식이 올바르지 않습니다.');
  }
}

async function analyzeUploadedFacts(apiKey: string, input: ReturnType<typeof validateInput>) {
  const prompt = `STEP 1. 업로드 자료에서 보험사 제출용 중간/종결보고서에 필요한 사실관계를 구조화하세요.

[원칙]
- 확인된 사실과 추정/검토 필요 사항을 구분하세요.
- 자료에 없는 병명, 검사결과, 날짜, 수치, 입원기간, 장해율을 지어내지 마세요.
- 고지의무/통지의무 관련 내용은 단정하지 말고 검토 필요로 표현하세요.
- 민감정보는 불필요하게 반복하지 마세요.

JSON으로만 응답하세요:
{
  "medicalSummary": "",
  "diagnosisSummary": "",
  "testResultSummary": "",
  "treatmentSummary": "",
  "hospitalizationSummary": "",
  "preExistingConditionFindings": "",
  "disclosureDutyIssues": "",
  "investigationSummary": "",
  "relatedHospitals": [],
  "timeline": [],
  "additionalCheckItems": []
}`;

  const content = [
    { type: 'text', text: prompt },
    ...imageContent('병원자료/의학자료', input.hospitalDocuments),
    ...imageContent('보험사자료/조사자료', input.insurerDocuments),
    ...imageContent('기타 손해자료', input.otherDocuments),
  ];
  const text = await callOpenAI(apiKey, [{ role: 'user', content }], 0.1);
  return extractJson<Record<string, unknown>>(text);
}

function buildReportPrompt(input: ReturnType<typeof validateInput>, facts: Record<string, unknown>, ragResult: RagSearchResult) {
  return `STEP 2. 아래 구조화된 사실관계와 사용자가 입력한 사건 정보를 바탕으로 보험사 제출용 ${input.reportType === 'final' ? '종결보고서' : '중간보고서'} 초안을 작성하세요.

[작성 품질 기준]
- DB손해보험 중간/종결보고서처럼 객관적인 조사보고서 문체로 작성하세요.
- "확인함", "특이소견 없음", "추가 확인 필요", "관련성 검토 필요" 같은 표현을 사용하세요.
- AI 사정서처럼 주장 중심으로 쓰지 말고 사실관계/조사내용/확인사항/처리과정 중심으로 작성하세요.
- 병원자료에서 확인된 사실과 AI 추론을 구분하세요.
- 자료에 없는 병명, 검사결과, 수치, 입원기간, 장해율을 지어내지 마세요.
- 고지의무/통지의무는 단정하지 말고 "검토 필요", "확인 필요", "관련성 여부 검토"로 표현하세요.
- 지급/부지급 결론은 최종 판단이 아니라 손해사정사 검토용 의견으로 작성하세요.
- 개인정보와 민감정보는 불필요하게 반복하지 마세요.
- 하단 disclaimer에 AI 초안이며 최종 제출 전 손해사정사 검토가 필요하다는 안내를 포함하세요.

[사용자 입력]
보험사명: ${input.insurerName || '미입력'}
보고서 유형: ${input.reportType}
최종 의견: ${input.finalOpinion}
사건 정보: ${JSON.stringify(input.caseInfo)}
기존 분석 요약: ${JSON.stringify(input.uploadedDocumentAnalysis)}
조사담당자 메모: ${input.adjusterMemo || '없음'}

[STEP 1 구조화 사실관계]
${JSON.stringify(facts)}

[RAG search references]
${formatRagForPrompt(ragResult)}

[RAG usage rules]
- Cite only official or semi-official RAG references as legal/reference basis.
- Do not cite internal review materials as official grounds. Use them only for issue spotting, checklist items, and additional review.
- Do not cite FSS title seeds without confirmed full text.
- Do not cite policy/terms references unless the title and summary are directly related to the issue.
- Cite precedents only when case number, court, and decision date are available.
- Do not expose internal ids, chunk ids, embedding status, review status, trust level, or internal source types.

아래 JSON 형식으로만 응답하세요:
{
  "title": "",
  "basicInfo": {
    "receivedDate": "",
    "assignedDate": "",
    "reportDate": "",
    "insurerName": "",
    "insuredName": "",
    "claimNumber": "",
    "investigator": "",
    "claimManager": ""
  },
  "contractInfo": "",
  "lossInfo": "",
  "claimAndInvestigationResult": "",
  "keyIssues": "",
  "investigationChecklist": "",
  "medicalFindings": "",
  "disclosureDutyReview": "",
  "otherInsuranceInfo": "",
  "interviewAndSpecialNotes": "",
  "investigationProcessTimeline": "",
  "finalOpinion": "",
  "requiredAdditionalChecks": [],
  "disclaimer": ""
}`;
}

function buildReviewPrompt(report: ClosingReportResult, ragResult: RagSearchResult) {
  return `STEP 3. 아래 종결보고서 초안을 검증하고 같은 JSON 구조로 보정하세요.

[검증 기준]
- 근거 없는 병명/검사결과/날짜/수치/입원기간/장해율을 제거하세요.
- 자료에 없는 단정 표현을 "추가 확인 필요" 또는 "관련성 검토 필요"로 바꾸세요.
- 고지의무/보험가입 전 병력 관련 단정 표현을 완화하세요.
- 추가 확인 필요 사항을 requiredAdditionalChecks로 분리하세요.
- disclaimer에 "AI가 생성한 초안이며 최종 제출 전 손해사정사의 검토가 필요합니다." 취지를 반드시 포함하세요.
- JSON 외 텍스트를 출력하지 마세요.

[초안]
[RAG search references]
${formatRagForPrompt(ragResult)}

[RAG review rules]
- Remove official-looking citations if they are not present in official or semi-official RAG references.
- Internal review materials must not be cited as official legal, precedent, FSS, or policy grounds.
- Policy/terms references must be removed if they are not directly related to the issue.
- Keep internal ids, chunk ids, embedding status, review status, trust level, and internal source types out of the final text.

${JSON.stringify(report)}`;
}

function validateResult(result: ClosingReportResult) {
  const required: (keyof ClosingReportResult)[] = [
    'title',
    'basicInfo',
    'contractInfo',
    'lossInfo',
    'claimAndInvestigationResult',
    'keyIssues',
    'investigationChecklist',
    'medicalFindings',
    'disclosureDutyReview',
    'otherInsuranceInfo',
    'interviewAndSpecialNotes',
    'investigationProcessTimeline',
    'finalOpinion',
    'requiredAdditionalChecks',
    'disclaimer',
  ];
  for (const key of required) {
    if (result[key] == null) throw new HttpError(502, `AI 응답에 ${key} 필드가 없습니다.`);
  }
  if (!Array.isArray(result.requiredAdditionalChecks)) result.requiredAdditionalChecks = [];
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
    requiredAdditionalChecks: result.requiredAdditionalChecks.map(cleanPublicText).filter(Boolean),
    disclaimer: cleanPublicText(result.disclaimer),
  };
}

function emptyRagResult(): RagSearchResult {
  return { query: '', officialReferences: [], internalReviewMaterials: [] };
}

async function getRagResult(apiKey: string, input: ReturnType<typeof validateInput>, facts: Record<string, unknown>) {
  try {
    return await searchRagReferences({
      supabaseUrl: requiredEnv('SUPABASE_URL'),
      serviceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      openAiKey: apiKey,
      query: buildRagQueryFromObject({
        insurerName: input.insurerName,
        reportType: input.reportType,
        finalOpinion: input.finalOpinion,
        caseInfo: input.caseInfo,
        uploadedDocumentAnalysis: input.uploadedDocumentAnalysis,
        adjusterMemo: input.adjusterMemo,
        extractedFacts: facts,
      }),
    });
  } catch (error) {
    console.warn('RAG search failed for closing report', error instanceof Error ? error.message : 'unknown error');
    return emptyRagResult();
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'POST 요청만 지원합니다.' }, 405);

  try {
    await requireAdjuster(req);
    const apiKey = requiredEnv('OPENAI_API_KEY');
    const input = validateInput(await req.json() as ClosingReportInput);

    const facts = await analyzeUploadedFacts(apiKey, input);
    const ragResult = await getRagResult(apiKey, input, facts);
    const draftText = await callOpenAI(apiKey, [{ role: 'user', content: buildReportPrompt(input, facts, ragResult) }], 0.2);
    const draft = validateResult(extractJson<ClosingReportResult>(draftText));
    const reviewedText = await callOpenAI(apiKey, [{ role: 'user', content: buildReviewPrompt(draft, ragResult) }], 0);
    const reviewed = validateResult(extractJson<ClosingReportResult>(reviewedText));

    return jsonResponse({ ...reviewed, retrievedReferences: ragResult });
  } catch (error: unknown) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    return jsonResponse({ error: message }, status);
  }
});
