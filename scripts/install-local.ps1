# Builds Robs AI Cockpit (release) and installs it for the current user:
#   %LOCALAPPDATA%\Programs\Robs AI Cockpit\RobsAICockpit.exe
# plus a shortcut "Robs AI Cockpit.lnk" in the project folder and in the Start menu.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\install-local.ps1 [-NoBuild] [-Desktop]
param([switch]$NoBuild, [switch]$Desktop)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$installDir = Join-Path $env:LOCALAPPDATA "Programs\Robs AI Cockpit"
$exe = Join-Path $installDir "RobsAICockpit.exe"

if (-not $NoBuild) {
  Push-Location $root
  try {
    cmd /c "pnpm tauri build --no-bundle 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }
  } finally { Pop-Location }
}
# Release build: the custom target dir from docs/DEVELOPMENT.md, else the default src-tauri\target.
$target = @(
  (Join-Path $env:USERPROFILE ".cache\ai-cockpit-target\release\RobsAICockpit.exe"),
  (Join-Path $root "src-tauri\target\release\RobsAICockpit.exe")
) | Where-Object { Test-Path $_ } | Sort-Object { (Get-Item $_).LastWriteTime } -Descending | Select-Object -First 1
if (-not $target) { throw "Release build not found (src-tauri\target\release or ~\.cache\ai-cockpit-target\release)" }

New-Item -ItemType Directory -Force $installDir | Out-Null
# A running exe cannot be overwritten, but it can be renamed: move it aside, so open windows keep
# working and the next start uses the new build. Older set-aside copies are removed when free.
Get-ChildItem $installDir -Filter "RobsAICockpit.previous-*.exe" -ErrorAction SilentlyContinue | ForEach-Object { try { Remove-Item $_.FullName -Force } catch {} }
$running = Get-Process -Name "RobsAICockpit" -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }
if ($running -and (Test-Path $exe)) {
  $aside = Join-Path $installDir ("RobsAICockpit.previous-{0:yyyyMMdd-HHmmss}.exe" -f (Get-Date))
  Rename-Item -LiteralPath $exe -NewName (Split-Path $aside -Leaf)
  "Running instance kept; restart Robs AI Cockpit to use the new version."
}
Copy-Item $target $exe -Force
Copy-Item (Join-Path $root "src-tauri\icons\icon.ico") (Join-Path $installDir "RobsAICockpit.ico") -Force

$shell = New-Object -ComObject WScript.Shell
$places = @((Join-Path $root "Robs AI Cockpit.lnk"), (Join-Path ([Environment]::GetFolderPath("Programs")) "Robs AI Cockpit.lnk"))
if ($Desktop) { $places += (Join-Path ([Environment]::GetFolderPath("Desktop")) "Robs AI Cockpit.lnk") }
foreach ($lnk in $places) {
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = $exe
  $s.WorkingDirectory = $installDir
  $s.IconLocation = "$exe,0"
  $s.Description = "Robs AI Cockpit - Claude Code & Codex sessions side by side"
  $s.Save()
  "Shortcut: $lnk"
}
"Installed: $exe"
