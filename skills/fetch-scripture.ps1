param(
    [Parameter(Mandatory=$true)]
    [string]$Passage
)

# Fetch a scripture passage from Bible Gateway (NIV 2011) and output
# paragraph-separated text with verse numbers inline.
# Usage: powershell -File skills/fetch-scripture.ps1 "Genesis 1:1-5"

$encoded = [uri]::EscapeUriString($Passage)
$url = "https://www.biblegateway.com/passage/?search=$encoded&version=NIV"

try {
    $html = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
} catch {
    Write-Error "Failed to fetch $url : $_"
    exit 1
}

# Extract passage-text div
$passageText = $html.Content
$start = $passageText.IndexOf('<div class="passage-text">')
$end = $passageText.IndexOf('<div class="passage-attributes">')
if ($start -eq -1 -or $end -eq -1) {
    Write-Error "Could not find passage text in response"
    exit 1
}
$passageText = $passageText.Substring($start, $end - $start)

# Extract text from each <p> tag, preserving paragraph breaks
$paragraphs = [regex]::Matches($passageText, '<p[^>]*>(.*?)</p>', 'Singleline')

$output = @()
foreach ($p in $paragraphs) {
    $text = $p.Groups[1].Value
    # Replace <br> with newline
    $text = $text -replace '<br\s*/?>', "`n"
    # Strip all remaining HTML tags
    $text = $text -replace '<[^>]+>', ''
    # Trim whitespace
    $text = $text.Trim()
    if ($text -ne '') {
        $output += $text
    }
}

Write-Output ($output -join "`n`n")
