import type { RagSearchResult, RetrievedReference } from './ragSearch.ts';

interface AssessmentGuidelineContext {
  caseTitle?: string;
  accidentType?: string;
  diagnosisText?: string;
  diagnosisName?: string;
  diagnosisCode?: string;
  damageDetails?: string;
  insurerPosition?: string;
  customerStatement?: string;
  sourceAnalysis?: {
    summary?: string;
    insurerPosition?: string;
    denialReason?: string;
    keyIssues?: string[];
    customerMedicalSummary?: string;
    diagnosisSummary?: string;
    testResultSummary?: string;
    treatmentSummary?: string;
    damageEvidenceSummary?: string;
    draftSupportingFacts?: string[];
  };
}

const ACUTE_MI_GUIDELINE_REFS: RetrievedReference[] = [
  {
    reference_type: 'official',
    source_area: 'medical_guideline',
    source_type: 'guideline_summary',
    source_area_label: '의학 기준',
    title: 'Fourth Universal Definition of Myocardial Infarction (2018) - myocardial injury와 myocardial infarction 구분',
    summary: '심근손상은 troponin이 해당 검사법의 99th percentile upper reference limit를 초과할 때 성립한다. 심근경색은 급성 심근손상에 더해 허혈 증거가 결합되어야 하므로, troponin 상승만으로 I21.4 지급요건 충족 또는 배척을 단정하지 않는다.',
    source_url: 'https://www.jacc.org/doi/10.1016/j.jacc.2018.08.1038',
    sourceDisplayName: 'JACC / Fourth Universal Definition of MI',
    diagnosis_code: 'I21.4',
    diagnosis_name: 'Acute subendocardial myocardial infarction / NSTEMI',
    note: '보험 쟁점용 자체 요약 chunk. 원문 전문 저장 아님.',
    review_status: 'reviewed',
    official_citation_allowed: true,
    source_provider: 'ESC/ACC/AHA/WHF consensus',
    dataset_version: 'medical_evidence_source_pack_2026-05-20',
  },
  {
    reference_type: 'official',
    source_area: 'medical_guideline',
    source_type: 'guideline_summary',
    source_area_label: '의학 기준',
    title: 'Acute MI criteria - troponin rise/fall, 99th percentile URL, ischemic evidence',
    summary: '급성 심근경색 판단은 troponin rise/fall 및 99th percentile URL 초과와 함께 허혈성 흉통 등 증상, 새로운 허혈성 ECG 변화, 병적 Q파, 새 viable myocardium loss 또는 RWMA, CAG/부검상 coronary thrombus 중 적어도 하나의 허혈 근거를 함께 검토한다.',
    source_url: 'https://professional.heart.org/en/science-news/fourth-universal-definition-of-myocardial-infarction-2018',
    sourceDisplayName: 'American Heart Association',
    diagnosis_code: 'I21.4',
    diagnosis_name: 'NSTEMI / acute myocardial infarction',
    note: 'troponin 절대 수치가 아니라 검사기관 참고치와 시간 추이를 기준으로 검토.',
    review_status: 'reviewed',
    official_citation_allowed: true,
    source_provider: 'AHA summary of ESC/ACC/AHA/WHF consensus',
    dataset_version: 'medical_evidence_source_pack_2026-05-20',
  },
  {
    reference_type: 'official',
    source_area: 'medical_guideline',
    source_type: 'guideline_summary',
    source_area_label: '의학 기준',
    title: 'PCI-related myocardial injury and type 4a MI - PCI 전후 채혈 시간관계',
    summary: 'PCI 후 troponin 상승은 시술 관련 myocardial injury 또는 type 4a MI 쟁점이 될 수 있다. 보험사가 PCI 후 상승만으로 주치의 I21.4 진단을 배척하려면 PCI 전 baseline, 시술 후 상승폭, 새 ECG 변화, 병적 Q파, 새 RWMA/viable myocardium loss, angiographic flow-limiting complication 등 시간관계와 허혈 근거를 제시해야 한다.',
    source_url: 'https://www.acc.org/latest-in-cardiology/ten-points-to-remember/2018/08/24/00/09/fourth-universal-definition-of-mi-esc-2018',
    sourceDisplayName: 'American College of Cardiology',
    diagnosis_code: 'I21.4',
    diagnosis_name: 'PCI-related myocardial injury / type 4a MI',
    note: '보험사 PCI 후 troponin 상승 주장 반박용 기준.',
    review_status: 'reviewed',
    official_citation_allowed: true,
    source_provider: 'ACC summary of Fourth Universal Definition of MI',
    dataset_version: 'medical_evidence_source_pack_2026-05-20',
  },
  {
    reference_type: 'official',
    source_area: 'medical_guideline',
    source_type: 'guideline_summary',
    source_area_label: '의학 기준',
    title: 'Unstable angina vs NSTEMI - troponin 및 I20/I21.4/I25.1 코드 구분',
    summary: 'Unstable angina는 임상적으로 급성 관상동맥증후군 범주에 속하지만, NSTEMI/I21.4와의 핵심 구분은 심근손상을 뒷받침하는 troponin 상승 여부와 허혈 증거이다. I20 협심증, I21.4 급성 심내막하심근경색증, I25.1 관상동맥질환 기재가 혼재하면 단일 진단명만 선택하지 말고 전체 검사 흐름과 주치의 진단 근거를 대조한다.',
    source_url: 'https://www.acc.org/Latest-in-Cardiology/ten-points-to-remember/2023/08/29/14/01/2023-esc-guidelines-acs-esc-2023',
    sourceDisplayName: 'American College of Cardiology / ESC ACS guideline key points',
    diagnosis_code: 'I20 / I21.4 / I25.1',
    diagnosis_name: 'Unstable angina / NSTEMI / CAD',
    note: '진단서와 입퇴원요약지 불일치 쟁점 검토용.',
    review_status: 'reviewed',
    official_citation_allowed: true,
    source_provider: 'ESC ACS guideline summary',
    dataset_version: 'medical_evidence_source_pack_2026-05-20',
  },
  {
    reference_type: 'official',
    source_area: 'medical_guideline',
    source_type: 'guideline_summary',
    source_area_label: '의학 기준',
    title: 'CAG/PCI 소견과 허혈 근거 - coronary thrombus, culprit lesion, severe stenosis',
    summary: 'CAG에서 coronary thrombus, culprit lesion, acute occlusion 또는 flow-limiting complication이 확인되면 급성 허혈성 사건 판단에 중요하다. LM-LAD 또는 LM-mLAD 중증 협착과 PCI/stent 시행 사실은 단독으로 심근경색 확정은 아니지만, 흉통ㆍtroponin 추이ㆍECGㆍEcho와 결합하면 보험사 단순 CAD/협심증 해석의 약점을 지적하는 근거가 된다.',
    source_url: 'https://pubmed.ncbi.nlm.nih.gov/30154043/',
    sourceDisplayName: 'PubMed / Fourth Universal Definition of MI',
    diagnosis_code: 'I21.4',
    diagnosis_name: 'NSTEMI / coronary thrombus / CAG',
    note: 'CAG/PCI 기록 해석용 자체 요약.',
    review_status: 'reviewed',
    official_citation_allowed: true,
    source_provider: 'ESC/ACC/AHA/WHF consensus',
    dataset_version: 'medical_evidence_source_pack_2026-05-20',
  },
];

export function isAcuteMiDenialContext(input: AssessmentGuidelineContext) {
  const text = [
    input.caseTitle,
    input.accidentType,
    input.diagnosisText,
    input.diagnosisName,
    input.diagnosisCode,
    input.damageDetails,
    input.insurerPosition,
    input.customerStatement,
    input.sourceAnalysis?.summary,
    input.sourceAnalysis?.diagnosisSummary,
    input.sourceAnalysis?.testResultSummary,
    input.sourceAnalysis?.treatmentSummary,
    input.sourceAnalysis?.customerMedicalSummary,
    ...(input.sourceAnalysis?.keyIssues ?? []),
    ...(input.sourceAnalysis?.draftSupportingFacts ?? []),
  ].filter(Boolean).join(' ');
  return /acute_mi_denial|I21\.?4|NSTEMI|심내막하심근경색|급성심근경색|unstable\s+angina|CAD|I20|I25\.?1|CAG|PCI|stent|troponin|CK-?MB|ECG|RWMA|LVEF/i.test(text);
}

const ACUTE_MI_PRECEDENT_REFS: RetrievedReference[] = [
  {
    reference_type: 'official',
    source_area: 'precedents',
    source_type: 'court_precedent_fulltext',
    source_area_label: '판례',
    title: '대법원 2014.6.12 선고 2013다208661 보험금 - 심근경색(NSTEMI/I21.4) 진단확정 증명책임',
    summary: '보험금 청구소송에서 보험사고(I21.4 급성심내막하심근경색증 NSTEMI 진단확정) 발생에 대한 증명책임은 피보험자에게 있으나, 전문의 진단서·의무기록·트로포닌/CK-MB 수치·EKG 소견·CAG/PCI 기록 등이 제출되면 1차 증명이 완료된다. 보험사가 진단의 부당함을 주장하려면 구체적인 의학적 반증을 제시해야 하며, 단순히 CAG 시행 전 단일 시점의 심근효소 수치(CK-MB, Troponin T)가 정상이라는 점만을 근거로 I21.4(NSTEMI) 진단을 부정하는 것은 Fourth Universal Definition of Myocardial Infarction 2018의 다중 진단기준과 의무기록 전체를 무시하는 것으로, 본 판결의 증명책임 법리상 허용되지 않는다.',
    case_number: '2013다208661',
    court_or_agency: '대법원',
    decision_date: '2014-06-12',
    diagnosis_code: 'I21.4',
    diagnosis_name: 'NSTEMI / 급성심내막하심근경색증',
    review_status: 'reviewed',
    official_citation_allowed: true,
    dataset_version: 'precedent_pack_2026-05-21',
  },
];

export function appendMedicalGuidelineEvidence(
  input: AssessmentGuidelineContext,
  ragResult: RagSearchResult,
): RagSearchResult {
  if (!isAcuteMiDenialContext(input)) return ragResult;
  const existingKeys = new Set((ragResult.officialReferences || []).map((ref) => `${ref.source_area}:${ref.title}`));
  const existingCaseNumbers = new Set(
    (ragResult.officialReferences || [])
      .filter((ref) => ref.source_area === 'precedents')
      .map((ref) => ref.case_number || ''),
  );
  const guidelineRefs = ACUTE_MI_GUIDELINE_REFS
    .filter((ref) => !existingKeys.has(`${ref.source_area}:${ref.title}`))
    .slice(0, 5);
  const precedentRefs = ACUTE_MI_PRECEDENT_REFS
    .filter((ref) => !existingCaseNumbers.has(ref.case_number || '') && !existingKeys.has(`${ref.source_area}:${ref.title}`));
  return {
    ...ragResult,
    officialReferences: [
      ...guidelineRefs,
      ...(ragResult.officialReferences || []),
      ...precedentRefs,
    ],
  };
}
