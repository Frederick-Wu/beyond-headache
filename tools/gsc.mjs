#!/usr/bin/env node
// Search Console 讀取工具 —— 零相依，只用 Node 內建模組。
//
//   node tools/gsc.mjs inspect            逐一檢查 sitemap 裡所有網址的索引狀態
//   node tools/gsc.mjs inspect <網址>      只檢查單一網址
//   node tools/gsc.mjs perf [天數]         搜尋成效：熱門查詢與熱門頁面（預設 28 天）
//   node tools/gsc.mjs whoami             確認金鑰讀得到、權限有通
//
// 金鑰預設讀 ~/.secrets/gsc/service-account.json，可用環境變數 GSC_KEY 覆寫。
// 金鑰「絕對不能」放進這個 repo。

import { readFileSync } from 'node:fs'
import { createSign } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'

const SITE_URL = 'sc-domain:drminyangwu.com'
const SITEMAP = 'https://drminyangwu.com/sitemap.xml'
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
const KEY_PATH =
  process.env.GSC_KEY || path.join(homedir(), '.secrets', 'gsc', 'service-account.json')

// ── 認證 ──────────────────────────────────────────────

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function loadKey() {
  let raw
  try {
    raw = readFileSync(KEY_PATH, 'utf8')
  } catch {
    console.error(`找不到金鑰：${KEY_PATH}`)
    console.error('請確認 JSON 金鑰已放到該位置，或設定環境變數 GSC_KEY 指向它。')
    process.exit(1)
  }
  const key = JSON.parse(raw)
  if (!key.client_email || !key.private_key) {
    console.error(`${KEY_PATH} 不像服務帳戶金鑰（缺 client_email 或 private_key）。`)
    process.exit(1)
  }
  return key
}

async function getToken(key) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const jwt = `${header}.${claims}.${b64url(signer.sign(key.private_key))}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const json = await res.json()
  if (!res.ok) {
    console.error('取得存取權杖失敗：', json.error_description || JSON.stringify(json))
    process.exit(1)
  }
  return json.access_token
}

async function api(token, url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) {
    const msg = json.error?.message || JSON.stringify(json)
    if (res.status === 403)
      console.error(
        '\n權限不足（403）。請到 Search Console →「設定 → 使用者和權限」，' +
          '把服務帳戶的信箱以「僅限檢視」加入 drminyangwu.com 這個資源。\n'
      )
    throw new Error(`${res.status} ${msg}`)
  }
  return json
}

// ── 指令 ──────────────────────────────────────────────

async function sitemapUrls() {
  const xml = await fetch(SITEMAP).then((r) => r.text())
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
}

const VERDICT = { PASS: '✅ 已收錄', NEUTRAL: '⚪ 未收錄', FAIL: '❌ 有問題', PARTIAL: '⚠️ 部分' }

async function cmdInspect(token, one) {
  const urls = one ? [one] : await sitemapUrls()
  console.log(`檢查 ${urls.length} 個網址（資源：${SITE_URL}）\n`)

  const buckets = new Map()
  for (const url of urls) {
    let r
    try {
      r = await api(token, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
        inspectionUrl: url,
        siteUrl: SITE_URL,
        languageCode: 'zh-TW',
      })
    } catch (e) {
      console.log(`❌ ${url}\n   ${e.message}`)
      continue
    }
    const s = r.inspectionResult?.indexStatusResult ?? {}
    const verdict = VERDICT[s.verdict] || s.verdict || '（無資料）'
    const state = s.coverageState || ''
    buckets.set(state, (buckets.get(state) || 0) + 1)

    console.log(`${verdict}  ${url.replace('https://drminyangwu.com', '')}`)
    if (state) console.log(`         ${state}`)
    const crawl = s.lastCrawlTime ? s.lastCrawlTime.slice(0, 10) : '尚未檢索'
    console.log(`         上次檢索：${crawl}`)
    if (s.googleCanonical && s.userCanonical && s.googleCanonical !== s.userCanonical)
      console.log(`         ⚠️ canonical 不一致：Google 選了 ${s.googleCanonical}`)
    console.log()
  }

  if (urls.length > 1) {
    console.log('── 彙總 ──')
    for (const [state, n] of [...buckets].sort((a, b) => b[1] - a[1]))
      console.log(`  ${n.toString().padStart(3)}  ${state || '（無狀態）'}`)
  }
}

async function cmdPerf(token, days) {
  const end = new Date(Date.now() - 2 * 864e5) // GSC 成效資料約落後 2 天
  const start = new Date(end - (days - 1) * 864e5)
  const iso = (d) => d.toISOString().slice(0, 10)
  const range = { startDate: iso(start), endDate: iso(end) }
  const base = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`

  console.log(`搜尋成效 ${range.startDate} ～ ${range.endDate}（${days} 天）\n`)

  for (const [dim, label] of [
    ['query', '熱門搜尋字詞'],
    ['page', '熱門頁面'],
  ]) {
    const { rows = [] } = await api(token, base, { ...range, dimensions: [dim], rowLimit: 20 })
    console.log(`── ${label} ──`)
    if (!rows.length) {
      console.log('  （這段期間沒有資料）\n')
      continue
    }
    console.log('  點擊  曝光   CTR   排名  ' + dim)
    for (const r of rows) {
      const k = r.keys[0].replace('https://drminyangwu.com', '')
      console.log(
        `  ${String(r.clicks).padStart(4)}  ${String(r.impressions).padStart(4)}  ` +
          `${(r.ctr * 100).toFixed(1).padStart(4)}%  ${r.position.toFixed(1).padStart(4)}  ${k}`
      )
    }
    console.log()
  }
}

// ── 進入點 ────────────────────────────────────────────

const [cmd, arg] = process.argv.slice(2)
const key = loadKey()
const token = await getToken(key)

if (cmd === 'whoami') {
  console.log(`金鑰檔　　：${KEY_PATH}`)
  console.log(`服務帳戶　：${key.client_email}`)
  console.log(`專案　　　：${key.project_id}`)
  process.stdout.write('資源存取　：')
  try {
    await api(token, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      inspectionUrl: 'https://drminyangwu.com/',
      siteUrl: SITE_URL,
      languageCode: 'zh-TW',
    })
    console.log(`✅ 讀得到 ${SITE_URL}`)
  } catch (e) {
    console.log(`❌ ${e.message}`)
    process.exit(1)
  }
} else if (cmd === 'inspect') {
  await cmdInspect(token, arg)
} else if (cmd === 'perf') {
  await cmdPerf(token, Number(arg) || 28)
} else {
  console.log('用法：')
  console.log('  node tools/gsc.mjs whoami            確認金鑰與權限')
  console.log('  node tools/gsc.mjs inspect           檢查 sitemap 所有網址')
  console.log('  node tools/gsc.mjs inspect <網址>     檢查單一網址')
  console.log('  node tools/gsc.mjs perf [天數]        搜尋成效（預設 28 天）')
  process.exit(1)
}
