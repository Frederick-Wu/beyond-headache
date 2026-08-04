# 社群預覽圖候選 —— A 版版面，左半換成去背肖像
#
# 用法：powershell -ExecutionPolicy Bypass -File tools\make-og-portrait-preview.ps1 <輸出資料夾>
#
# 肖像是去背 PNG，直接疊在磚紅色塊上，不會有照片的方形邊界。
# 產生兩種構圖比例讓人挑，選定後把參數搬進 make-og-image.ps1。
#
# 注意：本檔必須以 UTF-8 BOM 儲存（PowerShell 5.1 會用 ANSI 讀無 BOM 的 .ps1）。

param([string]$OutDir)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $root 'preview' }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$cfg = Get-Content (Join-Path $root 'site.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json

$PORTRAIT = 'C:\MyProjects\個人肖像照.png'
if (-not (Test-Path $PORTRAIT)) { throw "找不到肖像檔：$PORTRAIT" }

$W = 1200
$H = 628
$PANEL = 600          # 左半色塊寬度
$BRICK = [System.Drawing.ColorTranslator]::FromHtml('#7b3f3f')
$PAPER = [System.Drawing.ColorTranslator]::FromHtml('#fdfcfa')
$INK = [System.Drawing.ColorTranslator]::FromHtml('#1c1c1e')
$INK_SOFT = [System.Drawing.ColorTranslator]::FromHtml('#44454a')
$RULE_L = [System.Drawing.ColorTranslator]::FromHtml('#d9d4cd')
$font = 'Noto Sans TC'

$items = @($cfg.specialties)
$lines = @()
for ($i = 0; $i -lt $items.Count; $i += 2) {
  if ($i + 1 -lt $items.Count) { $lines += "$($items[$i]) | $($items[$i+1])" }
  else { $lines += $items[$i] }
}

function Draw-Text($g) {
  $centerX = 918
  $center = New-Object System.Drawing.StringFormat
  $center.Alignment = [System.Drawing.StringAlignment]::Center

  $fName = New-Object System.Drawing.Font($font, 74, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fSub = New-Object System.Drawing.Font($font, 52, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $fLine = New-Object System.Drawing.Font($font, 30, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $bName = New-Object System.Drawing.SolidBrush($INK)
  $bSub = New-Object System.Drawing.SolidBrush($INK_SOFT)
  $pRule = New-Object System.Drawing.Pen([System.Drawing.Color]$RULE_L, [single]2)

  $g.DrawString($cfg.author.Replace(' ', ''), $fName, $bName, $centerX, 78, $center)
  $g.DrawLine($pRule, 700, 186, 1136, 186)
  $g.DrawString($cfg.authorTitle, $fSub, $bSub, $centerX, 208, $center)
  $g.DrawLine($pRule, 700, 300, 890, 300)
  $g.DrawLine($pRule, 946, 300, 1136, 300)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($RULE_L)), 913, 295, 10, 10)

  $y = 336
  foreach ($l in $lines) { $g.DrawString($l, $fLine, $bSub, 702, $y); $y += 46 }

  $fName.Dispose(); $fSub.Dispose(); $fLine.Dispose()
  $bName.Dispose(); $bSub.Dispose(); $pRule.Dispose(); $center.Dispose()
}

# scale  : 肖像縮放倍率
# headTop: 頭頂要落在色塊裡的 y 座標
# 原圖中頭頂約在 y=145、人物水平中心約在 x=560
function Build($name, $scale, $headTop) {
  $src = [System.Drawing.Image]::FromFile($PORTRAIT)

  $bmp = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

  $g.FillRectangle((New-Object System.Drawing.SolidBrush($PAPER)), 0, 0, $W, $H)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush($BRICK)), 0, 0, $PANEL, $H)

  # 肖像只在左半色塊內顯示，超出的部分裁掉
  $clip = $g.Save()
  $g.SetClip((New-Object System.Drawing.Rectangle(0, 0, $PANEL, $H)))

  $pw = [int][Math]::Round($src.Width * $scale)
  $ph = [int][Math]::Round($src.Height * $scale)
  $x = [int][Math]::Round($PANEL / 2 - 560 * $scale)
  $y = [int][Math]::Round($headTop - 145 * $scale)
  $g.DrawImage($src, $x, $y, $pw, $ph)

  $g.Restore($clip)
  Draw-Text $g
  $g.Dispose()

  $out = Join-Path $OutDir "$name.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose(); $src.Dispose()
  "  {0,-22} 縮放 {1}  肖像 {2}x{3}  {4} KB" -f "$name.png", $scale, $pw, $ph, [math]::Round((Get-Item $out).Length / 1KB, 1)
}

Build 'og-a1-portrait-large' 0.50 60
Build 'og-a2-portrait-calm' 0.42 96

"`n輸出 → $OutDir"
