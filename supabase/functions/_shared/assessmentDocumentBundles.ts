import type { AssessmentProfileId } from './assessmentProfiles.ts';

export type AssessmentDocumentType =
  | 'policy_terms_bundle'
  | 'policy_schedule'
  | 'denial_letter'
  | 'medical_document'
  | 'other';

export type AssessmentDocumentSectionType =
  | 'main_terms'
  | 'rider_terms'
  | 'disease_classification_table'
  | 'disability_table'
  | 'cancer_classification_table'
  | 'exclusion_clause'
  | 'diagnosis_definition'
  | 'hospitalization_definition'
  | 'surgery_definition'
  | 'payment_standard'
  | 'unknown';

export const assessmentDocumentTypeLabels: Record<AssessmentDocumentType, string> = {
  policy_terms_bundle: '보험약관/특약/별표',
  policy_schedule: '보험증권',
  denial_letter: '부지급/면책 안내문',
  medical_document: '의료자료',
  other: '기타',
};

export const assessmentDocumentPriority: AssessmentDocumentType[] = [
  'policy_terms_bundle',
  'policy_schedule',
  'denial_letter',
  'medical_document',
  'other',
];

export const globalRagPriorityAfterUploadedDocuments = [
  'official_rag_references',
  'internal_practice_playbooks',
] as const;

export const profileSectionPriority: Partial<Record<AssessmentProfileId, AssessmentDocumentSectionType[]>> = {
  cancer_diagnosis_benefit: [
    'diagnosis_definition',
    'cancer_classification_table',
    'disease_classification_table',
    'exclusion_clause',
  ],
  brain_diagnosis_benefit: [
    'diagnosis_definition',
    'disease_classification_table',
    'payment_standard',
  ],
  heart_diagnosis_benefit: [
    'diagnosis_definition',
    'disease_classification_table',
    'payment_standard',
  ],
  disability_benefit: [
    'disability_table',
    'payment_standard',
    'exclusion_clause',
  ],
  indemnity_manual_therapy_denial: [
    'exclusion_clause',
    'hospitalization_definition',
    'surgery_definition',
    'payment_standard',
  ],
  indemnity_cataract_multifocal_lens_denial: [
    'exclusion_clause',
    'hospitalization_definition',
    'surgery_definition',
    'payment_standard',
  ],
  indemnity_cancer_hospitalization_denial: [
    'exclusion_clause',
    'hospitalization_definition',
    'surgery_definition',
    'payment_standard',
  ],
  indemnity_duplicate_proportional_reimbursement: [
    'exclusion_clause',
    'hospitalization_definition',
    'surgery_definition',
    'payment_standard',
  ],
  indemnity_general_denial: [
    'exclusion_clause',
    'hospitalization_definition',
    'surgery_definition',
    'payment_standard',
  ],
  m47_disclosure: [
    'main_terms',
    'exclusion_clause',
    'diagnosis_definition',
  ],
  thyroid_disclosure_cancer: [
    'main_terms',
    'exclusion_clause',
    'diagnosis_definition',
  ],
  general_disclosure: [
    'main_terms',
    'exclusion_clause',
    'diagnosis_definition',
  ],
};

export function normalizeAssessmentDocumentType(value: unknown): AssessmentDocumentType {
  if (
    value === 'policy_terms_bundle'
    || value === 'policy_schedule'
    || value === 'denial_letter'
    || value === 'medical_document'
    || value === 'other'
  ) {
    return value;
  }

  return 'other';
}

export function classifyAssessmentDocumentSection(text: unknown): AssessmentDocumentSectionType {
  const value = String(text ?? '');

  if (/(장해분류표|장해지급률|영구장해|운동장해)/.test(value)) return 'disability_table';
  if (/(대상이 되는 악성신생물|제자리신생물|행동양식 불명 또는 미상의 신생물|암분류표)/.test(value)) {
    return 'cancer_classification_table';
  }
  if (/(별표|질병분류표)/.test(value)) return 'disease_classification_table';
  if (/(특별약관|특약)/.test(value)) return 'rider_terms';
  if (/(보험금을 지급하지 않는 사유|보상하지 않는 손해|면책)/.test(value)) return 'exclusion_clause';
  if (/(진단확정|암의 진단|급성심근경색증의 진단확정|뇌졸중의 진단확정)/.test(value)) {
    return 'diagnosis_definition';
  }
  if (/(입원의 정의|입원이라 함은)/.test(value)) return 'hospitalization_definition';
  if (/(수술의 정의|수술이라 함은)/.test(value)) return 'surgery_definition';
  if (/(지급기준|보험금 지급기준|지급률|보험금 지급)/.test(value)) return 'payment_standard';
  if (value.trim()) return 'main_terms';

  return 'unknown';
}

export function sectionPriorityForProfile(profileId: AssessmentProfileId): AssessmentDocumentSectionType[] {
  return profileSectionPriority[profileId] ?? ['main_terms', 'exclusion_clause', 'diagnosis_definition', 'unknown'];
}
