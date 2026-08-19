# 把 release\win-unpacked 打成绿色免安装 zip：
#   release\DSH-Desktop-<版本>-portable-win-x64.zip
# 解压任意目录 → 双击 "DSH Desktop.exe" 即可运行；无需管理员权限、不写注册表。
# 用户数据（运行时/配置/会话）存放在 %APPDATA%\DSH Desktop，与解压位置无关。
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$unpacked = Join-Path $root 'release\win-unpacked'
if (-not (Test-Path $unpacked)) { throw "未找到 $unpacked，请先执行 electron-builder --win --dir" }

$version = (Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$readme = @"

DSH Desktop v$version（绿色免安装版）
====================================

使用方法：
  1. 解压到任意有写权限的目录（无需管理员权限、不写注册表）。
  2. 双击 "DSH Desktop.exe" 启动；关闭窗口后驻留托盘，托盘菜单可退出。
  3. 首次启动会自动准备运行时：
     - 优先复用系统已装的 Node.js（22.19+ 或 24+）；
     - 没有则自动从镜像下载独立 Node 运行时（约 30 MB，仅一次）；
     - 随后自动 npm 安装最新版 DeepSeek Harness（官方 @deepseek-ai/dsh 包）。

数据位置（与解压目录无关，升级 zip 时不受影响）：
  %APPDATA%\DSH Desktop\            配置、运行时、dsh web 服务日志

升级方式：
  - DSH 本体：托盘菜单「检查 DSH 更新（npm）」自动升级，或启动时自动比对。
  - 壳（本程序）：下载新版 zip 覆盖解压目录即可（绿色版不自动替换壳本体）。

"@
$readmePath = Join-Path $unpacked '使用说明.txt'
Set-Content -Path $readmePath -Value $readme -Encoding UTF8

$zip = Join-Path $root "release\DSH-Desktop-$version-portable-win-x64.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$unpacked\*" -DestinationPath $zip -CompressionLevel Optimal
Write-Host "wrote $zip ($([math]::Round((Get-Item $zip).Length/1MB,1)) MB)"
