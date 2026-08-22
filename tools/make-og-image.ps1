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

# 門診專長，與首頁的清單同一份資料。
#
# ── 依賴的 site.config.json 結構（改 config 前請先讀這段）──────────────
#
#   "specialties": [ { "group": "組名", "items": ["項目", "項目", ...] }, ... ]
#
# 也就是「物件陣列」，不是扁平字串陣列。build.mjs 的 specialtyBlock()
# 讀的是同一份資料、同一個形狀，兩邊要一起改。
#
# 這裡曾經壞過一次：config 從扁平字串陣列改成分組物件之後，這支腳本還在
# 對元素做字串內插，於是品牌卡上印出 "@{group=頭痛與偏頭痛; items=System.Object[]}"。
# 而且是「靜靜地壞」⸺ 腳本不會報錯，要等到有人真的去看圖才發現。
# 所以下面改成明確驗證形狀，對不上就 throw，寧可整支停掉也不要產出壞圖。
#
# 排版採用與首頁 specialtyBlock() 一致的「組名：項目、項目」，右半的寬度
# 放不下就自動折行（見後面的 Get-WrappedLines）⸺ 項目數量再變也不會爆版。
$groups = @()
foreach ($g0 in @($cfg.specialties)) {
  if ($null -eq $g0.PSObject.Properties['group'] -or $null -eq $g0.PSObject.Properties['items']) {
    throw "site.config.json 的 specialties 不是 [{group, items}] 的形狀，請同步更新本腳本（見上方註解）"
  }
  $name = "$($g0.group)".Trim()
  $its = @(@($g0.items) | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
  if (-not $name -or $its.Count -eq 0) { continue }
  # 拆成「不可拆的排版單位」：組名帶著冒號、每個項目帶著後面的頓號。
  # 折行只會發生在單位之間，所以不會出現「肉毒桿菌、單 / 株抗體」
  # 這種把一個專有名詞從中間切開的斷法。
  $tokens = @("${name}：")
  for ($i = 0; $i -lt $its.Count; $i++) {
    $tokens += if ($i -lt $its.Count - 1) { "$($its[$i])、" } else { $its[$i] }
  }
  $groups += , $tokens
}
if ($groups.Count -eq 0) { throw 'site.config.json 讀不出任何門診專長' }

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

# 專長清單。右半的可用寬度是從 x=702 到右邊界 1136，與上面兩條分隔線對齊。
# 中文沒有空格可以斷行，所以改用前面切好的排版單位逐一量測、放不下就折。
# 續行縮排一點，讓人看得出來它還屬於上一組。
$LIST_X = 702
$LIST_W = 1136 - $LIST_X
$LIST_INDENT = 28

# 把一組排版單位貪婪地塞成幾行。單一單位就超寬的話讓它自己佔一行、
# 由畫布去裁 ⸺ 那代表 config 裡出現了異常長的項目名，不是這裡該補救的事。
function Get-WrappedLines($tokens, $font, $graphics, $firstWidth, $restWidth) {
  $out = @()
  $cur = ''
  $limit = $firstWidth
  foreach ($tk in $tokens) {
    $try = $cur + $tk
    if ($cur -and $graphics.MeasureString($try, $font).Width -gt $limit) {
      $out += $cur
      $cur = $tk
      $limit = $restWidth
    } else {
      $cur = $try
    }
  }
  if ($cur) { $out += $cur }
  return $out
}

$y = 336
foreach ($grp in $groups) {
  $wrapped = Get-WrappedLines $grp $fLine $g $LIST_W ($LIST_W - $LIST_INDENT)
  for ($i = 0; $i -lt $wrapped.Count; $i++) {
    $x = if ($i -eq 0) { $LIST_X } else { $LIST_X + $LIST_INDENT }
    $g.DrawString($wrapped[$i], $fLine, $bSoft, $x, $y)
    $y += 46
  }
}
# 畫布是固定 630 高，超出去的行會被默默裁掉 ⸺ 那正是上一次沒被發現的那種錯誤，
# 所以這裡明講。要修就是減少項目，或把 $fLine 調小。
if ($y -gt $H) {
  Write-Warning "專長清單超出畫布下緣（畫到 y=$y，畫布高 $H），底部的行會被裁掉"
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
