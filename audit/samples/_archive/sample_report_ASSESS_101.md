# 사정서 샘플: ASSESS_101
> 생성일시: 2026-05-22T10:26:43.984Z

## 입력 정보
- **케이스 ID**: ASSESS_101
- **제목**: I21.4 NSTEMI 급성심내막하심근경색 진단비 부지급 — v2 gold 케이스
- **카테고리**: 심장질환 진단비
- **보험사**: [보험사]
- **보험 유형**: 급성심근경색 진단비
- **진단명**: I21.4 급성 심내막하심근경색증 (NSTEMI)
- **감지된 프로파일**: heart_diagnosis_benefit
- **requestId**: sample-ASSESS_101-1779445576615

## RAG 참고자료 인용 현황
- official: 8건
- internal (내부검토): 3건
- auxiliary: 0건
- followUp: 0건

### 인용 자료 목록
- [official] **Acute MI criteria - troponin rise/fall, 99th percentile URL, ischemic evidence** | medical_guideline/guideline_summary
- [official] **PCI-related myocardial injury and type 4a MI - PCI 전후 채혈 시간관계** | medical_guideline/guideline_summary
- [official] **서버 기본 약관 - 급성심근경색증 진단확정 조항** | terms_standards/policy_terms_bundle (유사도: 1.000)
- [official] **서버 기본 약관 - 허혈심장질환 진단확정 조항** | terms_standards/policy_terms_bundle (유사도: 0.980)
- [official] **Unstable angina vs NSTEMI - troponin 및 I20/I21.4/I25.1 코드 구분** | medical_guideline/guideline_summary (유사도: 0.691)
- [official] **Fourth Universal Definition of Myocardial Infarction (2018) - myocardial injury와 myocardial infarction 구분** | medical_guideline/guideline_summary (유사도: 0.655)
- [official] **CAG/PCI 소견과 허혈 근거 - coronary thrombus, culprit lesion, severe stenosis** | medical_guideline/guideline_summary (유사도: 0.609)
- [official] **대법원 2014.6.12 선고 2013다208661 보험금 - 심근경색(NSTEMI/I21.4) 진단확정 증명책임** | precedents/court_precedent_fulltext
- [internal] **죽상경화성 심장질환(I25.1) 보험금, 왜 거절될까** | practice_playbooks/ (유사도: 0.699)
- [internal] **급성심근경색 진단금 거절 협심증으로 바뀌는 이유와 대응방법** | practice_playbooks/ (유사도: 0.657)
- [internal] **암/뇌/심장 진단비 - DIAGNOSIS_AMI_CRITERIA** | real_case_patterns/anonymized_real_case_pattern (유사도: 0.619)

---

## 생성된 사정서 전문

### title

고객 측 손해사정서 제목

### overview (개요)

본 사건은 피보험자가 급성 심내막하심근경색증(I21.4)으로 진단받았으나, 보험사가 심근효소 상승이 확인되지 않았다는 이유로 보험금 지급을 거부한 사례입니다. 고객 측은 주치의의 진단서와 의무기록, 심근효소 수치, 심전도 소견이 모두 일치하며, 보험사의 부지급 논리는 전체 의무기록과 지급요건 검토에 비추어 불충분하다고 주장합니다.

### facts (사실관계)

피보험자는 흉통으로 내원하여 운동부하검사에서 ST depression이 확인되었고, 관상동맥 CT 및 CAG에서 중증 협착이 발견되어 PCI를 받았습니다. CAG 시행 전 혈액검사에서 CK-MB와 Troponin T 수치가 측정되었으며 이후 외래 기록에서 hs-troponin 상승이 확인되었습니다. 주치의는 I21.4 진단서를 발급하였습니다.

### issues (쟁점)

보험사는 CAG 시행 전 단일 시점의 심근효소 수치만을 근거로 급성 심내막하심근경색증 진단을 부정하고 있습니다. 그러나 Fourth Universal Definition of Myocardial Infarction 2018에 따르면, 심근경색 판단은 troponin 상승과 허혈성 증거를 함께 검토해야 합니다.

주요 쟁점은 심장질환 진단비 청구에서 진단확정이 인정되는지, 트로포닌ㆍ심전도ㆍ관상동맥조영술 등 검사결과가 가입 당시 약관상 급성심근경색 또는 허혈성심장질환 정의에 해당하는지입니다.
주요 쟁점은 심장질환 진단확정 여부와 검사결과, 트로포닌 등 심근효소, 심전도, 관상동맥조영술 자료가 가입 당시 약관상 지급기준을 충족하는지입니다.

### legalAndReferenceBasis (법적 근거)

급성심근경색증 진단확정은 의료기관 의사의 진단과 병력, 심전도, 심장초음파, 관상동맥촬영술, 혈액 중 심장효소검사 등을 기초로 한다는 약관 조항이 있습니다. 관련 판례로는 대법원 2014-06-12 선고 2013다208661 판결이 있으며 이는 보험사가 진단의 부당함을 주장하려면 구체적인 의학적 반증을 제시해야 한다고 명시하고 있습니다.

[본문 반영 근거]

Acute MI criteria - troponin rise/fall, 99th percentile URL, ischemic evidence은(는) retrievedReferences에 포함된 공식/준공식 근거로서 본 건 적용 가능성을 검토해야 한다.
PCI-related myocardial injury and type 4a MI - PCI 전후 채혈 시간관계은(는) retrievedReferences에 포함된 공식/준공식 근거로서 본 건 적용 가능성을 검토해야 한다.
서버 기본 약관 - 급성심근경색증 진단확정 조항은(는) 약관 검토자료이나, 가입 당시 해당 보험회사ㆍ상품의 원약관 확인 전에는 표준약관 또는 유사자료로만 참고해야 한다.
서버 기본 약관 - 허혈심장질환 진단확정 조항은(는) 약관 검토자료이나, 가입 당시 해당 보험회사ㆍ상품의 원약관 확인 전에는 표준약관 또는 유사자료로만 참고해야 한다.
Unstable angina vs NSTEMI - troponin 및 I20/I21.4/I25.1 코드 구분은(는) retrievedReferences에 포함된 공식/준공식 근거로서 본 건 적용 가능성을 검토해야 한다.
Fourth Universal Definition of Myocardial Infarction (2018) - myocardial injury와 myocardial infarction 구분은(는) retrievedReferences에 포함된 공식/준공식 근거로서 본 건 적용 가능성을 검토해야 한다.
CAG/PCI 소견과 허혈 근거 - coronary thrombus, culprit lesion, severe stenosis은(는) retrievedReferences에 포함된 공식/준공식 근거로서 본 건 적용 가능성을 검토해야 한다.

약관상 급성심근경색 진단비 지급요건은 가입 당시 약관의 진단확정 조항, 질병분류표, 심근효소 및 심전도ㆍ영상ㆍ관상동맥조영술 기록을 종합해 판단해야 한다. 업로드 약관 또는 직접 관련 RAG 근거가 부족한 항목은 근거자료 부족으로 표시하고, 없는 판례나 분쟁조정번호는 특정하지 않는다.
심장질환 진단비 사건에서는 진단확정, 검사결과, 트로포닌 또는 심전도 또는 관상동맥조영술, 가입 당시 약관을 중심으로 추가 확인 및 .

### damageAssessment (손해 평가)

보험사는 단일 시점의 심근효소 수치만을 문제 삼고 있으나 이는 전체 의무기록 흐름에 비추어 부당합니다. 주치의의 진단서와 심근효소 수치, 심전도 소견이 모두 일치하며, 급성 심내막하심근경색증 진단은 타당합니다.

위 근거들을 현 사건에 적용하면, 보험회사의 주장은 진료기록의 존재만으로 충분하지 않고 청약서 질문사항 해당성, 중요한 사항성, 피보험자의 인식 가능성, 고의 또는 중대한 과실, 그리고 보험금 부지급과 관련한 인과관계가 함께 확인되어야 한다.

고객 측에서 유리한 핵심은 I21.4 진단서/소견서, CAG상 중증 협착, PCI/stent 시행, hs-troponin 및 CK-MB 변화, ECG 및 Echo 소견이다. 보험사가 Unstable angina 또는 CAD 기재만으로 부지급한다면 이는 의무기록 전체가 아니라 일부 진단명만을 선택한 단편적 해석이다.
손해액 산정보다는 심장질환 진단확정과 검사결과의 충족 여부가 핵심입니다.

### insurerPositionReview (보험사 주장 검토)

보험사의 주장은 단편적 해석에 불과하며, 전체 의무기록과 지급요건 검토에 비추어 부당합니다. 보험사는 주치의의 I21.4 진단을 부정하려면 구체적인 의학적 반증을 제시해야 합니다.

보험회사의 핵심 약점은 PCI 후 troponin 상승 가능성을 확정 사실처럼 전제할 수 없다는 점이다. 보험회사는 채혈시간, 시술시간, 시술 전후 효소 추이, ECG/RWMA/LVEF, 주치의 I21.4 진단 근거를 종합해 반대 근거를 제시해야 하며, 그 입증 없이 주치의 진단을 배척하기 어렵다.

### adjusterOpinionDraft (손해사정사 의견)

본 사건에서 피보험자는 급성 심내막하심근경색증으로 진단받았으며, 주치의의 진단서와 의무기록, 심근효소 수치, 심전도 소견이 모두 일치합니다. 보험사의 부지급 논리는 단편적 해석에 불과하며, 전체 의무기록과 지급요건 검토에 비추어 부당합니다. 보험사는 주치의의 I21.4 진단을 부정하려면 구체적인 의학적 반증을 제시해야 합니다. 따라서 보험금 지급이 타당하다고 판단됩니다.

보험회사가 입퇴원요약지상 Unstable angina 또는 CAD 기재만을 근거로 I21.4 급성 심내막하심근경색증 진단을 배척하는 것은 전체 의무기록의 흐름을 단편적으로 해석한 것이다. 진단서/소견서의 I21.4 기재, CAG 결과, PCI/stent 시행, hs-troponin 및 CK-MB 변화, ECG와 Echo 소견을 함께 보아야 한다.

피보험자에게 LM-LAD 또는 LM-mLAD 중증 협착, CAG상 유의 협착, PCI/stent 시행, hs-troponin 상승, 주치의 I21.4 진단이 확인된다면 이는 단순 흉통 또는 일반 CAD로 축소할 사안이 아니다. 보험사는 불리한 진단명 하나만 선택해 급성 관상동맥증후군 전체 경과를 배제할 수 없다.

보험회사가 hs-troponin 상승이 PCI 후 발생한 시술 관련 상승이라고 주장하려면 PCI 시행 전후의 정확한 채혈시간, 시술기록, 심근효소 연속 수치, 주치의 진단 근거를 종합해 입증해야 한다. 상승 시점에 관한 가능성만으로 주치의의 I21.4 진단을 배척할 수 없다.

따라서 본 건의 손해사정 의견은 급성심근경색 진단비 지급 타당성을 고객 측에서 적극 주장하는 방향이다. 다만 ECG상 ST 변화, Echo상 RWMA/LVEF, CAG 원문 및 채혈시간표가 누락되어 있으면 해당 자료를 추가 확보해 보험사의 시술 관련 상승 주장을 차단해야 한다.
심장질환 진단비 사건에서는 진단확정, 검사결과, 트로포닌 또는 심전도 또는 관상동맥조영술, 가입 당시 약관을 중심으로 추가 확인 및 .

### requiredAdditionalChecks (추가확인사항)

CAG 시행 전후의 심근효소 수치 변화와 PCI 후의 추가적인 심전도 및 심장초음파 결과를 확인할 필요가 있습니다.
가입 당시 약관
트로포닌 등 심근효소 검사결과
심전도 또는 ECG/EKG
관상동맥조영술(CAG) 결과
PCI/스텐트 기록
진료기록지
질병분류표
보험회사 부지급 사유서
추가 확인 자료: 트로포닌 검사결과, 심전도, 관상동맥조영술, 진료기록, 가입 당시 약관

### customerSideAssessmentReport (피보험자측 사정서)

1. 사정 결론: 피보험자는 급성 심내막하심근경색증으로 진단받았으며, 보험사의 부지급 논리는 전체 의무기록과 지급요건 검토에 비추어 불충분합니다.
2. 보험사 부지급 논리의 문제점: 보험사는 단일 시점의 심근효소 수치만을 문제 삼고 있으나 이는 전체 의무기록 흐름에 비추어 부당합니다.
3. 고객 측 핵심 인정 사실: 주치의의 진단서와 심근효소 수치, 심전도 소견이 모두 일치합니다.
4. 의학적 핵심 쟁점: 심근경색 판단은 troponin 상승과 허혈성 증거를 함께 검토해야 합니다.
5. 약관상 지급요건 충족 주장: 급성심근경색증 진단확정은 의료기관 의사의 진단과 병력, 심전도, 심장초음파, 관상동맥촬영술, 혈액 중 심장효소검사 등을 기초로 합니다.
6. 핵심 근거자료: 대법원 2014-06-12 선고 2013다208661 판결
7. 보험사 주장에 대한 반박: 보험사의 주장은 단편적 해석에 불과하며, 전체 의무기록과 지급요건 검토에 비추어 부당합니다.
8. 추가 확보자료: CAG 시행 전후의 심근효소 수치 변화와 PCI 후의 추가적인 심전도 및 심장초음파 결과를 확인할 필요가 있습니다.
9. 손해사정 의견: 보험금 지급이 타당하다고 판단됩니다.

### finalSubmissionAssessmentReport (최종 제출용 사정서)

손해사정서
(보험금 부지급 통보에 대한 이의 및 의견)

수신: [보험사]
작성일: 2026-05-22
참조: 보험금 지급심사 담당자
문서번호: AI-TEMP-20260522
제목: I21.4 급성 심내막하심근경색증 (NSTEMI) 관련 보험금 부지급 통보에 대한 이의 및 지급 요청

피보험자 정보
- 피보험자: [피보험자]
- 주민번호: [주민번호]
- 주소: [주소]
- 연락처: [연락처]
- 증권번호: [증권번호]
- 계약상품: [계약상품]
- 청구담보: 급성심근경색 진단비
- 진단의료기관: [진단의료기관]
- 확정진단명: I21.4 급성 심내막하심근경색증 (NSTEMI)

[보험사]는 본 건 보험금 청구에 대하여 부지급 또는 지급 거절 취지로 통보하였으나, 그 판단은 제출된 의무기록과 약관상 진단확정 요건을 단편적으로 해석한 것으로 부당합니다. 특히 진단서 발급 당일 의무기록에는 주치의가 cardiac marker 상승, EKG 및 UA-NSTEMI 가능성을 검토한 과정이 남아 있어, 본 건은 진단서만 존재하는 사안이 아닙니다. 1) 주치의가 I21.4 급성 심내막하심근경색증 진단을 명시한 점 2) 흉통, 심전도 또는 운동부하검사상 허혈성 변화, CCTA/CT 및 CAG/PCI 경과가 급성 관상동맥증후군의 흐름과 부합하는 점 3) Troponin T, hs-troponin, CK-MB 등 심근효소 자료는 검사기관 참고치 및 PCI 전후 채혈시간과 함께 판단해야 하는 점 4) 보험회사가 입퇴원요약지의 Unstable angina 또는 CAD 기재만으로 I21.4 진단서를 배척하는 것은 약관에 없는 추가 요건을 부가한 점 따라서 보험회사는 부지급 결정을 철회하고 해당 보험금을 지급하여야 합니다.

Ⅰ. 사건의 경위 및 진단 확정 과정
1) 흉통 발생 및 초기 검사
- 피보험자는 흉통으로 내원하여 운동부하검사에서 ST depression이 확인되었고, 관상동맥 CT 및 CAG에서 중증 협착이 발견되어 PCI를 받았습니다.
- 피보험자는 흉통으로 내원하여 운동부하검사에서 ST depression이 확인되었고, 관상동맥 CT 및 CAG에서 중증 협착이 발견되어 PCI를 받았습니다.

2) 입원 및 관상동맥 중재시술
- 피보험자는 흉통으로 내원하여 운동부하검사에서 ST depression이 확인되었고, 관상동맥 CT 및 CAG에서 중증 협착이 발견되어 PCI를 받았습니다.
- 피보험자는 흉통으로 내원하여 운동부하검사에서 ST depression이 확인되었고, 관상동맥 CT 및 CAG에서 중증 협착이 발견되어 PCI를 받았습니다.

3) 심근효소 검사 결과
- CAG 시행 전 혈액검사에서 CK-MB와 Troponin T 수치가 측정되었으며 이후 외래 기록에서 hs-troponin 상승이 확인되었습니다.

4) 진단서/소견서 발급
- 주치의는 I21.4 진단서를 발급하였습니다.
- 2024.06.27 외래 SOAP 기록에는 "이후 외래 SOAP 기록: hs-troponin 0.037, 주치의 소견 「cardiac marker 상승, EKG로 UA-NSTEMI 진단서 가능」." 취지의 주치의 검토가 남아 있어, 진단서 발급이 단순 문서 작성이 아니라 cardiac marker, EKG 및 UA-NSTEMI 가능성을 검토한 결과임이 확인됩니다.

결정적 의무기록 문구
1) 2024.06.27 이후 외래 SOAP 기록: hs-troponin 0.037, 주치의 소견 「cardiac marker 상승, EKG로 UA-NSTEMI 진단서 가능」.
 - 의미: 진단서 발급 당일 주치의가 cardiac marker, EKG 및 UA-NSTEMI 가능성을 검토한 객관적 판단 과정이다.
2) 2024.06.20 CAG 시행 전 혈액검사: CK-MB 2.1, Troponin T 0.021.
 - 의미: 심근손상 및 NSTEMI/I21.4 판단에서 핵심이 되는 심장효소 검사 근거이다.
3) 2024.05.20 D-30: 운동부하검사(TMT) ST depression 확인.
 - 의미: 약관상 심전도 기초 요건과 Fourth Universal Definition의 ischemic ECG evidence에 연결되는 근거이다.
4) 2024.06.19 D-22: 관상동맥 CT — Ca score 532.9, LM 협착 >90%, LAD 70%, LCx >70%.
 - 의미: 관상동맥촬영술 및 PCI/stent 시행은 약관상 검사요건과 급성 관상동맥증후군의 객관적 경과를 뒷받침한다.
5) 급성심근경색증 진단확정은 의료기관 의사의 진단과 병력, 심전도, 심장초음파, 관상동맥촬영술, 혈액 중 심장효소검사 등을 기초로 한다.
 - 의미: 약관은 시술 전 심근효소 상승을 독립 요건으로 두지 않고, 객관검사와 전문의 진단을 종합하도록 정한다.

핵심 수치 및 반복 논거
- hs-troponin: hs-troponin 0.037 (NSTEMI/I21.4 판단에서 심근손상을 뒷받침하는 핵심 수치)
- Troponin T: Troponin T 0.021 (심장효소검사상 급성 심근손상 판단 수치)
- CK-MB: CK-MB 2.1 (심근효소 검사상 보조 판단 수치)
- LM-LAD 협착률: 협착 >90% (CAG/PCI 시행 필요성과 급성 관상동맥증후군 경과를 뒷받침하는 수치)
- hs-troponin/Troponin T: Troponin T 0.021 (심근손상 및 NSTEMI/I21.4 판단의 핵심 수치)
- hs-troponin/Troponin T: hs-troponin 0.037 (심근손상 및 NSTEMI/I21.4 판단의 핵심 수치)
- hs-troponin/Troponin T: hs-troponin 상승이 확인되었습니다. 주치의는 I21.4 (심근손상 및 NSTEMI/I21.4 판단의 핵심 수치)
- 관상동맥 협착률: 협착 >90% (CAG/PCI 시행 필요성과 급성 관상동맥증후군 경과를 뒷받침하는 수치)

Ⅱ. 보험사 부지급 결정의 요지 및 그 부당성
보험회사의 부지급 사유는 「흉통 발생 이후 관상동맥조영술 시행 전까지 시행한 혈액검사상 심근효소 상승이 확인되지 않아, 심근경색까지 진행하지 않은 것으로 검토되는 바, 급성 심내막하심근경색증(I21.4) 진단 불인 의견, 죽상경화성 심장병(I25.1) 진단 인정 의견」로 정리됩니다. 이에 대한 고객 측 반박은 인용문 밖에서 검토합니다. 핵심 부지급 사유는 시술 전 심근효소 상승 부재, Unstable angina/CAD 기재, PCI 후 troponin 상승 가능성을 이유로 I21.4 진단을 배척하는 주장입니다.
1) 급성심근경색 진단기준을 시술 전 효소 상승 여부로 축소
 - 오류 유형: medical_criteria_distortion
 - 반박 명제: Fourth Universal Definition of MI는 troponin rise/fall과 허혈 증상, ECG, 영상, CAG/PCI 등 허혈 근거를 종합하도록 하며, 시술 전 상승만을 단독 요건으로 두지 않습니다.
2) Unstable angina 또는 CAD 기재만 선택
 - 오류 유형: omitted_key_evidence
 - 반박 명제: 주치의 I21.4 진단서, 흉통, ECG/TMT ST 변화, CAG상 중증 협착, PCI/stent, 심근효소 자료를 함께 보아야 합니다.
3) 주치의의 객관적 검토 과정 누락
 - 오류 유형: omitted_key_evidence
 - 반박 명제: 진단서 발급 당일 SOAP/외래 기록에 cardiac marker 상승, EKG, UA-NSTEMI 진단 가능성 등 주치의의 객관적 검토 과정이 남아 있다면 보험회사는 이를 배제할 수 없습니다.
4) 약관상 진단확정 요건을 충족하지 못했다는 주장
 - 오류 유형: policy_requirement_misread
 - 반박 명제: 약관이 요구하는 것은 전문의 진단과 병력, 심전도, 관상동맥촬영술, 심장효소검사 등 기초자료이지, 보험회사가 사후에 붙인 시술 전 효소 상승 요건이 아닙니다.
5) 판례 또는 결정례가 진단서 기재만으로 부족하다는 취지라는 주장
 - 오류 유형: case_law_misuse
 - 반박 명제: 그 법리는 오히려 전체 검사자료와 전문의 진단 근거를 종합하라는 취지로 적용되어야 하며, 본 건처럼 CAG/PCI와 심근효소 자료가 있는 사안에는 보험사에게 유리하게 단순 적용할 수 없습니다.
6) 시술 전 효소 상승 또는 특정 ECG 양상 부재를 추가 요건화
 - 오류 유형: unsupported_additional_requirement
 - 반박 명제: 약관에 없는 추가 요건을 보험회사가 임의로 부가할 수 없고, 문언상 의문이 있으면 작성자 불이익 원칙에 따라 고객에게 유리하게 해석되어야 합니다.
위 오류들은 서로 독립적으로 보험사 주장을 무력화합니다. 의학 기준상 오류가 인정되지 않더라도 약관 문언, 판례/금감원 자료의 적용 방식, 약관해석 원칙 중 어느 하나만으로도 보험회사의 단편적 부지급 논리는 유지되기 어렵습니다.

Ⅲ. 의학적 근거 급성심근경색증(I21.4) 진단의 정당성
- Acute MI criteria - troponin rise/fall, 99th percentile URL, ischemic evidence: 급성 심근경색 판단은 troponin rise/fall 및 99th percentile URL 초과와 함께 허혈성 흉통 등 증상, 새로운 허혈성 ECG 변화, 병적 Q파, 새 viable myocardium loss 또는 RWMA, CAG/부검상 coronary thrombus 중 적어도 하나의 허혈 근거를 함께 검토한다.
- PCI-related myocardial injury and type 4a MI - PCI 전후 채혈 시간관계: PCI 후 troponin 상승은 시술 관련 myocardial injury 또는 type 4a MI 쟁점이 될 수 있다. 보험사가 PCI 후 상승만으로 주치의 I21.4 진단을 배척하려면 PCI 전 baseline, 시술 후 상승폭, 새 ECG 변화, 병적 Q파, 새 RWMA/viable myocardium loss, angiographic flow-limiting complication 등 시간관계와 허혈 근거를 제시해야 한다.
- Unstable angina vs NSTEMI - troponin 및 I20/I21.4/I25.1 코드 구분: Unstable angina는 임상적으로 급성 관상동맥증후군 범주에 속하지만, NSTEMI/I21.4와의 핵심 구분은 심근손상을 뒷받침하는 troponin 상승 여부와 허혈 증거이다. I20 협심증, I21.4 급성 심내막하심근경색증, I25.1 관상동맥질환 기재가 혼재하면 단일 진단명만 선택하지 말고 전체 검사 흐름과 주치의 진단 근거를 대조한다.
- Fourth Universal Definition of Myocardial Infarction (2018) - myocardial injury와 myocardial infarction 구분: 심근손상은 troponin이 해당 검사법의 99th percentile upper reference limit를 초과할 때 성립한다. 심근경색은 급성 심근손상에 더해 허혈 증거가 결합되어야 하므로, troponin 상승만으로 I21.4 지급요건 충족 또는 배척을 단정하지 않는다.
- CAG/PCI 소견과 허혈 근거 - coronary thrombus, culprit lesion, severe stenosis: CAG에서 coronary thrombus, culprit lesion, acute occlusion 또는 flow-limiting complication이 확인되면 급성 허혈성 사건 판단에 중요하다. LM-LAD 또는 LM-mLAD 중증 협착과 PCI/stent 시행 사실은 단독으로 심근경색 확정은 아니지만, 흉통ㆍtroponin 추이ㆍECGㆍEcho와 결합하면 보험사 단순 CAD/협심증 해석의 약점을 지적하는 근거가 된다.

myocardial injury와 myocardial infarction을 구분하고, troponin rise/fall 및 99th percentile 초과와 함께 허혈 증상, ECG 변화, 영상상 RWMA/viable myocardium loss, coronary thrombus 또는 CAG/PCI 소견을 종합합니다.

Fourth Universal Definition of Myocardial Infarction 2018은 myocardial injury와 myocardial infarction을 구분하고, troponin rise/fall 및 99th percentile 초과와 허혈 증거를 함께 요구합니다.

| 판단 기준 | 본 건 적용 사실 | 손해사정 의견 |
|---|---|---|
| myocardial injury와 myocardial infarction 구분 | Troponin T, hs-troponin, CK-MB 자료는 검사기관 참고치와 rise/fall을 기준으로 판단해야 함 | 단순 수치 또는 단일 채혈시점만으로 I21.4를 배척할 수 없음 |
| ischemic symptoms | 흉통 및 급성 관상동맥증후군 의심 경과 | 허혈성 증상 존재는 고객 측에 유리한 정황 |
| ECG/TMT ischemic change | ST depression 등 허혈성 변화 여부 확인 대상 | 보험회사가 이를 배척하려면 원 판독지 기준으로 반대 근거를 제시해야 함 |
| CCTA/CT/CAG/PCI | LM/LAD/LCx 협착, LM-LAD 또는 LM-mLAD 중증 협착, PCI/stent 시행 | 단순 CAD로 축소할 수 없고 급성 허혈성 사건과 연결해 보아야 함 |
| PCI 전후 troponin 채혈시간 | 보험사는 시술 전 상승 없음 또는 PCI 후 상승이라고 주장 가능 | 그 주장은 PCI 전 baseline, 시술시간, 시술 후 상승폭, ECG/RWMA 등 추가 근거로 보험사가 입증해야 함 |
| NSTEMI/I21.4와 Unstable angina | UA와 NSTEMI는 troponin 상승 및 허혈 근거로 구분. I25.1 죽상경화성 심장병 기재는 CAD 배경질환을 의미할 수 있음 | 입퇴원요약지 UA 또는 I25.1 기재만으로 주치의 I21.4 진단을 배척할 수 없음 |

주치의 SOAP 기록의 객관성: 2024.06.27 의무기록에는 "이후 외래 SOAP 기록: hs-troponin 0.037, 주치의 소견 「cardiac marker 상승, EKG로 UA-NSTEMI 진단서 가능」." 취지의 검토가 확인됩니다. 이는 NSTEMI/I21.4 판단이 진단서 문구만의 문제가 아니라 cardiac marker, EKG 및 임상경과를 근거로 한 전문의 판단임을 보여줍니다.

진단서만 있는 사건이 아니라 주치의가 의무기록상 객관적 검사자료를 검토한 뒤 I21.4/NSTEMI 진단 가능성을 판단한 사건입니다. 위 기준을 종합하면 보험회사가 I21.4 진단을 단순 UA/CAD로 축소하거나 PCI 후 효소 상승 가능성만으로 배척하는 것은 의학 기준의 핵심을 왜곡한 것입니다.

Ⅳ. 보험약관상 진단확정 요건의 충족
업로드 약관은 제출되지 않았으나, 서버 기본 약관/RAG 기준으로 확인되는 심장질환 진단확정 조항을 적용합니다.
- 서버 기본 약관 - 급성심근경색증 진단확정 조항 [업로드 약관 없음 - 서버 기본 약관 기준]: 급성심근경색증 진단확정은 의료기관 의사의 진단과 병력, 심전도, 심장초음파, 관상동맥촬영술, 혈액 중 심장효소검사 등을 기초로 한다.
- 서버 기본 약관 - 허혈심장질환 진단확정 조항 [업로드 약관 없음 - 서버 기본 약관 기준]: 허혈심장질환 진단확정도 의료기관 의사의 진단과 병력, 심전도, 심장초음파, 관상동맥촬영술, 혈액 중 심장효소검사 등 객관자료를 기초로 한다.

| 약관상 요구 요건 | 본 건 충족 사실 | 의견 |
|---|---|---|
| 의료기관 의사 진단 | 주치의 진단서/소견서상 I21.4 진단이 확인됨 | 충족 |
| 병력 | 흉통으로 내원하고 급성 관상동맥증후군 의심 경과가 확인됨 | 충족 |
| 심전도/운동부하검사 | ECG 또는 TMT ST depression 등 허혈성 변화가 확인됨 | 충족으로 평가됨 |
| 관상동맥촬영술 | CAG상 LM-LAD 또는 LM-mLAD 중증 협착 및 PCI/stent 시행이 확인됨 | 충족 |
| 혈액 중 심장효소검사 | Troponin T, hs-troponin, CK-MB 검사 및 참고치 초과가 확인됨 | 충족 |

약관은 시술 전 심근효소 상승을 급성심근경색 진단확정의 독립 요건으로 규정하고 있지 않다. 따라서 보험회사가 약관에 없는 시술 전 효소 상승 요건을 추가하여 I21.4 진단을 배척하는 것은 약관 문언을 벗어난 부당한 해석이다.

약관상 진단확정 요소는 제출 의무기록에서 충족되는 방향으로 평가되며, 보험회사는 약관에 없는 시술 전 효소 상승 요건을 추가할 수 없습니다.

Ⅴ. 판례 및 금감원 자료에 대한 적용 또는 반박
금감원 분쟁조정례: 직접 적용 가능한 근거자료는 확인되지 않았습니다.

판례:
- 대법원 2014-06-12 선고 2013다208661 판결: 보험금 청구소송에서 보험사고(I21.4 급성심내막하심근경색증 NSTEMI 진단확정) 발생에 대한 증명책임은 피보험자에게 있으나, 전문의 진단서·의무기록·트로포닌/CK-MB 수치·EKG 소견·CAG/PCI 기록 등이 제출되면 1차 증명이 완료된다. 보험사가 진단의 부당함을 주장하려면 구체적인 의학적 반증을 제시해야 하며, 단순히 CAG 시행 전 단일 시점의 심근효소 수치(CK-MB, Troponin T)가 정상이라는 점만을 근거로 I21.4(NSTEMI) 진단을 부정하는 것은 Fourth Universal Definition of Myocardial Infarction 2018의 다중 진단기준과 의무기록 전체를 무시하는 것으로, 본 판결의 증명책임 법리상 허용되지 않는다.

보험사 인용 근거: 대법원 2014-06-12 선고 2013다208661 판결
대법원 2014-06-12 선고 2013다208661 판결의 법리는 진단서 문언만이 아니라 객관적 검사자료와 전문의 진단 근거를 함께 보아야 한다는 구조로 이해해야 합니다.
보험사가 판례를 인용하더라도 본 건의 CAG/PCI, 심근효소, ECG/TMT, 주치의 진단이라는 객관자료를 배제하는 근거로 사용할 수 없습니다.
판례/금감원 자료는 보험사의 단편적 배척 논리를 보강하는 자료가 아니라 전체 검사자료와 진단 근거를 요구하는 방향으로 고객 측에 유리하게 적용됩니다.

Ⅵ. 약관해석 원칙
약관 문언이 심근효소검사의 특정 채혈시점이나 시술 전 상승만을 요구하지 않음에도 보험회사가 이를 추가 요건으로 주장하는 데 해석상 문제가 있습니다.
보험회사가 작성한 약관 문언이 불명확하다면 작성자 불이익 원칙에 따라 고객에게 유리하게 해석되어야 합니다.
약관에 없는 추가 요건을 이유로 I21.4 진단비 지급을 거절하는 것은 부당합니다.

Ⅶ. 결론
첫째, 진단서만 있는 사건이 아니라 주치의가 의무기록상 객관적 검사자료를 검토한 뒤 I21.4/NSTEMI 진단 가능성을 판단한 사건입니다. 위 기준을 종합하면 보험회사가 I21.4 진단을 단순 UA/CAD로 축소하거나 PCI 후 효소 상승 가능성만으로 배척하는 것은 의학 기준의 핵심을 왜곡한 것입니다.
둘째, 약관상 진단확정 요소는 제출 의무기록에서 충족되는 방향으로 평가되며, 보험회사는 약관에 없는 시술 전 효소 상승 요건을 추가할 수 없습니다.
셋째, 약관에 없는 추가 요건을 이유로 I21.4 진단비 지급을 거절하는 것은 부당합니다. 의무기록 자체로 주치의가 객관적 검사자료를 검토하여 I21.4/NSTEMI 진단을 판단한 사실이 입증됩니다. 따라서 급성심근경색증진단보험금 지급대상에 해당하므로 보험금 전액을 지급해야 합니다.

[요청사항]
1. 급성심근경색증진단보험금 지급대상에 해당하므로 보험금 전액을 지급해야 합니다.
2. 부지급 통보 이후 지연기간에 대한 지연이자를 함께 지급해야 합니다.
3. 부동의 시 보험회사는 의학적 근거와 약관상 근거를 구분하여 서면으로 회신해야 합니다.
4. 구체적 사유 없는 부동의가 유지될 경우 분쟁조정 또는 소송 등 후속 절차를 검토할 수 있음을 명시합니다.

[첨부서류]
1. 진단서
2. 소견서
3. 의무기록
4. 보험사 부지급 통보서
5. 보험증권
6. 약관

### simpleClientSummary (간단 요약)

보험회사가 Unstable angina 또는 CAD 기재만으로 I21.4 진단을 부정하는 것은 전체 의무기록에 비추어 다툴 수 있습니다. CAG/PCI 기록, hs-troponin/CK-MB 추이, ECG, Echo, 주치의 보완소견서를 확보해 급성심근경색 진단비 지급 타당성을 주장해야 합니다.
