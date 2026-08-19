# 从 assets/logo.jpg 生成 Electron 图标套件（原图直出，不做任何抠图/透明处理——
# 用户提供的 logo 已处理完毕，保留其浅灰底色）：
#   assets\icon-{512,256,64,32,16}.png  — 窗口/托盘/标题栏图标
#   build\icon.png / build\icon.ico     — electron-builder 打包用
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent          # desktop\dsh-desktop
$src = Join-Path $root 'assets\logo.jpg'
New-Item -ItemType Directory -Force (Join-Path $root 'assets') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $root 'build') | Out-Null

$srcImg = [System.Drawing.Bitmap]::FromFile($src)

# 高质量缩放（保持原图背景与构图）
function Make-Png([int]$size, [string]$outPath) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($srcImg, 0, 0, $size, $size)
    $g.Dispose()
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "wrote $outPath ($size x $size)"
}

Make-Png 512 (Join-Path $root 'assets\icon-512.png')
Make-Png 256 (Join-Path $root 'assets\icon-256.png')
Make-Png  64 (Join-Path $root 'assets\icon-64.png')
Make-Png  32 (Join-Path $root 'assets\icon-32.png')
Make-Png  16 (Join-Path $root 'assets\icon-16.png')
Copy-Item (Join-Path $root 'assets\icon-256.png') (Join-Path $root 'build\icon.png') -Force

# --- 多尺寸 ICO（PNG 帧格式，Vista+ 通用；electron-builder/Windows 均支持）---
$sizes = @(16,24,32,48,64,128,256)
$frames = @()
foreach($s in $sizes){
    $tmp = Join-Path $env:TEMP "dsh-icon-$s.png"
    Make-Png $s $tmp | Out-Null
    $frames += ,@([System.IO.File]::ReadAllBytes($tmp), $s)
    Remove-Item $tmp -Force
}
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
# ICONDIR: reserved(2)=0, type(2)=1, count(2)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$frames.Count)
$offset = 6 + 16*$frames.Count
foreach($f in $frames){
    $bytes=$f[0]; $s=$f[1]
    $bw.Write([byte]($s -band 0xFF))              # width (0 = 256)
    $bw.Write([byte]($s -band 0xFF))              # height
    $bw.Write([byte]0)                            # palette
    $bw.Write([byte]0)                            # reserved
    $bw.Write([uint16]1)                          # color planes
    $bw.Write([uint16]32)                         # bits per pixel
    $bw.Write([uint32]$bytes.Length)              # data size
    $bw.Write([uint32]$offset)                    # data offset
    $offset += $bytes.Length
}
foreach($f in $frames){ $bw.Write($f[0]) }
$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $root 'build\icon.ico'), $ms.ToArray())
$bw.Dispose(); $ms.Dispose()
Write-Host "wrote $(Join-Path $root 'build\icon.ico') ($((Get-Item (Join-Path $root 'build\icon.ico')).Length) bytes, sizes: $($sizes -join ','))"

$srcImg.Dispose()
Write-Host 'done.'
