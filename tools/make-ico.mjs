#!/usr/bin/env node
/**
 * 把 static/favicon-16.png 與 favicon-32.png 打包成 static/favicon.ico
 *
 * 用法：node tools/make-ico.mjs
 *
 * 為什麼還需要 .ico：不管 HTML 裡怎麼寫，瀏覽器都會自己去要 /favicon.ico。
 * 沒有這個檔就是每次都吃一個 404。
 *
 * ICO 從 Windows Vista 起允許直接內嵌 PNG 資料，不必轉成 BMP，
 * 所以這裡只是替現成的 PNG 加上容器標頭。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const STATIC = join(dirname(fileURLToPath(import.meta.url)), "..", "static");

const sources = [
  { size: 16, file: "favicon-16.png" },
  { size: 32, file: "favicon-32.png" },
];

const images = sources.map((s) => ({
  size: s.size,
  data: readFileSync(join(STATIC, s.file)),
}));

const HEADER = 6;
const ENTRY = 16;

const header = Buffer.alloc(HEADER);
header.writeUInt16LE(0, 0); // 保留欄位，必須為 0
header.writeUInt16LE(1, 2); // 型別 1 = 圖示
header.writeUInt16LE(images.length, 4);

let offset = HEADER + ENTRY * images.length;
const entries = [];

for (const img of images) {
  const e = Buffer.alloc(ENTRY);
  e.writeUInt8(img.size === 256 ? 0 : img.size, 0); // 寬（0 代表 256）
  e.writeUInt8(img.size === 256 ? 0 : img.size, 1); // 高
  e.writeUInt8(0, 2); // 調色盤色數，0 = 不使用調色盤
  e.writeUInt8(0, 3); // 保留
  e.writeUInt16LE(1, 4); // 色彩平面
  e.writeUInt16LE(32, 6); // 每像素位元數
  e.writeUInt32LE(img.data.length, 8);
  e.writeUInt32LE(offset, 12);
  entries.push(e);
  offset += img.data.length;
}

const ico = Buffer.concat([
  header,
  ...entries,
  ...images.map((i) => i.data),
]);

const out = join(STATIC, "favicon.ico");
writeFileSync(out, ico);

console.log(
  `favicon.ico  ${images.map((i) => i.size + "×" + i.size).join(" + ")}  ` +
    `${(ico.length / 1024).toFixed(1)} KB`
);
