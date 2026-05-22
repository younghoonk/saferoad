# Phase 2-D: CLI 배포 표준 절차

작성: 2026-05-22  
환경: Windows 10 / PowerShell / .tools\supabase-cli\supabase.exe v2.98.2

---

## 1. CLI 상태 요약

| 항목 | 값 |
|------|-----|
| CLI 경로 | `.tools\supabase-cli\supabase.exe` |
| 버전 | v2.98.2 (최신 v2.101.0 — 업데이트 권고) |
| 로그인 상태 | ✅ 인증됨 |
| 연결된 프로젝트 | `xnbmostitbwntazexpos` (saferoad, Tokyo) |
| Docker 필요 여부 | ❌ 원격 배포는 Docker 불필요 (경고 무시) |

---

## 2. 표준 배포 절차 (체크리스트)

### Step 1: 타입 체크 (배포 전)
```powershell
npx.cmd tsc --noEmit
```
- 오류 0건 확인 후 진행

### Step 2: Edge Function 배포
```powershell
.tools\supabase-cli\supabase.exe functions deploy create-assessment-draft --project-ref xnbmostitbwntazexpos
```

**정상 출력 예시:**
```
WARNING: Docker is not running      ← 무시해도 됨 (원격 배포에 Docker 불필요)
Uploading asset (create-assessment-draft): supabase/functions/create-assessment-draft/index.ts
Uploading asset (create-assessment-draft): supabase/functions/_shared/caseAccess.ts
Uploading asset (create-assessment-draft): supabase/functions/_shared/assessmentProfiles.ts
Uploading asset (create-assessment-draft): supabase/functions/_shared/filterAssessmentReferences.ts
Uploading asset (create-assessment-draft): supabase/functions/_shared/ragSearch.ts
Uploading asset (create-assessment-draft): supabase/functions/_shared/detectAssessmentProfile.ts
Uploading asset (create-assessment-draft): supabase/functions/_shared/medicalGuidelineEvidence.ts
Deployed Functions on project xnbmostitbwntazexpos: create-assessment-draft
```

**실패 징후:**
- `Error:` 또는 `FAILED` 포함 메시지
- `$LASTEXITCODE -ne 0`

### Step 3: 배포 버전 확인
```powershell
.tools\supabase-cli\supabase.exe functions list --project-ref xnbmostitbwntazexpos 2>&1 | Select-String "create-assessment"
```

출력 예시:
```
| create-assessment-draft | ACTIVE | 140 | 2026-05-22 09:34:57 |
```
- `STATUS: ACTIVE` 확인
- `VERSION` 숫자 증가 확인 (이전 배포 버전 + 1)
- `UPDATED_AT (UTC)` 현재 시각 확인

### Step 4: Cold Start 대기
```powershell
Start-Sleep -Seconds 10
```
- 새 컨테이너 초기화 시간 (10초 권장)

### Step 5: 회귀 테스트
```powershell
# 빠른 smoke test (1건)
npm.cmd run ai:assessment:eval -- --case ASSESS_101

# 5건 확인
npm.cmd run ai:assessment:eval -- --limit 5
```

---

## 3. 한 번에 실행 (권장)

`deploy_and_eval.ps1`은 PATH에서 `supabase`를 찾으므로 직접 CLI를 사용하는 래퍼가 필요합니다.

**현재 workaround — 직접 순서대로 실행:**
```powershell
# 배포
.tools\supabase-cli\supabase.exe functions deploy create-assessment-draft --project-ref xnbmostitbwntazexpos

# 대기
Start-Sleep -Seconds 10

# eval
npm.cmd run ai:assessment:eval -- --limit 1
```

**deploy_and_eval.ps1 수정 필요 사항:**
- 현재: `supabase functions deploy ...` (PATH 기반)
- 수정 후: `.tools\supabase-cli\supabase.exe functions deploy ...` (절대 경로)

---

## 4. 실제 배포 후 새 코드 반영 확인법

배포 직후 코드 변경이 실제 적용됐는지 Edge Function 로그로 확인:

```powershell
# Supabase Dashboard → Functions → create-assessment-draft → Logs
# 또는 CLI로 최신 로그 조회
.tools\supabase-cli\supabase.exe functions logs create-assessment-draft --project-ref xnbmostitbwntazexpos 2>&1 | Select-Object -First 30
```

확인 포인트:
- eval 실행 후 새 requestId가 로그에 나타나는지
- 코드 변경한 부분의 console.log 출력 확인

---

## 5. 자주 발생하는 문제

| 증상 | 원인 | 해결 |
|------|------|------|
| `WARNING: Docker is not running` | Docker Desktop 미실행 | 무시해도 됨 (원격 배포 정상) |
| `supabase: command not found` | PATH에 CLI 없음 | `.tools\supabase-cli\supabase.exe` 직접 사용 |
| 배포 후 eval 결과가 이전과 동일 | Cold start 안 기다림 | `Start-Sleep -Seconds 10` 후 재실행 |
| `TRANSPORT_ERROR` | Edge Function cold start 또는 네트워크 | eval retry 포함됨, 재실행 |
| `version` 숫자 증가 안 함 | 배포 실패 | 배포 출력 재확인 |

---

## 6. 다른 Edge Function 배포 (참고)

```powershell
# analyze-document
.tools\supabase-cli\supabase.exe functions deploy analyze-document --project-ref xnbmostitbwntazexpos

# create-closing-report
.tools\supabase-cli\supabase.exe functions deploy create-closing-report --project-ref xnbmostitbwntazexpos
```

---

## 7. 현재 배포 상태 (2026-05-22)

| 함수 | 버전 | 최종 업데이트 |
|------|------|-------------|
| create-assessment-draft | 140 | 2026-05-22 09:34:57 UTC |
| analyze-document | 40 | 2026-05-19 09:57:00 UTC |
| create-closing-report | 44 | 2026-05-19 09:56:28 UTC |

---

## 8. Dashboard 배포 vs CLI 배포 비교

| 기준 | Dashboard | CLI (권장) |
|------|-----------|------------|
| 배포 성공 확인 | 눈으로 확인 어려움 | 버전 숫자 + 타임스탬프 즉시 확인 |
| 실패 감지 | 불명확 | exitCode + 오류 메시지 명시 |
| 스크립트 연동 | 불가 | `deploy_and_eval.ps1`과 통합 가능 |
| _shared 파일 포함 | 수동 확인 필요 | 자동 포함 확인 |
| 재현성 | 불안정 | 안정적 |

**결론: 모든 배포는 CLI를 기본으로 사용한다.**
