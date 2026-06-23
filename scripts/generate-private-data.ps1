param(
    [Parameter(Mandatory=$true)]
    [string]$ContentDir
)

# Generate private-data.tex from assets/church/information.md
# Usage: powershell -File scripts/generate-private-data.ps1 "content/06 07 2026"

$InfoFile = "assets/church/information.md"
$OutputFile = Join-Path $ContentDir "private-data.tex"

if (!(Test-Path $InfoFile)) {
    Write-Error "Error: $InfoFile not found"
    exit 1
}

if (!(Test-Path $ContentDir)) {
    Write-Error "Error: $ContentDir not found"
    exit 1
}

$lines = Get-Content $InfoFile

# Extract pastor cell phone (3rd list item under ## Pastor)
$inPastor = $false
$pastorCount = 0
$pastorCell = ""

# Extract council rows (name, email, phone under ## Council Members)
$inCouncil = $false
$councilCount = 0
$councilName = ""
$councilEmail = ""
$councilRows = @()

foreach ($line in $lines) {
    if ($line -match "^## Pastor$") {
        $inPastor = $true
        $pastorCount = 0
        continue
    }
    if ($inPastor -and $line -match "^## ") {
        $inPastor = $false
    }
    if ($inPastor -and $line -match "^\s*-\s+(.*)") {
        $item = $matches[1].Trim()
        if ($pastorCount -eq 2) {
            $pastorCell = $item
        }
        $pastorCount++
    }

    if ($line -match "^## Council Members$") {
        $inCouncil = $true
        $councilCount = 0
        continue
    }
    if ($inCouncil -and $line -match "^## ") {
        $inCouncil = $false
    }
    if ($inCouncil -and $line -match "^\s*-\s+(.*)") {
        $item = $matches[1].Trim()
        if ($councilCount -eq 0) {
            $councilName = $item
        } elseif ($councilCount -eq 1) {
            $councilEmail = $item
        } elseif ($councilCount -eq 2) {
            $councilPhone = $item
            $councilRows += "$councilName & $councilEmail & $councilPhone \\"
        }
        $councilCount++
        if ($councilCount -gt 2) { $councilCount = 0 }
    }

    # reset after leaving council section
    if ($inCouncil -and $line -match "^## " -and $line -notmatch "^## Council Members$") {
        $inCouncil = $false
    }
}

$councilBody = $councilRows -join "`n"

@"
\renewcommand{\PastorCell}{$pastorCell}
\renewcommand{\CouncilRows}{
$councilBody}
"@ | Set-Content $OutputFile -NoNewline

Write-Host "Generated $OutputFile"
