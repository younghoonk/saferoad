# ASSESS_066 QUALITY_FAIL 수정 보고서

작성일: 2026-05-21  
커밋: (아래 참조)  
누적 비용: ~$1

---

## 1. 증상

ASSESS_066 (트로포닌 경미 상승 / 심장질환 진단비):  
`missing hard assertion: acute MI policy evidence relevance`

## 2. 근본 원인

### 원인 추적 경로

`policyEvidenceFromRag` → `isAcuteMiPolicyReference` → `appendServerDefaultPolicyEvidence.hasDirectPolicy`

`isAcuteMiPolicyReference` 함수의 정규식에 `진단확정` (bare) 키워드가 포함:
```
/...진단확정|심전도|관상동맥|심장효소|I21|I21\.4|.../
```

모든 보험 약관에는 "진단확정" 단어가 존재 → RAG가 반환한 범용 policy_terms_bundle 문서가 이 regex를 통과 → `hasDirectPolicy = true` → `appendServerDefaultPolicyEvidence` 조기 종료 (서버 기본 약관 미주입).

반환된 범용 문서의 텍스트엔 `심전도|관상동맥|심장효소|급성심근경색` 등 cardiac 키워드 없음 → eval check 실패.

### 왜 ASSESS_066에서만 나타났나

다른 심장 케이스(ASSESS_063~065 등)는 입력에 "I21.4", "CAG/PCI", "NSTEMI" 등 명확한 cardiac 용어가 있어 RAG가 cardiac 특화 policy 문서를 반환. 반면 ASSESS_066은 "트로포닌 경미 상승/흉통" — 한국어로 troponin (영문 regex 미매치) + 범용 흉통 → RAG가 덜 특화된 policy 문서 반환.

## 3. 수정 내용

**파일:** `supabase/functions/create-assessment-draft/index.ts`  
**함수:** `isAcuteMiPolicyReference` (line 1386)

```typescript
// Before
return /급성\s*심근경색|심근경색|허혈\s*심장질환|심장질환\s*진단확정|진단확정|심전도|심장초음파|관상동맥|심장효소|I21|I21\.4|I20|I25\.1/i.test(text);

// After
// 진단확정(bare) / I21(bare) removed — too generic, appears in every policy regardless of disease
return /급성\s*심근경색|심근경색|허혈\s*심장질환|심장질환\s*진단확정|심전도|심장초음파|관상동맥|심장효소|I21\.4|I21\.?4|I20\b|I25\.1/i.test(text);
```

제거된 토큰:
- `진단확정` (bare) → 모든 보험 약관에 존재하는 범용 단어
- `I21` (bare) → I21.4 없이 단독 사용 시 너무 광범위

유지된 토큰:
- `심장질환\s*진단확정` → 심장질환 맥락의 진단확정만 허용
- `심전도|관상동맥|심장효소` → cardiac procedure-specific
- `I21\.4|I21\.?4` → NSTEMI specific codes
- `I20\b|I25\.1` → 허혈심장질환 codes

## 4. 효과

| 케이스 | 이전 | 이후 |
|--------|------|------|
| ASSESS_066 | QUALITY_FAIL | **PASS** |
| ASSESS_063 | PASS | PASS (regression 없음) |
| ASSESS_070 | PASS | PASS (regression 없음) |

## 5. 사이드 이펙트 분석

- 기존 PASS 심장 케이스: 영향 없음 (cardiac 특화 docs는 다른 키워드로도 매치)
- 서버 기본 약관 주입 빈도 증가: `진단확정`만으로 통과하던 범용 docs가 차단되어 fallback 더 자주 활성화 → 오히려 더 명확한 cardiac policy 근거 제공
- ASSESS_066 유사 케이스 (한국어 troponin 입력, 약한 cardiac 키워드): 동일하게 수정 효과 적용
