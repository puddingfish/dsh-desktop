# DSH Desktop 发布脚本（壳自动更新 · GitHub Releases）
#
# 用法：
#   $env:GH_TOKEN = "github_pat_xxx"          # 需要 contents:write 权限
#   .\publish.ps1 -Owner <你的GitHub用户名> -Repo <仓库名>
#   .\publish.ps1 -Owner me -Repo dsh-desktop -Finalize   # 顺便把 draft 正式发布
#
# 做五件事：
#   1. 把 owner/repo 写进 package.json build.publish（打进 app，运行时按它找更新源）
#   2. electron-builder 打 NSIS 安装包 + dir（ELECTRON_MIRROR 走国内镜像）
#   3. --publish always：安装包/latest.yml/blockmap 上传到 GitHub Draft Release
#   4. make-portable.ps1 打绿色版 zip，并上传到同一个 Draft Release
#   5. 打印 Release 地址；加 -Finalize 则直接把 draft 转正式发布
#
# 注意：electron-builder 建的是 Draft Release（latest.yml 在 draft 里对老版本不可见），
#       确认无误后要在 GitHub 上点 Publish（或本脚本加 -Finalize）。
param(
    [Parameter(Mandatory = $true)][string]$Owner,
    [Parameter(Mandatory = $true)][string]$Repo,
    [switch]$Finalize
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# ---------- 0. 前置检查 ----------
if (-not $env:GH_TOKEN) { throw "未设置 GH_TOKEN 环境变量（GitHub token，需 contents:write 权限）`n例如：`$env:GH_TOKEN = 'github_pat_xxx'" }
if (-not (Test-Path (Join-Path $root 'node_modules\electron-builder'))) { throw "缺少依赖：先在 $root 跑 npm install" }

# ---------- 1. 写 owner/repo 进 package.json ----------
$pkgPath = Join-Path $root 'package.json'
node -e @"
const fs = require('fs');
const p = process.argv[1];
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j.build.publish = [{ provider: 'github', owner: process.argv[2], repo: process.argv[3] }];
j.repository = { type: 'git', url: 'git+https://github.com/' + process.argv[2] + '/' + process.argv[3] + '.git' };
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
console.log('publish ->', process.argv[2] + '/' + process.argv[3]);
"@ $pkgPath $Owner $Repo
if ($LASTEXITCODE -ne 0) { throw "写入 publish 配置失败" }
$version = (Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json).version

# ---------- 2+3. 构建并上传安装包 ----------
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
Write-Host "==> electron-builder $version（nsis + dir，publish always）"
& npm.cmd exec electron-builder -- --win nsis dir --publish always
if ($LASTEXITCODE -ne 0) { throw "electron-builder 失败" }

# ---------- 4. 绿色版 zip 上传到同一 Release ----------
Write-Host "==> 打绿色版并上传"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\make-portable.ps1')
$zipPath = Join-Path $root "release\DSH-Desktop-$version-portable-win-x64.zip"
if (-not (Test-Path $zipPath)) { throw "没找到 $zipPath" }

$headers = @{
    Authorization = "token $env:GH_TOKEN"
    Accept        = 'application/vnd.github+json'
    'User-Agent'  = 'dsh-desktop-publish'
}
# 找到本次 tag 的 release（electron-builder 建的是 draft）
$releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$Repo/releases" -Headers $headers
$tag = "v$version"
$release = $releases | Where-Object { $_.tag_name -eq $tag } | Select-Object -First 1
if (-not $release) { throw "GitHub 上没找到 tag $tag 的 Release（electron-builder 应已创建，检查 GH_TOKEN 权限）" }

# 幂等：同名资产先删
$assetName = Split-Path $zipPath -Leaf
foreach ($asset in @($release.assets | Where-Object { $_.name -eq $assetName })) {
    Invoke-RestMethod -Method Delete -Uri $asset.url -Headers $headers | Out-Null
    Write-Host "    已删除旧资产 $assetName"
}
Invoke-RestMethod -Method Post `
    -Uri "https://uploads.github.com/repos/$Owner/$Repo/releases/$($release.id)/assets?name=$assetName" `
    -Headers $headers -ContentType 'application/zip' -InFile $zipPath | Out-Null
Write-Host "    已上传 $assetName"

# ---------- 5. 收尾 ----------
if ($Finalize) {
    Invoke-RestMethod -Method Patch -Uri "https://api.github.com/repos/$Owner/$Repo/releases/$($release.id)" `
        -Headers $headers -ContentType 'application/json' -Body '{"draft":false}' | Out-Null
    Write-Host "==> Release 已正式发布"
}
Write-Host ""
Write-Host "完成：https://github.com/$Owner/$Repo/releases/tag/$tag"
if (-not $Finalize) { Write-Host "（当前是 Draft，记得去 GitHub 点 Publish，老客户端才能看到更新）" }
