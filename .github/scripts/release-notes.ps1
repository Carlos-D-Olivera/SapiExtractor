<#
.SYNOPSIS
  Builds the release notes of a version from the commit messages made since the
  previous version tag.

.DESCRIPTION
  The app shows these notes in its "Actualizaciones" dialog. Commits that follow
  the "type: message" convention are grouped:
    feat:  -> Novedades
    fix:   -> Correcciones
    other messages without a recognised maintenance prefix -> Otros cambios
  Maintenance commits (chore, ci, docs, test, build, style, refactor, perf),
  merge commits and the bot's "V.X.Y.Z - ..." merge messages are left out.

.EXAMPLE
  ./.github/scripts/release-notes.ps1 -Tag V.2.7.1 -Repo Carlos-D-Olivera/SapiExtractor -Out notes.md
#>
param(
  [Parameter(Mandatory = $true)][string]$Tag,
  [string]$Repo = '',
  [string]$Out = 'release-notes.md'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function ConvertTo-Ver([string]$t) {
  if ($t -match '^[vV]\.?(\d+)\.(\d+)\.(\d+)$') { return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" }
  return $null
}

function Format-Line([string]$t) {
  $t = $t.Trim()
  if ($t.Length -eq 0) { return $t }
  return $t.Substring(0, 1).ToUpper() + $t.Substring(1)
}

# The previous release is the highest version tag below this one.
$current = ConvertTo-Ver $Tag
$prev = $null
if ($current) {
  $prev = git tag -l | ForEach-Object {
    $v = ConvertTo-Ver $_
    if ($v -and $v -lt $current) { [pscustomobject]@{ Tag = $_; Ver = $v } }
  } | Sort-Object Ver -Descending | Select-Object -First 1
}
$range = if ($prev) { "$($prev.Tag)..$Tag" } else { $Tag }
$subjects = @(git log $range --no-merges --pretty=format:%s)
$global:LASTEXITCODE = 0

$features = @(); $fixes = @(); $others = @()
foreach ($raw in $subjects) {
  $s = "$raw".Trim()
  if (-not $s) { continue }
  if ($s -match '^(Merge|Revert "Merge|V\.\d|Agent host session)') { continue }
  if ($s -match '^feat(\([^)]*\))?!?:\s*(.+)$') { $features += Format-Line $Matches[2]; continue }
  if ($s -match '^fix(\([^)]*\))?!?:\s*(.+)$') { $fixes += Format-Line $Matches[2]; continue }
  if ($s -match '^(chore|ci|docs|test|tests|build|style|refactor|perf)(\([^)]*\))?!?:') { continue }
  $others += Format-Line $s
}

$sections = New-Object System.Collections.Generic.List[string]
foreach ($group in @(@('Novedades', $features), @('Correcciones', $fixes), @('Otros cambios', $others))) {
  $items = @($group[1])
  if ($items.Count -gt 0) {
    $sections.Add("## $($group[0])`n`n" + (($items | ForEach-Object { "- $_" }) -join "`n"))
  }
}
if ($sections.Count -eq 0) { $sections.Add('Mejoras internas y de estabilidad.') }

$text = ($sections -join "`n`n")
if ($prev -and $Repo) {
  $text += "`n`n**Cambios completos:** https://github.com/$Repo/compare/$($prev.Tag)...$Tag"
}

[System.IO.File]::WriteAllText($Out, $text + "`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Release notes for $Tag (since $(if ($prev) { $prev.Tag } else { 'the beginning' })) written to $Out"
exit 0
