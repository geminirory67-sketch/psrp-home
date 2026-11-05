/* Palm State RolePlay — 申請表：依資料庫中的題目設定產生表單、檢查並收集答案。
   設定格式 { intro, submit, sections: [{ id, title, hint, questions: [{ id, type, label, help, placeholder, required, half, options, min, max }] }] }
   type：text 短答、textarea 長答、number 數字、select 下拉選單、checkbox 勾選同意、note 說明文字 */
(function () {
  var TYPES = { text: "短答", textarea: "長答", number: "數字", select: "下拉選單", checkbox: "勾選同意", note: "說明文字" };
  var CSS = ".pf-cc{font-size:12.5px;color:var(--muted);text-align:right}.pf-cc.ok{color:var(--ok)}.pf-note{margin:0;color:var(--muted);font-size:14px;line-height:1.7;white-space:pre-wrap}.pf-hint{margin:-4px 0 0;color:var(--muted);font-size:13.5px;white-space:pre-wrap}.pf-intro{white-space:pre-wrap}.fld .req,.check .req{color:var(--sun);margin-left:3px}.pf-bad{border-color:var(--bad)!important}";
  (function () { var s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); })();

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  /* 允許 [文字](網址) 連結與 **粗體** */
  function inline(s) {
    return esc(s).replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]*)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  }
  function plain(s) { return String(s || "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*/g, ""); }
  function h(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] === false || attrs[k] == null) return; if (k === "class") e.className = attrs[k]; else e.setAttribute(k, attrs[k] === true ? "" : attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function uid(p) { return (p || "q_") + Math.random().toString(36).slice(2, 8); }

  function field(q, pre, opts) {
    var id = (opts.idPrefix || "pf-") + q.id, req = q.required !== false && q.type !== "note";
    var star = req ? '<span class="req" aria-hidden="true">*</span>' : "";
    if (q.type === "note") return h("p", { class: "pf-note" }, inline(q.label));
    if (q.type === "checkbox") {
      var l = h("label", { class: "check" });
      var cb = h("input", { type: "checkbox", name: q.id, id: id, required: req });
      if (pre === true) cb.checked = true;
      l.appendChild(cb); l.appendChild(h("span", null, inline(q.label) + star));
      return l;
    }
    var w = h("label", { class: "fld", for: id });
    w.appendChild(h("span", null, inline(q.label) + star));
    if (q.help) w.appendChild(h("small", null, inline(q.help)));
    var inp;
    if (q.type === "textarea") inp = h("textarea", { id: id, name: q.id, required: req, placeholder: q.placeholder || false, style: q.min >= 150 ? "min-height:180px" : false });
    else if (q.type === "select") {
      inp = h("select", { id: id, name: q.id, required: req });
      inp.appendChild(h("option", { value: "" }, "請選擇"));
      (q.options || []).forEach(function (o) { var op = document.createElement("option"); op.textContent = o; op.value = o; inp.appendChild(op); });
    } else inp = h("input", { id: id, name: q.id, required: req, type: q.type === "number" ? "number" : "text", inputmode: q.type === "number" ? "numeric" : false, min: q.type === "number" && q.min != null && q.min !== "" ? q.min : false, max: q.type === "number" && q.max != null && q.max !== "" ? q.max : false, placeholder: q.placeholder || false, maxlength: q.type === "text" ? "300" : false });
    if (pre != null && pre !== "") inp.value = pre;
    if (opts.disabled) inp.disabled = true;
    w.appendChild(inp);
    if (q.type === "textarea" && q.min > 0) {
      var cc = h("span", { class: "pf-cc" }, "0 / " + q.min + " 字");
      var upd = function () { var n = inp.value.trim().length; cc.textContent = n + " / " + q.min + " 字"; cc.classList.toggle("ok", n >= q.min); };
      inp.addEventListener("input", upd); upd();
      w.appendChild(cc);
    }
    return w;
  }

  /* 產生表單內容到 container；回傳 collect() 用來檢查並取得答案 */
  function render(container, schema, opts) {
    opts = opts || {};
    container.innerHTML = "";
    var pre = opts.prefill || {};
    if (schema.intro && !opts.noIntro) container.appendChild(h("div", { class: "notice pf-intro" }, inline(schema.intro)));
    (schema.sections || []).forEach(function (sec, si) {
      var fs = h("fieldset", { "data-sec": sec.id || String(si) });
      fs.appendChild(h("legend", null, esc(sec.title || "（未命名區塊）")));
      if (sec.hint) fs.appendChild(h("p", { class: "pf-hint" }, inline(sec.hint)));
      var grid = null;
      (sec.questions || []).forEach(function (q) {
        var f = field(q, pre[q.id], opts);
        f.setAttribute("data-q", q.id);
        if (q.half && q.type !== "checkbox" && q.type !== "note") {
          if (!grid) { grid = h("div", { class: "grid2" }); fs.appendChild(grid); }
          grid.appendChild(f);
        } else { grid = null; fs.appendChild(f); }
      });
      container.appendChild(fs);
    });
    return {
      collect: function () {
        var answers = { _questions: {} }, missing = 0, first = null, err = "";
        container.querySelectorAll(".pf-bad").forEach(function (x) { x.classList.remove("pf-bad"); });
        (schema.sections || []).forEach(function (sec) {
          (sec.questions || []).forEach(function (q) {
            if (q.type === "note") return;
            var inp = container.querySelector('[name="' + q.id + '"]'); if (!inp) return;
            var v = q.type === "checkbox" ? inp.checked : inp.value.trim();
            answers[q.id] = q.type === "number" && v !== "" ? Number(v) : v;
            answers._questions[q.id] = plain(q.label);
            var req = q.required !== false, bad = "";
            if (req && (q.type === "checkbox" ? !v : v === "")) { bad = "required"; missing++; }
            else if (q.type === "textarea" && q.min > 0 && v.length < q.min && (req || v)) bad = "「" + plain(q.label).slice(0, 20) + "」至少需要 " + q.min + " 字，目前 " + v.length + " 字。";
            else if (q.type === "number" && v !== "" && ((q.min !== "" && q.min != null && Number(v) < Number(q.min)) || (q.max !== "" && q.max != null && Number(v) > Number(q.max)))) bad = "「" + plain(q.label).slice(0, 20) + "」需要介於 " + (q.min || "") + "～" + (q.max || "") + "。";
            if (bad) { inp.classList.add("pf-bad"); if (!first) { first = inp; if (bad !== "required") err = bad; } }
          });
        });
        if (missing) err = "還有 " + missing + " 個必填欄位未填寫或未勾選。";
        if (first) { first.focus(); return { ok: false, error: err }; }
        return { ok: true, answers: answers };
      }
    };
  }

  async function load(slug) {
    var r = await PSRP.client.from("documents").select("source, updated_at").eq("slug", "form-" + slug).maybeSingle();
    if (r.error || !r.data) return null;
    try { return JSON.parse(r.data.source); } catch (e) { return null; }
  }

  window.PSRPForm = { render: render, load: load, TYPES: TYPES, uid: uid, inline: inline, esc: esc };
})();
