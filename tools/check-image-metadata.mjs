#!/usr/bin/env node
// 擋下帶身分中繼資料的圖檔，別讓它們進版控。
//
// 為什麼要有這個檔：source/portrait.png 曾經帶著 Canva 的 Attrib:FbId、
// pdf:Author 的真實姓名，還有 Canva 的 user／brand／document ID 進了公開 repo，
// 18 天後才被人工掃到。手機拍的診間照風險更高 ⸺ JPEG 的 APP1 會夾帶
// GPS 座標與機身序號。這些欄位在看圖軟體裡一個都不會顯示，但檔案裡確實有，
// 而且一旦推上 GitHub 與 CDN 就撤不回來。
//
// 偵測一律按 chunk／segment 解析，不用字串搜尋 ⸺ 文字 chunk 可能是 zlib
// 壓縮的（zTXt／iTXt），而就算是明文，UTF-8 的中文也會被 ASCII 掃描漏掉。
// 「strings 搜不到關鍵字」不能當成通過。
//
// 用法：
//   node tools/check-image-metadata.mjs                 掃全站（git 追蹤中的圖檔）
//   node tools/check-image-metadata.mjs a.png b.jpg     只掃指定檔案
//   node tools/check-image-metadata.mjs --staged        只掃這次 staged 的圖檔（pre-commit 用）
//   node tools/check-image-metadata.mjs --strip a.png   無損剝除（會改寫檔案，需明確指定）
//
// 離開碼：0 乾淨、1 驗到該擋的中繼資料、2 用法或讀檔錯誤。

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { inflateSync } from "node:zlib";

const IMAGE_EXT = /\.(png|jpe?g|webp|ico|gif)$/i;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// 要擋的 PNG chunk。tEXt／zTXt／iTXt 是文字（XMP 就藏在 iTXt 裡），
// eXIf 是整包 Exif，tIME 是最後修改時間 ⸺ 時間本身也是資訊。
const PNG_BLOCK = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

// 要留的 PNG chunk。sRGB／gAMA／iCCP 是色彩描述，pHYs 是實體密度，
// 丟了顏色會跑掉、尺寸會變 ⸺ 這幾個沒有任何身分資訊。
const PNG_SAFE = new Set([
  "IHDR", "PLTE", "IDAT", "IEND", "tRNS", "cHRM", "gAMA", "iCCP",
  "sBIT", "sRGB", "bKGD", "hIST", "pHYs", "sPLT",
  "acTL", "fcTL", "fdAT", // APNG
]);

// 要擋的 JPEG segment。APP1 是 Exif 與 XMP、APP13 是 Photoshop IRB
// （IPTC 作者欄位就在裡面）、COM 是註解。
const JPEG_BLOCK = new Map([
  [0xe1, "APP1"],
  [0xed, "APP13"],
  [0xfe, "COM"],
]);

const jpegName = (m) =>
  m >= 0xe0 && m <= 0xef ? `APP${m - 0xe0}` : `FF${m.toString(16).toUpperCase().padStart(2, "0")}`;

/** 取 segment 開頭的識別字串（APPn 慣例：以 NUL 結尾的 ASCII 標記）。 */
function segmentId(buf, from, to) {
  const zero = buf.indexOf(0, from);
  if (zero < 0 || zero > to || zero - from > 24) return "";
  return buf.toString("latin1", from, zero);
}

/** 把可能含控制字元的中繼資料內容壓成一行預覽，讓人一眼看出洩了什麼。 */
function preview(text, max = 90) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** 解析 PNG 文字 chunk 的關鍵字與內容 ⸺ 壓縮的要先 inflate，不然看不到。 */
function readPngText(type, data) {
  try {
    const zero = data.indexOf(0);
    if (zero < 0) return null;
    const keyword = data.toString("latin1", 0, zero);
    if (type === "tEXt") return { keyword, value: data.toString("latin1", zero + 1) };
    if (type === "zTXt") return { keyword, value: inflateSync(data.subarray(zero + 2)).toString("utf8") };
    if (type === "iTXt") {
      const compressed = data[zero + 1] === 1;
      const langEnd = data.indexOf(0, zero + 3);
      const transEnd = data.indexOf(0, langEnd + 1);
      const body = data.subarray(transEnd + 1);
      return { keyword, value: compressed ? inflateSync(body).toString("utf8") : body.toString("utf8") };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * PNG：8 byte 簽章之後就是 chunk 串 ⸺ 長度(4) 型別(4) 資料(len) CRC(4)。
 * 逐 chunk 走完，不猜、不搜尋。
 */
function scanPng(buf, findings, chunks) {
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    const end = p + 12 + len;
    if (len > buf.length || end > buf.length) {
      findings.push({ level: "note", what: "檔案結構", why: `chunk ${type} 長度超出檔案範圍，解析中止` });
      return;
    }
    const data = buf.subarray(p + 8, p + 8 + len);
    chunks.push({ type, start: p, end, data });

    if (PNG_BLOCK.has(type)) {
      let why;
      if (type === "tIME" && len === 7) {
        why = `最後修改時間 ${buf.readUInt16BE(p + 8)}-${String(data[2]).padStart(2, "0")}-${String(data[3]).padStart(2, "0")}`;
      } else if (type === "eXIf") {
        why = `內嵌 Exif ${len} bytes`;
      } else {
        const t = readPngText(type, data);
        why = t ? `${t.keyword}＝${preview(t.value)}` : `${len} bytes（無法解析內容，仍然要擋）`;
      }
      findings.push({ level: "block", what: `PNG ${type}`, why });
    } else if (!PNG_SAFE.has(type)) {
      findings.push({ level: "note", what: `PNG ${type}`, why: `${len} bytes，非標準 chunk，建議人工確認` });
    }
    if (type === "IEND") break;
    p = end;
  }
}

/**
 * JPEG：SOI 之後是 marker 串。多數 marker 帶 2 byte 長度，
 * 但 SOI／EOI／TEM／RSTn 是獨行的，沒有長度欄位。
 * 走到 SOS 之後是熵編碼資料，要跳過 FF00 填充與 RSTn 才能找到下一個 marker
 * ⸺ 漸進式 JPEG 有多個 scan，COM 也可能躲在後面。
 */
function scanJpeg(buf, findings, drops) {
  let p = 2;
  let firstScan = -1;
  while (p + 1 < buf.length) {
    if (buf[p] !== 0xff) { p += 1; continue; }
    const m = buf[p + 1];
    if (m === 0xff) { p += 1; continue; }                                  // 填充位元組
    if (m === 0x00) { p += 2; continue; }                                  // 熵資料裡的 FF00
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    if (m === 0xd9) break;                                                 // EOI
    if (p + 4 > buf.length) break;
    const len = buf.readUInt16BE(p + 2);
    const end = p + 2 + len;
    if (len < 2 || end > buf.length) {
      findings.push({ level: "note", what: "檔案結構", why: `${jpegName(m)} 長度異常，解析中止` });
      return firstScan;
    }
    const id = m >= 0xe0 && m <= 0xef ? segmentId(buf, p + 4, end) : "";

    if (JPEG_BLOCK.has(m)) {
      const name = JPEG_BLOCK.get(m);
      let why = `${len} bytes`;
      if (m === 0xe1) {
        const kind = id.startsWith("http://ns.adobe.com/xap") ? "XMP" : id === "Exif" ? "Exif" : id || "未知";
        why = `${kind}，${len} bytes`;
        if (kind === "XMP") why += `：${preview(buf.toString("utf8", p + 4 + id.length + 1, Math.min(end, p + 400)))}`;
      } else if (m === 0xed) {
        why = `Photoshop IRB（IPTC 作者／版權欄位），${len} bytes`;
      } else if (m === 0xfe) {
        why = `註解：${preview(buf.toString("utf8", p + 4, end))}`;
      }
      findings.push({ level: "block", what: `JPEG ${name}`, why });
      drops.push({ start: p, end, label: name });
    } else if (m === 0xe2 && id === "ICC_PROFILE") {
      // 色彩描述檔，不是中繼資料。剝掉會讓照片在廣色域螢幕上偏色，該留。
    } else if (m >= 0xe0 && m <= 0xef && m !== 0xee && !(m === 0xe0 && (id === "JFIF" || id === "JFXX"))) {
      findings.push({ level: "note", what: `JPEG ${jpegName(m)}`, why: `識別字「${id || "無"}」，${len} bytes，建議人工確認` });
    }

    if (m === 0xda && firstScan < 0) firstScan = p;
    p = end;
  }
  return firstScan;
}

/** WebP／ICO 也可能夾帶中繼資料，順手一起看，不然換個格式就繞過檢查了。 */
function scanWebp(buf, findings) {
  let p = 12;
  while (p + 8 <= buf.length) {
    const fourcc = buf.toString("latin1", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (p + 8 + size > buf.length) break;
    if (fourcc === "EXIF" || fourcc === "XMP ") {
      findings.push({ level: "block", what: `WebP ${fourcc.trim()}`, why: `${size} bytes` });
    }
    p += 8 + size + (size % 2);
  }
}

function scanIco(buf, findings) {
  const count = buf.readUInt16LE(4);
  for (let i = 0; i < count; i += 1) {
    const e = 6 + i * 16;
    if (e + 16 > buf.length) break;
    const size = buf.readUInt32LE(e + 8);
    const offset = buf.readUInt32LE(e + 12);
    if (offset + size > buf.length) continue;
    const frame = buf.subarray(offset, offset + size);
    if (frame.subarray(0, 8).equals(PNG_SIG)) scanPng(frame, findings, []);
  }
}

/** 回傳這個檔的所有發現。format 為 null 代表不是我們認得的圖檔格式。 */
function analyse(buf) {
  const findings = [];
  if (buf.subarray(0, 8).equals(PNG_SIG)) {
    const chunks = [];
    scanPng(buf, findings, chunks);
    return { format: "PNG", findings, chunks };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const drops = [];
    const firstScan = scanJpeg(buf, findings, drops);
    return { format: "JPEG", findings, drops, firstScan };
  }
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") {
    scanWebp(buf, findings);
    return { format: "WebP", findings };
  }
  if (buf.length > 6 && buf.readUInt16LE(0) === 0 && (buf.readUInt16LE(2) === 1 || buf.readUInt16LE(2) === 2)) {
    scanIco(buf, findings);
    return { format: "ICO", findings };
  }
  return { format: null, findings };
}

// ---------- 無損剝除 ----------
// 原則：逐 chunk／segment 原封搬移（PNG 連 CRC 一起複製、不重算），
// 只丟掉該擋的那幾項。絕不重新編碼畫素 ⸺ 轉存、壓縮、「最佳化」都不是剝除，
// 是換一張圖。寫回之前一定比對影像資料是否逐位元組相同。

const concatIdat = (chunks) => Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data));

function stripPng(buf, result) {
  const kept = [PNG_SIG];
  for (const c of result.chunks) {
    if (!PNG_BLOCK.has(c.type)) kept.push(buf.subarray(c.start, c.end));
  }
  const out = Buffer.concat(kept);
  const after = analyse(out);
  const sameHeader = result.chunks[0].data.equals(after.chunks[0].data);
  const samePixels = concatIdat(result.chunks).equals(concatIdat(after.chunks));
  return { out, ok: sameHeader && samePixels };
}

function stripJpeg(buf, result) {
  const kept = [];
  let cursor = 0;
  for (const d of [...result.drops].sort((a, b) => a.start - b.start)) {
    kept.push(buf.subarray(cursor, d.start));
    cursor = d.end;
  }
  kept.push(buf.subarray(cursor));
  const out = Buffer.concat(kept);
  // 熵編碼資料完全沒被碰過，才算無損。丟掉的都在 SOS 之前，
  // 所以把兩邊的 scan 起點對齊之後，剩下的位元組必須完全相同。
  const after = analyse(out);
  const ok =
    result.firstScan < 0 ||
    (after.firstScan >= 0 && buf.subarray(result.firstScan).equals(out.subarray(after.firstScan)));
  return { out, ok };
}

function strip(file) {
  const buf = readFileSync(file);
  const result = analyse(buf);
  if (!result.findings.some((f) => f.level === "block")) {
    console.log(`  ${file} 本來就乾淨，沒有動它`);
    return true;
  }
  let stripped;
  if (result.format === "PNG") stripped = stripPng(buf, result);
  else if (result.format === "JPEG") stripped = stripJpeg(buf, result);
  else {
    console.error(`  ${file} 是 ${result.format ?? "未知格式"}，這個模式只處理 PNG 與 JPEG，請人工處理`);
    return false;
  }
  if (!stripped.ok) {
    console.error(`  ${file} 剝除後影像資料對不起來，已放棄寫入 ⸺ 請人工處理`);
    return false;
  }
  if (analyse(stripped.out).findings.some((f) => f.level === "block")) {
    console.error(`  ${file} 剝除後仍驗到中繼資料，已放棄寫入 ⸺ 請人工處理`);
    return false;
  }
  writeFileSync(file, stripped.out);
  console.log(`  ${file} 已剝除 ${buf.length} → ${stripped.out.length} bytes，影像資料逐位元組相同`);
  return true;
}

// ---------- 取得要檢查的檔案 ----------

const git = (args, input) => execFileSync("git", args, { input, maxBuffer: 1024 * 1024 * 256 });

const gitList = (args) =>
  git(args).toString("utf8").split("\0").filter((f) => f && IMAGE_EXT.test(f));

/**
 * staged 模式要看「即將被提交的內容」，不是工作目錄的檔案 ⸺ 兩者可能不同
 * （先 git add 髒檔、再把工作目錄換成乾淨版，提交進去的還是髒的那份）。
 *
 * 一次 git cat-file --batch 把所有 blob 讀回來，不是每個檔各開一次 git：
 * Windows 上開一個行程要 150 ms 上下，21 張圖就是 3 秒多，pre-commit 會讓人有感。
 */
function readStagedBlobs(fileList) {
  const out = git(["cat-file", "--batch"], fileList.map((f) => `:${f}\n`).join(""));
  const blobs = new Map();
  let p = 0;
  for (const file of fileList) {
    const nl = out.indexOf(0x0a, p);
    if (nl < 0) break;
    const header = out.toString("utf8", p, nl).trim().split(" ");
    if (header[1] !== "blob") { p = nl + 1; continue; }   // missing／不是 blob，跳過
    const size = Number(header[2]);
    blobs.set(file, out.subarray(nl + 1, nl + 1 + size));
    p = nl + 1 + size + 1;                                 // 內容後面還有一個換行
  }
  return blobs;
}

// ---------- 主流程 ----------

const argv = process.argv.slice(2);
const wantStaged = argv.includes("--staged");
const wantStrip = argv.includes("--strip");
const files = argv.filter((a) => !a.startsWith("--"));

if (wantStrip) {
  if (!files.length) {
    console.error("--strip 一定要明確指定檔案，不會整站亂改。");
    process.exit(2);
  }
  console.log("無損剝除中繼資料：");
  const allOk = files.map(strip).every(Boolean);
  console.log(allOk ? "\n完成。記得重新 git add 這些檔案。" : "\n有檔案沒能處理，見上面訊息。");
  process.exit(allOk ? 0 : 1);
}

let targets;
try {
  if (wantStaged) targets = gitList(["diff", "--cached", "--name-only", "--diff-filter=ACM", "-z"]);
  else if (files.length) targets = files;
  else targets = gitList(["ls-files", "-z"]);
} catch (err) {
  console.error(`無法列出檔案：${err.message}`);
  process.exit(2);
}

if (!targets.length) {
  if (!wantStaged) console.log("沒有找到圖檔。");
  process.exit(0);
}

const bad = [];
let checked = 0;
let skipped = 0;

let staged;
try {
  if (wantStaged) staged = readStagedBlobs(targets);
} catch (err) {
  console.error(`讀不到 staged 內容：${err.message}`);
  process.exit(2);
}

for (const file of targets) {
  let buf;
  try {
    buf = wantStaged ? staged.get(file) : readFileSync(file);
  } catch (err) {
    console.error(`讀不到 ${file}：${err.message}`);
    process.exit(2);
  }
  if (!buf) { skipped += 1; continue; }
  const result = analyse(buf);
  if (!result.format) { skipped += 1; continue; }
  checked += 1;
  const blocks = result.findings.filter((f) => f.level === "block");
  const notes = result.findings.filter((f) => f.level === "note");
  if (blocks.length) bad.push({ file, format: result.format, blocks });
  else if (notes.length) {
    console.log(`note  ${file}（${result.format}）`);
    for (const n of notes) console.log(`        ${n.what}：${n.why}`);
  } else if (!wantStaged) {
    console.log(`ok    ${file}（${result.format}）`);
  }
}

if (!bad.length) {
  const tail = skipped ? `，另有 ${skipped} 個非圖檔格式略過` : "";
  console.log(`圖片中繼資料檢查通過：${checked} 個檔案乾淨${tail}。`);
  process.exit(0);
}

console.error("");
console.error("圖片中繼資料檢查未通過 ⸺ 這些檔案帶著看不見的身分資訊，不要進版控：");
console.error("");
for (const b of bad) {
  console.error(`  ${b.file}（${b.format}）`);
  for (const f of b.blocks) console.error(`      ${f.what}：${f.why}`);
  console.error("");
}
console.error("怎麼處理（無損，不會動到畫素）：");
console.error("");
console.error(`  node tools/check-image-metadata.mjs --strip ${bad.map((b) => b.file).join(" ")}`);
console.error("");
console.error("  這個模式逐 chunk／segment 原封搬移（PNG 連 CRC 一起複製、不重算），");
console.error("  只丟掉上面列出的項目，保留 sRGB／gAMA／iCCP／pHYs 與 JPEG 的 APP2 ICC_PROFILE，");
console.error("  寫回前會比對影像資料是否逐位元組相同。");
console.error("  不要改用轉存、壓縮或「最佳化」工具 ⸺ 那些會重新編碼畫素，是換一張圖，不是剝中繼資料。");
console.error("");
console.error("  剝完重新 git add 這些檔案，再提交一次。");
console.error("  細節見 README 的「圖片中繼資料」一節。");
console.error("");
process.exit(1);
