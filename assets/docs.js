/* Palm State RolePlay — 從資料庫讀取文件（法典、規則、手冊），公開文件會快取在瀏覽器 */
(function () {
  function timeout(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, ms); })]);
  }
  async function get(slug, opts) {
    opts = opts || {};
    if (!window.PSRP || !PSRP.client) throw new Error("帳號系統尚未啟用");
    var key = "psrp-doc-" + slug, cache = null;
    if (opts.cache) { try { cache = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { cache = null; } }
    var meta = await timeout(PSRP.client.from("documents").select("updated_at").eq("slug", slug).maybeSingle(), opts.timeout || 4000);
    if (meta.error) throw meta.error;
    if (!meta.data) return null;
    if (cache && cache.updated_at === meta.data.updated_at && cache.source) return cache;
    var r = await timeout(PSRP.client.from("documents").select("slug, title, source, body, nav, updated_at, editor_role, required_role").eq("slug", slug).maybeSingle(), (opts.timeout || 4000) * 3);
    if (r.error) throw r.error;
    if (!r.data) return null;
    if (opts.cache && r.data.source) { try { localStorage.setItem(key, JSON.stringify(r.data)); } catch (e) { /* 空間不足時略過 */ } }
    return r.data;
  }
  /* 有編輯權限時，在 container 放「線上編輯」按鈕 */
  async function editButton(container, slug, editorRole) {
    if (!container || !window.PSRP || !PSRP.client) return;
    var me = await PSRP.profile();
    if (!me || !PSRP.hasRole(me, editorRole)) return;
    var a = document.createElement("a");
    a.href = "https://psrp2.com/editor/?doc=" + encodeURIComponent(slug);
    a.className = "edit-doc-btn";
    a.textContent = "✎ 線上編輯";
    container.appendChild(a);
  }
  window.PSRPDocs = { get: get, editButton: editButton };
})();
