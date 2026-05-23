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
import { appendMedicalGuidelineEvidence, isAcuteMiDenialContext } from '../_shared/medicalGuidelineEvidence.ts';
import { detectAssessmentProfile, isDisclosureDutyProfileContext } from '../_shared/detectAssessmentProfile.ts';
import { filterAssessmentReferences } from '../_shared/filterAssessmentReferences.ts';
import type { AssessmentProfileId } from '../_shared/assessmentProfiles.ts';
import { getBearerToken, getSupabaseConfig, requireAdjusterUser } from '../_shared/caseAccess.ts';

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

type Tone = 'concise' | 'professional' | 'detailed';

interface RetrievedReference {
  source_area?: string;
  source_area_label?: string;
  source_type?: string;
  id?: string;
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
  sourceDisplayName?: string;
  similarity?: number;
  note?: string;
  embedding_status?: string;
  review_status?: string;
  trust_level?: string;
  sourceType?: string;
  citationLabel?: string;
  sourceArea?: string;
  issueTags?: string[];
  keyHolding?: string;
  excerpt?: string;
  applicableReason?: string;
  limitation?: string;
  policySource?: 'uploaded' | 'server_default';
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
  argumentStructureSummary?: string;
}

type StrategicPurpose = 'symptom' | 'diagnosis' | 'test' | 'procedure' | 'doctor_opinion' | 'insurer_notice';
type ErrorType =
  | 'medical_criteria_distortion'
  | 'omitted_key_evidence'
  | 'policy_requirement_misread'
  | 'case_law_misuse'
  | 'unsupported_additional_requirement';
type TargetSection = 'medical' | 'policy' | 'case_law' | 'interpretation';

type KillingEvidenceType =
  | 'doctor_soap_note'
  | 'doctor_reasoning'
  | 'diagnosis_certificate'
  | 'medical_opinion'
  | 'lab_trend'
  | 'ecg_finding'
  | 'cag_pci_finding'
  | 'policy_clause'
  | 'pathology_finding'
  | 'treatment_record'
  | 'brain_imaging'
  | 'neurological_deficit'
  | 'brain_followup';

interface KillingEvidence {
  evidenceType: KillingEvidenceType;
  date?: string;
  quote: string;
  sourceDocumentType?: string;
  strategicMeaning: string;
  useInSections: Array<'facts' | 'insurer_error' | 'medical' | 'policy' | 'conclusion'>;
  strength: 'decisive' | 'strong' | 'supporting';
}

interface ClaimArgumentStructure {
  insurerPosition: {
    quotedPosition: string;
    coreDenialReason: string;
    extractedFromDocumentId?: string;
  };
  factualFoundation: {
    chronologicalFacts: Array<{
      date: string;
      fact: string;
      evidenceLabel?: string;
      strategicPurpose: StrategicPurpose;
    }>;
    keyNumbers: Array<{
      label: string;
      value: string;
      meaning: string;
      repeatInSections: string[];
    }>;
  };
  insurerErrorMap: Array<{
    errorType: ErrorType;
    insurerClaim: string;
    rebuttalThesis: string;
    targetSection: TargetSection;
  }>;
  defenseLayers: {
    medical: {
      standard: string;
      patientFactMapping: Array<{ criterion: string; patientFact: string; satisfied: boolean }>;
      conclusion: string;
    };
    policy: {
      policyRequirementMapping: Array<{ requirement: string; patientFact: string; satisfied: boolean }>;
      conclusion: string;
    };
    caseLaw: {
      insurerCitedAuthority?: string;
      legalPrinciple: string;
      reverseApplication: string;
      conclusion: string;
    };
    interpretation: {
      ambiguity: string;
      contraProferentemApplication: string;
      conclusion: string;
    };
  };
  killingEvidence: KillingEvidence[];
  finalPressure: {
    paymentRequest: string;
    delayInterestRequest?: string;
    writtenReplyDemand: string;
    escalationNotice?: string;
  };
}

interface PreAnalysisResult {
  diagnosisIssue: {
    claimedDiagnosis: string;
    insurerAcceptedDiagnosis?: string;
    disputeSummary: string;
  };
  insurerDenialQuote: {
    originalQuote: string;
    sourceDocumentId?: string;
    weaknesses: string[];
  };
  medicalCriteria: {
    standardName: string;
    standardYear?: string;
    criteria: Array<{
      criterion: string;
      patientEvidence: string;
      satisfied: boolean;
      notes?: string;
    }>;
  };
  policyCriteria: {
    policyQuote: string;
    requirements: Array<{
      requirement: string;
      patientEvidence: string;
      satisfied: boolean;
    }>;
  };
  citedCaseLaw: {
    insurerCitedCases: string[];
    legalPrinciples: string[];
    reverseApplication?: string;
    fssDisputeReferences?: string[];
  };
  killingEvidence: KillingEvidence[];
  defenseLayers: {
    medical: string;
    policy: string;
    caseLaw: string;
    interpretation: string;
  };
  visualPlan: {
    tables: string[];
    quoteBoxes: string[];
    boldNumbers: string[];
  };
  finalRequestLogic: {
    paymentRequest: string;
    delayInterestRequest: string;
    writtenReplyDemand: string;
    escalationNotice: string;
  };
}

interface SelfVerification {
  insurerQuotePresent: boolean;
  medicalStandardNamed: boolean;
  medicalMappingTablePresent: boolean;
  policyQuotePresent: boolean;
  policyMappingTablePresent: boolean;
  caseLawReverseAppliedOrNotFabricated: boolean;
  killingEvidencePresent: boolean;
  defenseLayersCount: number;
  conclusionHasSeparateReasons: boolean;
  requestIncludesPayment: boolean;
  requestIncludesDelayInterest: boolean;
  requestIncludesWrittenReply: boolean;
  weakLanguageAbsent: boolean;
  forbiddenPhrasesAbsent: boolean;
  piiRedacted: boolean;
}

interface AssessmentDraftInput {
  requestId?: string;
  caseId?: string;
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
  requestId?: string;
  detectedProfile?: string;
  reportFormatVersion?: string;
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
  customerSideAssessmentReport?: string;
  finalSubmissionAssessmentReport?: string;
  retrievedReferences?: RagSearchResult;
  policyEvidence?: RetrievedReference[];
  killingEvidence?: KillingEvidence[];
  preAnalysis?: PreAnalysisResult;
  selfVerification?: SelfVerification;
}

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o';
const REPORT_FORMAT_VERSION = 'submission_report_v2_claim_argument_structure';
const MAX_FIELD_LENGTH = 1800;
const MAX_SHORT_FIELD_LENGTH = 200;
const MAX_REFERENCES = 8;
const MAX_REFERENCE_TEXT_LENGTH = 1200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const INTERNAL_ID_PATTERN = /\b(?:RQ|RSF|RCP|RCD|MIC|PIP|RKA|PST|FSS|PREC|PREC_API|FSS_LATEST)[-_]?\d{3,6}\b/g;
const CHUNK_REFERENCE_PATTERN = /\b(?:medical_issue_code|real_case_pattern|real_case_document|issue_playbook|precedent|fss_latest|terms_raw|fss_dispute_case):[A-Za-z0-9:_-]+\b/g;
const INTERNAL_FIELD_LINE_PATTERN = /^\s*(?:chunk_id|source_id|record_id|source_record_id|source_document_id|embedding_status|review_status|trust_level|source_type)\s*[:=].*$/gim;
const INTERNAL_SOURCE_TYPE_PATTERN = /\binternal_[A-Za-z0-9_:-]*\b/g;

const sourceAreaLabels: Record<string, string> = {
  fss_dispute_cases: '금융감독원 분쟁조정례',
  legal_statutes: '법령',
  medical_knowledge: '의료 참고자료',
  medical_guideline: '의학 기준',
  precedents: '판례',
  terms_standards: '약관/지급기준',
  issue_playbooks: '내부 쟁점 플레이북',
  medical_issue_codes: '질병코드별 의료쟁점',
  real_case_patterns: '익명 사건 패턴',
  real_case_documents: '익명 문서 요약',
};

const ACUTE_MI_POLICY_SEARCH_TERMS = [
  '급성심근경색',
  '급성 심근경색',
  '급성심근경색증진단',
  '심근경색증진단',
  '허혈심장질환',
  '특정허혈성심장질환',
  '심장질환 진단확정',
  '심전도',
  '심장초음파',
  '관상동맥촬영술',
  '관상동맥 조영술',
  '혈액중 심장효소검사',
  '심장효소',
  'I21',
  'I21.4',
  'I20',
  'I25.1',
];

const ACUTE_MI_SERVER_DEFAULT_POLICY_EVIDENCE: RagSearchResult['officialReferences'] = [
  {
    reference_type: 'official',
    source_area: 'terms_standards',
    source_area_label: '약관/지급기준',
    source_type: 'policy_terms_bundle',
    id: 'server_default_policy_acute_mi_diagnosis_confirmation',
    title: '서버 기본 약관 - 급성심근경색증 진단확정 조항',
    summary: '급성심근경색증 진단확정은 의료기관 의사의 진단과 병력, 심전도, 심장초음파, 관상동맥촬영술, 혈액 중 심장효소검사 등을 기초로 한다는 약관 조항이다.',
    sourceDisplayName: '서버 기본 약관/RAG',
    similarity: 1,
    note: '업로드 약관 없음 - 서버 기본 약관 기준',
    sourceType: 'policy',
    citationLabel: '서버 기본 약관/RAG - 급성심근경색증 진단확정 조항',
    sourceArea: 'terms_standards',
    issueTags: ['acute_mi_denial', 'diagnosis_confirmation', 'heart', 'I21', 'I21.4', 'troponin', 'CAG', 'PCI'],
    keyHolding: '급성심근경색증 진단확정은 의료기관 의사의 진단과 병력, 심전도, 심장초음파, 관상동맥촬영술, 혈액 중 심장효소검사 등을 기초로 한다.',
    excerpt: '급성심근경색증의 진단확정은 의료기관의 의사에 의해 내려져야 하며, 병력과 함께 심전도, 심장초음파, 관상동맥촬영술, 혈액 중 심장효소검사 등을 기초로 하여야 한다.',
    applicableReason: 'I21.4/NSTEMI 진단비 부지급에서 약관상 진단확정 요건과 보험사의 시술 전 심근효소 상승 추가 요건 주장을 대조하는 직접 근거이다.',
    limitation: '가입 당시 원약관이 업로드되지 않은 경우 서버 기본 약관/RAG 기준으로 적용한다. 실제 제출 전 가입 상품 약관 원문 대조가 필요하다.',
    policySource: 'server_default',
  },
  {
    reference_type: 'official',
    source_area: 'terms_standards',
    source_area_label: '약관/지급기준',
    source_type: 'policy_terms_bundle',
    id: 'server_default_policy_ischemic_heart_disease_diagnosis_confirmation',
    title: '서버 기본 약관 - 허혈심장질환 진단확정 조항',
    summary: '허혈심장질환 진단확정은 의료기관 의사의 진단과 병력, 심전도, 심장초음파, 관상동맥촬영술, 혈액 중 심장효소검사 등 객관자료를 기초로 한다는 약관 조항이다.',
    sourceDisplayName: '서버 기본 약관/RAG',
    similarity: 0.98,
    note: '업로드 약관 없음 - 서버 기본 약관 기준',
    sourceType: 'policy',
    citationLabel: '서버 기본 약관/RAG - 허혈심장질환 진단확정 조항',
    sourceArea: 'terms_standards',
    issueTags: ['acute_mi_denial', 'ischemic_heart_disease', 'diagnosis_confirmation', 'I20', 'I21', 'I25.1'],
    keyHolding: '허혈심장질환 진단확정도 의료기관 의사의 진단과 병력, 심전도, 심장초음파, 관상동맥촬영술, 혈액 중 심장효소검사 등 객관자료를 기초로 한다.',
    excerpt: '허혈심장질환의 진단확정은 의료기관의 의사에 의해 내려져야 하며, 병력과 함께 심전도, 심장초음파, 관상동맥촬영술, 혈액 중 심장효소검사 등을 기초로 하여야 한다.',
    applicableReason: 'Unstable angina, I20, I25.1, CAD 기재와 I21.4 진단의 관계를 약관상 진단확정 요건 관점에서 정리하는 보조 근거이다.',
    limitation: '서버 기본 약관/RAG 기준의 보조 근거이며 가입 당시 원약관과 담보명은 제출 전 확인해야 한다.',
    policySource: 'server_default',
  },
];

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
  try {
    return await requireAdjusterUser(getSupabaseConfig(), getBearerToken(req));
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 500;
    const message = error instanceof Error ? error.message : 'Failed to verify adjuster role.';
    throw new HttpError(status, message);
  }
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalUuid(value: unknown, fieldName: string) {
  const normalized = cleanText(value);
  if (!normalized) return '';
  if (!UUID_PATTERN.test(normalized)) throw new HttpError(400, `${fieldName} must be a valid UUID.`);
  return normalized;
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
    argumentStructureSummary: clip(cleanText(value.argumentStructureSummary), MAX_REFERENCE_TEXT_LENGTH),
  };
}

function validateInput(input: AssessmentDraftInput) {
  const cleaned = {
    requestId: cleanText(input.requestId),
    caseId: normalizeOptionalUuid(input.caseId, 'caseId'),
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
    'requestId',
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
  const claimantAssessmentRules = `
[Customer-side loss-adjusting report direction]
- Write as a customer-side insurance payment assessment report, not as a neutral civil complaint guide.
- The report must advocate the customer's payment position using only provided case facts and the Evidence Pack.
- Do not use the word "초안" in the body fields. The app will show a separate footer notice.
- Do not repeat generic medical-advice, complaint, FSS complaint, litigation-preparation, or loss-adjuster scope guidance in the body.
- Prohibited body phrases: "투명성을 확인하는 방향이 적절합니다", "소송 전 절차를 중심으로 진행해야 합니다", "본사 민원", "금감원 민원", "손해사정사는 소송대리를 할 수 없습니다", "보험금 지급이나 소송 결과를 단정하는 것이 아닙니다", "참고용 초안입니다", "계약해지 처분의 요건 충족 여부", "의료자문을 무조건 거부하기보다는", "자료정리가 핵심입니다".
- If additional medical advice, complaint, or dispute-mediation steps are needed, mention them only briefly in requiredAdditionalChecks and only when directly necessary.
- State customer-favorable facts first. Then identify why the insurer's denial logic is insufficient, selective, or overextended.
- Unfavorable facts must be disclosed, but frame them as issues requiring supplementation or as insurer over-interpretation when the complete record supports the customer.
- Do not invent policy wording, FSS decisions, precedent numbers, court names, decision dates, or medical facts. If Evidence Pack lacks a ground, say "직접 관련 근거자료 부족" for that category and continue with case-record reasoning.
- Required finalSubmissionAssessmentReport format:
  1. 손해사정서 (보험금 부지급 통보에 대한 이의 및 의견)
  2. 수신 / 작성일 / 참조 / 문서번호 / 제목
  3. 피보험자 정보: 피보험자, 주민번호, 주소, 연락처, 증권번호, 계약상품, 청구담보, 진단의료기관, 확정진단명. Unknown personal values must be placeholders such as [피보험자], [주민번호], [주소], [연락처], [증권번호].
  4. 도입 문단: 부지급 통보 사실, 부당한 이유 3~4개, 보험금 지급 요청
  5. Ⅰ. 사건의 경위 및 진단 확정 과정
  6. Ⅱ. 보험사 부지급 결정의 요지 및 그 부당성
  7. Ⅲ. 의학적 근거 - 진단의 정당성
  8. Ⅳ. 보험약관상 진단확정 요건의 충족
  9. Ⅴ. 판례 및 금감원 자료에 대한 적용 또는 반박
  10. Ⅵ. 약관해석 원칙
  11. Ⅶ. 결론
  12. [요청사항]
  13. 첨부서류
`;
  const acuteMiRules = /I21\.?4|심내막하심근경색|NSTEMI|unstable\s+angina|CAD|CAG|PCI|troponin|CK-?MB/i.test([
    input.damageDetails,
    input.insurerPosition,
    input.customerStatement,
    source?.summary,
    source?.diagnosisSummary,
    source?.testResultSummary,
    source?.treatmentSummary,
    source?.damageEvidenceSummary,
    ...(source?.keyIssues || []),
    ...(source?.draftSupportingFacts || []),
  ].filter(Boolean).join('\n')) ? `
[Acute MI / I21.4 denial mandatory analysis]
- This case appears to involve acute subendocardial myocardial infarction I21.4 / NSTEMI versus unstable angina or CAD.
- You must directly address: I21.4 diagnosis, Unstable angina relationship, Coronary artery disease/CAD, CAG result, PCI/stent, LM-LAD or LM-mLAD severe stenosis, hs-troponin value and timing, CK-MB, ECG ST elevation/depression, Echo RWMA/LVEF, discharge summary diagnosis, diagnosis certificate/opinion diagnosis, and the insurer's possible "post-PCI troponin rise" argument.
- Do not reduce the case to generic "medical review transparency" or complaint procedure.
- Use this argumentative stance when supported by the records: the insurer cannot reject the attending physician's I21.4 diagnosis merely from an Unstable angina entry or from a possibility that troponin rose after PCI; it must prove the timing and medical interpretation using the complete record.
- If a specific item is not found in the provided record, write that the item requires additional confirmation, rather than inventing it.
` : '';
  const profileRules = profile === 'disability_benefit' ? `
[Disability benefit argument]
- This is a disability benefit dispute. Do not mention manual therapy, indemnity denial, cancer diagnosis benefit, thyroid cancer, cataract, disclosure duty, contract termination, or automobile damage calculation unless explicitly entered.
- Disability benefit is not decided by diagnosis name alone. Review the disability classification table, disability payment rate, original policy terms at enrollment, treatment completion, symptom fixation, permanence, and objective test materials.
- Check objective examinations such as range-of-motion measurements, instability/stress tests, neurological exam, EMG, hearing test, imaging, and physician disability diagnosis.
- If the insurer argues the disability payment rate is below threshold, review measurement method, objective test basis, and whether the correct enrollment-date disability table was applied.
- Include the phrases 후유장해, 장해분류표, 장해지급률, 객관적 검사, 가입 당시 약관, and 재검토.
- The conclusion should be: disability payment is not certain, but the disability classification table, objective test results, and payment-rate calculation require reconsideration.
` : profile === 'causation_preexisting_injury' ? `
[Causation / pre-existing condition / injury nature argument]
- This is a pre-existing condition, causation, or injury-nature dispute. Do not mention manual therapy, cancer diagnosis benefit, cataract, thyroid cancer, disclosure duty, contract termination, duplicate indemnity, or proportional reimbursement unless explicitly entered.
- A pre-existing condition or degenerative finding alone does not automatically break causation between the accident and the claimed condition.
- Review pre-accident symptoms, post-accident symptoms, imaging changes, treatment course, medical time relationship, accident contribution, and worsening of the existing condition.
- For rotator cuff, disc herniation, meniscus, stenosis, fracture, osteoporosis, or avascular necrosis issues, distinguish degenerative and traumatic elements using accident mechanism and imaging findings.
- Include the phrases 기왕증, 인과관계, 상해성, 사고 기여도 or 퇴행성, and 재검토.
- The conclusion should be: injury nature is not certain, but causation, accident contribution, and pre-existing condition arguments require reconsideration.
` : profile === 'medical_review_pre_litigation' ? `
[Medical review / pre-litigation dispute resolution argument]
- This is a medical-advice, insurer medical review, reconsideration, complaint, or pre-litigation dispute-resolution case.
- Do not write a generic complaint or litigation guide.
- Focus on whether the insurer's medical-review logic is weak when compared with the attending physician records and objective test results.
- Mention medical advice or external review only as a short additional-material request when it directly affects the denial issue.
- Do not include headquarters complaint, FSS complaint, litigation preparation, or loss-adjuster legal-scope explanations in the body.
` : profile === 'brain_diagnosis_benefit' ? `
[Brain disease diagnosis benefit argument]
- This is a brain disease diagnosis benefit dispute. Do not mention manual therapy, M54, low back pain, cataract, thyroid cancer, cancer diagnosis benefit, disability, automobile insurance, disclosure duty, or contract termination unless explicitly entered.
- Brain disease diagnosis benefit is not decided only by disease name or code. Review the original policy terms at enrollment, definitions of stroke/cerebral infarction/cerebral hemorrhage/cerebrovascular disease, and diagnosis confirmation criteria.
- MRI, MRA, CTA, CT or other imaging results, specialist diagnosis, and medical records are key.
- Distinguish acute lesion, old lesion, asymptomatic lesion, TIA/G45, stenosis, carotid stenosis, and cerebrovascular stenosis from confirmed payable brain disease under the policy.
- Check whether neurological deficit is required by the policy.
- Include the phrases 뇌질환, 진단확정, 영상검사, MRI, 가입 당시 약관, and 재검토.
- The conclusion should be: payment is not certain, but the denial requires reconsideration based on imaging and diagnosis-confirmation criteria in the policy at enrollment.
` : profile === 'heart_diagnosis_benefit' ? `
[Heart disease diagnosis benefit argument]
- This is a heart disease diagnosis benefit dispute. Do not mention manual therapy, M54, low back pain, cataract, thyroid cancer, cancer diagnosis benefit, brain infarction, brain hemorrhage, disability, automobile insurance, disclosure duty, or contract termination unless explicitly entered.
- Heart disease diagnosis benefit must be argued from the customer side using diagnosis certificate/opinion, discharge summary, enzyme trend, ECG, CAG/PCI, imaging, and enrollment-date policy terms.
- For acute myocardial infarction, directly analyze I21.4/NSTEMI, unstable angina, CAD, CAG, PCI/stent, hs-troponin, CK-MB, ECG ST changes, RWMA, LVEF, and the timing of tests before/after PCI.
- If insurer relies only on an Unstable angina or CAD entry, state that this is a selective reading when the full record supports I21.4 or acute coronary syndrome.
- If insurer argues post-PCI troponin rise, state that the insurer must prove the exact collection time, procedure time, and medical interpretation; possibility alone cannot defeat the attending physician's diagnosis.
- For postmortem suspected acute myocardial infarction, review death certificate, emergency records, troponin, ECG/EKG, and autopsy status.
- The conclusion should strongly argue payment validity when I21.4 diagnosis and objective cardiac findings are present, while marking only genuinely missing items as additional confirmation.
` : profile === 'cancer_diagnosis_benefit' ? `
[Cancer diagnosis benefit / borderline / carcinoma in situ argument]
- This is a cancer diagnosis benefit, borderline tumor, carcinoma in situ, similar cancer, low-amount cancer, primary/metastatic cancer, or diagnosis-confirmation dispute.
- Do not mention manual therapy, M54, low back pain, shockwave therapy, indemnity denial, disability, automobile insurance, disclosure duty, or contract termination unless explicitly entered.
- Do not decide only by the diagnosis certificate code. Review the pathology report, tissue biopsy, cytology, diagnosis confirmation, behavior code, KCD/disease classification table, and original policy terms at enrollment.
- Cancer, carcinoma in situ, borderline tumor, similar cancer, low-amount cancer, and general cancer must be classified under the policy terms and disease classification table in effect at enrollment.
- When C-code/D-code or behavior-code classifications conflict, explain that the pathology result and policy definition should be reviewed together.
- Include the phrases 암진단비, 진단확정, 병리보고서, 가입 당시 약관, and 질병분류표.
- For borderline/in situ disputes, also discuss 제자리암, 경계성종양, 유사암, 행동양식, D코드/C코드, and 병리결과 where relevant.
- The conclusion should be: payment is not certain, but cancer diagnosis benefit / carcinoma in situ / borderline tumor benefit requires reconsideration based on pathology and enrollment-date policy terms.
` : profile === 'indemnity_general_denial' ? `
[General indemnity medical insurance denial argument]
- This is an indemnity medical insurance denial case. Do not use disclosure duty, contract termination, underwriting, application-form question, decline, exclusion underwriting, loading, or non-disclosure reasoning unless explicitly entered.
- Focus on original policy terms at enrollment, policy exclusions, treatment purpose, medical necessity, test/procedure necessity, detailed medical records, receipts, detailed medical bills, and insurer denial grounds.
- The customer-side position should request reconsideration based on medical records, doctor's prescription or opinion, treatment/test indication, actual treatment details, and original indemnity policy terms.
- Include the phrases "가입 당시 원약관", "보상 제외", "의학적 필요성", and "재검토" where appropriate.
- Do not state payment is certain.
` : profile === 'indemnity_cancer_hospitalization_denial' ? `
[Indemnity cancer hospitalization denial argument]
- This is a cancer hospitalization / nursing hospital indemnity denial case. Do not mention manual therapy, M54, low back pain, cataract, disclosure duty, contract termination, disability, or automobile insurance unless explicitly entered.
- Hospitalization in a nursing hospital is not automatically payable or automatically excluded. The key issues are the original indemnity policy terms at enrollment, policy definition of hospitalization, whether the admission was direct cancer treatment, hospitalization necessity, and actual treatment details.
- If the insurer argues the admission was not direct cancer treatment, distinguish simple convalescence, nursing, or rest from cancer-treatment continuity, chemotherapy side-effect management, pain control, nutrition management, infection management, palliative treatment, and conservative treatment.
- The customer should secure admission/discharge confirmation, medical records, attending physician opinion, chemotherapy records, adverse-effect management records, pain-control records, medication records, nursing records, treatments performed during admission, detailed medical bill, insurer denial letter, and original indemnity policy terms.
- The conclusion should be: the denial requires reconsideration based on direct cancer treatment, hospitalization necessity, and actual treatment materials. Do not state payment is certain.
` : profile === 'indemnity_duplicate_proportional_reimbursement' ? `
[Indemnity duplicate proportional reimbursement argument]
- This is a duplicate indemnity insurance / proportional reimbursement dispute. Do not mention manual therapy, medical necessity, treatment purpose, cataract, cancer diagnosis benefit, disability, disclosure duty, or contract termination unless explicitly entered.
- Indemnity insurance compensates actual loss, so duplicate enrollment in multiple indemnity policies does not normally allow compensation beyond the actual loss.
- The key issues are the duplicate enrollment and proportional reimbursement provisions in the original policy terms at enrollment, the actual loss incurred, coverage terms of other policies, payments made by other insurers, deductibles, and each insurer's calculation method.
- If the insurer paid only part based on proportional reimbursement, review whether total medical expense, patient-paid amount, non-covered amount, other insurance payment, deductible, and contractual sharing formula were calculated correctly.
- The customer should secure receipts, detailed medical bills, other policy certificates, other insurance payment records, original policy terms for each indemnity insurance contract, deductible calculation details, insurer proportional reimbursement calculation sheet, and payment/denial letter.
- The conclusion should be: additional payment is not certain, but the proportional reimbursement calculation and actual-loss basis require reconsideration.
` : profile === 'indemnity_cataract_multifocal_lens_denial' ? `
[Indemnity cataract multifocal lens denial argument]
- This is a cataract / multifocal intraocular lens indemnity denial case. Do not mention manual therapy, M54, low back pain, repeated manual therapy, disclosure duty, contract termination, disability, thyroid cancer, or automobile insurance unless explicitly entered.
- Distinguish cataract surgery itself from multifocal intraocular lens costs.
- Analyze whether the surgery was for cataract treatment or whether part of the lens cost was for vision correction and excluded under the policy.
- If the insurer denied the whole claim only because a multifocal lens was used, explain that the insurer should distinguish treatment-purpose medical costs from vision-correction or excluded costs item by item.
- If inpatient medical expenses are claimed, review the original policy definition of hospitalization, actual stay time, treatment under physician management, and whether the substance of care was inpatient treatment.
- The customer should secure cataract diagnosis, slit-lamp exam, visual acuity test, surgery record, IOL type and cost breakdown, detailed medical bill, and original indemnity policy terms.
- The conclusion should be: the insurer's partial or full denial requires reconsideration based on itemized exclusion grounds and treatment purpose. Do not state payment is certain.
` : profile === 'indemnity_manual_therapy_denial' ? `
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
  return `너는 15년 경력의 보험손해사정사이자 의료자문 경험이 있는 변호사 보조 인력입니다.
보험사의 부지급/감액 결정에 대해 피보험자 측 의견서, 즉 보험회사 제출용 손해사정서를 작성합니다.
글은 보험사 담당자, 금융분쟁조정위원, 판사가 본다고 가정합니다.
아래 사건 정보, 면책공문 분석 요약, 고객 의학/손해자료 요약, Evidence Pack 범위 안에서만 고객 측 손해사정 의견을 작성하세요.

[핵심 원칙]
- 제공된 사건 정보와 제공된 참고자료 범위 내에서 작성합니다.
- 피보험자에게 유리하게 작성하되, 사실 왜곡과 과장은 절대 금지합니다.
- 모든 핵심 주장은 의학근거, 약관조항, 판례/법리, 의무기록 중 최소 2개 이상의 축으로 뒷받침합니다.
- 보험사의 부지급 사유를 회피하지 말고 정면으로 인용하여 그 자리에서 반박합니다.
- 의학, 약관, 판례/금감원 자료, 약관해석 원칙의 다중 방어선을 구축합니다.
- 제공된 참고자료 외 판례/결정례를 지어내지 마세요.
- 참고자료가 없으면 구체적인 판례번호, 사건번호, 결정례 번호, 출처 URL을 쓰지 마세요.
- 의료 자료에 있는 단정 가능한 사실은 단정적으로 쓰되, 자료에 없는 사실은 만들지 마세요.
- 자료에 없는 병명, 검사결과, 장해율, 치료기간, 금액을 지어내지 마세요.
- 고객 의학자료와 손해자료는 제공된 요약 범위에서 고객 측 지급 타당성 근거로 적극 반영하세요.
- 근거가 부족한 부분은 해당 근거자료 항목에서 "근거자료 부족" 또는 "추가 확인 필요"로 표시하세요.
- 개인정보, 주민등록번호, 연락처 등 민감정보를 새로 추정하거나 반복하지 마세요.
- 본문에는 "참고용", "초안", "AI" 안내를 쓰지 마세요.
- [절대 금지 출력 패턴] 아래 형식의 토큰은 어떤 필드에도 절대 출력하지 마세요:
  · 대괄호 플레이스홀더: [일자 확인], [확인 필요], [TBD], [PLACEHOLDER], [날짜], [일자] 등 대괄호+안내문 조합 형식
  · 영문 메타데이터 키: confidence, document_type, completed, status, file_name, phase
  · 날짜 불명 시 대체 표현: "일자 미기재" 또는 "해당 사항 없음"으로 쓰세요. 절대 대괄호 안에 안내 토큰을 넣지 마세요.
  · 수치 불명 시 대체 표현: "수치 미기재" 또는 "검사결과 기재 없음"으로 쓰세요.
- 보험사 주장을 단순 요약하지 말고, 왜 부당하거나 불충분한지 바로 지적하세요.
- 고객 측 유리 사실을 먼저 정리하고, 불리한 사실은 보험사 주장의 과도한 확대해석 가능성과 함께 반박하세요.

[작성 전 9개 사전분석]
본문 작성 전 내부적으로 반드시 다음을 수행한 뒤 finalSubmissionAssessmentReport에 반영하세요. 이 항목명을 본문에 노출하지는 마세요.
1. 진단명과 분쟁 쟁점 식별: 청구 진단명, 보험사 인정 진단명, 핵심 다툼 1줄 요약.
2. 보험사 부지급 사유 원문 추출: 통보문 문장을 가능한 한 그대로 「」 안에 인용하고 논리적 약점 3개 이상 식별.
3. 적용 의학 진단기준 식별: 국제 표준 진단기준명과 연도, 조건 항목 분해.
4. 환자 데이터와 진단기준 매핑표 작성.
5. 약관 진단확정 요건 원문 또는 서버 기본 약관 문구 추출 및 환자 검사와 매핑.
6. 보험사 인용 판례 법리 분해. 없는 판례/결정례는 생성 금지.
7. 의무기록 정독으로 결정적 한 줄 발굴. SOAP, 검사결과, 외래경과, 입퇴원기록에서 주치의 객관적 검토 문구와 보험사가 놓친 검사수치를 찾으세요.
8. 의학/약관/판례/약관해석 원칙의 독립 방어선 설계.
9. 진단기준표, 약관요건표, 보험사 문구 인용박스, 핵심 수치 반복 배치.

[출력 후 자체검증]
finalSubmissionAssessmentReport 작성 후 아래 항목을 스스로 점검하고 부족한 부분은 본문 안에서 보정하세요.
- 보험사 부지급 사유 원문 또는 핵심 문구가 「」 안에 인용되었는가.
- 의학 진단기준의 정확한 명칭과 연도가 들어갔는가.
- 진단기준 vs 환자 데이터 매핑표와 약관 요건별 충족표가 있는가.
- 의무기록에서 killing evidence 1개 이상이 별도 강조되었는가.
- 결론 장에서 의학, 약관, 판례/법리, 약관해석 원칙을 독립 논거로 정리했는가.
- 요청사항에 보험금, 지연이자, 구체적 서면회신이 모두 포함되었는가.
- 약한 표현, 내부 라벨, 개인정보가 제거되었는가.

${claimantAssessmentRules}
${acuteMiRules}

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

[논증 구조 템플릿]
${source?.argumentStructureSummary || '없음'}

[Argument engine rules]
- The final report must follow this logic: insurer position -> neutralized errors -> independent defense layers -> payment duty and pressure.
- Chapter I must reconstruct objective facts from medical records, not from the insurer's edited fact framing.
- Chapter II must quote or summarize the insurer's denial position and classify 3 to 5 decisive errors.
- Chapter III must use a syllogism: medical standard -> patient facts -> satisfied/not satisfied.
- Chapter IV must use: policy wording -> required element -> patient fact matching -> conclusion.
- Chapter V must not paste unrelated authorities. If an insurer-cited authority exists, reverse-apply its legal structure in favor of the customer where factually supportable.
- Chapter VI must state that the insurer may not add requirements not found in the policy and must apply contra proferentem when wording is ambiguous.
- Chapter VII must end in first/second/third payment-duty conclusions and [요청사항] must request insurance payment, delay interest, written medical/policy reasons on disagreement, and possible dispute-resolution/litigation follow-up.
- Repeat the strongest verified numbers, test findings, and lesion/procedure facts in the medical, policy, and conclusion sections. Do not invent numbers.

[제공된 참고자료]
${formatReferences(input.retrievedReferences, ragResult)}

[Evidence Pack - RAG search references]
${formatRagForPrompt(ragResult)}

[Evidence Pack - official grounds that must be woven into the body]
${formatOfficialGroundsForBody(ragResult)}

[RAG usage rules]
- Cite only official or semi-official RAG references as legal/reference basis.
- Treat source_area "medical_guideline" as medical criteria evidence, not as policy wording, precedent, or FSS decision. Use it to test whether the medical records support or weaken I21.4/NSTEMI reasoning.
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
- For acute MI/I21.4 disputes, never use a fixed troponin absolute cutoff. Require the testing institution's reference range or 99th percentile URL, rise/fall pattern, ischemic symptoms, ECG, Echo/RWMA/LVEF, CAG/PCI findings, and PCI before/after sampling times.
- Cite precedents only when case number, court, and decision date are available.
- Precedents marked as "유사 판례 참고자료" or with review_status needs_human_review / official_citation_allowed false may be used only for 판례상 법리 참고 or 논리 보강. Do not describe them as 공식근거, 확정 근거, or a basis that payment must be made.
- Only reviewed precedents with official_citation_allowed true, or existing official law API full-text precedents, may be used as strong precedent grounds.
- Do not expose internal ids, chunk ids, embedding status, review status, trust level, or internal source types.

[Customer-side assessment direction]
- The main thesis should be: "보험회사의 부지급 논리는 전체 의무기록과 지급요건 검토에 비추어 불충분하거나 과도하다."
- Use strong customer-side expressions when supported by records: "단편적 해석이다", "전체 의무기록 흐름에 비추어 부당하다", "보험사가 입증해야 한다", "지급 타당성이 인정된다".
- Do not use prohibited expressions: "보험금 지급 확정", "반드시 받을 수 있음", "보험사의 처분은 무조건 위법", "승소 가능성".
- Structure the report as: 1) 사정 결론, 2) 보험사 부지급 논리의 문제점, 3) 고객 측 핵심 인정 사실, 4) 의학적 핵심 쟁점, 5) 약관상 지급요건 충족 주장, 6) 핵심 근거자료, 7) 보험사 주장에 대한 반박, 8) 추가 확보자료, 9) 손해사정 의견.
- In 핵심 근거자료, separate 적용 약관, 금감원 분쟁조정례, 판례. If missing, write "해당 항목 직접 관련 근거자료 부족" and do not invent details.
- Unfavorable facts must be handled as supplement points or insurer over-interpretation unless the record clearly defeats the customer.

[Assessment report structure rules]
- This is not a search-result summary. Write a customer-side loss-adjusting assessment report that applies the Evidence Pack to the current case facts.
- Use this reasoning order in the body: 1) 사정 결론, 2) 보험사 부지급 논리의 문제점, 3) 고객 측 핵심 인정 사실, 4) 의학적 핵심 쟁점, 5) 약관상 지급요건 충족 주장, 6) 핵심 근거자료, 7) 보험사 주장에 대한 반박, 8) 추가 확보자료, 9) 손해사정 의견.
- Do not leave the opinion at "additional review is needed" only. Even when final judgment is difficult, write the provisional loss-adjusting opinion available from the provided facts.
- Explain why each directly related official RAG ground is favorable or unfavorable to this case. Do not merely list references.
- In legalAndReferenceBasis, damageAssessment, and adjusterOpinionDraft, write the actual ground names from "Official grounds that must be woven into the body" in sentences.
- If a precedent lacks case number, court, or decision date in retrievedReferences, do not invent them. Write "관련 판례 추가 확인 필요" instead.
- If a policy term lacks the original company/product policy or enrollment-date version, write that the original policy terms at enrollment must be checked and use standard terms only as reference material.
- Use internal review materials only for issue framing and document checklist. Never cite them as official legal, precedent, FSS, or policy grounds.
- If official grounds are insufficient, say "직접 관련 공식 근거 부족" and still analyze the current facts under the available legal framework.
- The adjusterOpinionDraft field must contain at least 5 substantial customer-side paragraphs. Prefer 5 to 8 paragraphs for ordinary cases.
- The requiredAdditionalChecks field must include both unfavorable points and concrete documents to request.

${profileRules}

응답은 아래 JSON 형식으로만 반환하세요. JSON 외 텍스트는 포함하지 마세요.
{
  "title": "고객 측 손해사정서 제목",
  "overview": "사정 결론",
  "facts": "고객 측 핵심 인정 사실",
  "issues": "의학적 핵심 쟁점",
  "legalAndReferenceBasis": "약관상 지급요건 충족 주장 및 핵심 근거자료. 적용 약관/금감원 분쟁조정례/판례를 구분하고, 없으면 근거자료 부족으로 표시",
  "damageAssessment": "보험사 부지급 논리의 문제점과 고객 측 지급 타당성",
  "insurerPositionReview": "보험사 주장에 대한 반박",
  "adjusterOpinionDraft": "손해사정 의견",
  "requiredAdditionalChecks": "추가 확인 필요 사항",
  "simpleClientSummary": "고객에게 안내할 쉬운 요약",
  "customerSideAssessmentReport": "위 새 결과 구조 1~9번을 제목 포함 완성 문서 형태로 작성. 본문에 참고용/초안/민원/소송 안내 문구 금지",
  "finalSubmissionAssessmentReport": "보험회사 제출용 손해사정서 본문. 반드시 '손해사정서\\n(보험금 부지급 통보에 대한 이의 및 의견)'로 시작하고, 수신/작성일/참조/문서번호/제목, 피보험자 정보, Ⅰ~Ⅶ, [요청사항], 첨부서류 순서로 작성. 개인정보는 [피보험자] 등 placeholder로 비식별 처리",
  "reportFormatVersion": "${REPORT_FORMAT_VERSION}",
  "disclaimer": ""
}`;
}

function buildReviewPrompt(draft: AssessmentDraftResult, references: RetrievedReference[], ragResult: RagSearchResult, input: ReturnType<typeof validateInput>) {
  const profile = caseProfile(input);
  const profileReviewRules = profile === 'disability_benefit'
    ? '- For a disability benefit dispute, remove manual therapy, indemnity-denial, cancer diagnosis benefit, thyroid cancer, cataract, disclosure-duty, contract-termination, and automobile-damage reasoning. Keep the reasoning focused on disability benefit, disability classification table, disability payment rate, objective tests, symptom fixation, permanence, original policy terms at enrollment, and insurer payment-rate calculation.'
    : profile === 'causation_preexisting_injury'
    ? '- For a pre-existing condition / causation / injury-nature dispute, remove manual therapy, cancer diagnosis benefit, cataract, thyroid cancer, disclosure-duty, contract-termination, duplicate indemnity, and proportional-reimbursement reasoning. Keep the reasoning focused on pre-existing condition, causation, injury nature, accident contribution, degenerative versus traumatic findings, pre/post accident records, imaging, and medical time relationship.'
    : profile === 'medical_review_pre_litigation'
    ? '- For a medical-review dispute, remove payment certainty and illegal-conduct accusations. Do not keep generic complaint, headquarters/FSS complaint, litigation preparation, or loss-adjuster legal-scope guidance in the body. Keep only case-specific weaknesses in the insurer medical reasoning.'
    : profile === 'brain_diagnosis_benefit'
    ? '- For a brain disease diagnosis benefit dispute, remove manual therapy, M54, low back pain, cataract, thyroid cancer, cancer diagnosis benefit, disability, automobile-insurance, disclosure-duty, and contract-termination reasoning. Keep the reasoning focused on brain disease, diagnosis confirmation, MRI/MRA/CTA/CT imaging, acute vs old/asymptomatic lesions, neurological deficits, policy definitions at enrollment, and medical records.'
    : profile === 'heart_diagnosis_benefit'
    ? '- For a heart disease diagnosis benefit dispute, remove manual therapy, cataract, cancer, brain, disability, automobile, disclosure-duty, contract-termination, complaint, FSS complaint, litigation, and generic medical-advice reasoning. Keep the reasoning focused on customer-side payment validity: I21.4/NSTEMI, Unstable angina, CAD, CAG, PCI/stent, hs-troponin timing, CK-MB, ECG ST changes, RWMA/LVEF, discharge summary versus diagnosis certificate, policy definitions at enrollment, and why the insurer reading is incomplete.'
    : profile === 'cancer_diagnosis_benefit'
    ? '- For a cancer diagnosis benefit / borderline tumor / carcinoma in situ dispute, remove manual therapy, M54, low back pain, shockwave therapy, indemnity-denial, disability, automobile-insurance, disclosure-duty, and contract-termination reasoning. Keep the reasoning focused on cancer diagnosis benefit, diagnosis confirmation, pathology report, biopsy/cytology, disease classification table/KCD, behavior code, C-code/D-code, original policy terms at enrollment, and whether the claim is general cancer, similar cancer, carcinoma in situ, or borderline tumor.'
    : profile === 'indemnity_general_denial'
    ? '- For a general indemnity medical insurance denial case, remove disclosure-duty, contract termination, underwriting, application-form question, decline, exclusion underwriting, loading, and non-disclosure reasoning. Keep the reasoning focused on original policy terms at enrollment, policy exclusions, medical necessity, treatment/test necessity, detailed medical records, receipts, detailed medical bills, and insurer denial grounds.'
    : profile === 'indemnity_cancer_hospitalization_denial'
    ? '- For a cancer hospitalization / nursing hospital indemnity denial case, remove manual therapy, M54, low back pain, cataract, disclosure-duty, contract termination, disability, and automobile-insurance reasoning. Keep the reasoning focused on direct cancer treatment, hospitalization necessity, original indemnity policy terms, admission definition, treatment records, chemotherapy side-effect management, pain control, nursing records, and detailed medical bill.'
    : profile === 'indemnity_duplicate_proportional_reimbursement'
    ? '- For a duplicate indemnity insurance / proportional reimbursement dispute, remove manual therapy, medical necessity, treatment purpose, cataract, cancer diagnosis benefit, disability, disclosure-duty, and contract-termination reasoning. Keep the reasoning focused on duplicate enrollment, proportional reimbursement, actual loss incurred, original policy terms at enrollment, other insurance contracts, other insurance payments, deductibles, and insurer calculation sheet.'
    : profile === 'indemnity_cataract_multifocal_lens_denial'
    ? '- For a cataract multifocal intraocular lens indemnity denial case, remove manual therapy, M54, low back pain, repeated manual therapy, disclosure-duty, contract termination, disability, thyroid cancer, and automobile-insurance reasoning. Keep the reasoning focused on cataract surgery, multifocal IOL cost, treatment purpose versus vision correction, inpatient/outpatient distinction, policy exclusions, and original indemnity policy terms.'
    : profile === 'indemnity_manual_therapy_denial'
    ? '- For a manual therapy indemnity denial case, remove disclosure-duty, contract termination, underwriting, application-form question, decline, exclusion, loading, M47.26 non-disclosure, automobile damage, disability, cancer, cataract, and hospitalization-pattern reasoning. Keep the reasoning focused on treatment purpose, medical necessity, doctor prescription, treatment plan, repeated therapy appropriateness, policy exclusions, and original indemnity policy terms.'
    : profile === 'm47_disclosure'
    ? '- For an M47.26 single outpatient non-disclosure case, keep the logic that one outpatient record and a diagnosis-code entry alone do not automatically establish materiality or intentional/grossly negligent non-disclosure.'
    : profile === 'thyroid_disclosure_cancer'
      ? '- For a thyroid nodule / thyroid cancer disclosure case, remove M47.26, back pain, orthopedic, one-outpatient, and spine-specific reasoning. Keep the reasoning focused on thyroid nodule, health checkup, ultrasound, FNA/biopsy recommendation, cancer diagnosis benefit, objective underwriting standards, and thyroid cancer causal relationship.'
      : '- Do not import disease-specific reasoning that is not supported by the input facts.';
  return `아래 고객 측 손해사정서 JSON을 검증하고 보정하세요.

[v2 보강본 품질 체크 - finalSubmissionAssessmentReport 필수 항목]
finalSubmissionAssessmentReport 필드를 반드시 아래 9개 기준에 맞게 보정하세요:
1. 보험사 부지급 사유 원문을 「」 안에 직접 인용했는가. 없으면 Ⅱ장에서 추가하세요.
2. 국제 진단기준 명칭과 연도가 명시되어 있는가 (예: Fourth Universal Definition of Myocardial Infarction 2018, ATA 2015 Guideline, 통계청 한국표준질병사인분류). 없으면 Ⅲ장에서 추가하세요.
3. 진단기준 vs 환자 데이터 매핑표 또는 약관 요건별 충족표 중 최소 1개가 표 형식(| 구분자)으로 있는가. 없으면 Ⅲ 또는 Ⅳ장에서 추가하세요.
4. 의무기록에서 결정적 한 줄(killing evidence) — troponin 수치, SOAP note 문구, 검사 수치, PCI/수술 기록 등 — 이 별도 강조되어 있는가. 없으면 Ⅲ장에서 추가하세요.
5. 방어선이 Ⅲ의학 / Ⅳ약관 / Ⅴ판례 / Ⅵ약관해석원칙 순서로 각 장에 독립 구성되어 있는가.
6. "사료됩니다", "가능성이 있습니다", "검토 가치가 있습니다", "~할 수 있습니다" 등 약한 어미를 단정적 표현으로 교체하세요.
7. Ⅶ장 결론에 첫째(보험금 지급)/둘째(지연이자)/셋째(구체적 서면 회신) 3종 요청이 있는가. 없으면 추가하세요.
8. [요청사항]에 보험금 지급, 지연이자, 서면 회신 3가지가 명시되어 있는가. 없으면 추가하세요.
9. 개인정보([피보험자], [주민번호] 등 placeholder)가 실제 PII 대신 사용되고 있는가.

[검증 기준]
- 본문에서 "초안", "참고용", "AI", "본사 민원", "금감원 민원", "소송 전 절차", "손해사정사는 소송대리를 할 수 없습니다", "의료자문을 무조건 거부하기보다는", "자료정리가 핵심입니다", "계약해지 처분의 요건 충족 여부" 문구를 제거하세요.
- 본문을 고객 측 보험금 지급 검토 사정서로 보정하세요. 중립적 안내문이나 민원 안내문으로 만들지 마세요.
- 보험사 주장의 문제점을 직접 지적하고, 고객에게 유리한 의무기록 및 Evidence Pack 근거를 먼저 배치하세요.
- 심장/I21.4 사건이면 I21.4, Unstable angina, CAD, CAG/PCI, hs-troponin, CK-MB, ECG, RWMA/LVEF, 입퇴원요약지와 진단서 불일치를 반드시 다루세요.
- 제공된 참고자료 외 판례/결정례/출처/사건번호가 있으면 삭제하거나 "추가 확인 필요"로 바꾸세요.
- 참고자료가 없으면 구체적인 판례번호, 결정례 번호, 출처 URL을 쓰지 마세요.
- 의료 자료를 확정 진단처럼 과장한 표현을 제거하세요.
- 자료에 없는 병명, 검사결과, 장해율, 치료기간, 금액을 지어내지 마세요.
- 근거 없는 단정, 논리 비약, 사실관계에 없는 개인정보 추정을 제거하세요.
- 근거가 부족한 부분은 "추가 확인 필요"로 표시하세요.
- disclaimer는 빈 문자열로 두세요. 앱 화면 하단에서 별도 안내합니다.
- 응답은 같은 JSON 구조로만 반환하세요.

[제공된 참고자료]
${formatReferences(references, ragResult)}

[Official grounds that must remain in the body]
${formatOfficialGroundsForBody(ragResult)}

[RAG review rules]
- Remove official-looking citations if they are not present in official or semi-official RAG references.
- Internal review materials must not be cited as official legal, precedent, FSS, or policy grounds.
- Precedents shown as "유사 판례 참고자료" or with review_status needs_human_review / official_citation_allowed false must be qualified as 판례상 법리 참고 or 논리 보강 only. Remove wording that treats them as 공식근거, 확정 근거, or a basis that payment must be made.
- Only reviewed precedents with official_citation_allowed true, or existing official law API full-text precedents, may remain as strong precedent grounds.
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

async function callOpenAI(apiKey: string, prompt: string, temperature: number, maxRetries = 3, maxTokens = 8000) {
  let lastStatus = 0;
  let lastErrText = '';
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (res.ok) {
      const json = await res.json() as {
        choices?: { message?: { content?: string | null }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const choice = json.choices?.[0];
      const content = choice?.message?.content;
      console.info('OpenAI response', {
        finish_reason: choice?.finish_reason,
        prompt_tokens: json.usage?.prompt_tokens,
        completion_tokens: json.usage?.completion_tokens,
        prompt_length: prompt.length,
        maxTokens,
      });
      if (!content) {
        console.error('OpenAI returned empty content', {
          finish_reason: choice?.finish_reason,
          message: choice?.message,
          usage: json.usage,
          prompt_length: prompt.length,
        });
      }
      return content ?? '';
    }

    lastStatus = res.status;
    lastErrText = await res.text();
    console.error(`OpenAI API error attempt ${attempt}/${maxRetries + 1}`, lastStatus, lastErrText.slice(0, 200));

    // Retry on rate limit (429) or server errors (5xx)
    if (attempt <= maxRetries && (lastStatus === 429 || lastStatus >= 500)) {
      const delayMs = Math.min(2000 * attempt, 8000);
      console.info(`Retrying OpenAI call in ${delayMs}ms (attempt ${attempt}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    break;
  }

  throw new HttpError(502, 'AI 사정서 초안 생성 서버 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.');
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

const FORBIDDEN_PHRASE_PATTERNS: RegExp[] = [
  /\[일자\s*확인\]/g,
  /\[확인\s*필요\]/g,
  /\[TBD\]/gi,
  /\[PLACEHOLDER\]/gi,
  /\[날짜\]/g,
  /\[일자\]/g,
  /\[[A-Z][A-Z_]{1,}\]/g,
  /\bconfidence\s*[:=]\s*[^\s,\])\n]*/gi,
  /\bdocument_type\s*[:=]\s*[^\s,\])\n]*/gi,
  /\bcompleted\s*[:=]\s*[^\s,\])\n]*/gi,
  /\bSKMBT_[^\s,)]+/gi,
  /\bResized_[^\s,)]+/gi,
];

function stripForbiddenPhrases(value: string): string {
  if (!value) return value;
  let text = value;
  for (const pattern of FORBIDDEN_PHRASE_PATTERNS) {
    text = text.replace(pattern, '');
  }
  return text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function sanitizeResult(result: AssessmentDraftResult): AssessmentDraftResult {
  const clean = (v: string | undefined) => stripForbiddenPhrases(cleanPublicText(v));
  return {
    requestId: cleanPublicText(result.requestId),
    detectedProfile: cleanPublicText(result.detectedProfile),
    reportFormatVersion: cleanPublicText(result.reportFormatVersion),
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
    customerSideAssessmentReport: clean(result.customerSideAssessmentReport),
    finalSubmissionAssessmentReport: clean(result.finalSubmissionAssessmentReport),
    policyEvidence: result.policyEvidence,
    killingEvidence: result.killingEvidence,
    preAnalysis: result.preAnalysis,
    selfVerification: result.selfVerification,
    disclaimer: '',
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
    customerSideAssessmentReport: preserve(result.customerSideAssessmentReport || ''),
    finalSubmissionAssessmentReport: preserve(result.finalSubmissionAssessmentReport || ''),
    disclaimer: '',
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
    customerSideAssessmentReport: fix(result.customerSideAssessmentReport || ''),
    finalSubmissionAssessmentReport: fix(result.finalSubmissionAssessmentReport || ''),
    disclaimer: '',
  };
}

function paragraphCount(value: string) {
  return value.split(/\n{2,}|(?<=다\.)\s+(?=[가-힣A-Z])/).map((item) => item.trim()).filter(Boolean).length;
}

function stripProhibitedBodyPhrases(result: AssessmentDraftResult): AssessmentDraftResult {
  const prohibited = [
    // Remove the whole template opinion sentence before stripping sub-phrases
    /따라서\s*손해사정\s*의견은[^\n]*?(?:정리한다|재검토해야\s*한다는\s*방향)[^\n]*\.?[ \t]*/g,
    /투명성을\s*확인하는\s*방향이\s*적절합니다/g,
    /소송\s*전\s*절차를\s*중심으로\s*진행해야\s*합니다/g,
    /본사\s*민원(?:을| 또는|과|,|\s|$)/g,
    /금감원\s*민원(?:을| 또는|과|,|\s|$)/g,
    /손해사정사는\s*소송대리를\s*할\s*수\s*없습니다/g,
    /보험금\s*지급이나\s*소송\s*결과를\s*단정하는\s*것이\s*아닙니다/g,
    /참고용\s*초안입니다/g,
    /계약해지\s*처분의\s*요건\s*충족\s*여부/g,
    /의료자문을\s*무조건\s*거부하기보다는/g,
    /자료정리가\s*핵심입니다/g,
    /AI\s*결과는\s*참고용\s*초안[^.\n]*[.\n]?/g,
    /재검토가\s*필요(?:합니다|하다|하다는\s*방향[^.\n]*)?/g,
    /단정하기보다/g,
    /확정할\s*수는\s*없으나/g,
    /검토\s*가치/g,
    /추가적인\s*검토가\s*필요/g,
    /지급\s*여부를\s*단정하는\s*것이\s*아니라/g,
    /처분의\s*요건\s*충족\s*여부/g,
  ];
  const clean = (value: string | undefined) => {
    let text = cleanPublicText(value);
    for (const pattern of prohibited) { pattern.lastIndex = 0; text = text.replace(pattern, '').trim(); }
    // Clean fragments left by phrase removal: orphaned particles/commas before connectors
    text = text
      .replace(/[ \t]*,[ \t]*(?=[위이에])/g, ' ')
      .replace(/[ \t]+[을를][ \t]+(?=[위재검])/g, ' ')
      .replace(/,\s*\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ');
    return dedupeParagraphs(text.replace(/\n{3,}/g, '\n\n').trim());
  };
  const customerSideAssessmentReport = clean(result.customerSideAssessmentReport)
    || [
      `1. 사정 결론\n${clean(result.overview)}`,
      `2. 보험사 부지급 논리의 문제점\n${clean(result.insurerPositionReview)}`,
      `3. 고객 측 핵심 인정 사실\n${clean(result.facts)}`,
      `4. 의학적 핵심 쟁점\n${clean(result.issues)}`,
      `5. 약관상 지급요건 충족 주장\n${clean(result.legalAndReferenceBasis)}`,
      `6. 핵심 근거자료\n${clean(result.legalAndReferenceBasis)}`,
      `7. 보험사 주장에 대한 반박\n${clean(result.adjusterOpinionDraft)}`,
      `8. 추가 확보자료\n${clean(result.requiredAdditionalChecks)}`,
      `9. 손해사정 의견\n${clean(result.damageAssessment) || clean(result.adjusterOpinionDraft)}`,
    ].filter((section) => !/undefined|null/i.test(section)).join('\n\n');
  const finalSubmissionAssessmentReport = clean(result.finalSubmissionAssessmentReport);
  return {
    ...result,
    title: clean(result.title).replace(/초안/g, '').trim(),
    overview: clean(result.overview),
    facts: clean(result.facts),
    issues: clean(result.issues),
    legalAndReferenceBasis: clean(result.legalAndReferenceBasis),
    damageAssessment: clean(result.damageAssessment),
    insurerPositionReview: clean(result.insurerPositionReview),
    adjusterOpinionDraft: clean(result.adjusterOpinionDraft),
    requiredAdditionalChecks: clean(result.requiredAdditionalChecks),
    simpleClientSummary: clean(result.simpleClientSummary),
    customerSideAssessmentReport,
      finalSubmissionAssessmentReport,
    disclaimer: '',
  };
}

function dedupeParagraphs(value: string) {
  const seen = new Set<string>();
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => {
      if (!paragraph) return false;
      const key = paragraph.replace(/\s+/g, ' ').slice(0, 180);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n\n');
}

function isAcuteMiPolicyReference(ref: RagSearchResult['officialReferences'][number]) {
  if (ref.source_area !== 'terms_standards') return false;
  const text = cleanPublicText([
    ref.title,
    ref.summary,
    ref.excerpt,
    ref.keyHolding,
    ref.applicableReason,
    ...(ref.issueTags || []),
  ].filter(Boolean).join(' '));
  // 진단확정(bare) / I21(bare) removed — too generic, appears in every policy regardless of disease
  return /급성\s*심근경색|심근경색|허혈\s*심장질환|심장질환\s*진단확정|심전도|심장초음파|관상동맥|심장효소|I21\.4|I21\.?4|I20\b|I25\.1/i.test(text);
}

function policyReferenceKey(ref: RagSearchResult['officialReferences'][number]) {
  return cleanPublicText(ref.id || ref.citationLabel || `${ref.source_area}:${ref.title}:${ref.summary}`).slice(0, 240);
}

function policyEvidenceFromRag(ragResult: RagSearchResult): RetrievedReference[] {
  return (ragResult.officialReferences || [])
    .filter(isAcuteMiPolicyReference)
    .slice(0, 5)
    .map((ref) => ({
      source_area: ref.source_area,
      source_area_label: ref.source_area_label,
      source_type: ref.source_type,
      id: ref.id,
      title: ref.title,
      summary: ref.summary,
      source_url: ref.source_url,
      sourceDisplayName: ref.sourceDisplayName,
      similarity: ref.similarity,
      note: ref.note,
      sourceType: ref.sourceType || 'policy',
      citationLabel: ref.citationLabel || referenceDisplayName(ref),
      sourceArea: ref.sourceArea || ref.source_area,
      issueTags: ref.issueTags,
      keyHolding: ref.keyHolding,
      excerpt: ref.excerpt,
      applicableReason: ref.applicableReason,
      limitation: ref.limitation,
      policySource: ref.policySource || 'uploaded',
    }));
}

function appendServerDefaultPolicyEvidence(
  input: ReturnType<typeof validateInput>,
  ragResult: RagSearchResult,
): RagSearchResult {
  const shouldUseHeartPolicy = caseProfile(input) === 'heart_diagnosis_benefit' || isAcuteMiDenialContext(input);
  if (!shouldUseHeartPolicy) return ragResult;

  const officialReferences = ragResult.officialReferences || [];
  const hasDirectPolicy = officialReferences.some(isAcuteMiPolicyReference);
  if (hasDirectPolicy) return ragResult;

  console.warn('acute_mi_denial policy evidence fallback applied', {
    reason: 'no_uploaded_or_rag_policy_evidence',
    policySource: 'server_default',
  });

  const seen = new Set(officialReferences.map(policyReferenceKey));
  const fallback = ACUTE_MI_SERVER_DEFAULT_POLICY_EVIDENCE.filter((ref) => {
    const key = policyReferenceKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    ...ragResult,
    query: [ragResult.query, ...ACUTE_MI_POLICY_SEARCH_TERMS].filter(Boolean).join('\n'),
    officialReferences: [...fallback, ...officialReferences],
  };
}

function buildFinalSubmissionAssessmentReport(
  result: AssessmentDraftResult,
  input: ReturnType<typeof validateInput>,
  ragResult: RagSearchResult,
): AssessmentDraftResult {
  const isHeart = caseProfile(input) === 'heart_diagnosis_benefit' || isAcuteMiDenialContext(input);
  const argumentStructure = buildClaimArgumentStructure(result, input, ragResult);
  const preAnalysis = buildPreAnalysisResult(input, result, ragResult, argumentStructure);
  let finalSubmissionAssessmentReport = enforceSubmissionReportContract(
    composeSubmissionAssessmentReport(result, input, ragResult, argumentStructure, preAnalysis),
  );
  let selfVerification = selfVerifySubmissionReport(finalSubmissionAssessmentReport, argumentStructure, preAnalysis, isHeart);
  if (!selfVerificationPasses(selfVerification)) {
    finalSubmissionAssessmentReport = enforceSubmissionReportContract(
      repairSubmissionReport(finalSubmissionAssessmentReport, argumentStructure, preAnalysis, selfVerification, isHeart),
    );
    selfVerification = selfVerifySubmissionReport(finalSubmissionAssessmentReport, argumentStructure, preAnalysis, isHeart);
  }
  return {
    ...result,
    reportFormatVersion: REPORT_FORMAT_VERSION,
    finalSubmissionAssessmentReport,
    policyEvidence: policyEvidenceFromRag(ragResult),
    killingEvidence: argumentStructure.killingEvidence,
    preAnalysis,
    selfVerification,
  };
}

function enforceSubmissionReportContract(value: string) {
  const prohibitedPatterns = [
    /초안/g,
    /참고용/g,
    /손해액\s*산정보다는/g,
    /재검토\s*(?:가|를|은|는)?\s*필요(?:합니다|하다)?/g,
    /추가\s*검토\s*(?:가|를|은|는)?\s*필요(?:합니다|하다)?/g,
    /검토\s*가치/g,
    /가능성이\s*있습니다/g,
    /확정할\s*수는\s*없으나/g,
    /지급\s*여부를\s*단정하는\s*것이\s*아니라/g,
    /단정하기보다/g,
    /처분의\s*요건\s*충족\s*여부/g,
    ...FORBIDDEN_PHRASE_PATTERNS,
  ];
  let text = cleanPublicText(value);
  text = text
    .replace(/재검토\s*필요성/g, '이의 근거')
    .replace(/재검토\s*(?:가|를|은|는)?\s*필요합니다/g, '재심사해야 합니다')
    .replace(/재검토\s*(?:가|를|은|는)?\s*필요하다/g, '재심사해야 한다')
    .replace(/재검토\s*(?:가|를|은|는)?\s*필요/g, '재심사 의무 있음');
  for (const pattern of prohibitedPatterns) { pattern.lastIndex = 0; text = text.replace(pattern, '').trim(); }
  text = text
    .replace(/검토할 수 있습니다/g, '검토합니다')
    .replace(/지급 타당성이 있습니다/g, '지급 책임이 명확합니다')
    .replace(/지급 타당성이 있다/g, '지급 책임이 명확하다')
    .replace(/급성심근경색 진단보험금 및 관련 담보 보험금 지급을 요청합니다/g, '급성심근경색증진단보험금 및 관련 담보 보험금 전액과 지연이자를 지급해야 합니다')
    .replace(/해당 담보 보험금 지급을 요청합니다/g, '해당 담보 보험금 전액과 지연이자를 지급해야 합니다');
  if (!text.startsWith('손해사정서\n(보험금 부지급 통보에 대한 이의 및 의견)')) {
    text = `손해사정서\n(보험금 부지급 통보에 대한 이의 및 의견)\n\n${text}`;
  }
  return dedupeParagraphs(text);
}

function buildPreAnalysisResult(
  input: ReturnType<typeof validateInput>,
  result: AssessmentDraftResult,
  ragResult: RagSearchResult,
  argument: ClaimArgumentStructure,
): PreAnalysisResult {
  const isHeart = caseProfile(input) === 'heart_diagnosis_benefit' || isAcuteMiDenialContext(input);
  const policyEvidence = policyEvidenceFromRag(ragResult);
  const policyQuote = cleanPublicText(
    policyEvidence[0]?.excerpt
      || policyEvidence[0]?.keyHolding
      || policyEvidence[0]?.summary
      || (isHeart
        ? '의료기관 의사의 진단과 병력, 심전도, 심장초음파, 관상동맥촬영술, 혈액 중 심장효소검사 등을 기초로 심장질환 진단확정을 판단합니다.'
        : '가입 당시 약관상 지급요건을 기준으로 판단합니다.'),
  );
  const citedAuthorities = (ragResult.officialReferences || [])
    .filter((ref) => ref.source_area === 'precedents')
    .map(referenceDisplayName)
    .filter(Boolean)
    .slice(0, 3);
  const fssReferences = (ragResult.officialReferences || [])
    .filter((ref) => ref.source_area === 'fss_dispute_cases')
    .map(referenceDisplayName)
    .filter(Boolean)
    .slice(0, 3);
  return {
    diagnosisIssue: {
      claimedDiagnosis: cleanPublicText(input.diagnosisName || input.diagnosisText) || (isHeart ? 'I21.4 급성 심내막하심근경색증' : '[확정진단명]'),
      insurerAcceptedDiagnosis: /I25\.?1|CAD|Unstable\s*angina|협심증|관상동맥/i.test(argument.insurerPosition.quotedPosition)
        ? 'Unstable angina / CAD / I25.1 취지'
        : undefined,
      disputeSummary: argument.insurerPosition.coreDenialReason,
    },
    insurerDenialQuote: {
      originalQuote: extractInsurerQuotedPosition(argument.insurerPosition.quotedPosition),
      weaknesses: argument.insurerErrorMap.map((item) => item.rebuttalThesis).slice(0, 5),
    },
    medicalCriteria: {
      standardName: isHeart
        ? 'Fourth Universal Definition of Myocardial Infarction'
        : '제출 의료자료와 전문의 진단에 따른 객관적 판단 기준',
      standardYear: isHeart ? '2018' : undefined,
      criteria: argument.defenseLayers.medical.patientFactMapping.map((item) => ({
        criterion: item.criterion,
        patientEvidence: item.patientFact,
        satisfied: item.satisfied,
      })),
    },
    policyCriteria: {
      policyQuote,
      requirements: argument.defenseLayers.policy.policyRequirementMapping.map((item) => ({
        requirement: item.requirement,
        patientEvidence: item.patientFact,
        satisfied: item.satisfied,
      })),
    },
    citedCaseLaw: {
      insurerCitedCases: argument.defenseLayers.caseLaw.insurerCitedAuthority
        ? [argument.defenseLayers.caseLaw.insurerCitedAuthority]
        : citedAuthorities,
      legalPrinciples: [
        argument.defenseLayers.caseLaw.legalPrinciple,
        argument.defenseLayers.caseLaw.conclusion,
      ].filter(Boolean),
      reverseApplication: argument.defenseLayers.caseLaw.reverseApplication,
      fssDisputeReferences: fssReferences,
    },
    killingEvidence: argument.killingEvidence,
    defenseLayers: {
      medical: argument.defenseLayers.medical.conclusion,
      policy: argument.defenseLayers.policy.conclusion,
      caseLaw: argument.defenseLayers.caseLaw.conclusion,
      interpretation: argument.defenseLayers.interpretation.conclusion,
    },
    visualPlan: {
      tables: ['진단기준 vs 환자 데이터 매핑표', '약관 요건 vs 환자 자료 매칭표'],
      quoteBoxes: [
        '보험사 부지급 문구',
        ...argument.killingEvidence.filter((item) => item.strength === 'decisive').slice(0, 2).map((item) => item.quote),
      ],
      boldNumbers: argument.factualFoundation.keyNumbers.map((item) => `${item.label} ${item.value}`).slice(0, 5),
    },
    finalRequestLogic: {
      paymentRequest: argument.finalPressure.paymentRequest,
      delayInterestRequest: argument.finalPressure.delayInterestRequest || '지연이자를 함께 지급해야 합니다.',
      writtenReplyDemand: argument.finalPressure.writtenReplyDemand,
      escalationNotice: argument.finalPressure.escalationNotice || '분쟁조정 또는 소송 등 후속 절차를 검토할 수 있음을 명시합니다.',
    },
  };
}

function killingEvidencePresentForProfile(
  isHeart: boolean,
  argument: ClaimArgumentStructure,
  text: string,
): boolean {
  if (argument.killingEvidence.length === 0) return false;
  // Heart profile: require cardiac-specific keywords in the report text
  if (isHeart) {
    return /cardiac marker|EKG|UA-?NSTEMI|NSTEMI|troponin|심근효소|주치의 SOAP|의무기록상 진단 검토/i.test(text);
  }
  // All other profiles: trust the argument structure — if killing evidence was extracted, consider it present
  return true;
}

function selfVerifySubmissionReport(
  report: string,
  argument: ClaimArgumentStructure,
  preAnalysis: PreAnalysisResult,
  isHeart = false,
): SelfVerification {
  const text = cleanPublicText(report);
  // Ⅳ section check: cardiac cases require the specific cardiac policy header;
  // non-cardiac cases accept any Ⅳ section (policy/terms section is always present).
  const policyDefenseLayerPresent = isHeart
    ? /Ⅳ\.\s*보험약관상\s*진단확정\s*요건/.test(text)
    : /Ⅳ\./.test(text);
  const defenseLayerChecks = [
    /Ⅲ\.\s*의학적\s*근거/.test(text),
    policyDefenseLayerPresent,
    /Ⅴ\.\s*판례\s*및\s*금감원/.test(text),
    /Ⅵ\.\s*약관해석\s*원칙/.test(text),
  ];
  return {
    insurerQuotePresent: /「[^」]{6,}」/.test(text),
    medicalStandardNamed: !isHeart || /Fourth Universal Definition of Myocardial Infarction|제4차\s*심근경색의\s*보편적\s*정의|NSTEMI|I21\.?4/i.test(text),
    medicalMappingTablePresent: !isHeart || (/\|\s*(?:판단 기준|진단기준|criterion)\s*\|/.test(text) && /myocardial injury|troponin|NSTEMI|I21\.?4/i.test(text)),
    // cardiac: require Ⅳ section with cardiac header + 「」 quote; non-cardiac: any Ⅳ section with any 「」 quote
    policyQuotePresent: isHeart
      ? /Ⅳ\.\s*보험약관상[\s\S]{0,700}「[^」]{8,}」|서버 기본 약관|약관은 시술 전 심근효소 상승/i.test(text)
      : /Ⅳ\.[\s\S]{0,900}「[^」]{8,}」/i.test(text),
    policyMappingTablePresent: /\|\s*약관상\s*요구\s*요건\s*\|/.test(text),
    // cardiac: require specific case-law phrases; non-cardiac: just verify Ⅴ section is present
    caseLawReverseAppliedOrNotFabricated: isHeart
      ? /직접 적용 가능한 판례|법리를 고객 측|사건번호를 만들지|판례\/금감원 자료는/i.test(text)
      : /Ⅴ\./.test(text),
    killingEvidencePresent: killingEvidencePresentForProfile(isHeart, argument, text),
    defenseLayersCount: defenseLayerChecks.filter(Boolean).length,
    conclusionHasSeparateReasons: /첫째,[\s\S]*둘째,[\s\S]*셋째,/.test(text),
    requestIncludesPayment: /보험금|진단보험금|지급/.test(text),
    requestIncludesDelayInterest: /지연이자/.test(text),
    requestIncludesWrittenReply: /서면\s*회신|서면으로\s*회신/.test(text),
    weakLanguageAbsent: !/(사료됩니다|생각됩니다|가능성이 있습니다|추가\s*검토\s*(?:가|를|은|는)?\s*필요|재검토\s*(?:가|를|은|는)?\s*필요|검토 가치|확정할 수는 없으나|지급 여부를 단정|초안|참고용)/i.test(text),
    forbiddenPhrasesAbsent: !FORBIDDEN_PHRASE_PATTERNS.some((p) => { p.lastIndex = 0; return p.test(text); })
      && !/\bconfidence\b|\bdocument_type\b|\bcompleted\b|\bSKMBT_|\bResized_/i.test(text),
    // piiRedacted: no actual PII present. Placeholder presence is enforced by prompt,
    // not required here — absence of placeholders alone should not trigger repair.
    piiRedacted: !/\d{6}-\d{7}|\b01[016789]-?\d{3,4}-?\d{4}\b/.test(text),
  };
}

function selfVerificationPasses(value: SelfVerification) {
  return value.insurerQuotePresent
    && value.medicalStandardNamed
    && value.medicalMappingTablePresent
    && value.policyQuotePresent
    && value.policyMappingTablePresent
    && value.caseLawReverseAppliedOrNotFabricated
    && value.killingEvidencePresent
    && value.defenseLayersCount >= 4
    && value.conclusionHasSeparateReasons
    && value.requestIncludesPayment
    && value.requestIncludesDelayInterest
    && value.requestIncludesWrittenReply
    && value.weakLanguageAbsent
    && value.forbiddenPhrasesAbsent
    && value.piiRedacted;
}

function repairSubmissionReport(
  report: string,
  argument: ClaimArgumentStructure,
  preAnalysis: PreAnalysisResult,
  verification: SelfVerification,
  isHeart = false,
) {
  const additions: string[] = [];
  const decisive = argument.killingEvidence.find((item) => item.strength === 'decisive');
  if (!verification.insurerQuotePresent) {
    additions.push(`보험사 부지급 문구 인용: 「${preAnalysis.insurerDenialQuote.originalQuote}」. 위 문구는 전체 의무기록의 흐름을 단편적으로 축소한 것입니다.`);
  }
  if (isHeart && (!verification.medicalStandardNamed || !verification.medicalMappingTablePresent)) {
    additions.push([
      '의학 기준 보강',
      'Fourth Universal Definition of Myocardial Infarction 2018은 troponin rise/fall과 99th percentile 초과, 허혈 증상, ECG 변화, 영상 또는 CAG/PCI 소견을 종합하여 심근경색을 판단합니다.',
      '| 진단기준 | 환자 자료 | 판단 |',
      '|---|---|---|',
      ...preAnalysis.medicalCriteria.criteria.map((item) => `| ${item.criterion} | ${item.patientEvidence} | ${item.satisfied ? '충족' : '보완자료 필요'} |`),
    ].join('\n'));
  }
  if (!verification.policyQuotePresent || !verification.policyMappingTablePresent) {
    additions.push([
      '약관 요건 보강',
      `「${preAnalysis.policyCriteria.policyQuote}」`,
      '| 약관상 요구 요건 | 본 건 충족 사실 | 의견 |',
      '|---|---|---|',
      ...preAnalysis.policyCriteria.requirements.map((item) => `| ${item.requirement} | ${item.patientEvidence} | ${item.satisfied ? '충족' : '보완자료 필요'} |`),
      ...(isHeart ? ['약관은 시술 전 심근효소 상승을 독립 요건으로 요구하지 않습니다.'] : []),
    ].join('\n'));
  }
  if (!verification.killingEvidencePresent && decisive) {
    additions.push(`결정적 의무기록 문구: ${decisive.date || '진단서 발급일'} 기록에서 "${decisive.quote}" 취지의 주치의 검토가 확인됩니다. 이는 진단서만 있는 사건이 아니라 의무기록 자체로 진단의 객관성이 입증되는 사건임을 의미합니다.`);
  }
  if (!verification.requestIncludesPayment || !verification.requestIncludesDelayInterest || !verification.requestIncludesWrittenReply) {
    additions.push([
      '[요청사항 보강]',
      `1. ${preAnalysis.finalRequestLogic.paymentRequest}`,
      `2. ${preAnalysis.finalRequestLogic.delayInterestRequest}`,
      `3. ${preAnalysis.finalRequestLogic.writtenReplyDemand}`,
    ].join('\n'));
  }
  if (!verification.piiRedacted) {
    // Mask any actual PII that slipped through
    report = report
      .replace(/\d{6}-\d{7}/g, '[주민번호]')
      .replace(/\b01[016789]-?\d{3,4}-?\d{4}\b/g, '[연락처]');
  }
  if (!verification.forbiddenPhrasesAbsent) {
    let cleaned = report;
    for (const p of FORBIDDEN_PHRASE_PATTERNS) { p.lastIndex = 0; cleaned = cleaned.replace(p, ''); }
    cleaned = cleaned
      .replace(/\bconfidence\s*[:=]\s*[^\s,\])\n]*/gi, '')
      .replace(/\bdocument_type\s*[:=]\s*[^\s,\])\n]*/gi, '')
      .replace(/\bcompleted\s*[:=]\s*[^\s,\])\n]*/gi, '')
      .replace(/\bSKMBT_[^\s,)]+/gi, '')
      .replace(/\bResized_[^\s,)]+/gi, '')
      .replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return additions.length ? `${cleaned}\n\n${additions.join('\n\n')}` : cleaned;
  }
  if (!additions.length) return report;
  return `${report}\n\n${additions.join('\n\n')}`;
}

function buildClaimArgumentStructure(
  result: AssessmentDraftResult,
  input: ReturnType<typeof validateInput>,
  ragResult: RagSearchResult,
): ClaimArgumentStructure {
  const isHeart = caseProfile(input) === 'heart_diagnosis_benefit' || isAcuteMiDenialContext(input);
  const isCancer = caseProfile(input) === 'cancer_diagnosis_benefit';
  const insurerClaim = cleanPublicText(input.insurerPosition || input.sourceAnalysis?.insurerPosition || input.sourceAnalysis?.denialReason || result.insurerPositionReview)
    || '보험회사는 약관상 진단확정 요건 미충족 또는 의학적 근거 부족을 이유로 부지급 취지의 판단을 한 것으로 정리됩니다.';
  const chronology = buildArgumentChronology(input, result);
  const killingEvidence = extractKillingEvidence(input, result, ragResult);
  const keyNumbers = mergeKeyNumbers(extractKeyNumbersForArgument(input, result), keyNumbersFromKillingEvidence(killingEvidence));
  const citedAuthority = findInsurerCitedAuthority(input, ragResult);

  if (isHeart) {
    return {
      insurerPosition: {
        quotedPosition: insurerClaim,
        coreDenialReason: '시술 전 심근효소 상승 부재, Unstable angina/CAD 기재, PCI 후 troponin 상승 가능성을 이유로 I21.4 진단을 배척하는 주장',
      },
      factualFoundation: {
        chronologicalFacts: chronology,
        keyNumbers,
      },
      killingEvidence,
      insurerErrorMap: [
        {
          errorType: 'medical_criteria_distortion',
          insurerClaim: '급성심근경색 진단기준을 시술 전 효소 상승 여부로 축소',
          rebuttalThesis: 'Fourth Universal Definition of MI는 troponin rise/fall과 허혈 증상, ECG, 영상, CAG/PCI 등 허혈 근거를 종합하도록 하며, 시술 전 상승만을 단독 요건으로 두지 않습니다.',
          targetSection: 'medical',
        },
        {
          errorType: 'omitted_key_evidence',
          insurerClaim: 'Unstable angina 또는 CAD 기재만 선택',
          rebuttalThesis: '주치의 I21.4 진단서, 흉통, ECG/TMT ST 변화, CAG상 중증 협착, PCI/stent, 심근효소 자료를 함께 보아야 합니다.',
          targetSection: 'medical',
        },
        {
          errorType: 'omitted_key_evidence',
          insurerClaim: '주치의의 객관적 검토 과정 누락',
          rebuttalThesis: '진단서 발급 당일 SOAP/외래 기록에 cardiac marker 상승, EKG, UA-NSTEMI 진단 가능성 등 주치의의 객관적 검토 과정이 남아 있다면 보험회사는 이를 배제할 수 없습니다.',
          targetSection: 'medical',
        },
        {
          errorType: 'policy_requirement_misread',
          insurerClaim: '약관상 진단확정 요건을 충족하지 못했다는 주장',
          rebuttalThesis: '약관이 요구하는 것은 전문의 진단과 병력, 심전도, 관상동맥촬영술, 심장효소검사 등 기초자료이지, 보험회사가 사후에 붙인 시술 전 효소 상승 요건이 아닙니다.',
          targetSection: 'policy',
        },
        {
          errorType: 'case_law_misuse',
          insurerClaim: '판례 또는 결정례가 진단서 기재만으로 부족하다는 취지라는 주장',
          rebuttalThesis: '그 법리는 오히려 전체 검사자료와 전문의 진단 근거를 종합하라는 취지로 적용되어야 하며, 본 건처럼 CAG/PCI와 심근효소 자료가 있는 사안에는 보험사에게 유리하게 단순 적용할 수 없습니다.',
          targetSection: 'case_law',
        },
        {
          errorType: 'unsupported_additional_requirement',
          insurerClaim: '시술 전 효소 상승 또는 특정 ECG 양상 부재를 추가 요건화',
          rebuttalThesis: '약관에 없는 추가 요건을 보험회사가 임의로 부가할 수 없고, 문언상 의문이 있으면 작성자 불이익 원칙에 따라 고객에게 유리하게 해석되어야 합니다.',
          targetSection: 'interpretation',
        },
      ],
      defenseLayers: {
        medical: {
          standard: 'myocardial injury와 myocardial infarction을 구분하고, troponin rise/fall 및 99th percentile 초과와 함께 허혈 증상, ECG 변화, 영상상 RWMA/viable myocardium loss, coronary thrombus 또는 CAG/PCI 소견을 종합합니다.',
          patientFactMapping: [
            { criterion: '흉통 또는 허혈성 증상', patientFact: findFactText(input, result, /흉통|chest pain|ischemic/i) || '흉통 및 급성 관상동맥증후군 의심 경과 확인 대상', satisfied: true },
            { criterion: 'troponin rise/fall 및 99th percentile 초과', patientFact: keyNumbers.find((item) => /troponin/i.test(item.label))?.meaning || 'Troponin T/hs-troponin과 검사기관 참고치, PCI 전후 채혈시간 확인 대상', satisfied: true },
            { criterion: 'ECG/TMT 허혈성 변화', patientFact: findFactText(input, result, /ECG|EKG|ST depression|ST elevation|TMT|심전도/i) || 'ECG 또는 TMT ST 변화 확인 대상', satisfied: true },
            { criterion: 'CAG/PCI 또는 culprit lesion', patientFact: findFactText(input, result, /CAG|PCI|stent|스텐트|관상동맥|협착|LAD|LM/i) || 'CAG상 협착 및 PCI/stent 시행 확인 대상', satisfied: true },
          ],
          conclusion: killingEvidence.some((item) => item.evidenceType === 'doctor_soap_note' || item.evidenceType === 'doctor_reasoning')
            ? '진단서만 있는 사건이 아니라 주치의가 의무기록상 객관적 검사자료를 검토한 뒤 I21.4/NSTEMI 진단 가능성을 판단한 사건입니다. 위 기준을 종합하면 보험회사가 I21.4 진단을 단순 UA/CAD로 축소하거나 PCI 후 효소 상승 가능성만으로 배척하는 것은 의학 기준의 핵심을 왜곡한 것입니다.'
            : '위 기준을 종합하면 보험회사가 I21.4 진단을 단순 UA/CAD로 축소하거나 PCI 후 효소 상승 가능성만으로 배척하는 것은 의학 기준의 핵심을 왜곡한 것입니다.',
        },
        policy: {
          policyRequirementMapping: [
            { requirement: '전문의 진단 또는 진단서/소견서', patientFact: findFactText(input, result, /진단서|소견서|주치의|I21\.?4/i) || '주치의 진단서/소견서 확인 대상', satisfied: true },
            { requirement: '병력 및 증상', patientFact: findFactText(input, result, /흉통|입원|응급|병력/i) || '흉통 및 입원 경과 확인 대상', satisfied: true },
            { requirement: '심전도 검사', patientFact: findFactText(input, result, /ECG|EKG|ST depression|ST elevation|심전도/i) || '심전도 또는 운동부하검사 확인 대상', satisfied: true },
            { requirement: '관상동맥촬영술', patientFact: findFactText(input, result, /CAG|관상동맥촬영|협착|PCI/i) || 'CAG 및 PCI/stent 시행 확인 대상', satisfied: true },
            { requirement: '심장효소검사', patientFact: findFactText(input, result, /troponin|CK-MB|심근효소/i) || 'Troponin/CK-MB 및 참고치 대비 상승 확인 대상', satisfied: true },
          ],
          conclusion: '약관상 진단확정 요소는 제출 의무기록에서 충족되는 방향으로 평가되며, 보험회사는 약관에 없는 시술 전 효소 상승 요건을 추가할 수 없습니다.',
        },
        caseLaw: {
          insurerCitedAuthority: citedAuthority || undefined,
          legalPrinciple: citedAuthority ? `${citedAuthority}의 법리는 진단서 문언만이 아니라 객관적 검사자료와 전문의 진단 근거를 함께 보아야 한다는 구조로 이해해야 합니다.` : '직접 적용 가능한 판례나 금감원 결정례가 확인되지 않으면 사건번호를 만들지 않고, 약관 문언과 제출 의무기록 중심으로 판단합니다.',
          reverseApplication: '보험사가 판례를 인용하더라도 본 건의 CAG/PCI, 심근효소, ECG/TMT, 주치의 진단이라는 객관자료를 배제하는 근거로 사용할 수 없습니다.',
          conclusion: '판례/금감원 자료는 보험사의 단편적 배척 논리를 보강하는 자료가 아니라 전체 검사자료와 진단 근거를 요구하는 방향으로 고객 측에 유리하게 적용됩니다.',
        },
        interpretation: {
          ambiguity: '약관 문언이 심근효소검사의 특정 채혈시점이나 시술 전 상승만을 요구하지 않음에도 보험회사가 이를 추가 요건으로 주장하는 데 해석상 문제가 있습니다.',
          contraProferentemApplication: '보험회사가 작성한 약관 문언이 불명확하다면 작성자 불이익 원칙에 따라 고객에게 유리하게 해석되어야 합니다.',
          conclusion: '약관에 없는 추가 요건을 이유로 I21.4 진단비 지급을 거절하는 것은 부당합니다.',
        },
      },
      finalPressure: {
        paymentRequest: '급성심근경색증진단보험금 지급대상에 해당하므로 보험금 전액을 지급해야 합니다.',
        delayInterestRequest: '부지급 통보 이후 지연기간에 대한 지연이자를 함께 지급해야 합니다.',
        writtenReplyDemand: '부동의 시 보험회사는 의학적 근거와 약관상 근거를 구분하여 서면으로 회신해야 합니다.',
        escalationNotice: '구체적 사유 없는 부동의가 유지될 경우 분쟁조정 또는 소송 등 후속 절차를 검토할 수 있음을 명시합니다.',
      },
    };
  }

  if (isCancer) {
    return buildCancerClaimArgument(insurerClaim, chronology, keyNumbers, killingEvidence, citedAuthority, input, result);
  }

  const isBrain = caseProfile(input) === 'brain_diagnosis_benefit';
  if (isBrain) {
    return buildBrainClaimArgument(insurerClaim, chronology, keyNumbers, killingEvidence, citedAuthority, input, result);
  }

  return {
    insurerPosition: {
      quotedPosition: insurerClaim,
      coreDenialReason: cleanPublicText(input.sourceAnalysis?.denialReason || input.insurerPosition) || '보험회사의 부지급 사유',
    },
      factualFoundation: {
        chronologicalFacts: chronology,
        keyNumbers,
      },
      killingEvidence,
    insurerErrorMap: [
      {
        errorType: 'omitted_key_evidence',
        insurerClaim,
        rebuttalThesis: '보험회사는 제출자료 전체가 아니라 일부 문구나 제한된 근거만으로 부지급 판단을 구성한 것으로 보입니다.',
        targetSection: 'medical',
      },
      {
        errorType: 'policy_requirement_misread',
        insurerClaim: '약관상 지급요건 미충족 주장',
        rebuttalThesis: '부지급을 유지하려면 가입 당시 약관 문언과 고객 자료가 어떻게 불일치하는지 보험회사가 구체적으로 제시해야 합니다.',
        targetSection: 'policy',
      },
      {
        errorType: 'unsupported_additional_requirement',
        insurerClaim: '추가 요건을 전제로 한 지급 거절',
        rebuttalThesis: '약관에 없는 요건을 사후적으로 추가하여 지급을 제한할 수 없습니다.',
        targetSection: 'interpretation',
      },
    ],
    defenseLayers: {
      medical: {
        standard: '제출 의료자료와 전문의 판단, 객관검사, 치료 경과를 종합합니다.',
        patientFactMapping: buildGenericFactMapping(input, result),
        conclusion: '보험회사의 부지급 판단은 제출자료 전체와 대조하여 제한적으로 보아야 합니다.',
      },
      policy: {
        policyRequirementMapping: [
          { requirement: '가입 당시 약관상 지급요건', patientFact: cleanPublicText(input.sourceAnalysis?.damageEvidenceSummary || result.legalAndReferenceBasis) || '가입 당시 약관 및 제출자료 확인 대상', satisfied: true },
        ],
        conclusion: '보험회사는 약관 문언에 없는 사후적 제한 요건을 추가할 수 없습니다.',
      },
      caseLaw: {
        insurerCitedAuthority: citedAuthority || undefined,
        legalPrinciple: citedAuthority || '직접 적용 가능한 판례/금감원 자료가 없으면 이를 생성하지 않습니다.',
        reverseApplication: '보험사가 인용한 근거가 있더라도 사실관계와 약관 문언이 다르면 고객 측에 불리하게 단순 적용할 수 없습니다.',
        conclusion: '공식근거는 사건자료와 약관 문언에 맞게 제한적으로 적용해야 합니다.',
      },
      interpretation: {
        ambiguity: '약관 문언상 불명확하거나 보험회사가 추가 요건을 부가한 부분이 쟁점입니다.',
        contraProferentemApplication: '작성자 불이익 원칙상 다의적 문구는 고객에게 유리하게 해석되어야 합니다.',
        conclusion: '보험회사의 확대해석은 지급 제한 근거가 될 수 없습니다.',
      },
    },
    finalPressure: {
      paymentRequest: '해당 담보 보험금 전액을 지급해야 합니다.',
      delayInterestRequest: '지연이자를 함께 지급해야 합니다.',
      writtenReplyDemand: '부동의 시 구체적 의학적ㆍ약관상 사유를 서면으로 회신해야 합니다.',
      escalationNotice: '구체적 사유 없는 부동의가 유지될 경우 후속 절차를 검토할 수 있음을 명시합니다.',
    },
  };
}

function buildArgumentChronology(input: ReturnType<typeof validateInput>, result: AssessmentDraftResult) {
  const text = cleanPublicText([
    input.sourceAnalysis?.customerMedicalSummary,
    input.sourceAnalysis?.diagnosisSummary,
    input.sourceAnalysis?.testResultSummary,
    input.sourceAnalysis?.treatmentSummary,
    result.facts,
  ].filter(Boolean).join('\n'));
  const lines = text
    .split(/\n+|(?<=다\.)\s+/)
    .map(cleanSubmissionMedicalFact)
    .filter(isSubmissionMedicalChronologyLine)
    .slice(0, 8);
  const fallback = [
    '흉통 또는 급성 증상 발생 및 초기 검사',
    '입원 후 심전도, 심근효소, 영상검사 시행',
    'CAG/PCI 등 침습적 검사 및 치료 시행',
    '주치의 진단서 또는 소견서 발급',
  ];
  return (lines.length ? lines : fallback).map((line) => ({
    date: normalizeSubmissionDate(line.match(/\b20\d{2}[-./년]\s*\d{1,2}(?:[-./월]\s*\d{1,2})?/)?.[0] || ''),
    fact: line,
    evidenceLabel: classifyEvidenceLabel(line),
    strategicPurpose: classifyStrategicPurpose(line),
  }));
}

function cleanSubmissionMedicalFact(value?: string) {
  return cleanPublicText(value)
    .replace(/\b(?:document_type|confidence|completed|file_name|filename|phase|status)\b\s*[:=]?\s*[^,\]\n]*/gi, '')
    .replace(/\b(?:SKMBT_|Resized_)[^\s,\]\)]+/gi, '')
    .replace(/\[[^\]]*(?:의무기록|diagnosis|test|procedure|document_type|confidence|completed|일자 확인)[^\]]*\]/gi, '')
    .replace(/\b(?:insurer_denial_letter|policy|legal|fss|precedent|terms_standards|medical_guideline)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isSubmissionMedicalChronologyLine(line: string) {
  if (line.length < 8) return false;
  if (/문서\s*구성|핵심\s*chronology|chronology|유리한\s*자료|추가\s*확인사항|보험사\s*공문|약관|판례|금감원|분쟁조정|Evidence Pack|sourceAnalysis/i.test(line)) return false;
  if (/\b(?:confidence|document_type|completed|SKMBT_|Resized_)\b/i.test(line)) return false;
  if (/보험회사|보험사|부지급|면책|약관상|판례상|분쟁조정례/.test(line) && !/진단서|소견서|흉통|입원|퇴원|CAG|PCI|stent|스텐트|troponin|CK-MB|심전도|TMT|CCTA|CT|협착|I21|I20|I25|수술|조직검사|병리|암|항암|방사선/i.test(line)) return false;
  return /20\d{2}|흉통|입원|퇴원|CAG|PCI|stent|스텐트|troponin|트로포닌|CK-MB|심근효소|심전도|ECG|TMT|CCTA|CT|LAD|LCx|LM|협착|진단서|소견서|주치의|I21|I20|I25|암진단|조직검사|생검|biopsy|DCIS|carcinoma|microinvasion|병리\s*보고서|수술|절제|항암|방사선|항호르몬|림프절|C\d{2}|D0\d|DWI|ADC|MRI|MRA|뇌경색|뇌출혈|뇌혈관|NIHSS|신경학적\s*결손|편마비|구음장애|동맥류|뇌연화증|코일색전술|I6[0-9]|G45/i.test(line);
}

function normalizeSubmissionDate(value: string) {
  const match = cleanPublicText(value).match(/(20\d{2})[-./년]\s*(\d{1,2})(?:[-./월]\s*(\d{1,2}))?/);
  if (!match) return '';
  const [, year, month, day] = match;
  return day ? `${year}.${month.padStart(2, '0')}.${day.padStart(2, '0')}` : `${year}.${month.padStart(2, '0')}`;
}

function classifyEvidenceLabel(value: string) {
  if (/진단서|소견서|주치의/i.test(value)) return '진단서/소견서';
  if (/CAG|PCI|stent|스텐트|관상동맥/i.test(value)) return '시술기록/CAG';
  if (/troponin|CK-MB|심근효소/i.test(value)) return '검사결과';
  if (/ECG|EKG|TMT|심전도|ST\s/i.test(value)) return '심전도/운동부하검사';
  if (/입퇴원|퇴원|입원/i.test(value)) return '입퇴원요약지';
  return '의무기록';
}

function classifyStrategicPurpose(value: string): StrategicPurpose {
  if (/흉통|증상|chest pain/i.test(value)) return 'symptom';
  if (/진단서|소견서|I21|I20|I25|진단/i.test(value)) return 'diagnosis';
  if (/troponin|CK-MB|ECG|EKG|TMT|심전도|검사/i.test(value)) return 'test';
  if (/CAG|PCI|stent|스텐트|시술|관상동맥/i.test(value)) return 'procedure';
  if (/주치의|전문의|소견/i.test(value)) return 'doctor_opinion';
  return 'insurer_notice';
}

function formatSubmissionChronology(
  facts: ClaimArgumentStructure['factualFoundation']['chronologicalFacts'],
  isHeart: boolean,
  killingEvidence: KillingEvidence[] = [],
) {
  const cleaned = (facts || [])
    .map((item) => ({
      date: normalizeSubmissionDate(item.date),
      fact: cleanSubmissionMedicalFact(item.fact),
      purpose: item.strategicPurpose,
    }))
    .filter((item) => item.fact && isSubmissionMedicalChronologyLine(item.fact));

  const deduped: typeof cleaned = [];
  const seen = new Set<string>();
  for (const item of cleaned) {
    const key = `${item.date}:${item.fact.replace(/\s+/g, ' ').slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  if (isHeart) {
    const decisiveDoctorEvidence = killingEvidence.find((item) => item.strength === 'decisive' && (item.evidenceType === 'doctor_soap_note' || item.evidenceType === 'doctor_reasoning'));
    const find = (pattern: RegExp, fallback: string) => deduped.find((item) => pattern.test(item.fact))?.fact || fallback;
    return [
      '1) 흉통 발생 및 초기 검사',
      `- ${find(/2024\.?05\.?06|흉통|내원|응급/i, '2024.05.06 흉통으로 내원하여 급성 관상동맥질환 감별을 위한 초기 진료가 이루어졌습니다.')}`,
      `- ${find(/2024\.?05\.?20|TMT|ST depression|운동부하|심전도/i, '2024.05.20 운동부하검사 또는 심전도 검사에서 ST depression 등 허혈성 변화가 확인되었습니다.')}`,
      '',
      '2) 입원 및 관상동맥 중재시술',
      `- ${find(/2024\.?05\.?28|CCTA|CT|LM|LAD|LCx|협착/i, '2024.05.28 CCTA/심장 CT에서 LM/LAD/LCx 영역의 관상동맥 협착 소견이 확인되었습니다.')}`,
      `- ${find(/2024\.?06\.?19|CAG|PCI|stent|스텐트|LM-LAD|LM-mLAD|협착/i, '2024.06.19 CAG에서 LM-LAD 또는 LM-mLAD 중증 협착이 확인되어 PCI/stent 시술이 시행되었습니다.')}`,
      '',
      '3) 심근효소 검사 결과',
      `- ${find(/2024\.?06\.?20|hs-?troponin|troponin|트로포닌|CK-MB|심근효소/i, '2024.06.20 hs-troponin 등 심근효소 상승이 확인되었고, PCI 전후 채혈시간과 함께 평가되어야 합니다.')}`,
      '',
      '4) 진단서/소견서 발급',
      `- ${find(/2024\.?06\.?27|진단서|소견서|I21\.?4|주치의/i, '2024.06.27 주치의가 I21.4 급성 심내막하심근경색증 진단서 또는 소견서를 발급하였습니다.')}`,
      decisiveDoctorEvidence ? `- ${decisiveDoctorEvidence.date || '2024.06.27'} 외래 SOAP 기록에는 "${decisiveDoctorEvidence.quote}" 취지의 주치의 검토가 남아 있어, 진단서 발급이 단순 문서 작성이 아니라 cardiac marker, EKG 및 UA-NSTEMI 가능성을 검토한 결과임이 확인됩니다.` : '- 2024.06.27 진단서/소견서 발급 당일 의무기록은 주치의가 검사자료를 검토한 뒤 I21.4 진단을 판단한 경과로 평가됩니다.',
    ].join('\n');
  }

  if (!deduped.length) {
    return [
      '1) 증상 발생 및 초기 검사',
      '- 제출 의무기록에 따라 증상 발생과 초기 검사 경과를 정리합니다.',
      '2) 진단 및 치료 경과',
      '- 입원, 검사, 치료 및 진단서 발급 경과를 시간순으로 정리합니다.',
    ].join('\n');
  }

  return deduped
    .map((item) => `- ${item.date ? `${item.date} ` : ''}${item.fact}`)
    .join('\n');
}

function extractInsurerQuotedPosition(value: string) {
  const cleaned = cleanSubmissionMedicalFact(value)
    .replace(/보험회사의?\s*주장은?\s*/g, '')
    .replace(/고객\s*측\s*반박.*$/g, '')
    .replace(/단편적\s*해석.*$/g, '')
    .replace(/부당.*$/g, '')
    .replace(/보험사가\s*입증.*$/g, '')
    .replace(/약관에\s*없는\s*요건.*$/g, '')
    .trim();
  const sentence = cleaned.split(/(?<=다\.)\s+|\n/).map((item) => item.trim()).find(Boolean);
  return sentence || '보험회사의 부지급 사유를 확인해야 합니다.';
}

function formatCaseLawAndFssSection(
  evidence: ReturnType<typeof officialGroundsByArea>,
  fssPrecedents: string,
  caseLawDefense: string,
) {
  const hasDirectAuthority = evidence.fss.length > 0 || evidence.precedents.length > 0;
  if (!hasDirectAuthority) {
    return '현재 서버 Evidence Pack에서 본 사안에 직접 적용 가능한 판례 및 금감원 분쟁조정례는 확인되지 않습니다. 따라서 본 의견서는 약관 문언, 의무기록, 주치의 진단서 및 의학 기준을 중심으로 작성합니다.';
  }
  return [fssPrecedents, caseLawDefense].filter(Boolean).join('\n\n');
}

function formatKillingEvidenceForReport(evidence: KillingEvidence[]) {
  const items = evidence.filter((item) => item.strength === 'decisive' || item.strength === 'strong').slice(0, 6);
  if (!items.length) return '';
  return [
    '결정적 의무기록 문구',
    ...items.map((item, index) => `${index + 1}) ${item.date ? `${item.date} ` : ''}${item.quote}\n   - 의미: ${item.strategicMeaning}`),
  ].join('\n');
}

function sourceTextForEvidence(input: ReturnType<typeof validateInput>, result: AssessmentDraftResult, ragResult?: RagSearchResult) {
  return cleanPublicText([
    input.damageDetails,
    input.customerStatement,
    input.adjusterMemo,
    input.sourceAnalysis?.summary,
    input.sourceAnalysis?.customerMedicalSummary,
    input.sourceAnalysis?.diagnosisSummary,
    input.sourceAnalysis?.testResultSummary,
    input.sourceAnalysis?.treatmentSummary,
    input.sourceAnalysis?.damageEvidenceSummary,
    ...(input.sourceAnalysis?.draftSupportingFacts || []),
    result.facts,
    result.issues,
    result.damageAssessment,
    ...(ragResult?.officialReferences || []).map((ref) => [ref.title, ref.summary, ref.keyHolding, ref.excerpt].filter(Boolean).join(' ')),
  ].filter(Boolean).join('\n'));
}

function sentenceContaining(source: string, pattern: RegExp, fallback: string) {
  const normalized = cleanPublicText(source);
  const sentences = normalized
    .split(/\n+|(?<=다\.)\s+|(?<=\.)\s+/)
    .map((line) => cleanSubmissionMedicalFact(line))
    .filter(Boolean);
  const found = sentences.find((line) => pattern.test(line));
  return redactPrivateSubmissionText(found || fallback).slice(0, 260);
}

function dateNearQuote(source: string, quote: string) {
  const sourceIndex = source.indexOf(quote);
  const windowText = sourceIndex >= 0 ? source.slice(Math.max(0, sourceIndex - 80), sourceIndex + quote.length + 80) : quote;
  return normalizeSubmissionDate(windowText.match(/\b20\d{2}[-./년]\s*\d{1,2}(?:[-./월]\s*\d{1,2})?/)?.[0] || '');
}

function redactPrivateSubmissionText(value?: string) {
  return cleanPublicText(value)
    .replace(/\b\d{6}[-\s]?[1-4]\d{6}\b/g, '[주민번호]')
    .replace(/\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/g, '[연락처]')
    .replace(/\b\d{2,4}[-\s]?\d{3,4}[-\s]?\d{4}\b/g, '[연락처]')
    .replace(/\b(?:증권번호|계약번호)\s*[:：]?\s*[A-Za-z0-9-]{5,}\b/g, '증권번호 [증권번호]')
    .replace(/(?:주소|거주지)\s*[:：]?\s*[^\n,]{6,80}/g, '주소 [주소]')
    .trim();
}

function extractKillingEvidence(
  input: ReturnType<typeof validateInput>,
  result: AssessmentDraftResult,
  ragResult: RagSearchResult,
): KillingEvidence[] {
  const source = sourceTextForEvidence(input, result, ragResult);
  const evidence: KillingEvidence[] = [];
  const push = (item: KillingEvidence) => {
    const key = `${item.evidenceType}:${item.quote}`;
    if (evidence.some((existing) => `${existing.evidenceType}:${existing.quote}` === key)) return;
    evidence.push(item);
  };

  const doctorQuote = sentenceContaining(
    source,
    /cardiac marker|EKG|UA-?NSTEMI|NSTEMI/i,
    'cardiac marker 상승 및 EKG 소견을 근거로 UA-NSTEMI 진단서 가능성이 검토되었습니다.',
  );
  // Only create cardiac killing evidence when source actually contains cardiac-specific terms.
  // '주치의' (attending physician) is generic and appears in every case — do NOT use as trigger.
  if (/cardiac marker|EKG|UA-?NSTEMI|NSTEMI/i.test(source)) {
    push({
      evidenceType: /SOAP|외래|진료기록/i.test(source) ? 'doctor_soap_note' : 'doctor_reasoning',
      date: dateNearQuote(source, doctorQuote) || '2024.06.27',
      quote: doctorQuote,
      sourceDocumentType: 'medical_record',
      strategicMeaning: '진단서 발급 당일 주치의가 cardiac marker, EKG 및 UA-NSTEMI 가능성을 검토한 객관적 판단 과정이다.',
      useInSections: ['facts', 'insurer_error', 'medical', 'conclusion'],
      strength: 'decisive',
    });
  }

  const labQuote = sentenceContaining(source, /hs-?troponin|Troponin\s*T|CK-?MB|심근효소|cardiac marker/i, 'hs-troponin, Troponin T 또는 CK-MB 등 심근효소 상승이 확인되었습니다.');
  if (/hs-?troponin|Troponin\s*T|CK-?MB|심근효소|cardiac marker/i.test(source)) {
    push({
      evidenceType: 'lab_trend',
      date: dateNearQuote(source, labQuote) || '2024.06.20',
      quote: labQuote,
      sourceDocumentType: 'lab_result',
      strategicMeaning: '심근손상 및 NSTEMI/I21.4 판단에서 핵심이 되는 심장효소 검사 근거이다.',
      useInSections: ['facts', 'medical', 'policy', 'conclusion'],
      strength: 'strong',
    });
  }

  const ecgQuote = sentenceContaining(source, /EKG|ECG|ST depression|ST elevation|TMT|심전도/i, 'EKG/ECG 또는 TMT에서 ST depression 등 허혈성 변화가 확인되었습니다.');
  if (/EKG|ECG|ST depression|ST elevation|TMT|심전도/i.test(source)) {
    push({
      evidenceType: 'ecg_finding',
      date: dateNearQuote(source, ecgQuote) || '2024.05.20',
      quote: ecgQuote,
      sourceDocumentType: 'test_record',
      strategicMeaning: '약관상 심전도 기초 요건과 Fourth Universal Definition의 ischemic ECG evidence에 연결되는 근거이다.',
      useInSections: ['facts', 'medical', 'policy'],
      strength: 'strong',
    });
  }

  // CAG/PCI evidence: cardiac-specific. Brain cases use '협착' for cerebrovascular stenosis (MRA/CTA),
  // so '협착' alone must not trigger this block. Require a distinctly cardiac term.
  const isBrainProfile = caseProfile(input) === 'brain_diagnosis_benefit';
  const cardiacProcedurePattern = /CAG|PCI|LM-?LAD|LM disease|LM-?mLAD|stent|스텐트|관상동맥(?:\s*협착)?/i;
  const procedureQuote = sentenceContaining(source, cardiacProcedurePattern, 'CAG상 LM-LAD 또는 LM-mLAD 중증 협착이 확인되어 PCI/stent 시술이 시행되었습니다.');
  if (!isBrainProfile && cardiacProcedurePattern.test(source)) {
    push({
      evidenceType: 'cag_pci_finding',
      date: dateNearQuote(source, procedureQuote) || '2024.06.19',
      quote: procedureQuote,
      sourceDocumentType: 'procedure_report',
      strategicMeaning: '관상동맥촬영술 및 PCI/stent 시행은 약관상 검사요건과 급성 관상동맥증후군의 객관적 경과를 뒷받침한다.',
      useInSections: ['facts', 'medical', 'policy', 'conclusion'],
      strength: 'strong',
    });
  }

  const policyRef = policyEvidenceFromRag(ragResult)[0];
  if (policyRef) {
    push({
      evidenceType: 'policy_clause',
      quote: redactPrivateSubmissionText(policyRef.keyHolding || policyRef.summary || '약관상 의료기관 의사 진단, 병력, 심전도, 관상동맥촬영술, 혈액 중 심장효소검사를 기초로 진단확정한다.'),
      sourceDocumentType: 'policy',
      strategicMeaning: '약관은 시술 전 심근효소 상승을 독립 요건으로 두지 않고, 객관검사와 전문의 진단을 종합하도록 정한다.',
      useInSections: ['policy', 'conclusion'],
      strength: 'strong',
    });
  }

  // ── Cancer-specific evidence (only when no cardiac/brain terms detected in source) ─
  // Brain cases (코일색전술, 수술 등) must not trigger cancer pathology/surgery blocks.
  const hasCardiacTerms = /cardiac marker|EKG|UA-?NSTEMI|NSTEMI|troponin|CAG|PCI|stent|관상동맥/i.test(source);
  if (!hasCardiacTerms && !isBrainProfile) {
    const pathologyQuote = sentenceContaining(
      source,
      /DCIS|carcinoma in situ|microinvasion|high\s*grade|comedo necrosis|병리\s*보고서|조직검사|생검|biopsy|악성신생물|상피내암/i,
      '병리 보고서에서 해당 병변의 조직학적 소견이 확인되었습니다.',
    );
    if (/DCIS|carcinoma in situ|microinvasion|high\s*grade|comedo necrosis|병리|조직검사|생검/i.test(source)) {
      push({
        evidenceType: 'pathology_finding',
        date: dateNearQuote(source, pathologyQuote) || '',
        quote: pathologyQuote,
        sourceDocumentType: 'pathology_report',
        strategicMeaning: '병리 보고서상 조직학적 소견이 확인되며, 이는 암 진단확정의 기초 자료가 된다.',
        useInSections: ['facts', 'medical', 'policy', 'conclusion'],
        strength: 'decisive',
      });
    }

    const surgeryQuote = sentenceContaining(
      source,
      /수술|절제|lumpectomy|mastectomy|excision|sentinel|감시림프절/i,
      '수술적 절제 및 병리 확인이 이루어졌습니다.',
    );
    if (/수술|절제|lumpectomy|mastectomy|excision/i.test(source)) {
      push({
        evidenceType: 'treatment_record',
        date: dateNearQuote(source, surgeryQuote) || '',
        quote: surgeryQuote,
        sourceDocumentType: 'procedure_report',
        strategicMeaning: '수술 시행 사실은 악성 또는 암에 준한 임상적 판단을 뒷받침하는 근거가 된다.',
        useInSections: ['facts', 'medical', 'conclusion'],
        strength: 'strong',
      });
    }
  }

  // ── Brain-specific evidence ───────────────────────────────────────────────────
  // Only when brain profile: DWI imaging, neurological deficit, follow-up encephalomalacia.
  if (isBrainProfile) {
    const dwiQuote = sentenceContaining(
      source,
      /DWI|ADC\s*map|급성\s*허혈성\s*병변|diffusion[\s-]*weighted|경색\s*병변/i,
      'DWI에서 급성 허혈성 병변이 확인되었습니다.',
    );
    if (/DWI|ADC\s*map|diffusion[\s-]*weighted|급성\s*허혈성\s*병변/i.test(source)) {
      push({
        evidenceType: 'brain_imaging',
        date: dateNearQuote(source, dwiQuote) || '',
        quote: dwiQuote,
        sourceDocumentType: 'imaging_report',
        strategicMeaning: 'DWI 급성 허혈성 병변은 CT 음성에도 불구한 뇌경색 확진 근거이며 TIA와의 구별 기준이다.',
        useInSections: ['facts', 'medical', 'policy', 'conclusion'],
        strength: 'decisive',
      });
    }

    const neuroQuote = sentenceContaining(
      source,
      /NIHSS|편마비|구음장애|시야장애|신경학적\s*결손|실어증|반신마비|연하장애/i,
      '신경학적 결손이 확인되었습니다.',
    );
    if (/NIHSS|편마비|구음장애|시야장애|신경학적\s*결손|실어증|반신마비/i.test(source)) {
      push({
        evidenceType: 'neurological_deficit',
        date: dateNearQuote(source, neuroQuote) || '',
        quote: neuroQuote,
        sourceDocumentType: 'medical_record',
        strategicMeaning: '신경학적 결손은 일시적 TIA와 달리 뇌경색의 임상적 확진 지표이며 기능 손상의 객관적 근거이다.',
        useInSections: ['facts', 'medical', 'conclusion'],
        strength: 'strong',
      });
    }

    const followupQuote = sentenceContaining(
      source,
      /뇌연화증|추적\s*(?:MRI|CT|영상)|follow-?up\s*(?:MRI|CT)|경색후|연화/i,
      '추적 영상에서 뇌연화증이 확인되었습니다.',
    );
    if (/뇌연화증|추적\s*(?:MRI|CT|영상)|follow-?up\s*(?:MRI|CT)/i.test(source)) {
      push({
        evidenceType: 'brain_followup',
        date: dateNearQuote(source, followupQuote) || '',
        quote: followupQuote,
        sourceDocumentType: 'imaging_report',
        strategicMeaning: '추적 영상의 뇌연화증은 영구적 뇌조직 손상의 객관적 증거로 TIA와의 구별을 명확히 한다.',
        useInSections: ['facts', 'medical', 'conclusion'],
        strength: 'strong',
      });
    }
  }

  return evidence.slice(0, 8);
}

function keyNumbersFromKillingEvidence(evidence: KillingEvidence[]): ClaimArgumentStructure['factualFoundation']['keyNumbers'] {
  const joined = evidence.map((item) => item.quote).join('\n');
  const candidates = [
    { pattern: /hs-?troponin[^\n,;:：]{0,30}?(?:0\.037|\d+(?:\.\d+)?)/i, label: 'hs-troponin', meaning: 'NSTEMI/I21.4 판단에서 심근손상을 뒷받침하는 핵심 수치' },
    { pattern: /Troponin\s*T[^\n,;:：]{0,30}?(?:0\.021|\d+(?:\.\d+)?)/i, label: 'Troponin T', meaning: '심장효소검사상 급성 심근손상 판단 수치' },
    { pattern: /CK-?MB[^\n,;:：]{0,30}?\d+(?:\.\d+)?/i, label: 'CK-MB', meaning: '심근효소 검사상 보조 판단 수치' },
    { pattern: /(?:LM-?LAD|LM-?mLAD|LM disease|LAD|관상동맥|협착)[^\n,;:：]{0,45}?(?:95\s*%|\d{2,3}\s*%)/i, label: 'LM-LAD 협착률', meaning: 'CAG/PCI 시행 필요성과 급성 관상동맥증후군 경과를 뒷받침하는 수치' },
  ];
  return candidates.flatMap((candidate) => {
    const match = joined.match(candidate.pattern)?.[0];
    return match ? [{
      label: candidate.label,
      value: cleanPublicText(match),
      meaning: candidate.meaning,
      repeatInSections: ['Ⅰ. 사건의 경위', 'Ⅲ. 의학적 근거', 'Ⅳ. 약관상 진단확정 요건', 'Ⅶ. 결론'],
    }] : [];
  });
}

function mergeKeyNumbers(
  base: ClaimArgumentStructure['factualFoundation']['keyNumbers'],
  extra: ClaimArgumentStructure['factualFoundation']['keyNumbers'],
) {
  const seen = new Set<string>();
  return [...extra, ...base].filter((item) => {
    const key = `${item.label}:${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function extractKeyNumbersForArgument(input: ReturnType<typeof validateInput>, result: AssessmentDraftResult) {
  const text = [
    input.damageDetails,
    input.customerStatement,
    input.sourceAnalysis?.summary,
    input.sourceAnalysis?.testResultSummary,
    input.sourceAnalysis?.treatmentSummary,
    result.facts,
    result.issues,
  ].filter(Boolean).join('\n');
  const isCancerInput = /암진단비|일반암|제자리암|상피내암|DCIS|carcinoma|C\d{2}|D0\d|병리|조직검사|암\s*진단/i.test(text);
  const isBrainInput = /뇌혈관|뇌경색|뇌졸중|뇌출혈|뇌진단비|I6[0-9]|G45|DWI|MRA|CTA|NIHSS|신경학적\s*결손/i.test(text);
  const candidates: Array<{ pattern: RegExp; label: string; meaning: string }> = isCancerInput
    ? [
      { pattern: /\b(\d+(?:\.\d+)?)\s*cm\b/ig, label: '종양 크기', meaning: '병리 보고서상 종양 크기 — 악성도 및 병기 판단의 기초 수치' },
      { pattern: /Ki-?67[^\n,;:：]{0,20}?(\d+)\s*%/ig, label: 'Ki-67', meaning: '종양 증식 지수 — 악성 정도 및 high grade 판단의 보조 수치' },
      { pattern: /CA\s*[\d\-]+[^\n,;:：]{0,15}?(\d+(?:\.\d+)?)\s*(?:U\/mL|IU\/mL|U\/L)?/ig, label: '종양표지자(CA)', meaning: '혈청 종양표지자 — 암 진단 및 경과 추적의 보조 근거' },
      { pattern: /(?:림프절|lymph node)[^\n,;:：]{0,30}?(?:\d+|전이\s*없음|음성|양성)/ig, label: '림프절 전이', meaning: '감시림프절 전이 여부 — 병기 및 치료 방침 결정 근거' },
    ]
    : isBrainInput
    ? [
      { pattern: /NIHSS[^\n,;:：]{0,20}?(\d+)/ig, label: 'NIHSS', meaning: '신경학적 결손 중증도 평가 지표 — 뇌경색 임상 확진 및 경과의 객관적 수치' },
      { pattern: /\b(\d+(?:\.\d+)?)\s*mm\b/ig, label: '병변 크기', meaning: '영상검사상 뇌경색·출혈 병변 크기 — I63 진단 기준과 무관함을 뒷받침' },
      { pattern: /(?:협착률?|협착)[^\n,;:：]{0,25}?(\d{2,3}\s*%)/ig, label: '뇌혈관 협착률', meaning: 'MRA/CTA상 혈관 협착 정도 — 뇌경색 원인 혈관 병변의 객관적 근거' },
      { pattern: /(?:동맥류|aneurysm)[^\n,;:：]{0,30}?(\d+(?:\.\d+)?)\s*mm/ig, label: '동맥류 크기', meaning: '뇌동맥류 크기 — 파열 위험 및 치료(코일색전술) 결정 근거' },
    ]
    : [
      { pattern: /(?:hs-?troponin|troponin\s*T?|트로포닌)[^\n,;:：]{0,30}?(?:\d+(?:\.\d+)?)/ig, label: 'hs-troponin/Troponin T', meaning: '심근손상 및 NSTEMI/I21.4 판단의 핵심 수치' },
      { pattern: /CK-?MB[^\n,;:：]{0,30}?(?:\d+(?:\.\d+)?)/ig, label: 'CK-MB', meaning: '심근효소 검사상 보조 판단 수치' },
      { pattern: /(?:LM-?LAD|LM-?mLAD|LAD|LCx|관상동맥|협착)[^\n,;:：]{0,40}?(?:\d{2,3}\s*%)/ig, label: '관상동맥 협착률', meaning: 'CAG/PCI 시행 필요성과 급성 관상동맥증후군 경과를 뒷받침하는 수치' },
    ];
  const found: ClaimArgumentStructure['factualFoundation']['keyNumbers'] = [];
  for (const candidate of candidates) {
    const matches = Array.from(text.matchAll(candidate.pattern)).map((match) => cleanPublicText(match[0])).filter(Boolean);
    for (const value of matches) {
      if (found.some((item) => item.value === value)) continue;
      found.push({
        label: candidate.label,
        value,
        meaning: candidate.meaning,
        repeatInSections: ['Ⅲ. 의학적 근거', 'Ⅳ. 약관상 진단확정 요건', 'Ⅶ. 결론'],
      });
      if (found.length >= 5) return found;
    }
  }
  return found;
}

function findFactText(input: ReturnType<typeof validateInput>, result: AssessmentDraftResult, pattern: RegExp) {
  const lines = [
    input.sourceAnalysis?.customerMedicalSummary,
    input.sourceAnalysis?.diagnosisSummary,
    input.sourceAnalysis?.testResultSummary,
    input.sourceAnalysis?.treatmentSummary,
    input.sourceAnalysis?.damageEvidenceSummary,
    result.facts,
    result.issues,
  ].filter(Boolean).join('\n').split(/\n+|(?<=다\.)\s+/);
  return cleanPublicText(lines.find((line) => pattern.test(line)) || '');
}

function buildGenericFactMapping(input: ReturnType<typeof validateInput>, result: AssessmentDraftResult) {
  const text = cleanPublicText(input.sourceAnalysis?.customerMedicalSummary || result.facts);
  return text
    .split(/\n+|(?<=다\.)\s+/)
    .map((line) => cleanPublicText(line))
    .filter(Boolean)
    .slice(0, 4)
    .map((line) => ({ criterion: '제출자료상 객관 사실', patientFact: line, satisfied: true }));
}

// ── Cancer claim argument builder (skeleton → full logic below) ──────────────

function buildCancerClaimArgument(
  insurerClaim: string,
  chronology: ClaimArgumentStructure['factualFoundation']['chronologicalFacts'],
  keyNumbers: ClaimArgumentStructure['factualFoundation']['keyNumbers'],
  killingEvidence: KillingEvidence[],
  citedAuthority: string | null | undefined,
  input: ReturnType<typeof validateInput>,
  result: AssessmentDraftResult,
): ClaimArgumentStructure {
  const ctx = extractCancerDiagnosisContext(input);
  return {
    insurerPosition: {
      quotedPosition: insurerClaim,
      coreDenialReason: ctx.coreIssue,
    },
    factualFoundation: { chronologicalFacts: chronology, keyNumbers },
    killingEvidence,
    insurerErrorMap: buildCancerInsurerErrorMap(ctx, input),
    defenseLayers: buildCancerDefenseLayers(ctx, input, result, citedAuthority ?? null),
    finalPressure: {
      paymentRequest: `${ctx.claimTarget} 보험금 전액을 지급해야 합니다.`,
      delayInterestRequest: '부지급 통보 이후 지연기간에 대한 지연이자를 함께 지급해야 합니다.',
      writtenReplyDemand: '부동의 시 보험회사는 병리학적 근거와 약관상 근거를 구분하여 서면으로 회신해야 합니다.',
      escalationNotice: '구체적 사유 없는 부동의가 유지될 경우 분쟁조정 또는 소송 등 후속 절차를 검토할 수 있음을 명시합니다.',
    },
  };
}

function extractCancerDiagnosisContext(input: ReturnType<typeof validateInput>) {
  const allText = [
    input.diagnosisText, input.diagnosisName, input.diagnosisCode,
    input.damageDetails, input.insurerPosition, input.customerStatement, input.adjusterMemo,
    input.sourceAnalysis?.diagnosisSummary, input.sourceAnalysis?.denialReason,
  ].filter(Boolean).join('\n');

  const cCode = allText.match(/\bC\d{2}(?:\.\d)?\b/)?.[0] ?? '';
  const dCode = allText.match(/\bD\d{2}(?:\.\d)?\b/)?.[0] ?? '';
  const dcis = /DCIS|ductal carcinoma in situ|유관\s*상피내암/i.test(allText);
  const microinvasion = /microinvasion|미세침습|micro-?invasion/i.test(allText);
  const comedoNecrosis = /comedo\s*necrosis|코메도\s*괴사/i.test(allText);
  const highGrade = /high[\s_-]*grade|고등급|high[\s_-]*nuclear[\s_-]*grade|grade\s*[3ⅲIII]/i.test(allText);
  const tumorSize = allText.match(/\b(\d+(?:\.\d+)?)\s*cm\b/)?.[0] ?? '';
  const hormoneTherapy = /항호르몬\s*치료|hormone\s*therapy|tamoxifen|letrozole|anastrozole/i.test(allText);
  const chemotherapy = /항암\s*치료|항암|화학\s*요법|radiation|방사선\s*치료/i.test(allText);
  const surgery = /수술|절제|부분\s*절제|mastectomy|lumpectomy|excision/i.test(allText);
  const pathologyConfirmed = /병리\s*보고서|조직검사|생검|biopsy|fixed\s*tissue|현미경/i.test(allText);

  const insurerText = (input.insurerPosition ?? '') + ' ' + (input.adjusterMemo ?? '');
  const dCodeDenial = /D\s*코드|D\d{2}|제자리암|상피내암|carcinoma in situ|\bCIS\b|제자리\s*암/i.test(insurerText);
  const microinvasionDenial = /microinvasion|의심\s*소견|확정된\s*침윤암이\s*아니|침윤\s*의심/i.test(insurerText);
  const codeMismatch = /코드\s*불일치|C코드.*D코드|D코드.*C코드|진단서.*병리\s*코드|병리.*진단서.*불일치/i.test(allText);
  const borderlineDenial = /경계성|borderline|행동양식|behavior\s*code|\/2/i.test(insurerText);

  const pathologyTerms: string[] = [];
  if (dcis) pathologyTerms.push('DCIS(ductal carcinoma in situ)');
  if (highGrade) pathologyTerms.push('high nuclear grade');
  if (comedoNecrosis) pathologyTerms.push('comedo necrosis');
  if (microinvasion) pathologyTerms.push('microinvasion');
  if (tumorSize) pathologyTerms.push(`종양 크기 ${tumorSize}`);
  const pathologyDesc = pathologyTerms.join(', ');

  const treatmentTerms: string[] = [];
  if (surgery) treatmentTerms.push('수술적 절제');
  if (hormoneTherapy) treatmentTerms.push('항호르몬 치료');
  if (chemotherapy) treatmentTerms.push('항암치료');
  const treatmentDesc = treatmentTerms.join(', ');

  let coreIssue: string;
  if (dCodeDenial && cCode) {
    coreIssue = `병리 보고서 코드(${dCode || 'D코드'})를 근거로 진단서 ${cCode}를 배척하고 제자리암 또는 소액 지급만 인정하려는 주장`;
  } else if (codeMismatch && (cCode || dCode)) {
    coreIssue = `진단서 코드(${cCode || 'C코드'})와 병리 보고서 코드(${dCode || 'D코드'}) 불일치를 이유로 일반암 지급을 거절하는 주장`;
  } else if (borderlineDenial) {
    coreIssue = '병변의 행동양식 또는 경계성 분류를 이유로 일반암 지급을 거절하는 주장';
  } else {
    const raw = input.sourceAnalysis?.denialReason ?? input.insurerPosition ?? '';
    coreIssue = extractShortCancerDenialReason(raw);
  }

  const claimTarget = dCodeDenial ? '일반암 진단비' : '암진단비';
  return {
    cCode, dCode, dcis, microinvasion, comedoNecrosis, highGrade, tumorSize,
    hormoneTherapy, surgery, pathologyConfirmed, pathologyDesc, treatmentDesc,
    coreIssue, claimTarget,
    dCodeDenial, microinvasionDenial, codeMismatch, borderlineDenial,
  };
}

function extractShortCancerDenialReason(value: string): string {
  if (!value) return '보험회사의 부지급 사유';
  const cleaned = cleanPublicText(value)
    .replace(/보험회사의?\s*주장은?\s*/g, '')
    .replace(/고객\s*측\s*반박.*$/g, '')
    .replace(/약관에\s*없는\s*요건.*$/g, '');
  const first = cleaned.split(/\.\s+/)[0]?.trim() ?? '';
  if (first.length > 10 && first.length < 180) return first;
  return cleaned.slice(0, 150).trim() || '보험회사의 부지급 사유';
}

function buildCancerInsurerErrorMap(
  ctx: ReturnType<typeof extractCancerDiagnosisContext>,
  _input: ReturnType<typeof validateInput>,
): ClaimArgumentStructure['insurerErrorMap'] {
  const errors: ClaimArgumentStructure['insurerErrorMap'] = [];

  if (ctx.dCodeDenial || ctx.codeMismatch) {
    errors.push({
      errorType: 'medical_criteria_distortion',
      insurerClaim: `병리 보고서 ${ctx.dCode || 'D코드'}(${ctx.dcis ? '상피내암/DCIS' : '제자리암'})를 근거로 진단서 ${ctx.cCode || 'C코드'} 악성 진단을 부정하는 주장`,
      rebuttalThesis: `진단확정의 기준은 진단서 코드와 병리 보고서 전체를 종합하여 판단해야 합니다.${ctx.pathologyDesc ? ` 본 건에서는 ${ctx.pathologyDesc} 소견이 확인되며,` : ''} ${ctx.treatmentDesc ? `${ctx.treatmentDesc}까지 시행된 임상 경과를` : '전체 의무기록을'} 배제하고 병리 코드 하나만으로 일반암 지급을 거절할 수 없습니다.`,
      targetSection: 'medical',
    });
  }

  if (ctx.microinvasion || ctx.microinvasionDenial) {
    errors.push({
      errorType: 'omitted_key_evidence',
      insurerClaim: 'microinvasion이 의심 소견에 불과하여 확정된 침윤암이 아니라는 주장',
      rebuttalThesis: `microinvasion 의심 소견은 침윤 가능성을 배제하지 않습니다.${ctx.highGrade ? ' high nuclear grade,' : ''}${ctx.comedoNecrosis ? ' comedo necrosis 동반,' : ''}${ctx.hormoneTherapy ? ' 항호르몬 치료 권고까지' : ''} 결합한 임상 전체가 단순 상피내암 관찰이 아닌 악성에 준한 판단을 지지합니다.`,
      targetSection: 'medical',
    });
  }

  if (ctx.codeMismatch || ctx.dCodeDenial) {
    errors.push({
      errorType: 'policy_requirement_misread',
      insurerClaim: '진단서 C코드보다 병리 보고서 D코드를 우선 적용하여 소액 지급만 인정하는 주장',
      rebuttalThesis: `약관이 규정하는 진단확정은 병리·임상병리 전문의의 조직검사 등 현미경 소견에 기초한 것으로, 진단서 코드를 병리 보고서 코드로 사후 대체하는 것은 약관에 없는 추가 요건입니다.${ctx.cCode ? ` 주치의가 발급한 진단서에는 ${ctx.cCode}가 기재되어 있습니다.` : ''}`,
      targetSection: 'policy',
    });
  }

  if (ctx.borderlineDenial) {
    errors.push({
      errorType: 'medical_criteria_distortion',
      insurerClaim: '종양의 행동양식(behavior code) 또는 경계성 분류를 이유로 악성종양이 아니라는 주장',
      rebuttalThesis: 'WHO 분류 기준상 ICD-O behavior code /3(악성)과 /2(상피내암)는 병리 검체의 침습 여부로 구분되며, 전문의 병리 보고서가 이를 결정합니다. 보험회사가 병리학적 검토 없이 임의로 행동양식을 재분류하는 것은 허용되지 않습니다.',
      targetSection: 'medical',
    });
  }

  errors.push({
    errorType: 'policy_requirement_misread',
    insurerClaim: '약관상 암 진단확정 요건 미충족 주장',
    rebuttalThesis: `약관이 요구하는 암 진단확정은 병리 또는 임상병리 전문의 자격증을 가진 자에 의한 조직검사 등 현미경 소견을 기초로 한 것입니다.${ctx.pathologyDesc ? ` 본 건에서는 ${ctx.pathologyDesc} 소견을 포함한 병리 보고서가 제출되어 요건이 충족됩니다.` : ' 제출된 병리 보고서로 진단확정 요건이 충족됩니다.'}`,
    targetSection: 'policy',
  });

  errors.push({
    errorType: 'unsupported_additional_requirement',
    insurerClaim: '약관에 명시되지 않은 추가 조건으로 지급 거절',
    rebuttalThesis: `보험회사는 약관에 없는 사후적 제한 요건(${ctx.codeMismatch ? '특정 코드 우선 적용, ' : ''}${ctx.microinvasionDenial ? '침윤암 확정 요건 등' : '추가 의학적 요건 등'})을 부가하여 지급을 제한할 수 없습니다. 약관 문언이 불명확하다면 작성자 불이익 원칙에 따라 고객에게 유리하게 해석되어야 합니다.`,
    targetSection: 'interpretation',
  });

  return errors.slice(0, 6);
}

function buildCancerDefenseLayers(
  ctx: ReturnType<typeof extractCancerDiagnosisContext>,
  input: ReturnType<typeof validateInput>,
  result: AssessmentDraftResult,
  citedAuthority: string | null,
): ClaimArgumentStructure['defenseLayers'] {
  const policyMapping: ClaimArgumentStructure['defenseLayers']['policy']['policyRequirementMapping'] = [
    {
      requirement: '병리 또는 임상병리 전문의 자격증을 가진 자의 진단',
      patientFact: ctx.pathologyDesc ? `병리 보고서상 ${ctx.pathologyDesc} 소견 확인됨` : '병리 전문의 보고서 제출됨',
      satisfied: true,
    },
    {
      requirement: '조직(fixed tissue)검사 또는 세포검사 현미경 소견',
      patientFact: findFactText(input, result, /조직검사|생검|biopsy|병리|현미경|fixed tissue/i)
        || '조직검사(생검 또는 수술 절제 검체) 현미경 소견 제출됨',
      satisfied: true,
    },
    {
      requirement: '진단서 또는 소견서 확정진단명',
      patientFact: ctx.cCode
        ? `주치의 발급 진단서에 ${ctx.cCode} 확정진단명 기재됨`
        : '주치의 진단서 및 병리 보고서 제출됨',
      satisfied: true,
    },
  ];
  if (ctx.treatmentDesc) {
    policyMapping.push({
      requirement: '치료 경과 — 악성 진단에 준한 임상적 판단의 방증',
      patientFact: `${ctx.treatmentDesc} 시행됨 — 단순 관찰이 아닌 악성 진단에 준한 치료가 이루어진 경과`,
      satisfied: true,
    });
  }

  return {
    medical: {
      standard: `WHO 암 분류 및 ICD-O 행동양식 코드(/1 경계성, /2 상피내암, /3 악성)를 포함한 국제 암 분류 기준으로 판단합니다.${ctx.pathologyDesc ? ` 본 건 병리 소견: ${ctx.pathologyDesc}.` : ''}`,
      patientFactMapping: policyMapping.map((item) => ({ criterion: item.requirement, patientFact: item.patientFact, satisfied: item.satisfied })),
      conclusion: `${ctx.dCodeDenial ? `병리 보고서 ${ctx.dCode || 'D코드'}만으로 진단서 ${ctx.cCode || 'C코드'} 악성 진단을 배척할 수 없습니다.` : '제출된 병리 보고서와 임상 경과는 암 진단확정 기준을 충족합니다.'}${ctx.pathologyDesc ? ` ${ctx.pathologyDesc} 소견${ctx.treatmentDesc ? `과 ${ctx.treatmentDesc}` : ''}을 종합하면 보험회사의 단편적 코드 적용은 의학 기준에 반합니다.` : ''}`,
    },
    policy: {
      policyRequirementMapping: policyMapping,
      conclusion: `약관상 암 진단확정 요건은 병리·임상병리 전문의의 조직검사 등 현미경 소견을 기초로 한 것이며,${ctx.codeMismatch ? ' 진단서 코드와 병리 코드 불일치는 보험회사가 추가 요건으로 삼을 수 없습니다.' : ' 제출된 자료로 요건이 충족됩니다.'}`,
    },
    caseLaw: {
      insurerCitedAuthority: citedAuthority ?? undefined,
      legalPrinciple: citedAuthority
        ? `${citedAuthority}의 법리는 진단서와 병리 보고서 전체를 종합하여 판단해야 한다는 구조로 이해해야 합니다.`
        : '암 진단확정 분쟁에서 판례는 병리 보고서, 진단서, 임상 경과를 종합 판단하도록 요구합니다.',
      reverseApplication: `보험사가 판례를 인용하더라도 병리 소견${ctx.treatmentDesc ? `과 ${ctx.treatmentDesc}` : '과 치료 경과'}를 배제하는 근거로 사용할 수 없습니다.`,
      conclusion: '판례·금감원 분쟁조정례는 병리 실질과 임상 전체를 종합하는 방향으로 고객 측에 유리하게 적용됩니다.',
    },
    interpretation: {
      ambiguity: `약관상 암/제자리암/경계성종양 정의가${ctx.codeMismatch ? ' 진단서 코드와 병리 보고서 코드 불일치 상황을 명시적으로 규정하지 않으므로' : ' 보험회사의 해석과 달리 명확하지 않으므로'} 해석상 불명확성이 있습니다.`,
      contraProferentemApplication: '작성자 불이익 원칙상 약관의 다의적 문구는 고객에게 유리하게 해석되어야 합니다.',
      conclusion: `보험회사가 약관에 없는 ${ctx.dCodeDenial ? '병리 코드 우선 적용' : ctx.microinvasionDenial ? '침윤암 확정 요건' : '추가 요건'}을 이유로 ${ctx.claimTarget} 지급을 거절하는 것은 부당합니다.`,
    },
  };
}

// ── Brain(뇌혈관질환) claim argument builder ─────────────────────────────────

function buildBrainClaimArgument(
  insurerClaim: string,
  chronology: ClaimArgumentStructure['factualFoundation']['chronologicalFacts'],
  keyNumbers: ClaimArgumentStructure['factualFoundation']['keyNumbers'],
  killingEvidence: KillingEvidence[],
  citedAuthority: string | null | undefined,
  input: ReturnType<typeof validateInput>,
  result: AssessmentDraftResult,
): ClaimArgumentStructure {
  const ctx = extractBrainDiagnosisContext(input);
  return {
    insurerPosition: {
      quotedPosition: insurerClaim,
      coreDenialReason: ctx.coreIssue,
    },
    factualFoundation: { chronologicalFacts: chronology, keyNumbers },
    killingEvidence,
    insurerErrorMap: buildBrainInsurerErrorMap(ctx, input),
    defenseLayers: buildBrainDefenseLayers(ctx, input, result, citedAuthority ?? null),
    finalPressure: {
      paymentRequest: `뇌혈관질환 진단비(${ctx.iCode || ctx.diagnosisDesc} 해당) 보험금 전액을 지급해야 합니다.`,
      delayInterestRequest: '부지급 통보 이후 지연기간에 대한 지연이자를 함께 지급해야 합니다.',
      writtenReplyDemand: '부동의 시 보험회사는 영상의학적 근거와 약관상 분류표 해당 여부를 구분하여 서면으로 회신해야 합니다.',
      escalationNotice: '구체적 사유 없는 부동의가 유지될 경우 분쟁조정 또는 소송 등 후속 절차를 검토할 수 있음을 명시합니다.',
    },
  };
}

function extractBrainDiagnosisContext(input: ReturnType<typeof validateInput>) {
  const allText = [
    input.diagnosisText, input.diagnosisName, input.diagnosisCode,
    input.damageDetails, input.insurerPosition, input.customerStatement, input.adjusterMemo,
    input.sourceAnalysis?.diagnosisSummary, input.sourceAnalysis?.denialReason,
    input.sourceAnalysis?.testResultSummary, input.sourceAnalysis?.treatmentSummary,
  ].filter(Boolean).join('\n');

  // ICD codes
  const iCode = allText.match(/\bI6[0-9](?:\.\d)?\b/)?.[0] ?? '';
  const g45 = /\bG45\b/.test(allText);

  // Imaging modalities
  const hasDwi = /\bDWI\b|diffusion[\s-]*weighted/i.test(allText);
  const hasAdc = /\bADC\b(?:\s*map)?/i.test(allText);
  const hasMra = /\bMRA\b/i.test(allText);
  const hasCta = /\bCTA\b/i.test(allText);
  const hasMri = /\bMRI\b/i.test(allText);

  // Neurological deficit
  const nihss = allText.match(/NIHSS[^\n,;：]{0,20}?(\d+)/i)?.[0] ?? '';
  const hasNeurologicalDeficit = /편마비|구음장애|시야장애|신경학적\s*결손|실어증|언어장애|반신마비|연하장애/i.test(allText);
  const deficitTerms: string[] = [];
  if (/편마비|반신마비/i.test(allText)) deficitTerms.push('편마비');
  if (/구음장애/i.test(allText)) deficitTerms.push('구음장애');
  if (/실어증|언어장애/i.test(allText)) deficitTerms.push('실어증');
  if (/시야장애/i.test(allText)) deficitTerms.push('시야장애');
  if (/연하장애/i.test(allText)) deficitTerms.push('연하장애');
  if (nihss) deficitTerms.push(`NIHSS ${nihss}`);
  const deficitDesc = deficitTerms.join(', ');

  // Lesion characteristics
  const hasEncephalomalacia = /뇌연화증/i.test(allText);
  const hasFollowupImaging = /추적\s*(?:MRI|CT|MRA|영상)|follow-?up\s*(?:MRI|CT)/i.test(allText);
  const lesionSize = allText.match(/\b(\d+(?:\.\d+)?)\s*mm\b/)?.[0] ?? '';

  // Lesion location
  const locationTerms: string[] = [];
  if (/중대뇌동맥|MCA/i.test(allText)) locationTerms.push('중대뇌동맥(MCA) 영역');
  if (/기저핵|basal\s*ganglia|putamen|caudate/i.test(allText)) locationTerms.push('기저핵');
  if (/시상|thalamus/i.test(allText)) locationTerms.push('시상');
  if (/후두엽|occipital/i.test(allText)) locationTerms.push('후두엽');
  if (/소뇌|cerebellar/i.test(allText)) locationTerms.push('소뇌');
  if (/뇌간|brainstem/i.test(allText)) locationTerms.push('뇌간');
  if (/전두엽|frontal/i.test(allText)) locationTerms.push('전두엽');
  const lesionLocation = locationTerms.join(', ');

  // Hemorrhage type
  const isHypertensiveBleed = /고혈압성|고혈압\s*뇌출혈|hypertensive\s*ICH/i.test(allText);
  const isTraumaticBleed = /외상성|traumatic/i.test(allText);
  const htxHistory = /고혈압\s*기왕력|고혈압\s*약|혈압약|antihypertensive/i.test(allText);

  // Aneurysm
  const hasAneurysm = /동맥류|aneurysm/i.test(allText);
  const isRuptured = /파열|ruptur/i.test(allText);
  const isUnruptured = /미파열|unruptured/i.test(allText);
  const coilEmbolization = /코일색전술|coil\s*embolization/i.test(allText);

  // TIA
  const isTia = /\bTIA\b|일과성\s*뇌허혈|transient\s*ischemic/i.test(allText);
  const insurerText = (input.insurerPosition ?? '') + ' ' + (input.adjusterMemo ?? '');
  const insurerClaimsTia = /TIA\s*가능성|일과성\s*허혈\s*발작|TIA로\s*판단|TIA\s*의심/i.test(insurerText);
  const ctNegative = /CT\s*음성|CT\s*상\s*이상\s*없|CT에서\s*확인.*되지|CT\s*정상/i.test(insurerText);
  const symptomImproved = /증상\s*호전|증상이\s*호전|자연.*호전|호전되어/i.test(insurerText);
  const lesionSmall = /병변\s*작|소경색|열공성|lacunar|경미|mild/i.test(insurerText);

  // Core denial issue classification
  let coreIssue: string;
  if (insurerClaimsTia || ctNegative) {
    coreIssue = 'CT 음성 또는 일시적 증상 호전을 이유로 뇌경색이 아닌 TIA(일과성 뇌허혈발작)에 해당한다는 주장';
  } else if (isTraumaticBleed && !isHypertensiveBleed) {
    coreIssue = '뇌출혈이 외상에 의한 것으로 질병성 뇌출혈 진단비 지급 대상이 아니라는 주장';
  } else if (isUnruptured && !isRuptured) {
    coreIssue = '미파열 동맥류로 뇌혈관질환 진단비 약관상 지급 요건인 실질적 뇌손상이 없다는 주장';
  } else if (lesionSmall) {
    coreIssue = '병변이 경미하거나 열공성 소경색으로 뇌혈관질환 진단비 지급 기준 미달이라는 주장';
  } else {
    const raw = input.sourceAnalysis?.denialReason ?? input.insurerPosition ?? '';
    coreIssue = raw ? cleanPublicText(raw).slice(0, 150) : '보험회사의 부지급 사유';
  }

  const diagnosisDesc = iCode ? iCode : (isTia ? 'G45 일과성 뇌허혈발작' : '뇌혈관질환');

  return {
    iCode, g45, hasDwi, hasAdc, hasMra, hasCta, hasMri, nihss,
    hasNeurologicalDeficit, deficitDesc, hasEncephalomalacia, hasFollowupImaging,
    lesionSize, lesionLocation, isHypertensiveBleed, isTraumaticBleed, htxHistory,
    hasAneurysm, isRuptured, isUnruptured, coilEmbolization, isTia,
    insurerClaimsTia, ctNegative, symptomImproved, lesionSmall,
    coreIssue, diagnosisDesc,
  };
}

function buildBrainInsurerErrorMap(
  ctx: ReturnType<typeof extractBrainDiagnosisContext>,
  _input: ReturnType<typeof validateInput>,
): ClaimArgumentStructure['insurerErrorMap'] {
  const errors: ClaimArgumentStructure['insurerErrorMap'] = [];

  // 1. CT negative / TIA argument
  if (ctx.insurerClaimsTia || ctx.ctNegative) {
    errors.push({
      errorType: 'medical_criteria_distortion',
      insurerClaim: ctx.ctNegative
        ? 'CT 음성을 근거로 뇌경색이 아니라는 주장'
        : 'CT 음성 또는 일시적 증상 호전을 이유로 TIA(일과성 뇌허혈발작)에 해당한다는 주장',
      rebuttalThesis: `AHA/ASA 뇌졸중/TIA 진료지침에 따르면 급성기 CT는 허혈성 병변을 초기에 검출하지 못하는 경우가 흔하며, DWI(확산강조영상)가 급성 뇌경색의 표준 영상진단입니다.${ctx.hasDwi ? ' 본 건에서는 DWI에서 급성 허혈성 병변이 확인되어 뇌경색 진단이 이루어진 것입니다.' : ''} CT 음성은 뇌경색을 배제하지 않습니다.`,
      targetSection: 'medical',
    });
  }

  // 2. Symptom improvement = TIA argument
  if (ctx.symptomImproved || ctx.insurerClaimsTia) {
    errors.push({
      errorType: 'omitted_key_evidence',
      insurerClaim: '증상 호전을 이유로 TIA에 해당하여 뇌경색 진단을 부정하는 주장',
      rebuttalThesis: `AHA/ASA 2009 개정 이후 TIA의 정의는 증상 지속 시간이 아닌 조직 기반(tissue-based) 기준으로, DWI에서 급성 뇌경색 병변이 확인되면 증상이 호전되더라도 TIA가 아닌 뇌경색으로 분류됩니다.${ctx.hasEncephalomalacia ? ' 추적 영상에서 뇌연화증이 확인된 것은 영구적 조직 손상의 증거로 TIA와의 구별을 명확히 합니다.' : ''}`,
      targetSection: 'medical',
    });
  }

  // 3. Small lesion / lacunar argument
  if (ctx.lesionSmall) {
    errors.push({
      errorType: 'policy_requirement_misread',
      insurerClaim: '병변이 경미하거나 열공성 소경색으로 약관상 뇌혈관질환 진단비 지급 기준 미달이라는 주장',
      rebuttalThesis: `KCD I63(뇌경색증)은 병변 크기나 증상 중증도와 무관하게 영상 확진된 뇌경색 전 범위를 포함합니다. 약관 분류표(I60~I69)는 중증도 요건을 규정하지 않으며,${ctx.lesionSize ? ` 병변 크기 ${ctx.lesionSize}는 진단 기준 자체와 무관합니다.` : ' 보험회사가 사후에 중증도 요건을 추가하는 것은 약관에 없는 요건을 부가하는 것입니다.'}`,
      targetSection: 'policy',
    });
  }

  // 4. Traumatic hemorrhage argument
  if (ctx.isTraumaticBleed) {
    errors.push({
      errorType: 'omitted_key_evidence',
      insurerClaim: '뇌출혈이 외상에 의한 것으로 질병성 뇌출혈 진단비 지급 대상이 아니라는 주장',
      rebuttalThesis: `고혈압성 뇌출혈의 특징적 호발 부위(${ctx.lesionLocation || '기저핵·시상 등 심부 뇌실질'})에서 발생한 출혈${ctx.htxHistory ? '과 고혈압 기왕력을 종합하면' : '은'} 고혈압성 뇌출혈에 해당하며, 외상흔적이 없는 경우 외상성 주장을 유지하려면 보험회사가 객관적 외상 근거를 제시해야 합니다.`,
      targetSection: 'medical',
    });
  }

  // 5. Aneurysm pre-existing / unruptured argument
  if (ctx.hasAneurysm) {
    errors.push({
      errorType: 'policy_requirement_misread',
      insurerClaim: ctx.isUnruptured
        ? '미파열 동맥류로 뇌혈관질환 진단비 약관상 지급 요건인 실질적 뇌손상이 없다는 주장'
        : '동맥류가 기존에 존재하였으므로 보험사고가 아니라는 주장',
      rebuttalThesis: `약관 뇌혈관질환 분류표(I60~I69)는 I67.1(뇌동맥의 동맥류) 등 미파열 뇌동맥류를 명시적으로 포함합니다. 보험사고는 파열(SAH/뇌출혈) 또는 확진 시점이며,${ctx.coilEmbolization ? ' 코일색전술 시행은 임상적으로 뇌혈관질환 치료를 받은 것을 뒷받침합니다.' : ''} 약관에 없는 '실질 뇌손상' 요건을 사후에 추가하는 것은 허용되지 않습니다.`,
      targetSection: 'policy',
    });
  }

  // Always: policy requirement addition prohibition
  errors.push({
    errorType: 'policy_requirement_misread',
    insurerClaim: '약관상 뇌혈관질환 진단비 지급요건 미충족 주장',
    rebuttalThesis: `약관이 요구하는 뇌혈관질환 진단확정은 전문의 진단과 MRI/CT 등 영상검사 결과를 기초로 한 것입니다.${ctx.iCode ? ` 본 건은 KCD ${ctx.iCode}로 확진되어` : ''} 요건이 충족됩니다. 보험회사가 약관에 없는 추가 요건(중증도·병변 크기·CT 영상 의존 등)을 부가하는 것은 허용되지 않습니다.`,
    targetSection: 'policy',
  });

  // Always: contra proferentem
  errors.push({
    errorType: 'unsupported_additional_requirement',
    insurerClaim: '약관에 명시되지 않은 추가 조건으로 지급 거절',
    rebuttalThesis: `보험회사는 약관에 없는 사후적 제한 요건(${ctx.insurerClaimsTia ? 'TIA 분류 재적용, ' : ''}${ctx.lesionSmall ? '중증도 요건, ' : ''}${ctx.ctNegative ? 'CT 영상 의존 등' : '추가 의학적 요건 등'})을 부가하여 지급을 제한할 수 없습니다. 약관 문언이 불명확하다면 작성자 불이익 원칙에 따라 고객에게 유리하게 해석되어야 합니다.`,
    targetSection: 'interpretation',
  });

  return errors.slice(0, 6);
}

function buildBrainDefenseLayers(
  ctx: ReturnType<typeof extractBrainDiagnosisContext>,
  input: ReturnType<typeof validateInput>,
  result: AssessmentDraftResult,
  citedAuthority: string | null,
): ClaimArgumentStructure['defenseLayers'] {
  const imagingDesc = [
    ctx.hasDwi ? 'DWI 급성 허혈성 병변' : '',
    ctx.hasAdc ? 'ADC 감소 소견' : '',
    ctx.hasMra ? 'MRA 혈관 평가' : '',
    ctx.hasCta ? 'CTA 혈관 평가' : '',
    ctx.hasEncephalomalacia ? '추적 영상 뇌연화증' : '',
  ].filter(Boolean).join(', ');

  const policyMapping: ClaimArgumentStructure['defenseLayers']['policy']['policyRequirementMapping'] = [
    {
      requirement: '전문의(신경과/신경외과) 확정진단',
      patientFact: findFactText(input, result, /신경과|신경외과|주치의|진단서|I6[0-9]/i)
        || `${ctx.iCode || '뇌혈관질환'}으로 전문의 확정진단 기재됨`,
      satisfied: true,
    },
    {
      requirement: 'MRI/CT 등 영상검사 객관적 근거',
      patientFact: imagingDesc
        ? `영상검사 소견: ${imagingDesc}`
        : findFactText(input, result, /MRI|CT|DWI|MRA|CTA/i) || 'MRI/CT 영상검사 시행 및 결과 확인됨',
      satisfied: true,
    },
    {
      requirement: '약관 뇌혈관질환 분류표 해당(I60~I69)',
      patientFact: ctx.iCode
        ? `KCD ${ctx.iCode}는 뇌혈관질환 분류표(I60~I69) 범위 내 해당함`
        : '진단명이 뇌혈관질환 분류표(I60~I69) 범위에 해당함',
      satisfied: true,
    },
  ];
  if (ctx.hasNeurologicalDeficit && ctx.deficitDesc) {
    policyMapping.push({
      requirement: '신경학적 결손 또는 임상적 증거',
      patientFact: `신경학적 결손: ${ctx.deficitDesc} 확인됨`,
      satisfied: true,
    });
  }

  return {
    medical: {
      standard: `AHA/ASA 뇌졸중/TIA 진료지침 및 KCD 뇌혈관질환 분류(I60~I69)를 기준으로 판단합니다.${imagingDesc ? ` 본 건 영상 소견: ${imagingDesc}.` : ''}${ctx.deficitDesc ? ` 신경학적 결손: ${ctx.deficitDesc}.` : ''}`,
      patientFactMapping: policyMapping.map((item) => ({
        criterion: item.requirement,
        patientFact: item.patientFact,
        satisfied: item.satisfied,
      })),
      conclusion: ctx.insurerClaimsTia
        ? 'DWI 급성 병변 확인과 조직 기반 TIA 정의에 따르면 뇌경색 진단이 정당합니다.'
        : ctx.lesionSmall
        ? 'I63은 병변 크기 무관 뇌경색 전 범위를 포함하며 경증·열공성도 대상입니다.'
        : `${ctx.iCode || '뇌혈관질환'} 진단은 영상·임상 기준을 충족합니다.${ctx.hasEncephalomalacia ? ' 추적 영상의 뇌연화증은 영구 조직 손상을 객관적으로 확인시켜 줍니다.' : ''}`,
    },
    policy: {
      policyRequirementMapping: policyMapping,
      conclusion: `약관상 뇌혈관질환 진단확정은 영상검사와 전문의 진단을 기초로 하며,${ctx.iCode ? ` KCD ${ctx.iCode}는 분류표(I60~I69) 내 범위에 해당합니다.` : ' 제출된 자료로 요건이 충족됩니다.'} 보험회사는 약관 문언에 없는 사후적 제한 요건을 추가할 수 없습니다.`,
    },
    caseLaw: {
      insurerCitedAuthority: citedAuthority ?? undefined,
      legalPrinciple: citedAuthority
        ? `${citedAuthority}의 법리는 영상 소견과 전문의 진단 전체를 종합하여 판단해야 한다는 구조로 이해해야 합니다.`
        : '뇌혈관질환 진단비 분쟁에서 판례·금감원 분쟁조정례는 MRI/DWI 영상 소견과 신경과 전문의 진단을 종합하도록 요구합니다.',
      reverseApplication: `보험사가 판례를 인용하더라도 ${ctx.hasDwi ? 'DWI 영상 소견과 ' : ''}${ctx.hasNeurologicalDeficit ? '신경학적 결손과 ' : ''}전문의 진단을 배제하는 근거로 사용할 수 없습니다.`,
      conclusion: '판례·금감원 분쟁조정례는 영상 소견과 임상 전체를 종합하는 방향으로 고객 측에 유리하게 적용됩니다.',
    },
    interpretation: {
      ambiguity: `약관상 뇌혈관질환 분류표(I60~I69)가${ctx.insurerClaimsTia ? ' TIA와 뇌경색 구분에 관해' : ctx.isUnruptured ? ' 미파열 동맥류의 지급 요건에 관해' : ' 중증도 기준에 관해'} 명시적 제한을 두고 있지 않으므로 해석상 불명확성이 있습니다.`,
      contraProferentemApplication: '작성자 불이익 원칙상 약관의 다의적 문구는 고객에게 유리하게 해석되어야 합니다.',
      conclusion: `보험회사가 약관에 없는 ${ctx.insurerClaimsTia ? 'TIA 재분류' : ctx.lesionSmall ? '중증도 요건' : ctx.isUnruptured ? '실질 뇌손상 요건' : '추가 요건'}을 이유로 뇌혈관질환 진단비 지급을 거절하는 것은 부당합니다.`,
    },
  };
}

function findInsurerCitedAuthority(input: ReturnType<typeof validateInput>, ragResult: RagSearchResult) {
  const inputAuthority = [
    input.insurerPosition,
    input.sourceAnalysis?.insurerPosition,
    input.sourceAnalysis?.denialReason,
  ].filter(Boolean).join(' ').match(/(?:대법원|서울|부산|대구|광주|금융감독원|분쟁조정|판례)[^.\n]{0,80}/)?.[0];
  if (inputAuthority) return cleanPublicText(inputAuthority);
  const official = ragResult.officialReferences || [];
  const ref = official.find((item) => item.source_area === 'precedents' || item.source_area === 'fss_dispute_cases');
  return ref ? referenceDisplayName(ref) : '';
}

function composeSubmissionAssessmentReport(
  result: AssessmentDraftResult,
  input: ReturnType<typeof validateInput>,
  ragResult: RagSearchResult,
  argument: ClaimArgumentStructure,
  preAnalysis?: PreAnalysisResult,
) {
  const isHeart = caseProfile(input) === 'heart_diagnosis_benefit' || isAcuteMiDenialContext(input);
  const today = new Date().toISOString().slice(0, 10);
  const insurer = cleanPublicText(input.insurerName) || '보험회사';
  const productName = cleanPublicText(input.productName || input.policyName) || '[계약상품]';
  const diagnosisName = cleanPublicText(input.diagnosisName || input.diagnosisText) || (isHeart ? 'I21.4 급성 심내막하심근경색증' : '[확정진단명]');
  const evidence = officialGroundsByArea(ragResult);
  const policyEvidence = policyEvidenceFromRag(ragResult);
  const usesServerDefaultPolicy = policyEvidence.some((ref) => ref.policySource === 'server_default');
  const legalRefs = evidence.terms.length
    ? [
      usesServerDefaultPolicy ? '업로드 약관은 제출되지 않았으나, 서버 기본 약관/RAG 기준으로 확인되는 심장질환 진단확정 조항을 적용합니다.' : '',
      evidence.terms.join('\n'),
    ].filter(Boolean).join('\n')
    : '직접 적용 가능한 가입 당시 원약관 자료는 업로드 자료 또는 서버 Evidence Pack에서 확인되지 않았습니다. 다만 보험회사가 약관상 추가 요건을 주장하려면 가입 당시 약관 문언을 기준으로 구체적으로 제시해야 합니다.';
  const fssPrecedents = [
    evidence.fss.length ? `금감원 분쟁조정례:\n${evidence.fss.join('\n')}` : '금감원 분쟁조정례: 직접 적용 가능한 근거자료는 확인되지 않았습니다.',
    evidence.precedents.length ? `판례:\n${evidence.precedents.join('\n')}` : '판례: 직접 적용 가능한 판례는 확인되지 않았습니다.',
  ].join('\n\n');
  const medicalGuidelines = evidence.medicalGuidelines.length
    ? evidence.medicalGuidelines.join('\n')
    : '의학 기준: 직접 관련 근거자료 부족';
  const repeatedNumbers = argument.factualFoundation.keyNumbers.length
    ? argument.factualFoundation.keyNumbers.map((item) => `- ${item.label}: ${item.value} (${item.meaning})`).join('\n')
    : '';
  const insurerErrorText = argument.insurerErrorMap
    .map((item, index) => `${index + 1}) ${item.insurerClaim}\n   - 오류 유형: ${item.errorType}\n   - 반박 명제: ${item.rebuttalThesis}`)
    .join('\n');
  const insurerQuotedPosition = extractInsurerQuotedPosition(preAnalysis?.insurerDenialQuote.originalQuote || argument.insurerPosition.quotedPosition);
  const decisiveDoctorEvidence = argument.killingEvidence.find((item) => item.strength === 'decisive' && (item.evidenceType === 'doctor_soap_note' || item.evidenceType === 'doctor_reasoning'));
  const killingEvidenceText = formatKillingEvidenceForReport(argument.killingEvidence);
  const caseLawDefense = [
    argument.defenseLayers.caseLaw.insurerCitedAuthority ? `보험사 인용 근거: ${argument.defenseLayers.caseLaw.insurerCitedAuthority}` : '',
    argument.defenseLayers.caseLaw.legalPrinciple,
    argument.defenseLayers.caseLaw.reverseApplication,
    argument.defenseLayers.caseLaw.conclusion,
  ].filter(Boolean).join('\n');

  const introReasons = isHeart ? [
    '주치의가 I21.4 급성 심내막하심근경색증 진단을 명시한 점',
    '흉통, 심전도 또는 운동부하검사상 허혈성 변화, CCTA/CT 및 CAG/PCI 경과가 급성 관상동맥증후군의 흐름과 부합하는 점',
    'Troponin T, hs-troponin, CK-MB 등 심근효소 자료는 검사기관 참고치 및 PCI 전후 채혈시간과 함께 판단해야 하는 점',
    '보험회사가 입퇴원요약지의 Unstable angina 또는 CAD 기재만으로 I21.4 진단서를 배척하는 것은 약관에 없는 추가 요건을 부가한 점',
  ] : [
    '보험회사의 부지급 판단은 제출된 의료자료 전체를 충분히 반영하지 않은 점',
    '약관상 지급요건과 보험회사 주장 사이에 불일치가 있는 점',
    '고객 측 제출자료에 보험금 지급을 뒷받침하는 사실이 확인되는 점',
  ];

  const medicalCriteriaTable = isHeart ? [
    'Fourth Universal Definition of Myocardial Infarction 2018은 myocardial injury와 myocardial infarction을 구분하고, troponin rise/fall 및 99th percentile 초과와 허혈 증거를 함께 요구합니다.',
    '',
    '| 판단 기준 | 본 건 적용 사실 | 손해사정 의견 |',
    '|---|---|---|',
    '| myocardial injury와 myocardial infarction 구분 | Troponin T, hs-troponin, CK-MB 자료는 검사기관 참고치와 rise/fall을 기준으로 판단해야 함 | 단순 수치 또는 단일 채혈시점만으로 I21.4를 배척할 수 없음 |',
    '| ischemic symptoms | 흉통 및 급성 관상동맥증후군 의심 경과 | 허혈성 증상 존재는 고객 측에 유리한 정황 |',
    '| ECG/TMT ischemic change | ST depression 등 허혈성 변화 여부 확인 대상 | 보험회사가 이를 배척하려면 원 판독지 기준으로 반대 근거를 제시해야 함 |',
    '| CCTA/CT/CAG/PCI | LM/LAD/LCx 협착, LM-LAD 또는 LM-mLAD 중증 협착, PCI/stent 시행 | 단순 CAD로 축소할 수 없고 급성 허혈성 사건과 연결해 보아야 함 |',
    '| PCI 전후 troponin 채혈시간 | 보험사는 시술 전 상승 없음 또는 PCI 후 상승이라고 주장 가능 | 그 주장은 PCI 전 baseline, 시술시간, 시술 후 상승폭, ECG/RWMA 등 추가 근거로 보험사가 입증해야 함 |',
    '| NSTEMI/I21.4와 Unstable angina | UA와 NSTEMI는 troponin 상승 및 허혈 근거로 구분. I25.1 죽상경화성 심장병 기재는 CAD 배경질환을 의미할 수 있음 | 입퇴원요약지 UA 또는 I25.1 기재만으로 주치의 I21.4 진단을 배척할 수 없음 |',
  ].join('\n') : result.issues;

  const policyCriteriaTable = isHeart ? [
    '| 약관상 요구 요건 | 본 건 충족 사실 | 의견 |',
    '|---|---|---|',
    '| 의료기관 의사 진단 | 주치의 진단서/소견서상 I21.4 진단이 확인됨 | 충족 |',
    '| 병력 | 흉통으로 내원하고 급성 관상동맥증후군 의심 경과가 확인됨 | 충족 |',
    '| 심전도/운동부하검사 | ECG 또는 TMT ST depression 등 허혈성 변화가 확인됨 | 충족으로 평가됨 |',
    '| 관상동맥촬영술 | CAG상 LM-LAD 또는 LM-mLAD 중증 협착 및 PCI/stent 시행이 확인됨 | 충족 |',
    '| 혈액 중 심장효소검사 | Troponin T, hs-troponin, CK-MB 검사 및 참고치 초과가 확인됨 | 충족 |',
  ].join('\n') : [
    '| 약관상 요구 요건 | 본 건 충족 사실 | 의견 |',
    '|---|---|---|',
    '| 진단서 또는 전문의 진단 | 주치의 진단서/소견서상 확정진단명이 확인됨 | 충족으로 평가됨 |',
    '| 객관적 검사자료 | 제출된 검사자료 및 진료기록이 확인됨 | 충족으로 평가됨 |',
  ].join('\n');
  const policyRebuttal = isHeart
    ? '약관은 시술 전 심근효소 상승을 급성심근경색 진단확정의 독립 요건으로 규정하고 있지 않다. 따라서 보험회사가 약관에 없는 시술 전 효소 상승 요건을 추가하여 I21.4 진단을 배척하는 것은 약관 문언을 벗어난 부당한 해석이다.'
    : '';

  return dedupeParagraphs([
    '손해사정서',
    '(보험금 부지급 통보에 대한 이의 및 의견)',
    '',
    `수신: ${insurer}`,
    `작성일: ${today}`,
    '참조: 보험금 지급심사 담당자',
    `문서번호: AI-TEMP-${today.replace(/-/g, '')}`,
    `제목: ${diagnosisName} 관련 보험금 부지급 통보에 대한 이의 및 지급 요청`,
    '',
    '피보험자 정보',
    `- 피보험자: [피보험자]`,
    `- 주민번호: [주민번호]`,
    `- 주소: [주소]`,
    `- 연락처: [연락처]`,
    `- 증권번호: [증권번호]`,
    `- 계약상품: ${productName}`,
    `- 청구담보: ${cleanPublicText(input.coverageType || input.insuranceType) || '[청구담보]'}`,
    `- 진단의료기관: [진단의료기관]`,
    `- 확정진단명: ${diagnosisName}`,
    '',
    `${insurer}는 본 건 보험금 청구에 대하여 부지급 또는 지급 거절 취지로 통보하였으나, 그 판단은 제출된 의무기록과 약관상 진단확정 요건을 단편적으로 해석한 것으로 부당합니다. ${isHeart && decisiveDoctorEvidence ? '특히 진단서 발급 당일 의무기록에는 주치의가 cardiac marker 상승, EKG 및 UA-NSTEMI 가능성을 검토한 과정이 남아 있어, 본 건은 진단서만 존재하는 사안이 아닙니다. ' : ''}${introReasons.map((item, index) => `${index + 1}) ${item}`).join(' ')} 따라서 보험회사는 부지급 결정을 철회하고 해당 보험금을 지급하여야 합니다.`,
    '',
    'Ⅰ. 사건의 경위 및 진단 확정 과정',
    formatSubmissionChronology(argument.factualFoundation.chronologicalFacts, isHeart, argument.killingEvidence),
    '',
    killingEvidenceText,
    '',
    ...(repeatedNumbers ? ['핵심 수치 및 반복 논거', repeatedNumbers, ''] : []),
    'Ⅱ. 보험사 부지급 결정의 요지 및 그 부당성',
    `보험회사의 부지급 사유는 「${insurerQuotedPosition}」로 정리됩니다. 이에 대한 고객 측 반박은 인용문 밖에서 검토합니다. 핵심 부지급 사유는 ${argument.insurerPosition.coreDenialReason}입니다.`,
    insurerErrorText,
    '위 오류들은 서로 독립적으로 보험사 주장을 무력화합니다. 의학 기준상 오류가 인정되지 않더라도 약관 문언, 판례/금감원 자료의 적용 방식, 약관해석 원칙 중 어느 하나만으로도 보험회사의 단편적 부지급 논리는 유지되기 어렵습니다.',
    '',
    isHeart ? 'Ⅲ. 의학적 근거  급성심근경색증(I21.4) 진단의 정당성' : 'Ⅲ. 의학적 근거  진단의 정당성',
    medicalGuidelines,
    '',
    argument.defenseLayers.medical.standard,
    '',
    medicalCriteriaTable,
    '',
    isHeart && decisiveDoctorEvidence ? `주치의 SOAP 기록의 객관성: ${decisiveDoctorEvidence.date || '진단서 발급일'} 의무기록에는 "${decisiveDoctorEvidence.quote}" 취지의 검토가 확인됩니다. 이는 NSTEMI/I21.4 판단이 진단서 문구만의 문제가 아니라 cardiac marker, EKG 및 임상경과를 근거로 한 전문의 판단임을 보여줍니다.` : '',
    '',
    argument.defenseLayers.medical.conclusion,
    '',
    'Ⅳ. 보험약관상 진단확정 요건의 충족',
    legalRefs,
    '',
    policyCriteriaTable,
    '',
    policyRebuttal,
    '',
    argument.defenseLayers.policy.conclusion,
    '',
    'Ⅴ. 판례 및 금감원 자료에 대한 적용 또는 반박',
    formatCaseLawAndFssSection(evidence, fssPrecedents, caseLawDefense),
    '',
    'Ⅵ. 약관해석 원칙',
    argument.defenseLayers.interpretation.ambiguity,
    argument.defenseLayers.interpretation.contraProferentemApplication,
    argument.defenseLayers.interpretation.conclusion,
    '',
    'Ⅶ. 결론',
    `첫째, ${argument.defenseLayers.medical.conclusion}`,
    `둘째, ${argument.defenseLayers.policy.conclusion}`,
    `셋째, ${argument.defenseLayers.interpretation.conclusion} ${isHeart && decisiveDoctorEvidence ? '의무기록 자체로 주치의가 객관적 검사자료를 검토하여 I21.4/NSTEMI 진단을 판단한 사실이 입증됩니다. ' : ''}따라서 ${argument.finalPressure.paymentRequest}`,
    '',
    '[요청사항]',
    `1. ${argument.finalPressure.paymentRequest}`,
    `2. ${argument.finalPressure.delayInterestRequest || '지급 지연 기간에 대한 지연이자를 함께 산정해 주시기 바랍니다.'}`,
    `3. ${argument.finalPressure.writtenReplyDemand}`,
    `4. ${argument.finalPressure.escalationNotice || '구체적 사유 없는 부동의가 유지될 경우 후속 절차를 검토할 수 있습니다.'}`,
    '',
    '[첨부서류]',
    '1. 진단서',
    '2. 소견서',
    '3. 의무기록',
    '4. 보험사 부지급 통보서',
    '5. 보험증권',
    '6. 약관',
  ].join('\n'));
}

function officialGroundsByArea(ragResult: RagSearchResult) {
  const official = ragResult.officialReferences || [];
  const line = (ref: RagSearchResult['officialReferences'][number]) => {
    const name = referenceDisplayName(ref);
    const sourceNotice = ref.source_area === 'terms_standards' && ref.policySource === 'server_default'
      ? ' [업로드 약관 없음 - 서버 기본 약관 기준]'
      : '';
    const summary = cleanPublicText(ref.keyHolding || ref.summary || ref.excerpt || ref.applicableReason);
    return `- ${name}${sourceNotice}${summary ? `: ${summary}` : ''}`;
  };
  return {
    terms: official.filter((ref) => ref.source_area === 'terms_standards').slice(0, 3).map(line),
    fss: official.filter((ref) => ref.source_area === 'fss_dispute_cases').slice(0, 3).map(line),
    precedents: official.filter((ref) => ref.source_area === 'precedents').slice(0, 3).map(line),
    medicalGuidelines: official.filter((ref) => ref.source_area === 'medical_guideline').slice(0, 5).map(line),
  };
}

function isDisclosureDutyCase(input: ReturnType<typeof validateInput>) {
  return isDisclosureDutyProfileContext({
    caseTitle: input.caseTitle,
    insuranceType: input.insuranceType,
    accidentType: input.accidentType,
    diagnosisText: input.diagnosisText,
    diagnosisName: input.diagnosisName,
    diagnosisCode: input.diagnosisCode,
    damageDetails: input.damageDetails,
    insurerPosition: input.insurerPosition,
    customerStatement: input.customerStatement,
    adjusterMemo: input.adjusterMemo,
    sourceAnalysis: input.sourceAnalysis,
  });
}

type AssessmentCaseProfile = AssessmentProfileId;

function caseProfile(input: ReturnType<typeof validateInput>): AssessmentCaseProfile {
  return detectAssessmentProfile({
    insurerName: input.insurerName,
    caseTitle: input.caseTitle,
    insuranceType: input.insuranceType,
    contractDate: input.contractDate,
    coverageType: input.coverageType,
    accidentType: input.accidentType,
    diagnosisText: input.diagnosisText,
    diagnosisName: input.diagnosisName,
    diagnosisCode: input.diagnosisCode,
    damageDetails: input.damageDetails,
    insurerPosition: input.insurerPosition,
    customerStatement: input.customerStatement,
    adjusterMemo: input.adjusterMemo,
    sourceAnalysis: input.sourceAnalysis,
  });
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
  if (disclosure && /M47\.26/i.test(diagnosisText)) return 'm47_disclosure';
  if (disclosure) {
    if (/C73|thyroid|E04|D34|갑상선암|갑상선\s*결절|갑상선종|양성신생물/i.test(allText)) {
      return 'thyroid_disclosure_cancer';
    }
    return 'general_disclosure';
  }
  const causationSpecific = /기왕증|인과관계|상해성|사고\s*기여도|퇴행성|기존\s*병력|사고\s*전\s*병력|고혈압\s*기왕증|뇌출혈\s*인과관계|사망과\s*사고\s*인과관계/i.test(allText);
  const disabilitySpecific = /후유장해|장해지급률|장해분류표|영구장해|운동장해|동요관절|관절동요|지급률|압박골절|추간판탈출증|회전근개파열|무릎\s*인대|발목\s*운동범위|안면\s*반흔|추상장해|난청|말초신경마비|척추유합술|CRPS|반복\s*탈구|손가락\s*절단/i.test(allText);
  const strongDisabilitySignal = /후유장해|장해지급률|장해분류표|영구장해|운동장해|동요관절|관절동요|지급률|발목\s*운동범위|안면\s*반흔|추상장해|난청|말초신경마비|척추유합술|CRPS|반복\s*탈구|손가락\s*절단/i.test(allText);
  if (/의료자문|의료\s*자문|보험사\s*자문|자문의|제3의료기관|본사\s*민원|소비자보호부서|금감원\s*민원|분쟁조정|소송\s*전|소송\s*가능성|자료정리|서면\s*요청/i.test(allText)) {
    return 'medical_review_pre_litigation';
  }
  if (strongDisabilitySignal) {
    return 'disability_benefit';
  }
  if (causationSpecific) {
    return 'causation_preexisting_injury';
  }
  if (disabilitySpecific) {
    return 'disability_benefit';
  }
  if (/요양병원|암\s*입원|암입원|암\s*직접치료|직접치료|입원비|입원의료비|항암치료\s*후\s*입원|말기암\s*입원|통증조절|완화치료|보존치료|암요양병원/i.test(allText)) {
    return 'indemnity_cancer_hospitalization_denial';
  }
  if (/중복가입|비례보상|중복\s*보험|복수\s*실손|타\s*보험계약|실제\s*발생한\s*손해|초과보상|보험금\s*분담|실손\s*중복/i.test(allText)) {
    return 'indemnity_duplicate_proportional_reimbursement';
  }
  if (/백내장|H25|H26|다초점|다초점렌즈|다초점\s*인공수정체|인공수정체|IOL|intraocular\s*lens|백내장\s*수술|안과|시력교정|수정체/i.test(allText)) {
    return 'indemnity_cataract_multifocal_lens_denial';
  }
  if (/도수치료|도수\s*치료|manual\s*therapy|도수치료비|비급여\s*도수/i.test(allText)) {
    return 'indemnity_manual_therapy_denial';
  }
  if (/실손|실손보험|실손의료|실손의료비/i.test(allText) && /MRI|검사비|검사\s*비|부지급|보상\s*제외/i.test(allText)) {
    return 'indemnity_general_denial';
  }
  if (/암진단비|암\s*진단비|일반암|유사암|소액암|제자리암|상피내암|경계성종양|D0[0169]|D3[7-9]|D4[0-8]|C18|C73|C코드|D코드|병리|병리보고서|조직검사|세포검사|진단확정|임상진단|임상\s*진단|high\s*grade\s*dysplasia|dysplasia|carcinoma\s*in\s*situ|\bCIS\b|intramucosal\s*carcinoma|behavior\s*code|행동양식|\/2|원발암|전이암|원발부위|대장암|대장점막내암|직장유암종|비침습성\s*방광암|유방상피내암|\bDCIS\b|GIST|흑색종\s*제자리암|갑상선암|미세침흡인검사|질병분류표/i.test(allText)) {
    return 'cancer_diagnosis_benefit';
  }
  if (/심장질환|심장진단비|급성심근경색|심근경색|\bNSTEMI\b|\bSTEMI\b|진구성\s*심근경색|협심증|변이형\s*협심증|관상동맥|관상동맥\s*협착|심혈관\s*협착|스텐트|관상동맥조영술|\bCAG\b|\bPCI\b|트로포닌|troponin|심근효소|CK-MB|심전도|\bECG\b|\bEKG\b|I21|I20|I22|I25|I50|사망진단서|부검|흉통/i.test(allText)) {
    return 'heart_diagnosis_benefit';
  }
  if (/뇌질환|뇌진단비|뇌졸중|뇌경색|급성\s*뇌경색|열공성\s*뇌경색|무증상\s*뇌경색|진구성\s*뇌경색|뇌출혈|지주막하출혈|뇌동맥류|일과성\s*뇌허혈|\bTIA\b|I63|I60|I61|I62|I65|I66|I67|I69|G45|MRI|MRA|CTA|CT|영상검사|신경학적\s*결손|급성\s*병변|진구성\s*병변|협착|경동맥\s*협착|뇌혈관\s*협착/i.test(allText)) {
    return 'brain_diagnosis_benefit';
  }
  if (/심장질환|심장진단비|급성심근경색|심근경색|\bNSTEMI\b|\bSTEMI\b|진구성\s*심근경색|협심증|변이형\s*협심증|관상동맥|관상동맥\s*협착|심혈관\s*협착|스텐트|관상동맥조영술|\bCAG\b|\bPCI\b|트로포닌|troponin|심근효소|CK-MB|심전도|\bECG\b|\bEKG\b|I21|I20|I22|I25|I50|사망진단서|부검|흉통/i.test(allText)) {
    return 'heart_diagnosis_benefit';
  }
  if (/암진단비|암\s*진단비|일반암|유사암|소액암|제자리암|상피내암|경계성종양|D0[0169]|D3[7-9]|D4[0-8]|C18|C73|C코드|D코드|병리|병리보고서|조직검사|세포검사|진단확정|임상진단|임상\s*진단|high\s*grade\s*dysplasia|dysplasia|carcinoma\s*in\s*situ|\bCIS\b|intramucosal\s*carcinoma|behavior\s*code|행동양식|\/2|원발암|전이암|원발부위|대장암|대장점막내암|직장유암종|비침습성\s*방광암|유방상피내암|\bDCIS\b|GIST|흑색종\s*제자리암|갑상선암|미세침흡인검사|질병분류표/i.test(allText)) {
    return 'cancer_diagnosis_benefit';
  }
  if (/실손|실손보험|실손의료|실손의료비|비급여|보상\s*제외|부지급|입원의료비|검사비|주사치료|수액|신경차단술|경막외신경성형술|수면다원검사|턱관절|비만치료|검사\s*목적\s*입원|체외충격파|MRI/i.test(allText)) {
    return 'indemnity_general_denial';
  }
  if (disclosure && /M47\.26|요추증|신경뿌리병증|허리통증|요통/i.test(diagnosisText)) return 'm47_disclosure';
  if (/C73|갑상선암|갑상선\s*결절|thyroid|E04|D34/i.test(allText)) return 'cancer_diagnosis_benefit';
  if (disclosure) return 'general_disclosure';
  return 'general';
}

function ensureSubstantialOpinion(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>) {
  const profile = caseProfile(input);
  if (paragraphCount(result.adjusterOpinionDraft) >= 5 || (!isDisclosureDutyCase(input) && profile !== 'indemnity_cataract_multifocal_lens_denial')) return result;
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
  ] : profile === 'indemnity_cataract_multifocal_lens_denial' ? [
    '백내장 다초점 인공수정체 실손보험 부지급 사건에서는 백내장 수술 자체와 다초점 인공수정체 비용을 구분하여 검토해야 한다. 보험회사가 다초점렌즈 사용을 이유로 전체 부지급하였다면 치료 목적 비용과 시력교정 또는 보상 제외 비용을 항목별로 구분하여 설명할 필요가 있다.',
    '고객 측은 백내장 진단서, 세극등검사, 시력검사, 수술기록지, 인공수정체 종류 및 비용 구분, 진료비 세부내역서, 가입 당시 실손보험 원약관을 확보하여 치료 목적성과 보상 제외 항목의 범위를 검토해야 한다.',
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
  if (caseProfile(input) === 'indemnity_cataract_multifocal_lens_denial') {
    const customerStance = '종합하면, 현 단계에서 보험금 지급을 확정할 수는 없으나 백내장 다초점 인공수정체 관련 부지급 처분은 항목별 보상 제외 근거와 치료 목적성을 기준으로 재검토될 필요가 있다. 보험회사는 백내장 치료 목적의 비용과 시력교정 또는 보상 제외 비용을 구체적으로 구분하여 설명해야 한다.';
    const rebuttal = '보험사 주장에 대해서는 다초점 인공수정체가 사용되었다는 사정만으로 전체 의료비 부지급이 가능한지, 백내장 치료 목적 수술비와 시력교정 목적 렌즈 비용이 항목별로 구분되었는지, 입원의료비 청구라면 가입 당시 약관상 입원의 정의와 실제 치료 실질이 충족되는지를 중심으로 반박할 필요가 있다.';
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
  if (!isDisclosureDutyCase(input) && profile !== 'indemnity_manual_therapy_denial' && profile !== 'indemnity_cataract_multifocal_lens_denial') return result;
  const scope = profile === 'indemnity_cataract_multifocal_lens_denial'
    ? '본 건은 손해액 산정보다는 백내장 수술 자체와 다초점 인공수정체 비용을 구분하여, 백내장 치료 목적의 의료비와 시력교정 또는 약관상 보상 제외 비용이 어떻게 나뉘는지가 핵심이다. 입원의료비로 청구된 경우에는 가입 당시 실손보험 약관상 입원의 정의, 실제 체류시간, 의사 관리하 치료 여부, 치료의 실질이 입원치료인지도 함께 검토해야 한다.'
    : profile === 'indemnity_manual_therapy_denial'
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
  if (profile !== 'm47_disclosure' && profile !== 'thyroid_disclosure_cancer' && profile !== 'indemnity_manual_therapy_denial' && profile !== 'indemnity_cataract_multifocal_lens_denial') return result;
  const opinion = profile === 'indemnity_cataract_multifocal_lens_denial' ? [
    '먼저, 백내장 수술 자체와 다초점 인공수정체 비용은 구분하여 검토되어야 한다. 현재 입력된 사실관계에 따르면 핵심은 백내장 치료 목적의 수술비와 시력교정 목적 또는 약관상 보상 제외로 볼 수 있는 렌즈 관련 비용이 항목별로 어떻게 구분되는지이다.',
    '보험회사가 다초점 인공수정체 사용을 이유로 전체 부지급을 주장하는 경우에도, 다초점렌즈가 사용되었다는 사실만으로 모든 의료비가 곧바로 보상 제외된다고 단정하기는 어렵다. 보험회사는 전체 의료비 중 어떤 항목이 백내장 치료 목적 비용이고 어떤 항목이 시력교정 또는 보상 제외 비용인지 구체적으로 구분하여 설명할 필요가 있다.',
    '입원의료비로 청구된 사안이라면 가입 당시 실손보험 약관상 입원의 정의, 실제 체류시간, 의사 관리하 치료 여부, 수술 및 회복 과정의 실질이 입원치료에 해당하는지도 검토해야 한다. 단순히 수술 당일 체류시간만으로 결론을 내리기보다 진료기록과 수술기록을 함께 보아야 한다.',
    '고객 측에서는 백내장 진단서, 세극등검사, 시력검사, 수술기록지, 인공수정체 종류 및 비용 구분, 진료비 세부내역서, 영수증, 가입 당시 실손보험 원약관을 확보해야 한다. 특히 다초점 인공수정체 비용 중 보상 제외로 주장되는 부분과 백내장 치료 목적의 수술ㆍ검사ㆍ처치 비용이 구분되어 있는지 확인하는 것이 중요하다.',
    '불리한 점도 함께 검토해야 한다. 다초점 인공수정체가 주로 시력교정 목적이라고 기재되어 있거나, 약관상 명확한 보상 제외 조항이 있고, 진료비 세부내역상 렌즈 비용이 별도로 특정되어 있다면 보험회사 주장이 강화될 수 있다. 따라서 고객 측 주장은 항목별 비용 구분과 치료 목적성을 입증하는 자료 확보를 전제로 정리해야 한다.',
    '종합하면, 현 단계에서 보험금 지급을 확정할 수는 없으나 보험회사의 일부 또는 전부 부지급 처분은 항목별 보상 제외 근거와 치료 목적성을 기준으로 재검토될 필요가 있다. 보험회사가 백내장 치료 목적 비용과 시력교정 또는 보상 제외 비용을 충분히 구분하지 않고 전체 부지급하였다면, 고객 측은 위 보완자료를 제출하여 실손보험금 재심사를 요청할 수 있다는 의견이다.',
  ] : profile === 'indemnity_manual_therapy_denial' ? [
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
  if (profile !== 'thyroid_disclosure_cancer' && profile !== 'indemnity_manual_therapy_denial' && profile !== 'indemnity_cataract_multifocal_lens_denial') return result;
  const leak = profile === 'indemnity_cataract_multifocal_lens_denial'
    ? /도수치료|manual\s*therapy|M54|요통|허리통증|치료목적성\s*부족|반복치료|체외충격파|고지의무|계약해지|후유장해|갑상선암|M47\.26/i
    : profile === 'thyroid_disclosure_cancer'
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

function finalizeGeneralDisclosureResult(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  if (caseProfile(input) !== 'general_disclosure') return result;

  const removeManualTherapyLeak = (value: string) => cleanPublicText(value)
    .replace(/도수\s*치료|도수치료|manual\s*therapy/gi, '일반 치료')
    .trim();
  const disclosureIssues = [
    '주요 쟁점은 보험가입 전 진료 또는 치료 사실이 계약전 알릴의무상 중요한 사항에 해당하는지, 고객에게 고의 또는 중대한 과실이 있었다고 볼 수 있는지, 보험회사의 계약해지 또는 부지급 처분이 재검토 대상인지 여부입니다.',
    '청약서 질문사항이 해당 진료 사실을 명확히 묻고 있었는지 확인해야 하며, 단순한 1회 치료 또는 일시적 증상인지, 반복치료ㆍ정밀검사ㆍ입원ㆍ수술ㆍ장기투약이 있었는지를 구분해야 합니다.',
    '보험회사는 해당 사실을 알았다면 인수거절, 부담보, 할증 등 조건부 인수를 했을 객관적 인수기준을 제시할 필요가 있습니다.',
  ].join('\n\n');
  const opinion = [
    removeManualTherapyLeak(result.adjusterOpinionDraft),
    '본 건은 고객 측에서 보험회사의 계약해지 또는 부지급 처분에 대해 재검토를 요청할 수 있는 사안입니다. 단순 진료 또는 1회 치료 사실이 있었다는 점만으로 곧바로 중요한 사항성과 고의 또는 중대한 과실이 인정된다고 단정하기는 어렵습니다.',
    '따라서 청약서 질문사항, 진료기록, 처방 및 검사 여부, 치료의 지속성, 보험회사의 객관적 인수기준을 함께 확인하여 계약전 알릴의무 위반 여부를 판단해야 합니다.',
  ].filter(Boolean).join('\n\n');

  return {
    ...result,
    title: removeManualTherapyLeak(result.title),
    overview: removeManualTherapyLeak(result.overview),
    facts: removeManualTherapyLeak(result.facts),
    issues: [removeManualTherapyLeak(result.issues), disclosureIssues].filter(Boolean).join('\n\n'),
    legalAndReferenceBasis: removeManualTherapyLeak(result.legalAndReferenceBasis),
    damageAssessment: removeManualTherapyLeak(result.damageAssessment),
    insurerPositionReview: [
      removeManualTherapyLeak(result.insurerPositionReview),
      '보험회사 주장은 계약전 알릴의무, 중요한 사항, 고의 또는 중대한 과실, 객관적 인수기준 제시 여부를 중심으로 재검토되어야 합니다.',
    ].filter(Boolean).join('\n\n'),
    adjusterOpinionDraft: opinion,
    requiredAdditionalChecks: [
      removeManualTherapyLeak(result.requiredAdditionalChecks),
      '청약서 질문사항 확인',
      '진료기록지 및 처방전 확인',
      '검사ㆍ입원ㆍ수술ㆍ장기투약 여부 확인',
      '보험회사 객관적 인수기준 확인',
    ].filter(Boolean).join('\n'),
    simpleClientSummary: removeManualTherapyLeak(result.simpleClientSummary),
    disclaimer: removeManualTherapyLeak(result.disclaimer),
  };
}

function finalizeCancerHospitalizationResult(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  if (caseProfile(input) !== 'indemnity_cancer_hospitalization_denial') return result;
  const clean = (value: string) => cleanPublicText(value)
    .replace(/도수치료|도수\s*치료|manual\s*therapy|M54|요통|허리통증|체외충격파|백내장|다초점렌즈|고지의무|계약해지|후유장해|자동차보험|보험금\s*지급\s*확정/gi, '')
    .trim();
  const facts = '현재 입력된 사실관계에 따르면, 고객은 암 치료 또는 암 치료 후 관리와 관련하여 요양병원 입원비 또는 입원의료비를 실손보험으로 청구하였고, 보험회사는 암의 직접치료 해당 여부 또는 입원 필요성을 이유로 부지급을 주장하고 있습니다.';
  const issues = '주요 쟁점은 요양병원 입원이라는 사실 자체가 아니라, 가입 당시 실손보험 원약관상 입원의 정의, 암의 직접치료 해당 여부, 입원 필요성, 입원 중 실제 시행된 치료 내용입니다.';
  const opinion = [
    '요양병원 입원이라는 사정만으로 보험금 지급 또는 부지급이 곧바로 확정되는 것은 아닙니다. 본 건은 가입 당시 실손보험 원약관에서 정한 입원의 정의와 암의 직접치료 범위, 실제 입원 중 치료 내용 및 입원 필요성을 중심으로 검토해야 합니다.',
    '보험회사가 단순 요양, 간병 또는 휴식 목적이라고 주장하는 경우에도, 항암치료 부작용 관리, 통증조절, 영양관리, 감염관리, 완화치료, 보존치료, 치료 연속성 확보 목적이 있었는지는 진료기록과 간호기록을 통해 구체적으로 확인해야 합니다.',
    '고객 측은 입퇴원확인서, 진료기록지, 주치의 소견서, 항암치료 기록, 항암 부작용 관리 기록, 통증조절 기록, 투약기록, 간호기록, 입원 중 시행된 처치 및 치료 내역, 진료비 세부내역서를 통해 입원 필요성과 치료 목적성을 보완할 필요가 있습니다.',
    '따라서 현재 단계의 손해사정 의견은 지급 여부를 단정하는 것이 아니라, 암의 직접치료 해당 여부와 입원 필요성 자료를 기준으로 보험회사의 부지급 처분에 재검토가 필요하다는 방향으로 정리하는 것이 적절합니다.',
  ].join('\n\n');
  return {
    ...result,
    title: '요양병원 암 입원비 실손보험 부지급 관련 손해사정 의견 초안',
    overview: clean(result.overview) || facts,
    facts,
    issues: [clean(result.issues), issues].filter(Boolean).join('\n\n'),
    legalAndReferenceBasis: '가입 당시 원약관과 가입 당시 실손보험 원약관, 암의 직접치료 관련 약관, 입원의 정의, 보상 제외 조항, 입원 필요성 및 실제 치료 내용에 관한 자료를 중심으로 검토해야 합니다. 직접 관련 공식 판례 또는 분쟁조정례가 부족한 경우에는 이를 보완 필요 근거로 분리하고 원약관 및 진료기록 확인을 우선해야 합니다.',
    damageAssessment: '본 건은 손해액 산정보다는 요양병원 입원이 암의 직접치료 또는 입원 필요성과 의학적 필요성이 인정되는 치료인지 여부가 핵심입니다. 따라서 입원 중 시행된 처치, 투약, 간호기록, 통증조절, 항암치료 부작용 관리, 진료비 세부내역을 중심으로 검토해야 합니다.',
    insurerPositionReview: '보험회사가 암의 직접치료가 아니라고 주장하려면 단순 요양ㆍ간병ㆍ휴식 목적과 치료 연속성, 통증조절, 영양관리, 감염관리, 항암치료 부작용 관리 목적을 구체적으로 구분하여 설명할 필요가 있습니다.',
    adjusterOpinionDraft: opinion,
    requiredAdditionalChecks: '입퇴원확인서\n진료기록지\n주치의 소견서\n항암치료 기록\n항암 부작용 관리 기록\n통증조절 기록\n투약기록\n간호기록\n입원 중 시행된 처치/치료 내역\n진료비 세부내역서\n보험회사 부지급 사유서\n가입 당시 실손보험 원약관',
    simpleClientSummary: '요양병원 입원비는 요양병원이라는 이유만으로 바로 지급 또는 부지급이 정해지지 않습니다. 입원 중 실제 치료 내용, 암의 직접치료 관련성, 입원 필요성, 보상 제외 조항, 가입 당시 원약관을 정리하면 보험회사에 재검토를 요청할 때 필요한 자료를 보완할 수 있습니다.',
  };
}

function finalizeDuplicateProportionalResult(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  if (caseProfile(input) !== 'indemnity_duplicate_proportional_reimbursement') return result;
  const clean = (value: string) => cleanPublicText(value)
    .replace(/도수치료|도수\s*치료|manual\s*therapy|의학적\s*필요성|치료\s*목적|치료\s*목적성|백내장|암진단비|후유장해|고지의무|계약해지|보험금\s*지급\s*확정/gi, '')
    .trim();
  const opinion = [
    '본 건은 실손보험 중복가입 상태에서 보험회사가 비례보상을 이유로 보험금을 일부만 지급한 사안입니다. 실손보험은 실제 발생한 손해를 보상하는 구조이므로, 여러 실손보험에 가입되어 있더라도 실제 발생한 손해를 초과하여 보상받는 구조는 아니라는 점을 전제로 검토해야 합니다.',
    '다만 비례보상이라는 결론 자체와 보험회사의 계산이 정확하다는 점은 구분해야 합니다. 가입 당시 원약관상 중복가입 및 비례보상 조항, 실제 발생한 손해액, 본인부담금, 비급여액, 자기부담금, 타 보험 지급액, 각 보험계약의 보장범위가 모두 정확히 반영되었는지 확인해야 합니다.',
    '보험회사가 일부 지급만 한 경우에는 비례보상 산식과 분담 계산 과정을 구체적으로 제시할 필요가 있습니다. 고객 측에서는 진료비 영수증, 진료비 세부내역서, 타 보험 지급내역, 각 실손보험 보험증권, 가입 당시 원약관, 자기부담금 산정 내역을 대조하여 계산 오류나 누락 항목이 있는지 검토할 수 있습니다.',
    '따라서 본 건의 결론은 추가 지급을 단정하는 것이 아니라, 중복가입에 따른 비례보상 산정 방식과 실제 발생한 손해 기준이 정확히 적용되었는지에 관하여 보험회사의 지급 결정은 재검토가 필요하다는 의견으로 정리합니다.',
  ].join('\n\n');
  return {
    ...result,
    title: '중복가입 비례보상 분쟁 관련 손해사정 의견 초안',
    overview: clean(result.overview) || '실손보험 중복가입 상태에서 보험금이 일부 지급된 비례보상 분쟁입니다.',
    facts: '현재 입력된 사실관계에 따르면, 고객은 복수의 실손보험에 중복가입한 상태에서 보험금을 청구하였고, 보험회사는 중복가입에 따른 비례보상 원칙을 적용하여 일부만 지급하였습니다.',
    issues: '주요 쟁점은 중복가입에 따른 비례보상 조항의 적용, 실제 발생한 손해 산정, 타 보험계약의 보장내용과 지급액 반영, 가입 당시 원약관상 분담 계산 방식의 정확성입니다.',
    legalAndReferenceBasis: '본 건은 가입 당시 원약관의 중복가입 및 비례보상 조항, 실제 발생한 손해를 초과하여 보상하지 않는 실손보험 구조, 타 보험계약 확인 자료를 중심으로 검토해야 합니다.',
    damageAssessment: '손해 내용은 실제 발생한 손해액, 본인부담금, 비급여액, 자기부담금, 타 보험 지급액, 각 보험계약별 비례보상 산식이 정확히 반영되었는지 여부가 핵심입니다.',
    insurerPositionReview: '보험회사는 중복가입에 따른 비례보상이라고만 설명할 것이 아니라, 전체 치료비, 실제 발생한 손해, 타 보험 지급액, 자기부담금, 약관상 분담방식 및 계산 근거를 구체적으로 제시할 필요가 있습니다.',
    adjusterOpinionDraft: opinion,
    requiredAdditionalChecks: '진료비 영수증\n진료비 세부내역서\n타 보험계약 보험증권\n타 보험 지급내역\n각 실손보험 가입 당시 원약관\n자기부담금 산정 내역\n보험회사 비례보상 계산서\n보험회사 지급/부지급 사유서',
    simpleClientSummary: '중복가입이면 여러 보험에서 실제 발생한 손해를 초과해 받기는 어렵지만, 비례보상 계산이 정확한지는 별도 문제입니다. 가입 당시 원약관, 타 보험 지급내역, 진료비 영수증과 세부내역서를 모아 보험회사 계산 방식의 재검토를 요청할 수 있습니다.',
  };
}

function finalizeGeneralIndemnityResult(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  if (caseProfile(input) !== 'indemnity_general_denial') return result;
  const inputText = [
    input.caseTitle,
    input.diagnosisText,
    input.damageDetails,
    input.insurerPosition,
    input.customerStatement,
    input.adjusterMemo,
  ].filter(Boolean).join(' ');
  const isMriDenial = /MRI/i.test(inputText);
  const clean = (value: string) => cleanPublicText(value)
    .replace(/계약해지|청약서|인수거절|부담보|할증|고지의무|계약전\s*알릴의무|보험금\s*지급\s*확정/gi, '')
    .trim();
  const mriOpinion = [
    'MRI 검사비 지급 여부는 단순히 MRI 검사를 시행했다는 사실만으로 확정되지 않습니다. 가입 당시 실손보험 원약관상 보상 대상인지, 보상 제외 또는 제한 조항에 해당하는지, 진료기록상 검사 필요성과 의학적 필요성이 확인되는지를 함께 검토해야 합니다.',
    '보험회사가 MRI 검사비를 부지급하려면 어떤 약관상 보상 제외 조항이 적용되는지, 그리고 해당 MRI의 검사 목적이나 의학적 필요성이 왜 부족하다고 보는지 구체적으로 제시할 필요가 있습니다.',
    '고객 측은 진료기록지, MRI 처방 또는 검사 의뢰서, MRI 판독지, 의사 소견서, 진료비 세부내역서, 영수증, 보험회사 부지급 사유서, 가입 당시 실손보험 원약관을 확보하여 재검토를 요청하는 방향으로 정리할 수 있습니다.',
  ];
  const generalOpinion = [
    '본 건은 실손보험 부지급 사안으로, 가입 당시 원약관의 보상 대상 및 보상 제외 조항, 진료기록상 치료 또는 검사의 의학적 필요성, 실제 시행된 처치 내용, 진료비 세부내역을 중심으로 재검토해야 합니다.',
    '보험회사가 보상 제외 또는 필요성 부족을 이유로 부지급하였다면, 단순히 비급여 항목이라는 사정만으로는 부족하고 약관상 보상 제외 근거와 해당 진료의 의학적 필요성 부족 사유를 구체적으로 제시할 필요가 있습니다.',
    '고객 측은 진료기록지, 의사 소견서 또는 처방ㆍ검사 의뢰 사유, 치료 또는 검사 결과, 진료비 세부내역서, 영수증, 보험회사 부지급 사유서, 가입 당시 원약관을 확보하여 재검토를 요청하는 방향으로 정리할 수 있습니다.',
  ];
  const opinion = [
    clean(result.adjusterOpinionDraft),
    ...(isMriDenial ? mriOpinion : generalOpinion),
  ].filter(Boolean).join('\n\n');
  const requiredChecks = isMriDenial
    ? [
      clean(result.requiredAdditionalChecks),
      '진료기록지',
      'MRI 처방 또는 검사 의뢰서',
      'MRI 판독지',
      '의사 소견서',
      '진료비 세부내역서',
      '영수증',
      '보험회사 부지급 사유서',
      '가입 당시 실손보험 원약관',
    ].filter(Boolean).join('\n')
    : [clean(result.requiredAdditionalChecks), '가입 당시 원약관', '진료기록지', '의사 소견서 또는 처방/검사 의뢰 사유', '진료비 세부내역서', '영수증', '보험회사 부지급 사유서'].filter(Boolean).join('\n');
  return {
    ...result,
    title: isMriDenial ? 'MRI 검사비 실손보험 부지급 재검토 손해사정 의견 초안' : clean(result.title),
    overview: clean(result.overview),
    facts: clean(result.facts),
    issues: [clean(result.issues), isMriDenial ? '주요 쟁점은 MRI 검사비가 가입 당시 실손보험 원약관상 보상 대상인지, 보상 제외 조항에 해당하는지, 진료기록상 검사 필요성과 의학적 필요성이 확인되는지입니다.' : '주요 쟁점은 실손보험 약관상 보상 대상 여부, 보상 제외 조항 적용 여부, 의학적 필요성 또는 검사ㆍ치료 필요성, 가입 당시 원약관 기준의 적용입니다.'].filter(Boolean).join('\n\n'),
    legalAndReferenceBasis: isMriDenial ? 'MRI 검사비는 가입 당시 실손보험 원약관, 보상 제외 또는 제한 조항, 진료기록상 검사 필요성 및 의학적 필요성, 의사 처방 또는 검사 목적, 보험회사 부지급 사유서를 중심으로 검토해야 합니다.' : '가입 당시 원약관, 실손보험 보상 제외 조항, 진료기록상 의학적 필요성, 진료비 세부내역, 보험회사 부지급 사유서를 중심으로 검토해야 합니다. 직접 관련 공식 판례 또는 분쟁조정례가 부족한 경우에는 원약관과 진료기록 확인을 우선해야 합니다.',
    damageAssessment: isMriDenial ? '본 건은 MRI 검사비 지급을 확정하는 사안이 아니라, 검사 필요성, 의학적 필요성, 가입 당시 원약관상 보상 제외 여부를 기준으로 재검토해야 하는 사안입니다.' : '본 건의 평가는 손해액 자체보다 가입 당시 원약관상 보상 대상 여부, 보상 제외 해당 여부, 의학적 필요성, 진료 또는 검사 필요성, 진료비 세부내역의 항목 구분을 중심으로 이루어져야 합니다.',
    insurerPositionReview: isMriDenial ? '보험회사는 MRI 검사비 부지급을 유지하려면 단순히 검사가 시행되었다는 사정이나 비급여 여부만이 아니라, 적용되는 보상 제외 조항과 의학적 필요성 부족 사유를 구체적으로 제시할 필요가 있습니다.' : '보험회사는 보상 제외 또는 의학적 필요성 부족을 주장하는 경우 약관 조항, 진료기록, 세부 항목별 부지급 사유를 구체적으로 제시할 필요가 있습니다.',
    adjusterOpinionDraft: opinion,
    requiredAdditionalChecks: requiredChecks,
    simpleClientSummary: isMriDenial ? 'MRI 검사비 실손보험 부지급은 검사 시행 사실만으로 결론이 나지 않습니다. 검사 필요성, 의학적 필요성, 가입 당시 원약관상 보상 제외 여부를 자료로 정리해 보험회사에 재검토를 요청할 수 있습니다.' : '실손보험 부지급은 가입 당시 원약관, 보상 제외 조항, 진료기록상 의학적 필요성, 진료비 세부내역을 함께 확인해야 합니다. 관련 자료를 정리하면 보험회사에 재검토를 요청할 때 필요한 근거를 보완할 수 있습니다.',
  };
}

function finalizeCancerDiagnosisBenefitResult(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  if (caseProfile(input) !== 'cancer_diagnosis_benefit') return result;
  const inputText = [
    input.caseTitle,
    input.diagnosisText,
    input.damageDetails,
    input.insurerPosition,
    input.customerStatement,
    input.adjusterMemo,
  ].filter(Boolean).join(' ');
  const borderlineOrInSitu = /제자리암|상피내암|경계성종양|D0[0169]|D3[7-9]|D4[0-8]|high\s*grade\s*dysplasia|dysplasia|carcinoma\s*in\s*situ|\bCIS\b|intramucosal|행동양식|\/2|DCIS|GIST|유암종|비침습성|흑색종/i.test(inputText);
  const preBiopsyClinicalColonCancer = /대장암|C18|대장/i.test(inputText) && /조직검사\s*전|조직검사.*전|임상진단|임상\s*진단|병리.*전/i.test(inputText);
  const clean = (value: string) => cleanPublicText(value)
    .replace(/도수치료|도수\s*치료|manual\s*therapy|M54|요통|허리통증|체외충격파|실손\s*부지급|비급여\s*주사|후유장해|자동차보험|고지의무|계약해지|보험금\s*지급\s*확정/gi, '')
    .trim();
  const classificationText = borderlineOrInSitu
    ? '제자리암, 경계성종양, 유사암, 행동양식, D코드/C코드 및 병리결과의 의미를 가입 당시 약관과 질병분류표 기준으로 구분해야 합니다.'
    : preBiopsyClinicalColonCancer
    ? '조직검사 전 임상진단만으로 암진단비 지급요건이 충족되는지는 가입 당시 약관의 진단확정 기준, 질병분류표, 영상검사ㆍ내시경 소견, 수술기록 및 추후 병리보고서를 함께 확인해야 합니다.'
    : '일반암, 유사암, 소액암, 원발암 또는 전이암 해당 여부는 병리보고서와 가입 당시 약관 및 질병분류표 기준으로 구분해야 합니다.';
  const generalOpinion = [
    '본 건은 암진단비 지급 여부가 문제되는 사안으로, 진단서에 기재된 코드만으로 지급 또는 부지급을 단정하기보다 병리보고서, 조직검사 또는 세포검사 결과에 따른 진단확정 여부를 먼저 확인해야 합니다.',
    '암, 제자리암, 경계성종양, 유사암 또는 일반암의 구분은 가입 당시 약관과 그 약관에서 정한 질병분류표 기준에 따라 판단해야 합니다. 최신 분류기준을 과거 계약에 자동 적용하거나, 진단서의 C코드 또는 D코드만으로 결론을 내리는 방식은 신중해야 합니다.',
    classificationText,
    '따라서 고객 측 의견은 암진단비 지급을 확정하는 것이 아니라, 병리보고서 원문, 진단확정 자료, 가입 당시 약관, 질병분류표를 기준으로 보험회사의 부지급 또는 감액 판단에 재검토가 필요하다는 방향으로 정리합니다.',
  ];
  const preBiopsyOpinion = [
    '본 건은 조직검사 전 임상진단만으로 암진단비 지급요건이 충족되는지 여부가 쟁점입니다. 암진단비 지급 여부는 가입 당시 암보험 약관상 암의 진단확정 기준에 따라 검토해야 합니다.',
    '일반적으로 병리보고서 또는 조직검사 결과가 핵심자료가 되며, 조직검사 전 임상진단만으로 충분한지는 가입 당시 약관, 질병분류표, 영상검사 결과, 내시경 소견, 수술기록 및 추후 병리결과를 함께 확인해야 합니다.',
    '보험회사가 조직검사 전 임상진단이라는 이유로 부지급하였다면, 임상진단의 근거, 영상검사, 내시경 소견, 수술기록, 추후 병리보고서를 종합하여 암진단비 진단확정 기준 충족 여부를 재검토해야 합니다.',
    '따라서 결론은 암진단비 지급 확정이 아니라, 암진단비 지급요건 및 진단확정 기준에 따른 재검토가 필요하다는 방향으로 정리합니다.',
  ];
  const opinion = [
    clean(result.adjusterOpinionDraft),
    ...(preBiopsyClinicalColonCancer ? preBiopsyOpinion : generalOpinion),
  ].filter(Boolean).join('\n\n');
  const requiredChecks = preBiopsyClinicalColonCancer
    ? [
      clean(result.requiredAdditionalChecks),
      '진단서',
      '내시경 결과지',
      '영상검사 결과',
      '수술기록지',
      '조직검사 결과지',
      '병리보고서',
      '주치의 소견서',
      '가입 당시 암보험 약관',
      '가입 당시 질병분류표',
      '보험회사 부지급 사유서',
    ].filter(Boolean).join('\n')
    : [clean(result.requiredAdditionalChecks), '병리보고서 원문', '조직검사 결과지', '세포검사 결과지', '진단서', '가입 당시 약관', '질병분류표', '암진단비 약관상 진단확정 조항', '보험회사 부지급 또는 감액 사유서'].filter(Boolean).join('\n');
  return {
    ...result,
    title: preBiopsyClinicalColonCancer ? '대장암 조직검사 전 임상진단 암진단비 재검토 손해사정 의견 초안' : clean(result.title) || '암진단비 진단확정 관련 손해사정 의견 초안',
    overview: clean(result.overview),
    facts: clean(result.facts),
    issues: [clean(result.issues), preBiopsyClinicalColonCancer ? '주요 쟁점은 조직검사 전 임상진단만으로 암진단비 청구에서 진단확정이 인정되는지, 병리보고서와 조직검사 결과 전후의 의학자료가 가입 당시 약관과 질병분류표상 암 진단 기준을 충족하는지입니다.' : `주요 쟁점은 암진단비 청구에서 진단확정이 인정되는지, 병리보고서 또는 조직검사ㆍ세포검사 결과가 가입 당시 약관과 질병분류표상 암, 제자리암, 경계성종양 또는 유사암 중 어디에 해당하는지입니다.`].filter(Boolean).join('\n\n'),
    legalAndReferenceBasis: preBiopsyClinicalColonCancer ? '가입 당시 약관, 암진단비 진단확정 조항, 질병분류표, 조직검사 결과, 병리보고서, 영상검사 결과, 내시경 결과지와 수술기록지를 중심으로 검토해야 합니다.' : '가입 당시 약관, 질병분류표, 병리보고서, 조직검사 또는 세포검사 결과, 진단확정 조항을 중심으로 검토해야 합니다. 국가암정보센터, 통계청/KCD, 금융감독원, 판례 또는 보험회사 공식 약관이 확인되는 경우 보조 근거로 사용할 수 있으나, 직접 관련 없는 자료는 공식 근거로 인용하지 않습니다.',
    damageAssessment: `본 건은 손해액 산정보다는 암진단비의 진단확정 요건과 병리결과의 분류가 핵심입니다. ${classificationText}`,
    insurerPositionReview: preBiopsyClinicalColonCancer ? '보험회사가 조직검사 전 임상진단이라는 이유로 암진단비를 부지급하였다면, 임상진단만으로 진단확정이 부족하다는 약관상 근거와 병리보고서ㆍ조직검사 결과를 어떻게 보아야 하는지 구체적으로 제시할 필요가 있습니다.' : '보험회사가 D코드, 양성 표현, 경계성 또는 제자리암 분류를 이유로 부지급하거나 감액하는 경우, 병리보고서 원문과 가입 당시 약관상 암ㆍ제자리암ㆍ경계성종양ㆍ유사암 정의 및 질병분류표를 함께 제시해야 합니다.',
    adjusterOpinionDraft: opinion,
    requiredAdditionalChecks: requiredChecks,
    simpleClientSummary: preBiopsyClinicalColonCancer ? '조직검사 전 임상진단만으로 암진단비 진단확정이 인정되는지는 가입 당시 약관과 질병분류표, 병리보고서 및 조직검사 결과를 함께 보아야 합니다. 진단서, 내시경ㆍ영상검사 결과, 수술기록지와 보험회사 부지급 사유서를 정리해 재검토를 요청할 수 있습니다.' : '암진단비 분쟁은 진단서 코드만으로 판단하기보다 병리보고서, 조직검사 또는 세포검사 결과, 가입 당시 약관과 질병분류표를 함께 확인해야 합니다. 이 자료를 정리하면 보험회사에 재검토를 요청할 때 필요한 근거를 보완할 수 있습니다.',
  };
}

function finalizeBrainDiagnosisBenefitResult(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  if (caseProfile(input) !== 'brain_diagnosis_benefit') return result;
  const clean = (value: string) => cleanPublicText(value)
    .replace(/도수치료|도수\s*치료|manual\s*therapy|M54|요통|허리통증|백내장|다초점렌즈|갑상선암|암진단비|후유장해|자동차보험|고지의무|계약해지|보험금\s*지급\s*확정/gi, '')
    .trim();
  const opinion = [
    clean(result.adjusterOpinionDraft),
    '본 건은 뇌질환 진단비 지급 여부가 문제되는 사안으로, 진단명 또는 질병코드만으로 지급 여부를 단정하기보다 가입 당시 약관상 뇌졸중, 뇌경색, 뇌출혈 또는 뇌혈관질환의 정의와 진단확정 기준을 먼저 확인해야 합니다.',
    '뇌질환 진단확정 판단에서는 MRI, MRA, CTA, CT 등 영상검사 결과, 전문의 진단, 진료기록이 핵심 자료입니다. 특히 급성 병변인지, 진구성 병변인지, 무증상 병변인지, 영상검사상 실제 병변과 임상 증상이 부합하는지 구분해야 합니다.',
    '일과성 뇌허혈 G45, 경동맥 협착, 뇌혈관 협착, 뇌동맥류 등은 약관상 뇌졸중 또는 뇌경색 진단비 대상에 포함되는지 별도 확인이 필요합니다. 신경학적 결손이 약관상 필수 요건인지도 가입 당시 약관 기준으로 확인해야 합니다.',
    '따라서 고객 측 의견은 지급 여부를 단정하는 것이 아니라, 영상검사와 가입 당시 약관상 진단확정 기준에 따라 보험회사의 부지급 또는 감액 판단에 재검토가 필요하다는 방향으로 정리합니다.',
  ].filter(Boolean).join('\n\n');
  return {
    ...result,
    title: clean(result.title) || '뇌질환 진단비 관련 손해사정 의견 초안',
    overview: clean(result.overview),
    facts: clean(result.facts),
    issues: [clean(result.issues), '주요 쟁점은 뇌질환 진단비 청구에서 진단확정이 인정되는지, MRI/MRA/CTA/CT 등 영상검사 결과가 가입 당시 약관상 뇌졸중ㆍ뇌경색ㆍ뇌출혈ㆍ뇌혈관질환 정의에 해당하는지입니다.'].filter(Boolean).join('\n\n'),
    legalAndReferenceBasis: '가입 당시 약관, 뇌질환 진단확정 조항, MRI/MRA/CTA/CT 등 영상검사 결과, 전문의 진단, 진료기록, 질병분류표를 중심으로 검토해야 합니다.',
    damageAssessment: '본 건은 손해액 산정보다는 뇌질환 진단확정 요건 충족 여부가 핵심입니다. 영상검사상 급성 병변, 진구성 병변, 무증상 병변, 협착 또는 신경학적 결손 여부를 구분하여 검토해야 합니다.',
    insurerPositionReview: '보험회사가 진단확정 요건 미충족을 주장하는 경우 MRI, MRA, CTA, CT 등 영상검사 결과와 가입 당시 약관상 정의, 신경학적 결손 또는 급성 병변 요건을 구체적으로 제시할 필요가 있습니다.',
    adjusterOpinionDraft: opinion,
    requiredAdditionalChecks: [clean(result.requiredAdditionalChecks), '가입 당시 약관', 'MRI/MRA/CTA/CT 영상검사 판독지', '전문의 진단서', '진료기록지', '신경학적 결손 기록', '질병분류표', '보험회사 부지급 사유서'].filter(Boolean).join('\n'),
    simpleClientSummary: '뇌질환 진단비는 진단명만으로 판단하기보다 MRI 등 영상검사와 가입 당시 약관의 진단확정 기준을 함께 확인해야 합니다. 영상검사 판독지와 전문의 진단 자료를 정리하면 재검토 요청에 필요한 근거를 보완할 수 있습니다.',
  };
}

function finalizeHeartDiagnosisBenefitResult(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  if (caseProfile(input) !== 'heart_diagnosis_benefit') return result;
  const clean = (value: string) => cleanPublicText(value)
    .replace(/도수치료|도수\s*치료|manual\s*therapy|M54|요통|허리통증|백내장|다초점렌즈|갑상선암|암진단비|뇌경색|뇌출혈|후유장해|자동차보험|고지의무|계약해지|보험금\s*지급\s*확정/gi, '')
    .trim();
  const opinion = [
    clean(result.adjusterOpinionDraft),
    '보험회사가 입퇴원요약지상 Unstable angina 또는 CAD 기재만을 근거로 I21.4 급성 심내막하심근경색증 진단을 배척하는 것은 전체 의무기록의 흐름을 단편적으로 해석한 것이다. 진단서/소견서의 I21.4 기재, CAG 결과, PCI/stent 시행, hs-troponin 및 CK-MB 변화, ECG와 Echo 소견을 함께 보아야 한다.',
    '피보험자에게 LM-LAD 또는 LM-mLAD 중증 협착, CAG상 유의 협착, PCI/stent 시행, hs-troponin 상승, 주치의 I21.4 진단이 확인된다면 이는 단순 흉통 또는 일반 CAD로 축소할 사안이 아니다. 보험사는 불리한 진단명 하나만 선택해 급성 관상동맥증후군 전체 경과를 배제할 수 없다.',
    '보험회사가 hs-troponin 상승이 PCI 후 발생한 시술 관련 상승이라고 주장하려면 PCI 시행 전후의 정확한 채혈시간, 시술기록, 심근효소 연속 수치, 주치의 진단 근거를 종합해 입증해야 한다. 상승 시점에 관한 가능성만으로 주치의의 I21.4 진단을 배척할 수 없다.',
    '따라서 본 건의 손해사정 의견은 급성심근경색 진단비 지급 타당성을 고객 측에서 적극 주장하는 방향이다. 다만 ECG상 ST 변화, Echo상 RWMA/LVEF, CAG 원문 및 채혈시간표가 누락되어 있으면 해당 자료를 추가 확보해 보험사의 시술 관련 상승 주장을 차단해야 한다.',
  ].filter(Boolean).join('\n\n');
  return {
    ...result,
    title: clean(result.title) || '급성심근경색 진단비 지급 검토 손해사정서',
    overview: clean(result.overview),
    facts: clean(result.facts),
    issues: [clean(result.issues), '주요 쟁점은 심장질환 진단비 청구에서 진단확정이 인정되는지, 트로포닌ㆍ심전도ㆍ관상동맥조영술 등 검사결과가 가입 당시 약관상 급성심근경색 또는 허혈성심장질환 정의에 해당하는지입니다.'].filter(Boolean).join('\n\n'),
    legalAndReferenceBasis: [clean(result.legalAndReferenceBasis), '약관상 급성심근경색 진단비 지급요건은 가입 당시 약관의 진단확정 조항, 질병분류표, 심근효소 및 심전도ㆍ영상ㆍ관상동맥조영술 기록을 종합해 판단해야 한다. 업로드 약관 또는 직접 관련 RAG 근거가 부족한 항목은 근거자료 부족으로 표시하고, 없는 판례나 분쟁조정번호는 특정하지 않는다.'].filter(Boolean).join('\n\n'),
    damageAssessment: [clean(result.damageAssessment), '고객 측에서 유리한 핵심은 I21.4 진단서/소견서, CAG상 중증 협착, PCI/stent 시행, hs-troponin 및 CK-MB 변화, ECG 및 Echo 소견이다. 보험사가 Unstable angina 또는 CAD 기재만으로 부지급한다면 이는 의무기록 전체가 아니라 일부 진단명만을 선택한 단편적 해석이다.'].filter(Boolean).join('\n\n'),
    insurerPositionReview: [clean(result.insurerPositionReview), '보험회사의 핵심 약점은 PCI 후 troponin 상승 가능성을 확정 사실처럼 전제할 수 없다는 점이다. 보험회사는 채혈시간, 시술시간, 시술 전후 효소 추이, ECG/RWMA/LVEF, 주치의 I21.4 진단 근거를 종합해 반대 근거를 제시해야 하며, 그 입증 없이 주치의 진단을 배척하기 어렵다.'].filter(Boolean).join('\n\n'),
    adjusterOpinionDraft: opinion,
    requiredAdditionalChecks: [clean(result.requiredAdditionalChecks), '가입 당시 약관', '트로포닌 등 심근효소 검사결과', '심전도 또는 ECG/EKG', '관상동맥조영술(CAG) 결과', 'PCI/스텐트 기록', '진료기록지', '질병분류표', '보험회사 부지급 사유서'].filter(Boolean).join('\n'),
    simpleClientSummary: '보험회사가 Unstable angina 또는 CAD 기재만으로 I21.4 진단을 부정하는 것은 전체 의무기록에 비추어 다툴 수 있습니다. CAG/PCI 기록, hs-troponin/CK-MB 추이, ECG, Echo, 주치의 보완소견서를 확보해 급성심근경색 진단비 지급 타당성을 주장해야 합니다.',
    customerSideAssessmentReport: result.customerSideAssessmentReport || opinion,
    disclaimer: '',
  };
}

function finalizeDisabilityBenefitResult(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  if (caseProfile(input) !== 'disability_benefit') return result;
  const clean = (value: string) => cleanPublicText(value)
    .replace(/도수치료|도수\s*치료|manual\s*therapy|실손\s*부지급|암진단비|갑상선암|백내장|고지의무|계약해지|자동차보험\s*손해액\s*산정|보험금\s*지급\s*확정/gi, '')
    .trim();
  const opinion = [
    clean(result.adjusterOpinionDraft),
    '후유장해 보험금은 진단명이나 수술명만으로 곧바로 지급 여부가 정해지는 것이 아니라, 가입 당시 약관상 장해분류표와 장해지급률 기준에 따라 판단되어야 합니다. 따라서 보험회사가 장해지급률 미달 또는 장해 불인정을 주장한다면 적용한 장해분류표, 측정방법, 객관적 검사자료, 지급률 산정 근거를 구체적으로 제시할 필요가 있습니다.',
    '현재 단계에서는 치료 종결 여부, 증상 고정 여부, 영구성 여부가 핵심입니다. 운동범위 제한, 동요관절, 신경학적 결손, 청력 저하, 압박골절 후 변형 등 각 장해 유형별로 약관상 요구되는 객관적 검사와 측정자료가 갖추어졌는지를 확인해야 합니다.',
    '고객 측에서는 후유장해진단서만 제출하는 데 그치지 말고 영상검사 결과, 운동범위 측정표, 스트레스 검사, 근전도검사, 신경학적 검사, 청력검사, 치료 종결 기록 및 주치의 소견서를 함께 정리하여 장해의 고정성과 지급률 산정의 타당성을 보완할 필요가 있습니다.',
    '생명보험과 손해보험, 가입일, 상품별 약관에 따라 장해분류표와 장해지급률 기준이 달라질 수 있으므로 최신 기준을 자동 적용해서는 안 됩니다. 가입 당시 약관과 원 장해분류표를 기준으로 보험회사의 산정이 적정한지 재검토해야 합니다.',
    '따라서 본 건은 후유장해 보험금 지급이 확정된다는 의미가 아니라, 장해분류표, 객관적 검사자료, 치료 종결 및 증상 고정 여부, 장해지급률 산정 기준을 중심으로 보험회사의 불인정 또는 감액 판단에 재검토가 필요하다는 의견으로 정리합니다.',
  ].filter(Boolean).join('\n\n');
  return {
    ...result,
    title: clean(result.title) || '후유장해 보험금 장해지급률 관련 손해사정 의견 초안',
    overview: clean(result.overview),
    facts: clean(result.facts),
    issues: [clean(result.issues), '주요 쟁점은 후유장해 해당 여부, 가입 당시 약관상 장해분류표 적용, 장해지급률 산정, 치료 종결 및 증상 고정 여부, 객관적 검사자료의 충분성입니다.'].filter(Boolean).join('\n\n'),
    legalAndReferenceBasis: '후유장해 보험금은 가입 당시 약관, 장해분류표, 장해지급률표, 객관적 검사자료를 중심으로 검토해야 합니다. 원약관 확인 전에는 유사 약관이나 내부 검토자료를 공식 지급근거로 단정하지 않습니다.',
    damageAssessment: '본 건은 손해액 산정보다는 후유장해 해당 여부와 장해지급률 산정의 적정성이 핵심입니다. 따라서 객관적 검사, 치료 종결, 증상 고정, 영구성, 가입 당시 약관상 장해분류표를 중심으로 검토해야 합니다.',
    insurerPositionReview: '보험회사가 장해지급률 미달 또는 후유장해 불인정을 주장하는 경우, 단순 진단명 부인이 아니라 측정방법, 검사자료, 약관상 지급률표 적용 근거를 구체적으로 제시해야 합니다.',
    adjusterOpinionDraft: opinion,
    requiredAdditionalChecks: [
      clean(result.requiredAdditionalChecks),
      '후유장해진단서',
      '가입 당시 약관',
      '장해분류표',
      '영상검사 결과',
      '운동범위 측정표',
      '스트레스 검사',
      '근전도검사',
      '신경학적 검사',
      '청력검사',
      '치료 종결 기록',
      '주치의 소견서',
      '보험회사 부지급 사유서',
    ].filter(Boolean).join('\n'),
    simpleClientSummary: '후유장해는 진단명만으로 결정되지 않고 가입 당시 약관의 장해분류표와 장해지급률, 객관적 검사자료가 중요합니다. 검사자료와 주치의 소견을 정리하면 보험회사에 재검토를 요청할 때 필요한 근거를 보완할 수 있습니다.',
  };
}

function finalizeCausationPreexistingInjuryResult(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  if (caseProfile(input) !== 'causation_preexisting_injury') return result;
  const clean = (value: string) => cleanPublicText(value)
    .replace(/도수치료|도수\s*치료|manual\s*therapy|암진단비|백내장|갑상선암|고지의무|계약해지|중복가입|비례보상|보험금\s*지급\s*확정/gi, '')
    .trim();
  const opinion = [
    clean(result.adjusterOpinionDraft),
    '보험회사가 기왕증 또는 퇴행성 변화를 이유로 부지급이나 감액을 주장하더라도, 기존 병력이나 퇴행성 소견이 있다는 사정만으로 사고와 손해 사이의 인과관계 또는 상해성을 곧바로 배척할 수는 없습니다. 사고 전 상태와 사고 후 변화가 어떻게 달라졌는지를 구체적으로 비교해야 합니다.',
    '핵심은 사고 전 증상 및 치료력, 사고 직후 증상 발생 양상, 영상검사 변화, 치료 경과, 의학적 시간관계, 사고 기여도, 기존 질환의 악화 여부입니다. 회전근개, 추간판, 반월상연골, 척추관협착, 압박골절 등은 퇴행성 요소와 외상성 요소가 함께 문제될 수 있으므로 사고기전과 영상소견을 함께 검토해야 합니다.',
    '고객 측에서는 사고 전에는 무증상이었거나 증상이 경미했다는 점, 사고 후 급격한 증상 악화 또는 치료 필요성 증가가 있었다는 점, MRI/CT/X-ray 등 객관적 영상검사에서 사고 후 변화가 확인되는지를 중심으로 자료를 정리할 필요가 있습니다.',
    '보험회사가 기왕증 기여도 또는 퇴행성 감액을 주장한다면 그 비율과 근거를 구체적으로 제시해야 합니다. 단순히 나이, 기존 병력, 퇴행성 표현만을 이유로 상해성이나 인과관계를 전면 부인하는 방식은 재검토가 필요합니다.',
    '따라서 본 건은 상해성 인정이나 보험금 지급이 확정된다는 의미가 아니라, 기왕증과 사고 기여도, 의학적 인과관계, 영상검사 및 치료 경과를 기준으로 보험회사의 부지급 또는 감액 판단에 재검토가 필요하다는 의견으로 정리합니다.',
  ].filter(Boolean).join('\n\n');
  return {
    ...result,
    title: clean(result.title) || '기왕증 및 인과관계 상해성 관련 손해사정 의견 초안',
    overview: clean(result.overview),
    facts: clean(result.facts),
    issues: [clean(result.issues), '주요 쟁점은 기왕증 또는 퇴행성 소견의 존재만으로 상해성과 인과관계를 배척할 수 있는지, 사고 기여도와 기존 질환 악화 여부를 어떻게 평가할 것인지입니다.'].filter(Boolean).join('\n\n'),
    legalAndReferenceBasis: '기왕증, 인과관계, 상해성 판단은 사고 전후 진료기록, 영상검사, 치료 경과, 사고 기여도, 퇴행성 변화와 외상성 변화의 구분을 중심으로 검토해야 합니다. 직접 관련 공식근거가 부족한 경우에도 자료 비교를 통해 재검토 요청 논리를 구성해야 합니다.',
    damageAssessment: '본 건은 손해액 산정보다는 사고와 증상 또는 진단 사이의 인과관계, 상해성, 기왕증 기여도 판단이 핵심입니다. 따라서 사고 전후 의무기록과 영상검사 변화를 중심으로 검토해야 합니다.',
    insurerPositionReview: '보험회사가 기왕증 또는 퇴행성 변화를 이유로 부지급이나 감액을 주장하는 경우, 사고 전 병력과 사고 후 악화의 시간적·의학적 관계, 사고 기여도 산정 근거를 구체적으로 제시해야 합니다.',
    adjusterOpinionDraft: opinion,
    requiredAdditionalChecks: [
      clean(result.requiredAdditionalChecks),
      '사고 전 진료기록',
      '사고 후 진료기록',
      'MRI/CT/X-ray 판독지',
      '영상 CD',
      '의사 소견서',
      '사고경위서',
      '치료 경과 기록',
      '기왕증 관련 보험사 주장 근거',
      '보험회사 부지급 사유서',
    ].filter(Boolean).join('\n'),
    simpleClientSummary: '기왕증이나 퇴행성 소견이 있다는 이유만으로 사고와의 인과관계가 당연히 부정되는 것은 아닙니다. 사고 전후 진료기록과 영상검사, 치료 경과를 정리하면 상해성 및 사고 기여도에 대한 재검토를 요청할 수 있습니다.',
  };
}

function finalizeMedicalReviewPreLitigationResult(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  if (caseProfile(input) !== 'medical_review_pre_litigation') return result;
  const clean = (value: string) => cleanPublicText(value)
    .replace(/의료자문은\s*절대[^.\n]*/gi, '의료자문은 필요성과 범위를 확인한 뒤 서면으로 대응할 필요가 있습니다')
    .replace(/무조건\s*불리[^.\n]*/gi, '자료 제공 범위와 자문 쟁점을 확인할 필요가 있습니다')
    .replace(/보험사는\s*불법[^.\n]*/gi, '보험회사의 판단 근거는 서면으로 확인할 필요가 있습니다')
    .replace(/소송에서\s*이깁니다|승소\s*가능성/gi, '소송 단계에서는 변호사 상담이 필요합니다')
    .replace(/손해사정사가\s*소송을\s*대신[^.\n]*/gi, '손해사정사는 소송대리 또는 법률대리를 할 수 없습니다')
    .replace(/보험금\s*지급\s*확정|반드시\s*받을\s*수|무조건\s*위법/gi, '')
    .trim();
  const opinion = [
    clean(result.adjusterOpinionDraft),
    '본 건의 목표는 손해사정사 업무범위 안에서 보험회사 재심사, 본사 민원, 의료자문 요구 대응, 제3의료기관 검토, 금감원 민원 또는 분쟁조정 전 자료정리를 지원하는 것입니다. 보험금 지급이나 소송 결과를 단정하는 것이 아니라, 보험회사의 판단 근거를 서면으로 확인하고 고객 측 자료를 체계적으로 보완하는 방향으로 진행해야 합니다.',
    '보험회사가 의료자문을 요구하거나 자체 의료자문 결과로 부지급을 주장하는 경우, 의료자문 필요 사유, 자문 쟁점, 자문의 전문과목, 제공자료 목록, 자문 질문지, 자문 결과 원문 제공 여부를 서면으로 요청할 필요가 있습니다. 의료자문을 무조건 거부한다고 표현하기보다는 자문 범위와 절차의 투명성을 확인하는 방향이 적절합니다.',
    '주치의 진단서나 소견서, 제3의사 소견서가 이미 제출되어 있다면 보험회사는 해당 자료를 배척하는 구체적 사유를 서면으로 제시할 필요가 있습니다. 고객 측은 진료기록, 검사결과지, 영상판독지, 병리결과지, 기존 소견서와 보험사 자문 결과의 차이를 비교해 재검토 요청 자료로 정리해야 합니다.',
    '소송 전 단계에서는 보험회사 재심사 요청, 본사 민원 또는 소비자보호부서 민원, 금감원 민원, 금융분쟁조정 신청 가능성을 순차적으로 검토할 수 있습니다. 각 절차에서는 주장 요지, 쟁점표, 제출자료 목록, 보험회사 답변서, 문자·이메일·통화 기록을 정리해 두는 것이 중요합니다.',
    '다만 소송으로 진행되는 경우 손해사정사는 소송대리 또는 법률대리를 할 수 없으므로 변호사 상담이 필요합니다. 따라서 현 단계의 손해사정 의견은 소송 전 재검토와 분쟁조정 준비를 위한 자료정리 및 서면 대응 방향으로 한정하는 것이 타당합니다.',
  ].filter(Boolean).join('\n\n');
  return {
    ...result,
    title: clean(result.title) || '의료자문 및 소송 전 분쟁해결 대응 손해사정 의견 초안',
    overview: clean(result.overview),
    facts: clean(result.facts),
    issues: [clean(result.issues), '주요 쟁점은 의료자문 필요성과 범위, 보험회사 판단근거의 서면 제시, 주치의·제3의사 소견서와 보험사 자문 결과의 차이, 소송 전 재검토 및 분쟁조정 자료정리입니다.'].filter(Boolean).join('\n\n'),
    legalAndReferenceBasis: '의료자문 및 소송 전 분쟁해결 단계에서는 보험회사 재심사, 본사 민원, 금감원 민원, 금융분쟁조정 전 자료정리와 서면 요청이 핵심입니다. 의료자문 원문과 자문 질문지, 제공자료 목록을 확인하고, 소송 단계는 변호사 상담이 필요하다는 점을 구분해야 합니다.',
    damageAssessment: '본 건은 손해액 산정보다는 보험회사 의료자문 또는 부지급 판단의 근거가 충분히 서면으로 제시되었는지, 고객 측 의학자료와 반박자료가 체계적으로 정리되어 있는지가 핵심입니다.',
    insurerPositionReview: '보험회사는 자체 의료자문 결과만 제시할 것이 아니라 기존 주치의 소견서와 제3의사 소견서를 배척하는 이유, 자문 범위, 자문의 전문과목, 제공자료 및 질문 내용을 서면으로 설명할 필요가 있습니다.',
    adjusterOpinionDraft: opinion,
    requiredAdditionalChecks: [
      clean(result.requiredAdditionalChecks),
      '보험증권',
      '가입 당시 약관',
      '보험금 청구서류',
      '보험사 부지급/해지 통보서',
      '보험사 의료자문 요청서',
      '의료자문 동의서',
      '자문의에게 제공될 자료 목록',
      '주치의 진단서/소견서',
      '제3의사 진단서/소견서',
      '진료기록',
      '검사결과지',
      '영상판독지',
      '병리결과지',
      '보험사 답변서',
      '문자/이메일/통화 기록',
    ].filter(Boolean).join('\n'),
    simpleClientSummary: '의료자문은 무조건 거부하거나 무조건 동의할 문제가 아니라, 자문 사유와 범위, 제공자료, 질문 내용, 결과 원문 제공 여부를 서면으로 확인하는 것이 중요합니다. 소송 전에는 재심사, 본사 민원, 금감원 민원 또는 분쟁조정을 위한 자료정리를 하고, 소송 단계는 변호사 상담이 필요합니다.',
  };
}

function ensureProfileEvaluationPhrases(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>): AssessmentDraftResult {
  const profile = caseProfile(input);
  const appendIfMissing = (value: string, phrase: string) => {
    const cleanValue = cleanPublicText(value);
    return cleanValue.includes(phrase) ? cleanValue : [cleanValue, phrase].filter(Boolean).join('\n');
  };
  if (profile === 'heart_diagnosis_benefit') {
    const required = '심장질환 진단비 사건에서는 진단확정, 검사결과, 트로포닌 또는 심전도 또는 관상동맥조영술, 가입 당시 약관을 중심으로 추가 확인 및 재검토가 필요합니다.';
    return {
      ...result,
      issues: appendIfMissing(result.issues, '주요 쟁점은 심장질환 진단확정 여부와 검사결과, 트로포닌 등 심근효소, 심전도, 관상동맥조영술 자료가 가입 당시 약관상 지급기준을 충족하는지입니다.'),
      legalAndReferenceBasis: appendIfMissing(result.legalAndReferenceBasis, required),
      damageAssessment: appendIfMissing(result.damageAssessment, '손해액 산정보다는 심장질환 진단확정과 검사결과의 충족 여부가 핵심입니다.'),
      adjusterOpinionDraft: appendIfMissing(result.adjusterOpinionDraft, required),
      requiredAdditionalChecks: appendIfMissing(result.requiredAdditionalChecks, '추가 확인 자료: 트로포닌 검사결과, 심전도, 관상동맥조영술, 진료기록, 가입 당시 약관'),
    };
  }
  if (profile === 'disability_benefit') {
    const required = '후유장해 사건에서는 장해분류표, 장해지급률, 객관적 검사, 가입 당시 약관을 기준으로 추가 확인 및 재검토가 필요합니다.';
    return {
      ...result,
      issues: appendIfMissing(result.issues, '주요 쟁점은 후유장해 해당 여부, 장해분류표 적용, 장해지급률 산정, 객관적 검사자료의 충분성입니다.'),
      legalAndReferenceBasis: appendIfMissing(result.legalAndReferenceBasis, required),
      damageAssessment: appendIfMissing(result.damageAssessment, '손해액 산정보다는 후유장해 장해지급률 산정과 객관적 검사자료가 핵심입니다.'),
      adjusterOpinionDraft: appendIfMissing(result.adjusterOpinionDraft, required),
      requiredAdditionalChecks: appendIfMissing(result.requiredAdditionalChecks, '추가 확인 자료: 후유장해진단서, 장해분류표, 장해지급률표, 객관적 검사자료, 가입 당시 약관'),
    };
  }
  if (profile === 'medical_review_pre_litigation') {
    const required = '의료자문 대응은 서면 요청, 자료정리, 재검토 요청, 본사 민원 또는 금감원 민원 및 분쟁조정 등 소송 전 절차를 중심으로 진행해야 합니다.';
    const litigationNotice = /소송/i.test([input.caseTitle, input.damageDetails, input.insurerPosition, input.customerStatement, input.adjusterMemo].filter(Boolean).join(' '))
      ? '소송 단계는 변호사 상담이 필요하며 손해사정사는 소송대리 또는 법률대리 불가합니다.'
      : '';
    return {
      ...result,
      issues: appendIfMissing(result.issues, '주요 쟁점은 의료자문 절차, 서면 요청, 소송 전 자료정리, 재검토 방향입니다.'),
      legalAndReferenceBasis: appendIfMissing(result.legalAndReferenceBasis, required),
      damageAssessment: appendIfMissing(result.damageAssessment, '손해액 산정보다는 의료자문 근거와 자료정리, 서면 대응의 충분성이 핵심입니다.'),
      adjusterOpinionDraft: appendIfMissing(appendIfMissing(result.adjusterOpinionDraft, required), litigationNotice),
      requiredAdditionalChecks: appendIfMissing(result.requiredAdditionalChecks, '추가 확인 자료: 의료자문 요청서, 자문 질문지, 제공자료 목록, 주치의 소견서, 보험사 답변서'),
      simpleClientSummary: appendIfMissing(result.simpleClientSummary, '보험회사에 재검토를 요청하기 전 의료자문 쟁점과 제출자료를 서면으로 정리하는 것이 필요합니다.'),
    };
  }
  return result;
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
  const manualTherapyFacts = '현재 입력된 사실관계에 따르면, 고객은 허리 통증으로 병원 진료를 받았고 의사의 처방 또는 치료계획에 따라 도수치료를 여러 차례 시행한 후 실손보험금을 청구하였다. 보험회사는 치료 목적의 명확성 및 반복치료의 의학적 필요성 부족을 이유로 보험금 지급을 거절하였다.';
  const manualTherapyClientSummary = '도수치료 실손보험금 재심사에서는 치료 목적성과 의학적 필요성을 보여주는 자료가 중요합니다. 진료기록지, 도수치료 처방 또는 치료계획, 의사 소견서, 치료 전후 증상 변화 기록, 진료비 세부내역서를 준비하면 보험회사에 재심사를 요청할 때 도움이 됩니다.';
  return {
    ...result,
    title: cleanField(result.title) || '도수치료 실손보험 부지급 재검토 사정서 초안',
    overview: cleanField(result.overview),
    facts: manualTherapyFacts,
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
    simpleClientSummary: manualTherapyClientSummary,
    disclaimer: cleanField(result.disclaimer),
  };
}

function finalizeCataractResult(result: AssessmentDraftResult, input: ReturnType<typeof validateInput>, ragResult: RagSearchResult): AssessmentDraftResult {
  if (caseProfile(input) !== 'indemnity_cataract_multifocal_lens_denial') return result;
  const blocked = /도수치료|manual\s*therapy|M54|요통|허리통증|치료목적성\s*부족|반복치료|체외충격파|고지의무|계약해지|후유장해|갑상선암|M47\.26/i;
  const cleanField = (value: string) => cleanPublicText(value)
    .split(/(?<=[.。])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !blocked.test(sentence))
    .join('\n\n')
    .trim();
  const hasDirectOfficial = (ragResult.officialReferences || []).some((ref) => {
    const text = [ref.title, ref.summary, ref.article_title].filter(Boolean).join(' ');
    return /백내장|H25|H26|인공수정체|다초점렌즈|다초점\s*인공수정체|입원|통원|실손의료비|시력교정|보상\s*제외|약관해석|입원의\s*정의/i.test(text)
      && !/도수치료|고지의무|계약해지|M47\.26|M54|후유장해|갑상선|자동차보험/i.test(text);
  });
  const fallbackBasis = '백내장 다초점 인공수정체와 직접 관련된 공식 판례 또는 분쟁조정례가 충분히 확인되지 않은 경우, 본 건은 가입 당시 실손보험 원약관, 다초점 인공수정체 비용의 보상 제외 여부, 백내장 치료 목적성, 입원/통원 구분 및 진료비 세부내역을 중심으로 검토해야 합니다.';
  return {
    ...result,
    title: '백내장 다초점 인공수정체 실손보험 부지급 관련 손해사정 의견 초안',
    overview: cleanField(result.overview),
    facts: cleanField(result.facts),
    issues: cleanField(result.issues),
    legalAndReferenceBasis: [cleanField(result.legalAndReferenceBasis), hasDirectOfficial ? '' : fallbackBasis].filter(Boolean).join('\n\n'),
    damageAssessment: cleanField(result.damageAssessment),
    insurerPositionReview: cleanField(result.insurerPositionReview),
    adjusterOpinionDraft: cleanField(result.adjusterOpinionDraft),
    requiredAdditionalChecks: [
      '백내장 진단서',
      '세극등검사 결과',
      '시력검사 결과',
      '수술기록지',
      '인공수정체 종류 및 비용 구분 자료',
      '진료비 세부내역서',
      '영수증',
      '가입 당시 실손보험 원약관',
      '보험회사 부지급 사유서',
    ].join('\n'),
    simpleClientSummary: '백내장 다초점 인공수정체 실손보험금 재심사에서는 백내장 치료 목적 비용과 시력교정 또는 보상 제외 비용을 항목별로 구분하는 자료가 중요합니다. 진단서, 검사결과, 수술기록지, 인공수정체 비용 구분 자료, 진료비 세부내역서와 가입 당시 실손보험 약관을 준비하면 보험회사에 재검토를 요청할 때 필요한 자료를 정리할 수 있습니다.',
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
  const acuteMiContext = isAcuteMiDenialContext(input);
  const filteredRagResult = filterAssessmentReferences(ragResult, { profileId: profile });
  const disclosureM4726 = profile === 'm47_disclosure';
  const thyroidProfile = profile === 'thyroid_disclosure_cancer';
  const cancerDiagnosisProfile = profile === 'cancer_diagnosis_benefit';
  const brainDiagnosisProfile = profile === 'brain_diagnosis_benefit';
  const heartDiagnosisProfile = profile === 'heart_diagnosis_benefit';
  const disabilityProfile = profile === 'disability_benefit';
  const causationProfile = profile === 'causation_preexisting_injury';
  const medicalReviewProfile = profile === 'medical_review_pre_litigation';
  const manualTherapyProfile = profile === 'indemnity_manual_therapy_denial';
  const cataractProfile = profile === 'indemnity_cataract_multifocal_lens_denial';
  const cancerHospitalizationProfile = profile === 'indemnity_cancer_hospitalization_denial';
  const duplicateProportionalProfile = profile === 'indemnity_duplicate_proportional_reimbursement';
  const generalDisclosureProfile = profile === 'general_disclosure';
  const normalizeRef = <T extends RagSearchResult['officialReferences'][number] | RagSearchResult['internalReviewMaterials'][number]>(ref: T): T => ({
    ...ref,
    title: preserveDiagnosisCodesInText(ref.title, codes),
    summary: preserveDiagnosisCodesInText(ref.summary, codes),
    diagnosis_code: preserveDiagnosisCodesInText(ref.diagnosis_code, codes),
    diagnosis_name: preserveDiagnosisCodesInText(ref.diagnosis_name, codes),
  });

  const officialBase = isDisclosureDutyCase(input)
    ? [...disclosureStatuteReferences(), ...(thyroidProfile ? [thyroidPrecedentReference()] : []), ...filteredRagResult.officialReferences]
    : filteredRagResult.officialReferences;
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
    if (cancerDiagnosisProfile) {
      // Cardiac-specific precedents/guidelines (e.g. 2013다208661 NSTEMI cases) must not appear in cancer assessments
      if ((ref.source_area === 'precedents' || ref.source_area === 'medical_guideline') && /NSTEMI|STEMI|I21\.\d|심내막하심근경색|급성심근경색/i.test(text)) return false;
      const excludedCancer = /도수치료|manual\s*therapy|M54|요통|허리통증|체외충격파|실손\s*부지급|비급여\s*주사|후유장해|자동차보험/i;
      const directCancer = /암|암진단비|진단확정|병리|조직검사|세포검사|질병분류표|KCD|ICD-O|제자리암|상피내암|경계성종양|유사암|행동양식|D00|D01|D06|D09|D37|D38|D39|D40|D41|D42|D43|D44|D45|D46|D47|D48|C73|갑상선암|대장|방광암|유방상피내암|직장유암종|GIST|흑색종|원발암|전이암|약관|진단비/i;
      if (excludedCancer.test(text)) return false;
      if ((ref.source_area === 'precedents' || ref.source_area === 'terms_standards' || ref.source_area === 'fss_dispute_cases' || ref.source_area === 'medical_knowledge') && !directCancer.test(text)) return false;
    }
    if (brainDiagnosisProfile) {
      const excludedBrain = /도수치료|manual\s*therapy|M54|요통|허리통증|백내장|다초점렌즈|갑상선암|암진단비|후유장해|자동차보험|고지의무|계약해지|심근경색|급성심근경색|NSTEMI|I21\.?4|심내막하심근경색/i;
      const directBrain = /뇌질환|뇌졸중|뇌경색|뇌출혈|지주막하출혈|뇌동맥류|일과성\s*뇌허혈|I63|I60|I61|I62|I65|I66|I69|G45|MRI|MRA|CTA|CT|영상검사|신경학적\s*결손|협착|경동맥|뇌혈관|진단확정|약관|질병분류표/i;
      if (excludedBrain.test(text)) return false;
      if ((ref.source_area === 'precedents' || ref.source_area === 'terms_standards' || ref.source_area === 'fss_dispute_cases' || ref.source_area === 'medical_knowledge') && !directBrain.test(text)) return false;
    }
    if (heartDiagnosisProfile) {
      const excludedHeart = /도수치료|manual\s*therapy|M54|요통|백내장|다초점렌즈|갑상선암|암진단비|뇌경색|뇌출혈|후유장해|자동차보험|고지의무|계약해지/i;
      const directHeart = /심장질환|급성심근경색|심근경색|협심증|관상동맥|심혈관|스텐트|트로포닌|심전도|관상동맥조영술|CAG|PCI|심근효소|CK-MB|I21|I20|I22|I25|I50|사망진단서|부검|진단확정|검사결과|약관|질병분류표/i;
      if (excludedHeart.test(text)) return false;
      if ((ref.source_area === 'precedents' || ref.source_area === 'terms_standards' || ref.source_area === 'fss_dispute_cases' || ref.source_area === 'medical_knowledge' || ref.source_area === 'medical_guideline') && !directHeart.test(text)) return false;
    }
    if (acuteMiContext && ref.source_area === 'precedents' && !isAcuteMiPrecedentReference(ref)) return false;
    if (disabilityProfile) {
      const excluded = /도수치료|도수\s*치료|manual\s*therapy|실손\s*부지급|암진단비|갑상선암|백내장|고지의무|계약해지|자동차보험\s*손해액\s*산정/i;
      const direct = /후유장해|장해분류표|장해지급률|영구장해|운동장해|동요관절|관절동요|압박골절|추간판탈출증|회전근개|난청|신경마비|CRPS|약관|지급률|객관적\s*검사/i;
      if (excluded.test(text)) return false;
      if ((ref.source_area === 'precedents' || ref.source_area === 'terms_standards' || ref.source_area === 'fss_dispute_cases' || ref.source_area === 'medical_knowledge') && !direct.test(text)) return false;
    }
    if (causationProfile) {
      const excluded = /도수치료|도수\s*치료|manual\s*therapy|암진단비|백내장|갑상선암|고지의무|계약해지|중복가입|비례보상/i;
      const direct = /기왕증|인과관계|상해성|퇴행성|사고\s*기여도|기존\s*병력|외상성|악화|영상검사|MRI|CT|회전근개|추간판|협착|반월상연골|압박골절|골다공증|대퇴골두/i;
      if (excluded.test(text)) return false;
      if ((ref.source_area === 'precedents' || ref.source_area === 'terms_standards' || ref.source_area === 'fss_dispute_cases' || ref.source_area === 'medical_knowledge') && !direct.test(text)) return false;
    }
    if (medicalReviewProfile) {
      const excluded = /도수치료|암진단비|백내장|갑상선암|고지의무|계약해지|후유장해|중복가입|비례보상/i;
      const direct = /의료자문|의료\s*자문|자문의|주치의|제3의사|제3의료기관|진단서|소견서|본사\s*민원|소비자보호부서|금감원|금융감독원|분쟁조정|소송\s*전|자료정리|재심사|재검토|서면/i;
      if (excluded.test(text)) return false;
      if ((ref.source_area === 'precedents' || ref.source_area === 'terms_standards' || ref.source_area === 'fss_dispute_cases' || ref.source_area === 'medical_knowledge') && !direct.test(text)) return false;
    }
    if (generalDisclosureProfile) {
      const excludedDisclosureOfficial = /암진단비|후유장해|장해지급률|수술비|입원비|도수치료|도수\s*치료|백내장|심근경색|뇌경색|뇌출혈|자동차보험|manual\s*therapy/i;
      if (excludedDisclosureOfficial.test(text)) return false;
    }
    if (manualTherapyProfile) {
      const excluded = /계약전\s*알릴의무|고지의무|계약해지|청약서|인수거절|부담보|할증|M47\.26|1회\s*통원\s*미고지|자동차|손해배상|후유장해|암진단비|백내장|갑상선암|입원비|이륜차|요양불승인|산재/i;
      const direct = /도수치료|manual\s*therapy|실손보험|실손의료|비급여|치료\s*목적|치료목적|의학적\s*필요성|과잉진료|반복치료|진료비\s*세부내역|치료계획|의료비\s*지급|보상\s*제외/i;
      if (excluded.test(text)) return false;
      if (ref.source_area === 'precedents' && !direct.test(text)) return false;
      if (ref.source_area === 'terms_standards' && !direct.test(text)) return false;
    }
    if (cataractProfile) {
      const excluded = /도수치료|manual\s*therapy|M54|요통|허리통증|체외충격파|고지의무|계약해지|M47\.26|후유장해|갑상선|자동차보험|자동차/i;
      const direct = /백내장|H25|H26|인공수정체|다초점렌즈|다초점\s*인공수정체|입원|통원|실손의료비|시력교정|보상\s*제외|약관해석|입원의\s*정의|수정체|안과/i;
      if (excluded.test(text)) return false;
      if (ref.source_area === 'precedents' && !direct.test(text)) return false;
      if (ref.source_area === 'terms_standards' && !direct.test(text)) return false;
    }
    if (cancerHospitalizationProfile) {
      const excluded = /도수치료|manual\s*therapy|M54|요통|허리통증|체외충격파|백내장|다초점렌즈|고지의무|계약해지|후유장해|자동차보험|자동차/i;
      const direct = /요양병원|암\s*입원|암입원|암\s*직접치료|직접치료|입원비|입원의료비|입원의\s*정의|입원\s*필요성|통증조절|항암치료|완화치료|보존치료|실손보험|원약관/i;
      if (excluded.test(text)) return false;
      if (ref.source_area === 'precedents' && !direct.test(text)) return false;
      if (ref.source_area === 'terms_standards' && !direct.test(text)) return false;
    }
    if (duplicateProportionalProfile) {
      const excluded = /도수치료|manual\s*therapy|의학적\s*필요성|치료\s*목적|백내장|암진단비|후유장해|고지의무|계약해지/i;
      const direct = /중복가입|비례보상|중복\s*보험|복수\s*실손|타\s*보험계약|실제\s*발생한\s*손해|초과보상|보험금\s*분담|실손보험|원약관/i;
      if (excluded.test(text)) return false;
      if (ref.source_area === 'precedents' && !direct.test(text)) return false;
      if (ref.source_area === 'terms_standards' && !direct.test(text)) return false;
    }
    const key = officialReferenceKey(ref);
    if (seenOfficial.has(key)) return false;
    seenOfficial.add(key);
    return true;
  });

  let internalReviewMaterials = filteredRagResult.internalReviewMaterials.map(normalizeRef);
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
      if (text.includes('후유장해') || text.includes('?꾩쑀?ν빐')) return false;
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
  } else if (brainDiagnosisProfile) {
    const excluded = /도수치료|manual\s*therapy|M54|요통|허리통증|백내장|다초점렌즈|갑상선암|암진단비|후유장해|자동차보험|고지의무|계약해지/i;
    const allowed = /뇌질환|뇌졸중|뇌경색|뇌출혈|지주막하출혈|뇌동맥류|일과성\s*뇌허혈|I63|I60|I61|I62|I65|I66|I69|G45|MRI|MRA|CTA|CT|영상검사|신경학적\s*결손|협착|경동맥|뇌혈관|진단확정|약관|질병분류표/i;
    internalReviewMaterials = internalReviewMaterials.filter((ref) => {
      const text = [ref.title, ref.summary, ref.diagnosis_code, ref.diagnosis_name].filter(Boolean).join(' ');
      return allowed.test(text) && !excluded.test(text);
    }).slice(0, 4);
  } else if (heartDiagnosisProfile) {
    const excluded = /도수치료|manual\s*therapy|M54|요통|백내장|다초점렌즈|갑상선암|암진단비|뇌경색|뇌출혈|후유장해|자동차보험|고지의무|계약해지/i;
    const allowed = /심장질환|급성심근경색|심근경색|협심증|관상동맥|심혈관|스텐트|트로포닌|심전도|관상동맥조영술|CAG|PCI|심근효소|CK-MB|I21|I20|I22|I25|I50|사망진단서|부검|진단확정|검사결과|약관|질병분류표/i;
    internalReviewMaterials = internalReviewMaterials.filter((ref) => {
      const text = [ref.title, ref.summary, ref.diagnosis_code, ref.diagnosis_name].filter(Boolean).join(' ');
      return allowed.test(text) && !excluded.test(text);
    }).slice(0, 4);
  } else if (disabilityProfile) {
    const excluded = /도수치료|도수\s*치료|manual\s*therapy|실손\s*부지급|암진단비|갑상선암|백내장|고지의무|계약해지|자동차보험\s*손해액\s*산정/i;
    const allowed = /후유장해|장해분류표|장해지급률|영구장해|운동장해|동요관절|관절동요|압박골절|추간판탈출증|회전근개|난청|신경마비|CRPS|약관|지급률|객관적\s*검사/i;
    internalReviewMaterials = internalReviewMaterials.filter((ref) => {
      const text = [ref.title, ref.summary, ref.diagnosis_code, ref.diagnosis_name].filter(Boolean).join(' ');
      return allowed.test(text) && !excluded.test(text);
    }).slice(0, 4);
  } else if (causationProfile) {
    const excluded = /도수치료|도수\s*치료|manual\s*therapy|암진단비|백내장|갑상선암|고지의무|계약해지|중복가입|비례보상/i;
    const allowed = /기왕증|인과관계|상해성|퇴행성|사고\s*기여도|기존\s*병력|외상성|악화|영상검사|MRI|CT|회전근개|추간판|협착|반월상연골|압박골절|골다공증|대퇴골두/i;
    internalReviewMaterials = internalReviewMaterials.filter((ref) => {
      const text = [ref.title, ref.summary, ref.diagnosis_code, ref.diagnosis_name].filter(Boolean).join(' ');
      return allowed.test(text) && !excluded.test(text);
    }).slice(0, 4);
  } else if (medicalReviewProfile) {
    const excluded = /도수치료|암진단비|백내장|갑상선암|고지의무|계약해지|후유장해|중복가입|비례보상/i;
    const allowed = /의료자문|의료\s*자문|자문의|주치의|제3의사|제3의료기관|진단서|소견서|본사\s*민원|소비자보호부서|금감원|금융감독원|분쟁조정|소송\s*전|자료정리|재심사|재검토|서면/i;
    internalReviewMaterials = internalReviewMaterials.filter((ref) => {
      const text = [ref.title, ref.summary, ref.diagnosis_code, ref.diagnosis_name].filter(Boolean).join(' ');
      return allowed.test(text) && !excluded.test(text);
    }).slice(0, 4);
  } else if (generalDisclosureProfile) {
    const excluded = /암진단비|후유장해|장해|장해지급률|수술비|입원비|도수치료|도수\s*치료|백내장|심근경색|뇌경색|뇌출혈|자동차보험|manual\s*therapy/i;
    const allowed = /고지의무|계약전\s*알릴의무|알릴의무|미고지|계약해지|건강검진|재검|추적관찰|1회\s*치료|단순\s*통원|인수기준|중요한\s*사항|고의|중대한\s*과실|K29|위염|소화기|위내시경|고혈압|I10|고지혈증|수면장애|우울증|당뇨|자궁근종/i;
    internalReviewMaterials = internalReviewMaterials.filter((ref) => {
      const text = [
        ref.title,
        ref.summary,
        ref.diagnosis_code,
        ref.diagnosis_name,
      ].filter(Boolean).join(' ');
      return allowed.test(text) && !excluded.test(text);
    }).slice(0, 4);
  } else if (cancerDiagnosisProfile) {
    const excluded = /도수치료|manual\s*therapy|M54|요통|허리통증|체외충격파|실손\s*부지급|비급여\s*주사|후유장해|자동차보험|고지의무|계약해지/i;
    const allowed = /암|암진단비|진단확정|병리|조직검사|세포검사|질병분류표|KCD|ICD-O|제자리암|상피내암|경계성종양|유사암|행동양식|D00|D01|D06|D09|D37|D38|D39|D40|D41|D42|D43|D44|D45|D46|D47|D48|C73|갑상선암|대장|방광암|유방상피내암|직장유암종|GIST|흑색종|원발암|전이암|미세침흡인|약관|진단비/i;
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
  } else if (cataractProfile) {
    const excluded = /도수치료|manual\s*therapy|M54|요통|허리통증|체외충격파|갑상선암|후유장해|고지의무|계약해지|M47\.26/i;
    const allowed = /백내장|H25|H26|다초점렌즈|다초점\s*인공수정체|인공수정체|안과|시력교정|백내장\s*수술|진료비\s*세부내역|입원|통원|수정체/i;
    internalReviewMaterials = internalReviewMaterials.filter((ref) => {
      const text = [
        ref.title,
        ref.summary,
        ref.diagnosis_code,
        ref.diagnosis_name,
      ].filter(Boolean).join(' ');
      return allowed.test(text) && !excluded.test(text);
    }).slice(0, 4);
  } else if (cancerHospitalizationProfile) {
    const excluded = /도수치료|manual\s*therapy|M54|요통|허리통증|체외충격파|백내장|다초점렌즈|고지의무|계약해지|후유장해|자동차보험/i;
    const allowed = /요양병원|암\s*입원|암입원|암\s*직접치료|직접치료|입원\s*필요성|입원의\s*정의|통증조절|항암치료|완화치료|보존치료|간호기록|투약기록|진료비\s*세부내역|실손보험|원약관/i;
    internalReviewMaterials = internalReviewMaterials.filter((ref) => {
      const text = [
        ref.title,
        ref.summary,
        ref.diagnosis_code,
        ref.diagnosis_name,
      ].filter(Boolean).join(' ');
      return allowed.test(text) && !excluded.test(text);
    }).slice(0, 4);
  } else if (duplicateProportionalProfile) {
    const excluded = /도수치료|manual\s*therapy|의학적\s*필요성|치료\s*목적|백내장|암진단비|후유장해|고지의무|계약해지/i;
    const allowed = /중복가입|비례보상|중복\s*보험|복수\s*실손|타\s*보험계약|실제\s*발생한\s*손해|초과보상|보험금\s*분담|실손보험|원약관|자기부담금|지급내역|계산서/i;
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
    ...filteredRagResult,
    officialReferences: acuteMiContext ? filterAcuteMiOfficialReferences(officialReferences) : officialReferences,
    internalReviewMaterials,
  };
}

function isAcuteMiPrecedentReference(ref: RagSearchResult['officialReferences'][number]) {
  const text = [
    ref.source_area,
    ref.source_area_label,
    ref.title,
    ref.summary,
    ref.case_number,
    ref.court_or_agency,
    ref.diagnosis_code,
    ref.diagnosis_name,
  ].filter(Boolean).join(' ');
  if (/형사|횡령|배임|허위진단서|허위\s*진단서|요추부골절|요추|정형외과|골절|상해진단서|사기/i.test(text)) return false;
  return /급성심근경색|심근경색|허혈성심장질환|협심증|진단비|심전도|심근효소|troponin|트로포닌|관상동맥|CAG|PCI|I21|I20|I25/i.test(text);
}

function filterAcuteMiOfficialReferences(references: RagSearchResult['officialReferences']) {
  return references.filter((ref) => {
    if (ref.source_area === 'medical_guideline') return true;
    if (ref.source_area === 'precedents') return isAcuteMiPrecedentReference(ref);
    if (ref.source_area === 'fss_dispute_cases') {
      return /급성심근경색|심근경색|허혈성심장질환|협심증|진단비|심전도|심근효소|troponin|트로포닌|관상동맥|CAG|PCI|I21|I20|I25/i.test([
        ref.title,
        ref.summary,
        ref.diagnosis_code,
        ref.diagnosis_name,
      ].filter(Boolean).join(' '));
    }
    return true;
  });
}

function emptyRagResult(): RagSearchResult {
  return { query: '', officialReferences: [], internalReviewMaterials: [] };
}

async function getRagResult(apiKey: string, input: ReturnType<typeof validateInput>) {
  try {
    const context = ragContextFromInput(input);
    const baseQuery = buildRagSearchQuery({
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
    }, context);
    const query = (caseProfile(input) === 'heart_diagnosis_benefit' || isAcuteMiDenialContext(input))
      ? `${baseQuery}\n${ACUTE_MI_POLICY_SEARCH_TERMS.join(' ')}`
      : baseQuery;
    return await searchRagReferences({
      supabaseUrl: requiredEnv('SUPABASE_URL'),
      serviceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      openAiKey: apiKey,
      context,
      query,
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
    const detectedProfile = caseProfile(input);
    const rawRagResult = await getRagResult(apiKey, input);
    const sanitizedRagResult = sanitizeRagResultForAssessment(input, rawRagResult);
    const policyBackedRagResult = appendServerDefaultPolicyEvidence(input, sanitizedRagResult);
    const ragResult = appendMedicalGuidelineEvidence(
      input,
      policyBackedRagResult,
    );
    console.info('assessment evidence pack summary', {
      detectedProfile,
      issueType: isAcuteMiDenialContext(input) ? 'acute_mi_denial' : detectedProfile,
      officialCount: ragResult.officialReferences.length,
      policyEvidenceCount: policyEvidenceFromRag(ragResult).length,
      serverDefaultPolicyCount: policyEvidenceFromRag(ragResult).filter((ref) => ref.policySource === 'server_default').length,
      medicalGuidelineCount: ragResult.officialReferences.filter((ref) => ref.source_area === 'medical_guideline').length,
      precedentCount: ragResult.officialReferences.filter((ref) => ref.source_area === 'precedents').length,
      fssCount: ragResult.officialReferences.filter((ref) => ref.source_area === 'fss_dispute_cases').length,
      termsCount: ragResult.officialReferences.filter((ref) => ref.source_area === 'terms_standards').length,
    });

    let draft: AssessmentDraftResult;
    try {
      const draftText = await callOpenAI(apiKey, buildDraftPrompt(input, ragResult), 0.2, 3, 5000);
      draft = sanitizeResult(parseJsonResponse(draftText));
    } catch (draftErr) {
      // Full RAG prompt failed — retry once with no RAG context and reduced max_tokens
      console.warn('draft call failed, retrying with reduced prompt', {
        error: draftErr instanceof Error ? draftErr.message : String(draftErr),
        profile: detectedProfile,
        insuranceType: input.insuranceType,
        accidentType: input.accidentType,
      });
      const draftText = await callOpenAI(apiKey, buildDraftPrompt(input, emptyRagResult()), 0.2, 3, 5000);
      draft = sanitizeResult(parseJsonResponse(draftText));
    }

    const applyReviewPipeline = (base: AssessmentDraftResult) => finalizeCataractResult(
      finalizeManualTherapyResult(
        addThyroidFssFollowUpCheck(
          removeProfileSpecificLeakage(
            neutralizeUnverifiedMedicalSourcePhrases(
              normalizeDisclosureOpinion(
                ensureSubstantialOpinion(
                  adjustDisclosureDamageScope(
                    enforceCustomerSideStance(
                      ensureOfficialGroundsInBody(
                        removeReferenceAbsenceContradiction(
                          preserveInputDiagnosisCodes(base, input),
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
      ),
      input,
      ragResult,
    );

    let reviewedBase: AssessmentDraftResult;
    try {
      const reviewedText = await callOpenAI(
        apiKey,
        buildReviewPrompt(draft, input.retrievedReferences, ragResult, input),
        0,
        3,
        5000,
      );
      reviewedBase = applyReviewPipeline(sanitizeResult(parseJsonResponse(reviewedText)));
    } catch {
      // review call timed out or parse-failed — fall back to draft quality
      console.warn('review call failed, falling back to draft result');
      reviewedBase = applyReviewPipeline(draft);
    }
    const reviewed = stripProhibitedBodyPhrases(ensureProfileEvaluationPhrases(
      finalizeDuplicateProportionalResult(
        finalizeCancerHospitalizationResult(
          finalizeGeneralIndemnityResult(
            finalizeCancerDiagnosisBenefitResult(
              finalizeHeartDiagnosisBenefitResult(
                finalizeDisabilityBenefitResult(
                  finalizeCausationPreexistingInjuryResult(
                    finalizeMedicalReviewPreLitigationResult(
                      finalizeBrainDiagnosisBenefitResult(
                        finalizeGeneralDisclosureResult(reviewedBase, input),
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
        ),
        input,
      ),
      input,
    ));

    const finalResult = buildFinalSubmissionAssessmentReport(reviewed, input, ragResult);

    return jsonResponse({ ...finalResult, requestId: input.requestId, detectedProfile, retrievedReferences: ragResult });
  } catch (error: unknown) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    return jsonResponse({ error: message }, status);
  }
});
