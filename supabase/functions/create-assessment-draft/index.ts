// Supabase Edge Function: create-assessment-draft
// OpenAI API key is read only from Edge Function environment variables.

import {
  buildRagSearchQuery,
  formatRagForPrompt,
  inferIndemnityInsuranceGeneration,
  searchRagReferences,
  type RagSearchContext,
  type RagSearchResult,
} from '../_shared/ragSearch.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

type Tone = 'concise' | 'professional' | 'detailed';

interface RetrievedReference {
  source_area?: string;
  source_area_label?: string;
  source_type?: string;
  chunk_id?: string;
  source_id?: string;
  record_id?: string;
  source_record_id?: string;
  source_document_id?: string;
  title?: string;
  case_number?: string;
  court_or_agency?: string;
  decision_date?: string;
  law_name?: string;
  article_title?: string;
  diagnosis_code?: string;
  diagnosis_name?: string;
  accident_type?: string;
  issue?: string;
  summary?: string;
  chunk_text?: string;
  key_points?: string[];
  conclusion?: string;
  keywords?: string[];
  source_url?: string;
  embedding_status?: string;
  review_status?: string;
  trust_level?: string;
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
  insurerName?: string;
  productName?: string;
  policyName?: string;
  policyNumber?: string;
  insuranceType?: string;
  coverageType?: string;
  contractDate?: string;
  diagnosisText?: string;
  diagnosisName?: string;
  diagnosisCode?: string;
  policyGeneration?: string;
  policyVersion?: string;
  isLifeInsurance?: boolean;
  isNonLifeInsurance?: boolean;
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
  retrievedReferences?: RagSearchResult;
}

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o';
const MAX_FIELD_LENGTH = 1800;
const MAX_SHORT_FIELD_LENGTH = 200;
const MAX_REFERENCES = 8;
const MAX_REFERENCE_TEXT_LENGTH = 1200;

const INTERNAL_ID_PATTERN = /\b(?:RQ|RSF|RCP|RCD|MIC|PIP|RKA|PST|FSS|PREC|PREC_API|FSS_LATEST)[-_]?\d{3,6}\b/g;
const CHUNK_REFERENCE_PATTERN = /\b(?:medical_issue_code|real_case_pattern|real_case_document|issue_playbook|precedent|fss_latest|terms_raw|fss_dispute_case):[A-Za-z0-9:_-]+\b/g;
const INTERNAL_FIELD_LINE_PATTERN = /^\s*(?:chunk_id|source_id|record_id|source_record_id|source_document_id|embedding_status|review_status|trust_level|source_type)\s*[:=].*$/gim;
const INTERNAL_SOURCE_TYPE_PATTERN = /\binternal_[A-Za-z0-9_:-]*\b/g;

const sourceAreaLabels: Record<string, string> = {
  fss_dispute_cases: '금융감독원 분쟁조정례',
  legal_statutes: '법령',
  medical_knowledge: '의료 참고자료',
  precedents: '판례',
  terms_standards: '약관/지급기준',
  issue_playbooks: '내부 쟁점 플레이북',
  medical_issue_codes: '질병코드별 의료쟁점',
  real_case_patterns: '익명 사건 패턴',
  real_case_documents: '익명 문서 요약',
};

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

function clip(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function cleanStringArray(value: unknown, maxItems = 12) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanPublicText(item))
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => clip(item, MAX_SHORT_FIELD_LENGTH));
}

function publicSourceLabel(ref: RetrievedReference) {
  const sourceAreaLabel = cleanPublicText(ref.source_area_label);
  if (sourceAreaLabel) return clip(sourceAreaLabel, MAX_SHORT_FIELD_LENGTH);
  const sourceArea = cleanText(ref.source_area);
  if (sourceArea && sourceAreaLabels[sourceArea]) return sourceAreaLabels[sourceArea];
  const sourceType = cleanText(ref.source_type);
  if (sourceType.startsWith('internal_')) return '';
  return clip(cleanPublicText(sourceType), MAX_SHORT_FIELD_LENGTH);
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
      source_area_label: publicSourceLabel(ref),
      title: clip(cleanPublicText(ref.title) || `참고자료 ${index + 1}`, MAX_SHORT_FIELD_LENGTH),
      case_number: clip(cleanPublicText(ref.case_number), MAX_SHORT_FIELD_LENGTH),
      court_or_agency: clip(cleanPublicText(ref.court_or_agency), MAX_SHORT_FIELD_LENGTH),
      decision_date: clip(cleanPublicText(ref.decision_date), MAX_SHORT_FIELD_LENGTH),
      law_name: clip(cleanPublicText(ref.law_name), MAX_SHORT_FIELD_LENGTH),
      article_title: clip(cleanPublicText(ref.article_title), MAX_SHORT_FIELD_LENGTH),
      diagnosis_code: clip(cleanPublicText(ref.diagnosis_code), MAX_SHORT_FIELD_LENGTH),
      diagnosis_name: clip(cleanPublicText(ref.diagnosis_name), MAX_SHORT_FIELD_LENGTH),
      accident_type: clip(cleanPublicText(ref.accident_type), MAX_SHORT_FIELD_LENGTH),
      issue: clip(cleanPublicText(ref.issue), MAX_REFERENCE_TEXT_LENGTH),
      summary: clip(cleanPublicText(ref.summary || ref.chunk_text), MAX_REFERENCE_TEXT_LENGTH),
      key_points: cleanStringArray(ref.key_points),
      conclusion: clip(cleanPublicText(ref.conclusion), MAX_REFERENCE_TEXT_LENGTH),
      keywords: cleanStringArray(ref.keywords),
      source_url: clip(cleanPublicText(ref.source_url), 500),
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
    insurerName: cleanText(input.insurerName),
    productName: cleanText(input.productName),
    policyName: cleanText(input.policyName),
    policyNumber: cleanText(input.policyNumber),
    insuranceType: cleanText(input.insuranceType),
    coverageType: cleanText(input.coverageType),
    contractDate: cleanText(input.contractDate),
    diagnosisText: cleanText(input.diagnosisText),
    diagnosisName: cleanText(input.diagnosisName),
    diagnosisCode: cleanText(input.diagnosisCode),
    policyGeneration: cleanText(input.policyGeneration),
    policyVersion: cleanText(input.policyVersion),
    isLifeInsurance: Boolean(input.isLifeInsurance),
    isNonLifeInsurance: Boolean(input.isNonLifeInsurance),
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
    ['damageDetails', '피해 내용'],
    ['insurerPosition', '보험사 주장/면책 사유'],
    ['customerStatement', '고객 진술 요약'],
  ];

  for (const [key, label] of required) {
    if (!cleaned[key]) throw new HttpError(400, `${label}을 입력해 주세요.`);
  }

  const shortFields: (keyof typeof cleaned)[] = [
    'caseTitle',
    'insurerName',
    'productName',
    'policyName',
    'policyNumber',
    'insuranceType',
    'coverageType',
    'contractDate',
    'diagnosisText',
    'diagnosisName',
    'diagnosisCode',
    'policyGeneration',
    'policyVersion',
    'accidentType',
    'accidentDate',
  ];
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

function ragContextFromInput(input: ReturnType<typeof validateInput>): RagSearchContext {
  const generation = input.policyGeneration || inferIndemnityInsuranceGeneration(input.contractDate);
  return {
    insurerName: input.insurerName,
    productName: input.productName,
    policyName: input.policyName,
    policyNumber: input.policyNumber,
    insuranceType: input.insuranceType,
    coverageType: input.coverageType,
    contractDate: input.contractDate,
    policyGeneration: generation,
    policyVersion: input.policyVersion,
    isLifeInsurance: input.isLifeInsurance,
    isNonLifeInsurance: input.isNonLifeInsurance,
  };
}

function hasRagReferences(ragResult?: RagSearchResult) {
  return Boolean((ragResult?.officialReferences?.length || 0) + (ragResult?.internalReviewMaterials?.length || 0));
}

function formatReferences(references: RetrievedReference[], ragResult?: RagSearchResult) {
  if (references.length === 0) {
    if (hasRagReferences(ragResult)) {
      return '사용자가 별도로 제공한 수동 참고자료는 없음. 아래 RAG search references에 검색된 참고근거가 별도로 제공됨.';
    }
    return '제공된 판례, 결정례, 분쟁조정례, 약관, 참고자료 없음.';
  }

  return references.map((ref, index) => [
    `[${index + 1}] ${ref.title ?? '제목 없음'}`,
    ref.source_area_label ? `자료 구분: ${ref.source_area_label}` : '',
    ref.law_name ? `법령명: ${ref.law_name}` : '',
    ref.article_title ? `조문명: ${ref.article_title}` : '',
    ref.case_number ? `사건/결정 번호: ${ref.case_number}` : '',
    ref.court_or_agency ? `법원/기관: ${ref.court_or_agency}` : '',
    ref.decision_date ? `선고/결정일: ${ref.decision_date}` : '',
    ref.diagnosis_code ? `질병코드: ${ref.diagnosis_code}` : '',
    ref.diagnosis_name ? `진단명: ${ref.diagnosis_name}` : '',
    ref.accident_type ? `사고 유형: ${ref.accident_type}` : '',
    ref.issue ? `쟁점: ${ref.issue}` : '',
    ref.summary ? `요약: ${ref.summary}` : '',
    ref.key_points?.length ? `핵심 포인트: ${ref.key_points.join(' / ')}` : '',
    ref.conclusion ? `결론: ${ref.conclusion}` : '',
    ref.keywords?.length ? `키워드: ${ref.keywords.join(', ')}` : '',
    ref.source_url ? `출처 URL: ${ref.source_url}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}

function referenceDisplayName(ref: RagSearchResult['officialReferences'][number]) {
  const area = ref.source_area;
  const title = cleanPublicText(ref.title);
  const lawName = cleanPublicText(ref.law_name);
  const articleTitle = cleanPublicText(ref.article_title);
  const caseNumber = cleanPublicText(ref.case_number);
  const court = cleanPublicText(ref.court_or_agency);
  const decisionDate = cleanPublicText(ref.decision_date);

  if (area === 'legal_statutes') {
    return [lawName, articleTitle].filter(Boolean).join(' ') || title;
  }
  if (area === 'precedents') {
    if (caseNumber && court && decisionDate) return `${court} ${decisionDate} 선고 ${caseNumber} 판결`;
    return title ? `${title}(사건번호/법원/선고일자 추가 확인 필요)` : '관련 판례 추가 확인 필요';
  }
  if (area === 'fss_dispute_cases') {
    return caseNumber ? `금융감독원 분쟁조정례 ${caseNumber}` : `금융감독원 분쟁조정례 ${title || '사례'}`;
  }
  if (area === 'terms_standards') {
    return title ? `${title}` : '가입 당시 원약관 또는 표준약관';
  }
  return title;
}

function formatOfficialGroundsForBody(ragResult: RagSearchResult) {
  const official = ragResult.officialReferences || [];
  if (!official.length) return '직접 관련 공식 근거 부족. 관련 법령, 판례, 분쟁조정례, 원약관 추가 확인 필요.';
  return official.map((ref, index) => {
    const name = referenceDisplayName(ref);
    const summary = cleanPublicText(ref.summary);
    return `[근거 ${index + 1}] ${name}${summary ? `: ${summary}` : ''}`;
  }).join('\n');
}

function buildDraftPrompt(input: ReturnType<typeof validateInput>, ragResult: RagSearchResult) {
  const source = input.sourceAnalysis;
  const profile = caseProfile(input);
  const profileRules = profile === 'indemnity_manual_therapy_denial' ? `
[Indemnity manual therapy denial argument]
- This is not a disclosure-duty or contract-termination case. Do not use pre-contract disclosure duty, policy termination, underwriting, application-form question, decline, exclusion, loading, or non-disclosure reasoning unless explicitly entered.
- For manual therapy denial under indemnity medical insurance, focus on treatment purpose, medical necessity, doctor's prescription, treatment plan, treatment course, appropriateness of repeated therapy, detailed medical bill items, and policy exclusions.
- Manual therapy is not automatically payable or automatically excessive. The insurer should present concrete reasons based on medical records, treatment count, and lack of medical necessity instead of relying only on the item name.
- The customer-side argument should request reconsideration based on medical necessity and treatment purpose, supported by medical records, physician opinion, treatment plan, symptom-change records, pain assessment records, detailed medical bill, receipt, non-covered treatment details, original indemnity policy terms, and insurer denial letter.
- If the contract date suggests fourth-generation indemnity insurance, state this is only a search aid and final judgment requires the original policy terms at enrollment.
- The conclusion should be: the insurer's denial decision requires reconsideration based on treatment purpose and medical necessity materials. Do not state payment is certain.
` : profile === 'm47_disclosure' ? `
[M47.26 customer-side argument when applicable]
- For M47.26 one-time outpatient non-disclosure, the customer-side position is that the medical record exists, but the record alone does not prove the legal requirements for termination.
- Explain that Commercial Act Article 651 requires materiality and intentional or grossly negligent non-disclosure.
- If the facts are one simple back-pain outpatient visit with no admission, surgery, advanced imaging, repeated treatment, or long-term medication, state that materiality and gross negligence can be disputed.
- Distinguish hospital coding of M47.26 from the insured's awareness of the code's medical meaning or underwriting importance.
- State that the insurer should present objective underwriting standards showing decline, exclusion, loading, or conditional acceptance if the visit had been disclosed.
- For claim denial after termination, state that causal relationship between the non-disclosed fact and the insured event must be separately reviewed under Commercial Act Article 655 and related precedent principles.
- The conclusion should be: the customer's position has meaningful review value, and the insurer's termination/denial decision requires reconsideration. Do not state payment is certain.
` : profile === 'thyroid_disclosure_cancer' ? `
[Thyroid nodule / thyroid cancer disclosure-duty argument]
- Do not mention M47.26, back pain, orthopedic visit, one outpatient visit, or spine-related facts unless they are explicitly in the input.
- For thyroid nodule non-disclosure followed by thyroid cancer diagnosis, distinguish the existence of a thyroid nodule finding from satisfaction of contract termination requirements.
- Analyze materiality and intentional or grossly negligent non-disclosure under Commercial Act Article 651.
- If the facts show only health-checkup nodule or follow-up recommendation without treatment, medication, surgery, admission, cancer-suspicion explanation, FNA recommendation, or biopsy recommendation, explain that the customer's awareness of an important disease may be disputable.
- Reflect the Supreme Court 2011.4.14. 2009다103349, 103356 precedent only as a confirmed retrieved/reference ground, and use it for thyroid nodule materiality and disease-awareness reasoning.
- State unfavorable points separately if ultrasound showed malignancy suspicion, FNA/biopsy was recommended, benign neoplasm was diagnosed, or repeated follow-up was ordered.
- For cancer diagnosis benefit denial, separately review causal relationship between the non-disclosed thyroid nodule and later thyroid cancer diagnosis under Commercial Act Article 655.
- Use cancer insurance policy terms only when directly related to cancer diagnosis benefit, thyroid cancer, diagnosis confirmation, similar cancer, low-amount cancer, or carcinoma in situ. Do not use indemnity medical insurance terms as official grounds for cancer insurance.
` : `
[General disclosure-duty argument]
- For pre-contract disclosure duty disputes, analyze materiality, intentional or grossly negligent non-disclosure, written questions, objective underwriting standards, and causal relationship without importing disease-specific facts that are not in the input.
`;
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
보험회사: ${input.insurerName || '미입력'}
보험종류: ${input.insuranceType || '미입력'}
보험가입일: ${input.contractDate || 'unknown'}
사고 유형: ${input.accidentType}
사고 일자: ${input.accidentDate}
질병명/질병코드: ${input.diagnosisText || [input.diagnosisCode, input.diagnosisName].filter(Boolean).join(' ') || source?.diagnosisSummary || '없음'}
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
${formatReferences(input.retrievedReferences, ragResult)}

[RAG search references]
${formatRagForPrompt(ragResult)}

[Official grounds that must be woven into the body]
${formatOfficialGroundsForBody(ragResult)}

[RAG usage rules]
- Cite only official or semi-official RAG references as legal/reference basis.
- Do not cite internal review materials as official grounds. Use them only for issue spotting, checklist items, and additional review.
- Do not cite FSS title seeds without confirmed full text.
- Do not cite policy/terms references unless the title and summary are directly related to the issue.
- For disclosure-duty disputes, cite only directly related law, FSS cases, precedents, or policy terms. Exclude cataract admission, motorcycle notice duty, automobile damages, deposit protection, proportional indemnity, suspension/restart, index, or table-of-contents materials unless the input issue directly concerns them.
- If directly related policy terms are not available, state that the original policy terms at enrollment must be checked instead of forcing unrelated terms.
- When RAG references exist, never use wording equivalent to "provided reference materials are absent."
- Policy terms, disease classification tables, and disability classification/payment tables must be applied based on the insurance contract date and original policy terms.
- Do not automatically apply the newest policy terms to older contracts.
- If the original company/product policy is missing, use standard policy terms or similar materials only as reference materials.
- Indemnity insurance generation is a search aid only; final judgment requires the insurance policy and policy terms in effect at enrollment.
- For disability and disease-code issues, state that the policy appendix in effect at enrollment must be checked.
- Cite precedents only when case number, court, and decision date are available.
- Do not expose internal ids, chunk ids, embedding status, review status, trust level, or internal source types.

[Customer-side reconsideration direction]
- The purpose of this draft is to support the customer's request for reconsideration of the insurer's denial, exemption, or contract termination decision.
- Write from the customer's side, while preserving objectivity and not hiding unfavorable points.
- The main thesis should be: "보험회사의 부지급/면책/계약해지 처분은 재검토가 필요하다."
- Use expressions such as "다툴 여지가 있다", "객관적 근거 제시가 필요하다", "추가자료 확인을 전제로 고객 측 주장이 상당한 검토 가치가 있다."
- Do not use prohibited expressions: "보험금 지급 확정", "반드시 받을 수 있음", "보험사의 처분은 무조건 위법", "승소 가능성".
- Structure the reasoning as: 1) 사건 개요, 2) 인정되는 사실, 3) 보험사 주장, 4) 고객 측 주장, 5) 주요 쟁점, 6) 고객 측에 유리한 사정, 7) 관련 근거 검토, 8) 현 사건에의 적용, 9) 보험사 주장에 대한 반박 의견, 10) 손해사정 의견 초안, 11) 불리한 점 및 보완 필요 사항, 12) 추가 확보 필요 자료, 13) 고객 안내용 쉬운 요약.
- First organize the insurer's position, then emphasize customer-favorable facts, then analyze weaknesses in the insurer's position, then connect official grounds to the customer's reconsideration logic.
- Unfavorable facts must be placed in "불리한 점 및 보완 필요 사항" and matched with concrete documents to supplement them.

[Draft reasoning structure rules]
- This is not a search-result summary. Write a practical loss-adjusting opinion draft that applies the searched grounds to the current case facts.
- Use this reasoning order in the body: 1) 인정되는 사실, 2) 보험사 주장, 3) 고객 주장, 4) 쟁점 정리, 5) 관련 법령/약관/분쟁조정례/판례 검토, 6) 현 사건에의 적용, 7) 손해사정 의견, 8) 불리한 점 및 추가 확인 필요 사항, 9) 고객 안내용 요약.
- Do not leave the opinion at "additional review is needed" only. Even when final judgment is difficult, write the provisional loss-adjusting opinion available from the provided facts.
- Explain why each directly related official RAG ground is favorable or unfavorable to this case. Do not merely list references.
- In legalAndReferenceBasis, damageAssessment, and adjusterOpinionDraft, write the actual ground names from "Official grounds that must be woven into the body" in sentences.
- If a precedent lacks case number, court, or decision date in retrievedReferences, do not invent them. Write "관련 판례 추가 확인 필요" instead.
- If a policy term lacks the original company/product policy or enrollment-date version, write that the original policy terms at enrollment must be checked and use standard terms only as reference material.
- Use internal review materials only for issue framing and document checklist. Never cite them as official legal, precedent, FSS, or policy grounds.
- If official grounds are insufficient, say "직접 관련 공식 근거 부족" and still analyze the current facts under the available legal framework.
- The adjusterOpinionDraft field must contain at least 5 substantial paragraphs. Prefer 5 to 8 paragraphs for ordinary cases.
- The requiredAdditionalChecks field must include both unfavorable points and concrete documents to request.

${profileRules}

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

function buildReviewPrompt(draft: AssessmentDraftResult, references: RetrievedReference[], ragResult: RagSearchResult, input: ReturnType<typeof validateInput>) {
  const profile = caseProfile(input);
  const profileReviewRules = profile === 'indemnity_manual_therapy_denial'
    ? '- For a manual therapy indemnity denial case, remove disclosure-duty, contract termination, underwriting, application-form question, decline, exclusion, loading, M47.26 non-disclosure, automobile damage, disability, cancer, cataract, and hospitalization-pattern reasoning. Keep the reasoning focused on treatment purpose, medical necessity, doctor prescription, treatment plan, repeated therapy appropriateness, policy exclusions, and original indemnity policy terms.'
    : profile === 'm47_disclosure'
    ? '- For an M47.26 single outpatient non-disclosure case, keep the logic that one outpatient record and a diagnosis-code entry alone do not automatically establish materiality or intentional/grossly negligent non-disclosure.'
    : profile === 'thyroid_disclosure_cancer'
      ? '- For a thyroid nodule / thyroid cancer disclosure case, remove M47.26, back pain, orthopedic, one-outpatient, and spine-specific reasoning. Keep the reasoning focused on thyroid nodule, health checkup, ultrasound, FNA/biopsy recommendation, cancer diagnosis benefit, objective underwriting standards, and thyroid cancer causal relationship.'
      : '- Do not import disease-specific reasoning that is not supported by the input facts.';
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
${formatReferences(references, ragResult)}

[RAG search references]
${formatRagForPrompt(ragResult)}

[Official grounds that must remain in the body]
${formatOfficialGroundsForBody(ragResult)}

[RAG review rules]
- Remove official-looking citations if they are not present in official or semi-official RAG references.
- Internal review materials must not be cited as official legal, precedent, FSS, or policy grounds.
- Policy/terms references must be removed if they are not directly related to the issue.
- Preserve diagnosis codes exactly as provided. If a generated title or body changed an input diagnosis code, restore the input diagnosis code.
- Remove accident date, accident location, accident mechanism, treatment date, or insurer facts that were not in the input, uploaded summaries, or RAG references.
- If RAG search references exist, remove any statement saying reference materials were not provided.
- In pre-contract disclosure duty cases, keep Commercial Act Articles 651, 651-2, and 655 as the priority statutory grounds. Remove Articles 652 and 653 unless the case is about post-contract notice duty or risk change.
- Remove unrelated precedent or policy references such as cataract admission, motorcycle notice duty, automobile damages, deposit protection, proportional indemnity, suspension/restart, index, or table-of-contents materials unless the input issue directly concerns them.
- If no directly related original policy terms are available, say that original policy terms at enrollment require confirmation.
- Remove or qualify any statement that applies a later policy version, disease classification table, or disability table to an older contract without confirming the original policy.
- Keep internal ids, chunk ids, embedding status, review status, trust level, and internal source types out of the final text.
- Ensure the final draft reads like a loss-adjusting opinion, not a reference search summary.
- The adjusterOpinionDraft field must contain at least 5 substantial paragraphs and must explain the insurer's position, counterpoints, application of official grounds, unfavorable points, and a restrained provisional opinion.
- Do not end the opinion with only "additional review needed." If facts are insufficient, still state what can be argued from current facts and what must be confirmed.
- The legalAndReferenceBasis and damageAssessment fields must explain how directly related official RAG grounds apply to this case.
- The legalAndReferenceBasis, damageAssessment, and adjusterOpinionDraft fields must contain actual official ground names from "Official grounds that must remain in the body" when official RAG grounds exist.
- Do not invent precedent numbers, adjustment numbers, policy article numbers, court names, or decision dates. If metadata is missing, write "관련 판례 추가 확인 필요" or "가입 당시 원약관 확인 필요."
- The requiredAdditionalChecks field must separately include unfavorable points and concrete documents to request.
${profileReviewRules}
- Keep the final stance customer-side: the insurer's denial/exemption/termination decision requires reconsideration.
- Do not convert the draft into a neutral memo. It must be a customer-side reconsideration request draft with balanced unfavorable-point disclosure.
- Remove prohibited expressions if present: "보험금 지급 확정", "반드시 받을 수 있음", "보험사의 처분은 무조건 위법", "승소 가능성".
- Make the insurer rebuttal explicit. The insurerPositionReview and adjusterOpinionDraft fields must identify weaknesses in the insurer's reasoning and the documents the insurer should objectively present.

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
      max_tokens: 6000,
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
    const requiredKeys = [
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
    ] as const;

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

function sanitizeResult(result: AssessmentDraftResult): AssessmentDraftResult {
  return {
    title: cleanPublicText(result.title),
    overview: cleanPublicText(result.overview),
    facts: cleanPublicText(result.facts),
    issues: cleanPublicText(result.issues),
    legalAndReferenceBasis: cleanPublicText(result.legalAndReferenceBasis),
    damageAssessment: cleanPublicText(result.damageAssessment),
    insurerPositionReview: cleanPublicText(result.insurerPositionReview),
    adjusterOpinionDraft: cleanPublicText(result.adjusterOpinionDraft),
    requiredAdditionalChecks: cleanPublicText(result.requiredAdditionalChecks),
    simpleClientSummary: cleanPublicText(result.simpleClientSummary),
    disclaimer: cleanPublicText(result.disclaimer),
  };
}

function extractDiagnosisCodesFromText(value: unknown) {
  return Array.from(new Set(String(value || '').match(/\b[A-Z]\d{2}(?:\.\d{1,3})?\b/gi) || []))
    .map((code) => code.toUpperCase());
}

function preserveInputDiagnosisCodes(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  const inputCodes = extractDiagnosisCodesFromText(JSON.stringify({
    caseTitle: input.caseTitle,
    diagnosisText: input.diagnosisText,
    diagnosisName: input.diagnosisName,
    diagnosisCode: input.diagnosisCode,
    damageDetails: input.damageDetails,
    insurerPosition: input.insurerPosition,
    customerStatement: input.customerStatement,
    adjusterMemo: input.adjusterMemo,
    sourceAnalysis: input.sourceAnalysis,
  }));
  if (!inputCodes.length) return result;

  const preserve = (value: string) => {
    let text = value;
    for (const code of inputCodes) {
      const group = code.split('.')[0];
      const [letter, numeric, decimal] = code.match(/^([A-Z])(\d{2})\.(\d{1,3})$/i)?.slice(1) || [];
      text = text.replace(new RegExp(`\\b${group}\\.\\d{1,3}\\b`, 'gi'), code);
      if (letter && numeric && decimal) {
        text = text.replace(new RegExp(`\\b${letter}\\d{2}\\.${decimal}\\b`, 'gi'), code);
        text = text.replace(new RegExp(`\\b${letter}${numeric}\\.\\d{1,3}\\b`, 'gi'), code);
      } else {
        const simple = code.match(/^([A-Z])(\d{2})$/i)?.slice(1);
        if (simple) {
          text = text.replace(new RegExp(`\\b${simple[0]}\\d{2}\\b`, 'gi'), code);
        }
      }
    }
    return text;
  };

  return {
    ...result,
    title: preserve(result.title),
    overview: preserve(result.overview),
    facts: preserve(result.facts),
    issues: preserve(result.issues),
    legalAndReferenceBasis: preserve(result.legalAndReferenceBasis),
    damageAssessment: preserve(result.damageAssessment),
    insurerPositionReview: preserve(result.insurerPositionReview),
    adjusterOpinionDraft: preserve(result.adjusterOpinionDraft),
    requiredAdditionalChecks: preserve(result.requiredAdditionalChecks),
    simpleClientSummary: preserve(result.simpleClientSummary),
    disclaimer: preserve(result.disclaimer),
  };
}

function removeReferenceAbsenceContradiction(result: AssessmentDraftResult, ragResult: RagSearchResult): AssessmentDraftResult {
  if (!hasRagReferences(ragResult)) return result;
  const fix = (value: string) => value
    .replace(/제공된\s*참고자료가\s*없으므로/g, '직접 관련 공식근거는 제한적이므로')
    .replace(/제공된\s*참고\s*자료가\s*없으므로/g, '직접 관련 공식근거는 제한적이므로')
    .replace(/참고자료가\s*없으므로/g, '직접 관련 공식근거는 제한적이므로')
    .replace(/검색된\s*RAG\s*참고근거\s*없음/g, '검색된 RAG 참고근거는 아래 별도 표시')
    .replace(/제공된\s*판례,\s*결정례,\s*분쟁조정례,\s*약관,\s*참고자료\s*없음\.?/g, '수동 참고자료는 없으며, RAG 검색 참고근거는 아래 별도 표시');

  return {
    ...result,
    title: fix(result.title),
    overview: fix(result.overview),
    facts: fix(result.facts),
    issues: fix(result.issues),
    legalAndReferenceBasis: fix(result.legalAndReferenceBasis),
    damageAssessment: fix(result.damageAssessment),
    insurerPositionReview: fix(result.insurerPositionReview),
    adjusterOpinionDraft: fix(result.adjusterOpinionDraft),
    requiredAdditionalChecks: fix(result.requiredAdditionalChecks),
    simpleClientSummary: fix(result.simpleClientSummary),
    disclaimer: fix(result.disclaimer),
  };
}

function paragraphCount(value: string) {
  return value.split(/\n{2,}|(?<=다\.)\s+(?=[가-힣A-Z])/).map((item) => item.trim()).filter(Boolean).length;
}

function isDisclosureDutyCase(input: ReturnType<typeof validateInput>) {
  const text = [
    input.caseTitle,
    input.diagnosisText,
    input.diagnosisName,
    input.diagnosisCode,
    input.damageDetails,
    input.insurerPosition,
    input.customerStatement,
    input.adjusterMemo,
    input.sourceAnalysis?.diagnosisSummary,
    input.sourceAnalysis?.summary,
    input.sourceAnalysis?.denialReason,
    ...(input.sourceAnalysis?.keyIssues || []),
  ].filter(Boolean).join(' ');
  return /M47\.26|고지의무|알릴의무|미고지|계약해지|중요한 사항|중대한 과실/i.test(text);
}

type AssessmentCaseProfile = 'm47_disclosure' | 'thyroid_disclosure_cancer' | 'indemnity_manual_therapy_denial' | 'general_disclosure' | 'general';

function caseProfile(input: ReturnType<typeof validateInput>): AssessmentCaseProfile {
  const diagnosisText = [
    input.diagnosisText,
    input.diagnosisCode,
    input.diagnosisName,
    input.sourceAnalysis?.diagnosisSummary,
  ].filter(Boolean).join(' ');
  const allText = [
    diagnosisText,
    input.caseTitle,
    input.insuranceType,
    input.coverageType,
    input.damageDetails,
    input.insurerPosition,
    input.customerStatement,
    input.adjusterMemo,
    input.sourceAnalysis?.summary,
    input.sourceAnalysis?.denialReason,
    ...(input.sourceAnalysis?.keyIssues || []),
  ].filter(Boolean).join(' ');
  const disclosure = isDisclosureDutyCase(input);
  if (/도수치료|manual\s*therapy|비급여\s*치료|치료\s*목적|치료목적|과잉진료|의학적\s*필요성|반복치료|진료비\s*세부내역|치료계획/i.test(allText)
    || (/실손|실손보험|실손의료/i.test(allText) && /M54|요통|허리통증|도수|비급여|치료/i.test(allText))) {
    return 'indemnity_manual_therapy_denial';
  }
  if (disclosure && /M47\.26|요추증|신경뿌리병증|허리통증|요통/i.test(diagnosisText)) return 'm47_disclosure';
  if (/C73|갑상선암|갑상선\s*결절|thyroid|E04|D34/i.test(allText)) return 'thyroid_disclosure_cancer';
  if (disclosure) return 'general_disclosure';
  return 'general';
}

function ensureSubstantialOpinion(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>) {
  if (paragraphCount(result.adjusterOpinionDraft) >= 5 || !isDisclosureDutyCase(input)) return result;
  const profile = caseProfile(input);
  const supplemental = profile === 'm47_disclosure' ? [
    '진료기록 또는 병원 전산상 질병코드가 존재한다는 사정은 우선 사실관계로 인정할 수 있다. 다만 그 사실만으로 곧바로 계약전 알릴의무 위반에 따른 계약해지 요건이 충족된다고 볼 수는 없으며, 해당 진료가 청약서 질문사항상 중요한 사항에 해당하는지와 피보험자에게 고의 또는 중대한 과실이 있었는지를 별도로 검토해야 한다.',
    '현재 입력된 사실관계가 단순 허리 불편감 또는 1회 통원에 그치고, 입원, 수술, 정밀검사, 장기투약, 반복치료가 확인되지 않는 구조라면 중요사항성 및 고의ㆍ중대한 과실은 다툴 여지가 있다. 특히 M47.26이라는 질병코드가 병원 전산에 기재되었다는 점과 피보험자가 이를 보험계약상 중요한 질환 또는 인수심사에 중대한 사항으로 인식했다는 점은 구분하여 보아야 한다.',
    '보험회사가 계약해지를 유지하려면 해당 진료이력을 알았을 경우 인수거절, 부담보, 할증 또는 조건부 인수 등으로 처리했을 객관적 인수기준을 제시할 필요가 있다. 단순히 진료기록이 존재한다는 사정만으로 중요한 사항성과 고의ㆍ중과실을 모두 추정하는 방식은 재검토가 필요하다.',
    '보험금 부지급까지 문제되는 경우에는 고지의무 위반 여부와 별도로, 미고지 사실과 보험사고 또는 청구 손해 사이의 인과관계도 검토되어야 한다. 따라서 계약해지와 보험금 부지급은 같은 사실관계에서 출발하더라도 각각의 법적 요건과 입증관계를 분리하여 판단해야 한다.',
    '위 사정들을 종합하면, 현 단계의 손해사정 의견은 계약해지 취소를 단정하기보다 계약해지 처분의 요건 충족 여부에 대한 재검토가 필요하다는 방향으로 정리하는 것이 타당하다. 추가로 청약서 질문사항, 초진기록, 처방전, 검사내역, 의사소견서, 보험회사의 인수기준을 확인하여 중요사항성, 고의ㆍ중대한 과실, 인과관계를 순차적으로 검토할 필요가 있다.',
  ] : profile === 'thyroid_disclosure_cancer' ? [
    '보험가입 전 갑상선 결절 소견이 있었다는 사실 자체와 계약전 알릴의무 위반으로 인한 계약해지 요건 충족 여부는 구분되어야 한다. 보험회사가 계약해지 또는 암진단비 부지급을 주장하려면 해당 결절 소견이 청약 당시 중요한 사항에 해당하고, 고객에게 고의 또는 중대한 과실이 있었다는 점을 구체적으로 검토해야 한다.',
    '건강검진상 단순 결절 또는 추적관찰 권유에 그쳤고, 암 의심 설명, 미세침흡인검사 또는 조직검사 권유, 치료ㆍ투약ㆍ수술ㆍ입원 등이 없었다면 고객이 이를 보험계약상 중요한 병력으로 인식하기 어려웠을 가능성이 있다.',
    '반대로 초음파상 악성 의심 소견, 미세침흡인검사 권유, 조직검사 권유, 양성신생물 진단, 반복 추적검사 지시가 확인된다면 보험회사 주장이 강화될 수 있으므로 해당 자료를 별도로 확인해야 한다.',
    '보험회사는 해당 갑상선 결절 소견을 알았다면 인수거절, 부담보, 할증 등 조건으로 인수했을 객관적 인수기준을 제시할 필요가 있다. 암진단비 부지급은 고지의무 위반 여부와 별도로 갑상선암 진단과의 인과관계도 함께 검토해야 한다.',
  ] : profile === 'indemnity_manual_therapy_denial' ? [
    '도수치료 실손보험 부지급 사건에서는 도수치료라는 항목명만으로 보험금 지급 또는 부지급이 곧바로 확정되는 것은 아니다. 보험금 지급 여부는 치료 목적성, 의학적 필요성, 의사 처방 및 치료계획, 치료 경과, 반복치료의 적정성, 가입 당시 실손보험 약관상 보상 제외 조항을 중심으로 검토해야 한다.',
    '보험회사가 의학적 필요성 부족 또는 과잉진료를 주장하는 경우에도 단순히 비급여 도수치료라는 사정만으로는 부족하다. 보험회사는 구체적인 진료기록, 치료횟수, 치료기간, 증상 경과, 의학적 필요성 부족 사유, 약관상 보상 제외 근거를 제시할 필요가 있다.',
    '고객 측은 진료기록지, 도수치료 처방 또는 치료계획, 의사 소견서, 치료 전후 증상 변화 기록, 통증평가 기록, 진료비 세부내역서, 영수증, 비급여 진료내역을 통해 치료 목적성과 필요성을 보완해야 한다.',
  ] : [
    '계약전 알릴의무 위반 사건에서는 진료 또는 검사 이력의 존재와 계약해지 요건 충족 여부를 구분해야 한다. 청약서 질문사항 해당성, 중요한 사항성, 고의 또는 중대한 과실, 보험사고와의 인과관계를 순차적으로 검토해야 한다.',
  ];
  const supplementalText = supplemental.join('\n\n');
  return {
    ...result,
    adjusterOpinionDraft: [result.adjusterOpinionDraft, supplementalText].filter(Boolean).join('\n\n'),
  };
}

function ensureOfficialGroundsInBody(result: AssessmentDraftResult, ragResult: RagSearchResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  const official = ragResult.officialReferences || [];
  if (!official.length) return result;
  const profile = caseProfile(input);
  const grounds = official.map(referenceDisplayName).filter(Boolean);
  if (!grounds.length) return result;
  const existingText = [
    result.legalAndReferenceBasis,
    result.damageAssessment,
    result.adjusterOpinionDraft,
  ].join('\n');
  const groundsForSection = grounds.filter((ground) => /상법.*제\s*651|상법.*제\s*655|제\s*651\s*조|제\s*655\s*조|651조|655조/.test(ground) || !existingText.includes(ground));
  if (!groundsForSection.length) return result;

  const legalLines = groundsForSection.map((ground) => {
    if (/상법.*제\s*651\s*조의\s*2|제\s*651\s*조의\s*2|651조의2|651-2/.test(ground)) {
      if (profile === 'thyroid_disclosure_cancer') {
        return `${ground}는 보험자가 서면으로 질문한 사항을 중요한 사항으로 추정하지만, 건강검진상 갑상선 결절 소견이 청약서 질문사항에 어떻게 해당하는지는 원문 확인이 필요하다는 점에서 의미가 있다.`;
      }
      return `${ground}는 보험자가 서면으로 질문한 사항을 중요한 사항으로 추정한다는 점에서 의미가 있다. 다만 본 건에서는 1회성 통원 사실이 청약서 질문사항에 명확히 포함되는지와 피보험자의 인식 가능성을 별도로 확인해야 한다.`;
    }
    if (/상법.*제\s*651\s*조|제\s*651\s*조|651조/.test(ground)) {
      return `${ground}는 계약전 알릴의무 위반으로 계약해지가 가능하려면 중요한 사항에 대한 고의 또는 중대한 과실이 필요하다는 점에서 본 건의 핵심 기준이 된다.`;
    }
    if (/상법.*제\s*655\s*조|제\s*655\s*조|655조/.test(ground)) {
      return profile === 'thyroid_disclosure_cancer'
        ? `${ground}는 고지의무 위반 사실과 갑상선암 진단 사이의 인과관계를 별도로 검토해야 한다는 점에서 의미가 있다.`
        : `${ground}는 계약해지 후 보험금 부지급이 문제될 때 고지의무 위반 사실과 보험사고 발생 사이의 인과관계를 별도로 검토해야 한다는 점에서 의미가 있다.`;
    }
    if (/2009다103349|2009다103356/.test(ground)) {
      return `${ground}은 갑상선 결절 관련 고지의무 판단에서 피보험자의 질병 인식 가능성 및 중요한 사항성 판단을 신중히 보아야 한다는 점에서 본 건의 핵심 참고 판례가 된다.`;
    }
    if (/2023다274056/.test(ground)) {
      return `${ground}은 갑상선암 관련 약관상 분류기준 및 설명의무 검토 시 참고할 수 있는 보조 판례이다. 다만 본 건의 주된 고지의무 판단 근거는 아니므로 약관 설명의무와 암 분류기준 쟁점에 한정하여 검토한다.`;
    }
    if (/판결|판례/.test(ground)) {
      return `${ground}은(는) retrievedReferences에 확인된 범위에서만 검토 근거로 삼고, 사건번호ㆍ법원ㆍ선고일자 등 메타데이터가 부족한 경우 관련 판례 추가 확인이 필요하다.`;
    }
    if (/금융감독원|분쟁조정례/.test(ground)) {
      if (profile === 'thyroid_disclosure_cancer') {
        return `${ground}은 갑상선 결절, 건강검진, 추적관찰 또는 정밀검사 권유가 고지의무 판단에 어떤 의미를 갖는지 검토할 때 참고할 수 있다. 다만 구체적 결론은 원문 사실관계와 본 건의 검사ㆍ설명ㆍ추적관찰 경과가 유사한지 확인해야 한다.`;
      }
      return `${ground}은(는) 고지의무 또는 계약해지 쟁점의 분쟁 처리 방향을 검토할 때 참고할 수 있으나, 본 건의 진료 횟수와 치료 정도가 실제로 유사한지는 원문 확인이 필요하다.`;
    }
    if (/약관|실손|표준/.test(ground)) {
      return `${ground}은(는) 약관 검토자료이나, 가입 당시 해당 보험회사ㆍ상품의 원약관 확인 전에는 표준약관 또는 유사자료로만 참고해야 한다.`;
    }
    return `${ground}은(는) retrievedReferences에 포함된 공식/준공식 근거로서 본 건 적용 가능성을 검토해야 한다.`;
  }).join('\n');

  const application = profile === 'thyroid_disclosure_cancer'
    ? '위 근거들을 현 사건에 적용하면, 보험회사의 계약해지 및 암진단비 부지급 주장은 갑상선 결절 소견의 존재만으로 충분하지 않고 청약서 질문사항 해당성, 중요한 사항성, 고객의 질병 인식 가능성, 고의 또는 중대한 과실, 그리고 갑상선암 진단과의 인과관계가 함께 확인되어야 한다.'
    : '위 근거들을 현 사건에 적용하면, 보험회사의 계약해지 주장은 진료기록의 존재만으로 충분하지 않고 청약서 질문사항 해당성, 중요한 사항성, 피보험자의 인식 가능성, 고의 또는 중대한 과실, 그리고 보험금 부지급과 관련한 인과관계가 함께 확인되어야 한다.';
  const opinion = '따라서 손해사정 의견은 보험금 지급 또는 계약해지 취소를 단정하기보다, 위 공식근거와 현재 확인된 사실관계에 비추어 계약해지 처분의 요건 충족 여부를 재검토해야 한다는 방향으로 정리한다.';

  return {
    ...result,
    legalAndReferenceBasis: [result.legalAndReferenceBasis, '[본문 반영 근거]', legalLines].filter(Boolean).join('\n\n'),
    damageAssessment: [result.damageAssessment, application].filter(Boolean).join('\n\n'),
    adjusterOpinionDraft: [result.adjusterOpinionDraft, opinion].filter(Boolean).join('\n\n'),
  };
}

function enforceCustomerSideStance(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  const prohibited = [
    /보험금\s*지급\s*확정/g,
    /반드시\s*받을\s*수\s*있음/g,
    /보험사의\s*처분은\s*무조건\s*위법/g,
    /승소\s*가능성/g,
  ];
  const clean = (value: string) => prohibited.reduce((text, pattern) => text.replace(pattern, '재검토 필요'), value);
  const isRelevant = isDisclosureDutyCase(input) || /부지급|면책|해지|재검토|고객/i.test([
    input.insurerPosition,
    input.customerStatement,
    input.adjusterMemo,
    input.sourceAnalysis?.denialReason,
  ].filter(Boolean).join(' '));
  if (caseProfile(input) === 'indemnity_manual_therapy_denial') {
    const customerStance = '종합하면, 현 단계에서 보험금 지급을 확정할 수는 없으나 도수치료 부지급 처분은 치료 목적성, 의학적 필요성, 의사 처방 및 치료 경과 자료를 기준으로 재검토될 필요가 있다. 보험회사는 단순히 도수치료 항목명만으로 부지급을 유지하기보다 구체적인 의학적 필요성 부족 근거와 가입 당시 실손보험 약관상 보상 제외 근거를 제시해야 한다.';
    const rebuttal = '보험사 주장에 대해서는 도수치료가 비급여 항목이라는 사정만으로 곧바로 부지급 요건이 충족되는지, 진료기록상 치료 목적성과 의학적 필요성이 배척될 수 있는지, 반복치료의 횟수와 기간이 구체적으로 왜 부적정한지, 가입 당시 원약관상 어떤 보상 제외 조항이 적용되는지를 중심으로 반박할 필요가 있다.';
    return {
      ...result,
      title: clean(result.title),
      overview: clean(result.overview),
      facts: clean(result.facts),
      issues: clean(result.issues),
      legalAndReferenceBasis: clean(result.legalAndReferenceBasis),
      damageAssessment: clean(result.damageAssessment),
      insurerPositionReview: [clean(result.insurerPositionReview), rebuttal].filter(Boolean).join('\n\n'),
      adjusterOpinionDraft: [clean(result.adjusterOpinionDraft), customerStance].filter(Boolean).join('\n\n'),
      requiredAdditionalChecks: clean(result.requiredAdditionalChecks),
      simpleClientSummary: clean(result.simpleClientSummary),
      disclaimer: clean(result.disclaimer),
    };
  }
  if (!isRelevant) {
    return {
      ...result,
      title: clean(result.title),
      overview: clean(result.overview),
      facts: clean(result.facts),
      issues: clean(result.issues),
      legalAndReferenceBasis: clean(result.legalAndReferenceBasis),
      damageAssessment: clean(result.damageAssessment),
      insurerPositionReview: clean(result.insurerPositionReview),
      adjusterOpinionDraft: clean(result.adjusterOpinionDraft),
      requiredAdditionalChecks: clean(result.requiredAdditionalChecks),
      simpleClientSummary: clean(result.simpleClientSummary),
      disclaimer: clean(result.disclaimer),
    };
  }

  const customerStance = '종합하면, 현 단계에서 보험금 지급을 확정할 수는 없으나 고객 측 주장은 상당한 검토 가치가 있다. 보험회사는 부지급, 면책 또는 계약해지 판단의 전제가 되는 객관적 근거와 인수기준을 제시할 필요가 있으며, 현재 확인된 사실관계에 비추어 해당 처분은 재검토가 필요하다는 방향으로 의견을 정리한다.';
  const rebuttal = '보험사 주장에 대해서는 진료기록 또는 코드 기재 사실만으로 곧바로 면책ㆍ해지 요건이 충족되는지, 고객이 해당 사실의 보험계약상 중요성을 인식했다고 볼 수 있는지, 보험회사가 동일 정보를 알았다면 실제로 인수거절ㆍ부담보ㆍ할증 등 조건부 인수를 했을 객관적 기준이 있는지를 중심으로 반박할 필요가 있다.';
  const unfavorable = '불리한 점으로는 실제 청약서 질문사항, 고지 당시 문답 내용, 진료기록의 구체적 기재, 처방 또는 검사 여부에 따라 보험사 주장이 강화될 수 있다는 점이 있다. 따라서 청약서, 상품별 원약관, 초진기록, 처방전, 검사내역, 의사소견서, 보험사 인수기준을 보완자료로 확보해야 한다.';

  return {
    ...result,
    title: clean(result.title),
    overview: clean(result.overview),
    facts: clean(result.facts),
    issues: clean(result.issues),
    legalAndReferenceBasis: clean(result.legalAndReferenceBasis),
    damageAssessment: clean(result.damageAssessment),
    insurerPositionReview: [clean(result.insurerPositionReview), rebuttal].filter(Boolean).join('\n\n'),
    adjusterOpinionDraft: [clean(result.adjusterOpinionDraft), customerStance].filter(Boolean).join('\n\n'),
    requiredAdditionalChecks: [clean(result.requiredAdditionalChecks), unfavorable].filter(Boolean).join('\n\n'),
    simpleClientSummary: clean(result.simpleClientSummary),
    disclaimer: clean(result.disclaimer),
  };
}

function adjustDisclosureDamageScope(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  const profile = caseProfile(input);
  if (!isDisclosureDutyCase(input) && profile !== 'indemnity_manual_therapy_denial') return result;
  const scope = profile === 'indemnity_manual_therapy_denial'
    ? '본 건은 손해액 산정보다는 도수치료가 가입 당시 실손보험 약관상 보상 대상 치료에 해당하는지, 치료 목적성과 의학적 필요성이 인정되는지, 반복치료의 적정성과 비급여 치료 항목의 보상 제외 여부가 어떻게 판단되는지가 핵심이다. 따라서 진료기록지, 도수치료 처방 또는 치료계획, 의사 소견서, 치료 전후 증상 변화 기록, 통증평가 기록, 진료비 세부내역서, 비급여 진료내역, 가입 당시 실손보험 원약관 및 보험회사 부지급 사유서를 중심으로 검토해야 한다.'
    : profile === 'm47_disclosure'
    ? '본 건은 손해액 산정보다는 보험가입 전 1회 통원 사실이 계약전 알릴의무 위반 및 계약해지 사유에 해당하는지 여부가 핵심이다. 따라서 손해평가보다는 청약서 질문사항, 진료기록, 보험회사의 객관적 인수기준, 피보험자의 고의 또는 중대한 과실 여부, 고지의무 위반 사실과 보험사고 사이의 인과관계를 중심으로 검토해야 한다.'
    : profile === 'thyroid_disclosure_cancer'
      ? '본 건은 손해액 산정보다는 보험가입 전 갑상선 결절 소견이 계약전 알릴의무상 중요한 사항에 해당하는지, 고객에게 고의 또는 중대한 과실이 있었는지, 그리고 이후 갑상선암 진단과의 관련성이 인정되는지가 핵심이다. 따라서 건강검진 결과지, 갑상선 초음파 판독지, 미세침흡인검사 권유 여부, 조직검사 여부, 가입 당시 암보험 약관 및 청약서 질문사항을 중심으로 검토해야 한다.'
      : '본 건은 손해액 산정보다는 보험가입 전 확인된 진료ㆍ검사ㆍ병력 사항이 계약전 알릴의무상 중요한 사항에 해당하는지, 고객에게 고의 또는 중대한 과실이 있었는지, 보험사고와의 인과관계가 인정되는지가 핵심이다. 따라서 청약서 질문사항, 진료기록, 검사내역, 보험회사의 객관적 인수기준 및 가입 당시 약관을 중심으로 검토해야 한다.';
  return {
    ...result,
    damageAssessment: scope,
  };
}

function normalizeDisclosureOpinion(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  const profile = caseProfile(input);
  if (profile !== 'm47_disclosure' && profile !== 'thyroid_disclosure_cancer' && profile !== 'indemnity_manual_therapy_denial') return result;
  const opinion = profile === 'indemnity_manual_therapy_denial' ? [
    '먼저, 도수치료가 실손보험 청구 항목에 포함되어 있다는 사실만으로 보험금 지급 또는 부지급이 곧바로 확정되는 것은 아니다. 현재 입력된 사실관계에 따르면 핵심은 해당 도수치료가 치료 목적의 의료행위였는지, 의학적 필요성이 인정되는지, 반복치료의 횟수와 기간이 진료 경과에 비추어 적정한지 여부이다.',
    '보험회사가 도수치료의 의학적 필요성 부족 또는 과잉진료를 이유로 부지급을 주장하려면 단순히 비급여 도수치료라는 항목명만으로는 부족하다. 보험회사는 진료기록, 치료횟수, 치료기간, 증상 경과, 의학적 필요성이 부족하다고 보는 구체적 사유, 가입 당시 실손보험 약관상 보상 제외 근거를 명확히 제시할 필요가 있다.',
    '고객 측에서는 도수치료가 통증 완화나 기능 회복 등 치료 목적에서 시행되었다는 점을 자료로 보완해야 한다. 이를 위해 진료기록지, 도수치료 처방 또는 치료계획, 의사 소견서, 치료 전후 증상 변화 기록, 통증평가 기록, 진료비 세부내역서와 영수증, 비급여 진료내역을 확보하는 것이 중요하다.',
    '2022년 가입 실손보험이라면 4세대 실손보험으로 추정될 수 있으나, 이는 검색과 쟁점 정리를 위한 보조 정보일 뿐이다. 최종 판단은 반드시 가입 당시 해당 보험회사의 실손보험 원약관, 비급여 특약, 도수치료 관련 보상 기준과 자기부담 구조를 확인한 뒤 이루어져야 한다.',
    '불리한 점도 함께 검토해야 한다. 치료횟수가 과도하게 많거나, 의사 처방 및 치료계획이 불명확하거나, 치료 전후 증상 변화 기록이 부족하거나, 약관상 보상 제외 또는 제한 조항에 해당하는 사정이 있으면 보험회사 주장이 강화될 수 있다. 따라서 고객 측 주장은 치료 목적성과 의학적 필요성을 입증하는 자료 확보를 전제로 정리하는 것이 타당하다.',
    '종합하면, 현 단계에서 보험금 지급을 확정할 수는 없으나 도수치료 부지급 처분은 치료 목적성, 의학적 필요성, 의사 처방 및 치료 경과 자료를 기준으로 재검토될 필요가 있다. 보험회사가 구체적 의학적 필요성 부족 근거와 약관상 보상 제외 근거를 충분히 제시하지 못했다면, 고객 측은 위 보완자료를 제출하여 실손보험금 재심사를 요청할 수 있다는 의견이다.',
  ] : profile === 'm47_disclosure' ? [
    '먼저, 보험가입 전 진료기록 또는 병원 전산상 M47.26 질병코드가 존재한다는 점은 사실관계로 인정할 수 있다. 다만 진료기록이 존재한다는 사정과 계약전 알릴의무 위반을 이유로 한 계약해지 요건이 충족되는지는 구분되어야 한다. 보험회사가 계약해지를 주장하려면 단순한 기록 존재를 넘어 그 진료이력이 청약 당시 고지해야 할 중요한 사항에 해당한다는 점을 구체적으로 설명할 필요가 있다.',
    '상법 제651조의 취지에 비추어 보면, 계약전 알릴의무 위반에 따른 계약해지는 중요한 사항성과 고의 또는 중대한 과실이 함께 문제된다. 따라서 본 건에서는 청약서 질문사항이 해당 1회 통원 사실을 명확히 묻고 있었는지, 피보험자가 그 사실을 보험계약상 중요한 사항으로 인식할 수 있었는지, 고지하지 않은 데 고의 또는 중대한 과실이 있었다고 볼 수 있는지를 순차적으로 검토해야 한다.',
    '현재 입력된 사실관계가 단순 허리 뻐근함 또는 허리 통증으로 인한 1회성 통원에 그치고, 입원, 수술, 정밀검사, 반복치료, 장기투약이 확인되지 않는 사안이라면 이는 고객 측에 유리한 사정이다. 이러한 경우 피보험자가 해당 진료를 중대한 질환 또는 보험계약 인수에 영향을 미칠 중요한 병력으로 인식했다고 단정하기 어렵고, 중요사항성 및 고의ㆍ중대한 과실은 다툴 여지가 있다.',
    '또한 병원 전산상 M47.26 코드가 부여되었다는 사실과 피보험자가 그 코드의 의학적 의미 및 보험계약상 중요성을 알았다는 사실은 별개의 문제이다. 의료기관이 행정상 또는 진료비 청구상 질병코드를 기재한 사정만으로 피보험자가 해당 상병을 중대한 질환으로 이해하고 있었다고 볼 수는 없으므로, 보험회사는 피보험자의 인식 가능성에 관한 구체적 근거를 제시해야 한다.',
    '보험회사가 해당 진료이력을 알았다면 계약을 거절하거나 부담보, 할증, 조건부 인수 등으로 처리했을 것이라고 주장하는 경우에도, 그 주장은 객관적 인수기준으로 뒷받침되어야 한다. 따라서 보험회사가 실제 인수심사 기준, 동일 또는 유사한 상병코드에 대한 인수처리 사례, 부담보 또는 할증 적용 기준을 제시하지 못한다면 계약해지 판단의 전제는 재검토될 필요가 있다.',
    '보험금 부지급까지 함께 문제되는 경우에는 상법 제655조의 취지상 고지의무 위반 여부와 별도로, 미고지 사실과 보험사고 또는 청구 손해 사이의 인과관계도 검토되어야 한다. 계약해지 가능성과 보험금 부지급 가능성은 같은 사실관계에서 출발하더라도 법적 검토 지점이 다르므로, 보험회사는 부지급 판단에 대해서도 별도의 인과관계 및 약관상 근거를 제시할 필요가 있다.',
    '종합하면, 현 단계에서 보험금 지급을 확정할 수는 없으나 고객 측 주장은 상당한 검토 가치가 있다. 특히 1회성 통원, 중대한 검사ㆍ치료 부재, 질병코드 기재와 고객 인식의 구분, 보험회사의 객관적 인수기준 제시 필요성, 고지의무 위반과 보험사고 사이의 인과관계 검토 필요성에 비추어 볼 때, 보험회사의 계약해지 및 부지급 처분은 재검토가 필요하다는 의견이다.',
  ] : [
    '먼저, 보험가입 전 갑상선 결절 소견이 있었다는 사실 자체와 계약전 알릴의무 위반으로 인한 계약해지 요건이 충족되는지는 구분되어야 한다. 보험회사가 갑상선 결절 미고지를 이유로 계약해지 또는 암진단비 부지급을 주장하려면 해당 소견이 청약 당시 중요한 사항에 해당하고, 고객에게 고의 또는 중대한 과실이 있었다는 점을 구체적으로 검토해야 한다.',
    '상법 제651조의 취지에 비추어 보면 계약전 알릴의무 위반에 따른 계약해지는 중요한 사항성과 고의 또는 중대한 과실이 함께 문제된다. 건강검진상 단순 결절 또는 추적관찰 권유에 그쳤고 치료, 투약, 수술, 입원, 암 의심 설명, 미세침흡인검사 또는 조직검사 권유가 없었다면 고객이 이를 보험계약상 중요한 병력으로 인식하기 어려웠을 가능성이 있다.',
    '대법원 2011.4.14. 선고 2009다103349, 103356 판결의 취지상, 갑상선 결절을 알고 있었다는 사정만으로 그것이 고지의무 대상의 중요한 사항임을 알고도 불고지했다고 단정하기는 어렵다. 따라서 본 건에서도 갑상선 결절의 발견 경위, 설명 내용, 추가검사 권유 여부, 고객의 질병 인식 가능성을 구체적으로 나누어 보아야 한다.',
    '다만 초음파상 악성 의심 소견, 미세침흡인검사 권유, 조직검사 권유, 갑상선 양성신생물 진단, 반복 추적검사 지시가 확인된다면 보험회사 주장이 강화될 수 있다. 이 부분은 고객에게 불리한 사정이 될 수 있으므로 건강검진 결과지, 갑상선 초음파 판독지, 검사 권유 기록, 외래기록을 추가로 확보해야 한다.',
    '보험회사가 해당 갑상선 결절 소견을 알았다면 인수거절, 부담보, 할증 또는 조건부 인수로 처리했을 것이라고 주장하는 경우에도, 그 주장은 객관적 인수기준으로 뒷받침되어야 한다. 보험회사가 실제 인수심사 기준과 유사 사례의 인수처리 기준을 제시하지 못한다면 계약해지 판단의 전제는 재검토될 필요가 있다.',
    '암진단비 부지급까지 문제되는 경우에는 상법 제655조의 취지상 고지의무 위반 여부와 별도로, 미고지된 갑상선 결절 소견과 이후 갑상선암 진단 사이의 인과관계도 검토되어야 한다. 결절의 위치, 크기 변화, 검사 경과, 병리결과, 진단확정 시점 및 가입 당시 암보험 약관상 암진단비ㆍ갑상선암ㆍ진단확정 조항을 함께 확인해야 한다.',
    '종합하면, 단순 갑상선 결절 소견만으로 계약전 알릴의무 위반 및 암진단비 부지급을 단정하기는 어렵다. 특히 건강검진상 단순 추적관찰 수준이고 치료, 투약, 수술, 입원, 미세침흡인검사 또는 조직검사 등 정밀검사 권유가 없었다면 고객에게 고의 또는 중대한 과실이 있었다고 보기 어렵다는 주장이 가능하다. 보험회사는 인수거절, 부담보, 할증 기준과 갑상선암 진단 사이의 인과관계를 구체적으로 제시할 필요가 있으므로, 보험회사의 계약해지 및 암진단비 부지급 처분은 재검토가 필요하다는 의견으로 정리한다.',
  ];
  const opinionText = opinion.join('\n\n');

  return {
    ...result,
    adjusterOpinionDraft: opinionText,
  };
}

function hasCustomerMedicalEvidence(input: ReturnType<typeof validateInput>) {
  const source = input.sourceAnalysis;
  if (!source) return false;
  const values = [
    source.customerMedicalSummary,
    source.diagnosisSummary,
    source.testResultSummary,
    source.treatmentSummary,
    source.damageEvidenceSummary,
    ...(source.draftSupportingFacts || []),
  ];
  return values.some((value) => cleanPublicText(value).length > 0);
}

function neutralizeUnverifiedMedicalSourcePhrases(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  if (hasCustomerMedicalEvidence(input)) return result;
  const fix = (value: string) => value
    .replace(/고객의\s*의학자료에\s*따르면/g, '현재 입력된 사실관계에 따르면')
    .replace(/고객\s*의학자료에\s*따르면/g, '현재 입력된 사실관계에 따르면')
    .replace(/제출된\s*의학자료에\s*따르면/g, '제출자료 확인 전 단계에서는')
    .replace(/의학자료에\s*따르면/g, '고객 진술상')
    .replace(/고객의\s*의료자료에\s*따르면/g, '현재 입력된 사실관계에 따르면')
    .replace(/제출된\s*의료자료에\s*따르면/g, '제출자료 확인 전 단계에서는')
    .replace(/의료자료에\s*따르면/g, '고객 진술상');

  return {
    ...result,
    title: fix(result.title),
    overview: fix(result.overview),
    facts: fix(result.facts),
    issues: fix(result.issues),
    legalAndReferenceBasis: fix(result.legalAndReferenceBasis),
    damageAssessment: fix(result.damageAssessment),
    insurerPositionReview: fix(result.insurerPositionReview),
    adjusterOpinionDraft: fix(result.adjusterOpinionDraft),
    requiredAdditionalChecks: fix(result.requiredAdditionalChecks),
    simpleClientSummary: fix(result.simpleClientSummary),
    disclaimer: fix(result.disclaimer),
  };
}

function removeProfileSpecificLeakage(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  const profile = caseProfile(input);
  if (profile !== 'thyroid_disclosure_cancer' && profile !== 'indemnity_manual_therapy_denial') return result;
  const leak = profile === 'thyroid_disclosure_cancer'
    ? /M47\.26|단순\s*허리|허리\s*통증|허리통증|정형외과|1회\s*통원|요추증|신경뿌리병증|입원\/수술\/정밀검사|입원,\s*수술,\s*정밀검사/i
    : /계약전\s*알릴의무|계약\s*전\s*알릴\s*의무|고지의무|미고지|계약해지|청약서\s*질문사항|청약서|인수기준|인수거절|부담보|할증|M47\.26|M54\.26|1회\s*통원\s*미고지|자동차보험\s*손해액|후유장해|암진단비|백내장|입원비\s*부지급|입원치료|입원\s*인정\s*여부/i;
  const clean = (value: string) => value
    .split(/(?<=[.。])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !leak.test(sentence))
    .join('\n\n')
    .trim();
  return {
    ...result,
    title: clean(result.title) || result.title.replace(/M47\.26/gi, '').trim(),
    overview: clean(result.overview),
    facts: clean(result.facts),
    issues: clean(result.issues),
    legalAndReferenceBasis: clean(result.legalAndReferenceBasis),
    damageAssessment: clean(result.damageAssessment),
    insurerPositionReview: clean(result.insurerPositionReview),
    adjusterOpinionDraft: clean(result.adjusterOpinionDraft),
    requiredAdditionalChecks: clean(result.requiredAdditionalChecks),
    simpleClientSummary: clean(result.simpleClientSummary),
    disclaimer: clean(result.disclaimer),
  };
}

function finalizeManualTherapyResult(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>, ragResult: RagSearchResult): AssessmentDraftResult {
  if (caseProfile(input) !== 'indemnity_manual_therapy_denial') return result;
  const inputText = JSON.stringify({
    accidentDate: input.accidentDate,
    damageDetails: input.damageDetails,
    customerStatement: input.customerStatement,
    adjusterMemo: input.adjusterMemo,
    sourceAnalysis: input.sourceAnalysis,
  });
  const normalizeDate = (date: string) => date.replace(/\D/g, '');
  const inputDates = new Set((inputText.match(/\d{4}[년.-]\s*\d{1,2}[월.-]\s*\d{1,2}일?/g) || []).map(normalizeDate));
  const generatedFullDate = /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g;
  const blocked = /청약서|고지의무|계약전\s*알릴의무|계약\s*전\s*알릴\s*의무|계약해지|인수기준|인수거절|부담보|할증|입원치료|입원\s*인정\s*여부|백내장/i;
  const cleanField = (value: string) => cleanPublicText(value)
    .split(/(?<=[.。])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => {
      if (!sentence) return false;
      if (blocked.test(sentence)) return false;
      const dates = sentence.match(generatedFullDate) || [];
      return dates.every((date) => inputDates.has(normalizeDate(date)));
    })
    .join('\n\n')
    .replace(/보험금\s*지급\s*가능성을\s*높일\s*수\s*있습니다\.?/g, '재심사에 필요한 근거를 보완할 수 있습니다.')
    .replace(/보험금\s*지급\s*가능성을\s*높일\s*수\s*있/g, '재심사에 필요한 근거를 보완할 수 있')
    .trim();
  const hasDirectOfficial = (ragResult.officialReferences || []).some((ref) => {
    const text = [ref.title, ref.summary, ref.article_title].filter(Boolean).join(' ');
    return /도수치료|실손보험|실손의료|비급여|치료\s*목적|치료목적|의학적\s*필요성|보상\s*제외/i.test(text)
      && !/입원치료|입원\s*인정\s*여부|백내장|고지의무|계약해지/i.test(text);
  });
  const fallbackBasis = '도수치료와 직접 관련된 공식 판례 또는 분쟁조정례는 현재 충분히 확인되지 않았습니다. 따라서 본 건은 가입 당시 실손보험 원약관, 비급여 도수치료 관련 조항, 진료기록상 치료 목적성과 의학적 필요성을 중심으로 검토해야 합니다.';
  return {
    ...result,
    title: cleanField(result.title) || '도수치료 실손보험 부지급 재검토 사정서 초안',
    overview: cleanField(result.overview),
    facts: cleanField(result.facts),
    issues: cleanField(result.issues),
    legalAndReferenceBasis: [cleanField(result.legalAndReferenceBasis), hasDirectOfficial ? '' : fallbackBasis].filter(Boolean).join('\n\n'),
    damageAssessment: cleanField(result.damageAssessment),
    insurerPositionReview: cleanField(result.insurerPositionReview),
    adjusterOpinionDraft: cleanField(result.adjusterOpinionDraft),
    requiredAdditionalChecks: [
      '진료기록지',
      '도수치료 처방 또는 치료계획',
      '의사 소견서',
      '치료 전후 증상 변화 기록',
      '통증평가 기록',
      '진료비 세부내역서',
      '영수증',
      '비급여 진료내역',
      '보험회사 부지급 사유서',
      '가입 당시 실손보험 원약관',
    ].join('\n'),
    simpleClientSummary: cleanField(result.simpleClientSummary),
    disclaimer: cleanField(result.disclaimer),
  };
}

function addThyroidFssFollowUpCheck(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>, ragResult: RagSearchResult): AssessmentDraftResult {
  if (caseProfile(input) !== 'thyroid_disclosure_cancer') return result;
  const hasConfirmedFss = (ragResult.officialReferences || []).some((ref) => {
    const text = [ref.title, ref.summary, ref.case_number, ref.court_or_agency].filter(Boolean).join(' ');
    return ref.source_area === 'fss_dispute_cases'
      && /갑상선|결절|갑상선암|C73|E04|D34/i.test(text)
      && !/추가\s*확인\s*필요|원문\s*확인\s*필요/i.test(text);
  });
  if (hasConfirmedFss || /갑상선 결절 고지의무 관련 금융감독원 분쟁조정례 추가 확인 필요/.test(result.requiredAdditionalChecks)) {
    return result;
  }
  return {
    ...result,
    requiredAdditionalChecks: [
      result.requiredAdditionalChecks,
      '갑상선 결절 고지의무 관련 금융감독원 분쟁조정례 추가 확인 필요. 조정번호, 결정일자, 결론은 원문 확인 전에는 특정하지 않는다.',
    ].filter(Boolean).join('\n\n'),
  };
}

function inputDiagnosisCodes(input: ReturnType<typeof validateInput>) {
  return extractDiagnosisCodesFromText(JSON.stringify({
    caseTitle: input.caseTitle,
    diagnosisText: input.diagnosisText,
    diagnosisName: input.diagnosisName,
    diagnosisCode: input.diagnosisCode,
    damageDetails: input.damageDetails,
    insurerPosition: input.insurerPosition,
    customerStatement: input.customerStatement,
    adjusterMemo: input.adjusterMemo,
    sourceAnalysis: input.sourceAnalysis,
  }));
}

function preserveDiagnosisCodesInText(value: string | undefined, codes: string[]) {
  let text = cleanPublicText(value);
  for (const code of codes) {
    const group = code.split('.')[0];
    const [letter, numeric, decimal] = code.match(/^([A-Z])(\d{2})\.(\d{1,3})$/i)?.slice(1) || [];
    text = text.replace(new RegExp(`\\b${group}\\.\\d{1,3}\\b`, 'gi'), code);
    if (letter && numeric && decimal) {
      text = text.replace(new RegExp(`\\b${letter}\\d{2}\\.${decimal}\\b`, 'gi'), code);
      text = text.replace(new RegExp(`\\b${letter}${numeric}\\.\\d{1,3}\\b`, 'gi'), code);
    } else {
      const simple = code.match(/^([A-Z])(\d{2})$/i)?.slice(1);
      if (simple) text = text.replace(new RegExp(`\\b${simple[0]}\\d{2}\\b`, 'gi'), code);
    }
  }
  return text;
}

function disclosureStatuteReferences(): RagSearchResult['officialReferences'] {
  return [
    {
      reference_type: 'official',
      source_area: 'legal_statutes',
      source_area_label: '법령',
      title: '상법 제651조 고지의무위반으로 인한 계약해지',
      summary: '상법 제651조는 보험계약 당시 중요한 사항에 관하여 고의 또는 중대한 과실로 고지하지 않거나 부실고지를 한 경우 보험자가 일정 기간 내 계약을 해지할 수 있다는 취지의 조항이다.',
      source_url: 'https://www.law.go.kr/법령/상법',
      sourceDisplayName: '국가법령정보센터',
      similarity: 1,
      law_name: '상법',
      article_title: '제651조 고지의무위반으로 인한 계약해지',
    },
    {
      reference_type: 'official',
      source_area: 'legal_statutes',
      source_area_label: '법령',
      title: '상법 제651조의2 서면에 의한 질문의 효력',
      summary: '상법 제651조의2는 보험자가 서면으로 질문한 사항은 중요한 사항으로 추정한다는 취지의 조항이다.',
      source_url: 'https://www.law.go.kr/법령/상법',
      sourceDisplayName: '국가법령정보센터',
      similarity: 1,
      law_name: '상법',
      article_title: '제651조의2 서면에 의한 질문의 효력',
    },
    {
      reference_type: 'official',
      source_area: 'legal_statutes',
      source_area_label: '법령',
      title: '상법 제655조 계약해지와 보험금청구권',
      summary: '상법 제655조는 고지의무 위반 등으로 계약을 해지한 경우 보험금청구권 및 고지의무 위반 사실과 보험사고 발생 사이의 인과관계를 검토할 때 문제되는 조항이다.',
      source_url: 'https://www.law.go.kr/법령/상법',
      sourceDisplayName: '국가법령정보센터',
      similarity: 1,
      law_name: '상법',
      article_title: '제655조 계약해지와 보험금청구권',
    },
  ];
}

function thyroidPrecedentReference(): RagSearchResult['officialReferences'][number] {
  return {
    reference_type: 'official',
    source_area: 'precedents',
    source_area_label: '판례',
    title: '대법원 2011.4.14. 선고 2009다103349, 103356 보험금 판결',
    summary: '갑상선 결절 관련 고지의무 판단에서 결절을 알고 있었다는 사정만으로 중요한 사항임을 알고도 불고지했다고 단정하기 어렵다는 취지로 검토할 수 있는 판례이다.',
    source_url: 'https://www.law.go.kr',
    sourceDisplayName: '국가법령정보센터',
    similarity: 1,
    case_number: '2009다103349, 103356',
    court_or_agency: '대법원',
    decision_date: '2011.4.14.',
  };
}

function officialReferenceKey(ref: RagSearchResult['officialReferences'][number]) {
  const text = [
    ref.law_name,
    ref.article_title,
    ref.title,
    ref.summary,
  ].filter(Boolean).join(' ');
  if (ref.source_area === 'legal_statutes') {
    if (/상법/.test(text) && /제\s*651\s*조의\s*2|651\s*조의\s*2|651조의2|651-2/i.test(text)) return 'legal_statutes:상법:제651조의2';
    if (/상법/.test(text) && /제\s*651\s*조|651조/i.test(text)) return 'legal_statutes:상법:제651조';
    if (/상법/.test(text) && /제\s*655\s*조|655조/i.test(text)) return 'legal_statutes:상법:제655조';
  }
  if (ref.source_area === 'precedents' && /2009다103349|2009다103356/.test(text)) return 'precedents:2009다103349,103356';
  if (ref.source_area === 'precedents' && /2023다274056/.test(text)) return 'precedents:2023다274056';
  if (ref.source_area === 'fss_dispute_cases' && /갑상선|결절|갑상선암/.test(text) && /고지의무|알릴의무|미고지|추적관찰|미세침흡인|정밀검사/.test(text)) return 'fss:thyroid-disclosure';
  return `${ref.source_area}:${cleanPublicText(ref.title)}:${cleanPublicText(ref.source_url)}`;
}

function sanitizeRagResultForAssessment(input: ReturnType<typeof validateInput>, ragResult: RagSearchResult): RagSearchResult {
  const codes = inputDiagnosisCodes(input);
  const profile = caseProfile(input);
  const disclosureM4726 = profile === 'm47_disclosure';
  const thyroidProfile = profile === 'thyroid_disclosure_cancer';
  const manualTherapyProfile = profile === 'indemnity_manual_therapy_denial';
  const normalizeRef = <T extends RagSearchResult['officialReferences'][number] | RagSearchResult['internalReviewMaterials'][number]>(ref: T): T => ({
    ...ref,
    title: preserveDiagnosisCodesInText(ref.title, codes),
    summary: preserveDiagnosisCodesInText(ref.summary, codes),
    diagnosis_code: preserveDiagnosisCodesInText(ref.diagnosis_code, codes),
    diagnosis_name: preserveDiagnosisCodesInText(ref.diagnosis_name, codes),
  });

  const officialBase = isDisclosureDutyCase(input)
    ? [...disclosureStatuteReferences(), ...(thyroidProfile ? [thyroidPrecedentReference()] : []), ...ragResult.officialReferences]
    : ragResult.officialReferences;
  const seenOfficial = new Set<string>();
  const officialReferences = officialBase.map(normalizeRef).filter((ref) => {
    const text = [
      ref.title,
      ref.summary,
      ref.law_name,
      ref.article_title,
      ref.case_number,
      ref.diagnosis_code,
      ref.diagnosis_name,
    ].filter(Boolean).join(' ');
    if (thyroidProfile) {
      if (/M47\.26|요추증|허리통증|정형외과|1회\s*통원|실손보험\s*약관|도수치료|백내장|중심정맥관|무릎|후유장해|체외충격파|회전근개|자동차|교통사고/i.test(text)) return false;
      if (ref.source_area === 'terms_standards' && /실손|실손보험|실손의료/i.test(text)) return false;
      if (ref.source_area === 'terms_standards' && !/암보험|질병보험|표준약관|암진단비|진단확정|갑상선암|유사암|소액암|제자리암|고지의무|알릴의무/i.test(text)) return false;
      if (ref.source_area === 'fss_dispute_cases') {
        const confirmedFss = /official_fss_full_text|조정|분쟁조정|결정|원문/i.test(text)
          && !/추가\s*확인\s*필요|원문\s*확인\s*필요/i.test(text);
        if (!confirmedFss) return false;
      }
      if (ref.source_area === 'precedents') {
        const corePrecedent = /2009다103349|2009다103356|2023다274056/.test(text);
        const directlyRelated = /갑상선|결절|갑상선암|고지의무|중요한\s*사항|중대한\s*과실|암진단비|설명의무/i.test(text);
        const weakSummary = cleanPublicText(ref.summary).length < 40 && !/갑상선|고지의무|암진단비|설명의무/i.test(text);
        if (!corePrecedent && (!directlyRelated || weakSummary)) return false;
        if (/2023다274056/.test(text)) {
          ref.title = '대법원 2025.5.15. 선고 2023다274056 판결 - 갑상선암 약관 설명의무 보조 판례';
          ref.summary = '갑상선암 관련 약관상 분류기준 및 설명의무 검토 시 참고할 수 있는 보조 판례이다. 본 건의 주된 고지의무 판단 근거가 아니라 약관 설명의무와 암 분류기준 쟁점에 한정하여 검토한다.';
        }
      }
    }
    if (manualTherapyProfile) {
      const excluded = /계약전\s*알릴의무|고지의무|계약해지|청약서|인수거절|부담보|할증|M47\.26|1회\s*통원\s*미고지|자동차|손해배상|후유장해|암진단비|백내장|갑상선암|입원비|이륜차|요양불승인|산재/i;
      const direct = /도수치료|manual\s*therapy|실손보험|실손의료|비급여|치료\s*목적|치료목적|의학적\s*필요성|과잉진료|반복치료|진료비\s*세부내역|치료계획|의료비\s*지급|보상\s*제외/i;
      if (excluded.test(text)) return false;
      if (ref.source_area === 'precedents' && !direct.test(text)) return false;
      if (ref.source_area === 'terms_standards' && !direct.test(text)) return false;
    }
    const key = officialReferenceKey(ref);
    if (seenOfficial.has(key)) return false;
    seenOfficial.add(key);
    return true;
  });

  let internalReviewMaterials = ragResult.internalReviewMaterials.map(normalizeRef);
  if (disclosureM4726) {
    const excluded = /회전근개|어깨|견관절|중심정맥관|암수술|체외충격파|M48\.3|척추협착|무릎|M17|백내장|심장|뇌|입원비|장기\s*재활/i;
    const allowed = /M47\.26|\bM47(?:\.|$)|\bM54(?:\.|$)|요통|허리통증|요추증|신경뿌리병증|고지의무|1회\s*통원|계약해지|DISCLOSURE_M4726_SINGLE_VISIT/i;
    internalReviewMaterials = internalReviewMaterials.filter((ref) => {
      const text = [
        ref.title,
        ref.summary,
        ref.diagnosis_code,
        ref.diagnosis_name,
      ].filter(Boolean).join(' ');
      return allowed.test(text) && !excluded.test(text);
    }).slice(0, 4);
  } else if (thyroidProfile) {
    const excluded = /M47\.26|요추증|허리통증|정형외과|1회\s*통원|실손보험|도수치료|백내장|중심정맥관|무릎|후유장해|체외충격파|회전근개|자동차|교통사고|M48\.3|척추협착|어깨|견관절/i;
    const allowed = /C73|갑상선암|갑상선\s*결절|E04|갑상선종|D34|갑상선\s*양성신생물|초음파|미세침흡인검사|조직검사|건강검진|암진단비|고지의무|알릴의무/i;
    internalReviewMaterials = internalReviewMaterials.filter((ref) => {
      const text = [
        ref.title,
        ref.summary,
        ref.diagnosis_code,
        ref.diagnosis_name,
      ].filter(Boolean).join(' ');
      return allowed.test(text) && !excluded.test(text);
    }).slice(0, 4);
  } else if (manualTherapyProfile) {
    const excluded = /계약전\s*알릴의무|고지의무|계약해지|청약서|인수거절|부담보|할증|M47\.26|M54\.26\s*1회\s*통원\s*미고지|계약해지\s*안내문|자동차보험\s*손해액|후유장해|암진단비|백내장|갑상선암|입원비\s*부지급|중심정맥관/i;
    const allowed = /도수치료|manual\s*therapy|비급여\s*치료|치료\s*목적|치료목적|의학적\s*필요성|과잉진료|반복치료|\bM54(?:\.|$)|요통|허리통증|진료비\s*세부내역|치료계획|INDEMNITY_MANUAL_THERAPY_PURPOSE|보험금\s*부지급\s*안내문/i;
    internalReviewMaterials = internalReviewMaterials.filter((ref) => {
      const text = [
        ref.title,
        ref.summary,
        ref.diagnosis_code,
        ref.diagnosis_name,
      ].filter(Boolean).join(' ');
      return allowed.test(text) && !excluded.test(text);
    }).slice(0, 4);
  }

  return {
    ...ragResult,
    officialReferences,
    internalReviewMaterials,
  };
}

function emptyRagResult(): RagSearchResult {
  return { query: '', officialReferences: [], internalReviewMaterials: [] };
}

async function getRagResult(apiKey: string, input: ReturnType<typeof validateInput>) {
  try {
    const context = ragContextFromInput(input);
    return await searchRagReferences({
      supabaseUrl: requiredEnv('SUPABASE_URL'),
      serviceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      openAiKey: apiKey,
      context,
      query: buildRagSearchQuery({
        caseTitle: input.caseTitle,
        insurerName: input.insurerName,
        productName: input.productName,
        policyName: input.policyName,
        insuranceType: input.insuranceType,
        coverageType: input.coverageType,
        contractDate: input.contractDate,
        policyGeneration: context.policyGeneration,
        diagnosisText: input.diagnosisText,
        diagnosisName: input.diagnosisName,
        diagnosisCode: input.diagnosisCode,
        accidentType: input.accidentType,
        accidentDate: input.accidentDate,
        damageDetails: input.damageDetails,
        insurerPosition: input.insurerPosition,
        customerStatement: input.customerStatement,
        adjusterMemo: input.adjusterMemo,
        sourceAnalysis: input.sourceAnalysis,
      }, context),
    });
  } catch (error) {
    console.warn('RAG search failed for assessment draft', error instanceof Error ? error.message : 'unknown error');
    return emptyRagResult();
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
    const ragResult = sanitizeRagResultForAssessment(input, await getRagResult(apiKey, input));

    const draftText = await callOpenAI(apiKey, buildDraftPrompt(input, ragResult), 0.2);
    const draft = sanitizeResult(parseJsonResponse(draftText));

    const reviewedText = await callOpenAI(
      apiKey,
      buildReviewPrompt(draft, input.retrievedReferences, ragResult, input),
      0,
    );
    const reviewed = finalizeManualTherapyResult(
      addThyroidFssFollowUpCheck(
        removeProfileSpecificLeakage(
          neutralizeUnverifiedMedicalSourcePhrases(
            normalizeDisclosureOpinion(
              ensureSubstantialOpinion(
                adjustDisclosureDamageScope(
                  enforceCustomerSideStance(
                    ensureOfficialGroundsInBody(
                      removeReferenceAbsenceContradiction(
                        preserveInputDiagnosisCodes(sanitizeResult(parseJsonResponse(reviewedText)), input),
                        ragResult,
                      ),
                      ragResult,
                      input,
                    ),
                    input,
                  ),
                  input,
                ),
                input,
              ),
              input,
            ),
            input,
          ),
          input,
        ),
        input,
        ragResult,
      ),
      input,
      ragResult,
    );

    return jsonResponse({ ...reviewed, retrievedReferences: ragResult });
  } catch (error: unknown) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    return jsonResponse({ error: message }, status);
  }
});
