/* Palm State RolePlay — 聊天室語音頻道
   玩家之間直接連線（WebRTC），Supabase Realtime 負責交換連線資訊。
   最多 10 人同時在一個頻道。 */
(function () {
  "use strict";
  var V = window.PSRPVoice = {};
  var ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }, { urls: "stun:stun.cloudflare.com:3478" }];
  if (window.PSRP_CONFIG && window.PSRP_CONFIG.turn) ICE = ICE.concat(window.PSRP_CONFIG.turn);

  var db, me, staff, el, myName, token = null;
  var rooms = [], room = null, stream = null, muted = false, deafened = false;
  var sig = null, myKey = "", peers = {}, listCh = null, pingT = null, refreshT = null, meterT = null;
  var speaking = {}, vols = {}, actx = null, analysers = {};
  var skew = 0, yt = null, ytReady = false, ytWant = null, musicOpen = false, musicVol = 50, driftT = null, startT = null;
  try { var mv = Number(localStorage.getItem("psrp-music-vol")); if (mv >= 0 && mv <= 100 && localStorage.getItem("psrp-music-vol") !== null) musicVol = mv; } catch (e) { /* 略過 */ }
  var MAXDEF = 10;

  function $(id) { return document.getElementById(id); }
  function err(e) { return window.PSRP.errText(e); }
  function toast(t, bad) {
    var x = el("div", { class: "vtoast" + (bad ? " bad" : ""), role: "status" }, t);
    document.body.appendChild(x); setTimeout(function () { x.remove(); }, 4200);
  }
  try { vols = JSON.parse(localStorage.getItem("psrp-voice-vol") || "{}") || {}; } catch (e) { vols = {}; }
  function saveVols() { try { localStorage.setItem("psrp-voice-vol", JSON.stringify(vols)); } catch (e) { /* 略過 */ } }

  /* ---------- 頻道列表 ---------- */
  async function refresh() {
    var r = await db.rpc("voice_list");
    if (r.error) return;
    rooms = r.data || [];
    if (rooms[0] && rooms[0].now_ms) skew = Number(rooms[0].now_ms) - Date.now();
    if (room) {
      var still = rooms.filter(function (x) { return x.id === room.id; })[0];
      if (!still) { leave("語音頻道已關閉。"); return; }
      room = still;
    }
    render();
    if (room) applyMusic(room.music); else applyMusic(null);
  }
  function soon() { clearTimeout(refreshT); refreshT = setTimeout(refresh, 350); }
  function canManage(r) { return staff || (r.owner_id === me.id); }

  function render() {
    var l = $("vlist"); if (!l) return; l.innerHTML = "";
    if (!rooms.length) l.appendChild(el("p", { class: "vnone" }, "目前沒有語音頻道，按「＋」建立一個。"));
    rooms.forEach(function (r) {
      var cap = r.max_users > 0 ? r.max_users : MAXDEF, n = r.members.length;
      var wrap = el("div", { class: "vroom" + (room && room.id === r.id ? " on" : "") });
      var b = el("button", { type: "button", class: "chb vjoin", title: room && room.id === r.id ? "你在這個頻道" : "加入語音" });
      b.appendChild(el("span", { class: "hash" }, r.locked ? "🔒" : r.has_pin ? "🔑" : "🔊"));
      b.appendChild(el("span", { class: "vname" }, r.name));
      b.appendChild(el("span", { class: "vcnt" }, n + (r.max_users > 0 ? "/" + cap : "")));
      b.addEventListener("click", function () { if (!room || room.id !== r.id) join(r); });
      var row = el("div", { class: "vhead" }); row.appendChild(b);
      if (canManage(r)) {
        var g = el("button", { type: "button", class: "vgear", title: "管理語音頻道", "aria-label": "管理「" + r.name + "」" }, "⚙");
        g.addEventListener("click", function () { settings(r); }); row.appendChild(g);
      }
      wrap.appendChild(row);
      var tags = []; if (r.permanent) tags.push("常駐頻道"); if (r.has_pin) tags.push("需要密碼");
      if (r.music && r.music.cur) tags.push("🎵 " + r.music.cur.title);
      if (tags.length) wrap.appendChild(el("div", { class: "vtag" }, tags.join(" · ")));
      if (n) {
        var ul = el("ul", { class: "vmem" });
        r.members.forEach(function (m) {
          var li = el("li", { class: (speaking[m.id] ? "spk" : "") + (m.id === me.id ? " self" : ""), "data-uid": m.id });
          li.appendChild(el("span", { class: "vav" }, String(m.name || "?").trim().charAt(0).toUpperCase()));
          li.appendChild(el("span", { class: "vmn" }, m.name));
          var mm = m.id === me.id ? muted : m.muted;
          if (mm) li.appendChild(el("span", { class: "vmic", title: "已靜音" }, "🔇"));
          if (r.owner_id === m.id && !r.permanent) li.appendChild(el("span", { class: "vown", title: "頻道建立者" }, "👑"));
          if (room && room.id === r.id && m.id !== me.id) {
            li.classList.add("tap"); li.title = "調整音量";
            li.addEventListener("click", function (e) { e.stopPropagation(); memberMenu(li, r, m); });
          }
          ul.appendChild(li);
        });
        wrap.appendChild(ul);
      }
      l.appendChild(wrap);
    });
    renderBar();
  }

  function renderBar() {
    var bar = $("vbar"), ind = $("vind");
    if (!bar) return;
    bar.hidden = !room; if (ind) ind.hidden = !room;
    if (!room) return;
    $("vbar-name").textContent = room.name;
    if (ind) ind.textContent = "🔊 " + room.name;
    var mb = $("vbar-mute"); mb.textContent = muted ? "🔇" : "🎙️"; mb.setAttribute("aria-pressed", String(muted)); mb.title = muted ? "取消靜音" : "靜音麥克風";
    var db2 = $("vbar-deaf"); db2.textContent = deafened ? "🔈" : "🎧"; db2.setAttribute("aria-pressed", String(deafened)); db2.title = deafened ? "恢復聲音" : "關閉所有聲音";
    var hb = $("vbar-hq"); if (hb) { hb.setAttribute("aria-pressed", String(hq)); hb.title = hq ? "高音質模式（點一下改回標準）" : "標準音質（點一下切換高音質）"; }
    $("vbar-state").textContent = stream ? (Object.keys(peers).length ? "語音已連線" : "等待其他人加入") : "只能聽（沒有麥克風）";
  }

  function memberMenu(anchor, r, m) {
    var old = document.querySelector(".vpop"); if (old) old.remove();
    var p = el("div", { class: "vpop", role: "dialog", "aria-label": m.name });
    p.appendChild(el("b", null, m.name));
    var lab = el("label", null, "音量 "); var s = el("input", { type: "range", min: "0", max: "100", step: "5" });
    s.value = String(vols[m.id] == null ? 100 : vols[m.id]);
    var pct = el("span", null, s.value + "%");
    s.addEventListener("input", function () { vols[m.id] = Number(s.value); pct.textContent = s.value + "%"; applyVol(); saveVols(); });
    lab.appendChild(s); lab.appendChild(pct); p.appendChild(lab);
    if (canManage(r)) {
      var k = el("button", { type: "button", class: "vkick" }, "移出頻道");
      k.addEventListener("click", function () { kick(r, m); p.remove(); });
      p.appendChild(k);
    }
    anchor.appendChild(p);
    setTimeout(function () { document.addEventListener("click", function off(e) { if (!p.contains(e.target)) { p.remove(); document.removeEventListener("click", off); } }); }, 0);
  }
  function applyVol() {
    Object.keys(peers).forEach(function (k) { var pr = peers[k]; if (pr.audio) { var v = vols[pr.uid] == null ? 100 : vols[pr.uid]; pr.audio.volume = deafened ? 0 : v / 100; } });
  }

  /* ---------- 建立／設定 ---------- */
  function dialog(title, body, foot) {
    var d = el("div", { class: "dlg", role: "dialog", "aria-modal": "true", "aria-label": title }), bx = el("div", { class: "box vbox" });
    var hd = el("header"); hd.appendChild(el("h3", null, title));
    var x = el("button", { type: "button", class: "btn-sec" }, "關閉"); x.addEventListener("click", function () { d.remove(); }); hd.appendChild(x);
    var bd = el("div", { class: "bd" }); body(bd);
    var ft = el("div", { class: "ft" }); foot(ft, d);
    bx.appendChild(hd); bx.appendChild(bd); bx.appendChild(ft); d.appendChild(bx); document.body.appendChild(d);
    d.addEventListener("keydown", function (e) { if (e.key === "Escape") d.remove(); });
    var f = bd.querySelector("input"); if (f) f.focus();
    return d;
  }
  function fields(bd, r) {
    var f = {};
    var l1 = el("label", { class: "vf" }, "頻道名稱"); f.name = el("input", { maxlength: "30", required: "" }); f.name.value = r ? r.name : (myName + " 的頻道").slice(0, 30); l1.appendChild(f.name); bd.appendChild(l1);
    var l2 = el("label", { class: "vf" }, "人數上限"); f.max = el("select");
    f.max.appendChild(el("option", { value: "0" }, "不限（最多 10 人）"));
    for (var i = 2; i <= 10; i++) f.max.appendChild(el("option", { value: String(i) }, i + " 人"));
    f.max.value = String(r ? r.max_users : 0); l2.appendChild(f.max); bd.appendChild(l2);
    var l3 = el("label", { class: "vchk" }); f.lock = el("input", { type: "checkbox" }); f.lock.checked = !!(r && r.locked);
    l3.appendChild(f.lock); l3.appendChild(el("span", null, "上鎖（其他人不能加入，已在裡面的人不受影響）")); bd.appendChild(l3);
    var l5 = el("label", { class: "vf" }, "4 位數密碼");
    var row = el("div", { class: "vpinrow" });
    f.pinMode = el("select", { "aria-label": "密碼設定" });
    if (r && r.has_pin) f.pinMode.appendChild(el("option", { value: "keep" }, "保留目前的密碼"));
    f.pinMode.appendChild(el("option", { value: "none" }, r && r.has_pin ? "取消密碼" : "不需要密碼"));
    f.pinMode.appendChild(el("option", { value: "set" }, r && r.has_pin ? "改成新密碼" : "設定密碼"));
    f.pin = el("input", { inputmode: "numeric", maxlength: "4", pattern: "[0-9]{4}", placeholder: "例如 0420", autocomplete: "off", "aria-label": "4 位數密碼" });
    f.pin.hidden = true;
    f.pinMode.addEventListener("change", function () { f.pin.hidden = f.pinMode.value !== "set"; if (!f.pin.hidden) f.pin.focus(); });
    f.pin.addEventListener("input", function () { f.pin.value = f.pin.value.replace(/\D/g, "").slice(0, 4); });
    row.appendChild(f.pinMode); row.appendChild(f.pin); l5.appendChild(row); bd.appendChild(l5);
    bd.appendChild(el("p", { class: "note", style: "margin:-4px 0 0;font-size:12.5px" }, "有密碼的頻道，其他人要輸入正確密碼才能加入（建立者和管理團隊不用）。"));
    return f;
  }
  /* 回傳要送給伺服器的密碼：null = 不變、"" = 取消、4 位數 = 設定；格式錯誤回傳 false */
  function pinValue(f) {
    if (f.pinMode.value === "keep") return null;
    if (f.pinMode.value === "none") return "";
    return /^\d{4}$/.test(f.pin.value) ? f.pin.value : false;
  }
  function create() {
    var f;
    dialog("建立語音頻道", function (bd) {
      f = fields(bd, null);
      if (staff) {
        var l4 = el("label", { class: "vchk" }); f.perm = el("input", { type: "checkbox" });
        l4.appendChild(f.perm); l4.appendChild(el("span", null, "常駐頻道（管理團隊專用：沒人時也不會關閉）")); bd.appendChild(l4);
      }
      bd.appendChild(el("p", { class: "note", style: "margin:0" }, "建立後你會自動加入。所有人離開後，頻道會自動關閉。"));
    }, function (ft, d) {
      var msg = el("span", { class: "form-msg", role: "status" });
      var ok = el("button", { type: "button", class: "btn-primary" }, "建立並加入");
      ok.addEventListener("click", async function () {
        var pin = pinValue(f);
        if (pin === false) { msg.className = "form-msg err"; msg.textContent = "密碼要是 4 位數字。"; f.pin.focus(); return; }
        ok.disabled = true; msg.className = "form-msg"; msg.textContent = "建立中…";
        var perm = !!(f.perm && f.perm.checked);
        var r = await db.rpc("voice_create", { p_name: f.name.value, p_max: Number(f.max.value), p_locked: f.lock.checked, p_permanent: perm, p_pin: pin || null });
        if (r.error) { ok.disabled = false; msg.className = "form-msg err"; msg.textContent = err(r.error); return; }
        d.remove(); await refresh();
        var nr = rooms.filter(function (x) { return x.id === r.data; })[0];
        if (nr) join(nr, !perm);
      });
      ft.appendChild(el("span")); var rt = el("div", { style: "display:flex;gap:10px;align-items:center" }); rt.appendChild(msg); rt.appendChild(ok); ft.appendChild(rt);
    });
  }
  function settings(r) {
    var f;
    dialog("管理語音頻道", function (bd) {
      f = fields(bd, r);
      bd.appendChild(el("h4", { class: "vsub" }, "頻道成員（" + r.members.length + "）"));
      if (!r.members.length) bd.appendChild(el("p", { class: "note", style: "margin:0" }, "目前沒有人。"));
      r.members.forEach(function (m) {
        var row = el("div", { class: "vmrow" }); row.appendChild(el("span", null, m.name + (m.id === me.id ? "（你）" : "")));
        if (m.id !== me.id) { var k = el("button", { type: "button", class: "btn-sec vkick" }, "移出"); k.addEventListener("click", async function () { if (await kick(r, m)) row.remove(); }); row.appendChild(k); }
        bd.appendChild(row);
      });
    }, function (ft, d) {
      var close = el("button", { type: "button", class: "btn-sec vdanger" }, "關閉頻道");
      close.addEventListener("click", async function () {
        if (!confirm("關閉「" + r.name + "」？裡面的人都會被中斷語音。")) return;
        var x = await db.rpc("voice_close", { p_room: r.id }); if (x.error) return alert(err(x.error));
        if (sig && room && room.id === r.id) sig.send({ type: "broadcast", event: "ctl", payload: { t: "closed" } });
        else sendCtl(r.id, { t: "closed" });
        d.remove(); refresh();
      });
      var msg = el("span", { class: "form-msg", role: "status" });
      var ok = el("button", { type: "button", class: "btn-primary" }, "儲存");
      ok.addEventListener("click", async function () {
        var pin = pinValue(f);
        if (pin === false) { msg.className = "form-msg err"; msg.textContent = "密碼要是 4 位數字。"; f.pin.focus(); return; }
        ok.disabled = true;
        var x = await db.rpc("voice_update", { p_room: r.id, p_name: f.name.value, p_max: Number(f.max.value), p_locked: f.lock.checked, p_pin: pin });
        if (x.error) { ok.disabled = false; msg.className = "form-msg err"; msg.textContent = err(x.error); return; }
        d.remove(); refresh();
      });
      ft.appendChild(close); var rt = el("div", { style: "display:flex;gap:10px;align-items:center" }); rt.appendChild(msg); rt.appendChild(ok); ft.appendChild(rt);
    });
  }
  async function kick(r, m) {
    if (!confirm("把 " + m.name + " 移出「" + r.name + "」？對方之後不能再加入這個頻道。")) return false;
    var x = await db.rpc("voice_kick", { p_room: r.id, p_user: m.id });
    if (x.error) { alert(err(x.error)); return false; }
    if (sig && room && room.id === r.id) sig.send({ type: "broadcast", event: "ctl", payload: { t: "kick", uid: m.id } });
    else sendCtl(r.id, { t: "kick", uid: m.id });
    refresh(); return true;
  }
  /* 不在頻道裡（管理團隊從外面管理）也能通知裡面的人 */
  function sendCtl(id, payload) {
    var c = db.channel("psrp-voice-" + id);
    c.subscribe(function (s) { if (s === "SUBSCRIBED") { c.send({ type: "broadcast", event: "ctl", payload: payload }); setTimeout(function () { db.removeChannel(c); }, 800); } });
  }

  /* ---------- 加入／離開 ---------- */
  async function join(r, already) {
    if (room) await leave();
    if (!window.RTCPeerConnection) { toast("你的瀏覽器不支援語音，請改用最新版 Chrome、Edge 或 Safari。", true); return; }
    if (!already) {
      var j = await db.rpc("voice_join", { p_room: r.id });
      if (j.error) { toast(err(j.error), true); refresh(); return; }
      if (j.data === "NEED_PIN") { var okp = await askPin(r); if (!okp) return; }
    }
    try {
      stream = await getMic();
    } catch (e) {
      stream = null; toast("沒有取得麥克風權限，你可以聽，但其他人聽不到你。", true);
    }
    room = r; muted = !stream; deafened = false;
    if (stream) meter("me", stream);
    myKey = me.id + ":" + Math.random().toString(36).slice(2, 8);
    sig = db.channel("psrp-voice-" + r.id, { config: { broadcast: { self: false }, presence: { key: myKey } } });
    sig.on("broadcast", { event: "sig" }, function (p) { onSignal(p.payload); })
       .on("broadcast", { event: "ctl" }, function (p) { onCtl(p.payload); })
       .on("presence", { event: "sync" }, function () { syncPeers(sig.presenceState()); })
       .subscribe(function (s) { if (s === "SUBSCRIBED") sig.track({ uid: me.id, name: myName }); });
    clearInterval(pingT);
    pingT = setInterval(ping, 15000);
    try { var ss = await db.auth.getSession(); token = ss.data.session && ss.data.session.access_token; } catch (e) { token = null; }
    await refresh();
  }
  function askPin(r) {
    return new Promise(function (done) {
      var f, msg, ok, busy = false, d;
      async function go() {
        if (busy) return;
        if (!/^\d{4}$/.test(f.value)) { msg.className = "form-msg err"; msg.textContent = "請輸入 4 位數字。"; return; }
        busy = true; ok.disabled = true;
        var j = await db.rpc("voice_join", { p_room: r.id, p_pin: f.value });
        busy = false; ok.disabled = false;
        if (j.error) { msg.className = "form-msg err"; msg.textContent = err(j.error); return; }
        if (j.data !== "ok") { msg.className = "form-msg err"; msg.textContent = "密碼錯誤（10 分鐘內最多試 5 次）。"; f.value = ""; f.focus(); return; }
        d.remove(); done(true);
      }
      d = dialog("輸入密碼", function (bd) {
        bd.appendChild(el("p", { style: "margin:0" }, "「" + r.name + "」需要 4 位數密碼才能加入。"));
        f = el("input", { class: "vpin", inputmode: "numeric", maxlength: "4", autocomplete: "off", placeholder: "••••", "aria-label": "4 位數密碼" });
        f.addEventListener("input", function () { f.value = f.value.replace(/\D/g, "").slice(0, 4); if (f.value.length === 4) go(); });
        f.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
        bd.appendChild(f);
      }, function (ft) {
        msg = el("span", { class: "form-msg", role: "status" }); ok = el("button", { type: "button", class: "btn-primary" }, "加入");
        ok.addEventListener("click", go); ft.appendChild(msg); ft.appendChild(ok);
      });
      d.querySelector("header .btn-sec").addEventListener("click", function () { done(false); });
    });
  }
  /* 音質：標準＝降噪＋自動音量（喇叭也不會回音）；高音質＝關掉降噪和自動音量（建議戴耳機） */
  var hq = false;
  try { hq = localStorage.getItem("psrp-voice-hq") === "1"; } catch (e) { /* 略過 */ }
  function getMic() {
    return navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true, noiseSuppression: !hq, autoGainControl: !hq,
      channelCount: 1, sampleRate: 48000, sampleSize: 16
    } });
  }
  /* 提高 Opus 位元率（預設只有約 32kbps） */
  function tuneSdp(sdp) {
    var m = sdp.match(/a=rtpmap:(\d+) opus\/48000/i); if (!m) return sdp;
    var pt = m[1], re = new RegExp("a=fmtp:" + pt + " ([^\\r\\n]*)");
    var extra = { maxaveragebitrate: hq ? "128000" : "64000", useinbandfec: "1", usedtx: "0", maxplaybackrate: "48000", stereo: "0", "sprop-stereo": "0", cbr: "0" };
    if (re.test(sdp)) {
      return sdp.replace(re, function (all, params) {
        var kv = {}; params.split(";").forEach(function (p) { var i = p.indexOf("="); if (i > 0) kv[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
        Object.keys(extra).forEach(function (k) { kv[k] = extra[k]; });
        return "a=fmtp:" + pt + " " + Object.keys(kv).map(function (k) { return k + "=" + kv[k]; }).join(";");
      });
    }
    return sdp.replace(m[0], m[0] + "\r\na=fmtp:" + pt + " " + Object.keys(extra).map(function (k) { return k + "=" + extra[k]; }).join(";"));
  }
  function boost(pc) {
    pc.getSenders().forEach(function (sn) {
      if (!sn.track || sn.track.kind !== "audio" || !sn.getParameters) return;
      try {
        var p = sn.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = hq ? 128000 : 64000; p.encodings[0].priority = "high"; p.encodings[0].networkPriority = "high";
        sn.setParameters(p).catch(function () { /* 不支援就用預設 */ });
      } catch (e) { /* 略過 */ }
    });
  }
  async function setHQ(on) {
    hq = on; try { localStorage.setItem("psrp-voice-hq", on ? "1" : "0"); } catch (e) { /* 略過 */ }
    renderBar();
    if (!room || !stream) return;
    try {
      var ns = await getMic(), nt = ns.getAudioTracks()[0];
      nt.enabled = !muted;
      Object.keys(peers).forEach(function (k) { peers[k].pc.getSenders().forEach(function (sn) { if (sn.track && sn.track.kind === "audio") sn.replaceTrack(nt); }); boost(peers[k].pc); });
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = ns; meter("me", stream);
      Object.keys(peers).forEach(function (k) { if (myKey < k) offer(k); });
      toast(hq ? "已切換到高音質（建議戴耳機，避免回音）。" : "已切換到標準音質（有降噪）。");
    } catch (e) { toast("切換失敗：" + (e && e.message || e), true); }
  }
  async function ping() {
    if (!room) return;
    var r = await db.rpc("voice_ping", { p_room: room.id, p_muted: muted });
    if (!r.error && r.data === false) leave("你已不在語音頻道中（被移出或頻道已關閉）。");
  }
  async function leave(why) {
    if (!room) return;
    var id = room.id; room = null;
    clearInterval(pingT);
    Object.keys(peers).forEach(drop);
    if (sig) { try { sig.untrack(); } catch (e) { /* 略過 */ } db.removeChannel(sig); sig = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    analysers = {}; speaking = {};
    applyMusic(null);
    await db.rpc("voice_leave", { p_room: id });
    if (why) toast(why);
    refresh();
  }
  V.leave = leave;
  /* 關閉分頁時立刻離開（沒送到也會在 45 秒後自動清掉） */
  window.addEventListener("pagehide", function () {
    if (!room || !token || !window.PSRP_CONFIG) return;
    try {
      fetch(window.PSRP_CONFIG.supabaseUrl + "/rest/v1/rpc/voice_leave", {
        method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json", apikey: window.PSRP_CONFIG.supabaseAnonKey, Authorization: "Bearer " + token },
        body: JSON.stringify({ p_room: room.id })
      });
    } catch (e) { /* 略過 */ }
  });

  function onCtl(p) {
    if (!p || !room) return;
    if (p.t === "kick" && p.uid === me.id) ping();
    else if (p.t === "closed") leave("語音頻道已被關閉。");
    else if (p.t === "music") refresh();
    else soon();
  }

  /* ---------- WebRTC：每個人跟每個人直接連線 ---------- */
  function syncPeers(state) {
    var live = {};
    Object.keys(state || {}).forEach(function (k) {
      if (k === myKey) return;
      var s = (state[k] || [])[0]; if (!s) return;
      live[k] = s;
      if (!peers[k]) { mkPeer(k, s); if (myKey < k) offer(k); }
    });
    Object.keys(peers).forEach(function (k) { if (!live[k]) drop(k); });
    soon(); renderBar();
  }
  function mkPeer(k, s) {
    var pc = new RTCPeerConnection({ iceServers: ICE });
    var pr = peers[k] = { pc: pc, uid: s.uid, name: s.name, audio: null, q: [] };
    if (stream) stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });
    else pc.addTransceiver("audio", { direction: "recvonly" });
    pc.onicecandidate = function (e) { if (e.candidate) send(k, { cand: e.candidate.toJSON() }); };
    pc.ontrack = function (e) {
      if (!pr.audio) { pr.audio = new Audio(); pr.audio.autoplay = true; pr.audio.setAttribute("playsinline", ""); }
      pr.audio.srcObject = e.streams[0] || new MediaStream([e.track]);
      pr.audio.play().catch(function () { toast("點一下頁面任何地方以播放語音。"); document.addEventListener("click", function once() { pr.audio && pr.audio.play(); document.removeEventListener("click", once); }); });
      applyVol(); meter(pr.uid, pr.audio.srcObject);
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "connected") boost(pc);
      if (pc.connectionState === "failed") {
        if (myKey < k) { try { pc.restartIce(); offer(k, true); } catch (e) { /* 略過 */ } }
        toast("跟 " + (pr.name || "對方") + " 的語音連線不穩，正在重試…", true);
      }
      renderBar();
    };
    return pr;
  }
  async function offer(k, restart) {
    var pr = peers[k]; if (!pr) return;
    var o = await pr.pc.createOffer(restart ? { iceRestart: true } : undefined);
    await pr.pc.setLocalDescription({ type: o.type, sdp: tuneSdp(o.sdp) });
    send(k, { sdp: { type: pr.pc.localDescription.type, sdp: pr.pc.localDescription.sdp } });
  }
  function send(k, data) { if (sig) sig.send({ type: "broadcast", event: "sig", payload: Object.assign({ to: k, from: myKey }, data) }); }
  async function onSignal(p) {
    if (!p || p.to !== myKey || !room) return;
    var pr = peers[p.from];
    if (!pr) { var st = sig.presenceState()[p.from]; pr = mkPeer(p.from, (st && st[0]) || { uid: String(p.from).split(":")[0], name: "" }); }
    try {
      if (p.sdp) {
        await pr.pc.setRemoteDescription({ type: p.sdp.type, sdp: tuneSdp(p.sdp.sdp) });
        while (pr.q.length) await pr.pc.addIceCandidate(pr.q.shift());
        if (p.sdp.type === "offer") {
          var a = await pr.pc.createAnswer(); await pr.pc.setLocalDescription({ type: a.type, sdp: tuneSdp(a.sdp) });
          send(p.from, { sdp: { type: a.type, sdp: pr.pc.localDescription.sdp } });
        }
      } else if (p.cand) {
        if (pr.pc.remoteDescription) await pr.pc.addIceCandidate(p.cand); else pr.q.push(p.cand);
      }
    } catch (e) { /* 忽略單一失敗的訊號 */ }
  }
  function drop(k) {
    var pr = peers[k]; if (!pr) return;
    try { pr.pc.close(); } catch (e) { /* 略過 */ }
    if (pr.audio) { pr.audio.srcObject = null; }
    delete analysers[pr.uid]; delete speaking[pr.uid];
    delete peers[k];
  }

  /* ---------- 說話指示燈 ---------- */
  function meter(uid, ms) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      var src = actx.createMediaStreamSource(ms), an = actx.createAnalyser(); an.fftSize = 512;
      src.connect(an); analysers[uid === "me" ? me.id : uid] = { an: an, buf: new Uint8Array(an.fftSize), hold: 0 };
    } catch (e) { /* 不支援就不顯示 */ }
    if (!meterT) meterT = setInterval(tick, 120);
  }
  function tick() {
    var changed = false;
    Object.keys(analysers).forEach(function (uid) {
      var a = analysers[uid]; a.an.getByteTimeDomainData(a.buf);
      var sum = 0; for (var i = 0; i < a.buf.length; i++) { var v = (a.buf[i] - 128) / 128; sum += v * v; }
      var loud = Math.sqrt(sum / a.buf.length) > 0.03 && !(uid === me.id && muted);
      if (loud) a.hold = 3; else if (a.hold > 0) a.hold--;
      var on = a.hold > 0;
      if (!!speaking[uid] !== on) { speaking[uid] = on; changed = true; }
    });
    if (changed) document.querySelectorAll(".vmem li[data-uid]").forEach(function (li) { li.classList.toggle("spk", !!speaking[li.getAttribute("data-uid")]); });
  }


  /* ---------- YouTube 音樂（每個人在自己的瀏覽器同步播放，不經過麥克風，音質最好） ---------- */
  function parseYT(u) {
    u = String(u || "").trim();
    var m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/))([A-Za-z0-9_-]{11})/) || u.match(/^([A-Za-z0-9_-]{11})$/);
    return m ? m[1] : null;
  }
  function loadYT() {
    if (window.YT && window.YT.Player) { mkPlayer(); return; }
    if (document.getElementById("yt-api")) return;
    window.onYouTubeIframeAPIReady = mkPlayer;
    var sc = document.createElement("script"); sc.id = "yt-api"; sc.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(sc);
  }
  function mkPlayer() {
    if (yt || !$("vm-player")) return;
    yt = new YT.Player("vm-player", {
      width: "100%", height: "200",
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1 },
      events: {
        onReady: function () { ytReady = true; setMusicVol(); if (ytWant) applyMusic(ytWant); },
        onStateChange: function (e) { if (e.data === 0 && ytWant && ytWant.cur) musicOp("ended", ytWant.cur.id); },
        onError: function () { if (ytWant && ytWant.cur) { toast("「" + ytWant.cur.title + "」不能在網站上播放，已自動跳過。", true); musicOp("ended", ytWant.cur.id); } }
      }
    });
  }
  function setMusicVol() { if (yt && ytReady) { yt.setVolume(deafened ? 0 : musicVol); if (deafened || musicVol === 0) yt.mute(); else yt.unMute(); } }
  function nowServer() { return Date.now() + skew; }
  function wantPos(cur) { return cur.paused != null ? cur.paused / 1000 : (nowServer() - cur.start) / 1000; }
  function applyMusic(m) {
    ytWant = m && room ? m : null;
    renderMusic();
    var cur = ytWant && ytWant.cur;
    clearTimeout(startT);
    if (!cur) { if (yt && ytReady) yt.stopVideo(); clearInterval(driftT); driftT = null; return; }
    if (!yt) { loadYT(); return; }
    if (!ytReady) return;
    var pos = wantPos(cur), data = yt.getVideoData ? yt.getVideoData() : {}, same = data && data.video_id === cur.id;
    if (!same) {
      if (pos < 0) { yt.cueVideoById({ videoId: cur.id, startSeconds: 0 }); startT = setTimeout(function () { applyMusic(ytWant); }, -pos * 1000); }
      else if (cur.paused != null) yt.cueVideoById({ videoId: cur.id, startSeconds: pos });
      else yt.loadVideoById({ videoId: cur.id, startSeconds: pos });
    } else if (cur.paused != null) {
      yt.pauseVideo();
    } else if (pos >= 0) {
      if (Math.abs((yt.getCurrentTime() || 0) - pos) > 2.5) yt.seekTo(pos, true);
      if (yt.getPlayerState() !== 1) yt.playVideo();
    } else {
      startT = setTimeout(function () { applyMusic(ytWant); }, -pos * 1000);
    }
    setMusicVol();
    if (!driftT) driftT = setInterval(function () { if (ytWant && ytWant.cur && ytWant.cur.paused == null) applyMusic(ytWant); }, 5000);
  }
  async function musicOp(op, vid, title) {
    if (!room) return false;
    var r = await db.rpc("voice_music", { p_room: room.id, p_op: op, p_vid: vid == null ? null : String(vid), p_title: title || null });
    if (r.error) { toast(err(r.error), true); return false; }
    room.music = r.data; applyMusic(r.data);
    if (sig) sig.send({ type: "broadcast", event: "ctl", payload: { t: "music" } });
    return true;
  }
  async function addSong() {
    var inp = $("vm-url"), id = parseYT(inp.value);
    if (!id) { toast("請貼上 YouTube 影片連結，例如 https://youtu.be/xxxxxxxxxxx", true); return; }
    var btn = $("vm-add"); btn.disabled = true;
    var title = "";
    try { var o = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id)); if (o.ok) title = (await o.json()).title || ""; } catch (e) { /* 拿不到標題就用預設 */ }
    if (await musicOp("add", id, title)) inp.value = "";
    btn.disabled = false;
  }
  function fmtT(sec) { sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
  function renderMusic() {
    var box = $("vmusic"); if (!box) return;
    var m = ytWant, cur = m && m.cur;
    var mb = $("vbar-music"); if (mb) mb.setAttribute("aria-pressed", String(musicOpen));
    box.hidden = !room || (!musicOpen && !cur);
    box.classList.toggle("playing", !!cur);
    $("vm-player-wrap").hidden = !cur;
    $("vm-now").textContent = cur ? cur.title : "目前沒有播放音樂";
    $("vm-by").textContent = cur ? "由 " + cur.by + " 點播" : "貼上 YouTube 連結就能點歌，頻道裡的人會一起聽到。";
    $("vm-pp").textContent = cur && cur.paused != null ? "▶" : "⏸"; $("vm-pp").title = cur && cur.paused != null ? "繼續播放" : "暫停";
    ["vm-pp", "vm-skip", "vm-stop"].forEach(function (i) { $(i).disabled = !cur; });
    var q = $("vm-queue"); q.innerHTML = "";
    var list = (m && m.queue) || [];
    $("vm-qh").textContent = "接下來（" + list.length + "）";
    list.forEach(function (it, i) {
      var li = el("li"); li.appendChild(el("span", { class: "vq-t", title: it.title }, (i + 1) + ". " + it.title));
      li.appendChild(el("span", { class: "vq-b" }, it.by));
      var x = el("button", { type: "button", title: "從清單移除", "aria-label": "移除 " + it.title }, "×");
      x.addEventListener("click", function () { musicOp("remove", i); });
      li.appendChild(x); q.appendChild(li);
    });
  }
  setInterval(function () {
    var t = $("vm-time"); if (!t) return;
    var cur = ytWant && ytWant.cur;
    t.textContent = cur && yt && ytReady && yt.getDuration ? fmtT(yt.getCurrentTime ? yt.getCurrentTime() : 0) + " / " + fmtT(yt.getDuration() || 0) : "";
  }, 1000);

  /* ---------- 初始化 ---------- */
  V.init = function (o) {
    db = o.db; me = o.me; staff = o.staff; el = o.el; myName = o.name || "玩家";
    $("vadd").addEventListener("click", create);
    $("vbar-leave").addEventListener("click", function () { leave(); });
    $("vbar-mute").addEventListener("click", function () {
      if (!stream) { toast("沒有麥克風權限。請在瀏覽器網址列允許麥克風後重新加入。", true); return; }
      muted = !muted; stream.getAudioTracks().forEach(function (t) { t.enabled = !muted; });
      renderBar(); render(); ping();
    });
    $("vbar-deaf").addEventListener("click", function () { deafened = !deafened; applyVol(); setMusicVol(); renderBar(); });
    $("vbar-hq").addEventListener("click", function () { setHQ(!hq); });
    $("vbar-music").addEventListener("click", function () { musicOpen = !musicOpen; renderMusic(); if (musicOpen) { loadYT(); $("vm-url").focus(); } });
    $("vm-add").addEventListener("click", addSong);
    $("vm-url").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addSong(); } });
    $("vm-pp").addEventListener("click", function () { var c = ytWant && ytWant.cur; if (c) musicOp(c.paused != null ? "resume" : "pause"); });
    $("vm-skip").addEventListener("click", function () { musicOp("skip"); });
    $("vm-stop").addEventListener("click", function () { if (confirm("停止音樂並清空點歌清單？")) musicOp("stop"); });
    $("vm-close").addEventListener("click", function () { musicOpen = false; renderMusic(); });
    var vv = $("vm-vol"); vv.value = String(musicVol);
    vv.addEventListener("input", function () { musicVol = Number(vv.value); setMusicVol(); try { localStorage.setItem("psrp-music-vol", String(musicVol)); } catch (e) { /* 略過 */ } });

    var ind = $("vind"); if (ind) ind.addEventListener("click", function () { document.getElementById("app").classList.add("open"); });
    try {
      listCh = db.channel("psrp-voice-list")
        .on("postgres_changes", { event: "*", schema: "public", table: "voice_rooms" }, soon)
        .on("postgres_changes", { event: "*", schema: "public", table: "voice_members" }, soon)
        .subscribe();
    } catch (e) { /* 改用輪詢 */ }
    setInterval(function () { if (!document.hidden || room) refresh(); }, 15000);
    refresh();
  };
})();
