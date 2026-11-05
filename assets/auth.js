/* Palm State RolePlay — 共用帳號模組 */
(function () {
  var cfg = window.PSRP_CONFIG || {};
  var ready = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  var client = ready ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

  var ROLE_NAMES = { admin: "管理團隊", reviewer: "招募審核", police: "LAPD", fire: "LAFD", ems: "EMS" };
  var DEPT_NAMES = { lapd: "洛杉磯警察局 LAPD", lafd: "洛杉磯消防局 LAFD", ems: "緊急醫療 EMS" };
  var STATUS_NAMES = { pending: "審核中", interview: "待面試", approved: "已錄取", rejected: "未錄取" };

  function errText(e) {
    var m = (e && (e.message || e.error_description)) || String(e || "");
    if (/Invalid login credentials/i.test(m)) return "Email 或密碼不正確。";
    if (/Email not confirmed/i.test(m)) return "請先到信箱點擊確認信中的連結，再登入。";
    if (/User already registered/i.test(m)) return "這個 Email 已經註冊過，請直接登入。";
    if (/Password should be at least/i.test(m)) return "密碼至少需要 8 個字元。";
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
    return !!(p && p.roles && (p.roles.indexOf(role) !== -1 || p.roles.indexOf("admin") !== -1));
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
  async function signOut() { if (client) await client.auth.signOut(); location.reload(); }

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
    form.appendChild(msg); form.appendChild(btn);
    box.appendChild(form);
    container.appendChild(box);
    function setMode(m) {
      mode = m;
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
        if (mode === "login") { await signIn(email, pw); onDone && onDone(); }
        else {
          var d = await signUp(email, pw, fName.input.value.trim(), fDc.input.value.trim());
          if (d.session) { onDone && onDone(); }
          else { msg.className = "form-msg ok"; msg.textContent = "帳號已建立。請到信箱點擊確認信中的連結，然後回來登入。"; setMode("login"); fEmail.input.value = email; }
        }
      } catch (err) { msg.className = "form-msg err"; msg.textContent = errText(err); }
      btn.disabled = false;
    });
  }

  /* 右上角帳號狀態 */
  async function mountAccountChip(container) {
    if (!container) return;
    container.innerHTML = "";
    var p = await profile();
    if (!p) {
      var a = el("a", { href: "/apply/", class: "chip-login" }, "登入／註冊");
      container.appendChild(a); return;
    }
    var name = el("span", { class: "chip-name" }, p.display_name || p.email);
    container.appendChild(name);
    (p.roles || []).forEach(function (r) { container.appendChild(el("span", { class: "chip-role r-" + r }, ROLE_NAMES[r] || r)); });
    if (hasRole(p, "reviewer")) container.appendChild(el("a", { href: "/admin/", class: "chip-link" }, "管理後台"));
    var out = el("button", { type: "button", class: "chip-out" }, "登出");
    out.addEventListener("click", signOut);
    container.appendChild(out);
  }

  window.PSRP = {
    client: client, ready: !!client, session: session, profile: profile, hasRole: hasRole,
    signIn: signIn, signUp: signUp, signOut: signOut, errText: errText,
    mountAuthForm: mountAuthForm, mountAccountChip: mountAccountChip, el: el,
    ROLE_NAMES: ROLE_NAMES, DEPT_NAMES: DEPT_NAMES, STATUS_NAMES: STATUS_NAMES
  };
})();
