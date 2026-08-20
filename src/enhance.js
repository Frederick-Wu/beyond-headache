/* 介面行為 ⸺ 捲動觸發動畫、數值跑動、回到頂部。
 *
 * 三個共通原則：
 *  1. 內容不依賴這支程式。長條寬度、數字、目錄在 HTML 裡就是最終狀態，
 *     這裡只是「先歸零再演一次」。JS 掛掉或被關掉，讀者看到的是完整內容。
 *  2. 一律尊重 prefers-reduced-motion。前庭功能障礙、偏頭痛患者對動態
 *     特別敏感 ⸺ 這是一個神經內科的部落格，這件事不能只當作勾選項目。
 *  3. 動畫只播一次。捲上捲下重複播放很煩，也會干擾閱讀。
 */
(function () {
  "use strict";

  var root = document.documentElement;

  /* 兩個偏好判斷，極性刻意不同，不是筆誤：
   *
   *  reduceMotion ⸺ reduce 才關。揭露動畫與數值跑動預設會播，
   *    只有使用者「明確要求」減少動態時才直接呈現最終狀態。
   *    這是動畫的慣例極性，也對應 styles.css 裡預設會播的那份。
   *
   *  smoothScroll ⸺ no-preference 才開。平滑捲動預設不做，
   *    只有使用者「明確表示沒有偏好」時才平滑。偵測不到偏好
   *    （舊瀏覽器、不支援 matchMedia）就安靜地直接跳過去。
   *    這是為了對齊 styles.css 的 scroll-behavior ⸺ 那邊寫在
   *    (prefers-reduced-motion: no-preference) 裡，JS 若用另一種
   *    極性，同一個瀏覽器會出現 CSS 直接跳、JS 平滑捲的分歧。
   */
  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var smoothScroll = !!(
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: no-preference)").matches
  );

  /* ---------------------------------------------------------------
   * 捲動進入視窗時揭露
   * ------------------------------------------------------------- */
  var revealables = Array.prototype.slice.call(
    document.querySelectorAll(".reveal")
  );

  function revealAll() {
    revealables.forEach(function (el) {
      el.classList.add("is-visible");
    });
  }

  if (!revealables.length) {
    /* 沒有可揭露的元素就跳過 */
  } else if (reduceMotion || !("IntersectionObserver" in window)) {
    // 不支援或使用者不想要動畫：直接呈現最終狀態
    revealAll();
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          countUp(entry.target);
          io.unobserve(entry.target); // 只播一次
        });
      },
      {
        // 元素露出約一成就開始，不必等整塊進來
        threshold: 0.1,
        // 底部留 -10%，避免剛好卡在螢幕邊緣就觸發
        rootMargin: "0px 0px -10% 0px",
      }
    );
    revealables.forEach(function (el) {
      io.observe(el);
    });
  }

  /* ---------------------------------------------------------------
   * 數值跑動
   *
   * HTML 裡就是最終數字，這裡先歸零再跑上去。
   * 小數位數跟著目標值走，避免 14.4 跑成 14。
   * ------------------------------------------------------------- */
  function countUp(scope) {
    var nodes = scope.querySelectorAll("[data-count-to]");
    Array.prototype.forEach.call(nodes, function (node) {
      var target = parseFloat(node.getAttribute("data-count-to"));
      if (isNaN(target)) return;

      var unit = node.getAttribute("data-unit") || "";
      var decimals = (String(target).split(".")[1] || "").length;
      var duration = 900;
      var start = null;

      function frame(now) {
        if (start === null) start = now;
        var t = Math.min((now - start) / duration, 1);
        // easeOutCubic：一開始快、收尾慢，像儀表指針停下來
        var eased = 1 - Math.pow(1 - t, 3);
        node.textContent = (target * eased).toFixed(decimals) + unit;
        if (t < 1) requestAnimationFrame(frame);
        else node.textContent = target.toFixed(decimals) + unit;
      }

      node.textContent = (0).toFixed(decimals) + unit;
      requestAnimationFrame(frame);
    });
  }

  /* ---------------------------------------------------------------
   * 回到頂部
   *
   * 捲過一個螢幕高度才出現。捲動事件用 rAF 節流，
   * 免得每次捲動都讀取版面屬性造成重排。
   * ------------------------------------------------------------- */
  var toTop = document.getElementById("to-top");
  if (toTop) {
    var ticking = false;

    function sync() {
      ticking = false;
      var past = window.pageYOffset > window.innerHeight;
      if (past === !toTop.hidden) return; // 狀態沒變就不動 DOM
      toTop.hidden = !past;
    }

    window.addEventListener(
      "scroll",
      function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(sync);
      },
      { passive: true }
    );

    toTop.addEventListener("click", function () {
      window.scrollTo({
        top: 0,
        behavior: smoothScroll ? "smooth" : "auto",
      });
      // 捲回頂部後把焦點交還給頁首，鍵盤操作才不會停在按鈕上
      var header = document.querySelector(".site-title a");
      if (header) header.focus({ preventScroll: true });
    });

    sync();
  }

  /* ---------------------------------------------------------------
   * 目錄：捲到哪一節就標示哪一節
   * ------------------------------------------------------------- */
  var tocLinks = Array.prototype.slice.call(
    document.querySelectorAll(".toc-list a")
  );
  if (tocLinks.length && "IntersectionObserver" in window) {
    var byId = {};
    var targets = [];
    tocLinks.forEach(function (a) {
      var raw = a.getAttribute("href").slice(1);
      // 錨點是中文，HTML 裡沒有百分號編碼，所以解碼多半是空操作。
      // 但標題若含 % 會讓 decodeURIComponent 直接拋錯，連帶讓整支
      // 程式停在這裡 ⸺ 用原字串當退路。
      var id = raw;
      try {
        id = decodeURIComponent(raw);
      } catch (err) {
        /* 保持原字串 */
      }
      var el = document.getElementById(id);
      if (!el) return;
      byId[id] = a;
      targets.push(el);
    });

    var current = null;
    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var a = byId[entry.target.id];
          if (!a || a === current) return;
          if (current) current.removeAttribute("aria-current");
          a.setAttribute("aria-current", "true");
          current = a;
        });
      },
      // 只認畫面上方那一段，避免長節在畫面中間時反覆切換
      { rootMargin: "0px 0px -70% 0px" }
    );
    targets.forEach(function (el) {
      spy.observe(el);
    });
  }

  root.classList.add("enhanced");
})();
