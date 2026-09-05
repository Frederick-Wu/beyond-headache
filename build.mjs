#!/usr/bin/env node
/**
 * 「頭痛之外」靜態網站產生器
 *
 * 用法：  node build.mjs
 *
 * 零相依套件，只需要 Node.js。不必 npm install。
 *
 * 產生的檔案全部進 docs/，那也是 GitHub Pages 與 Cloudflare Pages 的發布目錄。
 *
 * 幾個刻意的設計：
 *  - 首頁的文章卡片是「建置時」寫死進 index.html 的靜態 HTML，
 *    不是前端讀 JSON 再生出來。爬蟲、無 JS 環境、分享預覽都能正確看到。
 *  - 「最後更新」取自 git：若檔案已提交且無異動，用最後一次 commit 時間；
 *    若有未提交的修改，用檔案系統的 mtime。所以改完文章不必手動改日期。
 *  - 卡片依「最後更新」由新到舊排序。
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * 靜態資源的內容指紋。
 *
 * Cloudflare 給 styles.css 與那兩支 js 的是 max-age=14400（四小時），而 HTML
 * 是 max-age=0。所以改版之後回訪的讀者會拿到「新的 HTML 配舊的 CSS」，最長
 * 四小時 ⸺ 站主 2026-08-31 用手機看到門診時段表的時間排版跑掉，就是這個，
 * 不是他手機的問題，也不是那次的 CSS 有錯（同一時間用桌機開無痕是好的）。
 *
 * 檔名維持 styles.css，只在引用時加 ?v=雜湊。查詢字串一樣進 Cloudflare 的
 * 快取鍵，所以內容一改，網址就變，舊快取自然失效；檔名不變則 docs/ 的結構
 * 與 _redirects 都不必動。
 *
 * 取 8 碼就夠：這是防快取碰撞，不是防竄改。
 */
const assetHash = (rel) =>
  createHash("sha256")
    .update(readFileSync(join(ROOT, rel)))
    .digest("hex")
    .slice(0, 8);

const ASSET_HASH = {
  styles: assetHash(join("src", "styles.css")),
  counter: assetHash(join("src", "counter.js")),
  enhance: assetHash(join("src", "enhance.js")),
};
const POSTS_DIR = join(ROOT, "content", "posts");
const PAGES_DIR = join(ROOT, "content", "pages");
const OUT_DIR = join(ROOT, "docs");
const CFG = JSON.parse(readFileSync(join(ROOT, "site.config.json"), "utf8"));

/* =======================================================================
 * 工具
 * ===================================================================== */

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** 反轉 esc() 對 URL 造成的實體編碼，方便做協定檢查 */
const unesc = (s) =>
  String(s)
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");

/** 只放行安全的連結協定，擋掉 javascript: 之類 */
function safeUrl(raw) {
  const u = String(raw ?? "").trim();
  if (!u) return "#";
  if (/^(https?:\/\/|mailto:|tel:|#|\/|\.{1,2}\/)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return "#"; // 其他協定一律擋
  return u; // 相對路徑
}

const CJK = /[⺀-鿿豈-﫿＀-￯]/;

/**
 * 全形字（中日韓文字、假名、全形標點）。
 *
 * 刻意不含 U+2E00–U+2E7F 的補充標點 ⸺ 站上的破字號 ⸺（U+2E3A）就在那一段，
 * 而站主的排版規則是它前後各要一個半形空格。把它算成全形會讓折行剛好斷在
 * 它旁邊時空格被吃掉。
 */
const WIDE_CHAR =
  /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFF60\uFFE0-\uFFE6]/;

/**
 * YAML 折疊純量（>）的接合。
 *
 * YAML 的規則是「換行變成一個空格」，那是為了英文 ⸺ 英文的詞之間本來就
 * 要空格。中文不要：summary 寫成三行只是為了原始碼好讀，接起來卻會在每個
 * 折行處多一個半形空格，然後外溢到 meta description、og:description、
 * RSS 的 <description> 與首頁卡片摘要，變成「…失智症）。 另外還有…」。
 *
 * 所以只在「兩邊都是全形字」時不補空格。其餘照舊補 ⸺ 中文接英數、
 * 英數接中文都要那個空格（那正是站主的排版規則第一條），英文接英文
 * 更不能少，否則會黏成一個詞。
 */
function foldLines(buf) {
  return buf.reduce((acc, line) => {
    if (!acc) return line;
    const prev = acc[acc.length - 1];
    const next = line[0];
    const glue = WIDE_CHAR.test(prev) && WIDE_CHAR.test(next) ? "" : " ";
    return acc + glue + line;
  }, "");
}

/** slug 化：保留中日韓字元與英數，其餘轉連字號 */
function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{Letter}\p{Number}-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/* =======================================================================
 * 圖片尺寸（零相依，直接讀檔頭）
 * ===================================================================== */

/**
 * 目前正在處理哪一個原始檔。只給警告訊息用 ⸺ 少了這個，
 * 「圖片讀不到尺寸」的警告會不知道要去哪一篇找。
 */
let CURRENT_SOURCE = "";

/** 同一張圖在文章裡可能出現多次，也可能跨檔案共用。量過就記住。 */
const IMAGE_SIZE_CACHE = new Map();

/**
 * 讀 JPEG／PNG 的檔頭取得像素尺寸。
 *
 * 為什麼要自己讀：內文圖沒有 width／height 屬性，瀏覽器在圖下載完之前
 * 不知道要留多高，整頁文字會在圖載入的瞬間往下跳（CLS）。Hero 圖是靠
 * front matter 手寫尺寸解決的，但內文圖有十幾張，手寫十幾組數字遲早會
 * 有人寫錯，而且寫錯不會有任何徵兆 ⸺ 圖會被拉變形，沒有人會發現。
 *
 * 這個站不裝相依套件，所以直接解檔頭。兩種格式各自的位置：
 *
 *   PNG   固定格式。8 byte 簽章 + 4 byte 長度 + "IHDR"，接著就是
 *         大端序的 width、height 各 4 byte，也就是 offset 16 與 20。
 *   JPEG  段落式。從 FFD8 開始一段一段跳，遇到 SOF（Start Of Frame）
 *         就停 ⸺ 尺寸寫在那一段的第 5 到第 8 個 byte，高在前寬在後。
 *         SOF 的標記有好幾個（基線、漸進、算術編碼各一組），但 C4／C8／CC
 *         不是 SOF（那是霍夫曼表、JPG 保留、算術編碼表），會誤判成尺寸，
 *         所以要排除掉。
 *
 * 讀不出來一律回 null，由呼叫端警告，絕不讓建置失敗 ⸺ 一張圖量不到尺寸
 * 是排版問題，不是「整個網站不能出版」的問題。
 */
function imageSize(file) {
  if (IMAGE_SIZE_CACHE.has(file)) return IMAGE_SIZE_CACHE.get(file);

  let size = null;
  try {
    const buf = readFileSync(file);

    // PNG：89 50 4E 47 0D 0A 1A 0A
    if (
      buf.length >= 24 &&
      buf.readUInt32BE(0) === 0x89504e47 &&
      buf.readUInt32BE(4) === 0x0d0a1a0a &&
      buf.toString("latin1", 12, 16) === "IHDR"
    ) {
      size = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }

    // JPEG：FFD8
    else if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let p = 2;
      while (p + 3 < buf.length) {
        if (buf[p] !== 0xff) {
          p++; // 填充位元組，往前對齊到下一個標記
          continue;
        }
        const marker = buf[p + 1];
        // FF 可以連著出現（填充），D0–D9 與 01 是沒有長度欄位的獨立標記
        if (marker === 0xff) {
          p++;
          continue;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
          p += 2;
          continue;
        }
        const len = buf.readUInt16BE(p + 2);
        const isSOF =
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc;
        if (isSOF && p + 9 < buf.length) {
          size = { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7) };
          break;
        }
        if (len < 2) break; // 長度不合法，再跳下去會原地打轉
        p += 2 + len;
      }
    }
  } catch {
    size = null;
  }

  if (size && (!size.width || !size.height)) size = null;
  IMAGE_SIZE_CACHE.set(file, size);
  return size;
}

/**
 * 把文章裡寫的圖片路徑對回專案裡的檔案。
 *
 * 內文圖寫的是產出後的相對路徑（例：../../assets/x.jpg ⸺ 從
 * docs/posts/<slug>/ 回到 docs/），而原始檔在 ROOT/assets/ 或 ROOT/static/，
 * 所以把開頭的 ./ ../ / 全部剝掉之後，再到這兩個地方各找一次。
 * static/ 的內容是直接鋪到站根的，所以它的相對路徑也對得上。
 *
 * 外部網址回 null ⸺ 那不是我們的檔案，量不到也不該量。
 */
function localImagePath(src) {
  const clean = String(src ?? "")
    .split(/[?#]/)[0]
    .replace(/^(\.{1,2}\/)+/, "")
    .replace(/^\/+/, "");
  if (!clean || /^https?:\/\//i.test(src)) return null;
  for (const p of [join(ROOT, clean), join(ROOT, "static", clean)]) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * 內文圖的 width／height 屬性字串。量不到就回空字串並警告 ⸺
 * 靜靜略過的話，這個功能哪天壞掉不會有人知道。
 */
function imageDimAttrs(src) {
  if (/^https?:\/\//i.test(String(src))) return ""; // 外部圖，量不到是正常的
  const file = localImagePath(src);
  const size = file && imageSize(file);
  if (!size) {
    console.warn(
      `  ⚠ ${CURRENT_SOURCE || "（未知來源）"}：圖片 ${src} 取不到尺寸，` +
        `已略過 width／height（版面可能在載入時位移）`
    );
    return "";
  }
  return ` width="${size.width}" height="${size.height}"`;
}

/* =======================================================================
 * Front matter（YAML 子集）
 * ===================================================================== */

function parseFrontMatter(raw) {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: text };

  const data = {};
  const lines = m[1].split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;

    const key = kv[1];
    let value = kv[2].trim();

    // 區塊純量： >  或  |
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const buf = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        buf.push(lines[++i].trim());
      }
      data[key] = value.startsWith(">") ? foldLines(buf) : buf.join("\n");
      continue;
    }

    // 區塊陣列：值留空，底下接一排「- 」開頭的行。
    //
    //   citation:
    //     - 標題 | https://example.com/
    //     - 只有標題的那一筆
    //
    // 和下面的行內陣列（[a, b, c]）等價，差別只在能不能容納逗號 ⸺ 行內寫法
    // 是用逗號切的，值裡面有逗號就會被切成兩筆。標題、書名這種長字串請用這種
    // 寫法。空的區塊（key: 底下一筆都沒有）會落回原本的字串處理，data[key]
    // 變成空字串，下游的 Array.isArray() 判斷結果與「沒寫」相同。
    if (value === "" && /^\s+-\s+\S/.test(lines[i + 1] || "")) {
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s+\S/.test(lines[i + 1])) {
        items.push(
          lines[++i].trim().replace(/^-\s+/, "").replace(/^["'](.*)["']$/, "$1")
        );
      }
      data[key] = items;
      continue;
    }

    // 行內陣列： [a, b, c]
    if (/^\[.*\]$/.test(value)) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      continue;
    }

    value = value.replace(/^["'](.*)["']$/, "$1");
    if (value === "true") data[key] = true;
    else if (value === "false") data[key] = false;
    else data[key] = value;
  }

  return { data, body: text.slice(m[0].length) };
}

/* =======================================================================
 * Markdown → HTML
 * ===================================================================== */

/**
 * 把直接貼在文章裡的裸網址變成可點的連結。
 *
 * 先把已經產生好的 <a>…</a> 與 <img> 抽成佔位符，免得重複包一層 <a>。
 * 呼叫時行內程式碼也還是佔位符狀態，所以程式碼區塊裡的網址不會被動到。
 */
function autolink(s) {
  const kept = [];
  let t = s.replace(/<a\b[^>]*>[\s\S]*?<\/a>|<img\b[^>]*>/g, (m) => {
    kept.push(m);
    return "" + (kept.length - 1) + "";
  });

  t = t.replace(/https?:\/\/[^\s<>()]+/g, (raw) => {
    // 結尾的標點多半屬於句子，不是網址的一部分
    const m = raw.match(/^(.*?)([.,;:!?、，。；：！？]+)$/);
    const url = m ? m[1] : raw;
    const tail = m ? m[2] : "";
    return (
      `<a href="${esc(safeUrl(unesc(url)))}" target="_blank" rel="noopener noreferrer">` +
      `${url}</a>${tail}`
    );
  });

  return t.replace(/(\d+)/g, (_, i) => kept[+i]);
}

function inline(src) {
  const codes = [];
  let s = esc(src);

  // 行內程式碼先抽出來，免得裡面的星號被當成強調語法
  s = s.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return " C" + (codes.length - 1) + " ";
  });

  // 圖片
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, alt, src2, title) =>
      `<img src="${esc(safeUrl(unesc(src2)))}"${imageDimAttrs(unesc(src2))} alt="${alt}"` +
      (title ? ` title="${title}"` : "") +
      ` loading="lazy" decoding="async">`
  );

  // 連結
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, text, href, title) => {
      const u = safeUrl(unesc(href));
      const external = /^https?:\/\//i.test(u);
      return (
        `<a href="${esc(u)}"` +
        (title ? ` title="${title}"` : "") +
        (external ? ' target="_blank" rel="noopener noreferrer"' : "") +
        `>${text}</a>`
      );
    }
  );

  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  s = autolink(s);

  s = s.replace(/ C(\d+) /g, (_, i) => `<code>${codes[+i]}</code>`);
  return s;
}

const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+/;

function isBlockStart(line) {
  return (
    /^```/.test(line) ||
    /^#{1,6}\s/.test(line) ||
    /^>\s?/.test(line) ||
    /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    LIST_RE.test(line) ||
    /^\|/.test(line)
  );
}

/** 段落內換行：中文與中文之間直接接合，中英之間補空格 */
function joinParagraph(lines) {
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    let cur = lines[i];
    const hardBreak = /\s{2,}$/.test(cur);
    cur = cur.replace(/\s+$/, "");
    out += cur;
    if (i === lines.length - 1) continue;
    if (hardBreak) {
      out += "<br>";
      continue;
    }
    const next = lines[i + 1].replace(/^\s+/, "");
    const a = cur.slice(-1);
    const b = next.slice(0, 1);
    out += CJK.test(a) && CJK.test(b) ? "" : " ";
  }
  return out;
}

function collectList(lines, start, ordered) {
  const re = ordered ? /^(\s*)\d+[.)]\s+(.*)$/ : /^(\s*)[-*+]\s+(.*)$/;
  const base = lines[start].match(/^\s*/)[0].length;
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = lines[i].match(re);
    if (!m || m[1].length !== base) break;

    const item = [m[2]];
    i++;

    // 蒐集這個項目底下的延續行（縮排更深的內容，含巢狀清單）
    while (i < lines.length) {
      const cur = lines[i];
      if (!cur.trim()) break;
      const indent = cur.match(/^\s*/)[0].length;
      if (indent > base) {
        item.push(cur.slice(Math.min(indent, base + 2)));
        i++;
        continue;
      }
      break;
    }
    items.push(item.join("\n"));
  }

  return { items, next: i };
}

/**
 * 把「數字 → 顯示字串」的格式統一，避免長條圖與數值區塊各寫一套。
 * 整數不補小數點，小數保留一位。
 */
const fmtNum = (n) =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);

/**
 * ```chart 區塊 → 水平長條圖。
 *
 *   title: 各型頭痛的一年盛行率
 *   unit: %
 *   max: 50
 *   緊縮型頭痛 | 38
 *   偏頭痛 | 14.4
 *
 * title / unit / max 皆可省略；max 省略時取資料最大值。
 *
 * 幾個刻意的處理：
 *  - 長條寬度用 CSS 變數 --w 帶進去，動畫由 CSS 負責，
 *    沒有 JS 時長條直接是最終寬度，不會變成空的。
 *  - 數值在 HTML 裡就是最終值，JS 只是先歸零再跑上去。
 *    爬蟲、螢幕閱讀器、關掉 JS 的人看到的都是正確數字。
 */
function renderChart(lines) {
  const cfg = { title: "", unit: "", max: null, source: "" };
  const rows = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const kv = line.match(/^(title|unit|max|source)\s*:\s*(.*)$/i);
    if (kv) {
      const k = kv[1].toLowerCase();
      cfg[k] = k === "max" ? Number(kv[2]) : kv[2].trim();
      continue;
    }
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length >= 2 && parts[1] !== "" && !Number.isNaN(Number(parts[1]))) {
      rows.push({ label: parts[0], value: Number(parts[1]) });
    }
  }

  if (!rows.length) return "";

  const max = cfg.max && cfg.max > 0 ? cfg.max : Math.max(...rows.map((r) => r.value));
  const unit = cfg.unit || "";

  // 給螢幕閱讀器的完整敘述：圖形本身對他們沒有意義，數字才有
  const summary =
    (cfg.title ? cfg.title + "。" : "") +
    rows.map((r) => `${r.label} ${fmtNum(r.value)}${unit}`).join("，") +
    "。";

  const bars = rows
    .map((r) => {
      const pct = max > 0 ? (r.value / max) * 100 : 0;
      return `          <li class="chart-row">
            <span class="chart-label">${esc(r.label)}</span>
            <span class="chart-track"><span class="chart-fill" style="--w:${pct.toFixed(2)}%"></span></span>
            <span class="chart-value" data-count-to="${r.value}" data-unit="${esc(unit)}">${esc(fmtNum(r.value) + unit)}</span>
          </li>`;
    })
    .join("\n");

  return `<figure class="chart reveal" role="img" aria-label="${esc(summary)}">
${cfg.title ? `        <figcaption class="chart-title">${esc(cfg.title)}</figcaption>\n` : ""}        <ul class="chart-bars" aria-hidden="true">
${bars}
        </ul>
${cfg.source ? `        <p class="chart-source">${inline(cfg.source)}</p>\n` : ""}      </figure>`;
}

/**
 * ```stats 區塊 → 一排會跑動的數字。
 *
 *   38 | % | 成人一年內曾有緊縮型頭痛
 *   14.4 | % | 偏頭痛的全球盛行率
 *
 * 格式為「數值 | 單位 | 說明」，單位可留空但分隔線要留著。
 */
function renderStats(lines) {
  const items = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length < 2) continue;
    const value = Number(parts[0]);
    if (Number.isNaN(value)) continue;
    items.push({ value, unit: parts[1] || "", label: parts.slice(2).join(" | ") });
  }

  if (!items.length) return "";

  const cells = items
    .map(
      (s) => `        <div class="stat">
          <p class="stat-value" data-count-to="${s.value}" data-unit="${esc(s.unit)}">${esc(fmtNum(s.value) + s.unit)}</p>
${s.label ? `          <p class="stat-label">${esc(s.label)}</p>\n` : ""}        </div>`
    )
    .join("\n");

  return `<div class="stats reveal">
${cells}
      </div>`;
}

function markdown(src) {
  const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // 圍籬區塊。lang 為 chart / stats 時走各自的繪製，其餘當程式碼。
    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      const lang = fence[1];
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;

      if (lang === "chart") {
        out.push(renderChart(buf));
      } else if (lang === "stats") {
        out.push(renderStats(buf));
      } else {
        out.push(
          `<div class="code-scroll"><pre><code${
            lang ? ` class="language-${esc(lang)}"` : ""
          }>${esc(buf.join("\n"))}</code></pre></div>`
        );
      }
      continue;
    }

    // 標題
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lv = h[1].length;
      out.push(
        `<h${lv} id="${esc(slugify(h[2]))}">${inline(h[2])}</h${lv}>`
      );
      i++;
      continue;
    }

    // 分隔線
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // 引用
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i++].replace(/^>\s?/, ""));
      }
      out.push(`<blockquote>${markdown(buf.join("\n"))}</blockquote>`);
      continue;
    }

    // 表格
    if (
      /^\|/.test(line) &&
      i + 1 < lines.length &&
      /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])
    ) {
      const cells = (row) =>
        row
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());

      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i])) body.push(cells(lines[i++]));

      out.push(
        '<div class="table-scroll"><table><thead><tr>' +
          head.map((c) => `<th>${inline(c)}</th>`).join("") +
          "</tr></thead><tbody>" +
          body
            .map(
              (row) =>
                "<tr>" + row.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>"
            )
            .join("") +
          "</tbody></table></div>"
      );
      continue;
    }

    // 清單
    if (LIST_RE.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const { items, next } = collectList(lines, i, ordered);
      const tag = ordered ? "ol" : "ul";
      out.push(
        `<${tag}>` +
          items
            .map((item) => {
              const inner = item.includes("\n")
                ? markdown(item)
                : `<p>${inline(item)}</p>`;
              // 單一段落的項目不必包 <p>，版面比較緊湊
              const only = inner.match(/^<p>([\s\S]*)<\/p>$/);
              return `<li>${only ? only[1] : inner}</li>`;
            })
            .join("") +
          `</${tag}>`
      );
      i = next;
      continue;
    }

    // 段落
    const buf = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      buf.push(lines[i++]);
    }
    if (buf.length) out.push(`<p>${inline(joinParagraph(buf))}</p>`);
    else i++;
  }

  return out.join("\n");
}

/* =======================================================================
 * 日期
 * ===================================================================== */

const fmtDate = (d) =>
  `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;

const isoDate = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const sameDay = (a, b) => isoDate(a) === isoDate(b);

/**
 * 選用的日期欄位（YYYY-MM-DD）。沒填回 null；填了但格式不合法或日期不存在
 * → warn 並回 null，不靜默吞掉。
 *
 * 從 updatedDate() 抽出來共用 ⸺ 頁面沒有發布日，只有選用的 updated，
 * 少了「早於發布日」那道檢查，但解析與驗證的規則必須跟文章一模一樣。
 */
function optionalDate(raw, file, field) {
  if (raw === undefined || raw === null) return null;

  const text = String(raw).trim();
  if (!text) return null;

  const d = new Date(`${text}T00:00:00`);
  // isoDate 回推比對，順便擋掉 2026-02-30 這種會被 Date 自動進位的日期
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(d.getTime()) || isoDate(d) !== text) {
    console.warn(`  ⚠ ${file} 的 ${field}「${text}」不是合法日期（需 YYYY-MM-DD），已當作沒填`);
    return null;
  }
  return d;
}

/**
 * 文章的「更新日期」＝ front matter 的選用欄位 updated（YYYY-MM-DD）。
 * 沒填就等於發布日，此時全站不會出現「更新」字樣。
 *
 * 刻意不從 git commit 時間或檔案 mtime 推導 ⸺ 那會讓「更新」變成存檔或
 * 提交的副作用，日期還會隨 repo 狀態漂移。要不要標更新是編輯決定，用手填。
 *
 * 填了但不合法（格式不對、日期不存在）或早於發布日 → warn 並當作沒填，
 * 不靜默吞掉。
 */
function updatedDate(raw, published, file) {
  const d = optionalDate(raw, file, "updated");
  if (!d) return published;
  if (d < published) {
    console.warn(
      `  ⚠ ${file} 的 updated（${isoDate(d)}）早於 date（${isoDate(published)}），已當作沒填`
    );
    return published;
  }
  return d;
}

/** 本地時區偏移，格式 +08:00 / -0500（RFC 822 不加冒號） */
function tzOffset(d, colon) {
  const total = -d.getTimezoneOffset();
  const sign = total >= 0 ? "+" : "-";
  const abs = Math.abs(total);
  const p = (n) => String(n).padStart(2, "0");
  return sign + p(Math.floor(abs / 60)) + (colon ? ":" : "") + p(abs % 60);
}

/**
 * ISO 8601 完整時間戳，帶本地時區偏移，例如 2026-08-02T00:00:00+08:00。
 *
 * 刻意不用 toISOString()：那會轉成 UTC，台北時間的午夜會被推回前一天，
 * 結構化資料與 sitemap 上的日期就會跟站上顯示的差一天。
 */
const isoDateTime = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    tzOffset(d, true)
  );
};

// RSS 的 pubDate 規定用 RFC 822，且月份／星期一律是英文縮寫。
// 這裡寫死對照表，不靠 toLocaleString，免得跟著機器的語系跑掉。
const RFC822_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RFC822_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const rfc822 = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${RFC822_DAYS[d.getDay()]}, ${p(d.getDate())} ` +
    `${RFC822_MONTHS[d.getMonth()]} ${d.getFullYear()} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ` +
    tzOffset(d, false)
  );
};

/* =======================================================================
 * SEO 基礎建設：絕對網址、XML／JSON-LD 跳脫
 *
 * canonical、og:image、sitemap、RSS 全都需要絕對網址，而文章頁位在
 * /posts/<slug>/ 底下，任何相對路徑到了別的頁面就會指錯地方。
 * 所以凡是要被機器讀的網址，一律走 abs() 補成絕對路徑。
 * ===================================================================== */

/** 站台根網址，去掉尾斜線，後面一律自己補 */
const SITE_URL = String(CFG.url || "").replace(/\/+$/, "");

if (!SITE_URL) {
  console.warn(
    "  ⚠ site.config.json 沒有 url，canonical／sitemap／RSS 會產生相對網址而失效。"
  );
}

/** 相對路徑 → 絕對網址；已經是絕對網址就原樣放行 */
function abs(path) {
  const s = String(path ?? "");
  if (/^https?:\/\//i.test(s)) return s;
  return SITE_URL + "/" + s.replace(/^\/+/, "");
}

const HOME_URL = abs("");
const FEED_URL = abs("feed.xml");
const SITEMAP_URL = abs("sitemap.xml");

// 用 @id 把作者釘成同一個實體：每一頁都輸出完整的 Person 節點，
// 但共用同一個 @id，搜尋引擎與語言模型才會知道那是同一個人，
// 而不是每頁各自冒出一個同名的陌生人。
const PERSON_ID = `${HOME_URL}#author`;
const WEBSITE_ID = `${HOME_URL}#website`;

/**
 * 這個人在「本站內」的權威身分頁，例如 /about/。
 *
 * 由 content/pages/ 裡宣告 schemaType: ProfilePage 的那一頁自動填入
 * （見 build()）；沒有這種頁面就維持空字串，Person 節點也不會多出欄位。
 * 刻意不寫死網址 ⸺ 換 slug 或改由別的頁面擔任身分頁時，這裡不必跟著改。
 */
let PROFILE_PAGE_URL = "";

/** XML 跳脫。比 HTML 的 esc() 多一個單引號，屬性值用單引號時才不會破。 */
const xesc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * 把物件寫成能安全內嵌在 <script> 裡的 JSON。
 *
 * < > & 轉成 \u00xx：這是 JSON 合法的跳脫，JSON.parse 讀回來一模一樣，
 * 但字面上再也湊不出 </script>，標題裡有引號或角括號也不會把 HTML 打斷。
 */
const jsonScript = (obj, indent = 2) =>
  JSON.stringify(obj, null, indent)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

/* -----------------------------------------------------------------------
 * 醫學實體（實體接地）
 *
 * 「這篇在講偏頭痛」對機器來說是一個中文字串，沒有意義；
 * 「這篇在講 Q133823」才是一個全世界都指得到的同一個東西。
 * 中間的對照表放在 site.config.json 的 medicalEntities，程式碼裡
 * 刻意不出現任何病名 ⸺ 加病、改 QID 都不該需要動這支檔案。
 * --------------------------------------------------------------------- */

/** QID → Wikidata 的實體網址。這是 sameAs 唯一該長的樣子。 */
const wikidataUrl = (qid) => `https://www.wikidata.org/wiki/${qid}`;

/**
 * 查一個中文病名，回傳可直接放進 JSON-LD 的節點。
 *
 * 查不到、或表裡的 QID 格式不對，一律回 null 並警告 ⸺ 靜靜略過的話，
 * front matter 打錯一個字就等於這篇沒有實體接地，而且完全沒有徵兆。
 * where 是出處（檔名或設定欄位名），警告要講得出去哪裡改。
 */
function medicalEntityNode(name, where) {
  const key = String(name ?? "").trim();
  if (!key) return null;

  const raw = (CFG.medicalEntities || {})[key];
  if (!raw) {
    console.warn(
      `  ⚠ ${where}：「${key}」不在 site.config.json 的 medicalEntities 對照表裡，` +
        `已略過（沒有 Wikidata 對照就無法輸出實體）`
    );
    return null;
  }

  const qid = typeof raw === "string" ? raw : raw && raw.qid;
  const type = (typeof raw === "object" && raw && raw.type) || "MedicalCondition";

  if (!/^Q\d+$/.test(String(qid ?? ""))) {
    console.warn(
      `  ⚠ site.config.json 的 medicalEntities：「${key}」的 QID「${qid}」格式不對` +
        `（應為 Q 開頭加數字），已略過`
    );
    return null;
  }

  return { "@type": type, name: key, sameAs: wikidataUrl(qid) };
}

/** 一串中文病名 → 節點陣列。查不到的那幾筆會被濾掉（各自警告過了）。 */
function medicalEntityNodes(names, where) {
  if (!Array.isArray(names)) return [];
  const seen = new Set();
  const out = [];
  for (const n of names) {
    const node = medicalEntityNode(n, where);
    // 同一篇裡重複寫同一個病名時只留一個 ⸺ 重複的節點不會讓實體更明確
    if (node && !seen.has(node.sameAs)) {
      seen.add(node.sameAs);
      out.push(node);
    }
  }
  return out;
}

/**
 * front matter 的 citation 欄位 → JSON-LD。
 *
 * 每一筆寫成「標題 | 網址」，沒有網址就只寫標題。schema.org 的 citation
 * 兩種都收：有網址時輸出 CreativeWork（機器能跟過去），只有標題時輸出
 * 純文字（紙本手冊、書這種沒有網址的來源，硬編一個網址才是錯的）。
 */
function citationNodes(list, where) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    const parts = String(raw ?? "").split("|");
    const name = parts[0].trim();
    const url = (parts[1] || "").trim();
    if (!name) continue;
    if (url && !/^https?:\/\//i.test(url)) {
      console.warn(
        `  ⚠ ${where}：citation「${name}」的網址「${url}」不是 http(s) 開頭，已只輸出標題`
      );
      out.push(name);
      continue;
    }
    out.push(url ? { "@type": "CreativeWork", name, url } : name);
  }
  return out;
}

/**
 * Person.image。尺寸直接量檔案，不從設定讀 ⸺ 手寫的尺寸會有寫錯而
 * 沒人發現的風險，量出來的不會。量不到就只輸出網址並警告。
 * 記住結果：personNode() 每一頁都會被呼叫一次，警告只該出現一次。
 */
let PERSON_IMAGE_NODE;
function personImageNode(src) {
  if (PERSON_IMAGE_NODE !== undefined) return PERSON_IMAGE_NODE;

  const file = localImagePath(src);
  if (!file) {
    console.warn(
      `  ⚠ site.config.json 的 authorProfile.image「${src}」找不到檔案，已略過 Person.image`
    );
    return (PERSON_IMAGE_NODE = null);
  }

  const node = { "@type": "ImageObject", url: abs(src) };
  const size = imageSize(file);
  if (size) {
    node.width = size.width;
    node.height = size.height;
  } else {
    console.warn(`  ⚠ authorProfile.image「${src}」取不到尺寸，Person.image 只輸出網址`);
  }
  return (PERSON_IMAGE_NODE = node);
}

/** authorProfile.knowsAbout 的節點。同樣只算一次，警告才不會印八遍。 */
let PERSON_KNOWS_ABOUT;
function personKnowsAbout(names) {
  if (PERSON_KNOWS_ABOUT === undefined) {
    PERSON_KNOWS_ABOUT = medicalEntityNodes(
      names,
      "site.config.json 的 authorProfile.knowsAbout"
    );
  }
  return PERSON_KNOWS_ABOUT;
}

/**
 * siteTopics 的節點 ⸺ 站台層級的「這個站在講什麼」。
 *
 * 掛在 WebSite.about（見 websiteNode()），而 WebSite 每一頁都會輸出，
 * 所以這裡同樣只算一次，查不到的警告才不會印八遍。
 */
let SITE_TOPICS;
function siteTopicNodes() {
  if (SITE_TOPICS === undefined) {
    SITE_TOPICS = medicalEntityNodes(CFG.siteTopics, "site.config.json 的 siteTopics");
  }
  return SITE_TOPICS;
}

/**
 * MedicalWebPage.specialty 的值。
 *
 * 來自 site.config.json 的 medicalSpecialty，內容是 schema.org 的
 * MedicalSpecialty 列舉網址全文 ⸺ 程式碼裡刻意不拼這個網址，改科別
 * 或 schema.org 日後改網址時都只動設定檔。留空就不輸出這個欄位；
 * 填了但不是網址就警告並略過，不會靜默送出一個機器讀不懂的字串。
 */
let MEDICAL_SPECIALTY;
function medicalSpecialty() {
  if (MEDICAL_SPECIALTY !== undefined) return MEDICAL_SPECIALTY;

  const raw = String(CFG.medicalSpecialty ?? "").trim();
  if (!raw) return (MEDICAL_SPECIALTY = "");
  if (!/^https?:\/\//i.test(raw)) {
    console.warn(
      `  ⚠ site.config.json 的 medicalSpecialty「${raw}」不是網址` +
        `（應為 schema.org 的 MedicalSpecialty 列舉網址），已略過 specialty`
    );
    return (MEDICAL_SPECIALTY = "");
  }
  return (MEDICAL_SPECIALTY = raw);
}

/**
 * 機構節點（母校、學會）。設定裡寫 { name, url?, type? }，
 * type 沒填就用呼叫端給的預設值。name 空的那筆直接跳過。
 */
function orgNodes(list, defaultType) {
  if (!Array.isArray(list)) return [];
  return list
    .map((o) => {
      const name = String((o && o.name) || "").trim();
      if (!name) return null;
      const node = { "@type": String((o && o.type) || defaultType), name };
      if (o && o.url) node.url = o.url;
      return node;
    })
    .filter(Boolean);
}

/** 專業證照。date 是選填，/about/ 上沒標年月的就別編一個。 */
function credentialNodes(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((c) => {
      const name = String((c && c.name) || "").trim();
      if (!name) return null;
      const node = { "@type": "EducationalOccupationalCredential", name };
      if (c && c.date) node.dateCreated = String(c.date);
      return node;
    })
    .filter(Boolean);
}

/** 作者的 Person 實體。sameAs 沒填就整個欄位不輸出，不留空陣列。 */
function personNode() {
  const profile = CFG.authorProfile || {};
  const node = {
    "@type": "Person",
    "@id": PERSON_ID,
    // 姓名不含敬稱。Google 的 Article 結構化資料文件明講 author.name 不應
    // 包含職稱或敬稱 ⸺ 寫成「吳旻陽 醫師」，機器會把「醫師」當成名字的
    // 一部分，之後就對不上任何一份以真名列出的名單。頁面上顯示的仍然是
    // CFG.author（「吳旻陽 醫師」），那是給人看的，兩者刻意分開。
    // authorProfile.name 沒填就退回舊行為。
    name: profile.name || CFG.author,
    // 指向站內的身分頁（/about/），與 mainEntityOfPage 一致 ⸺ 這兩個
    // 欄位都在回答「要認識這個人該去哪一頁」，指到不同地方等於自相矛盾。
    // 沒有身分頁時才退回首頁。
    url: PROFILE_PAGE_URL || HOME_URL,
  };
  if (profile.honorificSuffix) node.honorificSuffix = profile.honorificSuffix;
  if (profile.jobTitle) node.jobTitle = profile.jobTitle;
  if (profile.description || CFG.description) {
    node.description = profile.description || CFG.description;
  }
  // 任職機構。名字綁定到一間真實醫院，實體才立得住。
  if (profile.worksFor && profile.worksFor.name) {
    node.worksFor = { "@type": "MedicalOrganization", name: profile.worksFor.name };
    if (profile.worksFor.url) node.worksFor.url = profile.worksFor.url;
  }
  if (profile.image) {
    const img = personImageNode(profile.image);
    if (img) node.image = img;
  }
  // 專業領域。接的是 Wikidata 實體而不是中文字串 ⸺ 「他懂偏頭痛」這句話
  // 因此可以被對到全世界都同意的那一個偏頭痛。內容以 /about/ 的「醫學專長」
  // 為準，頁面上沒寫的專長不在這裡宣告。
  const knowsAbout = personKnowsAbout(profile.knowsAbout);
  if (knowsAbout.length) node.knowsAbout = knowsAbout;

  const alumniOf = orgNodes(profile.alumniOf, "CollegeOrUniversity");
  if (alumniOf.length) node.alumniOf = alumniOf;

  const memberOf = orgNodes(profile.memberOf, "Organization");
  if (memberOf.length) node.memberOf = memberOf;

  const credentials = credentialNodes(profile.hasCredential);
  if (credentials.length) node.hasCredential = credentials;

  const award = Array.isArray(profile.award)
    ? profile.award.map((a) => String(a).trim()).filter(Boolean)
    : [];
  if (award.length) node.award = award;

  const sameAs = Array.isArray(profile.sameAs)
    ? profile.sameAs.filter(Boolean)
    : [];
  if (sameAs.length) node.sameAs = sameAs;
  // 站內的權威身分頁。刻意不放進 sameAs ⸺ sameAs 的語意是「這個人在
  // 別處的身分頁」，把自己站內的頁面塞進去是錯的用法。站內那一頁是
  // mainEntityOfPage，兩個欄位講的是不同的事。
  if (PROFILE_PAGE_URL) node.mainEntityOfPage = PROFILE_PAGE_URL;
  return node;
}

/**
 * 站台節點。每一頁都輸出，共用同一個 @id。
 *
 * about 是站台層級的主題宣告 ⸺ 「這個站在講頭痛與偏頭痛」。這句話得有
 * 一個節點說出來，否則整張圖裡只說得出「這個站是這位醫師的」，說不出
 * 它在講什麼。刻意掛在 WebSite 而不是首頁的 WebPage：主題是整個站的性質，
 * 不是首頁這一頁的性質；而且掛在這裡，每一頁都帶得到同一句宣告。
 * 首頁 WebPage.about 指向作者本人的那條關聯維持不動 ⸺ 首頁同時是
 * 「關於這個站的主題」和「關於這位作者」，兩者都成立，不是二選一。
 */
function websiteNode() {
  const node = {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: HOME_URL,
    name: CFG.title,
    description: CFG.description,
    inLanguage: CFG.lang,
    publisher: { "@id": PERSON_ID },
  };
  const topics = siteTopicNodes();
  if (topics.length) node.about = topics;
  return node;
}

/** hero 圖轉成 ImageObject；沒有圖就回 null，讓呼叫端整個欄位省略 */
function imageNode(hero) {
  if (!hero || !hero.src) return null;
  const node = { "@type": "ImageObject", url: abs(hero.src) };
  if (hero.width && hero.height) {
    node.width = hero.width;
    node.height = hero.height;
  }
  if (hero.alt) node.caption = hero.alt;
  return node;
}

/**
 * 首頁的 WebPage 節點。
 *
 * about 用 @id 指回同一個 Person ⸺ 首頁「關於醫師」那一區顯示的人，
 * 和 JSON-LD 宣告的必須是同一個實體。這裡刻意只放參照、不重新展開 Person，
 * 否則同一頁會出現兩個同名卻互不相干的節點，反而把實體拆散。
 */
function homePageNode() {
  return {
    "@type": "WebPage",
    "@id": `${HOME_URL}#webpage`,
    url: HOME_URL,
    name: CFG.title,
    description: CFG.description,
    inLanguage: CFG.lang,
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": PERSON_ID },
  };
}

function homeJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [homePageNode(), websiteNode(), personNode()],
  };
}

function postJsonLd(post) {
  const url = abs(`posts/${post.slug}/`);
  const image = imageNode(post.hero);

  const aboutNodes = medicalEntityNodes(post.about, post.file);
  // 已經在 about 裡的病名不必再出現一次 ⸺ about 的語意（這篇在講什麼）
  // 比 mentions（順口提到）強，同時掛兩個等於把同一件事講兩遍還降級。
  const aboutIds = new Set(aboutNodes.map((n) => n.sameAs));
  const mentionNodes = medicalEntityNodes(post.mentions, post.file).filter(
    (n) => !aboutIds.has(n.sameAs)
  );
  const citations = citationNodes(post.citation, post.file);

  // 衛教文才套 MedicalWebPage。判斷規則只有一條：這篇有沒有掛到任何一個
  // 醫學實體（about）。理由是這條規則不需要另一個要維護的開關 ⸺ 一篇文章
  // 的主題若對得上醫學實體，它本來就是醫學內容；對不上（例如〈AI 講得沒錯，
  // 但它不認識你〉是門診觀察，不是衛教）就維持一般的 WebPage。把非醫學文
  // 宣告成 MedicalWebPage 不只是浮報，還會讓整站的醫療內容訊號變得不可信。
  const isMedical = aboutNodes.length > 0;
  let mainEntity;
  if (isMedical) {
    mainEntity = { "@type": "MedicalWebPage", "@id": url };
    // 科別。值是 schema.org 的 MedicalSpecialty 列舉網址，寫在
    // site.config.json 的 medicalSpecialty ⸺ 程式碼裡不拼這個網址。
    const specialty = medicalSpecialty();
    if (specialty) mainEntity.specialty = specialty;
    // 寫給病人看的，不是寫給同業看的
    mainEntity.medicalAudience = { "@type": "MedicalAudience", audienceType: "Patient" };
    // 審閱者就是作者本人 ⸺ 這些文章由掛名的那位醫師自己寫、也自己負責
    // 內容是否仍然正確，所以指回同一個 Person @id，不另外編一位審閱者。
    // 日後若真的有第二位醫師審閱，才該在這裡換成另一個實體。
    mainEntity.reviewedBy = { "@id": PERSON_ID };
    // 「最後一次檢視內容是否仍然正確」的日期。用 front matter 的
    // updated（沒填就等於 date），與頁面上顯示的「更新 X」同一個來源。
    mainEntity.lastReviewed = isoDate(post.updated);
  } else {
    mainEntity = { "@type": "WebPage", "@id": url };
  }

  const posting = {
    "@type": "BlogPosting",
    "@id": `${url}#post`,
    headline: post.title,
    description: post.summary || CFG.description,
    datePublished: isoDateTime(post.published),
    dateModified: isoDateTime(post.updated),
    // 文章沒另外指定作者時，直接指回站台那一個 Person 實體
    author:
      post.author === CFG.author
        ? { "@id": PERSON_ID }
        : { "@type": "Person", name: post.author },
    publisher: { "@id": PERSON_ID },
    inLanguage: CFG.lang,
    isPartOf: { "@id": WEBSITE_ID },
    mainEntityOfPage: mainEntity,
    url,
  };
  if (image) posting.image = image;
  // 陣列，不是用頓號串成一個字串 ⸺ schema.org 的 keywords 接受重複值，
  // 給一整串「頭痛、就醫準備」會被當成單一個關鍵詞。
  if (post.tags.length) posting.keywords = post.tags;
  // about ＝ 這篇的主題；mentions ＝ 文中確實談到但不是主題的東西。
  // 兩者都是帶 Wikidata sameAs 的實體，不是字串 ⸺ keywords 只能說
  // 「這篇出現過這幾個詞」，about 才說得出「這篇講的就是那個病」。
  if (aboutNodes.length) posting.about = aboutNodes;
  if (mentionNodes.length) posting.mentions = mentionNodes;
  if (citations.length) posting.citation = citations;

  const breadcrumb = {
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: CFG.title, item: HOME_URL },
      { "@type": "ListItem", position: 2, name: post.title, item: url },
    ],
  };

  return {
    "@context": "https://schema.org",
    "@graph": [posting, breadcrumb, websiteNode(), personNode()],
  };
}

/**
 * 頁面的 JSON-LD。
 *
 * 預設是 WebPage。front matter 寫 schemaType: ProfilePage 的頁面，會額外
 * 把 mainEntity 指回站台那一個 Person ⸺ 這一句才是「這一頁就是這個人的
 * 身分頁」的明確宣告，也是這類頁面對搜尋引擎最直接的價值。
 *
 * mainEntity 刻意只放 @id 參照，不重新展開一份 Person：同一頁出現兩個
 * 同名卻互不相干的節點，反而會把實體拆散。被參照的 Person 節點就在同一個
 * @graph 裡（見最後一行），不會是懸空參照。
 */
function pageJsonLd(page) {
  const url = abs(`${page.slug}/`);
  const image = imageNode(page.hero);

  const node = {
    "@type": page.schemaType,
    "@id": `${url}#webpage`,
    url,
    name: page.title,
    description: page.description || CFG.description,
    inLanguage: CFG.lang,
    isPartOf: { "@id": WEBSITE_ID },
  };
  if (page.updated) node.dateModified = isoDateTime(page.updated);
  if (image) node.primaryImageOfPage = image;
  if (page.schemaType === "ProfilePage") node.mainEntity = { "@id": PERSON_ID };

  const breadcrumb = {
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: CFG.title, item: HOME_URL },
      { "@type": "ListItem", position: 2, name: page.title, item: url },
    ],
  };

  return {
    "@context": "https://schema.org",
    "@graph": [node, breadcrumb, websiteNode(), personNode()],
  };
}

/* =======================================================================
 * 讀取內容（文章與頁面）
 * ===================================================================== */

function loadPosts() {
  if (!existsSync(POSTS_DIR)) return [];

  return readdirSync(POSTS_DIR)
    .filter((f) => extname(f).toLowerCase() === ".md")
    .map((file) => {
      const full = join(POSTS_DIR, file);
      const { data, body } = parseFrontMatter(readFileSync(full, "utf8"));

      if (data.draft === true) return null;

      // 檔名格式 YYYY-MM-DD-slug.md，可用 front matter 覆寫
      const nameMatch = basename(file, ".md").match(
        /^(\d{4}-\d{2}-\d{2})-(.+)$/
      );
      const slug = data.slug || (nameMatch ? nameMatch[2] : slugify(basename(file, ".md")));
      const published = new Date(
        `${data.date || (nameMatch ? nameMatch[1] : isoDate(new Date()))}T00:00:00`
      );

      if (!data.title) {
        console.warn(`  ⚠ ${file} 沒有 title，已跳過`);
        return null;
      }

      CURRENT_SOURCE = file;

      return {
        file,
        path: full,
        slug,
        title: String(data.title),
        summary: String(data.summary || ""),
        author: String(data.author || CFG.author),
        tags: Array.isArray(data.tags) ? data.tags : [],
        // 實體接地用的三個欄位。值是中文病名，對照表在 site.config.json 的
        // medicalEntities ⸺ 這裡刻意只收原始字串，查表與警告都留到
        // postJsonLd() 做，載入階段不該因為對照表少一筆就吐錯。
        about: Array.isArray(data.about) ? data.about : [],
        mentions: Array.isArray(data.mentions) ? data.mentions : [],
        citation: Array.isArray(data.citation) ? data.citation : [],
        unlisted: data.unlisted === true,
        published,
        updated: updatedDate(data.updated, published, file),
        hero: data.hero ? heroFromFrontMatter(data) : CFG.hero,
        social: socialFromFrontMatter(data),
        html: markdown(body),
      };
    })
    .filter(Boolean)
    // 最新發布在前。主鍵是 published（front matter 的 date），不是 updated ⸺
    // 用 updated 當主鍵的話，一篇舊文只要今天改個錯字就會跳回首頁第一張卡，
    // 讀者會以為那是新文章。updated 仍然負責它原本的事（卡片上的「更新 X」、
    // sitemap 的 lastmod、feed 的日期），只是不再決定順序。
    //
    // 後面兩個鍵是為了「可複現」而存在，不是為了好看：同一天發的文章 published
    // 會完全打平，這時候若直接 return 0，最終順序就等於 readdir 的回傳順序，
    // 也就是會隨檔案系統與機器漂移（我們踩過一次 mtime 排序的同一個坑）。
    //   2. updated 由新到舊 ⸺ 同一天發布的，最近動過的排前面。
    //   3. slug 字典序由小到大 ⸺ 純粹是決勝局，保證任何兩篇都分得出高下。
    // 三個鍵都只看 front matter 與檔名，不看檔案系統，所以每次建置結果相同。
    .sort(
      (a, b) =>
        b.published - a.published ||
        b.updated - a.updated ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
    );
}

function heroFromFrontMatter(d) {
  return {
    // own 用來區分「這篇自己指定的圖」與「沿用站台預設的圖」。
    // 社群預覽圖的挑選要靠它 ⸺ 見 headMeta()。
    own: true,
    src: d.hero,
    width: Number(d.heroWidth) || null,
    height: Number(d.heroHeight) || null,
    alt: d.heroAlt || "",
    caption: d.heroCaption || "",
    credit: {
      heading: d.heroCreditHeading || "",
      title: d.heroCreditTitle || "",
      titleUrl: d.heroCreditTitleUrl || "",
      author: d.heroCreditAuthor || "",
      authorUrl: d.heroCreditAuthorUrl || "",
      license: d.heroCreditLicense || "",
      licenseUrl: d.heroCreditLicenseUrl || "",
      note: d.heroCreditNote || "",
    },
  };
}

/**
 * socialImage* 系列欄位 ⸺ 只覆寫 og:image，不在頁面上顯示。
 *
 * 和 hero 的分工（會搞混的話看這裡就好）：
 *
 *   hero        頁面上看得到的那張大圖。它「順便」也會被當成社群預覽圖
 *               （見 headMeta()），因為多數情況下文章配圖就是最適合
 *               被轉貼出去的那張，不必填兩次。
 *   socialImage 只在別人轉貼連結時出現的縮圖。頁面上不會有它，
 *               也不會進 creditBlock() 的圖片版權區。
 *
 * 所以要哪一個，取決於「這張圖該不該出現在頁面上」：
 *
 *   兩個都不填  頁面沒有圖，社群卡用站台預設的品牌卡（CFG.social）。
 *   只填 hero   頁面有圖，社群卡就用同一張。最常見的情況。
 *   只填 social 頁面沒有圖，但社群卡是這一頁專屬的。
 *               /about/ 就是這種：肖像卡做給 LINE、Facebook 的預覽用，
 *               但自我介紹頁的最上面不需要再放一張自己的臉。
 *   兩個都填    頁面顯示 hero，社群卡用 socialImage。兩者互不干擾。
 *
 * 形狀刻意與 CFG.social 一致（src / width / height / alt），下游的
 * og:image:width、og:image:height、og:image:alt 與 twitter:image
 * 因此完全不用分辨圖是從哪裡來的。
 *
 * src 用不帶開頭斜線的站根相對路徑（例：assets/og-about-portrait.jpg），
 * 與 CFG.hero.src、CFG.social.src 同慣例，交給 abs() 轉成絕對網址。
 *
 * 沒填就回 null ⸺ headMeta() 靠 falsy 退回原本的挑選邏輯，
 * 所以既有的文章與頁面零影響。
 */
function socialFromFrontMatter(d) {
  if (!d.socialImage) return null;
  return {
    src: String(d.socialImage),
    width: Number(d.socialImageWidth) || null,
    height: Number(d.socialImageHeight) || null,
    alt: d.socialImageAlt || "",
  };
}

/**
 * 頁面能宣告的 schema.org 型別。
 *
 * 白名單而不是照單全收：schemaType 打錯字的話，輸出的 JSON-LD 會是一個
 * 搜尋引擎不認得的型別，而且完全不會報錯 ⸺ 那種錯誤很難發現。
 */
const PAGE_SCHEMA_TYPES = new Set([
  "WebPage",
  "ProfilePage",
  "AboutPage",
  "ContactPage",
  "CollectionPage",
]);

/**
 * 頁面的 slug 直接掛在網站根目錄底下，所以不能撞到 build 產出的其他路徑。
 * 撞到就整頁跳過並 warn ⸺ 靜靜覆蓋掉 index.html 或 sitemap.xml 才是災難。
 */
const RESERVED_SLUGS = new Set([
  "posts",
  "assets",
  "index",
  "404",
  "feed",
  "sitemap",
  "robots",
  "styles",
  "counter",
  "enhance",
]);

/**
 * 讀取 content/pages/*.md。
 *
 * 「頁面」是不掛在時間軸上的內容：關於醫師、說明頁這一類。與文章的差別
 * 只有兩件事 ⸺ 不進首頁列表、不進 RSS（feed 的工作是通知有新文章，
 * 一頁改了幾個字就推播給所有訂閱者並不合理）。sitemap 照收，因為那是
 * 「這個站有哪些網址」的清單，跟時間軸無關。
 *
 * 刻意不要求 date 與 tags：頁面沒有發布日，也不參與分類。updated 是選用的，
 * 驗證規則與文章共用 optionalDate()。hero 系列欄位沿用
 * heroFromFrontMatter()、socialImage 系列沿用 socialFromFrontMatter()，
 * 只有一個地方與文章不同：頁面沒填 hero 時不退回 CFG.hero（見下方）。
 *
 * 網址是 /<slug>/，slug 取自檔名，可用 front matter 的 slug 覆寫。
 */
function loadPages() {
  if (!existsSync(PAGES_DIR)) return [];

  const seen = new Map();

  return readdirSync(PAGES_DIR)
    .filter((f) => extname(f).toLowerCase() === ".md")
    .sort()
    .map((file) => {
      const full = join(PAGES_DIR, file);
      const { data, body } = parseFrontMatter(readFileSync(full, "utf8"));

      if (data.draft === true) return null;

      if (!data.title) {
        console.warn(`  ⚠ ${file} 沒有 title，已跳過`);
        return null;
      }

      const slug = slugify(data.slug || basename(file, ".md"));
      if (!slug) {
        console.warn(`  ⚠ ${file} 產不出 slug，已跳過`);
        return null;
      }
      if (RESERVED_SLUGS.has(slug) || slug === CFG.supabase.homeSlug) {
        console.warn(`  ⚠ ${file} 的 slug「${slug}」與站台既有路徑衝突，已跳過`);
        return null;
      }
      if (seen.has(slug)) {
        console.warn(`  ⚠ ${file} 的 slug「${slug}」與 ${seen.get(slug)} 重複，已跳過`);
        return null;
      }
      seen.set(slug, file);

      // summary 與 description 是同一件事的兩個名字：文章慣用 summary，
      // 頁面寫 description 讀起來更自然，兩個都收。兩個都沒有會退回站台
      // 描述 ⸺ 那幾乎一定不是想要的結果，所以先喊一聲。
      const description = String(data.summary || data.description || "").trim();
      if (!description) {
        console.warn(
          `  ⚠ ${file} 沒有 summary／description，meta description 與社群預覽會退回站台描述`
        );
      }

      const rawType = String(data.schemaType || "WebPage").trim();
      const schemaType = PAGE_SCHEMA_TYPES.has(rawType) ? rawType : "WebPage";
      if (schemaType !== rawType) {
        console.warn(
          `  ⚠ ${file} 的 schemaType「${rawType}」不在支援清單，已當作 WebPage`
        );
      }

      CURRENT_SOURCE = file;

      return {
        file,
        path: full,
        slug,
        title: String(data.title),
        description,
        schemaType,
        unlisted: data.unlisted === true,
        updated: optionalDate(data.updated, file, "updated"),
        // 頁面沒填 hero 就是沒有 hero，不沿用 CFG.hero ⸺ 這一點與文章不同。
        //
        // 站台預設 Hero 是首頁那張診間注射照，畫面裡有病人。文章沿用它是
        // 既有設計（版面上需要一張圖起頭，而那張圖就是站台的門面）；但頁面
        // 是「關於醫師」「說明」這種各講各的內容，把同一張診間照擺在最上面
        // 既沒有理由、又和首頁重複，還會連帶讓頁尾長出一段圖片版權。
        // heroBlock() 與 creditBlock() 遇到 falsy 都回空字串，不必另外防。
        hero: data.hero ? heroFromFrontMatter(data) : null,
        social: socialFromFrontMatter(data),
        html: markdown(body),
      };
    })
    .filter(Boolean);
}

/* =======================================================================
 * 樣板
 * ===================================================================== */

function heroBlock(hero, rel, eager) {
  if (!hero || !hero.src) return "";
  const dims =
    hero.width && hero.height
      ? ` width="${hero.width}" height="${hero.height}"`
      : "";
  return `      <figure class="hero">
        <img src="${esc(rel + hero.src)}"${dims} alt="${esc(hero.alt)}"
             loading="${eager ? "eager" : "lazy"}" decoding="async"${
    eager ? ' fetchpriority="high"' : ""
  }>
${hero.caption ? `        <figcaption>${esc(hero.caption)}</figcaption>\n` : ""}      </figure>`;
}

/**
 * 頁尾的圖片版權區塊，兩種情況分開處理：
 *
 *  - 有填 license → 視為外部授權作品，照 CC 的要求標出
 *    作品名、作者、來源連結、授權條款（TASL）。
 *  - 沒填 license → 視為自有作品，就不會出現「依 X 授權使用」
 *    這種對自己拍的照片講不通的句子。
 *
 * note 欄位接在句尾，放改作聲明或版權宣告都行。
 */
function creditBlock(hero) {
  const c = (hero && hero.credit) || {};
  if (!c.title && !c.author) return "";

  const link = (text, url) =>
    url
      ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`
      : esc(text);

  const title = c.title ? link(c.title, c.titleUrl) : "";
  const author = c.author ? link(c.author, c.authorUrl) : "";

  const sentence = c.license
    ? `${title}${author ? `，作者 ${author}` : ""}，依 ${link(
        c.license,
        c.licenseUrl
      )} 授權使用。`
    : `${title}${author ? `，${author}攝` : ""}。`;

  return `      <section class="credit">
        <h2>${esc(c.heading || "圖片出處")}</h2>
        <p>${sentence}${c.note ? esc(c.note) : ""}</p>
      </section>`;
}

function metaRow(post, slugForViews) {
  const parts = [
    `<span class="author">${esc(post.author)}</span>`,
    `<time datetime="${isoDate(post.published)}">發布 ${fmtDate(post.published)}</time>`,
  ];
  if (!sameDay(post.published, post.updated)) {
    parts.push(
      `<time datetime="${isoDate(post.updated)}">更新 ${fmtDate(post.updated)}</time>`
    );
  }
  parts.push(`<span class="views" data-views-for="${esc(slugForViews)}" hidden></span>`);
  return `<p class="meta">${parts.join("\n          ")}</p>`;
}

/**
 * 每一頁共用的 <head>。
 *
 * canonical、og:image、feed 這些一律用絕對網址 ⸺ 文章頁在 /posts/<slug>/
 * 底下，而預覽卡片、爬蟲、RSS 閱讀器都不見得會拿到正確的 base，相對路徑
 * 到了它們手上就是壞的。
 */
function headMeta({
  fullTitle,
  description,
  canonical,
  hero,
  // front matter 的 socialImage* ⸺ 只覆寫社群卡、不上頁面。
  // 見 socialFromFrontMatter() 的註解，那裡有它與 hero 的完整分工表。
  social: socialOverride,
  post,
  noindex,
}) {
  const lines = [];

  // 社群預覽圖刻意與頁面 Hero 分開。優先序由窄到寬：
  //
  //   1. 這一頁自己指定的 socialImage ⸺ 最明確的意圖，優先於一切。
  //   2. 這一篇自己指定的 Hero ⸺ 頁面上那張圖通常就是最該被轉貼的圖。
  //   3. 站台的品牌卡（CFG.social）。
  //
  // 第 2 步刻意檢查 hero.own：沒有自己指定 Hero 的文章會沿用 CFG.hero，
  // 那時候要落到品牌卡，而不是把首頁 Hero 轉貼出去 ⸺ 首頁 Hero 是診間照，
  // 畫面裡有病人。頁面上看到那張圖，和連結被轉貼到 LINE 群組時自動展開
  // 一張縮圖，是兩種完全不同量級的傳播，後者還會被各平台快取。
  const social = socialOverride || (hero && hero.own ? hero : CFG.social) || null;
  const image = social && social.src ? abs(social.src) : "";

  lines.push(`  <link rel="canonical" href="${esc(canonical)}">`);
  // unlisted 的文章不進搜尋結果。注意 robots.txt 不要一併 Disallow ⸺
  // 擋掉抓取，Google 就讀不到這行 noindex，反而可能靠外部連結把它列進索引。
  lines.push(
    noindex || (post && post.unlisted)
      ? `  <meta name="robots" content="noindex, nofollow">`
      : `  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">`
  );
  lines.push(
    `  <meta property="og:type" content="${post ? "article" : "website"}">`
  );
  lines.push(`  <meta property="og:site_name" content="${esc(CFG.title)}">`);
  lines.push(`  <meta property="og:title" content="${esc(fullTitle)}">`);
  lines.push(`  <meta property="og:description" content="${esc(description)}">`);
  lines.push(`  <meta property="og:url" content="${esc(canonical)}">`);
  lines.push(`  <meta property="og:locale" content="${esc(CFG.locale)}">`);

  if (image) {
    lines.push(`  <meta property="og:image" content="${esc(image)}">`);
    if (social.width && social.height) {
      lines.push(`  <meta property="og:image:width" content="${social.width}">`);
      lines.push(`  <meta property="og:image:height" content="${social.height}">`);
    }
    if (social.alt) {
      lines.push(`  <meta property="og:image:alt" content="${esc(social.alt)}">`);
    }
  }

  if (post) {
    lines.push(
      `  <meta property="article:published_time" content="${esc(isoDateTime(post.published))}">`
    );
    lines.push(
      `  <meta property="article:modified_time" content="${esc(isoDateTime(post.updated))}">`
    );
    lines.push(`  <meta property="article:author" content="${esc(post.author)}">`);
    for (const tag of post.tags) {
      lines.push(`  <meta property="article:tag" content="${esc(tag)}">`);
    }
  }

  lines.push(
    `  <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`
  );
  lines.push(`  <meta name="twitter:title" content="${esc(fullTitle)}">`);
  lines.push(`  <meta name="twitter:description" content="${esc(description)}">`);
  if (image) {
    lines.push(`  <meta name="twitter:image" content="${esc(image)}">`);
    if (social.alt) {
      lines.push(`  <meta name="twitter:image:alt" content="${esc(social.alt)}">`);
    }
  }

  return lines.join("\n");
}

/**
 * Google Analytics 4。
 *
 * 沒填 ga4Id 就回空字串 ⸺ 頁面上不會出現任何第三方請求，
 * 這是刻意的：想關掉分析只要把設定清空，不必改程式。
 *
 * 用 JS 動態插入而不是直接寫死 <script src>，是為了能先判斷網域：
 * 本機預覽時完全不載入，自己開發的瀏覽就不會混進統計數字裡。
 */
function analyticsScript() {
  const id = (CFG.analytics && CFG.analytics.ga4Id || "").trim();
  if (!id) return "";
  return `  <!-- Google Analytics 4（本機預覽不載入） -->
  <script>
    (function () {
      var h = location.hostname;
      if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local")) return;
      var id = "${esc(id)}";
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + id;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      function gtag() { dataLayer.push(arguments); }
      window.gtag = gtag;
      gtag("js", new Date());
      gtag("config", id);
    })();
  </script>
`;
}

function layout({
  title,
  description,
  rel,
  pageSlug,
  bodyClass,
  // 頁首右側的導覽。目前只有首頁會傳（本頁錨點導覽），
  // 文章頁不傳，頁首就只有站名與副標。
  headerNav,
  main,
  hero,
  // 只覆寫 og:image，不影響版面。見 socialFromFrontMatter()。
  social,
  canonical,
  post,
  // 非文章的頁面（content/pages/）也可能是 unlisted，那時候沒有 post
  // 可以看，所以另外開一個明確的開關。
  noindex,
  jsonLd,
}) {
  const fullTitle =
    title === CFG.title ? `${CFG.title}｜${CFG.author}` : `${title}｜${CFG.title}`;

  return `<!doctype html>
<html lang="${esc(CFG.lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="author" content="${esc(CFG.author)}">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="${esc(CFG.brandColor || "#182A55")}">
${headMeta({ fullTitle, description, canonical, hero, social, post, noindex })}
  <link rel="icon" href="${rel}favicon.ico" sizes="32x32">
  <link rel="icon" href="${rel}favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="${rel}apple-touch-icon.png">
  <link rel="manifest" href="${rel}site.webmanifest">
  <link rel="stylesheet" href="${rel}styles.css?v=${ASSET_HASH.styles}">
  <link rel="alternate" type="application/rss+xml" title="${esc(CFG.title)}" href="${esc(FEED_URL)}">
  <script type="application/ld+json">${jsonScript(jsonLd)}</script>
  <script id="site-data" type="application/json">${jsonScript(
    { supabase: CFG.supabase },
    0
  )}</script>
  <!-- 這行必須同步執行、而且在 body 之前：
       CSS 只有在 .js 存在時才把長條圖歸零等待動畫。
       改用 defer 的話會先畫出完整長條再瞬間歸零，看得到閃動；
       沒有這行則代表 JS 不可用，長條就維持最終寬度不做動畫。 -->
  <script>document.documentElement.classList.add("js");</script>
${analyticsScript()}</head>
<body class="${bodyClass}" data-page-slug="${esc(pageSlug)}">

  <header class="site-header">
    <div class="wrap">
      <div class="site-identity">
        <p class="site-title"><a href="${rel || "./"}">${esc(CFG.title)}</a></p>
        <p class="site-byline">${esc(CFG.author)}・${esc(CFG.authorTitle)}</p>
      </div>
${headerNav ? headerNav.trimEnd() + "\n" : ""}    </div>
  </header>

  <main>
    <div class="wrap">
${main}
    </div>
  </main>

  <footer class="site-footer">
    <div class="wrap">
${creditBlock(hero)}
      <section class="disclaimer">
        <p>${esc(CFG.disclaimer)}</p>
      </section>
      <p class="colophon">© ${new Date().getFullYear()} ${esc(CFG.author)}・${esc(CFG.title)}</p>
    </div>
  </footer>

  <button type="button" class="to-top" id="to-top" hidden aria-label="回到頁面頂部">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 19V6M6 12l6-6 6 6" fill="none" stroke="currentColor"
            stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <script src="${rel}counter.js?v=${ASSET_HASH.counter}" defer></script>
  <script src="${rel}enhance.js?v=${ASSET_HASH.enhance}" defer></script>
</body>
</html>
`;
}

/**
 * 首頁的門診時段表。
 *
 * 為什麼是 <table>：這是名副其實的二維資料（星期 × 時段），表格的標題關聯
 * 本來就是給輔助技術用的。用 div 得自己補一整套 ARIA，補得再好也不會更好。
 *
 * 位置在「關於醫師」之後，不在文章清單之前 ⸺ 站主的決定。門診時段是關於
 * 這位醫師的事實，跟簡歷、專長是同一類；擺在衛教文章上面會變成讀者進站後
 * 第一個要跨過的東西，而首頁的主體是文章。
 *
 * 為什麼螢幕上兩種格子都沒有可見文字（站主的決定）：這一版靠的是「亮度」
 * 而不是「顏色」。看診與休診兩格的對比是淺色 7.76:1、深色 4.36:1，轉成灰階
 * 後的差距是 161 / 255 與 101 / 255 ⸺ 全色盲或黑白螢幕看到的仍然是「深塊
 * 對淺塊」，不倚賴辨色能力。參考站是同亮度只換色相，那才是 WCAG 1.4.1 的
 * 失敗；這裡不是。
 *
 * 但紙上沒有顏色，所以「看診／休診」在 @media print 裡會現形（見 styles.css）
 * ⸺ 螢幕靠亮度、紙張靠文字，兩邊都不會只剩下顏色。
 *
 * 兩種狀態都用 .visually-hidden 而不是 font-size: 0 ⸺ 後者會產生 0×0 的
 * 無障礙邊界框，iOS VoiceOver 的觸控探索與點字顯示器的路由都可能落空。
 *
 * 為什麼欄標題有兩份：可見的是「一」，但中文 TTS 唸「一」就是數字一。
 * 補一份 .visually-hidden 的「星期一」⸺ 欄標題會被帶進每一格的上下文，
 * 錯一次就錯 21 次。
 *
 * 為什麼格子不可點：醫院沒有單一時段的掛號深連結（查過 doctor_detail.php，
 * 只有 register.php 一個總入口）。五格連到同一個網址，等於五個目的地相同、
 * 名稱也相同的連結 ⸺ 讀螢幕的人會在連結清單看到五個一樣的「看診」，
 * 鍵盤使用者多五個沒有區別的停靠點。整區只有一個出口，跟 visitCalloutBlock()
 * 同一個原則。日後醫院真的給了深連結再改。
 *
 * 為什麼可以沒有時間：醫院實際起訖時間由 config 的 sessions[].time 提供，
 * 留空就只印時段名稱。編一個出來會變成公開的錯誤醫療資訊。
 *
 * open 用「星期-時段」的 1 起算索引（"5-3" = 星期五晚上）。用索引而不是
 * 「五晚」這種字串，是因為 days 與 sessions 的文字站主隨時會改，改了字串
 * 對照就會靜默失效；索引不會。
 */
function clinicHoursBlock() {
  const c = CFG.clinicHours;
  if (!c) return "";

  const sessions = (Array.isArray(c.sessions) ? c.sessions : [])
    .map((s) => ({
      label: String(s?.label ?? "").trim(),
      time: String(s?.time ?? "").trim(),
    }))
    .filter((s) => s.label);
  const days = (Array.isArray(c.days) ? c.days : [])
    .map((d) => String(d ?? "").trim())
    .filter(Boolean);

  // 三者缺一，這張表就沒有意義 ⸺ 寧可整塊不輸出，也不要一張空表格。
  if (!sessions.length || !days.length) return "";

  // 驗證與比對必須用同一份資料，否則兩套判準遲早分岔 ⸺ 之前就分岔過：
  // 範圍檢查把 "2 - 2"、"05-1"、"2-2-1" 都當成合法（Number() 解析得出數字），
  // 但比對用的是字串相等，於是它們永遠比不中，靜默變成休診、不警告。
  // 現在只認嚴格格式，通過的正規化後放進 Set，兩邊吃同一份。
  const open = new Set();
  for (const raw of Array.isArray(c.open) ? c.open : []) {
    const key = String(raw ?? "").trim();
    const m = /^(\d+)-(\d+)$/.exec(key);
    const d = m && Number(m[1]);
    const s = m && Number(m[2]);
    if (!m || !(d >= 1 && d <= days.length && s >= 1 && s <= sessions.length)) {
      console.warn(
        `  ⚠ clinicHours.open 的「${key}」不是合法的索引，這一格會被當成休診 ⸺ 格式必須是「數字-數字」（星期 1-${days.length}、時段 1-${sessions.length}），不能有空白或多餘的區段`
      );
      continue;
    }
    open.add(`${d}-${s}`);
  }

  if (!open.size) return "";

  // 進入表格時第一個被唸出來的就是 caption ⸺ 它是 .visually-hidden，
  // 螢幕上看不見，所以把答案寫進去不影響站主「用顏色區分就好」的決定。
  // 由 open 產生，改 config 這句會跟著變，不可能跟表格分岔。
  const spoken = days
    .map((d, di) => {
      const inDay = sessions
        .filter((_, si) => open.has(`${di + 1}-${si + 1}`))
        .map((s) => s.label);
      return inDay.length ? `星期${d}${inDay.join("、")}` : "";
    })
    .filter(Boolean)
    .join("，");

  const rows = sessions
    .map((s, si) => {
      const cells = days
        .map((d, di) => {
          const on = open.has(`${di + 1}-${si + 1}`);
          return on
            ? `            <td class="is-open"><span><span class="visually-hidden">看診</span></span></td>`
            : `            <td class="is-closed"><span><span class="visually-hidden">休診</span></span></td>`;
        })
        .join("\n");

      return `          <tr>
            <th scope="row">
              <span class="clinic-session">${esc(s.label)}</span>${
        s.time ? `<span class="clinic-time">${esc(s.time)}</span>` : ""
      }
            </th>
${cells}
          </tr>`;
    })
    .join("\n");

  // 外連的處理沿用 authorBioBlock() 那一套，不自己再寫一份判斷：
  // safeUrl() 擋協定、/^(https?:)?\/\//i 判外部、外部才加 target 與 ↗。
  // ↗ 是 aria-hidden，所以另外補一句給用聽的人 ⸺ 全站最重要的離站連結
  // 就是這一條，不該讓人在不知情下跳分頁。
  // 電話掛號。線上掛號是唯一出口這件事在第一版是對的，但那個出口把用不了
  // 線上系統的人排除在外 ⸺ 長輩、失智症家屬、中風後行動不便的病人，正好是
  // 這個門診的一大群。兩個出口做的是同一件事（掛號），所以並排而不是分開。
  const phone =
    c.phone?.label && c.phone?.number && c.phone?.href
      ? `<a class="clinic-phone" href="${esc(safeUrl(c.phone.href))}">${esc(
          String(c.phone.label)
        )} <span class="clinic-number">${esc(String(c.phone.number))}</span></a>`
      : "";

  let link = "";
  if (c.link?.label && c.link?.url) {
    const href = safeUrl(c.link.url);
    const external = /^(https?:)?\/\//i.test(href);
    link = `<a href="${esc(href)}"${
      external ? ` target="_blank" rel="noopener noreferrer"` : ""
    }>${esc(c.link.label)}${
      external
        ? `<span class="ext" aria-hidden="true">↗</span><span class="visually-hidden">（在新分頁開啟）</span>`
        : ""
    }</a>`;
  }

  const actions =
    link || phone
      ? `        <p class="clinic-cta">${link}${phone}</p>
`
      : "";

  // 圖例整段 aria-hidden：它是給眼睛看的色塊對照，而用聽的人每一格本來就會
  // 唸到「看診」或「休診」，再唸一次只是噪音 ⸺ 而且那句話少了色塊根本不成句。
  //
  // 色塊本身吃 --clinic-open-bg，跟格子同一個變數，所以深淺兩種模式各自正確。
  // 這是站主 2026-08-31 指出來的：深色模式下看診格其實比休診格「亮」，
  // 原本寫死的「深色為看診時段」在深色模式下剛好是反的。文案裡不要再出現
  // 顏色深淺的描述，那種寫法一定會有一種模式是錯的。
  const legend = c.legend
    ? `<span class="clinic-legend" aria-hidden="true"><i class="clinic-swatch"></i>${esc(
        String(c.legend)
      )}。</span>`
    : "";

  const note =
    legend || c.note
      ? `        <p class="clinic-note">${legend}${esc(String(c.note || ""))}</p>
`
      : "";

  return `      <h2 class="section-label" id="clinic"><span>${esc(
    c.heading || "門診時段"
  )}</span></h2>

      <div class="clinic-hours">
        <div class="table-scroll" tabindex="0" role="region" aria-label="門診時段表">
          <table>
            <caption class="visually-hidden">每週門診時段。有診的時段是${esc(
              spoken
            )}。</caption>
            <thead>
              <tr>
                <td></td>
${days
  .map(
    (d) =>
      `                <th scope="col"><span aria-hidden="true">${esc(
        d
      )}</span><span class="visually-hidden">星期${esc(d)}</span></th>`
  )
  .join("\n")}
              </tr>
            </thead>
            <tbody>
${rows}
            </tbody>
          </table>
        </div>
${note}${actions}      </div>

`;
}

/**
 * 門診專長的圖示。
 *
 * 為什麼寫在這裡而不是 config：這是標記，不是設定 ⸺ 跟 webmanifest 的 icons
 * 同一個判準。站主要改的是分類名稱和項目，不是路徑資料。
 *
 * 為什麼是手寫的 inline SVG：這個站零相依、零額外請求，不會為了四個圖示去載
 * 一整套圖示字型或外部檔案。四個都是 24×24、stroke 1.6、fill none 的線條圖，
 * 共用同一組筆畫參數，看起來才像一套而不是四個各自為政的插圖。
 *
 * 顏色一律吃 CSS 的 currentColor 家族（見 styles.css 的 .specialty-icon），
 * 不在這裡寫死 ⸺ 深淺兩種模式各自要不同的藍。
 *
 * 圖示一律 aria-hidden：每張卡片的名稱就寫在旁邊，讓螢幕閱讀器再唸一次
 * 「圖片」只是噪音。
 */
const SPECIALTY_ICONS = {
  // 頭痛：頭部側影加三道放射線
  // 頭痛：側臉輪廓加三道搏動的放射線（站主偏好這一版的造型）。
  //
  // 路徑本身沒有畫在畫布中央 ⸺ 實測 getBBox 是 x 1.6、y 0、17.4×20.5，
  // 幾何中心 (10.3, 10.25)，而另外三個都是 (11.5–12, 12)。四張卡片排在
  // 一起時，頭痛這張就看得出來偏左上（站主 2026-09-05 指出）。
  // 用 translate 校正而不是重畫，是為了讓造型一個點都不變。
  // 改任何圖示之後，都要用 svg.getBBox() 對一次中心。
  headache: `<g transform="translate(1.7 1.75)"><path d="M15.5 20.5v-2.2a4 4 0 0 1 1.3-2.9A6.8 6.8 0 0 0 12.6 3.6 6.8 6.8 0 0 0 6.2 9.7c-.1 1.3.2 2.5.9 3.6"/><path d="M9.5 20.5v-2.6c0-1-.4-2-1.1-2.7"/><path d="M3.2 6.2 1.6 5.1M4.6 2.6 3.9 1M8.6 1.6 8.4 0"/></g>`,
  // 腦血管：血滴內含一段心電圖線
  vascular: `<path d="M12 21.5c3.6 0 6.5-2.8 6.5-6.3 0-4.2-6.5-12.7-6.5-12.7S5.5 11 5.5 15.2c0 3.5 2.9 6.3 6.5 6.3z"/><path d="M9 14.5h2l1.2 2.6L13.6 12l1 2.5h1.4"/>`,
  // 神經退化與動作障礙：走路的人（站主從四個候選裡挑的）。
  //
  // 換掉原本「振幅遞減的波」的理由不只是造型偏好：那個波的 bbox 只有
  // 19 × 8.3，另外三個是 20.5、19、20 ⸺ 矮一半，排在一起時視覺重量明顯輕，
  // 看起來不像同一套。這一版是 10.4 × 19.2，與其他三個等高。
  //
  // 語意上它是四個裡唯一畫「人」的：這一格底下是失智症、巴金森氏症、顫抖、
  // 步態異常，講的都是一個人怎麼動。
  //
  // translate 是把幾何中心從 (12, 11.4) 校到 (12, 12)，與另外三個一致。
  degeneration: `<g transform="translate(-0.6 0.6)"><circle cx="14.5" cy="4" r="2.2"/><path d="M14.5 6.4 12.4 12.6"/><path d="M14.4 8.6 10.4 7.2M14.4 8.6l3.4 2.4"/><path d="M12.4 12.6 8.6 16.4 7.4 21M12.4 12.6l3 3.2.9 5.2"/></g>`,
  // 慢性疼痛：閃電，神經痛的通用視覺語彙
  pain: `<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z"/>`,
};

function specialtyIcon(key) {
  if (!key) return "";
  const paths = SPECIALTY_ICONS[key];
  if (!paths) {
    console.warn(
      `  ⚠ specialties 的 icon「${key}」不存在（可用：${Object.keys(
        SPECIALTY_ICONS
      ).join("、")}），這一組會沒有圖示`
    );
    return "";
  }
  return `<span class="specialty-icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg></span>`;
}

/**
 * 門診專長列表。
 *
 * 這些字在 Hero 圖片裡也有一份，但圖片在手機上會縮到 0.28 倍，
 * 圖中的字只剩約 8px，讀不了；而且不管在什麼尺寸下，
 * 烤進 JPEG 的文字對搜尋引擎和螢幕閱讀器都等於不存在。
 *
 * 「頭痛」「偏頭痛」「肉毒桿菌」正好是病人會拿來搜尋的詞，
 * 所以這裡另外輸出一份真正的網頁文字。只放首頁 ⸺ 這是站台身分資訊，
 * 每篇文章都掛一份只會變成雜訊。
 *
 * 造型上刻意做成「組名 + 一句文字」的描述清單，不是一排藥丸：
 * 這個站的視覺規則是「有框的圓角塊 = 可以點」（文章卡、目錄卡都是），
 * 專長清單不可點，就不該長成那樣。<dl> 裡包一層 <div> 是 HTML5 合法的
 * （dl > div > dt+dd），也是讓 dt 與 dd 能一起參與 grid 排版的乾淨做法。
 *
 * items 在這裡就用「、」串成真文字。絕對不要改成用 CSS ::after 產生分隔號 ⸺
 * ::after 的內容不算進 textContent，純文字擷取器、螢幕閱讀器與搜尋引擎
 * 讀到的會是「肉毒桿菌單株抗體頭痛口服標靶」黏成一團，
 * 那正好毀掉這個區塊存在的理由。
 */
function specialtyBlock() {
  // 資料格式是 [{ group, icon, items: [] }]。組名或項目缺一不可，
  // 兩者都是要給搜尋引擎讀的真文字，只有其中一半沒有意義。
  // icon 是選用的：沒填就沒有圖示，填錯會在 specialtyIcon() 裡警告。
  const groups = (Array.isArray(CFG.specialties) ? CFG.specialties : [])
    .map((g) => ({
      group: String(g?.group ?? "").trim(),
      icon: String(g?.icon ?? "").trim(),
      items: (Array.isArray(g?.items) ? g.items : [])
        .map((s) => String(s ?? "").trim())
        .filter(Boolean),
    }))
    .filter((g) => g.group && g.items.length);

  if (!groups.length) return "";

  return `      <h2 class="section-label" id="specialties"><span>門診專長</span></h2>

      <dl class="specialty-groups">
${groups
  .map(
    (g) => `        <div class="specialty-group">
          <dt>${specialtyIcon(g.icon)}<span>${esc(g.group)}</span></dt>
          <dd>${g.items.map(esc).join("、")}</dd>
        </div>`
  )
  .join("\n")}
      </dl>

`;
}

/**
 * 首頁的錨點導覽條。
 *
 * 目的很單純：讓第一次來的人一眼看到這個站有什麼。刻意不做成頁籤 ⸺
 * 頁籤會把三分之二的內容藏起來，跟「關於醫師」要做成可見連結的方向相反。
 * 這裡三個區塊全部都在頁面上，導覽只是幫忙跳過去。
 *
 * 純 <a href="#id">，沒有 JS 也完全可用；平滑捲動由 CSS 負責，
 * 而且只在使用者沒有要求減少動態時才啟用（見 styles.css）。
 * 也刻意不做 sticky ⸺ 手機上一直吃掉垂直空間，不符合這個站克制的調性。
 *
 * 項目依實際存在的區塊產生，不會指向空的錨點；
 * 只剩一項時整條不輸出，那時候它已經不是導覽了。
 */
function homeNav({ hasSpecialties, hasClinicHours, hasPosts, hasAuthor }) {
  const items = [];
  if (hasSpecialties) items.push(["specialties", "門診專長"]);
  if (hasPosts) items.push(["posts", "衛教文章"]);
  if (hasAuthor) items.push(["author", "關於醫師"]);
  if (hasClinicHours) items.push(["clinic", "門診時段"]);

  if (items.length < 2) return "";

  return `      <nav class="site-nav" aria-label="本頁內容">
        <ul>
${items
  .map(([id, label]) => `          <li><a href="#${id}">${esc(label)}</a></li>`)
  .join("\n")}
        </ul>
      </nav>

`;
}

/**
 * 首頁的「等看診的這幾天」引導區。
 *
 * 這一區在做什麼：首頁的讀者多半是還沒看診、或已經約好門診的人。
 * 站上最該先讀的不是任何一篇病理說明，而是「先把症狀記下來」。
 * 所以整區只有一個出口 ⸺ 多放幾條連結，它就變成第二個導覽列了。
 *
 * 文案全部放在 site.config.json 的 visitCallout，這裡不寫死任何一個字：
 * 站主日後想改一句話不該碰程式碼。字數上限也寫在那裡的註解 ⸺
 * 標題硬上限 11 字、說明硬上限 38 字，超過手機會破版。
 *
 * 四個欄位缺任何一個就整塊不輸出（比照 homeNav() 的 items.length < 2）。
 * 寧可沒有這一區，也不要一個空框或一句沒有出口的召喚。
 *
 * 標記上的四個決定：
 * - 用 <div> 不用 <aside>／<section>：後兩者會生 landmark，
 *   為三行字多一個 landmark 是噪音。
 * - 標題用真的 <h2>：靠標題導覽的讀者跳得到。
 * - 整塊不可點，只有連結可點：這個站「有框的圓角塊 = 可以點」是給卡片的；
 *   這一塊只有左色條、只有右側圓角，它講的是引言的話。
 * - 不加進 homeNav()：那三項是頁內錨點，加第四項會稀釋一個刻意做得很輕的導覽。
 *
 * @param {string} pad  這一塊在輸出的 HTML 裡的縮排
 * @param {string} rel  回到站根的相對路徑。目前只有首頁會呼叫，所以是 ""。
 */
function visitCalloutBlock({ pad = "      ", rel = "" } = {}) {
  const c = CFG.visitCallout || {};
  const title = String(c.title ?? "").trim();
  const text = String(c.text ?? "").trim();
  const label = String(c.linkLabel ?? "").trim();
  const url = String(c.linkUrl ?? "").trim();

  if (!title || !text || !label || !url) return "";

  // linkUrl 慣例與 authorBio.links 相同：不是 http(s) 開頭就當站內連結，
  // 用 rel 前綴組出相對路徑，不開新分頁、不加 ↗。
  const href = safeUrl(url);
  const external = /^(https?:)?\/\//i.test(href);
  const resolved = external ? href : rel + String(href).replace(/^\/+/, "");

  return `${pad}<div class="visit-callout">
${pad}  <h2 class="visit-callout-title">${esc(title)}</h2>
${pad}  <p class="visit-callout-text">${esc(text)}</p>
${pad}  <p class="visit-callout-action"><a href="${esc(resolved)}">${esc(
    label
  )}</a></p>
${pad}</div>

`;
}

/**
 * 「關於醫師」區塊。首頁與每篇文章結尾各一份。
 *
 * 為什麼要有這一區：authorProfile.sameAs 與 worksFor 是寫給機器的身分宣告，
 * 讀者一個字都看不到。病人從搜尋或 AI 導流進來，多半直接落在文章頁、
 * 從不經過首頁 ⸺ 醫療內容尤其需要在讀到當下就知道作者是誰、在哪執業。
 * 而且看得見、點得到的超連結，權重本來就高於只寫在 sameAs 裡的宣告，
 * 兩者並存才完整，所以這裡刻意不加 rel="nofollow"。
 *
 * 介紹句直接讀 authorProfile.description，不在 authorBio 另存一份 ⸺
 * 同一句話放兩個地方，遲早各自演化成兩句。
 *
 * 標記用 <address>：它的定義正好就是「最近的 article 或 body 祖先的
 * 聯絡資訊」，文章頁包在 <article> 的 <footer> 裡，作用域自然對上這篇文章。
 * 標題必須是 <address> 的兄弟而不是子元素 ⸺ <address> 的內容模型
 * 不允許 heading 與 sectioning content。
 *
 * 標題列左側有一張小頭貼。它是純裝飾（見下方 alt 的說明），首頁與文章頁
 * 目前都顯示 ⸺ 若日後覺得每篇文章結尾都出現一張臉太多，改一行就好，
 * 見函式裡的 showAvatar。
 *
 * @param {boolean} opts.intro  是否輸出整段介紹。首頁要；文章頁的精簡版
 *                              只要姓名、職稱機構與連結，不重複整段自我介紹。
 * @param {string}  opts.pad    這一塊在輸出的 HTML 裡的縮排
 * @param {string}  opts.rel    從目前這一頁回到站根的相對路徑。首頁是 ""，
 *                              文章頁是 "../../"。頭貼與站內連結都要用它。
 */
function authorBioBlock({ intro = false, pad = "      ", rel = "" } = {}) {
  const bio = CFG.authorBio || {};
  const profile = CFG.authorProfile || {};

  // 首頁要濾掉指向本頁錨點的連結（"/#clinic"）⸺ 門診時段區就在這張卡片
  // 正下方約 250px 處，點了畫面幾乎不動，而首頁的錨點導覽列已經有那一項。
  // 文章頁不濾：那裡它會解析成 ../../#clinic，是真的把人帶回首頁，有價值。
  const links = (Array.isArray(bio.links) ? bio.links : []).filter(
    (l) => l && l.label && l.url && !(intro && String(l.url).startsWith("/#"))
  );
  const introText = intro ? bio.intro || profile.description || "" : "";

  if (!links.length && !introText) return "";

  // 只放職稱，不接機構名稱：下面第一個連結的錨點文字已經是
  // 「羅東博愛醫院 神經內科主治醫師」，同一張卡片裡重複兩次很吵，
  // 精簡版（文章結尾）少了中間那段介紹，兩行更是直接疊在一起。
  // 機構的機器可讀宣告完整留在 JSON-LD 的 worksFor，錨點文字也沒有動，
  // 所以「羅東博愛醫院」在頁面上仍然出現、而且是可點的連結。
  const role = esc(profile.jobTitle || "");

  // 箭頭是純裝飾，用 aria-hidden 讓螢幕閱讀器跳過，
  // 不然每個連結都會多念一句「東北方向箭頭」。
  //
  // 站內連結（url 不是 http(s) 開頭，例如 "/about/"）走另一條路：不開新分頁、
  // 不加 ↗。讀者還在同一個站，硬開新視窗只是多留一個分頁給他關；而 ↗ 這個
  // 記號在這個站的意思就是「會離開本站」，站內連結掛上去等於說謊。
  // 站內連結一律用 rel 前綴組出相對路徑，文章頁在 /posts/<slug>/ 底下也不會斷。
  const linkList = links.length
    ? `${pad}    <ul class="author-links">
${links
  .map((l) => {
    const href = safeUrl(l.url);
    const external = /^(https?:)?\/\//i.test(href);
    const target = external
      ? ` target="_blank" rel="noopener noreferrer"`
      : "";
    const arrow = external
      ? `<span class="ext" aria-hidden="true">↗</span>`
      : "";
    const resolved = external ? href : rel + String(href).replace(/^\/+/, "");
    return `${pad}      <li><a href="${esc(resolved)}"${target}>${esc(
      l.label
    )}${arrow}</a></li>`;
  })
  .join("\n")}
${pad}    </ul>`
    : "";

  // 頭貼要不要出現。目前首頁與文章頁都出現。
  // 若日後覺得每篇文章結尾都掛一張臉太多，把這一行改成
  //     const showAvatar = intro;
  // 就只剩首頁 ⸺ intro 只有 renderIndex() 會傳 true。HTML、CSS 都不必再動。
  const showAvatar = true;

  // alt="" + aria-hidden="true" 是刻意的，不是漏寫描述。
  // 外層 <section class="author-bio" aria-labelledby="author"> 的無障礙名稱
  // 是從這個 <h2> 的內容算出來的，img 只要帶了 alt 就會被串進去，
  // 整個 landmark 會被唸成「吳旻陽醫師的半身照 關於醫師」。
  // 頭貼在這裡也確實是裝飾：旁邊的姓名、職稱與連結已經把「這是誰」講完了。
  //
  // src 一定要帶 rel。這個函式同時輸出首頁（rel = ""）與文章頁
  // （rel = "../../"），寫死 assets/... 文章頁會 404。
  // width/height 是原始像素比例，CSS 兩軸都寫死，所以載入前後不會有 CLS。
  // loading="lazy" 沒問題 ⸺ 這一區在首頁與文章頁都在很下面。
  const heading = esc(bio.heading || "關於醫師");
  const headingRow = showAvatar
    ? `${pad}  <h2 class="section-label section-label--avatar" id="author">
${pad}    <img class="author-avatar" src="${esc(rel)}assets/avatar-wu-min-yang.jpg"
${pad}         width="256" height="256" alt="" aria-hidden="true"
${pad}         loading="lazy" decoding="async">
${pad}    <span>${heading}</span>
${pad}  </h2>`
    : `${pad}  <h2 class="section-label" id="author"><span>${heading}</span></h2>`;

  return `${pad}<section class="author-bio" aria-labelledby="author">
${headingRow}
${pad}  <address class="author-body">
${pad}    <p class="author-name">${esc(CFG.author)}</p>
${role ? `${pad}    <p class="author-role">${role}</p>\n` : ""}${
    introText ? `${pad}    <p class="author-intro">${esc(introText)}</p>\n` : ""
  }${linkList}
${pad}  </address>
${pad}</section>`;
}

function renderIndex(posts) {
  const cards = posts
    .map(
      (p) => `        <li class="card">
          <a class="card-link" href="posts/${esc(p.slug)}/">
            <h2 class="card-title">${esc(p.title)}</h2>
${p.summary ? `            <p class="card-summary">${esc(p.summary)}</p>\n` : ""}          </a>
          ${metaRow(p, p.slug)}
        </li>`
    )
    .join("\n");

  const specialties = specialtyBlock();
  const clinicHours = clinicHoursBlock();
  const visitCallout = visitCalloutBlock({});
  const authorBio = authorBioBlock({ intro: true });
  const nav = homeNav({
    // 刻意看 specialtyBlock() 的實際輸出，而不是自己再判斷一次 CFG.specialties ⸺
    // 資料格式改過一次（字串陣列 → { group, items }），兩邊各判斷一次遲早會不同步，
    // 導覽就會多出一個指向不存在錨點的項目。區塊沒輸出，導覽就沒有那一項。
    hasSpecialties: !!specialties,
    hasClinicHours: !!clinicHours,
    hasPosts: posts.length > 0,
    hasAuthor: !!authorBio,
  });

  const main = `${heroBlock(CFG.hero, "", true)}

      <div class="intro">
        <h1>${esc(CFG.title)}</h1>
        <p>${esc(CFG.description)}</p>
      </div>

      <p class="meta">
          <span class="author">${esc(CFG.author)}</span>
          <span class="views" data-views-for="${esc(CFG.supabase.homeSlug)}" hidden></span>
      </p>

${visitCallout}${specialties}
      <h2 class="section-label" id="posts"><span>衛教文章</span><span>共 ${posts.length} 篇</span></h2>

      <ul class="card-list">
${cards}
      </ul>

${authorBio}

${clinicHours}`;

  return layout({
    title: CFG.title,
    description: CFG.description,
    rel: "",
    pageSlug: CFG.supabase.homeSlug,
    bodyClass: "page-home",
    headerNav: nav,
    main,
    hero: CFG.hero,
    canonical: HOME_URL,
    jsonLd: homeJsonLd(),
  });
}

/**
 * 從已渲染的內文抓出 h2／h3 產生目錄。
 *
 * 直接解析輸出的 HTML 而不是原始 Markdown，是為了拿到 markdown() 已經
 * 算好的 id ⸺ 兩邊各自 slug 化遲早會不一致，錨點就會失效。
 *
 * 標題少於兩個就不輸出：一篇只有一節的文章掛目錄只是噪音。
 */
function tableOfContents(html) {
  const heads = [];
  const re = /<h([23]) id="([^"]*)">([\s\S]*?)<\/h\1>/g;
  let m;
  while ((m = re.exec(html))) {
    heads.push({
      level: Number(m[1]),
      id: m[2],
      // 標題裡可能有 <code>、<em> 之類，目錄只要純文字
      text: m[3].replace(/<[^>]+>/g, "").trim(),
    });
  }

  if (heads.length < 2) return "";

  const parts = [];
  let inSub = false;
  for (const h of heads) {
    if (h.level === 2) {
      if (inSub) {
        parts.push("</ul></li>");
        inSub = false;
      } else if (parts.length) {
        parts.push("</li>");
      }
      parts.push(`<li><a href="#${esc(h.id)}">${esc(h.text)}</a>`);
    } else {
      if (!parts.length) {
        // 文章以 h3 開頭這種罕見情況，補一個容器免得結構壞掉
        parts.push("<li>");
      }
      if (!inSub) {
        parts.push('<ul class="toc-sub">');
        inSub = true;
      }
      parts.push(`<li><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`);
    }
  }
  if (inSub) parts.push("</ul>");
  if (parts.length) parts.push("</li>");

  return `        <nav class="toc" aria-labelledby="toc-heading">
          <h2 class="toc-heading" id="toc-heading">本篇目錄</h2>
          <ul class="toc-list">${parts.join("")}</ul>
        </nav>`;
}

function renderPost(post) {
  const rel = "../../";
  const toc = tableOfContents(post.html);
  const main = `      <a class="back-link" href="${rel}">← 回到文章列表</a>

      <article class="post">
        <header class="post-header">
          <h1>${esc(post.title)}</h1>
          ${metaRow(post, post.slug)}
        </header>

${heroBlock(post.hero, rel, true)}

${toc}

        <div class="post-body">
${post.html}
        </div>

        <footer class="post-footer">
${authorBioBlock({ pad: "          ", rel })}
        </footer>
      </article>`;

  return layout({
    title: post.title,
    description: post.summary || CFG.description,
    rel,
    pageSlug: post.slug,
    bodyClass: "page-post",
    main,
    hero: post.hero,
    social: post.social,
    canonical: abs(`posts/${post.slug}/`),
    post,
    jsonLd: postJsonLd(post),
  });
}

/**
 * 獨立頁面（content/pages/）。
 *
 * 版面刻意與文章共用同一組 class（.post-header／.post-body／.toc）⸺
 * 內文的排版規則本來就該一致，另立一套只會讓兩邊慢慢長歪。真正的差別
 * 放在 <body> 的 page-standalone 上，需要時再各自微調。
 *
 * 不輸出文章結尾那塊「關於醫師」：頁面本身可能就是在講作者（/about/），
 * 同一頁出現兩個「關於醫師」標題只是噪音，錨點 id 還會撞在一起。
 *
 * meta 列只在有填 updated 時才顯示日期 ⸺ 頁面沒有發布日，硬擠一個
 * 建置日期上去等於在騙讀者。
 */
function renderPage(page) {
  const rel = "../";
  const toc = tableOfContents(page.html);

  const metaParts = [];
  if (page.updated) {
    metaParts.push(
      `<time datetime="${isoDate(page.updated)}">更新 ${fmtDate(page.updated)}</time>`
    );
  }
  metaParts.push(
    `<span class="views" data-views-for="${esc(page.slug)}" hidden></span>`
  );

  const main = `      <a class="back-link" href="${rel}">← 回到首頁</a>

      <article class="post">
        <header class="post-header">
          <h1>${esc(page.title)}</h1>
          <p class="meta">${metaParts.join("\n          ")}</p>
        </header>

${heroBlock(page.hero, rel, true)}

${toc}

        <div class="post-body">
${page.html}
        </div>
      </article>`;

  return layout({
    title: page.title,
    description: page.description || CFG.description,
    rel,
    pageSlug: page.slug,
    bodyClass: "page-standalone",
    main,
    hero: page.hero,
    social: page.social,
    canonical: abs(`${page.slug}/`),
    noindex: page.unlisted,
    jsonLd: pageJsonLd(page),
  });
}

/**
 * 404 頁刻意做成自給自足的單檔：樣式內嵌，不連外部 CSS。
 *
 * 原因是這一頁可能被任何深度的網址觸發（/a/、/a/b/c/），相對路徑會失準；
 * 而根目錄絕對路徑又只在網站掛在網域根部時才對 ⸺ GitHub Pages 的專案站
 * 是掛在 /beyond-headache/ 底下的。內嵌樣式讓它在兩邊都正常。
 */
function render404() {
  return `<!doctype html>
<html lang="${esc(CFG.lang)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>找不到這一頁｜${esc(CFG.title)}</title>
  <meta name="robots" content="noindex">
  <meta name="color-scheme" content="light dark">
  <style>
    :root { color-scheme: light dark; --ink:#191c24; --soft:#4d515c; --paper:#fbfcfd; --accent:#23417d; }
    @media (prefers-color-scheme: dark) {
      :root { --ink:#e9ebf1; --soft:#adb3c1; --paper:#1b2338; --accent:#a8c0ea; }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      padding: 1.5rem;
      background: var(--paper); color: var(--ink);
      font-family: "Noto Sans TC","PingFang TC","Microsoft JhengHei",-apple-system,system-ui,sans-serif;
      line-height: 1.85; overflow-wrap: break-word;
    }
    main { width: min(100%, 32rem); }
    h1 { font-size: clamp(1.4rem, 6vw, 1.9rem); line-height: 1.45; margin: 0 0 .75rem; letter-spacing: .02em; }
    p { color: var(--soft); margin: 0 0 1.5rem; }
    a { color: var(--accent); }
  </style>
</head>
<body>
  <main>
    <h1>找不到這一頁</h1>
    <p>網址可能已經變動，或是這篇文章還沒寫出來。</p>
    <p><a href="./">← 回到文章列表</a></p>
  </main>
  <script>
    // 回首頁的連結：從目前網址推回站台根目錄。
    // GitHub Pages 專案站掛在 /<repo>/ 底下，Cloudflare Pages 掛在網域根部，
    // 兩種情況都要能正確回到首頁。
    (function () {
      var host = location.hostname;
      var home = host.endsWith(".github.io") && location.pathname.split("/")[1]
        ? "/" + location.pathname.split("/")[1] + "/"
        : "/";
      document.querySelector("main a").setAttribute("href", home);
    })();
  </script>
</body>
</html>
`;
}

/* =======================================================================
 * 機器讀的檔案：sitemap / robots / RSS
 * ===================================================================== */

/**
 * 全站最後一次有內容變動的時間 ＝ 所有文章 updated 的最大值。
 *
 * 刻意不寫 posts[0].updated。文章現在照 published 排序（見 loadPosts），
 * posts[0] 是「最新發布」而不是「最近更新」⸺ 改一篇舊文的話那個值不會動，
 * feed 的 lastBuildDate 與 sitemap 首頁的 lastmod 就會宣告「沒變」，
 * 但實際上變了。一篇都沒有時退回 fallback（建置時間）。
 */
function latestUpdated(posts, fallback) {
  if (!posts.length) return fallback;
  return posts.reduce((max, p) => (p.updated > max ? p.updated : max), posts[0].updated);
}

/**
 * sitemap.xml。
 *
 * lastmod 一律沿用 post.updated（見 updatedDate）⸺ 也就是 front matter 的
 * updated，沒填就等於發布日。不另外造一套日期，否則 sitemap 上的時間和站上
 * 顯示的會對不起來。
 * 首頁的 lastmod 取全站最大的 updated（latestUpdated）⸺ 首頁的內容就是文章
 * 列表，任何一篇改過首頁就算改過，不是只看排在最前面那一篇。
 */
function renderSitemap(posts, pages = []) {
  const entries = [
    {
      loc: HOME_URL,
      lastmod: latestUpdated(posts, new Date()),
      changefreq: "weekly",
      priority: "1.0",
    },
    ...posts.map((p) => ({
      loc: abs(`posts/${p.slug}/`),
      lastmod: p.updated,
      changefreq: "monthly",
      priority: "0.8",
    })),
    // 頁面沒有 updated 就整個省略 lastmod ⸺ 這個欄位是選用的，
    // 拿建置時間充數的話每建一次就宣告「這頁改過了」，久了爬蟲就不信了。
    ...pages.map((p) => ({
      loc: abs(`${p.slug}/`),
      lastmod: p.updated || null,
      changefreq: "yearly",
      priority: "0.6",
    })),
  ];

  const urls = entries
    .map(
      (e) => `  <url>
    <loc>${xesc(e.loc)}</loc>
${e.lastmod ? `    <lastmod>${xesc(isoDateTime(e.lastmod))}</lastmod>\n` : ""}    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

/**
 * robots.txt。
 *
 * AI 爬蟲全部明確放行，這是站主的決定：擋掉這些 user-agent 等於自願從
 * AI 的答案裡消失，而這個站的目的正是讓找答案的人找得到正確的說法。
 * 「沒寫規則」和「明確 Allow」在協定上效果一樣，但明確寫出來的好處是
 * 之後任何人來改都看得到這是深思過的選擇，不會順手加一條 Disallow。
 */
const AI_CRAWLERS = [
  // OpenAI：訓練、即時取用、搜尋索引
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  // Anthropic
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  // Perplexity
  "PerplexityBot",
  "Perplexity-User",
  // Google 的 AI 產品（與 Googlebot 的一般索引分開控制）
  "Google-Extended",
  // Apple Intelligence
  "Applebot-Extended",
  // 其他
  "CCBot",
  "Bytespider",
  "Amazonbot",
  "meta-externalagent",
  "cohere-ai",
  "DuckAssistBot",
  "YouBot",
];

function renderRobots() {
  const blocks = [
    "# 頭痛之外｜robots.txt",
    "# 全站開放索引，AI 爬蟲一律明確放行（詳見 build.mjs 的說明）。",
    "",
    "User-agent: *",
    "Allow: /",
    "",
    "# ── AI／語言模型爬蟲：明確允許 ──",
  ];

  for (const ua of AI_CRAWLERS) {
    blocks.push("", `User-agent: ${ua}`, "Allow: /");
  }

  blocks.push("", `Sitemap: ${SITEMAP_URL}`, "");
  return blocks.join("\n");
}

/**
 * site.webmanifest（把網站加到手機主畫面時瀏覽器會讀它）。
 *
 * 以前這是 static/ 底下一個手寫的檔案，build 只負責複製 ⸺ 於是它自己抄了
 * 一份 name 與 description，改 site.config.json 時不會跟著動。而且真的漂走
 * 過兩處：description 停在舊版的站台介紹；name 寫「頭痛之外｜吳旻陽醫師」，
 * 少了 CFG.author 裡「吳旻陽 醫師」中間那個半形空格（HTML 的 <title> 有）。
 * 改成產生的之後就不可能再漂。
 *
 * icons 那幾行留在這裡是對的 ⸺ 它描述的是 static/ 裡的實體檔案，不是設定。
 * background_color 則刻意跟 styles.css 的 --paper 對齊，兩邊要一起改；
 * 那是 CSS 變數，build 不去解析樣式表。
 */
const PAPER_LIGHT = "#fbfcfd"; // = styles.css 的 --paper（淺色模式底色）

function renderManifest() {
  const manifest = {
    // 與首頁 <title> 同一個組法（見 layout()），連那個半形空格都一樣
    name: `${CFG.title}｜${CFG.author}`,
    short_name: CFG.title,
    description: CFG.description,
    lang: CFG.lang,
    start_url: "./",
    scope: "./",
    display: "standalone",
    theme_color: CFG.brandColor,
    background_color: PAPER_LIGHT,
    icons: [
      { src: "./icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "./icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}

/**
 * 分類導覽的到期通知。
 *
 * 站主 2026-08-24 決定分類導覽採「兩軸」：軸一是疾病主題（頭痛、腦中風、
 * 失智），只有這一軸進首頁導覽；軸二是文章類型（就醫準備、門診觀察、
 * 關於本站），不進導覽。規格在 .workroom/brief-taxonomy-nav.md（不進版控）。
 *
 * 實作被刻意延後，因為設計上「0 篇的分類不輸出」⸺ 只有一個主題有文章時，
 * 導覽會只長出一顆孤零零的標籤，看起來像壞掉。要等第二個疾病主題落地。
 *
 * 這段的存在是因為那個時機**不該靠人記得**。搬文章的人（不管是站主還是
 * 之後接手的誰）只要跑一次建置就會看到這行，不必去翻任何筆記。
 * 條件滿足之後這段就沒有用處了，實作導覽時連同這段一起刪掉。
 */
const DISEASE_TOPICS = {
  頭痛: ["頭痛"],
  腦中風: ["腦中風", "中風"],
  失智: ["失智", "失智症"],
};

function reportTaxonomyNavReadiness(listed) {
  const hit = Object.entries(DISEASE_TOPICS)
    .map(([topic, aliases]) => [
      topic,
      listed.filter((p) => p.tags.some((t) => aliases.includes(t))).length,
    ])
    .filter(([, n]) => n > 0);

  if (hit.length < 2) return;

  console.log(
    `\n  ★ 分類導覽可以實作了 ⸺ 疾病主題已經有 ${hit.length} 個有文章：` +
      hit.map(([t, n]) => `${t} ${n} 篇`).join("、")
  );
  console.log(
    `    規格見 .workroom/brief-taxonomy-nav.md。做完請把 build.mjs 裡的`
  );
  console.log(`    reportTaxonomyNavReadiness() 一併刪掉。`);
}

/**
 * RSS 2.0。
 *
 * 選 RSS 而不是 Atom：閱讀器、電子報服務、各種聚合器對 RSS 的支援最沒有
 * 例外，而這裡需要的欄位 RSS 全都有。自我描述的 atom:link 還是照補。
 *
 * description 只放 summary，不放全文 ⸺ 全站是靜態網頁，正文留在網站上
 * 讀比較好，feed 的工作是通知有新文章。
 */
function renderFeed(posts) {
  const now = new Date();

  const items = posts
    .slice(0, 20)
    .map((p) => {
      const url = abs(`posts/${p.slug}/`);
      const cats = p.tags
        .map((t) => `      <category>${xesc(t)}</category>`)
        .join("\n");
      return `    <item>
      <title>${xesc(p.title)}</title>
      <link>${xesc(url)}</link>
      <guid isPermaLink="true">${xesc(url)}</guid>
      <pubDate>${xesc(rfc822(p.published))}</pubDate>
      <dc:creator>${xesc(p.author)}</dc:creator>
      <description>${xesc(p.summary || CFG.description)}</description>${
        cats ? "\n" + cats : ""
      }
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${xesc(CFG.title)}</title>
    <link>${xesc(HOME_URL)}</link>
    <description>${xesc(CFG.description)}</description>
    <language>${xesc(CFG.lang)}</language>
    <copyright>© ${now.getFullYear()} ${xesc(CFG.author)}</copyright>
    <lastBuildDate>${xesc(rfc822(latestUpdated(posts, now)))}</lastBuildDate>
    <atom:link href="${xesc(FEED_URL)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

/* =======================================================================
 * 輸出
 * ===================================================================== */

function write(relPath, content) {
  const full = join(OUT_DIR, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function copyDir(from, to) {
  if (!existsSync(from)) return 0;
  let n = 0;
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) {
      n += copyDir(src, dst);
    } else {
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      n++;
    }
  }
  return n;
}

function build() {
  console.log(`\n建置「${CFG.title}」\n`);

  const posts = loadPosts();
  const pages = loadPages();

  // unlisted：頁面照樣產生，但不出現在任何「清單」裡 ⸺ 首頁、sitemap、RSS。
  // 頁面本身帶 noindex（見 headMeta），Google 不會收錄。這不是權限控制：
  // 知道網址的人仍然開得到，只是讀者不會偶然遇到。
  const listed = posts.filter((p) => !p.unlisted);
  const listedPages = pages.filter((p) => !p.unlisted);

  // Person 的 mainEntityOfPage ⸺ 這個人在站內的權威身分頁。
  // 由頁面自己宣告 schemaType: ProfilePage，不用檔名寫死。
  const profilePages = listedPages.filter((p) => p.schemaType === "ProfilePage");
  if (profilePages.length > 1) {
    console.warn(
      `  ⚠ 有 ${profilePages.length} 頁宣告 schemaType: ProfilePage，` +
        `Person 的 mainEntityOfPage 只能有一個，採用 /${profilePages[0].slug}/`
    );
  }
  PROFILE_PAGE_URL = profilePages.length ? abs(`${profilePages[0].slug}/`) : "";

  // 頁面與文章的網址不會撞（/x/ 對 /posts/x/），但瀏覽計數用的是 slug 本身，
  // 同名就會把兩邊的數字加在一起。
  const postSlugs = new Set(posts.map((p) => p.slug));
  for (const pg of pages) {
    if (postSlugs.has(pg.slug)) {
      console.warn(
        `  ⚠ 頁面 /${pg.slug}/ 與文章 /posts/${pg.slug}/ 的 slug 相同，瀏覽計數會混在一起`
      );
    }
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  write("index.html", renderIndex(listed));
  write("404.html", render404());
  for (const p of posts) {
    write(join("posts", p.slug, "index.html"), renderPost(p));
  }
  for (const pg of pages) {
    write(join(pg.slug, "index.html"), renderPage(pg));
  }

  write("sitemap.xml", renderSitemap(listed, listedPages));
  write("robots.txt", renderRobots());
  write("feed.xml", renderFeed(listed));
  write("site.webmanifest", renderManifest());

  copyFileSync(join(ROOT, "src", "styles.css"), join(OUT_DIR, "styles.css"));
  copyFileSync(join(ROOT, "src", "counter.js"), join(OUT_DIR, "counter.js"));
  copyFileSync(join(ROOT, "src", "enhance.js"), join(OUT_DIR, "enhance.js"));
  const assets = copyDir(join(ROOT, "assets"), join(OUT_DIR, "assets"));
  copyDir(join(ROOT, "static"), OUT_DIR);

  // GitHub Pages 預設會跑 Jekyll，這個檔案讓它原樣發布
  writeFileSync(join(OUT_DIR, ".nojekyll"), "");

  console.log(
    `  文章    ${listed.length} 篇` +
      (posts.length - listed.length
        ? `（另有 ${posts.length - listed.length} 篇未列出）`
        : "")
  );
  for (const p of posts) {
    const upd = sameDay(p.published, p.updated)
      ? ""
      : `（更新 ${isoDate(p.updated)}）`;
    console.log(
      `          /posts/${p.slug}/  ${isoDate(p.published)} ${upd}` +
        (p.unlisted ? `  ← 未列出、不被搜尋` : ``)
    );
  }
  if (pages.length) {
    console.log(`  頁面    ${pages.length} 頁（不進首頁列表、不進 RSS）`);
    for (const pg of pages) {
      console.log(
        `          /${pg.slug}/  ${pg.schemaType}` +
          (pg.updated ? `（更新 ${isoDate(pg.updated)}）` : ``) +
          (pg.unlisted ? `  ← 未列出、不被搜尋` : ``)
      );
    }
  }
  console.log(`  素材    ${assets} 個`);
  console.log(`  SEO     sitemap.xml、robots.txt、feed.xml`);
  console.log(`  網址    ${HOME_URL}`);

  reportTaxonomyNavReadiness(listed);

  if (!CFG.supabase.url || !CFG.supabase.anonKey) {
    console.log(`\n  ⚠ site.config.json 尚未填入 Supabase 設定，計數器暫時隱藏。`);
  }

  console.log(`\n完成 → ${OUT_DIR}\n`);
}

build();
