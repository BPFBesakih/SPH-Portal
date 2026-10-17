param([int]$Port = 3000)
$ErrorActionPreference = 'Stop'
$taskOldEnv = @{}
foreach ($taskEnvName in @('DATA_DIR','APP_ORIGIN','HOST','PORT','COOKIE_SECURE')) {
    $taskOldEnv[$taskEnvName] = [Environment]::GetEnvironmentVariable($taskEnvName)
}
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    & node scripts/demo-pengadaan.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Inisialisasi demo Pengadaan gagal.' }
    $env:DATA_DIR = 'data/demo-pengadaan'
    $env:APP_ORIGIN = "http://127.0.0.1:$Port"
    $env:HOST = '127.0.0.1'
    $env:PORT = "$Port"
    $env:COOKIE_SECURE = 'false'
    & node server.mjs
} finally {
    foreach ($taskEnvName in $taskOldEnv.Keys) {
        [Environment]::SetEnvironmentVariable($taskEnvName, $taskOldEnv[$taskEnvName], 'Process')
    }
    Pop-Location
}
