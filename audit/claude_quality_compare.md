# GPT → Claude 전환 품질 비교 분석

작성일: 2026-05-24  
Claude 배포 커밋: (현재 HEAD, 전환 후 첫 정상 배포)  
GPT 샘플 커밋: a536828 / 4471d34 (2026-05-23)  
비교 대상 필드: `finalSubmissionAssessmentReport`

---

## 요약

| 항목 | GPT | Claude | 판정 |
|------|-----|--------|------|
| Ⅱ섹션 구체성 (DCIS) | DCIS/high grade/comedo/microinvasion/2.3cm ✓ | 동일 ✓ | 동등 |
| T1mi 인용 (DCIS) | ✗ 없음 | ✓ AJCC T1mi 명시 | **Claude 우세** |
| 【쟁점 X】 구조적 반박 | ✗ 없음 | ✓ 3~4개 쟁점 블록 | **Claude 우세** |
| Fourth Universal Definition (심장) | ✓ | ✓ | 동등 |
| troponin / hs-troponin 수치 (심장) | ✓ | ✓ | 동등 |
| 2013다208661 판례 역공 (심장) | ✓ | ✓ | 동등 |
| DWI / AHA/ASA / 조직기반 TIA (뇌) | ✓ | ✓ | 동등 |
| selfVerification 전체 PASS | 3/3 | 3/3 (051 policyQuote 제외) | 동등 |
| 금지어 ("사료됩니다" 등) | 없음 | 없음 | 동등 |
| 깨진 문구 (mojibake, 어색 문체) | 없음 | 없음 | 동등 |
| finalSubmissionAssessmentReport 길이 | 035:7286 / 101:10086 / 051:6434 | 035:8641 / 101:10322 / 051:7160 | **Claude 소폭 길어짐** |

---

## 케이스별 Ⅱ섹션 상세 비교

### ASSESS_035 — 유방 DCIS / C50.9 vs D05.1 코드 불일치

**구조 (GPT = Claude, 완전 동일)**  
Ⅱ섹션은 `composeSubmissionAssessmentReport` 함수가 케이스 입력의 `insurerPosition` 필드를 기반으로 고정 템플릿으로 생성한다. GPT/Claude 모두 동일한 5개 반박점을 생성한다.

```
1) 병리 보고서 D05.1(DCIS)로 진단서 C50.9 부정 → 오류: medical_criteria_distortion
   반박: DCIS, high nuclear grade, comedo necrosis, microinvasion, 2.3cm + 항호르몬 치료 종합 필요

2) microinvasion 의심 소견 = 확정 침윤암 아님 → 오류: omitted_key_evidence
   반박: 침윤 가능성 배제 아님, high grade + comedo + 항호르몬 = 악성 판단

3) D코드 우선 적용, 소액 지급 → 오류: policy_requirement_misread
   반박: 약관 진단확정 기준은 병리전문의 현미경 소견 기초, 코드 대체는 약관 외 추가 요건

4) 암 진단확정 요건 미충족 → 오류: policy_requirement_misread
   반박: 병리 보고서 자체에 microinvasion 의심 포함, 요건 충족

5) 약관에 없는 추가 조건으로 지급 거절 → 오류: unsupported_additional_requirement
   반박: 다의적 약관 문언 → 작성자 불이익 원칙 적용
```

**Claude만의 추가 (Ⅲ섹션 쟁점 블록):**
```
【쟁점 1】 C50.9 vs D05.1 코드 불일치의 법적·약관적 처리
  → 임상의 C50.9 기재는 병리 소견 전체(microinvasion 포함) 종합한 임상 판단
【쟁점 2】 Microinvasion(<1mm) 의심의 의학적 의미
  → WHO 기저막 침범 요건 적용 + AJCC/UICC TNM 8판: microinvasion = T1mi (Tis 아님) ← GPT에 없음
【쟁점 3】 High grade DCIS + comedo necrosis + 항호르몬 치료 임상적 의미
  → C50.9 진단 뒷받침하는 임상 근거로 명시
【쟁점 4】 가입 당시(2017년 5월) 약관 원문 확인 필요성
  → 서버 RAG 약관(2012/2021)과 가입 당시 약관 차이 지적
```

**핵심 차이: T1mi 인용**
- GPT: T1mi 언급 없음
- Claude: "AJCC/UICC TNM 8판에서 microinvasion은 T1mi로 분류되어 Tis(상피내암)와 구별된다" 명시
- **평가**: T1mi는 실제 분쟁에서 핵심 근거 — Claude가 GPT보다 구체적으로 더 강한 주장

---

### ASSESS_101 — I21.4 NSTEMI 급성심근경색 (v2 gold 케이스)

**구조 (GPT = Claude, 완전 동일)**  
6개 반박점:
```
1) 시술 전 효소 상승 여부로 MI 진단기준 축소 → Fourth Universal Definition of MI 역공
2) Unstable angina/CAD 기재만 선택 → troponin/ECG/CAG/PCI 전체 종합 필요
3) 주치의 객관적 검토 누락 → cardiac marker + EKG + SOAP 기록 배제 불가
4) 약관상 진단확정 미충족 → 시술 전 효소 상승은 약관에 없는 추가 요건
5) 판례 기재만으로 진단서 부족 → 법리 역적용 (검사자료 종합 요구)
6) 시술 전 효소 상승 추가 요건화 → 작성자 불이익 원칙
```

**핵심 인용 유지 확인:**
- `Fourth Universal Definition of MI` ✓ (GPT/Claude 동일)
- `hs-troponin 0.037` SOAP 기록 ✓ (GPT/Claude 동일)
- `대법원 2013다208661` 판례 역공 ✓ (GPT/Claude 동일)
- `CAG/PCI, LM-LAD 협착 >90%` ✓

**평가**: 심장 케이스는 Ⅱ섹션 품질이 GPT와 완전히 동등. `건강유지비용` 인용 등 기존 gold 기준 모두 충족.

---

### ASSESS_051 — 급성 뇌경색 I63 / DWI vs CT 논쟁

**구조 (GPT = Claude, 완전 동일)**  
4개 반박점:
```
1) CT 음성 → 뇌경색 아님 주장 → AHA/ASA: CT는 조기 허혈 미검출 흔함, DWI가 표준
2) 증상 호전 → TIA 해당 주장 → AHA/ASA 2009: 조직 기반 정의, DWI 병변 확인 = 뇌경색
3) 약관상 뇌혈관질환 진단확정 미충족 → CT 의존 추가 요건 불허
4) 약관에 없는 추가 조건으로 지급 거절 → 작성자 불이익 원칙
```

**Claude만의 추가 (Ⅲ섹션 쟁점 블록):**
```
【쟁점 1】 급성 뇌경색 표준 영상검사: CT인가 DWI/MRI인가
  → AHA/ASA 2019: DWI = 핵심 확진 도구. CT는 출혈 배제 목적. 24시간 내 CT 음성 = 흔한 소견
  → DWI 고신호 + ADC 감소 = 비가역적 허혈 손상 확정 소견 (국제 인정)
【쟁점 2】 TIA(G45) vs 뇌경색(I63) 감별 기준
  → WHO 정의: 24시간 이내 완전 소실 + 영상에서 경색 병변 없음 = TIA
  → 본 사안: DWI 병변 + NIHSS 4 지속 + 재활치료 → TIA 기준 미충족
【쟁점 3】 약관상 진단확정 요건 (FSS 2011-53호 직접 인용)
  → 분쟁조정례: 병력 + 신경학적 검진 + MRI 3요소 요구
  → 본 사안 3요소 모두 충족
```

**평가**: Ⅱ섹션 동등. Ⅲ쟁점 블록에서 FSS 분쟁조정례 2011-53호를 약관 해석 근거로 직접 연결하는 점은 GPT보다 더 날카로운 논리 구조.

---

## 전반 품질 체크

### selfVerify 동작

| 케이스 | selfVerification 결과 | repair 루프 |
|--------|----------------------|-------------|
| ASSESS_035 (암) | 전항목 PASS | I21.4 하드코딩 버그로 repair 실행됨 (비심장) |
| ASSESS_101 (심장) | 전항목 PASS | 정상 (해당 없음) |
| ASSESS_051 (뇌) | policyQuotePresent만 false (RAG 데이터 부재) | I21.4 하드코딩 버그로 repair 실행됨 (비심장) |

**I21.4 hardcode 버그 현황**: 비심장 케이스(암/뇌)에서 불필요한 repair 루프가 여전히 실행됨 (`index.ts:1588`). 그러나 repair 결과가 최종 출력 품질에 부정적 영향을 주지 않음 — selfVerification 통과, 금지어 없음.  
→ **버그 우선순위: 유지 (높음). 현재 품질 저하 없지만 불필요한 latency 유발 가능성.**

### cleanPublicText / 문체

- 3케이스 모두 자연스러운 법률한국어
- "~사료됩니다" "~가능성이 있습니다" "~검토 가치가 있습니다" 모두 미출현
- "주장.입니다" 스타일 어색 문구 없음
- 첫째/둘째/셋째 결론 구조 정상 유지
- [요청사항] 3종 (보험금/지연이자/서면회신) 정상

### cancer / brain 분기 구체 반박

- **cancer (ASSESS_035)**: 분기 정상. `cancer_diagnosis_benefit` 프로파일 감지. DCIS/microinvasion/T1mi/항호르몬 치료 등 암 전용 논거 정상 출력
- **brain (ASSESS_051)**: 분기 정상. `brain_diagnosis_benefit` 프로파일 감지. DWI/AHA/ASA/TIA 조직기반 정의 등 뇌 전용 논거 정상 출력
- **cardiac (ASSESS_101)**: 분기 정상. `heart_diagnosis_benefit` 프로파일 감지. Fourth Universal Definition/troponin/CAG 등 심장 전용 논거 정상 출력

---

## GPT 대비 나아진 점 / 어긋난 점

### 나아진 점 (Claude > GPT)

1. **T1mi 인용 신규 (ASSESS_035)**: GPT는 microinvasion 의심을 나열하는 데 그쳤으나, Claude는 AJCC/UICC TNM 8판 `T1mi` 분류를 명시하여 "Tis(상피내암)와 구별되는 병기"임을 법적 근거로 활용. 실제 분쟁에서 유용한 논거.

2. **【쟁점 X】 구조적 반박 블록 신규**: GPT는 Ⅲ섹션에서 RAG 인용 나열 후 단락형 결론 작성. Claude는 쟁점별 구조화된 블록(표준 명시 → 환자 데이터 적용 → 결론)으로 가독성과 논리 밀도 향상.

3. **FSS 분쟁조정례 약관 연결 (ASSESS_051)**: Claude는 FSS 2011-53호를 단순 인용에 그치지 않고 "병력 + 신경학적 검진 + MRI 3요소" 충족을 직접 확인하는 구조로 연결.

4. **finalSubmissionAssessmentReport 길이**: Claude(035: 8641 / 101: 10322 / 051: 7160) > GPT(035: 7286 / 101: 10086 / 051: 6434). 소폭 더 길고, 내용 밀도도 높아짐.

### 동등한 점 (회귀 없음)

5. **Ⅱ섹션 전체**: 템플릿 기반으로 GPT/Claude 완전 동일. 핵심 인용 문구(부지급 사유 「」 직접 인용, 오류 유형 분류, 반박 명제) 모두 유지.

6. **심장 케이스 gold 기준**: Fourth Universal Definition, hs-troponin 0.037, 2013다208661, CAG/PCI 모두 유지.

7. **뇌 케이스 DWI/조직기반 TIA**: AHA/ASA 2009 조직기반 정의, DWI vs CT 구분 모두 유지.

8. **금지어/약한 어미**: 없음. 결론 3종 요청 구조: 유지.

### 어긋난 점 (주의 필요)

9. **I21.4 hardcode 버그 미수정**: 비심장 케이스에서 repair 루프 불필요 실행. 현재 품질 저하 없으나 처리 지연(+수 초) 유발. (`index.ts:1588` 우선 수정 권장)

10. **policyQuotePresent: false (ASSESS_051)**: 약관 원문 부재 시 selfVerification에서 false 반환. RAG 데이터 한계이며 Claude 고유 문제 아님. GPT도 동일.

---

## 최종 판정

**Claude 전환 품질: GPT 대비 동등 이상 (3/3 케이스)**

- Ⅱ섹션(핵심 반박) 구체성: GPT와 동일하거나 소폭 향상
- Ⅲ섹션 의학 논거: 【쟁점 X】 블록 및 T1mi 신규 인용으로 향상
- 깨진 문구: 없음
- 금지어: 없음
- selfVerify repair 버그: 존재하나 출력 품질 영향 없음

**이슈로 남기는 것**: I21.4 hardcode selfVerify 버그 (`index.ts:1588`) — 비심장 케이스 불필요 repair. 기능 정상이나 latency 개선을 위해 조기 수정 권장.
