# 配色預覽 —— 產生指定品牌色的 favicon 對照表與社群卡
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools\make-color-preview.ps1 <輸出資料夾> <#RRGGBB>
#
# 只輸出到指定資料夾，不會動到 static/。挑定顏色之後再改
# make-favicons.ps1、make-og-image.ps1 與 styles.css 的變數。
#
# 注意：本檔必須以 UTF-8 BOM 儲存（PowerShell 5.1 會用 ANSI 讀無 BOM 的 .ps1）。

param(
  [string]$OutDir,
  # 不可命名為 $Brand：PowerShell 變數不分大小寫，會和下面存 Color 物件的
  # $BRAND 撞成同一個變數，而參數的 [string] 型別約束會把 Color 強制轉成字串。
  [string]$HexColor = '#182A55'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $root 'preview' }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$cfg = Get-Content (Join-Path $root 'site.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json

$BRAND = [System.Drawing.ColorTranslator]::FromHtml($HexColor)
$PAPER = [System.Drawing.ColorTranslator]::FromHtml('#fdfcfa')
$INK = [System.Drawing.ColorTranslator]::FromHtml('#1c1c1e')
$INK_SOFT = [System.Drawing.ColorTranslator]::FromHtml('#44454a')
$RULE_L = [System.Drawing.ColorTranslator]::FromHtml('#d9d4cd')
$font = 'Noto Sans TC'

function Draw-Mark($g, $ox, $oy, $size, $color, $withBg) {
  $s = $size / 32.0
  if ($withBg) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = (7.0 * $s) * 2
    $path.AddArc($ox, $oy, $d, $d, 180, 90)
    $path.AddArc($ox + $size - $d, $oy, $d, $d, 270, 90)
    $path.AddArc($ox + $size - $d, $oy + $size - $d, $d, $d, 0, 90)
    $path.AddArc($ox, $oy + $size - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath(([System.Drawing.SolidBrush]::new([System.Drawing.Color]$BRAND)), $path)
    $path.Dispose()
  }
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]$color, [single](2.9 * $s))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $p = { param($x, $y) New-Object System.Drawing.PointF(($ox + $x * $s), ($oy + $y * $s)) }
  $g.DrawBezier($pen, (& $p 4 6.5), (& $p 7 8), (& $p 9 9.6), (& $p 10.2 11.2))
  $g.DrawBezier($pen, (& $p 28 25.5), (& $p 25 24), (& $p 23 22.4), (& $p 21.8 20.8))
  $br = [System.Drawing.SolidBrush]::new([System.Drawing.Color]$color)
  foreach ($c in @(@(11.4, 12.6), @(20.6, 19.4))) {
    $r = 4.3 * $s
    $g.FillEllipse($br, ($ox + $c[0] * $s - $r), ($oy + $c[1] * $s - $r), ($r * 2), ($r * 2))
  }
  $pen.Dispose(); $br.Dispose()
}

# 以 4 倍繪製再縮小，小尺寸邊緣才不會粗糙
function Render-Icon($size) {
  $ss = 4
  $big = $size * $ss
  $tmp = New-Object System.Drawing.Bitmap($big, $big, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $tg = [System.Drawing.Graphics]::FromImage($tmp)
  $tg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $tg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $tg.Clear([System.Drawing.Color]::Transparent)
  Draw-Mark $tg 0 0 $big $PAPER $true
  $tg.Dispose()
  $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $og = [System.Drawing.Graphics]::FromImage($out)
  $og.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $og.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $og.Clear([System.Drawing.Color]::Transparent)
  $og.DrawImage($tmp, 0, 0, $size, $size)
  $og.Dispose(); $tmp.Dispose()
  return $out
}

# ---------- 1. favicon 尺寸對照表 ----------
$SW = 560; $SH = 430
$sheet = New-Object System.Drawing.Bitmap($SW, $SH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$sg = [System.Drawing.Graphics]::FromImage($sheet)
$sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$sg.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$sg.Clear([System.Drawing.Color]::White)

$fLbl = New-Object System.Drawing.Font($font, 15, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fCap = New-Object System.Drawing.Font($font, 17, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)

$icons = @{}
foreach ($sz in @(128, 64, 32, 16)) { $icons[$sz] = Render-Icon $sz }

$rows = @(
  @{ y = 40;  bg = [System.Drawing.ColorTranslator]::FromHtml('#f2f0ec'); fg = [System.Drawing.ColorTranslator]::FromHtml('#4a4a50'); label = '淺色分頁' },
  @{ y = 240; bg = [System.Drawing.ColorTranslator]::FromHtml('#26262b'); fg = [System.Drawing.ColorTranslator]::FromHtml('#c8c6c2'); label = '深色分頁' }
)

$sg.DrawString("$HexColor  favicon 實際尺寸對照", $fCap, ([System.Drawing.SolidBrush]::new([System.Drawing.Color]$INK)), 24, 12)

foreach ($r in $rows) {
  $sg.FillRectangle(([System.Drawing.SolidBrush]::new([System.Drawing.Color]$r.bg)), 24, $r.y, $SW - 48, 170)
  $sg.DrawString($r.label, $fLbl, ([System.Drawing.SolidBrush]::new([System.Drawing.Color]$r.fg)), 36, $r.y + 8)
  $x = 44
  foreach ($sz in @(128, 64, 32, 16)) {
    $cy = $r.y + 46 + (128 - $sz) / 2
    $sg.DrawImage($icons[$sz], $x, $cy, $sz, $sz)
    $sg.DrawString("$sz", $fLbl, ([System.Drawing.SolidBrush]::new([System.Drawing.Color]$r.fg)), ($x + $sz / 2 - 10), ($r.y + 186 - 40))
    $x += $sz + 40
  }
}
$sg.Dispose()
$sheet.Save((Join-Path $OutDir 'favicon-color-sheet.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose()
foreach ($k in $icons.Keys) { $icons[$k].Dispose() }

# ---------- 2. A1 社群卡（換色） ----------
$PORTRAIT = 'C:\MyProjects\個人肖像照.png'
$W = 1200; $H = 628; $PANEL = 600
$items = @($cfg.specialties)
$lines = @()
for ($i = 0; $i -lt $items.Count; $i += 2) {
  if ($i + 1 -lt $items.Count) { $lines += "$($items[$i]) | $($items[$i+1])" } else { $lines += $items[$i] }
}

$src = [System.Drawing.Image]::FromFile($PORTRAIT)
$card = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($card)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$g.FillRectangle(([System.Drawing.SolidBrush]::new([System.Drawing.Color]$PAPER)), 0, 0, $W, $H)
$g.FillRectangle(([System.Drawing.SolidBrush]::new([System.Drawing.Color]$BRAND)), 0, 0, $PANEL, $H)

$clip = $g.Save()
$g.SetClip((New-Object System.Drawing.Rectangle(0, 0, $PANEL, $H)))
$scale = 0.50
$g.DrawImage($src, [int]($PANEL / 2 - 560 * $scale), [int](60 - 145 * $scale),
  [int]($src.Width * $scale), [int]($src.Height * $scale))
$g.Restore($clip)

$centerX = 918
$center = New-Object System.Drawing.StringFormat
$center.Alignment = [System.Drawing.StringAlignment]::Center
$fName = New-Object System.Drawing.Font($font, 74, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fSub = New-Object System.Drawing.Font($font, 52, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fLine = New-Object System.Drawing.Font($font, 30, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$pRule = New-Object System.Drawing.Pen([System.Drawing.Color]$RULE_L, [single]2)
$g.DrawString($cfg.author.Replace(' ', ''), $fName, ([System.Drawing.SolidBrush]::new([System.Drawing.Color]$INK)), $centerX, 78, $center)
$g.DrawLine($pRule, 700, 186, 1136, 186)
$g.DrawString($cfg.authorTitle, $fSub, ([System.Drawing.SolidBrush]::new([System.Drawing.Color]$INK_SOFT)), $centerX, 208, $center)
$g.DrawLine($pRule, 700, 300, 890, 300)
$g.DrawLine($pRule, 946, 300, 1136, 300)
$g.FillEllipse(([System.Drawing.SolidBrush]::new([System.Drawing.Color]$RULE_L)), 913, 295, 10, 10)
$y = 336
foreach ($l in $lines) { $g.DrawString($l, $fLine, ([System.Drawing.SolidBrush]::new([System.Drawing.Color]$INK_SOFT)), 702, $y); $y += 46 }
$g.Dispose()

$card.Save((Join-Path $OutDir 'og-a1-recolored.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$card.Dispose(); $src.Dispose()

Get-ChildItem $OutDir -Include 'favicon-color-sheet.png', 'og-a1-recolored.png' -Recurse | ForEach-Object {
  "  {0,-26} {1} KB" -f $_.Name, [math]::Round($_.Length / 1KB, 1)
}
"`n品牌色 $HexColor  →  $OutDir"
