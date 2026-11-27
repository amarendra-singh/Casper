param([Parameter(Mandatory=$true)][string]$ProgramFile,[Parameter(Mandatory=$true)][string]$RequestId,[string]$GroupId)
$previousInstance = $env:TABBIT_PLAYWRIGHT_INSTANCE
$taskLauncher = "$env:LOCALAPPDATA\Tabbit\LocalAgent\bin\tabbit-cli.exe"
try {
  $env:TABBIT_PLAYWRIGHT_INSTANCE = '348CCBF67DBABAFA'
  $taskSelector = if ($GroupId) { " --group $GroupId" } else { '' }
  $taskResult = cmd.exe /d /c "`"$taskLauncher`" nodejs --task `"Audit Casper website`"$taskSelector --request-id $RequestId < `"$ProgramFile`""
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot "$RequestId.receipt.json"), ($taskResult -join "`n"), [Text.UTF8Encoding]::new($false))
  $taskResult
} finally { $env:TABBIT_PLAYWRIGHT_INSTANCE = $previousInstance }
