<#
.SYNOPSIS
    Checks and updates the vendored JavaScript libraries (updates, known vulnerabilities, tampering).

.DESCRIPTION
    The web app itself never makes network requests (enforced by its Content-Security-Policy),
    so update checks and updates are done out-of-band by this developer tool.

    CHECK (default). For every entry in vendor/manifest.json the script:
      1. Verifies the local file against the SHA-384 checksum in the manifest (tamper / corruption check).
      2. Looks up the latest version on npm, and the newest version within the same major version.
      3. Queries the npm security advisory database (the same source `npm audit` uses) for the
         installed version.

    UPDATE (-Update). For each package with a newer version available:
      1. Picks the target: newest non-deprecated release in the same major version
         (or the latest release with -AllowMajor, or an exact -Version).
      2. Refuses targets that are themselves affected by a known advisory.
      3. Downloads the npm tarball and verifies it against the registry's SHA-512 integrity value.
      4. Copies the single file listed in the manifest ("npmFile") plus the license into vendor/.
      5. Updates index.html (<script src>), vendor/manifest.json and the generated table in
         vendor/README.md, then removes the old file.
      Any failure rolls back every file that was changed. -WhatIf shows the plan without changing anything.

    Only package names and versions are sent to the npm registry. No app data is involved.
    Works with Windows PowerShell 5.1 (Windows 10 1803+ for tar.exe) and PowerShell 7+.

.PARAMETER ManifestPath
    Path to the manifest. Defaults to ..\vendor\manifest.json relative to this script.

.PARAMETER Offline
    Only run the local checksum verification (no network). Cannot be combined with -Update.

.PARAMETER Update
    Update packages that have a newer version (same major version unless -AllowMajor).

.PARAMETER Package
    Limit -Update to one or more package names, e.g. -Package jspdf.

.PARAMETER Version
    Exact version to install. Requires exactly one -Package.

.PARAMETER AllowMajor
    Allow updates to a new major version. Major versions can contain breaking API changes:
    always test the app afterwards.

.PARAMETER NpmFile
    Path of the file inside the npm package to vendor (e.g. dist/qrcode.js), when a new version moved
    it. Requires exactly one -Package. Saved to the manifest when the update succeeds.

.PARAMETER SyncDocs
    Regenerate the dependency table in vendor/README.md from the manifest (no network).

.EXAMPLE
    .\tools\Check-Dependencies.ps1
    Check only.

.EXAMPLE
    .\tools\Check-Dependencies.ps1 -Update -WhatIf
    Show what would be updated.

.EXAMPLE
    .\tools\Check-Dependencies.ps1 -Update -Package jquery -AllowMajor
    Update jQuery to the latest release, even across a major version.

.EXAMPLE
    .\tools\Check-Dependencies.ps1 -Update -Package qrcode-generator -AllowMajor -NpmFile dist/qrcode.js
    Update a package whose file moved to another path in the new version.

.NOTES
    Exit codes (check mode):
      0  everything up to date, no advisories, checksums OK
      1  a newer version is available (no known security issue)
      2  security advisory affects an installed version, or a checksum mismatch / missing file
      3  the check could not be completed (network or manifest error)
    Exit codes (update mode):
      0  all requested updates applied (or nothing to update)
      2  at least one update was refused or failed (changes for that package were rolled back)
      3  the update could not start (network, manifest or tooling error)
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ManifestPath = (Join-Path $PSScriptRoot '..\vendor\manifest.json'),
    [switch]$Offline,
    [switch]$Update,
    [string[]]$Package,
    [string]$Version,
    [switch]$AllowMajor,
    [string]$NpmFile,
    [switch]$SyncDocs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$NpmRegistry = 'https://registry.npmjs.org'
$PackageNamePattern = '^(@[a-z0-9._-]+/)?[a-z0-9._-]+$'
$VersionPattern = '^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$'
$StableVersionPattern = '^\d+\.\d+\.\d+$'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$ReadmeBegin = '<!-- BEGIN GENERATED DEPENDENCY TABLE: edit vendor/manifest.json and run tools/Check-Dependencies.ps1 -SyncDocs -->'
$ReadmeEnd = '<!-- END GENERATED DEPENDENCY TABLE -->'

# Windows PowerShell 5.1 may default to TLS 1.0/1.1, which the npm registry rejects.
if ($PSVersionTable.PSVersion.Major -lt 6) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}

# ============================================================================================
# Helpers
# ============================================================================================

function Write-Status {
    param([string]$Text, [ValidateSet('ok', 'warn', 'bad', 'info', 'head')][string]$Level)
    $colors = @{ ok = 'Green'; warn = 'Yellow'; bad = 'Red'; info = 'Gray'; head = 'Cyan' }
    Write-Host $Text -ForegroundColor $colors[$Level]
}

function Write-Table {
    # Out-String with a fixed width: Format-Table prints nothing when the host has no console width (CI, redirection).
    param([Parameter(ValueFromPipeline = $true)]$InputObject, [string[]]$Property, [switch]$Wrap)
    begin { $items = New-Object System.Collections.Generic.List[object] }
    process { $items.Add($InputObject) }
    end {
        if ($Wrap) { $text = $items | Format-Table -Property $Property -Wrap | Out-String -Width 200 }
        else { $text = $items | Format-Table -Property $Property -AutoSize | Out-String -Width 200 }
        Write-Host $text.TrimEnd()
        Write-Host ''
    }
}

function Get-FileHashBase64 {
    param([Parameter(Mandatory = $true)][string]$Path, [ValidateSet('SHA384', 'SHA512')][string]$Algorithm = 'SHA384')
    if ($Algorithm -eq 'SHA384') { $hasher = [System.Security.Cryptography.SHA384]::Create() }
    else { $hasher = [System.Security.Cryptography.SHA512]::Create() }
    $stream = [System.IO.File]::OpenRead($Path)
    try { return [Convert]::ToBase64String($hasher.ComputeHash($stream)) }
    finally { $stream.Dispose(); $hasher.Dispose() }
}

function ConvertTo-SemVer {
    param([string]$Text)
    return [version](($Text -split '[-+]')[0])
}

function Compare-SemVer {
    # Returns -1, 0 or 1. Only stable x.y.z versions are ever selected, so pre-release rules are not needed.
    param([string]$A, [string]$B)
    return (ConvertTo-SemVer $A).CompareTo((ConvertTo-SemVer $B))
}

function Read-TextFile {
    param([string]$Path)
    return [System.IO.File]::ReadAllText($Path)
}

function Write-TextFile {
    # UTF-8 without BOM on both PowerShell 5.1 and 7 (Set-Content -Encoding UTF8 adds a BOM on 5.1).
    param([string]$Path, [string]$Text)
    [System.IO.File]::WriteAllText($Path, $Text, $Utf8NoBom)
}

function ConvertTo-JsonString {
    param([string]$Value)
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $Value.ToCharArray()) {
        switch ($ch) {
            '"' { [void]$sb.Append('\"') }
            '\' { [void]$sb.Append('\\') }
            "`n" { [void]$sb.Append('\n') }
            "`r" { [void]$sb.Append('\r') }
            "`t" { [void]$sb.Append('\t') }
            default {
                if ([int]$ch -lt 0x20) { [void]$sb.Append(('\u{0:x4}' -f [int]$ch)) } else { [void]$sb.Append($ch) }
            }
        }
    }
    return '"' + $sb.ToString() + '"'
}

function ConvertTo-ManifestJson {
    # Deterministic output with a fixed key order, identical on PowerShell 5.1 and 7.
    param($Manifest)
    $keys = @('name', 'title', 'version', 'file', 'npmFile', 'license', 'purpose', 'sha384', 'releases')
    $nl = "`n"
    $entries = foreach ($d in $Manifest.dependencies) {
        $lines = foreach ($k in $keys) { '      {0}: {1}' -f (ConvertTo-JsonString $k), (ConvertTo-JsonString ([string]$d.$k)) }
        '    {' + $nl + ($lines -join (',' + $nl)) + $nl + '    }'
    }
    return '{' + $nl +
        '  "_comment": ' + (ConvertTo-JsonString ([string]$Manifest._comment)) + ',' + $nl +
        '  "dependencies": [' + $nl + ($entries -join (',' + $nl)) + $nl + '  ]' + $nl +
        '}' + $nl
}

function Get-DependencyTableMarkdown {
    param($Manifest)
    $rows = New-Object System.Collections.Generic.List[string]
    $rows.Add('| Library | Version | File (in `vendor/`) | From npm | License | Used for | SHA-384 |')
    $rows.Add('|---|---|---|---|---|---|---|')
    foreach ($d in $Manifest.dependencies) {
        $rows.Add(('| {0} | {1} | `{2}` | `{3}` | {4} | {5} | `sha384-{6}` |' -f $d.title, $d.version, $d.file, $d.npmFile, $d.license, $d.purpose, $d.sha384))
    }
    return ($rows -join "`n")
}

function Update-ReadmeText {
    # Replaces the generated block; returns $null when the markers are missing.
    param([string]$Text, $Manifest)
    $nl = "`n"
    if ($Text.Contains("`r`n")) { $nl = "`r`n" }
    $start = $Text.IndexOf($ReadmeBegin)
    $end = $Text.IndexOf($ReadmeEnd)
    if ($start -lt 0 -or $end -lt $start) { return $null }
    $table = (Get-DependencyTableMarkdown $Manifest) -replace "`n", $nl
    return $Text.Substring(0, $start) + $ReadmeBegin + $nl + $table + $nl + $Text.Substring($end)
}

# ============================================================================================
# npm registry access
# ============================================================================================

$script:PackumentCache = @{}

function Get-Packument {
    # Abbreviated package metadata (all versions + dist info), much smaller than the full document.
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not $script:PackumentCache.ContainsKey($Name)) {
        $encoded = $Name -replace '/', '%2F'
        $script:PackumentCache[$Name] = Invoke-RestMethod -Uri "$NpmRegistry/$encoded" -Method Get -TimeoutSec 30 `
            -Headers @{ Accept = 'application/vnd.npm.install-v1+json' } -UseBasicParsing
    }
    return $script:PackumentCache[$Name]
}

function Get-StableVersions {
    # All stable, non-deprecated versions, newest first.
    param($Packument)
    $list = New-Object System.Collections.Generic.List[string]
    foreach ($p in $Packument.versions.PSObject.Properties) {
        if ($p.Name -notmatch $StableVersionPattern) { continue }
        $dep = $p.Value.PSObject.Properties['deprecated']
        if ($dep -and $dep.Value) { continue }
        $list.Add($p.Name)
    }
    return @($list | Sort-Object { ConvertTo-SemVer $_ } -Descending)
}

function Get-VersionInfo {
    param([string]$Name, [string]$Installed)
    $pk = Get-Packument -Name $Name
    $stable = Get-StableVersions $pk
    $major = (ConvertTo-SemVer $Installed).Major
    $sameMajor = @($stable | Where-Object { (ConvertTo-SemVer $_).Major -eq $major })
    $latest = [string]$pk.'dist-tags'.latest
    $bestSameMajor = $Installed
    if ($sameMajor.Count -gt 0 -and (Compare-SemVer $sameMajor[0] $Installed) -gt 0) { $bestSameMajor = $sameMajor[0] }
    return [pscustomobject]@{ Latest = $latest; SameMajor = $bestSameMajor }
}

function Get-Advisories {
    # Bulk request: { "name": ["version", ...] } -> { "name": [advisory, ...] } for affected versions only.
    param([Parameter(Mandatory = $true)][hashtable]$VersionsByName)
    $parts = foreach ($name in $VersionsByName.Keys) {
        $versions = @($VersionsByName[$name] | ForEach-Object { '"' + $_ + '"' })
        '"{0}":[{1}]' -f $name, ($versions -join ',')
    }
    $body = '{' + ($parts -join ',') + '}'
    return Invoke-RestMethod -Uri "$NpmRegistry/-/npm/v1/security/advisories/bulk" -Method Post `
        -ContentType 'application/json' -Body $body -TimeoutSec 30 -UseBasicParsing
}

function Get-AdvisoriesFor {
    # Advisories from a bulk response that affect one specific version.
    param($Response, [string]$Name, [string]$Version)
    $result = @()
    $prop = $Response.PSObject.Properties[$Name]
    if (-not $prop) { return $result }
    foreach ($a in @($prop.Value)) {
        if (Test-VersionInRange -Version $Version -Range ([string]$a.vulnerable_versions)) { $result += $a }
    }
    return $result
}

function Test-VersionInRange {
    # Minimal semver range matcher for advisory ranges: "<1.2.3", "<=1.2.3", ">=1.0.0 <2.0.0", "a || b".
    # Unknown syntax is treated as affected (fail safe).
    param([string]$Version, [string]$Range)
    if ([string]::IsNullOrWhiteSpace($Range) -or $Range.Trim() -eq '*') { return $true }
    $v = ConvertTo-SemVer $Version
    foreach ($alt in ($Range -split '\|\|')) {
        $ok = $true
        foreach ($cmp in ($alt.Trim() -split '\s+')) {
            if ($cmp -eq '') { continue }
            if ($cmp -notmatch '^(<=|>=|<|>|=)?v?(\d+\.\d+\.\d+)') { return $true }
            $op = $Matches[1]; $c = $v.CompareTo((ConvertTo-SemVer $Matches[2]))
            switch ($op) {
                '<'  { if (-not ($c -lt 0)) { $ok = $false } }
                '<=' { if (-not ($c -le 0)) { $ok = $false } }
                '>'  { if (-not ($c -gt 0)) { $ok = $false } }
                '>=' { if (-not ($c -ge 0)) { $ok = $false } }
                default { if ($c -ne 0) { $ok = $false } }
            }
        }
        if ($ok) { return $true }
    }
    return $false
}

# ============================================================================================
# Load and validate the manifest
# ============================================================================================

try {
    $manifestFull = (Resolve-Path -LiteralPath $ManifestPath).Path
    $manifest = Read-TextFile $manifestFull | ConvertFrom-Json
} catch {
    Write-Status "Could not read manifest '$ManifestPath': $($_.Exception.Message)" bad
    exit 3
}

$vendorDir = Split-Path -Parent $manifestFull
$projectDir = Split-Path -Parent $vendorDir
$indexPath = Join-Path $projectDir 'index.html'
$readmePath = Join-Path $vendorDir 'README.md'
$deps = @($manifest.dependencies)

foreach ($d in $deps) {
    # Names and versions end up in URLs, file names and a JSON body: accept only well-formed values.
    if ($d.name -notmatch $PackageNamePattern -or $d.version -notmatch $VersionPattern) {
        Write-Status "Invalid manifest entry: name='$($d.name)' version='$($d.version)'" bad
        exit 3
    }
    if ($d.file -match '\.\.' -or [System.IO.Path]::IsPathRooted($d.file) -or $d.npmFile -match '\.\.') {
        Write-Status "Invalid path in manifest entry '$($d.name)'" bad
        exit 3
    }
}

if ($Offline -and $Update) { Write-Status '-Offline cannot be combined with -Update.' bad; exit 3 }
if ($Version -and (-not $Package -or @($Package).Count -ne 1)) { Write-Status '-Version requires exactly one -Package.' bad; exit 3 }
if ($NpmFile -and (-not $Package -or @($Package).Count -ne 1)) { Write-Status '-NpmFile requires exactly one -Package.' bad; exit 3 }
if ($NpmFile -and ($NpmFile -notmatch '^[A-Za-z0-9._/-]+$' -or $NpmFile -match '\.\.' -or $NpmFile.StartsWith('/'))) {
    Write-Status "Invalid -NpmFile '$NpmFile' (expected a relative path like dist/file.js)." bad; exit 3
}
if ($Version -and $Version -notmatch $StableVersionPattern) { Write-Status "Invalid -Version '$Version' (expected x.y.z)." bad; exit 3 }
if ($Package) {
    foreach ($p in $Package) {
        if (-not ($deps | Where-Object { $_.name -eq $p })) { Write-Status "Unknown package '$p' (not in manifest)." bad; exit 3 }
    }
}

# ============================================================================================
# -SyncDocs
# ============================================================================================

if ($SyncDocs) {
    $text = Read-TextFile $readmePath
    $newText = Update-ReadmeText -Text $text -Manifest $manifest
    if ($null -eq $newText) { Write-Status "Markers for the generated table were not found in $readmePath" bad; exit 3 }
    if ($PSCmdlet.ShouldProcess($readmePath, 'Regenerate dependency table')) { Write-TextFile $readmePath $newText }
    Write-Status 'vendor/README.md dependency table regenerated from the manifest.' ok
    exit 0
}

# ============================================================================================
# -Update
# ============================================================================================

function Invoke-PackageUpdate {
    # Returns $true on success. All file changes are rolled back on failure.
    param($Dep, [string]$Target, [string]$SourceFile)

    $oldRel = [string]$Dep.file
    $oldPath = Join-Path $vendorDir $oldRel
    $oldName = Split-Path -Leaf $oldRel
    if (-not $oldName.Contains($Dep.version)) {
        Write-Status "  File name '$oldName' does not contain the version '$($Dep.version)'; cannot derive the new name." bad
        return $false
    }
    $newRel = (Split-Path -Parent $oldRel) + '/' + $oldName.Replace($Dep.version, $Target)
    $newRel = $newRel.TrimStart('/')
    $newPath = Join-Path $vendorDir $newRel
    $oldSrc = 'vendor/' + ($oldRel -replace '\\', '/')
    $newSrc = 'vendor/' + ($newRel -replace '\\', '/')

    $html = Read-TextFile $indexPath
    $srcCount = ([regex]::Matches($html, [regex]::Escape('src="' + $oldSrc + '"'))).Count
    if ($srcCount -ne 1) {
        Write-Status "  index.html must reference src=""$oldSrc"" exactly once (found $srcCount)." bad
        return $false
    }

    if (-not $PSCmdlet.ShouldProcess("$($Dep.name) $($Dep.version) -> $Target", 'Download, verify and install')) {
        Write-Status ("  Would copy package/{0} to {1} (replacing {2}), update index.html, manifest.json and README.md." -f $SourceFile, $newSrc, $oldSrc) info
        return $true
    }

    $temp = Join-Path ([System.IO.Path]::GetTempPath()) ('vendor-update-' + [guid]::NewGuid().ToString('N'))
    $backups = @{}
    $created = New-Object System.Collections.Generic.List[string]
    New-Item -ItemType Directory -Path $temp | Out-Null
    try {
        # 1. Download and verify the tarball against the registry's integrity value.
        $meta = (Get-Packument -Name $Dep.name).versions.PSObject.Properties[$Target].Value
        $integrity = [string]$meta.dist.integrity
        if ($integrity -notmatch '^sha512-(.+)$') { throw "Registry did not provide a sha512 integrity value for $Target." }
        $expectedSha512 = $Matches[1]
        $tarball = [string]$meta.dist.tarball
        if ($tarball -notmatch '^https://registry\.npmjs\.org/') { throw "Unexpected tarball URL: $tarball" }
        $tgz = Join-Path $temp 'package.tgz'
        Invoke-WebRequest -Uri $tarball -OutFile $tgz -TimeoutSec 120 -UseBasicParsing
        if ((Get-FileHashBase64 -Path $tgz -Algorithm SHA512) -cne $expectedSha512) { throw 'Tarball SHA-512 does not match the registry integrity value.' }
        Write-Status '  Tarball downloaded and verified (SHA-512).' info

        # 2. Extract (tar strips absolute paths and ".." entries) and locate the one file we need.
        $extract = Join-Path $temp 'x'
        New-Item -ItemType Directory -Path $extract | Out-Null
        & $script:TarExe -xzf $tgz -C $extract
        if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE." }
        $pkgRoot = Join-Path $extract 'package'
        $srcFile = Join-Path $pkgRoot $SourceFile
        if (-not (Test-Path -LiteralPath $srcFile -PathType Leaf)) {
            # Suggest files with the same name so the developer can choose deliberately (never guess).
            $leaf = Split-Path -Leaf $SourceFile
            $rootFull = (Resolve-Path -LiteralPath $pkgRoot).Path
            $candidates = @(Get-ChildItem -LiteralPath $pkgRoot -Recurse -File -Filter $leaf |
                ForEach-Object { $_.FullName.Substring($rootFull.Length + 1) -replace '\\', '/' })
            $msg = "'$SourceFile' does not exist in $($Dep.name)@$Target - the package layout changed."
            if ($candidates.Count -gt 0) {
                $msg += " Files with the same name: " + ($candidates -join ', ') + '.'
                $msg += " Check the release notes, then re-run with: -Package $($Dep.name) -NpmFile $($candidates[0])"
                if ((ConvertTo-SemVer $Target).Major -ne (ConvertTo-SemVer $Dep.version).Major) { $msg += ' -AllowMajor' }
            } else {
                $msg += ' No file with the same name was found; update manually (see vendor/README.md).'
            }
            throw $msg
        }
        $license = Get-ChildItem -LiteralPath (Join-Path $extract 'package') -File |
            Where-Object { $_.Name -match '^(LICENSE|LICENCE)(\.(txt|md))?$' } | Select-Object -First 1

        # 3. Back up everything we are about to touch.
        foreach ($p in @($indexPath, $manifestFull, $readmePath, $oldPath)) {
            $bak = Join-Path $temp ('bak-' + [guid]::NewGuid().ToString('N'))
            Copy-Item -LiteralPath $p -Destination $bak
            $backups[$p] = $bak
        }
        $licenseDest = $null
        if ($license) {
            $licenseDest = Join-Path (Split-Path -Parent $oldPath) $license.Name
            if (Test-Path -LiteralPath $licenseDest) {
                $bak = Join-Path $temp ('bak-' + [guid]::NewGuid().ToString('N'))
                Copy-Item -LiteralPath $licenseDest -Destination $bak
                $backups[$licenseDest] = $bak
            } else { $created.Add($licenseDest) }
        }

        # 4. Install the new file (+ license).
        Copy-Item -LiteralPath $srcFile -Destination $newPath -Force
        if ($newPath -ne $oldPath) { $created.Add($newPath) }
        if ($license) { Copy-Item -LiteralPath $license.FullName -Destination $licenseDest -Force }
        $newHash = Get-FileHashBase64 -Path $newPath -Algorithm SHA384

        # 5. Rewrite index.html, manifest.json and the README table.
        Write-TextFile $indexPath ($html.Replace('src="' + $oldSrc + '"', 'src="' + $newSrc + '"'))
        $Dep.version = $Target
        $Dep.file = ($newRel -replace '\\', '/')
        $Dep.sha384 = $newHash
        $Dep.npmFile = $SourceFile
        Write-TextFile $manifestFull (ConvertTo-ManifestJson $manifest)
        $readme = Update-ReadmeText -Text (Read-TextFile $readmePath) -Manifest $manifest
        if ($null -eq $readme) { throw 'Generated-table markers missing in vendor/README.md.' }
        Write-TextFile $readmePath $readme

        # 6. Remove the old file last, once everything else succeeded.
        if ($newPath -ne $oldPath) { Remove-Item -LiteralPath $oldPath }
        Write-Status ("  Installed {0} (sha384-{1})" -f $newSrc, $newHash) ok
        return $true
    } catch {
        Write-Status "  FAILED: $($_.Exception.Message)" bad
        foreach ($p in $created) { if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force } }
        foreach ($p in $backups.Keys) { Copy-Item -LiteralPath $backups[$p] -Destination $p -Force }
        # Reload the manifest so later packages in this run start from the restored state.
        $script:manifest = Read-TextFile $manifestFull | ConvertFrom-Json
        if ($backups.Count -gt 0) { Write-Status '  All changes for this package were rolled back.' warn }
        return $false
    } finally {
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($Update) {
    # Prefer Windows' own bsdtar: GNU tar from Git for Windows may come first in PATH and
    # treats "C:\..." as a remote host.
    $script:TarExe = $null
    if ($env:SystemRoot -and (Test-Path -LiteralPath (Join-Path $env:SystemRoot 'System32\tar.exe'))) {
        $script:TarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
    } elseif (Get-Command tar -ErrorAction SilentlyContinue) {
        $script:TarExe = (Get-Command tar).Source
    }
    if (-not $script:TarExe) {
        Write-Status 'tar was not found (included in Windows 10 1803+ and all macOS/Linux).' bad
        exit 3
    }
    if (-not (Test-Path -LiteralPath $indexPath)) { Write-Status "index.html not found at $indexPath" bad; exit 3 }

    $plan = New-Object System.Collections.Generic.List[object]
    try {
        foreach ($d in $deps) {
            if ($Package -and ($Package -notcontains $d.name)) { continue }
            $path = Join-Path $vendorDir $d.file
            if (-not (Test-Path -LiteralPath $path) -or (Get-FileHashBase64 -Path $path) -cne $d.sha384) {
                Write-Status "$($d.name): local file is missing or modified - fix that before updating (run without -Update)." bad
                exit 2
            }
            $info = Get-VersionInfo -Name $d.name -Installed $d.version
            if ($Version) {
                if (-not (Get-Packument -Name $d.name).versions.PSObject.Properties[$Version]) { Write-Status "$($d.name)@$Version does not exist on npm." bad; exit 3 }
                $target = $Version
            } elseif ($AllowMajor) {
                $target = $info.Latest
            } else {
                $target = $info.SameMajor
            }
            $isMajor = (ConvertTo-SemVer $target).Major -ne (ConvertTo-SemVer $d.version).Major
            if ($target -eq $d.version) {
                if ((Compare-SemVer $info.Latest $d.version) -gt 0) {
                    Write-Status ("{0}: {1} is the newest {2}.x release. Major update to {3} available: add -AllowMajor -Package {0}" -f $d.name, $d.version, (ConvertTo-SemVer $d.version).Major, $info.Latest) warn
                } else {
                    Write-Status ("{0}: already up to date ({1})." -f $d.name, $d.version) ok
                }
                continue
            }
            if ($isMajor -and -not $AllowMajor -and -not $Version) { continue }
            $plan.Add([pscustomobject]@{ Dep = $d; From = $d.version; To = $target; Major = $isMajor })
        }

        if ($plan.Count -eq 0) { Write-Host ''; Write-Status 'Nothing to update.' ok; exit 0 }

        # Refuse targets that are themselves affected by a known advisory.
        $query = @{}
        foreach ($p in $plan) { $query[$p.Dep.name] = @($p.To) }
        $adv = Get-Advisories -VersionsByName $query
    } catch {
        Write-Status "Could not prepare the update: $($_.Exception.Message)" bad
        exit 3
    }

    $failed = 0
    foreach ($p in $plan) {
        Write-Host ''
        $label = "{0}: {1} -> {2}" -f $p.Dep.name, $p.From, $p.To
        if ($p.Major) { $label += '  (MAJOR - may contain breaking changes)' }
        Write-Status $label head
        $hits = @(Get-AdvisoriesFor -Response $adv -Name $p.Dep.name -Version $p.To)
        if ($hits.Count -gt 0) {
            Write-Status ("  Refused: {0} {1} is affected by {2} advisory(ies):" -f $p.Dep.name, $p.To, $hits.Count) bad
            $hits | ForEach-Object { Write-Status ("    [{0}] {1}  {2}" -f $_.severity, $_.title, $_.url) info }
            $failed++
            continue
        }
        # Re-resolve the entry from the current manifest (it may have been reloaded after a rollback).
        $dep = @($manifest.dependencies | Where-Object { $_.name -eq $p.Dep.name })[0]
        $sourceFile = [string]$dep.npmFile
        if ($NpmFile) { $sourceFile = $NpmFile }
        if (-not (Invoke-PackageUpdate -Dep $dep -Target $p.To -SourceFile $sourceFile)) { $failed++ }
    }

    Write-Host ''
    if ($WhatIfPreference) {
        Write-Status '(-WhatIf: no files were changed.)' info
    } elseif ($failed -eq 0) {
        Write-Status 'Update complete. Now test the app: scan self-test OK, PNG/SVG/PDF export, language switch.' ok
        if (@($plan | Where-Object { $_.Major }).Count -gt 0) {
            Write-Status 'A MAJOR version was installed: read the release notes and test thoroughly before publishing.' warn
        }
    } else {
        Write-Status "$failed update(s) were refused or failed. Successful updates (if any) were kept." bad
    }
    if ($failed -gt 0) { exit 2 } else { exit 0 }
}

# ============================================================================================
# Check (default)
# ============================================================================================

$exitCode = 0
$results = New-Object System.Collections.Generic.List[object]

foreach ($d in $deps) {
    $path = Join-Path $vendorDir $d.file
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $integrity = 'MISSING' }
    elseif ((Get-FileHashBase64 -Path $path) -ceq $d.sha384) { $integrity = 'OK' }
    else { $integrity = 'MODIFIED' }
    if ($integrity -ne 'OK') { $exitCode = 2 }
    $results.Add([pscustomobject]@{
        Name = $d.name; Installed = $d.version; Update = '-'; Latest = '-'
        Checksum = $integrity; Advisories = '-'; Releases = $d.releases
    })
}

$advisoryDetails = @()
if (-not $Offline) {
    try {
        $query = @{}
        foreach ($d in $deps) { $query[$d.name] = @($d.version) }
        $advisories = Get-Advisories -VersionsByName $query
        foreach ($r in $results) {
            $info = Get-VersionInfo -Name $r.Name -Installed $r.Installed
            $r.Latest = $info.Latest
            if ($info.SameMajor -ne $r.Installed) { $r.Update = $info.SameMajor }
            if ((Compare-SemVer $info.Latest $r.Installed) -gt 0 -and $exitCode -lt 1) { $exitCode = 1 }

            $list = @(Get-AdvisoriesFor -Response $advisories -Name $r.Name -Version $r.Installed)
            $r.Advisories = $list.Count
            if ($list.Count -gt 0) { $exitCode = 2 }
            foreach ($a in $list) {
                $advisoryDetails += [pscustomobject]@{
                    Package = "$($r.Name)@$($r.Installed)"; Severity = $a.severity; Title = $a.title
                    Vulnerable = $a.vulnerable_versions; Url = $a.url
                }
            }
        }
    } catch {
        Write-Status "Online check failed: $($_.Exception.Message)" bad
        Write-Status 'Checksums were verified; re-run later or use -Offline to skip the online part.' info
        $results | Write-Table -Property Name, Installed, Checksum
        exit 3
    }
}

Write-Host ''
Write-Status 'Vendored dependencies' head
Write-Status '(Update = newest release in the same major version; Latest = newest release overall)' info
$results | Write-Table -Property Name, Installed, Update, Latest, Checksum, Advisories

foreach ($r in $results) {
    if ($r.Checksum -ne 'OK') {
        Write-Status ("{0}: checksum {1} - the file does not match vendor/manifest.json. Restore it from npm." -f $r.Name, $r.Checksum) bad
    }
    if ($r.Update -ne '-') {
        Write-Status ("{0}: update available {1} -> {2}   run: .\tools\Check-Dependencies.ps1 -Update -Package {0}" -f $r.Name, $r.Installed, $r.Update) warn
    }
    if ($r.Latest -ne '-' -and (Compare-SemVer $r.Latest $r.Installed) -gt 0 -and (ConvertTo-SemVer $r.Latest).Major -ne (ConvertTo-SemVer $r.Installed).Major) {
        Write-Status ("{0}: new major version {1} (breaking changes possible, see {2})   run: .\tools\Check-Dependencies.ps1 -Update -Package {0} -AllowMajor" -f $r.Name, $r.Latest, $r.Releases) warn
    }
}

if ($advisoryDetails.Count -gt 0) {
    Write-Host ''
    Write-Status 'Security advisories affecting installed versions:' bad
    $advisoryDetails | Sort-Object Package, Severity | Write-Table -Property Package, Severity, Vulnerable, Title -Wrap
    $advisoryDetails | ForEach-Object { Write-Status ("  {0}  {1}" -f $_.Package, $_.Url) info }
}

Write-Host ''
switch ($exitCode) {
    0 { Write-Status 'All dependencies are up to date, unmodified and free of known advisories.' ok }
    1 { Write-Status 'Updates are available (no known security issues). Preview with: .\tools\Check-Dependencies.ps1 -Update -WhatIf' warn }
    2 { Write-Status 'Action required: security advisory or checksum problem (see above).' bad }
}
if ($Offline) { Write-Status '(Offline mode: only checksums were verified.)' info }

exit $exitCode
