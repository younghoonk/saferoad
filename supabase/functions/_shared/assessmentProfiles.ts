export type AssessmentProfileId =
  | 'm47_disclosure'
  | 'thyroid_disclosure_cancer'
  | 'general_disclosure'
  | 'indemnity_manual_therapy_denial'
  | 'indemnity_cataract_multifocal_lens_denial'
  | 'indemnity_cancer_hospitalization_denial'
  | 'indemnity_duplicate_proportional_reimbursement'
  | 'indemnity_general_denial'
  | 'cancer_diagnosis_benefit'
  | 'brain_diagnosis_benefit'
  | 'heart_diagnosis_benefit'
  | 'disability_benefit'
  | 'causation_preexisting_injury'
  | 'medical_review_pre_litigation'
  | 'general';

export interface AssessmentProfileDefinition {
  id: AssessmentProfileId;
  label: string;
  priority: number;
  detectKeywords: string[];
  positiveKeywords: string[];
  negativeKeywords: string[];
  officialAllowKeywords: string[];
  officialExcludeKeywords: string[];
  internalAllowKeywords: string[];
  internalExcludeKeywords: string[];
  requiredPhrases: string[];
  forbiddenPhrases: string[];
  requiredDocuments: string[];
  opinionGuidelines: string[];
}

const commonForbiddenPhrases = [
  '보험금 지급 확정',
  '반드시 받을 수',
  '무조건 위법',
  '승소 가능성',
];

export const assessmentProfiles: AssessmentProfileDefinition[] = [
  {
    id: 'm47_disclosure',
    label: 'M47.26 1회 통원 고지의무',
    priority: 1000,
    detectKeywords: ['M47.26', '고지의무', '알릴의무', '미고지', '계약해지'],
    positiveKeywords: ['M47.26', '요추증', '1회 통원', '미고지', '계약해지'],
    negativeKeywords: ['도수치료', '백내장', '암진단비', '후유장해'],
    officialAllowKeywords: ['상법 651', '상법 655', '고지의무', '알릴의무', '중요한 사항'],
    officialExcludeKeywords: ['도수치료', '백내장', '자동차보험', '후유장해'],
    internalAllowKeywords: ['M47.26', 'M47', 'M54', '요통', '허리통증', '고지의무', '1회 통원'],
    internalExcludeKeywords: ['후유장해', '백내장', '체외충격파', '자동차보험'],
    requiredPhrases: ['M47.26', '고지의무', '계약해지', '중요한 사항', '재검토'],
    forbiddenPhrases: commonForbiddenPhrases,
    requiredDocuments: ['청약서 질문사항', '초진기록', '처방전', '검사내역', '보험회사 인수기준'],
    opinionGuidelines: ['M47.26과 고지의무 맥락이 함께 있을 때만 적용한다.', '1회 통원만으로 계약해지 요건 충족을 단정하지 않는다.'],
  },
  {
    id: 'thyroid_disclosure_cancer',
    label: '갑상선 결절/갑상선암 고지의무',
    priority: 990,
    detectKeywords: ['C73', '갑상선암', '갑상선 결절', 'thyroid', 'E04', 'D34'],
    positiveKeywords: ['갑상선', '결절', '갑상선암', 'C73', 'E04', 'D34', '고지의무'],
    negativeKeywords: ['M47.26', '도수치료', '백내장', '자동차보험'],
    officialAllowKeywords: ['갑상선', '갑상선암', '고지의무', '암진단비', '진단확정', '설명의무'],
    officialExcludeKeywords: ['실손보험', '도수치료', '백내장', '자동차보험'],
    internalAllowKeywords: ['갑상선', '결절', 'C73', 'E04', 'D34', '초음파', '미세침흡인', '고지의무'],
    internalExcludeKeywords: ['M47.26', '도수치료', '백내장', '후유장해'],
    requiredPhrases: ['갑상선', '고지의무', '암진단비', '인과관계', '재검토'],
    forbiddenPhrases: commonForbiddenPhrases,
    requiredDocuments: ['건강검진 결과', '초음파 결과', '조직검사 권유 기록', '청약서', '가입 당시 약관'],
    opinionGuidelines: ['갑상선/C73 신호는 일반 고지의무보다 우선한다.', '결절 소견과 계약해지 요건을 구분한다.'],
  },
  {
    id: 'general_disclosure',
    label: '일반 고지의무',
    priority: 500,
    detectKeywords: ['고지의무', '알릴의무', '미고지', '계약해지'],
    positiveKeywords: ['고지의무', '알릴의무', '미고지', '계약해지', '중요한 사항'],
    negativeKeywords: ['도수치료', '백내장', '암진단비', '후유장해'],
    officialAllowKeywords: ['상법 651', '상법 655', '고지의무', '알릴의무'],
    officialExcludeKeywords: ['도수치료', '백내장', '암진단비', '후유장해'],
    internalAllowKeywords: ['고지의무', '알릴의무', '미고지', '계약해지', '중요한 사항'],
    internalExcludeKeywords: ['도수치료', '암진단비', '후유장해', '자동차보험'],
    requiredPhrases: ['고지의무', '중요한 사항', '인과관계', '재검토'],
    forbiddenPhrases: commonForbiddenPhrases,
    requiredDocuments: ['청약서', '질문사항', '진료기록지', '보험회사 인수기준', '부지급 사유서'],
    opinionGuidelines: ['질병별 특화 프로필에 해당하지 않는 고지의무 사건에만 적용한다.'],
  },
  {
    id: 'indemnity_cataract_multifocal_lens_denial',
    label: '백내장 다초점렌즈 실손 부지급',
    priority: 900,
    detectKeywords: ['백내장', 'H25', 'H26', '다초점', '다초점렌즈', '인공수정체', 'IOL'],
    positiveKeywords: ['백내장', '다초점렌즈', '인공수정체', '실손보험', '보상 제외'],
    negativeKeywords: ['도수치료', 'M47.26', '갑상선암', '후유장해'],
    officialAllowKeywords: ['백내장', 'H25', 'H26', '인공수정체', '실손의료비', '보상 제외', '입원'],
    officialExcludeKeywords: ['도수치료', '고지의무', 'M47.26', '후유장해'],
    internalAllowKeywords: ['백내장', 'H25', 'H26', '다초점', '인공수정체', '안과'],
    internalExcludeKeywords: ['도수치료', 'M54', '고지의무', '후유장해'],
    requiredPhrases: ['백내장', '다초점', '보상 제외', '가입 당시 실손보험 원약관', '재검토'],
    forbiddenPhrases: commonForbiddenPhrases,
    requiredDocuments: ['백내장 진단서', '세극등검사 결과', '시력검사 결과', '수술기록지', '진료비 세부내역서', '가입 당시 실손보험 원약관'],
    opinionGuidelines: ['백내장/H25/다초점렌즈는 도수치료보다 우선한다.', '치료 목적 비용과 시력교정 비용을 구분한다.'],
  },
  {
    id: 'indemnity_manual_therapy_denial',
    label: '도수치료 실손 부지급',
    priority: 850,
    detectKeywords: ['도수치료', '도수 치료', 'manual therapy', '도수치료비', '비급여 도수'],
    positiveKeywords: ['도수치료', 'manual therapy', '실손보험', '의학적 필요성', '치료 목적'],
    negativeKeywords: ['백내장', 'M47.26', '암진단비', '후유장해'],
    officialAllowKeywords: ['도수치료', 'manual therapy', '실손보험', '비급여', '치료 목적', '의학적 필요성'],
    officialExcludeKeywords: ['고지의무', '계약해지', '백내장', '암진단비'],
    internalAllowKeywords: ['도수치료', 'manual therapy', '치료 목적', '의학적 필요성', '반복치료'],
    internalExcludeKeywords: ['고지의무', 'M47.26', '백내장', '암진단비'],
    requiredPhrases: ['도수치료', '의학적 필요성', '치료 목적', '가입 당시 원약관', '재검토'],
    forbiddenPhrases: commonForbiddenPhrases,
    requiredDocuments: ['진료기록지', '도수치료 처방 또는 치료계획', '의사 소견서', '치료 전후 증상 변화 기록', '진료비 세부내역서', '영수증'],
    opinionGuidelines: ['명시적인 도수치료 키워드가 있을 때만 적용한다.', '단순 비급여, 반복치료, 의학적 필요성만으로 적용하지 않는다.'],
  },
  {
    id: 'indemnity_cancer_hospitalization_denial',
    label: '요양병원 암 입원 실손 부지급',
    priority: 830,
    detectKeywords: ['요양병원', '암 입원', '암입원', '직접치료', '입원비', '입원의료비'],
    positiveKeywords: ['요양병원', '암', '입원', '직접치료', '입원 필요성'],
    negativeKeywords: ['도수치료', '백내장', '고지의무', '후유장해'],
    officialAllowKeywords: ['요양병원', '암 입원', '직접치료', '입원', '실손보험', '약관'],
    officialExcludeKeywords: ['도수치료', '백내장', '고지의무', '자동차보험'],
    internalAllowKeywords: ['요양병원', '암 입원', '직접치료', '항암치료', '통증조절', '완화치료'],
    internalExcludeKeywords: ['도수치료', '백내장', '고지의무', '후유장해'],
    requiredPhrases: ['요양병원', '직접치료', '입원 필요성', '가입 당시 원약관', '재검토'],
    forbiddenPhrases: commonForbiddenPhrases,
    requiredDocuments: ['입퇴원확인서', '진료기록지', '항암치료 기록', '간호기록', '진료비 세부내역서', '보험회사 부지급 사유서'],
    opinionGuidelines: ['요양병원 입원만으로 지급 또는 부지급을 단정하지 않는다.'],
  },
  {
    id: 'indemnity_duplicate_proportional_reimbursement',
    label: '실손 중복가입 비례보상',
    priority: 820,
    detectKeywords: ['중복가입', '비례보상', '중복 보험', '복수 실손', '초과보상', '보험금 분담'],
    positiveKeywords: ['중복가입', '비례보상', '실제 발생한 손해', '자기부담금'],
    negativeKeywords: ['도수치료', '의학적 필요성', '암진단비', '후유장해'],
    officialAllowKeywords: ['중복가입', '비례보상', '실손보험', '실제 발생한 손해', '분담'],
    officialExcludeKeywords: ['도수치료', '백내장', '고지의무', '암진단비'],
    internalAllowKeywords: ['중복가입', '비례보상', '복수 실손', '초과보상', '계산서'],
    internalExcludeKeywords: ['도수치료', '의학적 필요성', '암진단비', '후유장해'],
    requiredPhrases: ['중복가입', '비례보상', '실제 발생한 손해', '가입 당시 원약관', '재검토'],
    forbiddenPhrases: commonForbiddenPhrases,
    requiredDocuments: ['진료비 영수증', '진료비 세부내역서', '타 보험계약 보험증권', '타 보험 지급내역', '비례보상 계산서'],
    opinionGuidelines: ['중복가입과 비례보상 산식의 정확성을 중심으로 검토한다.'],
  },
  {
    id: 'cancer_diagnosis_benefit',
    label: '암/경계성/제자리암 진단비',
    priority: 800,
    detectKeywords: ['암진단비', '일반암', '유사암', '제자리암', '상피내암', '경계성종양', 'C18', 'C73', '병리보고서', '조직검사', '진단확정', '임상진단', '대장암', '질병분류표'],
    positiveKeywords: ['암진단비', '진단확정', '병리보고서', '조직검사', '질병분류표'],
    negativeKeywords: ['도수치료', '실손 부지급', '후유장해', '자동차보험'],
    officialAllowKeywords: ['암', '암진단비', '진단확정', '병리', '조직검사', '질병분류표', 'KCD', '제자리암', '경계성종양'],
    officialExcludeKeywords: ['도수치료', 'M54', '실손 부지급', '후유장해', '자동차보험'],
    internalAllowKeywords: ['암진단비', '진단확정', '병리', '조직검사', '질병분류표', 'C18', 'C73', '제자리암'],
    internalExcludeKeywords: ['도수치료', '실손 부지급', '후유장해', '고지의무'],
    requiredPhrases: ['암진단비', '진단확정', '병리보고서', '조직검사', '가입 당시 약관', '질병분류표', '재검토'],
    forbiddenPhrases: commonForbiddenPhrases,
    requiredDocuments: ['진단서', '조직검사 결과지', '병리보고서', '가입 당시 약관', '가입 당시 질병분류표', '보험회사 부지급 사유서'],
    opinionGuidelines: ['암진단비 프로필은 영상검사 단어가 있어도 뇌질환보다 우선할 수 있다.', '지급 확정이 아니라 진단확정 기준 재검토로 작성한다.'],
  },
  {
    id: 'brain_diagnosis_benefit',
    label: '뇌질환 진단비',
    priority: 760,
    detectKeywords: ['뇌질환', '뇌진단비', '뇌졸중', '뇌경색', '뇌출혈', 'TIA', 'I63', 'I60', 'I61', 'G45', 'MRI', 'MRA', 'CTA', 'CT', '영상검사'],
    positiveKeywords: ['뇌질환', '진단확정', '영상검사', 'MRI', 'MRA', 'CTA', 'CT'],
    negativeKeywords: ['도수치료', '백내장', '갑상선암', '암진단비', '후유장해'],
    officialAllowKeywords: ['뇌질환', '뇌졸중', '뇌경색', '뇌출혈', 'MRI', 'MRA', 'CTA', 'CT', '진단확정'],
    officialExcludeKeywords: ['도수치료', '암진단비', '백내장', '고지의무'],
    internalAllowKeywords: ['뇌질환', '뇌졸중', '뇌경색', 'MRI', 'MRA', 'CTA', 'CT'],
    internalExcludeKeywords: ['도수치료', '암진단비', '백내장', '고지의무'],
    requiredPhrases: ['뇌질환', '진단확정', '영상검사', 'MRI', '가입 당시 약관', '재검토'],
    forbiddenPhrases: commonForbiddenPhrases,
    requiredDocuments: ['가입 당시 약관', 'MRI/MRA/CTA/CT 판독지', '전문의 진단서', '진료기록지', '질병분류표'],
    opinionGuidelines: ['MRI 단어만으로 뇌질환을 적용하지 않도록 암진단비와 실손 MRI 부지급보다 낮은 우선순위를 둔다.'],
  },
  {
    id: 'heart_diagnosis_benefit',
    label: '심장질환 진단비',
    priority: 750,
    detectKeywords: ['심장질환', '심장진단비', '급성심근경색', '심근경색', 'NSTEMI', 'STEMI', '협심증', 'CAG', 'PCI', '트로포닌', 'I21', 'I20'],
    positiveKeywords: ['심장질환', '진단확정', '트로포닌', '심전도', 'CAG', 'PCI'],
    negativeKeywords: ['도수치료', '암진단비', '뇌질환', '후유장해'],
    officialAllowKeywords: ['심장질환', '급성심근경색', '협심증', '트로포닌', '심전도', 'CAG', 'PCI', '진단확정'],
    officialExcludeKeywords: ['도수치료', '암진단비', '뇌질환', '고지의무'],
    internalAllowKeywords: ['심장질환', '심근경색', '협심증', '트로포닌', 'CAG', 'PCI', 'I21', 'I20'],
    internalExcludeKeywords: ['도수치료', '암진단비', '뇌질환', '후유장해'],
    requiredPhrases: ['심장질환', '진단확정', '검사결과', '트로포닌', '가입 당시 약관', '재검토'],
    forbiddenPhrases: commonForbiddenPhrases,
    requiredDocuments: ['가입 당시 약관', '트로포닌 등 심근효소 검사결과', '심전도', '관상동맥조영술 결과', '진료기록지'],
    opinionGuidelines: ['진단코드만으로 지급 여부를 단정하지 않는다.'],
  },
  {
    id: 'disability_benefit',
    label: '후유장해',
    priority: 700,
    detectKeywords: ['후유장해', '장해지급률', '장해분류표', '영구장해', '운동장해', '동요관절', '압박골절', 'CRPS'],
    positiveKeywords: ['후유장해', '장해분류표', '장해지급률', '객관적 검사'],
    negativeKeywords: ['도수치료', '암진단비', '백내장', '고지의무'],
    officialAllowKeywords: ['후유장해', '장해분류표', '장해지급률', '객관적 검사', '약관'],
    officialExcludeKeywords: ['도수치료', '암진단비', '백내장', '고지의무'],
    internalAllowKeywords: ['후유장해', '장해분류표', '장해지급률', '운동범위', '영구성'],
    internalExcludeKeywords: ['도수치료', '암진단비', '실손 부지급', '고지의무'],
    requiredPhrases: ['후유장해', '장해분류표', '장해지급률', '가입 당시 약관', '재검토'],
    forbiddenPhrases: commonForbiddenPhrases,
    requiredDocuments: ['후유장해진단서', '가입 당시 약관', '장해분류표', '영상검사 결과', '운동범위 측정표', '주치의 소견서'],
    opinionGuidelines: ['치료 종결, 증상 고정, 영구성을 중심으로 검토한다.'],
  },
  {
    id: 'causation_preexisting_injury',
    label: '기왕증/인과관계/상해성',
    priority: 650,
    detectKeywords: ['기왕증', '인과관계', '상해성', '사고 기여도', '퇴행성', '기존 병력'],
    positiveKeywords: ['기왕증', '인과관계', '상해성', '사고 기여도', '퇴행성'],
    negativeKeywords: ['도수치료', '암진단비', '백내장', '고지의무'],
    officialAllowKeywords: ['기왕증', '인과관계', '상해성', '사고 기여도', '영상검사'],
    officialExcludeKeywords: ['도수치료', '암진단비', '백내장', '고지의무'],
    internalAllowKeywords: ['기왕증', '인과관계', '상해성', '퇴행성', 'MRI', 'CT'],
    internalExcludeKeywords: ['도수치료', '암진단비', '중복가입', '고지의무'],
    requiredPhrases: ['기왕증', '인과관계', '상해성', '사고 기여도', '재검토'],
    forbiddenPhrases: commonForbiddenPhrases,
    requiredDocuments: ['사고 전 진료기록', '사고 후 진료기록', 'MRI/CT/X-ray 판독지', '의사 소견서', '보험회사 부지급 사유서'],
    opinionGuidelines: ['기존 병력만으로 인과관계를 배척하지 않는다.'],
  },
  {
    id: 'medical_review_pre_litigation',
    label: '의료자문/소송 전 분쟁해결',
    priority: 640,
    detectKeywords: ['의료자문', '보험사 자문', '자문의', '제3의료기관', '본사 민원', '금감원 민원', '분쟁조정', '소송 전'],
    positiveKeywords: ['의료자문', '서면 요청', '본사 민원', '금감원 민원', '분쟁조정'],
    negativeKeywords: ['도수치료', '암진단비', '백내장', '고지의무'],
    officialAllowKeywords: ['의료자문', '분쟁조정', '민원', '서면', '소송 전'],
    officialExcludeKeywords: ['도수치료', '암진단비', '백내장', '고지의무'],
    internalAllowKeywords: ['의료자문', '자문의', '제3의료기관', '본사 민원', '분쟁조정'],
    internalExcludeKeywords: ['도수치료', '암진단비', '후유장해', '중복가입'],
    requiredPhrases: ['의료자문', '서면', '소송 전 자료정리', '재검토'],
    forbiddenPhrases: [...commonForbiddenPhrases, '손해사정사가 소송을 대신'],
    requiredDocuments: ['의료자문 요청서', '자문 질문지', '주치의 소견서', '제3의사 소견서', '보험회사 답변서'],
    opinionGuidelines: ['소송대리나 법률대리 가능성을 암시하지 않는다.'],
  },
  {
    id: 'indemnity_general_denial',
    label: '일반 실손보험 부지급',
    priority: 600,
    detectKeywords: ['실손', '실손보험', '실손의료비', '비급여', '보상 제외', '부지급', '검사비', 'MRI'],
    positiveKeywords: ['실손보험', '보상 제외', '의학적 필요성', '검사 필요성', '가입 당시 원약관'],
    negativeKeywords: ['고지의무', '계약해지', '암진단비', '후유장해'],
    officialAllowKeywords: ['실손보험', '실손의료비', '비급여', '보상 제외', '의학적 필요성', '약관'],
    officialExcludeKeywords: ['고지의무', '계약해지', '암진단비', '후유장해'],
    internalAllowKeywords: ['실손보험', '보상 제외', '의학적 필요성', '검사비', 'MRI', '진료비 세부내역'],
    internalExcludeKeywords: ['고지의무', '계약해지', '암진단비', '후유장해'],
    requiredPhrases: ['실손보험', '보상 제외', '의학적 필요성', '가입 당시 원약관', '재검토'],
    forbiddenPhrases: commonForbiddenPhrases,
    requiredDocuments: ['진료기록지', '의사 소견서', '진료비 세부내역서', '영수증', '보험회사 부지급 사유서', '가입 당시 원약관'],
    opinionGuidelines: ['특화 실손 프로필에 해당하지 않는 부지급 사건에 적용한다.'],
  },
  {
    id: 'general',
    label: '일반',
    priority: 0,
    detectKeywords: [],
    positiveKeywords: [],
    negativeKeywords: [],
    officialAllowKeywords: [],
    officialExcludeKeywords: [],
    internalAllowKeywords: [],
    internalExcludeKeywords: [],
    requiredPhrases: ['재검토', '추가 확인'],
    forbiddenPhrases: commonForbiddenPhrases,
    requiredDocuments: ['진료기록지', '보험증권', '가입 당시 약관', '보험회사 사유서'],
    opinionGuidelines: ['특정 프로필 신호가 없을 때 적용한다.'],
  },
];

export const assessmentProfileById = assessmentProfiles.reduce<Record<AssessmentProfileId, AssessmentProfileDefinition>>((acc, profile) => {
  acc[profile.id] = profile;
  return acc;
}, {} as Record<AssessmentProfileId, AssessmentProfileDefinition>);
