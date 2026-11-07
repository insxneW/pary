# Привязка Mini App к боту Telegram (кнопка «Пары»)
$ErrorActionPreference = 'Stop'
$folder = $PSScriptRoot

$defaultUrl = ''
$urlFile = Join-Path $folder 'PAGES_URL.txt'
if (Test-Path $urlFile) { $defaultUrl = (Get-Content $urlFile -Raw).Trim() }

Write-Host "Адрес приложения должен начинаться с https://"
$url = Read-Host "Адрес (Enter = $defaultUrl)"
if (-not $url) { $url = $defaultUrl }
if (-not $url) {
  Write-Host "Адрес не указан." -ForegroundColor Red
  Read-Host "Enter для выхода"; exit 1
}

Write-Host ""
Write-Host "Токен берётся у @BotFather: /newbot, затем /mybots - API Token"
$sec = Read-Host "Токен бота (ввод скрыт)" -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
           [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))

try {
  $me = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getMe" -TimeoutSec 30
} catch {
  Write-Host "Токен не принят Telegram." -ForegroundColor Red
  Read-Host "Enter для выхода"; exit 1
}
$botName = $me.result.username
Write-Host "Бот найден: @$botName" -ForegroundColor Green

$body = @{
  menu_button = @{
    type    = 'web_app'
    text    = 'Пары'
    web_app = @{ url = $url }
  }
} | ConvertTo-Json -Depth 5 -Compress

try {
  Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/setChatMenuButton" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 30 | Out-Null
  Write-Host ""
  Write-Host "Готово! Кнопка «Пары» появилась в боте @$botName" -ForegroundColor Green
  Write-Host "Откройте бота в Telegram и нажмите кнопку слева от поля ввода."
} catch {
  Write-Host "Не удалось установить кнопку: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Убедитесь, что адрес начинается с https:// и приложение уже открывается."
}
Read-Host "Enter для выхода"
