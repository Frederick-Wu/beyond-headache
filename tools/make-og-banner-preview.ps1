# 社群預覽圖候選 —— 沿用門診橫幅的版面，但不放病人照片
#
# 用法：powershell -ExecutionPolicy Bypass -File tools\make-og-banner-preview.ps1 <輸出資料夾>
#
# 這支是「給人挑」用的，輸出到指定資料夾而不是 static/，
# 選定之後再把該變體的繪製參數搬進 make-og-image.ps1。
#
# 文字內容取自 site.config.json，專長兩兩一組排成五行，
# 與原橫幅的版面一致，且改設定檔就會跟著變。
#
# 注意：本檔必須以 UTF-8 BOM 儲存（PowerShell 5.1 會用 ANSI 讀無 BOM 的 .ps1）。

param([string]$OutDir)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $root 'preview' }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$cfg = Get-Content (Join-Path $root 'site.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json

$W = 1200
$H = 628
$BRICK = [System.Drawing.ColorTranslator]::FromHtml('#7b3f3f')
$PAPER = [System.Drawing.ColorTranslator]::FromHtml('#fdfcfa')
$INK = [System.Drawing.ColorTranslator]::FromHtml('#1c1c1e')
$INK_SOFT = [System.Drawing.ColorTranslator]::FromHtml('#44454a')
$RULE_L = [System.Drawing.ColorTranslator]::FromHtml('#d9d4cd')
$ON_BRICK = [System.Drawing.ColorTranslator]::FromHtml('#f2dede')
$RULE_D = [System.Drawing.ColorTranslator]::FromHtml('#9c6a6a')

$font = 'Noto Sans TC'

# 專長兩兩一組，最後落單的自己一行 —— 與原橫幅的五行版面相同
$items = @($cfg.specialties)
$lines = @()
for ($i = 0; $i -lt $items.Count; $i += 2) {
  if ($i + 1 -lt $items.Count) { $lines += "$($items[$i]) | $($items[$i+1])" }
  else { $lines += $items[$i] }
}

function Draw-Mark($g, $cx, $cy, $size, $color) {
  # 突觸圖案，座標與 favicon 同一組（32 單位基準）
  $s = $size / 32.0
  $ox = $cx - $size / 2
  $oy = $cy - $size / 2
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]$color, [single](2.9 * $s))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $p = { param($x, $y) New-Object System.Drawing.PointF(($ox + $x * $s), ($oy + $y * $s)) }
  $g.DrawBezier($pen, (& $p 4 6.5), (& $p 7 8), (& $p 9 9.6), (& $p 10.2 11.2))
  $g.DrawBezier($pen, (& $p 28 25.5), (& $p 25 24), (& $p 23 22.4), (& $p 21.8 20.8))
  $br = New-Object System.Drawing.SolidBrush($color)
  foreach ($c in @(@(11.4, 12.6), @(20.6, 19.4))) {
    $r = 4.3 * $s
    $g.FillEllipse($br, ($ox + $c[0] * $s - $r), ($oy + $c[1] * $s - $r), ($r * 2), ($r * 2))
  }
  $pen.Dispose(); $br.Dispose()
}

function Draw-Text($g, $nameColor, $subColor, $lineColor, $ruleColor) {
  $centerX = 918
  $center = New-Object System.Drawing.StringFormat
  $center.Alignment = [System.Drawing.StringAlignment]::Center

  $fName = New-Object System.Drawing.Font($font, 74, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fSub = New-Object System.Drawing.Font($font, 52, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $fLine = New-Object System.Drawing.Font($font, 30, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

  $bName = New-Object System.Drawing.SolidBrush($nameColor)
  $bSub = New-Object System.Drawing.SolidBrush($subColor)
  $bLine = New-Object System.Drawing.SolidBrush($lineColor)
  $pRule = New-Object System.Drawing.Pen([System.Drawing.Color]$ruleColor, [single]2)

  $g.DrawString($cfg.author.Replace(' ', ''), $fName, $bName, $centerX, 78, $center)
  $g.DrawLine($pRule, 700, 186, 1136, 186)
  $g.DrawString($cfg.authorTitle, $fSub, $bSub, $centerX, 208, $center)

  # 細分隔線，中間留一個小點
  $g.DrawLine($pRule, 700, 300, 890, 300)
  $g.DrawLine($pRule, 946, 300, 1136, 300)
  $bDot = New-Object System.Drawing.SolidBrush($ruleColor)
  $g.FillEllipse($bDot, 913, 295, 10, 10)

  $y = 336
  foreach ($l in $lines) {
    $g.DrawString($l, $fLine, $bLine, 702, $y)
    $y += 46
  }

  $fName.Dispose(); $fSub.Dispose(); $fLine.Dispose()
  $bName.Dispose(); $bSub.Dispose(); $bLine.Dispose(); $bDot.Dispose(); $pRule.Dispose()
  $center.Dispose()
}

function New-Canvas {
  $bmp = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  return @($bmp, $g)
}

# --- 變體 1：左磚紅色塊 + 白色圖示，右側白底深字 ---
$c = New-Canvas; $bmp = $c[0]; $g = $c[1]
$g.FillRectangle((New-Object System.Drawing.SolidBrush($PAPER)), 0, 0, $W, $H)
$g.FillRectangle((New-Object System.Drawing.SolidBrush($BRICK)), 0, 0, 600, $H)
Draw-Mark $g 300 314 250 $PAPER
Draw-Text $g $INK $INK_SOFT $INK_SOFT $RULE_L
$g.Dispose(); $bmp.Save((Join-Path $OutDir 'og-a-split.png'), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

# --- 變體 2：全紙白底 + 磚紅圖示 ---
$c = New-Canvas; $bmp = $c[0]; $g = $c[1]
$g.FillRectangle((New-Object System.Drawing.SolidBrush($PAPER)), 0, 0, $W, $H)
Draw-Mark $g 322 314 250 $BRICK
$pv = New-Object System.Drawing.Pen([System.Drawing.Color]$RULE_L, [single]2)
$g.DrawLine($pv, 620, 150, 620, 478)
Draw-Text $g $INK $INK_SOFT $INK_SOFT $RULE_L
$g.Dispose(); $bmp.Save((Join-Path $OutDir 'og-b-paper.png'), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

# --- 變體 3：全磚紅底 + 白圖示白字 ---
$c = New-Canvas; $bmp = $c[0]; $g = $c[1]
$g.FillRectangle((New-Object System.Drawing.SolidBrush($BRICK)), 0, 0, $W, $H)
Draw-Mark $g 322 314 250 $PAPER
$pv = New-Object System.Drawing.Pen([System.Drawing.Color]$RULE_D, [single]2)
$g.DrawLine($pv, 620, 150, 620, 478)
Draw-Text $g $PAPER $ON_BRICK $ON_BRICK $RULE_D
$g.Dispose(); $bmp.Save((Join-Path $OutDir 'og-c-brick.png'), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()

Get-ChildItem $OutDir -Filter 'og-*.png' | ForEach-Object {
  "  {0,-18} {1} KB" -f $_.Name, [math]::Round($_.Length / 1KB, 1)
}
"`n輸出 → $OutDir"
