# deploy_and_eval.ps1
# create-assessment-draft Edge Function 재배포 후 eval 실행
# 사용법:
#   .\scripts\deploy_and_eval.ps1                    # 배포 → eval --limit 1
#   .\scripts\deploy_and_eval.ps1 -limit 5           # 배포 → eval 5건
#   .\scripts\deploy_and_eval.ps1 -case ASSESS_001   # 배포 → 특정 케이스
#   .\scripts\deploy_and_eval.ps1 -skipDeploy        # 배포 건너뛰고 eval만

param(
    [int]$limit = 1,
    [string]$case = "",
    [switch]$skipDeploy = $false
)

$PROJECT_REF = "xnbmostitbwntazexpos"

# --- [0] Supabase CLI 확인 ---
if (-not $skipDeploy) {
    $sbCmd = Get-Command supabase -ErrorAction SilentlyContinue
    if (-not $sbCmd) {
        Write-Host "[오류] Supabase CLI를 찾을 수 없습니다." -ForegroundColor Red
        Write-Host ""
        Write-Host "설치 방법 (Scoop 사용):" -ForegroundColor Yellow
        Write-Host "  scoop bucket add supabase https://github.com/supabase/scoop-bucket.git"
        Write-Host "  scoop install supabase"
        Write-Host ""
        Write-Host "또는 GitHub Releases에서 직접 다운로드:"
        Write-Host "  https://github.com/supabase/cli/releases"
        Write-Host ""
        Write-Host "배포 없이 eval만 실행하려면:"
        Write-Host "  .\scripts\deploy_and_eval.ps1 -skipDeploy" -ForegroundColor Cyan
        exit 1
    }
}

# --- [1] Edge Function 배포 ---
if (-not $skipDeploy) {
    Write-Host "=== [1/3] Edge Function 배포 ===" -ForegroundColor Cyan
    supabase functions deploy create-assessment-draft --project-ref $PROJECT_REF
    if ($LASTEXITCODE -ne 0) {
        Write-Host "배포 실패. 중단." -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "=== [2/3] 10초 대기 (cold start) ===" -ForegroundColor Cyan
    Start-Sleep -Seconds 10
} else {
    Write-Host "=== 배포 건너뜀 (-skipDeploy) ===" -ForegroundColor Yellow
}

# --- [3] Eval 실행 ---
Write-Host ""
Write-Host "=== [3/3] Eval 실행 ===" -ForegroundColor Cyan

if ($case -ne "") {
    Write-Host "케이스: $case"
    node scripts/evalAssessmentDrafts.js --case $case
} else {
    Write-Host "limit: $limit"
    node scripts/evalAssessmentDrafts.js --limit $limit
}

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Eval 완료." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Eval 실패 (exit $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}
