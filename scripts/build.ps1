param(
    [Parameter(Mandatory=$true)]
    [string]$DateDir
)

# Build a bulletin: generate private data, compile, and copy PDF.
# Usage: powershell -File scripts/build.ps1 "06 07 2026"

$ContentDir = "content/$DateDir"
$PdfPath = "pdf/$DateDir.pdf"

# PII filter — removes lines matching email or phone patterns
filter {
    param([string]$line)
    $line -notmatch '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|CouncilRows|PastorCell'
}

Write-Host "--- Generating private data ---"
& .\scripts\generate-private-data.ps1 $ContentDir 2>&1 | ForEach-Object { filter $_ }

Write-Host "--- Compiling ---"
Push-Location $ContentDir
xelatex -interaction=nonstopmode bulletin.tex 2>&1 | ForEach-Object { filter $_ } | Select-Object -Last 20
xelatex -interaction=nonstopmode bulletin.tex 2>&1 | ForEach-Object { filter $_ } | Select-Object -Last 5
Pop-Location

$pdfFile = "$ContentDir/bulletin.pdf"
if (Test-Path $pdfFile) {
    Copy-Item $pdfFile $PdfPath
    Write-Host "--- SUCCESS: $PdfPath ---"
} else {
    Write-Error "--- FAILED: PDF not produced ---"
    exit 1
}
