# deploy_and_eval.ps1
# create-assessment-draft Edge Function 재배포 후 eval 실행
# 사용법: .\scripts\deploy_and_eval.ps1 [--limit N] [--case ASSESS_XXX]

param(
    [int]$limit = 1,
    [string]$case = ""
)

$PROJECT_REF = "xnbmostitbwntazexpos"

Write-Host "=== [1/3] Edge Function 배포 ===" -ForegroundColor Cyan
supabase functions deploy create-assessment-draft --project-ref $PROJECT_REF
if ($LASTEXITCODE -ne 0) {
    Write-Host "배포 실패. 중단." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== [2/3] 10초 대기 (cold start) ===" -ForegroundColor Cyan
Start-Sleep -Seconds 10

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
