# 產生整套網站圖示 —— 圖案是「突觸 D-1：對望」
#
# 用法（在專案根目錄執行）：
#   powershell -ExecutionPolicy Bypass -File tools\make-favicons.ps1
#
# 輸出到 static/，建置時 build.mjs 會原樣複製到網站根目錄。
#
# 為什麼要有這支腳本，而不是只放一個 SVG：
#   SVG favicon 只有較新的瀏覽器支援，而所有瀏覽器都會自己去要 /favicon.ico。
#   PNG 與 ICO 是為了這些情況準備的。設計要改的話，改下面的 Draw-Icon
#   函式再重跑，整套會一起更新，不會出現各尺寸圖案不一致的情形。
#
# 畫法上以 4 倍尺寸繪製再縮小（super-sampling），小圖的邊緣才不會粗糙。

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'static'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

# --- 設計參數（座標以 32x32 為基準，與 favicon.svg 一致）---
$BG     = [System.Drawing.ColorTranslator]::FromHtml('#7b3f3f')
$FG     = [System.Drawing.ColorTranslator]::FromHtml('#fdfcfa')
$RADIUS = 7.0      # 圓角
$STROKE = 2.9      # 軸突筆畫寬度
$BULB   = 4.3      # 終末半徑

function New-RoundedRect([single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc(0, 0, $d, $d, 180, 90)
  $p.AddArc($w - $d, 0, $d, $d, 270, 90)
  $p.AddArc($w - $d, $h - $d, $d, $d, 0, 90)
  $p.AddArc(0, $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Draw-Icon([int]$size, [bool]$roundedCorners = $true) {
  $ss = 4                      # super-sampling 倍率
  $big = $size * $ss
  $s = $big / 32.0             # 32 單位座標 → 實際像素

  $bmp = New-Object System.Drawing.Bitmap($big, $big, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  # 底色
  $bgBrush = New-Object System.Drawing.SolidBrush($BG)
  if ($roundedCorners) {
    $path = New-RoundedRect $big $big ($RADIUS * $s)
    $g.FillPath($bgBrush, $path)
    $path.Dispose()
  } else {
    # iOS 會自己把 apple-touch-icon 切成圓角，來源要給滿版方形
    $g.FillRectangle($bgBrush, 0, 0, $big, $big)
  }

  # 兩條軸突（三次貝茲曲線，與 SVG 的 C 指令同一組控制點）
  # 明確轉型：Pen 的建構子要的是 float，PowerShell 的算術結果預設是 double，
  # 不轉的話多載解析會失敗。
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]$FG, [single]($STROKE * $s))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pt = { param($x, $y) New-Object System.Drawing.PointF(($x * $s), ($y * $s)) }

  $g.DrawBezier($pen, (& $pt 4 6.5),  (& $pt 7 8),  (& $pt 9 9.6),    (& $pt 10.2 11.2))
  $g.DrawBezier($pen, (& $pt 28 25.5), (& $pt 25 24), (& $pt 23 22.4), (& $pt 21.8 20.8))

  # 兩個突觸終末
  $fgBrush = New-Object System.Drawing.SolidBrush($FG)
  foreach ($c in @(@(11.4, 12.6), @(20.6, 19.4))) {
    $g.FillEllipse($fgBrush,
      (($c[0] - $BULB) * $s), (($c[1] - $BULB) * $s),
      ($BULB * 2 * $s), ($BULB * 2 * $s))
  }

  $g.Dispose(); $pen.Dispose(); $bgBrush.Dispose(); $fgBrush.Dispose()

  # 縮到目標尺寸
  $final = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g2 = [System.Drawing.Graphics]::FromImage($final)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g2.Clear([System.Drawing.Color]::Transparent)
  $g2.DrawImage($bmp, 0, 0, $size, $size)
  $g2.Dispose(); $bmp.Dispose()

  return $final
}

# --- 輸出 PNG ---
$targets = @(
  @{ size = 16;  name = 'favicon-16.png';       square = $false },
  @{ size = 32;  name = 'favicon-32.png';       square = $false },
  @{ size = 180; name = 'apple-touch-icon.png'; square = $true  },
  @{ size = 192; name = 'icon-192.png';         square = $false },
  @{ size = 512; name = 'icon-512.png';         square = $false }
)

foreach ($t in $targets) {
  $img = Draw-Icon $t.size (-not $t.square)
  $path = Join-Path $outDir $t.name
  $img.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $img.Dispose()
  "  {0,-22} {1}x{1}  {2} KB" -f $t.name, $t.size, [math]::Round((Get-Item $path).Length / 1KB, 1)
}

"`n完成 → $outDir"
