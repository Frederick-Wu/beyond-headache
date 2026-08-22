/**
 * 全站只留一個正式入口：drminyangwu.com。
 *
 * 兩種來源會被永久轉走：
 *   1. beyond-headache.pages.dev ⸺ 換網域前的舊網址
 *   2. www.drminyangwu.com       ⸺ 同一份內容的第二個入口
 *
 * 為什麼用 Function 而不是 _redirects：_redirects 的來源只能寫路徑、不能指定
 * 主機名稱，所以 `/* https://drminyangwu.com/:splat 301` 會連 drminyangwu.com
 * 自己都比對成功，變成無限轉址。要依主機名稱分流就只能在這裡看 Host。
 *
 * 只比對正式的 pages.dev 主機名稱，預覽部署的 <hash>.beyond-headache.pages.dev
 * 不受影響 ⸺ 那是拿來檢查改動的，被轉走就失去意義了。
 *
 * 用 301 而非 302：要讓搜尋引擎把舊網址累積的權重移轉到正式網域，
 * 302 會被當成暫時性、不移轉。
 */
const CANONICAL_HOST = "drminyangwu.com";

const REDIRECT_FROM = new Set([
  "beyond-headache.pages.dev",
  `www.${CANONICAL_HOST}`,
]);

export const onRequest = (context) => {
  const url = new URL(context.request.url);

  if (REDIRECT_FROM.has(url.hostname)) {
    url.hostname = CANONICAL_HOST;
    // 路徑、查詢字串原樣保留，讓舊連結逐頁對應到新網址而不是全部倒回首頁。
    return Response.redirect(url.toString(), 301);
  }

  return context.next();
};
