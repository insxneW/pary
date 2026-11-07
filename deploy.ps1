# Развертывание «Пары» на GitHub Pages (v2 — с логом и проверками)
$ErrorActionPreference = 'Continue'
$folder = $PSScriptRoot
$log = Join-Path $folder 'deploy.log'

Start-Transcript -Path $log -Force | Out-Null

function Fail($msg) {
  Write-Host ""
  Write-Host "ОШИБКА: $msg" -ForegroundColor Red
  Write-Host "Подробности записаны в deploy.log" -ForegroundColor Yellow
  Read-Host "Enter для выхода"
  Stop-Transcript | Out-Null
  exit 1
}

if (-not (Test-Path (Join-Path $folder 'index.html'))) { Fail "index.html не найден рядом со скриптом" }

# --- Git ---
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "Git не найден, устанавливаю через winget..." -ForegroundColor Yellow
  winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements --silent
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "Git не установился. Поставьте вручную: https://git-scm.com/download/win" }
}
Write-Host "Git: $((git --version))" -ForegroundColor Green
Write-Host ""

# --- Данные доступа ---
Write-Host "Нужен Personal Access Token с галочкой repo:"
Write-Host "https://github.com/settings/tokens/new"
Write-Host ""
$login = Read-Host "Логин GitHub"
$sec   = Read-Host "Personal Access Token (ввод скрыт)" -AsSecureString
if (-not $sec) { Fail "Токен не введён" }
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
           [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if (-not $token) { Fail "Токен пустой" }

$headers = @{
  Authorization = "token $token"
  Accept        = 'application/vnd.github+json'
  'User-Agent'  = 'pary-deploy'
}

Write-Host "Проверяю токен..."
try {
  $me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $headers -TimeoutSec 30
} catch {
  Fail "GitHub не принял токен: $($_.Exception.Message)"
}
$owner = $me.login
Write-Host "Вход выполнен: $owner" -ForegroundColor Green

# --- Репозиторий ---
$repo = 'pary'
Write-Host "Создаю репозиторий $repo..."
$repoBody = @{ name = $repo; private = $false; description = 'Расписание ЛГПУ - Telegram Mini App' } | ConvertTo-Json
try {
  Invoke-RestMethod -Uri 'https://api.github.com/user/repos' -Method Post -Headers $headers `
    -Body $repoBody -ContentType 'application/json' -TimeoutSec 30 | Out-Null
  Write-Host "Репозиторий создан" -ForegroundColor Green
} catch {
  Write-Host "Репозиторий уже существует — использую его" -ForegroundColor Yellow
}

# --- Git: инициализация и пуш ---
Set-Location $folder
if (Test-Path '.git') { Remove-Item '.git' -Recurse -Force }
git init --quiet
git checkout -b main --quiet
git add -A
git -c user.name="$owner" -c user.email="$owner@users.noreply.github.com" commit --quiet -m "Pary Mini App"
if ($LASTEXITCODE -ne 0) { Fail "Не удалось создать коммит" }

$remoteUrl = "https://${owner}:${token}@github.com/${owner}/${repo}.git"
git remote add origin $remoteUrl
if ($LASTEXITCODE -ne 0) { Fail "Не удалось добавить remote" }

Write-Host "Отправляю файлы на GitHub..."
$pushLog = git push --set-upstream origin main --force 2>&1 | Out-String
Write-Host $pushLog
if ($LASTEXITCODE -ne 0) {
  if ($pushLog -match 'workflow') {
    Fail "Токену не хватает права 'workflow'. Откройте https://github.com/settings/tokens, Edit у токена, отметьте 'workflow', Update token — и запустите снова."
  }
  Fail "Git push не прошёл. Проверьте, что у токена есть право 'repo'."
}
Write-Host "Файлы загружены" -ForegroundColor Green

# --- Проверка, что коммит реально на GitHub ---
try {
  $commit = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/commits/main" -Headers $headers -TimeoutSec 30
  Write-Host "Коммит на GitHub: $($commit.sha.Substring(0,7))" -ForegroundColor Green
} catch {
  Write-Host "Не удалось проверить коммит, но push прошёл" -ForegroundColor Yellow
}

# --- GitHub Pages ---
Write-Host "Включаю GitHub Pages..."
$pagesBody = @{ source = @{ branch = 'main'; path = '/' } } | ConvertTo-Json
$pagesOk = $false
foreach ($method in @('Post','Put')) {
  if ($pagesOk) { break }
  try {
    Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/pages" -Method $method `
      -Headers $headers -Body $pagesBody -ContentType 'application/json' -TimeoutSec 30 | Out-Null
    $pagesOk = $true
  } catch { }
}
if ($pagesOk) { Write-Host "Pages включён" -ForegroundColor Green }
else { Write-Host "Pages включите вручную: Settings → Pages → Branch: main → Save" -ForegroundColor Yellow }

$url = "https://$owner.github.io/$repo/"
$url | Set-Content (Join-Path $folder 'PAGES_URL.txt') -Encoding UTF8

# --- Ожидание сборки ---
Write-Host ""
Write-Host "Жду запуска сайта (до 2 минут)..."
$ready = $false
for ($i = 0; $i -lt 24; $i++) {
  Start-Sleep -Seconds 5
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}

Write-Host ""
if ($ready) {
  Write-Host "ГОТОВО! Сайт работает." -ForegroundColor Green
} else {
  Write-Host "Файлы загружены, но сайт ещё собирается." -ForegroundColor Yellow
  Write-Host "Откройте через 1-2 минуты вручную." -ForegroundColor Yellow
}
Write-Host "Адрес: $url" -ForegroundColor Cyan
Write-Host ""
Write-Host "Дальше: запустите «2. Привязать бота»"
Start-Process $url
Read-Host "Enter для выхода"
Stop-Transcript | Out-Null
