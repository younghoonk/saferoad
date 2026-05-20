# ASSESS_101 기준선 보고서

작성일: 2026-05-21  
케이스: ASSESS_101 — I21.4 NSTEMI 급성심내막하심근경색 진단비 부지급  
연결 gold fixture: `GOLD_ACUTE_MI_SUBMISSION_REPORT_V2_REDACTED`

---

## 1. 케이스 개요

| 항목 | 내용 |
|------|------|
| ID | ASSESS_101 |
| 진단 | I21.4 급성 심내막하심근경색증 (NSTEMI) |
| 카테고리 | 심장질환 진단비 |
| expectedProfile | acute_mi_I214 |
| isAcuteMi (eval 감지) | **true** (I21.4, NSTEMI 포함 → regex 매칭) |
| 보험사 | [보험사] (비식별) |
| 계약일 | 2022-03-01 (비식별 가상일) |
| gold fixture 연결 | `linked_assess_id: "ASSESS_101"` 추가 완료 |

---

## 2. 임상 타임라인 (상대일자)

| 상대일 | 이벤트 |
|--------|--------|
| D-44 | 흉통 발생으로 내원 |
| D-30 | 운동부하검사(TMT) — ST depression 확인 |
| D-22 | 관상동맥 CT — Ca score 532.9, LM >90%, LAD 70%, LCx >70% |
| D-1 | 관상동맥조영술(CAG) + PCI(스텐트) — LM-LAD 협착 95% |
| CAG 전 혈액 | CK-MB 2.1, Troponin T 0.021 |
| 외래 SOAP | hs-troponin 0.037; 주치의 「cardiac marker 상승, EKG로 UA-NSTEMI 진단서 가능」 |

---

## 3. 보험사 부지급 사유 (원문)

> 흉통 발생 이후 관상동맥조영술 시행 전까지 시행한 혈액검사상 심근효소 상승이 확인되지 않아,  
> 심근경색까지 진행하지 않은 것으로 검토되는 바,  
> 급성 심내막하심근경색증(I21.4) 진단 불인 의견, 죽상경화성 심장병(I25.1) 진단 인정 의견

---

## 4. 평가 검증 9개 항목

| # | 항목 ID | 검증 내용 |
|---|---------|----------|
| 1 | denial_quote | 부지급 문구 「」 인용 |
| 2 | diagnostic_criteria | Fourth Universal Definition of MI 2018 명시 |
| 3 | mapping_table | 진단기준 vs 환자 데이터 매핑 |
| 4 | clause_quote | 약관 요건 + 환자 자료 매칭 |
| 5 | precedent_rebuttal | 2013다208661 역공 또는 유리한 판례 적용 |
| 6 | killing_evidence | SOAP 기록 UA-NSTEMI 소견 결정적 증거 강조 |
| 7 | multi_defense | 4개 방어선 (의학/약관/판례/약관해석) |
| 8 | no_weak_endings | 약한 어미 전면 금지 |
| 9 | request_completeness | 보험금/지연이자/서면회신 3종 |

---

## 5. mustInclude 키워드 (15개)

```
I21.4, NSTEMI, cardiac marker, EKG, ST depression, CAG, hs-troponin,
Troponin T, CK-MB, LM-LAD, Fourth Universal Definition of Myocardial Infarction,
2013다208661, 약관해석, 지연이자, 서면 회신
```

---

## 6. PII 비식별 처리 확인

| 항목 | 처리 |
|------|------|
| 피보험자명 | 미포함 (케이스에 없음) |
| 주민번호 | 미포함 |
| 주소/연락처 | 미포함 |
| 보험사명 | `[보험사]` 비식별 |
| 의료기관명 | 미포함 |
| 의사명 | 미포함 |
| 계약일 | 가상일 (2022-03-01) |
| 사고일 | 상대일자 (D-1 등) 사용 |

---

## 7. eval 실행 준비 상태

| 단계 | 상태 |
|------|------|
| ASSESS_101 케이스 등록 | ✅ `ai_eval/assessment_cases_100_v1.json` (101번째) |
| gold fixture 연결 | ✅ `linked_assess_id: "ASSESS_101"` 추가 |
| assertions 파일 | ✅ `ai_eval/assertions/ASSESS_101_assertions.json` |
| Edge Function 재배포 | ⚠️ **미완료** — 배포 후 eval 가능 |

---

## 8. 배포 후 검증 명령어

```powershell
# Edge Function 배포 후 (Supabase Dashboard 또는 CLI)

# ASSESS_101 단독 검증
node scripts/evalAssessmentDrafts.js --case ASSESS_101

# 또는 deploy_and_eval 스크립트 활용 (배포 포함)
.\scripts\deploy_and_eval.ps1 -case ASSESS_101

# 배포 없이 eval만 (이미 배포된 경우)
.\scripts\deploy_and_eval.ps1 -case ASSESS_101 -skipDeploy
```

---

## 9. 예상 eval 결과

- `isAcuteMi = true` → `checkArgumentStructureRubric` 자동 실행
- FORBIDDEN_PHRASE_FAIL: 3중 방어선 적용 후 해소 예상 (audit/05 참조)
- `mustInclude` 중 `2013다208661` 판례 — RAG에 해당 판례 데이터 없으면 AI 할루시네이션 가능성 있음 (DATA-001 이슈와 연관)
- `Fourth Universal Definition` — `medicalGuidelineEvidence.ts`의 acute MI 의학 가이드라인 보강이 이 케이스에 적용되어야 함
