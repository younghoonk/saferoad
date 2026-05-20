# SafeRoad Edge Function 배포 방식 조사 보고서

작성일: 2026-05-21  
점검 환경: Windows 10 Home 10.0.19045 (Git Bash / PowerShell / CMD 모두 점검)

---

## 현재 배포 방식

### 조사 결과 요약

| 항목 | 결과 |
|------|------|
| GitHub Actions 워크플로우 | **없음** (`.github/workflows/` 디렉토리 자체 없음) |
| `package.json` 배포 스크립트 | **없음** (deploy 관련 npm script 없음) |
| Supabase CLI 바이너리 (PATH) | **없음** — 시스템·사용자 PATH 전수 검색 |
| Supabase CLI via npm 래퍼 | **설치 불완전** — `node_modules/supabase`에 패키지 body 없음, `npx supabase` 실행 시 `No matching Supabase CLI binary package found for win32-x64` 오류 |
| WSL 환경 | **없음** |
| `.bat` / `.cmd` / `.sh` 배포 스크립트 | **없음** |
| `supabase/.temp/project-ref` | `xnbmostitbwntazexpos` (초기 커밋에서 함께 업로드됨) |
| `supabase/.temp/cli-latest` | `v2.100.1` (초기 커밋 `817819d 첫 업로드`에서 올라옴) |

### 해석

`supabase/.temp/cli-latest`의 `v2.100.1`은 **다른 머신**에서 Supabase CLI를 실행한 뒤 프로젝트 폴더 전체를 git에 올리면서 함께 커밋된 것으로 판단된다.  
현재 이 Windows 10 머신에는 **Supabase CLI가 설치되어 있지 않다.**

---

## 배포가 이루어진 경로 (추정)

가능성 높은 순서로 정렬:

1. **Supabase Dashboard 수동 배포** (웹 UI에서 코드 붙여넣기 또는 파일 업로드)  
2. **다른 머신(Mac/Linux 또는 다른 Windows)에서 `supabase functions deploy` 실행**  
3. **Supabase GitHub 연동** (Supabase 프로젝트 설정 > GitHub 연동으로 push 시 자동 배포)  
   → 이 경우 이 저장소의 특정 브랜치에 push하면 Supabase가 직접 배포를 트리거함

---

## 현재 머신에서 배포하려면

### 방법 A: Supabase CLI 설치 (권장)

**Scoop 경유 (Windows 네이티브 바이너리):**
```cmd
# 1. Scoop 설치 (미설치 시)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression

# 2. Supabase CLI 설치
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# 3. 확인
supabase --version
```

**GitHub Releases 직접 다운로드:**
- https://github.com/supabase/cli/releases 에서 `supabase_windows_amd64.tar.gz` 다운로드
- 압축 해제 후 `supabase.exe`를 PATH에 추가 (예: `C:\tools\`)

### 방법 B: 현재 상태 그대로 — npm 패키지 재설치

```cmd
npm uninstall -g supabase
npm install -g supabase
```
→ 재설치 후에도 `win32-x64` 바이너리 패키지가 없으면 동일 오류 발생 가능. 방법 A를 권장.

---

## `scripts/deploy_and_eval.ps1` 수정 방향

### 현재 문제
스크립트가 `supabase` 명령어를 직접 호출하지만, 이 머신에 Supabase CLI가 없어 실행 불가.

### 수정: CLI 설치 여부 사전 체크 추가

```powershell
# deploy_and_eval.ps1 도입부에 추가
$sbCmd = Get-Command supabase -ErrorAction SilentlyContinue
if (-not $sbCmd) {
    Write-Host "[오류] Supabase CLI를 찾을 수 없습니다." -ForegroundColor Red
    Write-Host "설치 방법: scoop install supabase  또는 GitHub Releases에서 바이너리 다운로드" -ForegroundColor Yellow
    Write-Host "https://github.com/supabase/cli/releases" -ForegroundColor Yellow
    exit 1
}
```

### 대안: eval만 실행 (배포 없이)

배포를 Dashboard에서 수동으로 한 뒤 eval만 실행하는 플래그 추가:
```powershell
.\scripts\deploy_and_eval.ps1 -skipDeploy   # 배포 건너뛰고 eval만 실행
```

---

## 권장 워크플로우

### 시나리오 A: Supabase CLI 설치 완료 후

```powershell
# create-assessment-draft 수정 → 배포 → eval 한 번에
.\scripts\deploy_and_eval.ps1 -limit 1

# 특정 케이스만
.\scripts\deploy_and_eval.ps1 -case ASSESS_001

# 전체 100건
.\scripts\deploy_and_eval.ps1 -limit 100
```

### 시나리오 B: CLI 없이 (현재 상태)

1. Supabase Dashboard (https://supabase.com/dashboard) 에서 수동 배포  
   → `Edge Functions` → `create-assessment-draft` → 코드 붙여넣기 또는 GitHub 연동 push  
2. 배포 완료 후 eval만:
   ```powershell
   node scripts/evalAssessmentDrafts.js --limit 1
   # 또는
   npm.cmd run ai:assessment:eval -- --limit 1
   ```

### 시나리오 C: GitHub 연동 방식 (Supabase 측 자동 배포)

만약 Supabase 프로젝트에 GitHub 저장소가 연동되어 있다면:
1. `create-assessment-draft` 수정
2. `git push origin rag-datasets-staging` (또는 연동된 브랜치)
3. Supabase가 자동으로 Edge Function 배포
4. 배포 완료 후: `npm.cmd run ai:assessment:eval -- --limit 1`

---

## 결론 및 즉시 조치 사항

| 우선순위 | 조치 | 방법 |
|----------|------|------|
| **즉시** | Supabase CLI 설치 여부 확인 (사용자 직접) | CMD에서 `supabase --version` 실행 |
| **즉시** | CLI 없으면 Scoop으로 설치 | `scoop install supabase` |
| **즉시** | `deploy_and_eval.ps1`에 CLI 체크 추가 | 아래 수정본 적용 |
| **단기** | GitHub 연동 여부 Supabase Dashboard에서 확인 | Project Settings > Integrations |
