/* 瀏覽計數器 — 直接打 Supabase 的 PostgREST，不需要任何 SDK。
 *
 * 設計重點：
 *  - 每篇文章一個 slug，各自獨立計數；首頁自己也是一個 slug。
 *  - 首頁卡片的數字由同一次查詢一併回填，不必逐篇發請求。
 *  - 文章列表本身是靜態 HTML（見 build.mjs），這支程式只負責「數字」這種
 *    本質上無法靜態化的資料。
 *  - 任何一步失敗就把計數欄位藏起來，不讓版面出現壞掉的佔位符。
 */
(function () {
  "use strict";

  var el = document.getElementById("site-data");
  if (!el) return;

  var cfg;
  try {
    cfg = JSON.parse(el.textContent).supabase || {};
  } catch (err) {
    return hideAll();
  }

  var targets = Array.prototype.slice.call(
    document.querySelectorAll("[data-views-for]")
  );
  if (!targets.length) return;

  if (!cfg.url || !cfg.anonKey) {
    // 還沒接上 Supabase：安靜地不顯示，而不是留一排「—」。
    return hideAll();
  }

  var base = String(cfg.url).replace(/\/+$/, "");
  var headers = {
    apikey: cfg.anonKey,
    Authorization: "Bearer " + cfg.anonKey,
    "Content-Type": "application/json",
  };

  var mySlug = document.body.getAttribute("data-page-slug");

  start();

  function start() {
    bump()
      .catch(function () {
        /* 計數失敗不影響讀取 */
      })
      .then(fetchAll)
      .then(render)
      .catch(hideAll);
  }

  /* 這次瀏覽 +1。同一個瀏覽器分頁只算一次，避免重新整理灌水。 */
  function bump() {
    if (!mySlug) return Promise.resolve();

    var seenKey = "viewed:" + mySlug;
    try {
      if (sessionStorage.getItem(seenKey)) return Promise.resolve();
      sessionStorage.setItem(seenKey, "1");
    } catch (err) {
      /* 無痕模式可能擋 sessionStorage，那就每次都算 */
    }

    return fetch(base + "/rest/v1/rpc/" + (cfg.rpc || "increment_view"), {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ page_slug: mySlug }),
    });
  }

  /* 一次把所有 slug 的計數抓回來，首頁卡片和文章頁共用同一份結果。 */
  function fetchAll() {
    var url =
      base +
      "/rest/v1/" +
      (cfg.table || "page_views") +
      "?select=slug,views";

    return fetch(url, { headers: headers }).then(function (res) {
      if (!res.ok) throw new Error("讀取計數失敗：HTTP " + res.status);
      return res.json();
    });
  }

  function render(rows) {
    var counts = Object.create(null);
    (rows || []).forEach(function (row) {
      counts[row.slug] = row.views;
    });

    targets.forEach(function (node) {
      var slug = node.getAttribute("data-views-for");
      var n = counts[slug];
      if (typeof n !== "number") n = 0;
      node.textContent = n.toLocaleString("zh-TW");
      node.setAttribute("title", n.toLocaleString("zh-TW") + " 次瀏覽");
      node.hidden = false;
    });
  }

  function hideAll() {
    targets.forEach(function (node) {
      node.hidden = true;
    });
  }
})();
