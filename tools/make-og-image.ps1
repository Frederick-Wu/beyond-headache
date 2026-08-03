# 產生社群分享預覽圖 static/og-image.png（1200×630）
#
# 用法（在專案根目錄執行）：
#   powershell -ExecutionPolicy Bypass -File tools\make-og-image.ps1
#
# 這張圖只在別人把網站連結貼到 LINE、Facebook、Threads 時出現，
# 網站本身看不到它。刻意跟首頁 Hero 分開，是為了讓轉貼預覽不帶病人影像。
#
# 標題與作者從 site.config.json 讀取，不寫死，改站名時不會忘了同步。
# 中央的圖示直接載入 static/icon-512.png，保證跟 favicon 是同一個圖案；
# 該圖的底色與這張卡片相同，透明圓角疊上去看不出接縫。
#
# 注意：本檔必須以 UTF-8 BOM 儲存。Windows PowerShell 5.1 讀沒有 BOM 的 .ps1
# 會用系統 ANSI 編碼解析，中文會整段壞掉。

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$static = Join-Path $root 'static'
$cfg = Get-Content (Join-Path $root 'site.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json

$W = 1200
$H = 630
$BG = [System.Drawing.ColorTranslator]::FromHtml('#7b3f3f')
$FG = [System.Drawing.ColorTranslator]::FromHtml('#fdfcfa')
$MUTED = [System.Drawing.ColorTranslator]::FromHtml('#e2b9b9')

# 找一個系統上真的存在的中文字型，避免落到預設字型變成方框
$fontName = @('Noto Sans TC', 'Microsoft JhengHei UI', 'Microsoft JhengHei', 'PMingLiU') |
  Where-Object {
    $f = New-Object System.Drawing.FontFamily($_) -ErrorAction SilentlyContinue
    if ($f) { $f.Dispose(); $true } else { $false }
  } | Select-Object -First 1
if (-not $fontName) { throw '找不到可用的中文字型' }
"使用字型：$fontName"

$bmp = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# 底色
$bgBrush = New-Object System.Drawing.SolidBrush($BG)
$g.FillRectangle($bgBrush, 0, 0, $W, $H)

# 突觸圖示
#
# 這裡直接畫，不是貼 icon-512.png。貼圖的話，那張圖的圓角有半透明邊緣，
# GDI+ 以 8 位元做 alpha 合成會產生 1～2 階的捨入誤差；單一像素看不出來，
# 但誤差沿著圓角連成一圈，肉眼會看到一個淺色方框浮在卡片上。
#
# 座標與 favicon 同一組（32 單位基準）。改圖案時記得三個地方要一起改：
# favicon.svg、make-favicons.ps1、這裡。
$markSize = 136
$mx = 88
$my = 104
$ms = $markSize / 32.0

$markPen = New-Object System.Drawing.Pen([System.Drawing.Color]$FG, [single](2.9 * $ms))
$markPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$markPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$mp = { param($x, $y) New-Object System.Drawing.PointF(($mx + $x * $ms), ($my + $y * $ms)) }

$g.DrawBezier($markPen, (& $mp 4 6.5),   (& $mp 7 8),   (& $mp 9 9.6),    (& $mp 10.2 11.2))
$g.DrawBezier($markPen, (& $mp 28 25.5), (& $mp 25 24), (& $mp 23 22.4),  (& $mp 21.8 20.8))

$markBrush = New-Object System.Drawing.SolidBrush($FG)
foreach ($c in @(@(11.4, 12.6), @(20.6, 19.4))) {
  $r = 4.3 * $ms
  $g.FillEllipse($markBrush, ($mx + $c[0] * $ms - $r), ($my + $c[1] * $ms - $r), ($r * 2), ($r * 2))
}
$markPen.Dispose(); $markBrush.Dispose()

# 站名
$titleFont = New-Object System.Drawing.Font($fontName, 76, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fgBrush = New-Object System.Drawing.SolidBrush($FG)
$g.DrawString($cfg.title, $titleFont, $fgBrush, 84, 288)

# 分隔短線
$rulePen = New-Object System.Drawing.Pen([System.Drawing.Color]$MUTED, [single]3)
$g.DrawLine($rulePen, 92, 412, 172, 412)

# 作者與科別
$bylineFont = New-Object System.Drawing.Font($fontName, 34, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$mutedBrush = New-Object System.Drawing.SolidBrush($MUTED)
$g.DrawString("$($cfg.author)・$($cfg.authorTitle)", $bylineFont, $mutedBrush, 84, 446)

$g.Dispose()

$out = Join-Path $static 'og-image.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$titleFont.Dispose(); $bylineFont.Dispose()
$bgBrush.Dispose(); $fgBrush.Dispose(); $mutedBrush.Dispose(); $rulePen.Dispose()

"og-image.png  ${W}x${H}  $([math]::Round((Get-Item $out).Length / 1KB, 1)) KB"
