# 頭痛之外｜吳旻陽醫師

神經內科醫師吳旻陽的個人部落格。純靜態網站，零相依套件，只需要 Node.js。

---

## 日常操作：新增一篇文章

### 1. 建立檔案

在 `content/posts/` 裡新增一個 `.md` 檔，檔名格式是 `YYYY-MM-DD-英文短名.md`。
那個英文短名會變成網址，例如 `2026-08-15-sleep-and-headache.md` → `/posts/sleep-and-headache/`。

### 2. 寫上開頭資訊

檔案最前面用三個連字號夾住的區塊是設定，不會顯示在文章裡：

```markdown
---
title: 睡眠與頭痛的雙向關係
date: 2026-08-15
summary: >
  睡不好會頭痛，頭痛也會讓人睡不好。這個循環要從哪一端切入？
tags: [頭痛, 睡眠]
---

這裡開始寫正文……
```

| 欄位 | 必填 | 說明 |
|---|---|---|
| `title` | 是 | 文章標題 |
| `date` | 否 | 發布日期，省略則用檔名的日期 |
| `updated` | 否 | 內容實質更新的日期，格式 `YYYY-MM-DD`；不填代表沒改過 |
| `summary` | 否 | 首頁卡片上的摘要 |
| `author` | 否 | 省略則用 `site.config.json` 裡的作者 |
| `tags` | 否 | 例如 `[頭痛, 睡眠]` |
| `slug` | 否 | 自訂網址，省略則用檔名 |
| `draft` | 否 | 設成 `true` 就不會被發布 |

正文可用的格式，看 `content/posts/2026-07-28-formatting-reference.md`，那篇就是速查表。

### 3. 建置

```bash
node build.mjs
```

首頁的卡片、日期、排序會全部自動重算。**不需要手動去改首頁**。

### 4. 本機預覽（可略過）

```bash
node serve.mjs
```

然後開 http://localhost:4321

### 5. 發布

```bash
git add -A
git commit -m "新增文章：睡眠與頭痛"
git push
```

推上去之後 Cloudflare Pages 會自動重新部署，大約一到兩分鐘。

---

## 日期是怎麼決定的

- **發布日期** — 來自 front matter 的 `date`，或檔名前面的日期。
- **更新日期** — 來自 front matter 的選用欄位 `updated`，格式 `YYYY-MM-DD`。
  **不填就等於發布日**，站上不會出現「更新」字樣。

```markdown
---
title: 睡眠與頭痛的雙向關係
date: 2026-08-15
updated: 2026-09-02
---
```

日期不從 git commit 時間或檔案的修改時間推導。改一個錯字、調一下排版、
甚至重新建置，都不該讓文章看起來像是「更新過」⸺ 要不要標更新是編輯決定，
所以用手填。

**什麼時候該填 `updated`：**

| 情況 | 填嗎 |
|---|---|
| 補上新的段落、改掉過時的說法、修正說錯的內容 | 填 |
| 換了結論、加了重要的但書 | 填 |
| 錯字、標點、空格 | 不填 |
| 純排版調整、換圖、改標題大小 | 不填 |

填了不合法的日期，或填的日期早於 `date`，建置時會 warn 並當作沒填 ⸺
訊息會指出是哪個檔案。

首頁卡片依「更新日期」由新到舊排序；日期打平時（沒填 `updated` 的文章
其更新日期等於發布日）再用發布日期分先後。

若只顯示一個日期，代表那篇從發布後沒有再實質改過。

---

## 專案結構

```
blog/
├─ content/posts/        文章原始檔（.md）← 平常只會動這裡
├─ src/
│  ├─ styles.css         樣式
│  └─ counter.js         Supabase 瀏覽計數器
├─ assets/               文章與 Hero 圖片
├─ static/               會原樣複製到網站根目錄（網站圖示、_redirects 等）
├─ tools/                圖示產生器（平常不會動到）
├─ docs/                 ← 建置產物，發布的就是這個目錄。不要手動編輯。
├─ build.mjs             靜態產生器
├─ serve.mjs             本機預覽伺服器
├─ site.config.json      站台設定（標題、作者、Hero 圖、Supabase 金鑰）
└─ supabase-setup.sql    計數器的資料庫設定
```

`docs/` 是建置產物，但**要**進版控 ⸺ GitHub Pages 和 Cloudflare Pages 都直接發布它。

---

## 網站圖示（favicon）

圖案是一個突觸：兩個神經終末隔著間隙相對。檔案都在 `static/`，建置時會複製到網站根目錄。

| 檔案 | 用途 |
|---|---|
| `favicon.ico` | 瀏覽器不管 HTML 寫什麼，都會自己去要這個檔。沒有就是每次吃一個 404 |
| `favicon.svg` | 較新的瀏覽器優先採用，任何尺寸都不會糊 |
| `favicon-16.png` / `favicon-32.png` | 舊瀏覽器的分頁圖示 |
| `apple-touch-icon.png` | iOS 加到主畫面。刻意做成滿版方形，圓角由 iOS 自己切 |
| `icon-192.png` / `icon-512.png` | Android 與 PWA，由 `site.webmanifest` 指定 |

**要改設計的話**，改 `tools/make-favicons.ps1` 裡的 `Draw-Icon` 函式，然後：

```bash
powershell -ExecutionPolicy Bypass -File tools/make-favicons.ps1
node tools/make-ico.mjs
node build.mjs
```

`favicon.svg` 要另外手動改成一致的圖案 ⸺ 它跟 PNG 是兩套獨立的畫法（一個是
SVG 路徑，一個是 GDI+ 繪圖），改了其中一邊記得同步另一邊，否則會出現
分頁圖示和主畫面圖示長得不一樣的情形。

> `make-favicons.ps1` 存檔時必須帶 UTF-8 BOM。Windows PowerShell 5.1 讀沒有 BOM 的
> `.ps1` 會用系統的 ANSI 編碼（繁中系統是 CP950）解析，中文註解會被誤讀，
> 導致註解沒有正確結束、吃掉後面的程式碼，錯誤訊息還會指到錯的行號。

---

## 社群分享預覽圖（og:image）

連結被貼到 LINE、Facebook、Threads 時展開的那張縮圖，**刻意與頁面 Hero 分開**。

規則寫在 `build.mjs` 的 `headMeta()`：

- 文章自己在 front matter 指定了 `hero:` → 社群預覽就用那張
- 沒有指定 → 用 `site.config.json` 的 `social.src`（品牌卡），**不會**退回首頁 Hero

會這樣設計，是因為首頁 Hero 是診間照、畫面裡有病人。頁面上看到那張圖，
和連結被轉貼時自動展開一張縮圖，是兩種量級的傳播 ⸺ 後者還會被各平台快取，
事後撤掉也收不回來。

品牌卡由 `tools/make-og-image.ps1` 產生（1200×630，社群平台的標準比例）：

```bash
powershell -ExecutionPolicy Bypass -File tools/make-og-image.ps1
node build.mjs
```

站名與作者從 `site.config.json` 讀取，改站名不必動腳本。

> 這支腳本同樣必須帶 UTF-8 BOM，原因與 `make-favicons.ps1` 相同。
>
> 另外，卡片上的突觸圖示是直接畫的，不是貼 `icon-512.png`。貼圖的話，
> 那張圖的圓角有半透明邊緣，GDI+ 以 8 位元合成會產生 1～2 階的捨入誤差；
> 單一像素看不出來，但誤差沿著圓角連成一圈，會看到一個淺色方框浮在卡片上。

---

## Hero 圖片與版權

首頁與每篇文章上方的圖片，版權資訊自動產生在每一頁的頁尾，由 `site.config.json`
的 `hero.credit` 決定。頁尾區塊有兩種模式：

- **`license` 有填** → 視為外部授權作品，會輸出「作品名、作者、依 X 授權使用」，
  也就是 CC 系列授權要求的姓名標示（TASL）。少填欄位等於標示不完整，那是違反授權條款的。
- **`license` 留空** → 視為自有作品，輸出「作品名，作者攝」，不會出現對自己拍的照片
  講不通的「依 X 授權使用」。

目前用的是自有照片，所以 `license` 是空的。

**換圖時記得**：`credit` 底下的欄位要跟著換。留著上一張圖的資訊，網站上就會掛著一段
指向不存在圖片的錯誤說明。

**照片裡有病人的話**，發布前確認已取得公開上網等級的同意 ⸺ 口罩擋不住耳型、耳環、
下顎線、髮型這些識別特徵。另外手機拍的照片 EXIF 會夾帶拍攝時間、機型，有時還有 GPS，
處理圖片時要一併清掉。

單篇文章想用不同的圖，在 front matter 加：

```markdown
hero: assets/your-image.jpg
heroWidth: 1200
heroHeight: 1600
heroAlt: 給視障讀者與搜尋引擎看的圖片描述
heroCaption: 圖說
heroCreditHeading: 圖片版權
heroCreditTitle: 作品名稱
heroCreditTitleUrl: https://原始頁面（自有作品留空）
heroCreditAuthor: 作者名
heroCreditLicense: CC BY 4.0（自有作品留空）
heroCreditLicenseUrl: https://creativecommons.org/licenses/by/4.0/
heroCreditNote: 補充說明，例如改作聲明或版權宣告
```

直式照片不必擔心版面 ⸺ 樣式除了限制寬度不超過內容文字區，還加了 `max-height: 72vh`，
瀏覽器會等比例縮小，不會裁切也不會變形。

---

## 瀏覽計數器

用 Supabase 存數字。每篇文章一個獨立計數，首頁自己也有一個。
首頁卡片上的數字由同一次查詢一併填入。

設定方式：

1. 到 [supabase.com](https://supabase.com) 建立一個專案
2. SQL Editor → 貼上 `supabase-setup.sql` → Run
3. Project Settings → API，把 Project URL 和 `anon` `public` key 填進 `site.config.json`
4. `node build.mjs` 重新建置

`anon` key 是設計成公開放在前端的，出現在原始碼裡沒問題。
資料表有 RLS 保護，訪客只能讀取數字，加一只能透過 `increment_view` 函式，
沒辦法把數字改成任意值。

**絕對不要**把 `service_role` key 放進來 ⸺ 那把鑰匙可以繞過所有權限檢查。

沒填 Supabase 設定時，計數欄位會自動隱藏，網站其他部分照常運作。

---

## 部署

推到 GitHub 之後由 Cloudflare Pages 自動建置發布。
`docs/` 已經是成品，Cloudflare 那邊不需要跑任何建置指令。
