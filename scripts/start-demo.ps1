$ErrorActionPreference = 'Stop'
$taskOldEnv = @{}
foreach ($taskEnvName in @('DATA_DIR','APP_ORIGIN','HOST','PORT','COOKIE_SECURE')) {
    $taskOldEnv[$taskEnvName] = [Environment]::GetEnvironmentVariable($taskEnvName)
}
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    & node scripts/demo.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Inisialisasi demo gagal.' }
    $env:DATA_DIR = 'data/demo'
    $env:APP_ORIGIN = 'http://127.0.0.1:3000'
    $env:HOST = '127.0.0.1'
    $env:PORT = '3000'
    $env:COOKIE_SECURE = 'false'
    & node server.mjs
} finally {
    foreach ($taskEnvName in $taskOldEnv.Keys) {
        [Environment]::SetEnvironmentVariable($taskEnvName, $taskOldEnv[$taskEnvName], 'Process')
    }
    Pop-Location
}
