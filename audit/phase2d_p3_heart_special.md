# Phase 2-D P3: buildHeartInsurerErrorMap 함수 신설

작성일: 2026-05-26

---

## 작업 범위

심장 분기의 하드코딩 insurerErrorMap → `buildHeartInsurerErrorMap()` 함수화.  
특수쟁점 3종(책임개시일/허혈성원인/협심증진행) 블록 추가.  
ASSESS_101(NSTEMI gold) 절대 회귀 방지.

---

## Before

`buildClaimArgumentStructure` isHeart 분기에 6개 NSTEMI 반박이 인라인 하드코딩:
```
1. 급성심근경색 진단기준을 시술 전 효소 상승 여부로 축소
2. Unstable angina 또는 CAD 기재만 선택
3. 주치의의 객관적 검토 과정 누락
4. 약관상 진단확정 요건 미충족 주장
5. 판례/결정례 진단서 기재 부족 취지 주장
6. 시술 전 효소 상승 추가 요건화
```

066(책임개시일)/067(허혈성원인)/065(협심증진행)은 이 NSTEMI 보일러플레이트로만 반박됨.

---

## After: 변경 사항

### 신설 함수 1: `extractHeartDiagnosisContext`

```typescript
function extractHeartDiagnosisContext(input) {
  const contractDateDispute = /책임개시일|석회화|이미\s*존재|검진\s*당시|위험인자/i.test(insurerText);
  const ischemicCauseDispute = /허혈성\s*원인|고혈압\s*원인|다혈관\s*협착|허혈성\s*심부전|비허혈성/i.test(insurerText);
  const anginaProgression = /불안정협심증|협심증.*진행|협심증.*심근경색/i.test(insurerText);
  // 인용용: troponinRef, stenosisRef, wallMotionRef, riskFactorRef
}
```

### 신설 함수 2: `buildHeartInsurerErrorMap`

| 트리거 | 1번 블록 (Ⅱ섹션 상단) | 이후 base 5블록 |
|--------|----------------------|---------------|
| 없음 (NSTEMI 기본) | (없음) | 기존 6개 전부 ← **101 경로** |
| `contractDateDispute` | "급성심근경색 발생일 기준, 위험인자≠진단, 입증책임 보험사" | base 1~5 |
| `ischemicCauseDispute` | "다혈관협착+WMA=허혈성기준 충족, 고혈압=동반질환, 원인 재분류 불가" | base 1~5 |
| `anginaProgression` | "트로포닌 급상승=심근괴사, 불안정협심증≠심근경색 동일 진단단위" | base 1~5 |

### `buildClaimArgumentStructure` isHeart 분기 전환

- `insurerErrorMap: [...]` 인라인 하드코딩 → `buildHeartInsurerErrorMap(heartCtx, input)` 호출
- `coreDenialReason`: 특수플래그 감지 시 구체 문장, 미감지 시 기존 문장 유지

---

## 특수쟁점 케이스 Ⅱ섹션 before → after

| 케이스 | 1번 항목 before | 1번 항목 after |
|--------|----------------|--------------|
| 066 책임개시일 | "급성심근경색 진단기준 시술 전 효소 축소" (NSTEMI 보일러) | "가입 전 고지혈증 소견→책임개시일 면책 주장" + "발생일 기준·입증책임 보험사" |
| 067 허혈성원인 | 동일 보일러 | "비허혈성 원인 주장" + "LAD 80% 다혈관협착+WMA=허혈성기준 충족" |
| 065 협심증진행 | 동일 보일러 | "협심증→트로포닌 상승=심근경색 아님 주장" + "트로포닌 T 0.05→1.8 급상승=심근괴사 입증" |

---

## 검증 결과

### ★★ ASSESS_101 gold — before/after 100% 동일 ★★

- `coreDenialReason`: "시술 전 심근효소 상승 부재, Unstable angina/CAD 기재, PCI 후 troponin 상승 가능성..." ✅ 그대로
- Ⅱ섹션 6개 반박: 기존 하드코딩과 글자 수준 동일 ✅
- `Fourth Universal Definition`: present ✅
- troponin: present ✅
- 2013다208661: present ✅
- NSTEMI: present ✅
- repair: NO ✅

### 특수쟁점 케이스 (전원 PASS)

| 케이스 | 특수블록 발동 | 구체 소견 인용 |
|--------|------------|--------------|
| 065 협심증진행 | `anginaProgression` ✅ | "트로포닌 T 0.05 → 1.8 급상승" ✅ |
| 066 책임개시일 | `contractDateDispute` ✅ | 고지혈증 소견 인용 ✅ |
| 067 허혈성원인 | `ischemicCauseDispute` ✅ | "LAD 80% 다혈관 협착" + "벽운동 이상(WMA)" ✅ |

### 회귀 케이스 (전원 PASS)

심장 세트: 063/069/070/071/072/073/074 — 전원 PASS  
크로스 도메인: 035(암)/051(뇌) — 전원 PASS
