$ErrorActionPreference = "Stop"
$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

$Python = Join-Path $Project ".venv\Scripts\python.exe"
if (-not (Test-Path $Python)) {
    throw "Missing $Python. Create the project virtual environment before packaging."
}

& $Python -m pip install --disable-pip-version-check "pyinstaller>=6.0,<7"
if ($LASTEXITCODE -ne 0) { throw "pyinstaller install failed" }

Push-Location (Join-Path $Project "frontend")
npm run build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
Pop-Location

$Output = Join-Path $Project "packaging\output"
$Work = Join-Path $Project "packaging\work"
if (Test-Path $Output) { Remove-Item $Output -Recurse -Force }
& $Python -m PyInstaller --noconfirm --clean `
    --distpath $Output `
    --workpath $Work `
    (Join-Path $PSScriptRoot "oc-modal-configurator.spec")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

$Folder = Join-Path $Output "oc-modal-configurator"
$Sample = Get-ChildItem $Folder -Recurse -Filter "api.json" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch "frontend\\dist" }
if ($Sample) { throw "Sample api.json was packaged: $($Sample.FullName)" }
if (-not (Test-Path (Join-Path $Folder "oc-modal-configurator.exe"))) {
    throw "Executable was not produced."
}
if (-not (Test-Path (Join-Path $Folder "_internal\frontend\dist\index.html")) -and
    -not (Test-Path (Join-Path $Folder "frontend\dist\index.html"))) {
    throw "Built interface was not packaged."
}

$Zip = Join-Path $Output "oc-modal-configurator-windows.zip"
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Compress-Archive -Path $Folder -DestinationPath $Zip
Write-Host "Folder: $Folder"
Write-Host "Zip: $Zip"
