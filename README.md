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
- **最後更新** — 自動判斷，不需要手動維護：
  - 檔案已提交且沒有改動 → 取最後一次 commit 的時間
  - 檔案有還沒提交的修改，或是新檔案 → 取檔案的修改時間

首頁卡片依「最後更新」由新到舊排序；更新時間相同時（例如同一個 commit 裡改了好幾篇），
再用發布日期分先後。

若只顯示一個日期，代表那篇從發布後沒有再改過。

---

## 專案結構

```
blog/
├─ content/posts/        文章原始檔（.md）← 平常只會動這裡
├─ src/
│  ├─ styles.css         樣式
│  └─ counter.js         Supabase 瀏覽計數器
├─ assets/               圖片
├─ static/               會原樣複製到網站根目錄（放 CNAME、favicon 等）
├─ docs/                 ← 建置產物，發布的就是這個目錄。不要手動編輯。
├─ build.mjs             靜態產生器
├─ serve.mjs             本機預覽伺服器
├─ site.config.json      站台設定（標題、作者、Hero 圖、Supabase 金鑰）
└─ supabase-setup.sql    計數器的資料庫設定
```

`docs/` 是建置產物，但**要**進版控 —— GitHub Pages 和 Cloudflare Pages 都直接發布它。

---

## Hero 圖片與授權

首頁與每篇文章上方的圖片來自 Wikimedia Commons，依 CC BY 4.0 授權使用。
授權要求的姓名標示（作品名、作者、來源連結、授權條款、改作聲明）自動產生在每一頁的頁尾。

**要換圖的話**，改 `site.config.json` 的 `hero` 區塊，把 `credit` 底下的欄位一併換成新圖的資訊。
少填會導致標示不完整，那是違反授權條款的。

單篇文章想用不同的圖，在 front matter 加：

```markdown
hero: assets/your-image.jpg
heroWidth: 1600
heroHeight: 1200
heroAlt: 給視障讀者與搜尋引擎看的圖片描述
heroCaption: 圖說
heroCreditTitle: 原作品名稱
heroCreditTitleUrl: https://原始頁面
heroCreditAuthor: 作者名
heroCreditLicense: CC BY 4.0
heroCreditLicenseUrl: https://creativecommons.org/licenses/by/4.0/
heroCreditModification: 已重新裁切
```

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

**絕對不要**把 `service_role` key 放進來 —— 那把鑰匙可以繞過所有權限檢查。

沒填 Supabase 設定時，計數欄位會自動隱藏，網站其他部分照常運作。

---

## 部署

推到 GitHub 之後由 Cloudflare Pages 自動建置發布。
`docs/` 已經是成品，Cloudflare 那邊不需要跑任何建置指令。
