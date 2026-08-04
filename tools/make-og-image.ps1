# 產生社群分享預覽圖 static/og-image.png（1200×630）
#
# 用法（在專案根目錄執行）：
#   powershell -ExecutionPolicy Bypass -File tools\make-og-image.ps1
#
# 這張圖只在別人把網站連結貼到 LINE、Facebook、Threads 時出現，網站本身看不到它。
# 刻意跟首頁 Hero 分開：Hero 是診間照，畫面裡有病人，而轉貼預覽的傳播範圍
# 遠大於網站本身，還會被各平台快取、撤不回來。
#
# 版面：左半色塊放去背肖像，右半白底放姓名、科別與門診專長。
# 文字全部從 site.config.json 讀取，改設定就會跟著變。
#
# 注意：本檔必須以 UTF-8 BOM 儲存。Windows PowerShell 5.1 讀沒有 BOM 的 .ps1
# 會用系統 ANSI 編碼解析，中文會整段壞掉。

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$static = Join-Path $root 'static'
$cfg = Get-Content (Join-Path $root 'site.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json

# 肖像原始檔放在 source/，這個目錄不會被 build.mjs 複製到網站，
# 訪客不必為了一張只在建置時用到的 1.2MB 大圖付流量。
$portraitPath = Join-Path $root 'source\portrait.png'
if (-not (Test-Path $portraitPath)) { throw "找不到肖像檔：$portraitPath" }

$W = 1200
$H = 630
$PANEL = 600      # 左半色塊寬度

# 色塊用的藍比品牌色 #182A55 淺一階 —— 同樣的深藍鋪滿 600x630
# 會過於沉重，這個亮度在動態牆上仍然夠跳，但不壓迫。
$PANEL_BLUE = [System.Drawing.ColorTranslator]::FromHtml('#24406F')
$PAPER = [System.Drawing.ColorTranslator]::FromHtml('#fbfcfd')
$INK = [System.Drawing.ColorTranslator]::FromHtml('#191c24')
$INK_SOFT = [System.Drawing.ColorTranslator]::FromHtml('#4d515c')
$RULE = [System.Drawing.ColorTranslator]::FromHtml('#dfe3ea')

$fontName = @('Noto Sans TC', 'Microsoft JhengHei UI', 'Microsoft JhengHei', 'PMingLiU') |
  Where-Object {
    $f = New-Object System.Drawing.FontFamily($_) -ErrorAction SilentlyContinue
    if ($f) { $f.Dispose(); $true } else { $false }
  } | Select-Object -First 1
if (-not $fontName) { throw '找不到可用的中文字型' }
"使用字型：$fontName"

# 專長兩兩一組排成五行，與首頁的清單同一份資料
$items = @($cfg.specialties)
$lines = @()
for ($i = 0; $i -lt $items.Count; $i += 2) {
  if ($i + 1 -lt $items.Count) { $lines += "$($items[$i]) | $($items[$i+1])" }
  else { $lines += $items[$i] }
}

$bmp = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$g.FillRectangle([System.Drawing.SolidBrush]::new([System.Drawing.Color]$PAPER), 0, 0, $W, $H)
$g.FillRectangle([System.Drawing.SolidBrush]::new([System.Drawing.Color]$PANEL_BLUE), 0, 0, $PANEL, $H)

# 肖像。去背 PNG 直接疊上色塊，不會有照片的方形邊界。
# 超出色塊的部分裁掉，肩膀自然出血到底邊。
# 原圖中頭頂約在 y=145、人物水平中心約在 x=560。
$src = [System.Drawing.Image]::FromFile($portraitPath)
$scale = 0.50
$headTop = 60
$saved = $g.Save()
$g.SetClip((New-Object System.Drawing.Rectangle(0, 0, $PANEL, $H)))
$g.DrawImage($src,
  [int][Math]::Round($PANEL / 2 - 560 * $scale),
  [int][Math]::Round($headTop - 145 * $scale),
  [int][Math]::Round($src.Width * $scale),
  [int][Math]::Round($src.Height * $scale))
$g.Restore($saved)
$src.Dispose()

# 右半文字
$centerX = 918
$center = New-Object System.Drawing.StringFormat
$center.Alignment = [System.Drawing.StringAlignment]::Center

$fName = New-Object System.Drawing.Font($fontName, 74, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fSub = New-Object System.Drawing.Font($fontName, 52, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fLine = New-Object System.Drawing.Font($fontName, 30, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$bInk = [System.Drawing.SolidBrush]::new([System.Drawing.Color]$INK)
$bSoft = [System.Drawing.SolidBrush]::new([System.Drawing.Color]$INK_SOFT)
$bRule = [System.Drawing.SolidBrush]::new([System.Drawing.Color]$RULE)
$pRule = New-Object System.Drawing.Pen([System.Drawing.Color]$RULE, [single]2)

$g.DrawString($cfg.author.Replace(' ', ''), $fName, $bInk, $centerX, 78, $center)
$g.DrawLine($pRule, 700, 186, 1136, 186)
$g.DrawString($cfg.authorTitle, $fSub, $bSoft, $centerX, 208, $center)

# 細分隔線，中間留一個小點
$g.DrawLine($pRule, 700, 300, 890, 300)
$g.DrawLine($pRule, 946, 300, 1136, 300)
$g.FillEllipse($bRule, 913, 295, 10, 10)

$y = 336
foreach ($l in $lines) {
  $g.DrawString($l, $fLine, $bSoft, 702, $y)
  $y += 46
}

$g.Dispose()

# 存成 JPEG 而非 PNG：卡片有一半是照片，PNG 會到 300KB 以上。
# q88 是取捨點 —— 再低會在文字邊緣出現振鈴，再高就沒省到。
$out = Join-Path $static 'og-image.jpg'
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]88)
$bmp.Save($out, $enc, $encParams)
$bmp.Dispose()

# 舊的 PNG 版本若還在就清掉，免得兩個檔案並存造成混淆
$oldPng = Join-Path $static 'og-image.png'
if (Test-Path $oldPng) { Remove-Item $oldPng -Force }
$fName.Dispose(); $fSub.Dispose(); $fLine.Dispose()
$bInk.Dispose(); $bSoft.Dispose(); $bRule.Dispose(); $pRule.Dispose(); $center.Dispose()

"og-image.jpg  ${W}x${H}  $([math]::Round((Get-Item $out).Length / 1KB, 1)) KB"
