param(
    [Parameter(Mandatory=$true)]
    [string]$Passage
)

# Fetch a scripture passage from Bible Gateway (NIV 2011) and output
# clean text with paragraph breaks — no cross-references, footnotes, or HTML.
# Usage: powershell -File skills/fetch-scripture.ps1 "Genesis 1:1-5"

$encoded = [uri]::EscapeUriString($Passage)
$url = "https://www.biblegateway.com/passage/?search=$encoded&version=NIV"

try {
    $html = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
} catch {
    Write-Error "Failed to fetch $url : $_"
    exit 1
}

$content = $html.Content

# Find std-text div (contains actual scripture paragraphs, no nav/copyright)
$pattern = '<div[^>]*class="[^"]*std-text[^"]*"[^>]*>(.*?)</div>\s*</div>\s*</div>\s*</div>'
$match = [regex]::Match($content, $pattern, 'Singleline')
if (!$match.Success) {
    Write-Error "Could not find scripture text in response"
    exit 1
}

$html = $match.Groups[1].Value

# Extract each <p> tag
$paragraphs = [regex]::Matches($html, '<p[^>]*>(.*?)</p>', 'Singleline')

$output = @()
foreach ($p in $paragraphs) {
    $text = $p.Groups[1].Value
    $text = $text -replace '<br\s*/?>', ' '
    $text = $text -replace '<[^>]+>', ''
    $text = $text -replace '&nbsp;', ''
    $text = $text -replace '&rsquo;', "'"
    $text = $text -replace '&lsquo;', "'"
    $text = $text -replace '&rdquo;', '"'
    $text = $text -replace '&ldquo;', '"'
    $text = $text -replace '\[[a-z]\]', ''      # footnote markers [a], [b]...
    $text = $text -replace '\([A-Z]+\)', ''      # cross-reference markers (A), (AB)...
    $text = $text -replace '\s+', ' '            # collapse whitespace
    $text = $text.Trim()
    if ($text -ne '') {
        $output += $text
    }
}

Write-Output ($output -join "`n`n")
