import { type AssessmentProfileId } from './assessmentProfiles.ts';

export interface AssessmentProfileDetectionInput {
  insurerName?: string;
  caseTitle?: string;
  insuranceType?: string;
  contractDate?: string;
  accidentType?: string;
  diagnosisText?: string;
  diagnosisName?: string;
  diagnosisCode?: string;
  coverageType?: string;
  damageDescription?: string;
  damageDetails?: string;
  insurerPosition?: string;
  customerStatement?: string;
  adjusterMemo?: string;
  sourceAnalysis?: {
    summary?: string;
    denialReason?: string;
    diagnosisSummary?: string;
    keyIssues?: string[];
  };
}

function joinedText(input: AssessmentProfileDetectionInput) {
  const diagnosisText = [
    input.diagnosisText,
    input.diagnosisCode,
    input.diagnosisName,
    input.sourceAnalysis?.diagnosisSummary,
  ].filter(Boolean).join(' ');
  const allText = [
    diagnosisText,
    input.caseTitle,
    input.insurerName,
    input.insuranceType,
    input.contractDate,
    input.coverageType,
    input.accidentType,
    input.damageDescription,
    input.damageDetails,
    input.insurerPosition,
    input.customerStatement,
    input.adjusterMemo,
    input.sourceAnalysis?.summary,
    input.sourceAnalysis?.denialReason,
    ...(input.sourceAnalysis?.keyIssues || []),
  ].filter(Boolean).join(' ');
  return { diagnosisText, allText };
}

export function isDisclosureDutyProfileContext(input: AssessmentProfileDetectionInput) {
  const { allText } = joinedText(input);
  return /M47\.26|고지의무|알릴의무|미고지|계약해지|중요한 사항|중대한 과실/i.test(allText);
}

export function detectAssessmentProfile(input: AssessmentProfileDetectionInput): AssessmentProfileId {
  const { diagnosisText, allText } = joinedText(input);
  const disclosure = isDisclosureDutyProfileContext(input);

  if (disclosure && /M47\.26/i.test(diagnosisText)) return 'm47_disclosure';
  if (disclosure) {
    if (/C73|thyroid|E04|D34|갑상선암|갑상선\s*결절|갑상선종|양성신생물/i.test(allText)) {
      return 'thyroid_disclosure_cancer';
    }
    return 'general_disclosure';
  }

  // Explicit insurance product type takes priority over causation/disability routing.
  // "퇴행성" in an insurer's denial reason must not reroute a heart/brain benefit case.
  const insuranceProductText = [input.insuranceType, input.coverageType, input.accidentType].filter(Boolean).join(' ');
  if (/심장질환\s*진단비|허혈성\s*심장질환\s*진단비|심장진단비/i.test(insuranceProductText)) {
    return 'heart_diagnosis_benefit';
  }
  if (/뇌질환\s*진단비|뇌졸중\s*진단비|뇌경색\s*진단비|뇌진단비/i.test(insuranceProductText)) {
    return 'brain_diagnosis_benefit';
  }
  if (/암진단비|암\s*진단비/i.test(insuranceProductText)) {
    return 'cancer_diagnosis_benefit';
  }

  const causationSpecific = /기왕증|인과관계|상해성|사고\s*기여도|퇴행성|기존\s*병력|사고\s*전\s*병력|고혈압\s*기왕증|뇌출혈\s*인과관계|사망과\s*사고\s*인과관계/i.test(allText);
  const disabilitySpecific = /후유장해|장해지급률|장해분류표|영구장해|운동장해|동요관절|관절동요|지급률|압박골절|회전근개파열|무릎\s*인대|발목\s*운동범위|안면\s*반흔|추상장해|난청|말초신경마비|척추유합술|CRPS|반복\s*탈구|손가락\s*절단/i.test(allText);
  const strongDisabilitySignal = /후유장해|장해지급률|장해분류표|영구장해|운동장해|동요관절|관절동요|지급률|발목\s*운동범위|안면\s*반흔|추상장해|난청|말초신경마비|척추유합술|CRPS|반복\s*탈구|손가락\s*절단/i.test(allText);

  // Strong cancer signals take priority over pre-litigation routing
  // (e.g. cases where insurer's medical review is mentioned inside a cancer dispute)
  const strongCancerSignal = /암진단비|일반암|제자리암|상피내암|경계성종양|high\s*grade\s*dysplasia|dysplasia|carcinoma|adenocarcinoma|melanoma|Breslow|FIGO|microinvasion|미세침윤|침윤성\s*이식|ESD|원추절제|conization|원발암|전이암|침윤암/i.test(allText);
  if (
    /신의료기술|신의료\s*기술|고시상\s*(?:사용대상|치료대상|적용대상|요건)|임의비급여|고시\s*(?:요건|치료대상|사용대상)/i.test(allText)
    && /실손|실손보험|실손의료비|실손의료/i.test(allText)
  ) {
    return 'reimbursement_medical_necessity';
  }
  if (!strongCancerSignal && /의료자문|의료\s*자문|보험사\s*자문|자문의|제3의료기관|본사\s*민원|소비자보호부서|금감원\s*민원|분쟁조정|소송\s*전|소송\s*가능성|자료정리|서면\s*요청/i.test(allText)) {
    return 'medical_review_pre_litigation';
  }
  if (strongDisabilitySignal) return 'disability_benefit';
  if (causationSpecific) return 'causation_preexisting_injury';
  if (disabilitySpecific) return 'disability_benefit';
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
  if (/암진단비|암\s*진단비|일반암|유사암|소액암|제자리암|상피내암|경계성종양|D0[0169]|D3[7-9]|D4[0-8]|C18|C73|C코드|D코드|병리|병리보고서|조직검사|세포검사|high\s*grade\s*dysplasia|dysplasia|carcinoma\s*in\s*situ|\bCIS\b|intramucosal\s*carcinoma|behavior\s*code|행동양식|\/2|원발암|전이암|원발부위|대장암|대장점막내암|직장유암종|비침습성\s*방광암|유방상피내암|\bDCIS\b|GIST|흑색종\s*제자리암|갑상선암|미세침흡인검사|질병분류표/i.test(allText)) {
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
