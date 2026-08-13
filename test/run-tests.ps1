<#
  run-tests.ps1 - Run unit tests on a Windows machine WITHOUT Node.js installed.

  Why this exists:
    This project's known risk R-01 is that Node.js is not installed on the target
    machine, so `npm test` cannot run. Windows Script Host (cscript) is always
    present on Windows, so we use it as a fallback JS engine.

  Two encoding problems this script works around:
    1. cscript reads .js files using the system ANSI codepage, which corrupts the
       CJK string literals in the test file. Fix: convert to UTF-16LE first.
    2. The console would otherwise print the test output as mojibake.
       Fix: switch console output encoding to UTF-8 for the duration of the run.

  NOTE: comments in this file are deliberately ASCII-only. PowerShell 5.1 reads
  .ps1 files as ANSI, so non-ASCII comment text can corrupt following lines.

  Usage:  powershell -ExecutionPolicy Bypass -File test\run-tests.ps1
  If Node.js is installed, prefer:  npm test
#>

$ErrorActionPreference = 'Stop'

$testDir = $PSScriptRoot
if (-not $testDir) {
    $testDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if (-not $testDir) {
    Write-Error 'Cannot determine the test directory.'
    exit 1
}

$source = Join-Path $testDir 'run-tests-wsh.js'

# The temp file must live inside test/ because the test script derives the
# path to src/ relative to its own location.
$temp = Join-Path $testDir '.run-tests-utf16.tmp.js'

if (-not (Test-Path $source)) {
    Write-Error "Test file not found: $source"
    exit 1
}

# Convert UTF-8 source to UTF-16LE (with BOM) so cscript parses CJK correctly.
$content = [System.IO.File]::ReadAllText($source, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText($temp, $content, (New-Object System.Text.UnicodeEncoding $false, $true))

$prevEncoding = [Console]::OutputEncoding
$exitCode = 1
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    & cscript //Nologo $temp
    $exitCode = $LASTEXITCODE
}
finally {
    [Console]::OutputEncoding = $prevEncoding
    if (Test-Path $temp) { Remove-Item $temp -Force }
}

exit $exitCode
