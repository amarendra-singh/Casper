param([Parameter(Mandatory=$true)][string]$ProgramFile,[Parameter(Mandatory=$true)][string]$RequestId)
$operatorPreviousInstance=$env:TABBIT_PLAYWRIGHT_INSTANCE
try {
 $env:TABBIT_PLAYWRIGHT_INSTANCE='348CCBF67DBABAFA'
 $operatorLauncher="$env:LOCALAPPDATA\Tabbit\LocalAgent\bin\tabbit-cli.exe"
 $operatorResult=cmd.exe /d /c "`"$operatorLauncher`" nodejs --task `"Casper operator walkthrough`" --request-id $RequestId < `"$ProgramFile`""
 [IO.File]::WriteAllText((Join-Path $PSScriptRoot "$RequestId.receipt.json"),($operatorResult -join "`n"),[Text.UTF8Encoding]::new($false))
 $operatorResult
} finally { $env:TABBIT_PLAYWRIGHT_INSTANCE=$operatorPreviousInstance }
