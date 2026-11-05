/* Palm State RolePlay — 共用帳號模組 */
(function () {
  var cfg = window.PSRP_CONFIG || {};

  /* 登入狀態保存：預設關閉瀏覽器就登出；勾選「保持登入」則保留 7 天 */
  var REMEMBER_KEY = "psrp-remember-until", REMEMBER_DAYS = 7;
  (function enforceSession() {
    try {
      var alive = /(?:^|;\s*)psrp_alive=1/.test(document.cookie);
      var until = parseInt(localStorage.getItem(REMEMBER_KEY) || "0", 10) || 0;
      var expired = until && until < Date.now();
      if ((!alive && !until) || expired) {
        Object.keys(localStorage).forEach(function (k) { if (/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k); });
        localStorage.removeItem(REMEMBER_KEY);
      }
      document.cookie = "psrp_alive=1; path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
    } catch (e) { /* 瀏覽器不允許儲存時略過 */ }
  })();
  function setRemember(on) {
    try {
      if (on) localStorage.setItem(REMEMBER_KEY, String(Date.now() + REMEMBER_DAYS * 86400000));
      else localStorage.removeItem(REMEMBER_KEY);
    } catch (e) { /* 略過 */ }
  }
  var ready = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  var client = ready ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

  var ROLE_NAMES = { admin: "管理團隊", reviewer: "招募審核", support: "工單客服", member: "Member", civ: "CIV", police: "LAPD", fire: "LAFD", ems: "EMS", police_cmd: "LAPD 高層", fire_cmd: "LAFD 高層", ems_cmd: "EMS 高層" };
  var DEPT_NAMES = { lapd: "洛杉磯警察局 LAPD", lafd: "洛杉磯消防局 LAFD", ems: "緊急醫療 EMS", whitelist: "白名單 Whitelist" };
  var STATUS_NAMES = { pending: "審核中", interview: "待面試", approved: "已錄取", rejected: "未錄取" };

  function errText(e) {
    var m = (e && (e.message || e.error_description)) || String(e || "");
    if (/Invalid login credentials/i.test(m)) return "Email 或密碼不正確。";
    if (/Email not confirmed/i.test(m)) return "請先到信箱點擊確認信中的連結，再登入。";
    if (/User already registered/i.test(m)) return "這個 Email 已經註冊過，請直接登入。";
    if (/manual linking is disabled|provider is not enabled|Unsupported provider/i.test(m)) return "Discord 連結功能尚未開放，請稍後再試。";
    if (/Identity is already linked/i.test(m)) return "這個 Discord 帳號已經連結到其他網站帳號。";
    if (/Password should be at least/i.test(m)) return "密碼至少需要 8 個字元。";
    if (/only request this after|security purposes/i.test(m)) return "請稍等一分鐘再重新寄送。";
    if (/New password should be different/i.test(m)) return "新密碼不能和舊密碼相同。";
    if (/rate limit/i.test(m)) return "操作太頻繁，請稍候幾分鐘再試。";
    if (/duplicate key|one_open_application/i.test(m)) return "你在這個部門已經有一份審核中的申請。";
    return m || "發生錯誤，請稍後再試。";
  }

  async function session() {
    if (!client) return null;
    var r = await client.auth.getSession();
    return r.data.session;
  }
  async function profile() {
    var s = await session();
    if (!s) return null;
    var r = await client.from("profiles").select("*").eq("id", s.user.id).single();
    if (r.error) return { id: s.user.id, email: s.user.email, display_name: "", discord: "", roles: [] };
    r.data.email = s.user.email;
    return r.data;
  }
  function hasRole(p, role) {
    return !!(p && p.roles && (p.roles.indexOf(role) !== -1 || p.roles.indexOf("admin") !== -1 || p.roles.indexOf(role + "_cmd") !== -1));
  }
  async function signIn(email, password) {
    var r = await client.auth.signInWithPassword({ email: email, password: password });
    if (r.error) throw r.error;
    return r.data;
  }
  async function signUp(email, password, displayName, discord) {
    var r = await client.auth.signUp({
      email: email, password: password,
      options: { data: { display_name: displayName, discord: discord }, emailRedirectTo: location.origin + location.pathname }
    });
    if (r.error) throw r.error;
    return r.data;
  }
  async function signOut() { setRemember(false); if (client) await client.auth.signOut(); location.reload(); }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (k === "class") e.className = attrs[k]; else e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  /* 登入／註冊表單，掛在 container 上；成功後呼叫 onDone */
  function mountAuthForm(container, onDone, intro) {
    container.innerHTML = "";
    if (!client) {
      container.appendChild(el("div", { class: "notice warn" }, "帳號系統尚未啟用，請稍後再來。"));
      return;
    }
    var mode = "login";
    var box = el("div", { class: "auth-card" });
    var tabs = el("div", { class: "auth-tabs", role: "tablist" });
    var tLogin = el("button", { type: "button", class: "on" }, "登入");
    var tReg = el("button", { type: "button" }, "註冊新帳號");
    tabs.appendChild(tLogin); tabs.appendChild(tReg);
    if (intro) box.appendChild(el("p", { class: "auth-intro" }, intro));
    box.appendChild(tabs);
    var form = el("form", { class: "auth-form", novalidate: "" });
    function field(id, label, type, ph, auto) {
      var w = el("label", { class: "fld", for: id });
      w.appendChild(el("span", null, label));
      var i = el("input", { id: id, type: type, placeholder: ph || "", autocomplete: auto || "off", required: "" });
      w.appendChild(i);
      return { wrap: w, input: i };
    }
    var fName = field("au-name", "遊戲角色或暱稱", "text", "例如：John Carter", "nickname");
    var fDc = field("au-dc", "Discord 使用者名稱", "text", "例如：johncarter", "off");
    var fEmail = field("au-email", "Email", "email", "you@example.com", "email");
    var fPw = field("au-pw", "密碼（至少 8 個字元）", "password", "", "current-password");
    form.appendChild(fName.wrap); form.appendChild(fDc.wrap); form.appendChild(fEmail.wrap); form.appendChild(fPw.wrap);
    var msg = el("p", { class: "form-msg", role: "status" });
    var btn = el("button", { type: "submit", class: "btn-primary" }, "登入");
    var forgot = el("button", { type: "button", class: "auth-forgot" }, "忘記密碼？");
    var remWrap = el("label", { class: "check" });
    var rem = el("input", { type: "checkbox", id: "au-remember" });
    remWrap.appendChild(rem); remWrap.appendChild(el("span", null, "保持登入 7 天（公用電腦請勿勾選）"));
    form.appendChild(remWrap);
    form.appendChild(msg); form.appendChild(btn); form.appendChild(forgot);
    box.appendChild(form);
    forgot.addEventListener("click", async function () {
      var email = fEmail.input.value.trim();
      msg.className = "form-msg";
      if (!email) { msg.className = "form-msg err"; msg.textContent = "請先在上方輸入你的 Email，再按「忘記密碼？」。"; fEmail.input.focus(); return; }
      forgot.disabled = true;
      var r = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/apply/" });
      forgot.disabled = false;
      if (r.error) { msg.className = "form-msg err"; msg.textContent = errText(r.error); return; }
      msg.className = "form-msg ok"; msg.textContent = "如果這個 Email 有註冊過，重設密碼的信已寄出，請到信箱查看（也請檢查垃圾郵件）。";
    });
    container.appendChild(box);
    function setMode(m) {
      mode = m;
      forgot.hidden = m !== "login";
      tLogin.className = m === "login" ? "on" : ""; tReg.className = m === "reg" ? "on" : "";
      fName.wrap.hidden = m === "login"; fDc.wrap.hidden = m === "login";
      fPw.input.setAttribute("autocomplete", m === "login" ? "current-password" : "new-password");
      btn.textContent = m === "login" ? "登入" : "建立帳號";
      msg.textContent = ""; msg.className = "form-msg";
    }
    setMode("login");
    tLogin.addEventListener("click", function () { setMode("login"); });
    tReg.addEventListener("click", function () { setMode("reg"); });
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      msg.className = "form-msg"; msg.textContent = "";
      var email = fEmail.input.value.trim(), pw = fPw.input.value;
      if (!email || !pw) { msg.className = "form-msg err"; msg.textContent = "請輸入 Email 和密碼。"; return; }
      if (mode === "reg") {
        if (!fName.input.value.trim() || !fDc.input.value.trim()) { msg.className = "form-msg err"; msg.textContent = "請填寫暱稱與 Discord 使用者名稱。"; return; }
        if (pw.length < 8) { msg.className = "form-msg err"; msg.textContent = "密碼至少需要 8 個字元。"; return; }
      }
      btn.disabled = true;
      try {
        if (mode === "login") { await signIn(email, pw); setRemember(rem.checked); onDone && onDone(); }
        else {
          var d = await signUp(email, pw, fName.input.value.trim(), fDc.input.value.trim());
          if (d.session) { setRemember(rem.checked); onDone && onDone(); }
          else { msg.className = "form-msg ok"; msg.textContent = "帳號已建立。請到信箱點擊確認信中的連結，然後回來登入。"; setMode("login"); fEmail.input.value = email; }
        }
      } catch (err) { msg.className = "form-msg err"; msg.textContent = errText(err); }
      btn.disabled = false;
    });
  }

  /* 右上角帳號狀態 */
  async function mountAccountChip(container) {
    if (!container) return;
    var token = (container._chipToken = (container._chipToken || 0) + 1);
    var p = await profile();
    if (token !== container._chipToken) return; /* 只保留最後一次呼叫的結果，避免重複顯示 */
    container.innerHTML = "";
    if (!p) {
      var a = el("a", { href: "/apply/", class: "chip-login" }, "登入／註冊");
      container.appendChild(a); return;
    }
    var name = el("button", { type: "button", class: "chip-name", title: "修改顯示名稱", style: "background:none;border:0;padding:4px 2px;font:inherit;font-weight:500;color:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:5px" }, p.display_name || p.email);
    name.appendChild(el("span", { "aria-hidden": "true", style: "font-size:11px;opacity:.6" }, "✎"));
    name.addEventListener("click", function () { editName(p, function () { mountAccountChip(container); }); });
    container.appendChild(name);
    if (hasRole(p, "reviewer")) container.appendChild(el("a", { href: "/admin/", class: "chip-link" }, "管理後台"));
    else if (hasRole(p, "support")) container.appendChild(el("a", { href: "/support/", class: "chip-link" }, "工單管理"));
    else container.appendChild(el("a", { href: "/support/", class: "chip-link" }, "工單"));
    var out = el("button", { type: "button", class: "chip-out" }, "登出");
    out.addEventListener("click", signOut);
    container.appendChild(out);
  }

  /* 修改自己的顯示名稱（論壇、聊天室與網站上顯示的名字） */
  function editName(p, done) {
    if (document.getElementById("psrp-name")) return;
    var wrap = el("div", { id: "psrp-name", role: "dialog", "aria-modal": "true", "aria-label": "修改顯示名稱", style: "position:fixed;inset:0;z-index:100;background:rgba(5,8,20,.75);display:flex;align-items:center;justify-content:center;padding:16px;font-family:'Noto Sans TC',system-ui,sans-serif" });
    var card = el("form", { novalidate: "", style: "width:100%;max-width:420px;background:#151b36;color:#eef0f7;border:1px solid #2b3460;border-radius:12px;padding:22px;display:grid;gap:12px;box-shadow:0 20px 50px rgba(0,0,0,.5)" });
    card.appendChild(el("h2", { style: "margin:0;font-size:20px" }, "修改顯示名稱"));
    card.appendChild(el("p", { style: "margin:0;color:#a3abc8;font-size:14px;line-height:1.6" }, "這個名字會顯示在網站右上角、論壇與聊天室。之後發的文章和訊息會用新名字，已經發過的不會改變。"));
    var inp = el("input", { maxlength: "24", autocomplete: "nickname", "aria-label": "顯示名稱", style: "width:100%;box-sizing:border-box;font:inherit;font-size:16px;color:#eef0f7;background:#0d1124;border:1px solid #2b3460;border-radius:8px;padding:10px 12px" });
    inp.value = p.display_name || "";
    card.appendChild(inp);
    var msg = el("p", { role: "status", style: "margin:0;min-height:1.2em;font-size:13.5px;color:#ff5c6c" });
    card.appendChild(msg);
    var row = el("div", { style: "display:flex;gap:8px;justify-content:flex-end" });
    var cancel = el("button", { type: "button", style: "font:inherit;background:none;border:1px solid #2b3460;color:#eef0f7;border-radius:8px;padding:8px 16px;cursor:pointer" }, "取消");
    var ok = el("button", { type: "submit", style: "font:inherit;font-weight:700;background:#e8b85a;border:0;color:#1b1405;border-radius:8px;padding:8px 18px;cursor:pointer" }, "儲存");
    row.appendChild(cancel); row.appendChild(ok); card.appendChild(row);
    wrap.appendChild(card); document.body.appendChild(wrap);
    function close() { wrap.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    cancel.addEventListener("click", close);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    card.addEventListener("submit", async function (e) {
      e.preventDefault();
      var v = inp.value.replace(/\s+/g, " ").trim();
      if (v.length < 2) { msg.textContent = "名稱至少 2 個字。"; inp.focus(); return; }
      if (v === p.display_name) { close(); return; }
      ok.disabled = true; msg.textContent = "";
      var r = await client.from("profiles").update({ display_name: v }).eq("id", p.id);
      ok.disabled = false;
      if (r.error) { msg.textContent = "儲存失敗：" + errText(r.error); return; }
      p.display_name = v; close(); if (done) done();
    });
    setTimeout(function () { inp.focus(); inp.select(); }, 30);
  }

  /* 從重設密碼信回來時，顯示設定新密碼的視窗 */
  function showRecovery() {
    if (document.getElementById("psrp-recovery")) return;
    var wrap = el("div", { id: "psrp-recovery", style: "position:fixed;inset:0;z-index:100;background:rgba(5,8,20,.75);display:flex;align-items:center;justify-content:center;padding:16px" });
    var card = el("form", { class: "auth-card", style: "width:100%;max-width:420px;margin:0", novalidate: "" });
    card.appendChild(el("h2", { style: "margin:0 0 6px;font-size:22px" }, "設定新密碼"));
    card.appendChild(el("p", { class: "auth-intro" }, "請輸入你的新密碼（至少 8 個字元）。"));
    var lab = el("label", { class: "fld", for: "rc-pw" }); lab.appendChild(el("span", null, "新密碼"));
    var pw = el("input", { id: "rc-pw", type: "password", autocomplete: "new-password", required: "" }); lab.appendChild(pw);
    var lab2 = el("label", { class: "fld", for: "rc-pw2" }); lab2.appendChild(el("span", null, "再輸入一次"));
    var pw2 = el("input", { id: "rc-pw2", type: "password", autocomplete: "new-password", required: "" }); lab2.appendChild(pw2);
    var m = el("p", { class: "form-msg", role: "status" });
    var b = el("button", { type: "submit", class: "btn-primary" }, "更新密碼");
    [lab, lab2, m, b].forEach(function (x) { card.appendChild(x); });
    wrap.appendChild(card); document.body.appendChild(wrap); pw.focus();
    card.addEventListener("submit", async function (e) {
      e.preventDefault(); m.className = "form-msg";
      if (pw.value.length < 8) { m.className = "form-msg err"; m.textContent = "密碼至少需要 8 個字元。"; return; }
      if (pw.value !== pw2.value) { m.className = "form-msg err"; m.textContent = "兩次輸入的密碼不一樣。"; return; }
      b.disabled = true;
      var r = await client.auth.updateUser({ password: pw.value });
      b.disabled = false;
      if (r.error) { m.className = "form-msg err"; m.textContent = errText(r.error); return; }
      m.className = "form-msg ok"; m.textContent = "密碼已更新！";
      setTimeout(function () { wrap.remove(); location.replace(location.pathname); }, 1200);
    });
  }
  if (client) client.auth.onAuthStateChange(function (ev) { if (ev === "PASSWORD_RECOVERY") showRecovery(); });

  window.PSRP = {
    client: client, ready: !!client, session: session, profile: profile, hasRole: hasRole,
    signIn: signIn, signUp: signUp, signOut: signOut, errText: errText,
    mountAuthForm: mountAuthForm, mountAccountChip: mountAccountChip, el: el,
    ROLE_NAMES: ROLE_NAMES, DEPT_NAMES: DEPT_NAMES, STATUS_NAMES: STATUS_NAMES
  };
})();
