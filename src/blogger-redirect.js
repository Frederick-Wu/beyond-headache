/* =================================================================
 * 舊部落格（blog.drminyangwu.com，Blogger）→ 新站的自動轉址
 *
 * 這支檔案不是給本站用的。舊站的主題 HTML 裡有一行：
 *
 *   <script src='https://drminyangwu.com/blogger-redirect.js' defer='defer'></script>
 *
 * 讀者打開一篇「已搬到新站」的舊文章時，頁面上方會出現一條提示，
 * 幾秒後自動前往新文章；想看舊版的人可以按「留在舊版」。
 *
 * 為什麼放在新站、而不是整段貼進 Blogger 主題：
 *   對照表會隨著搬文章一直變長。放在這裡，站主只需要改一次主題，
 *   之後每搬一篇，只要在那篇的 front matter 填 legacyUrl，建置時
 *   build.mjs 會把下面的 MAP 換成實際的對照表 ⸺ 不必再碰 Blogger。
 *
 * 刻意的安全設計（改的時候請維持）：
 *   - 對照表裡找不到這個網址 → 什麼都不做。舊站其他頁面完全不受影響。
 *   - 新站連不上、這支檔案載入失敗 → 舊站也只是不跳轉，照常顯示原文。
 *   - 用 location.replace 而不是 location.href ⸺ 不留下舊頁的瀏覽紀錄，
 *     讀者在新站按「上一頁」不會又被送回舊頁、再被轉一次。
 *   - 「留在舊版」記在 sessionStorage，同一個分頁內重新整理不會再跳。
 *     網址加 ?stay 也可以（給站主自己看舊版用）。
 *
 * 轉址時會帶 utm_source=blog.drminyangwu.com，GA4 看得到有多少人
 * 是從舊站（包括掃衛教單張 QR Code）來的。
 * ================================================================= */
(function () {
  "use strict";

  /* build.mjs 會把這一行換成建置當下的對照表：{ "舊網址路徑": "新網址" }。
     ⚠️ 它只是「備援」⸺ 這支檔案本身會被瀏覽器快取 4 小時（網域層級設定），
     所以每搬一篇新文章，內嵌的這份都可能是舊的。真正用的是下面另外抓的
     blogger-redirect-map.json，那個抓取指定 no-store，一定拿到最新的。
     2026-09-20 站主就踩到這個：艾妥達上線後，他的瀏覽器還在用稍早快取的版本。 */
  var MAP = /*LEGACY_MAP*/ {};
  var MAP_URL = "https://drminyangwu.com/blogger-redirect-map.json";

  var SECONDS = 3;
  var UTM = "utm_source=blog.drminyangwu.com&utm_medium=redirect";

  var path;
  try {
    // Blogger 有幾篇的網址含空格（%20），比對前先解碼
    path = decodeURIComponent(location.pathname);
  } catch (e) {
    return;
  }

  if (/[?&]stay(=|&|$)/.test(location.search)) return;

  var STAY_KEY = "bh-stay:" + path;
  try {
    if (sessionStorage.getItem(STAY_KEY)) return;
  } catch (e) {
    // 無痕模式或封鎖儲存空間時 sessionStorage 會丟錯 ⸺ 照常轉址即可
  }

  // 先拿最新的對照表；抓不到（離線、新站掛了、瀏覽器擋了）就用內嵌那份
  if (typeof fetch === "function") {
    fetch(MAP_URL, { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (fresh) {
        start(fresh && typeof fresh === "object" ? fresh : MAP);
      })
      .catch(function () {
        start(MAP);
      });
  } else {
    start(MAP);
  }

  function start(map) {
    var target = map[path];
    if (!target) return;
    run(target);
  }

  function run(target) {
  var dest = target + (target.indexOf("?") < 0 ? "?" : "&") + UTM;

  function show() {
    var bar = document.createElement("div");
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");
    bar.style.cssText = [
      "position:fixed", "top:0", "left:0", "right:0", "z-index:2147483647",
      "background:#182a55", "color:#fff", "padding:14px 16px",
      "font:15px/1.7 -apple-system,BlinkMacSystemFont,'PingFang TC','Microsoft JhengHei',sans-serif",
      "box-shadow:0 2px 12px rgba(0,0,0,.25)", "text-align:center"
    ].join(";");

    var msg = document.createElement("div");
    var count = document.createElement("strong");
    count.textContent = SECONDS;
    msg.appendChild(document.createTextNode("這篇文章已經搬到新網站，"));
    msg.appendChild(count);
    msg.appendChild(document.createTextNode(" 秒後自動前往"));

    var btnStyle =
      "display:inline-block;margin:8px 6px 0;padding:6px 16px;border-radius:999px;" +
      "font:inherit;font-size:14px;cursor:pointer;text-decoration:none;";

    var go = document.createElement("a");
    go.href = dest;
    go.textContent = "立即前往";
    go.style.cssText = btnStyle + "background:#fff;color:#182a55;border:1px solid #fff;font-weight:bold;";

    var stay = document.createElement("button");
    stay.type = "button";
    stay.textContent = "留在舊版";
    stay.style.cssText = btnStyle + "background:transparent;color:#fff;border:1px solid rgba(255,255,255,.6);";

    bar.appendChild(msg);
    bar.appendChild(go);
    bar.appendChild(stay);
    document.body.appendChild(bar);

    var left = SECONDS;
    var timer = setInterval(function () {
      left -= 1;
      if (left > 0) {
        count.textContent = left;
        return;
      }
      clearInterval(timer);
      location.replace(dest);
    }, 1000);

    stay.addEventListener("click", function () {
      clearInterval(timer);
      try {
        sessionStorage.setItem(STAY_KEY, "1");
      } catch (e) {}
      bar.parentNode.removeChild(bar);
    });
  }

    if (document.body) show();
    else document.addEventListener("DOMContentLoaded", show);
  }
})();
