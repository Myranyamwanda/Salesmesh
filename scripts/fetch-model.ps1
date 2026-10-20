# Download the model v1 files and keep only files whose SHA-256 checksum
# matches ml/model_contract/model-v1.sha256. Run through:
#   .\scripts\dev.ps1 fetch-model
#
# The model files are never committed to Git. They are attached to the GitHub
# Release "model-v1". The alternative source is S3 (MODEL_SOURCE=s3 in .env).
param(
    [string]$ReleaseUrl = "https://github.com/Myranyamwanda/Salesmesh/releases/download/model-v1",
    [string]$Target
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # The progress bar makes downloads very slow in Windows PowerShell 5.1.
$RepositoryRoot = Split-Path -Parent $PSScriptRoot
if (-not $Target) { $Target = Join-Path $RepositoryRoot "backend\models\v1" }
$ChecksumFile = Join-Path $RepositoryRoot "ml\model_contract\model-v1.sha256"

# GitHub requires TLS 1.2, which older Windows PowerShell does not always enable.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Get-Sha256([string]$Path) {
    (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLower()
}

# Each line is "<sha256>  <file name>", the same format as sha256sum.
$Expected = Get-Content $ChecksumFile |
    Where-Object { $_.Trim() } |
    ForEach-Object {
        $Hash, $Name = $_.Trim() -split "\s+", 2
        [pscustomobject]@{ Name = $Name.Trim(); Hash = $Hash.ToLower() }
    }

New-Item -ItemType Directory -Force -Path $Target | Out-Null
$Rejected = @()

foreach ($File in $Expected) {
    $Destination = Join-Path $Target $File.Name
    if (Test-Path $Destination) {
        if ((Get-Sha256 $Destination) -eq $File.Hash) {
            Write-Host "ok        $($File.Name) (already present)"
            continue
        }
        # Never keep a file that does not match, even an old local copy.
        Remove-Item -Force $Destination
        Write-Warning "$($File.Name) did not match its checksum and was removed."
    }

    $Download = "$Destination.download"
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$ReleaseUrl/$($File.Name)" -OutFile $Download
    }
    catch {
        Remove-Item -Force -ErrorAction SilentlyContinue $Download
        Write-Warning "Could not download $($File.Name): $($_.Exception.Message)"
        $Rejected += $File.Name
        continue
    }

    $Actual = Get-Sha256 $Download
    if ($Actual -ne $File.Hash) {
        Remove-Item -Force $Download
        Write-Warning "$($File.Name) has checksum $Actual, expected $($File.Hash). It was not saved."
        $Rejected += $File.Name
        continue
    }
    Move-Item -Force $Download $Destination
    Write-Host "verified  $($File.Name)"
}

if ($Rejected.Count -gt 0) {
    throw "Not saved: $($Rejected -join ', '). Check the model-v1 release assets (see README), or use MODEL_SOURCE=s3."
}
Write-Host "All model v1 files are in $Target and match model-v1.sha256."
