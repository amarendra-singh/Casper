param([string]$Request, [string]$Code)
$cli = "$env:LOCALAPPDATA\Tabbit\LocalAgent\bin\tabbit-cli.exe"
$program = [IO.Path]::GetTempFileName()
try {
  [IO.File]::WriteAllText($program, $Code, [Text.UTF8Encoding]::new($false))
  cmd.exe /d /c "`"$cli`" nodejs --task `"Catalogue browser verification`" --request-id $Request < `"$program`"" |
    Tee-Object -FilePath (Join-Path $PSScriptRoot "$Request.receipt.json")
} finally { Remove-Item -LiteralPath $program }
