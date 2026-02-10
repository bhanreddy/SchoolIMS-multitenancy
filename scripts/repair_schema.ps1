
$path = "c:\Users\reddy\Desktop\Native SupabaseBackend\SupabaseBackend\schema.sql"

# Read file
$lines = Get-Content $path -Encoding UTF8
Write-Host "Total lines read: $($lines.Count)"

# Find Start Marker
$startIndex = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^-- 13. NOTIFICATIONS") {
        $startIndex = $i
        break
    }
}

# Find End Marker
$endIndex = -1
# Search backwards from end to be safe? Or forwards from start?
# Forwards from start makes sense.
for ($i = $startIndex + 1; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^-- 18. ANALYTICS") {
        $endIndex = $i
        break
    }
}

if ($startIndex -eq -1 -or $endIndex -eq -1) {
    Write-Error "Could not find markers. Start: $startIndex, End: $endIndex"
    exit 1
}

Write-Host "Found block to remove: Line $($startIndex+1) to $($endIndex) (Indices $startIndex to $($endIndex-1))"

# Keep lines before start index
# Keep lines from end index onwards
$newLines = $lines[0..($startIndex - 1)] + $lines[$endIndex..($lines.Count - 1)]

Write-Host "New line count: $($newLines.Count)"

# Write back
$newLines | Set-Content $path -Encoding UTF8
Write-Host "Fixed schema.sql"
