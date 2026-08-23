# 產生「關於醫師」頁的社群分享圖 assets/og-about-portrait.jpg（1200×630）
#
# 用法（在專案根目錄執行）：
#   powershell -ExecutionPolicy Bypass -File tools\make-about-og.ps1
#
# 跟 tools\make-og-image.ps1（站台品牌卡）沿用同一套視覺語彙：
# 同樣 1200×630、同樣的左藍右白、同樣的色票與字級節奏。
# 差別只在重心 —— 品牌卡講「這個站提供什麼」，所以右半列了五行專長；
# 這張講「這是誰」，所以肖像放大、文字砍到剩姓名與職稱。
# 站主的決定：/about/ 被轉貼時要出現本人，不是站台卡。
#
# 這張圖只給 og:image 用，頁面上不顯示（見美編給 PM 的說明）。
#
# 注意：本檔必須以 UTF-8 BOM 儲存。Windows PowerShell 5.1 讀沒有 BOM 的 .ps1
# 會用系統 ANSI 編碼解析，中文會整段壞掉。

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
$cfg = Get-Content (Join-Path $root 'site.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json

# 肖像原始檔放在 source/，這個目錄不會被 build.mjs 複製到網站。
$portraitPath = Join-Path $root 'source\portrait.png'
if (-not (Test-Path $portraitPath)) { throw "找不到肖像檔：$portraitPath" }

$W = 1200
$H = 630
$PANEL = 640      # 左半色塊寬度，比品牌卡的 600 寬一點，讓放大的肖像有餘裕

# 色票與品牌卡完全相同，不另創一套
$PANEL_BLUE = [System.Drawing.ColorTranslator]::FromHtml('#24406F')
$PAPER = [System.Drawing.ColorTranslator]::FromHtml('#fbfcfd')
$INK = [System.Drawing.ColorTranslator]::FromHtml('#191c24')
$INK_SOFT = [System.Drawing.ColorTranslator]::FromHtml('#4d515c')
$INK_FAINT = [System.Drawing.ColorTranslator]::FromHtml('#6b7180')
$RULE = [System.Drawing.ColorTranslator]::FromHtml('#dfe3ea')

# 卡片上的兩行說明文字刻意寫死在這裡，不讀 site.config.json。
# 理由：社群卡的字數是版面的一部分，一行放不下就會破版；而 config 裡的
# authorProfile.jobTitle 是寫給搜尋引擎的欄位，隨時可能加上第二個職稱而變長。
# 姓名與站名短且穩定，仍然從 config 讀。
$LABEL = '關於醫師'
$JOB = '神經內科主治醫師'
$PLACE = '羅東博愛醫院'

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
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$g.FillRectangle([System.Drawing.SolidBrush]::new([System.Drawing.Color]$PAPER), 0, 0, $W, $H)
$g.FillRectangle([System.Drawing.SolidBrush]::new([System.Drawing.Color]$PANEL_BLUE), 0, 0, $PANEL, $H)

# 肖像。去背 PNG 直接疊上色塊，超出色塊的部分裁掉，肩膀出血到底邊。
# 座標來自實際掃描原圖 alpha：頭頂 y=136，頭部水平中心 x=505。
# （品牌卡註解寫的 x=560 是含身體的估計值，這裡改成對齊頭部，
#   肖像放大之後臉才會落在色塊正中央。）
$HEAD_TOP_SRC = 136
$HEAD_CX_SRC = 505
$scale = 0.60      # 品牌卡是 0.50；這張以人為主，放大一階
$headTop = 50      # 頭頂距卡片上緣

$src = [System.Drawing.Image]::FromFile($portraitPath)
$saved = $g.Save()
$g.SetClip((New-Object System.Drawing.Rectangle(0, 0, $PANEL, $H)))
$g.DrawImage($src,
  [int][Math]::Round($PANEL / 2 - $HEAD_CX_SRC * $scale),
  [int][Math]::Round($headTop - $HEAD_TOP_SRC * $scale),
  [int][Math]::Round($src.Width * $scale),
  [int][Math]::Round($src.Height * $scale))
$g.Restore($saved)
$src.Dispose()

# 右半文字。行距與級距沿用品牌卡：姓名 74、次行 52 一階一階往下降。
$centerX = 920
$center = New-Object System.Drawing.StringFormat
$center.Alignment = [System.Drawing.StringAlignment]::Center

$fLabel = New-Object System.Drawing.Font($fontName, 28, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fName = New-Object System.Drawing.Font($fontName, 74, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fJob = New-Object System.Drawing.Font($fontName, 40, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fPlace = New-Object System.Drawing.Font($fontName, 32, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fSite = New-Object System.Drawing.Font($fontName, 28, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$bInk = [System.Drawing.SolidBrush]::new([System.Drawing.Color]$INK)
$bSoft = [System.Drawing.SolidBrush]::new([System.Drawing.Color]$INK_SOFT)
$bFaint = [System.Drawing.SolidBrush]::new([System.Drawing.Color]$INK_FAINT)
$bRule = [System.Drawing.SolidBrush]::new([System.Drawing.Color]$RULE)
$pRule = New-Object System.Drawing.Pen([System.Drawing.Color]$RULE, [single]2)

$L = 700    # 右半文字區左界
$R = 1140   # 右界

$g.DrawString($LABEL, $fLabel, $bFaint, $centerX, 124, $center)
$g.DrawString($cfg.author.Replace(' ', ''), $fName, $bInk, $centerX, 170, $center)
$g.DrawLine($pRule, $L, 278, $R, 278)
$g.DrawString($JOB, $fJob, $bSoft, $centerX, 300, $center)
$g.DrawString($PLACE, $fPlace, $bSoft, $centerX, 356, $center)

# 細分隔線，中間留一個小點（與品牌卡同一個記號）
$g.DrawLine($pRule, $L, 450, 890, 450)
$g.DrawLine($pRule, 950, 450, $R, 450)
$g.FillEllipse($bRule, 915, 445, 10, 10)

$g.DrawString($cfg.title, $fSite, $bFaint, $centerX, 476, $center)

$g.Dispose()

# 存成 JPEG：卡片有一半是照片，PNG 會到 300KB 以上。q88 同品牌卡。
# 從空白 Bitmap 畫起，來源 PNG 的 EXIF 與 XMP（Canva 匯出時夾帶的
# 使用者 ID、品牌 ID、FbId、作者名）不會被帶進輸出檔。
$out = Join-Path $assets 'og-about-portrait.jpg'
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]88)
$bmp.Save($out, $enc, $encParams)
$bmp.Dispose()

$fLabel.Dispose(); $fName.Dispose(); $fJob.Dispose(); $fPlace.Dispose(); $fSite.Dispose()
$bInk.Dispose(); $bSoft.Dispose(); $bFaint.Dispose(); $bRule.Dispose(); $pRule.Dispose(); $center.Dispose()

"og-about-portrait.jpg  ${W}x${H}  $([math]::Round((Get-Item $out).Length / 1KB, 1)) KB"
