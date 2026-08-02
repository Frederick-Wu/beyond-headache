#!/usr/bin/env node
/**
 * 本機預覽伺服器 —— 只給開發用，不會被部署。
 *
 * 用法：  node serve.mjs        （預設 http://localhost:4321）
 *        node serve.mjs 8080
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "docs");
const PORT = Number(process.argv[2]) || 4321;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);

  // 擋掉 ../ 之類想跳出 docs/ 的路徑
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  let file = join(ROOT, safe);

  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(ROOT, "404.html");
  }

  try {
    const body = await readFile(file);
    res.writeHead(file.endsWith("404.html") ? 404 : 200, {
      "content-type": TYPES[extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("404");
  }
}).listen(PORT, () => {
  console.log(`預覽中： http://localhost:${PORT}`);
});
