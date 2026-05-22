# Phase 2-D: 세트 1 암 케이스 6개 통합 테스트 결과

작성일: 2026-05-23  
배포 상태: **구버전 배포 중** (cardiac 버그수정 미배포 — 커밋은 완료, 배포 대기)

---

## 1. 케이스 교체 결과 (작업 1)

| ID | 구 제목 | 신 제목 | 상태 |
|----|---------|---------|------|
| ASSESS_032 | 대장점막내암 일반암/제자리암 분쟁 | 위 점막내암(C16) ESD 후 일반암/제자리암 분쟁 | ✅ 교체 완료 |
| ASSESS_035 | 유방상피내암 DCIS 진단비 | 유방 DCIS 미세침윤 의심 — 일반암 진단비 부지급, 제자리암 주장 | ✅ 교체 완료 |
| ASSESS_039 | 뇌하수체 종양 수술비/진단비 분쟁 | 교모세포종 뇌종양 — 일반암 진단비, 진단확정 방법 분쟁 | ✅ 교체 완료 |
| ASSESS_044 | 병리 행동양식 /2와 진단서 코드 불일치 | 갑상선 여포선종 양성 판정 — 암 진단비 청구, 보험사 부지급 정당 | ✅ 교체 완료 |
| ASSESS_046 | 재발암과 새로운 원발암 구분 | 비호지킨 림프종 진단확정 시점 — 책임개시일 전후 분쟁 | ✅ 교체 완료 |
| ASSESS_048 | 미세침흡인검사 갑상선암 진단확정 | 갑상선 미세유두암 0.7cm — 소액암 분류 분쟁, FNA 진단확정 | ✅ 교체 완료 |

교체 후 총 케이스 수: 101건 (변동 없음)

---

## 2. Eval 결과 종합 (작업 2)

### 2-1. 요약표

| ID | eval 결과 | official 건수 | cardiac 혼입 | 주요 실패 항목 |
|----|-----------|--------------|-------------|--------------|
| ASSESS_032 (위 점막내암 C16) | FAIL | 7건 | ⚠️ 7종 | missing: 위암 / troponin, NSTEMI, EKG, 심근경색 |
| ASSESS_035 (유방 DCIS) | FAIL | 6건 | ⚠️ 7종 | NSTEMI, EKG 혼입 |
| ASSESS_039 (교모세포종) | FAIL | 5건 | ⚠️ 7종 | troponin, NSTEMI, EKG, 심근경색 혼입 |
| ASSESS_044 (갑상선 여포선종 양성) | FAIL* | —** | ⚠️ 2종 | NSTEMI, EKG + "보험금 전액을 지급해야" |
| ASSESS_046 (DLBCL 림프종) | FAIL | —** | ⚠️ 4종 | troponin, NSTEMI, EKG, 심근경색 (1회 성공 기준) |
| ASSESS_048 (갑상선 소액암 분류) | FAIL* | —** | 미확인 | transport_error 반복 — 결과 미수집 |

\* 간헐적 transport_error (Supabase Edge Function 타임아웃)  
\** 성공 회차에서 측정된 값; 반복 타임아웃으로 안정적 수집 불가

**전체 PASS: 0/6**

---

## 3. 핵심 검증 포인트 (작업 3)

### 3-1. 심장 판례 혼입 버그 — 미해소 (배포 대기)

**확인된 사실:** `2013다208661` (심근경색 NSTEMI 판례)이 모든 암 케이스에서 official로 인용됨.

| 케이스 | 2013다208661 유사도 | 혼입 cardiac 용어 |
|--------|-------------------|----------------|
| ASSESS_032 (C16) | 0.619 | troponin, NSTEMI, EKG, 심근경색, CAG, PCI |
| ASSESS_035 (C50) | 0.600 | troponin, NSTEMI, EKG, 심근경색, CAG, PCI |
| ASSESS_039 (C71) | 0.622 | troponin, NSTEMI, EKG, 심근경색, CAG, PCI |
| ASSESS_044 (D34) | ~0.6 추정 | NSTEMI, EKG (1회 성공 기준) |
| ASSESS_046 (C83) | ~0.6 추정 | troponin, NSTEMI, EKG, 심근경색 (1회 성공 기준) |

**결론:** 커밋된 bugfix(`directlyRelevantOfficial` + `sanitizeRagResultForAssessment` 수정)가 배포되면 해소 예상. 배포 후 이 케이스들 재실행 필요.

### 3-2. RAG 자료 다양성 분석

| 케이스 | 약관 | FSS 분쟁조정례 | 판례 | 의료가이드라인 |
|--------|------|--------------|------|-------------|
| ASSESS_032 | 2016·2021년도 ✅ | 2건 ✅ | 2013다208661 ⚠️ | 2건 ✅ |
| ASSESS_035 | 2012·2021년도 ✅ | 1건 ✅ | 2013다208661 ⚠️ | 2건 ✅ |
| ASSESS_039 | 2012·2021년도 ✅ | 0건 ❌ | 2013다208661 ⚠️ | 2건 ✅ |

**공통 문제:** 판례 슬롯이 항상 `2013다208661`로 채워짐 → 버그 수정 후 암 관련 판례로 교체될 것

**긍정적 신호:**
- `암 진단확정 기준 - 병리조직학적 확진, 상피내암(D코드) vs 침윤성암(C코드) 구분` 가이드라인 → 모든 케이스에서 인용 ✅
- ASSESS_032에서 FSS 분쟁조정례 "14년 전 진단받은 암과 동일한 암으로 진단확정된 경우" → 관련성 ✅
- ASSESS_035에서 "유방암 치료를 위한 난소절제술에 대한 암수술비 지급 여부" → 유방암 관련 ✅
- 계약일 입력으로 약관 시기 매칭 정상 작동 (2012·2016·2021년 각각 정확 매칭) ✅

### 3-3. ASSESS_044 — 보험사 승 케이스 특별 확인

**기대 동작 (방향 B):** 양성 판정 현실 인정 + 병리 재판독/외부 자문 여지 제시

**실제 결과 (1회 성공 기준):**
- ❌ `보험금 전액을 지급해야` → LLM이 여전히 "고객 전액 지급" 방향으로 작성
- ⚠️ NSTEMI, EKG 혼입 (cardiac 버그 동시 발현)
- 7단 구조(Ⅰ~Ⅶ): 충족

**원인 분석:**
- 현재 시스템 프롬프트는 항상 "고객 측 입장을 강력하게 주장"하도록 구성됨
- `adjusterMemo`에 "부지급이 정당"이라고 써도, LLM은 사정서 7단 구조에 따라 강한 주장을 생성
- `mustNotInclude: ["보험금 전액을 지급해야"]`로 잡히는 것은 최악의 경우이고, 실제로는 "지급 의무 있음"류 주장이 나올 것으로 예상됨

**결론:** ASSESS_044 케이스는 현재 시스템의 근본 한계(항상 피보험자 유리 주장)를 드러내는 설계상 어려운 케이스. "정직한 한계 인정" 모드는 별도 프롬프트 분기나 case-type 플래그가 없으면 달성 불가.

### 3-4. 승소 케이스 5개 — 구체 논거 작성 여부 (구버전 기준)

ASSERT_032 사정서 본문 발췌 (cardiac 혼입 제외 부분):
```
Ⅱ. 보험회사의 부지급 결정에 대한 반박:
「보험사는 병리 소견상 점막층에 국한된 intramucosal carcinoma로서...실질적으로 상피내암(carcinoma in situ)에 준하는 매우 조기 단계이므로 약관 질병분류표상 제자리암/소액암에 해당한다」는 주장은...
[C16.3 = 위의 악성신생물 = 일반암 논거 작성됨]
```

ASSESS_035 사정서 Ⅱ섹션:
```
「병리 보고서 주진단이 ductal carcinoma in situ(DCIS)이고 KCD상 D05.1(상피내암)...」
→ microinvasion 의심 소견 + high grade + comedo necrosis 임상 의미 논거 포함됨
```

**긍정 평가:** 7단 구조 충족, 보험사 부지급 사유 원문 「」 인용, 의학·약관·판례 다중 방어선 작성됨 (cardiac 혼입 제외 시 본문 품질 양호)

---

## 4. 구버전 vs 신버전 케이스 정의 비교

| 측정 항목 | 구버전 (빈약 정의) | 신버전 (상세 정의) |
|---------|-----------------|-----------------|
| official refs 평균 | 예상 2-3건 | **5-7건** |
| 약관 원문 인용 | 없음 | 계약일 기반 자동 매칭 ✅ |
| FSS 분쟁조정례 | 없음 또는 무관 | 관련 FSS 자동 매칭 ✅ |
| 부지급 사유 원문 직접 인용 | 추상적 | 실제 주장 원문 「」 인용 ✅ |
| mustInclude 항목 수 | 8-9개 (일반적) | **12-13개** (구체적 의학코드 포함) |
| mustNotInclude 항목 수 | 10-15개 (내부 ID 위주) | **9-12개** (cardiac 용어 + 단정적 표현) |

**결론:** 케이스 품질 개선으로 official 건수 2-3배 향상, FSS·약관 자동 매칭 작동. 그러나 cardiac 버그로 인해 판례 슬롯이 오염되어 있음.

---

## 5. 타임아웃 이슈 분석

**반복 타임아웃 케이스:** ASSESS_044, 046, 048

**추정 원인:**
1. `selfVerifySubmissionReport()` I21.4 하드코딩 버그 → 모든 비심장 케이스에서 repair 유발
2. 메인 draft 생성(~30-40초) + repair 생성(~30-40초) = 총 60-80초
3. Supabase Edge Function 제한 ~150초이나 복잡한 케이스에서 간헐적 초과
4. ASSESS_046 (림프종): 가장 복잡한 입력 (책임개시일·발병시점·골수검사 등)
5. ASSESS_048 (C73·2014년 약관): 고지의무+소액암 분류 복합 쟁점으로 처리 시간 증가

**권고:** `selfVerifySubmissionReport()` I21.4 하드코딩 버그 수정 → repair 루프 제거 → 타임아웃 감소

---

## 6. 배포 후 재검증 계획

배포 명령:
```powershell
supabase functions deploy create-assessment-draft --project-ref xnbmostitbwntazexpos
```

배포 후 실행:
```powershell
# 6개 케이스 검증
npm.cmd run ai:assessment:eval -- --case ASSESS_032
npm.cmd run ai:assessment:eval -- --case ASSESS_035
npm.cmd run ai:assessment:eval -- --case ASSESS_039
npm.cmd run ai:assessment:eval -- --case ASSESS_044
npm.cmd run ai:assessment:eval -- --case ASSESS_046
npm.cmd run ai:assessment:eval -- --case ASSESS_048
```

**배포 후 기대 결과:**
- cardiac 혼입 해소 → NSTEMI/EKG/troponin/심근경색 사정서에서 제거
- `2013다208661` 암 케이스 official refs에서 제거
- ASSESS_032: "위암" 키워드 missing 이슈는 별도 확인 필요 (LLM이 C16 관련 표현을 "위암"으로 안 쓸 가능성)
- ASSESS_044: "보험금 전액을 지급해야" 이슈는 cardiac 수정과 무관 — 별도 프롬프트 개선 필요
- ASSESS_046/048 타임아웃: selfVerify I21.4 버그 수정 없이는 지속될 수 있음

---

## 7. 후속 권고

### 즉시 필요
1. **cardiac 버그 배포 (긴급):** `create-assessment-draft` + `ragSearch.ts` Edge Function 재배포
2. **selfVerify I21.4 하드코딩 수정 (높음):** 비심장 케이스 repair 루프 → 타임아웃 원인

### 배포 후 후속 작업
3. **ASSESS_032 "위암" missing 재확인:** 배포 후 재실행해서 여전히 missing이면 mustInclude를 "위(胃)" 등으로 완화 검토
4. **ASSESS_044 보험사 승 케이스 처리:** "정직한 한계 인정" 모드는 현재 시스템 구조로 자동 달성 불가. 옵션: (a) mustNotInclude에서 해당 표현 제거하고 실질 본문 평가로 전환, (b) case_type 플래그 추가
5. **암 케이스 FSS 자료 확충:** ASSESS_039(뇌종양) FSS 분쟁조정례 0건 → 뇌종양 관련 FSS 자료 추가 필요
6. **ASSESS_046/048 안정화:** 입력 간소화 또는 selfVerify 수정으로 타임아웃 해소
