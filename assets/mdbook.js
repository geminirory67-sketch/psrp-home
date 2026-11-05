/* Palm State RolePlay — 共用 Markdown 渲染器（法典、部門手冊、伺服器規則、公告）
   需要先載入 /assets/marked.js */
(function () {
  var CJK = /[　-〿㐀-鿿＀-￯]/g;
  var BADGE = { F: "f", W: "w", M: "m", I: "i" };
  var LABEL = { F: "重罪 Felony", W: "可重可輕 Wobbler", M: "輕罪 Misdemeanor", I: "違規 Infraction" };
  var SECRE = /^(PC|VC|H&S|B&P|CIV|CCP|GOV|F&G|W&I|ELEC|EVID|FAM|LAB|PRC|HNC|PUC|PROB|CORP|FIN|INS|R&T|COM|LAMC|14 C|42 U|18 U|CA Const|U\.S\.|IWC|CALCRIM|判例|Terry|Miranda|Mapp|地方)/;
  var LV = { A: "A 嚴重", B: "B 重大", C: "C 一般", D: "D 輕微" };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function splitTitle(t) {
    var idx = -1, m; CJK.lastIndex = 0;
    while ((m = CJK.exec(t))) idx = m.index + m[0].length;
    return idx > 0 ? [t.slice(0, idx).trim(), t.slice(idx).trim()] : [t, ""];
  }
  /* 把 "## 標題 {#id}" 的 id 標記保留下來 */
  function prep(md) {
    return String(md || "").replace(/\r\n?/g, "\n").replace(/^(#{1,6}[ \t].*?)[ \t]*\{#([\w-]+)\}[ \t]*$/gm, function (_, h, id) { return h + " ⟦id:" + id + "⟧"; });
  }
  function takeId(el) {
    var m = el.innerHTML.match(/\s*⟦id:([\w-]+)⟧/);
    if (!m) return null;
    el.innerHTML = el.innerHTML.replace(m[0], "");
    return m[1];
  }
  function parse(md) {
    var box = document.createElement("div");
    box.innerHTML = window.marked.parse(prep(md), { gfm: true, breaks: false });
    return box;
  }
  function wrapTable(t, cls) {
    var w = document.createElement("div"); w.className = "tw";
    t.parentNode.insertBefore(w, t); w.appendChild(t);
    if (cls) t.className = cls;
  }

  /* ---------- 法典／部門手冊 ---------- */
  function renderBook(md, prefix) {
    var box = parse(md), nav = [], counter = 0;
    [].slice.call(box.querySelectorAll("h3")).forEach(function (h) {
      takeId(h);
      var p = splitTitle(h.textContent.trim());
      h.innerHTML = '<span class="zh">' + esc(p[0]) + '</span> <span class="en">' + esc(p[1]) + "</span>";
    });
    [].slice.call(box.querySelectorAll("table")).forEach(function (t) {
      var ths = [].map.call(t.querySelectorAll("th"), function (x) { return x.textContent.trim(); });
      [].forEach.call(t.querySelectorAll("th"), function (x) { x.removeAttribute("align"); });
      wrapTable(t, "c" + ths.length + (ths.length === 5 && ths.indexOf("等級") !== -1 ? " wide" : ""));
      [].forEach.call(t.querySelectorAll("tbody tr"), function (tr) {
        var classes = {};
        [].forEach.call(tr.children, function (td, i) {
          var lab = ths[i] || "", raw = td.innerHTML.trim();
          td.removeAttribute("align");
          td.setAttribute("data-l", lab);
          if (/^[FWMI](／[FWMI])*$/.test(raw) || (lab === "等級" && raw)) {
            td.innerHTML = raw.split("／").map(function (b) {
              if (BADGE[b]) { classes[b] = 1; return '<span class="b b-' + BADGE[b] + '" title="' + LABEL[b] + '">' + b + "</span>"; }
              return '<span class="b b-x">' + b + "</span>";
            }).join("");
            td.className = "cls";
          } else if (i === 0 && SECRE.test(td.textContent.trim())) td.className = "sec";
        });
        tr.setAttribute("data-cls", Object.keys(classes).sort().join(""));
      });
    });
    [].forEach.call(box.querySelectorAll("p"), function (p) {
      if (p.firstElementChild && p.firstElementChild.tagName === "STRONG" && p.innerHTML.indexOf("<strong>酒駕刑度表") === 0) p.className = "tcap";
    });
    var out = document.createElement("div"), sec = null;
    [].slice.call(box.childNodes).forEach(function (n) {
      if (n.nodeType === 1 && n.tagName === "H2") {
        counter++;
        var id = takeId(n) || (prefix + counter);
        var parts = splitTitle(n.textContent.trim()), zh = parts[0], en = parts[1];
        var mm = zh.match(/^(第.+?[編章])\s*(.*)$/);
        var short = mm ? mm[1] : zh, rest = mm ? mm[2] : "";
        nav.push([id, short, rest]);
        sec = document.createElement("section"); sec.className = "part"; sec.id = id;
        sec.innerHTML = '<header class="part-head"><p class="part-no">' + (rest ? esc(short) : "") + "</p><h2>" + esc(rest || short) + '</h2><p class="part-en">' + esc(en) + "</p></header>";
        out.appendChild(sec);
      } else if (n.nodeType === 1 && n.tagName === "H1") {
        /* 文件大標題不顯示在內文 */
      } else {
        (sec || out).appendChild(n);
      }
    });
    return { html: out.innerHTML, nav: nav };
  }
  function navHtml(nav) {
    return nav.map(function (n) {
      return '<li><a href="#' + n[0] + '" data-nav="' + n[0] + '"><span class="n-no">' + esc(n[2] ? n[1] : "") + '</span><span class="n-zh">' + esc(n[2] || n[1]) + "</span></a></li>";
    }).join("");
  }
  function navOpts(nav) {
    return nav.map(function (n) { return '<option value="' + n[0] + '">' + esc(n[1]) + " " + esc(n[2]) + "</option>"; }).join("");
  }

  /* ---------- 伺服器規則 ---------- */
  function lvBadge(k) { return '<span class="lv lv-' + k.toLowerCase() + '">' + LV[k] + "</span>"; }
  function renderRules(md) {
    var box = parse(md), toc = [], ch = 0, out = document.createElement("div"), rule = null;
    [].slice.call(box.childNodes).forEach(function (n) {
      if (n.nodeType !== 1) { if (rule) rule.appendChild(n); else out.appendChild(n); return; }
      var tag = n.tagName;
      if (tag === "H1") return;
      if (tag === "H2") {
        rule = null;
        var id = takeId(n) || ("ch" + (ch + 1));
        var title = n.textContent.trim();
        var appendix = /^附錄/.test(title);
        if (!appendix) ch++;
        n.id = id;
        n.innerHTML = "<small>" + (appendix ? "Appendix" : "Chapter " + ch) + "</small>" + esc(title);
        toc.push([id, title]); out.appendChild(n); return;
      }
      if (tag === "H4") {
        takeId(n);
        var t = n.textContent.trim(), lv = "", m;
        if ((m = t.match(/\s*\[([ABCD])\]\s*$/))) { lv = m[1]; t = t.slice(0, m.index).trim(); }
        var code = "", mc = t.match(/^(\d+(?:\.\d+)*)\s+(.*)$/);
        if (mc) { code = mc[1]; t = mc[2]; }
        rule = document.createElement("div"); rule.className = "rule";
        rule.innerHTML = "<h4>" + (code ? "<code>" + esc(code) + "</code>" : "") + esc(t) + (lv ? lvBadge(lv) : "") + "</h4>";
        out.appendChild(rule); return;
      }
      if (tag === "BLOCKQUOTE") {
        rule = null;
        var c = document.createElement("div"); c.className = "callout";
        var ps = n.querySelectorAll("p");
        c.innerHTML = ps.length ? [].map.call(ps, function (p) { return p.innerHTML; }).join("<br>") : n.innerHTML;
        out.appendChild(c); return;
      }
      if (tag === "TABLE") {
        rule = null;
        [].forEach.call(n.querySelectorAll("th,td"), function (td) {
          td.removeAttribute("align");
          td.innerHTML = td.innerHTML.replace(/\[([ABCD])\]/g, function (_, k) { return lvBadge(k); });
        });
        out.appendChild(n); wrapTable(n); return;
      }
      if ((tag === "P" || tag === "UL" || tag === "OL") && rule) { rule.appendChild(n); return; }
      rule = null; out.appendChild(n);
    });
    return { html: out.innerHTML, toc: toc };
  }

  /* ---------- 公告內文（純文字＋簡單格式） ---------- */
  function renderNotice(text) {
    var box = document.createElement("div");
    box.innerHTML = window.marked.parse(String(text || "").replace(/\r\n?/g, "\n"), { gfm: true, breaks: true });
    [].forEach.call(box.querySelectorAll("script,style,iframe,object,embed,form,input,button,textarea,select"), function (x) { x.remove(); });
    [].forEach.call(box.querySelectorAll("*"), function (x) {
      [].slice.call(x.attributes).forEach(function (a) {
        if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) x.removeAttribute(a.name);
      });
      if (x.tagName === "A") { x.setAttribute("target", "_blank"); x.setAttribute("rel", "noopener"); }
      if (x.tagName === "TABLE") wrapTable(x);
    });
    return box.innerHTML;
  }

  /* 依 "## " 標題把 Markdown 切成章節，編輯器用 */
  function splitChapters(md) {
    var lines = String(md || "").replace(/\r\n?/g, "\n").split("\n"), out = [], cur = { title: "（開頭）", lines: [] }, fence = false;
    lines.forEach(function (l) {
      if (/^```/.test(l)) fence = !fence;
      if (!fence && /^## /.test(l)) { out.push(cur); cur = { title: l.replace(/^##\s+/, "").replace(/\s*\{#[\w-]+\}\s*$/, ""), lines: [l] }; }
      else cur.lines.push(l);
    });
    out.push(cur);
    return out.map(function (c) { return { title: c.title, text: c.lines.join("\n").replace(/\n+$/, "") }; })
              .filter(function (c, i) { return i > 0 || c.text.trim(); });
  }

  window.PSRPMd = { renderBook: renderBook, renderRules: renderRules, renderNotice: renderNotice, navHtml: navHtml, navOpts: navOpts, splitChapters: splitChapters, esc: esc };
})();
