/* Dastorkon — гость (/t/КОД), кабинет ресторана (/cabinet), панель платформы (/admin) */
(function () {
"use strict";

/* ================= ОБЩЕЕ ================= */
const CFG = window.NFC_CONFIG || {};
const PLANS = CFG.PLANS || { start: { name: "Меню", price: 2000 }, cafe: { name: "Меню и заказы", price: 7000 }, net: { name: "Сеть", price: 15000 } };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = n => (Number(n) || 0).toLocaleString("ru-RU");
const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const time = ts => new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dmy = d => d ? String(d).slice(0, 10).split("-").reverse().join(".") : "—";
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
function emblem() {
  const horn = "M0-13V-22M0-22C-1-31-13-33-13-26c0 5 6 6 7 1M0-22C1-31 13-33 13-26c0 5-6 6-7 1";
  let g = ""; for (let i = 0; i < 8; i++) g += `<path d="${horn}" transform="rotate(${i * 45}) scale(${i % 2 ? .78 : 1})"/>`;
  return `<svg viewBox="-50 -50 100 100" width="100%" height="100%" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle r="47" stroke-width="3"/><circle r="41.5" stroke-width="4.5" stroke-dasharray="2.3 2.05" stroke-linecap="butt"/><circle r="36.5" stroke-width="1.6"/><g stroke-width="3.2">${g}</g><circle r="9" stroke-width="2.6"/><circle r="3" fill="currentColor" stroke="none"/></svg>`;
}
const BACK = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>`;
function toast(m) { $("toast").innerHTML = `<div class="toast">${esc(m)}</div>`; clearTimeout(toast.t); toast.t = setTimeout(() => $("toast").innerHTML = "", 3000); }
function errMsg(e) {
  const m = String((e && (e.message || e.error_description)) || e || "");
  if (/failed to fetch|networkerror|load failed|network/i.test(m)) return "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.";
  if (/forbidden|permission denied|row-level security/i.test(m)) return "Нет прав на это действие.";
  if (/duplicate key.*restaurant_id, number|tables_restaurant_id_number_key/i.test(m)) return "Стол с таким номером уже есть.";
  if (/tag_not_yours/.test(m)) return "Эта метка выдана другому ресторану.";
  if (/paid_order/.test(m)) return "Оплаченный заказ нельзя отменить.";
  if (/cannot_remove_self/.test(m)) return "Себя удалить нельзя.";
  return m || "Что-то пошло не так.";
}
async function rpc(fn, args) { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; }
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }

const app = $("app");
let cur = null; // активный модуль: { acts, onInput, onChange, sheetActs }
function mount(html, anim) { app.innerHTML = html; if (anim !== false && app.firstElementChild) app.firstElementChild.classList.add("enter"); }
function quiet() { const r = app.firstElementChild; r && r.classList.remove("enter"); }

/* лист снизу / модальное окно */
function openSheet(html, wide) { const s = $("sheet"); $("sheetBox").innerHTML = html; s.classList.toggle("wide", !!wide); s.classList.remove("closing"); s.hidden = false; }
function closeSheet() { const s = $("sheet"); if (s.hidden) return; s.classList.add("closing"); setTimeout(() => { s.hidden = true; s.classList.remove("closing"); $("sheetBox").innerHTML = ""; }, 220); }
$("sheet").addEventListener("click", e => {
  if (e.target.id === "sheet") return closeSheet();
  const b = e.target.closest("[data-a]"); if (!b || !cur) return;
  if (b.dataset.a === "x") return closeSheet();
  const f = cur.acts && cur.acts[b.dataset.a]; if (f) f(b.dataset.v, b, e);
});
$("sheet").addEventListener("change", e => cur && cur.onSheetChange && cur.onSheetChange(e));
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
app.addEventListener("click", e => {
  const b = e.target.closest("[data-a]"); if (!b || !cur) return;
  if (b.tagName === "A" && !b.getAttribute("href")) e.preventDefault();
  const f = cur.acts && cur.acts[b.dataset.a]; if (f) f(b.dataset.v, b, e);
});
app.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[role=button][data-a]")) { e.preventDefault(); e.target.click(); } });
app.addEventListener("input", e => cur && cur.onInput && cur.onInput(e));
app.addEventListener("change", e => cur && cur.onChange && cur.onChange(e));
app.addEventListener("submit", e => { e.preventDefault(); const f = e.target.dataset.submit; if (cur && cur.acts && cur.acts[f]) cur.acts[f](null, e.target, e); });

/* фото: сжатие перед загрузкой */
function pickImage() { return new Promise(res => { const f = $("file"); f.onchange = () => { const x = f.files[0]; f.value = ""; res(x || null); }; f.click(); }); }
function compress(file, max) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Не удалось открыть картинку. Попробуйте JPG или PNG.")); };
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); c.toBlob(b => b ? res(b) : rej(new Error("Не удалось сжать фото")), "image/jpeg", .8);
    };
    img.src = url;
  });
}
async function uploadPhoto(rid, prefix, max) {
  const file = await pickImage(); if (!file) return null;
  toast("Загружаем фото…");
  const blob = await compress(file, max || 900);
  const path = `${rid}/${prefix}-${Date.now().toString(36)}.jpg`;
  const { error } = await sb.storage.from("menu").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (error) throw error;
  return sb.storage.from("menu").getPublicUrl(path).data.publicUrl;
}

/* ================= ЗАПУСК ================= */
const configured = /^https:\/\/[^/]+/.test(CFG.SUPABASE_URL || "") && !/YOUR/i.test((CFG.SUPABASE_URL || "") + (CFG.SUPABASE_ANON_KEY || "")) && window.supabase;
const sb = configured ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
$("boot") && ($("boot").innerHTML = emblem());

const POLICY_VERSION = "2026-11-25";
let RECOVERY = /type=recovery/.test(location.hash);
let timers = [];
function clearTimers() { timers.forEach(clearInterval); timers = []; }
let channel = null;
function dropChannel() { if (channel && sb) { sb.removeChannel(channel); channel = null; } }

function route() {
  clearTimers(); dropChannel(); closeSheet(); cur = null;
  if (!configured) return notConfigured();
  const path = location.pathname.replace(/\/+$/, "");
  const qs = new URLSearchParams(location.search);
  const m = path.match(/\/t\/([A-Za-z0-9]{6,12})$/);
  const tag = m ? m[1] : qs.get("t");
  if (tag) return Guest(tag.toUpperCase());
  if (/\/privacy$/.test(path)) return Privacy();
  if (/\/cabinet$/.test(path) || qs.has("cabinet")) return withAuth("Кабинет ресторана", Cabinet);
  if (/\/admin$/.test(path) || qs.has("admin")) return withAuth("Панель Dastorkon", Admin);
  return Landing();
}
function notConfigured() {
  mount(`<div class="center"><div class="box"><span class="emb" style="width:72px;height:72px">${emblem()}</span><h1 style="font-size:24px">Сайт ещё не подключён к базе</h1>
  <p class="note" style="font-size:15px">Откройте файл <b>config.js</b> и вставьте Project URL и anon key из Supabase (Project Settings → API).</p></div></div>`);
}
function Landing() {
  cur = { acts: {} };
  document.title = "Dastorkon";
  mount(`<div class="land gut stag"><span class="emb" style="--i:0">${emblem()}</span><h1 style="--i:1">Dastorkon</h1>
  <p style="--i:2">Гость прикладывает телефон к табличке на столе, смотрит меню и заказывает. Ресторан сразу получает заказ с номером стола.</p>
  <div class="row" style="--i:3;justify-content:center"><a class="btn primary" href="/cabinet">Кабинет ресторана</a></div>
  ${CFG.SUPPORT ? `<p class="note" style="--i:4">Подключение и поддержка: ${esc(CFG.SUPPORT)}</p>` : ""}
  <p class="note" style="--i:5"><a href="/privacy">Политика конфиденциальности</a></p></div>`);
}

/* ================= ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ ================= */
function Privacy() {
  cur = { acts: {} };
  const L = window.DASTORKON_LEGAL || {};
  const contact = L.email ? esc(L.email) + (L.phone ? " или по телефону " + esc(L.phone) : "") : L.phone ? "по телефону " + esc(L.phone) : "";
  document.title = "Политика конфиденциальности · Dastorkon";
  mount(`<div class="topbar"><div class="in gut"><a class="brand" href="/"><span class="emb">${emblem()}</span>Dastorkon</a></div></div>
  <article class="ws gut" style="max-width:780px;gap:14px;line-height:1.6">
  <h1 style="font-size:32px;letter-spacing:-.02em">Политика конфиденциальности</h1>
  <p class="note">Редакция от ${POLICY_VERSION.split("-").reverse().join(".")}. Действует для сайта ${esc(location.host)} и сервиса Dastorkon.</p>
  <h2 style="font-size:20px;margin-top:10px">1. Кто обрабатывает данные</h2>
  <p>Сервис Dastorkon предоставляет ${L.operator ? esc(L.operator) : "индивидуальный предприниматель, зарегистрированный в Кыргызской Республике"}${L.inn ? ", ИНН " + esc(L.inn) : ""}${L.address ? ", адрес: " + esc(L.address) : ""}.
  По вопросам персональных данных: ${contact}.</p>
  <p>Dastorkon — сервис электронного меню и заказов со стола для кафе и ресторанов. Заказ, который гость оформляет через Dastorkon, адресован ресторану, в котором гость находится. Данные гостей мы обрабатываем по поручению этого ресторана и только для выполнения заказа.</p>
  <h2 style="font-size:20px;margin-top:10px">2. Какие данные мы обрабатываем</h2>
  <p><b>Гости ресторанов.</b> Для заказа не нужна регистрация. Мы не спрашиваем имя, телефон или email. Мы обрабатываем: блюда в заказе, номер стола, время заказа, комментарий к заказу (если вы его написали), статус оплаты официанту, а также случайный идентификатор устройства, который хранится в вашем браузере и позволяет показать статус ваших заказов. Хостинг-провайдеры автоматически записывают технические данные: IP-адрес, тип браузера, время запроса.</p>
  <p>Пожалуйста, не пишите в комментарии к заказу личные сведения, которые не нужны ресторану.</p>
  <p><b>Сотрудники ресторанов и администраторы.</b> Email, пароль (хранится только в виде необратимого хэша, мы его не видим), роль в ресторане, дата и версия согласия с этой политикой, действия в кабинете (изменения меню, статусы заказов).</p>
  <p><b>Рестораны.</b> Название, меню, цены, фото, столы и NFC-метки, тариф и срок подписки.</p>
  <h2 style="font-size:20px;margin-top:10px">3. Зачем и на каком основании</h2>
  <p>Данные гостей — чтобы передать заказ ресторану и показать гостю его статус. Основание: выполнение заказа, который гость оформляет в ресторане.</p>
  <p>Данные сотрудников — чтобы дать доступ к кабинету ресторана, защищать аккаунт и восстанавливать пароль. Основание: согласие, которое сотрудник даёт при регистрации, и договор между Dastorkon и рестораном.</p>
  <p>Мы не продаём данные, не показываем рекламу и не подключаем рекламные и аналитические счётчики.</p>
  <h2 style="font-size:20px;margin-top:10px">4. Кому передаются данные</h2>
  <p>Ресторану, в котором оформлен заказ: он видит состав заказа, стол, комментарий и время. Рестораны не видят данные друг друга.</p>
  <p>Подрядчикам, без которых сервис не работает:</p>
  <ul style="margin:0;padding-left:22px">
    <li>Supabase Inc. — база данных, вход в кабинет, хранение фото меню. Серверы находятся в Ирландии (Европейский союз).</li>
    <li>Netlify Inc. — размещение сайта и доставка его страниц через сеть серверов в разных странах.</li>
    <li>jsDelivr — загрузка программных библиотек сайта; Google Fonts — загрузка шрифтов. Эти сервисы получают IP-адрес и сведения о браузере при открытии сайта.</li>
  </ul>
  <h2 style="font-size:20px;margin-top:10px">5. Хранение за пределами Кыргызстана</h2>
  <p>Данные хранятся и обрабатываются на серверах за пределами Кыргызской Республики (Европейский союз и другие страны размещения подрядчиков). Для гостей это необходимо для выполнения заказа. Сотрудники дают на это отдельное согласие при регистрации.</p>
  <h2 style="font-size:20px;margin-top:10px">6. Сколько мы храним данные</h2>
  <ul style="margin:0;padding-left:22px">
    <li>Связь заказа с устройством гостя — 2 дня, затем удаляется автоматически.</li>
    <li>Комментарий к заказу — 30 дней, затем удаляется автоматически.</li>
    <li>Состав, сумма и время заказа без указания гостя — пока действует договор с рестораном и 1 год после его окончания, для учёта ресторана.</li>
    <li>Аккаунт сотрудника — пока у него есть доступ к ресторану или до удаления по запросу.</li>
    <li>Технические журналы — в сроки, установленные хостинг-провайдерами.</li>
  </ul>
  <h2 style="font-size:20px;margin-top:10px">7. Что хранится в вашем браузере</h2>
  <p>Мы не используем рекламные cookie. В памяти браузера хранятся корзина, выбранный язык, случайный идентификатор устройства для статуса заказов, а у сотрудников — данные входа в кабинет. Их можно удалить, очистив данные сайта в браузере.</p>
  <h2 style="font-size:20px;margin-top:10px">8. Как мы защищаем данные</h2>
  <p>Соединение с сайтом шифруется (HTTPS). Доступ разграничен: каждый ресторан видит только свои заказы и меню, сотрудник видит только рестораны, к которым его подключили. Пароли хранятся в виде хэша. Мы собираем минимум данных и автоматически удаляем то, что больше не нужно.</p>
  <h2 style="font-size:20px;margin-top:10px">9. Ваши права</h2>
  <p>Вы можете узнать, какие ваши данные мы обрабатываем, получить их копию, исправить, удалить, отозвать согласие или возразить против обработки. Обратитесь ${L.email ? "на " : ""}${contact}. На возражения отвечаем в течение 7 рабочих дней, данные по обоснованному запросу удаляем без задержки. Если заказ гостя нужно удалить, укажите ресторан, стол и примерное время заказа.</p>
  <p>Вы также вправе обратиться в уполномоченный государственный орган Кыргызской Республики по защите персональных данных.</p>
  <h2 style="font-size:20px;margin-top:10px">10. Изменения политики</h2>
  <p>Мы можем обновлять эту политику. Новая редакция публикуется на этой странице с датой. Если изменения касаются согласия сотрудников, мы попросим подтвердить его заново.</p>
  <p style="margin-top:12px"><a class="btn" href="/" data-a="back">Назад</a></p>
  </article>`);
  cur.acts.back = (v, b, e) => { e.preventDefault(); if (history.length > 1) history.back(); else location.href = "/"; };
}

/* ================= ВХОД ================= */
async function withAuth(title, Module) {
  mount(`<div class="center"><div class="box"><span class="spinner emb">${emblem()}</span></div></div>`, false);
  const { data: { session } } = await sb.auth.getSession();
  if (RECOVERY && session) return authView("Смена пароля", "newpw");
  if (!session) return authView(title);
  let ctx;
  try { ctx = await rpc("my_context"); } catch (e) { return fatal(errMsg(e), true); }
  Module(ctx);
}
function fatal(msg, retry) {
  cur = { acts: { retry: () => route(), out: async () => { await sb.auth.signOut(); route(); } } };
  mount(`<div class="center"><div class="box"><span class="emb" style="width:60px;height:60px">${emblem()}</span><p>${esc(msg)}</p>
  <div class="row" style="justify-content:center">${retry ? `<button type="button" class="btn primary" data-a="retry">Попробовать снова</button>` : ""}<button type="button" class="btn" data-a="out">Выйти</button></div></div></div>`);
}
function authView(title, preset) {
  let mode = preset || "in";
  const sub = { in: "Войдите, чтобы продолжить", up: "Создайте аккаунт. Потом администратор привяжет его к ресторану.", forgot: "Введите email, и мы пришлём ссылку для смены пароля.", newpw: "Придумайте новый пароль." };
  const btn = { in: "Войти", up: "Создать аккаунт", forgot: "Отправить ссылку", newpw: "Сохранить пароль" };
  const draw = (msg, err) => { const keep = { em: $("em") ? $("em").value : "", pw: $("pw") ? $("pw").value : "" }; mount(`<form class="auth gut stag" data-submit="go" novalidate>
    <div class="head" style="--i:0"><span class="emb">${emblem()}</span><h1>${esc(title)}</h1><p class="note">${sub[mode]}</p></div>
    ${msg ? `<div class="${err ? "err" : "card"}" style="--i:1">${esc(msg)}</div>` : ""}
    ${mode !== "newpw" ? `<div class="fld" style="--i:1"><label for="em">Email</label><input type="email" id="em" autocomplete="email" required></div>` : ""}
    ${mode !== "forgot" ? `<div class="fld" style="--i:2"><label for="pw">${mode === "newpw" ? "Новый пароль" : "Пароль"}</label><input type="password" id="pw" autocomplete="${mode === "in" ? "current-password" : "new-password"}" minlength="8" required></div>` : ""}
    ${mode === "up" ? `<label class="chk" style="--i:3;align-items:flex-start;border-radius:12px;padding:10px 12px;font-weight:500;line-height:1.4"><input type="checkbox" id="pd" style="margin-top:3px;flex:none"><span>Я принимаю <a href="/privacy" target="_blank" rel="noopener">Политику конфиденциальности</a> и даю согласие на обработку моих персональных данных, в том числе на их хранение на серверах за пределами Кыргызстана</span></label>` : ""}
    <button type="submit" class="btn primary block" style="--i:3" id="goBtn">${btn[mode]}</button>
    ${mode === "in" ? `<button type="button" class="btn block" style="--i:4" data-a="mode" data-v="forgot">Забыли пароль?</button>` : ""}
    ${mode !== "newpw" ? `<button type="button" class="btn block" style="--i:4" data-a="mode" data-v="${mode === "in" ? "up" : "in"}">${mode === "in" ? "У меня нет аккаунта" : "Вернуться ко входу"}</button>` : ""}
    <p class="note" style="--i:5;text-align:center"><a href="/privacy">Политика конфиденциальности</a></p>
  </form>`); if ($("em")) $("em").value = keep.em; if ($("pw")) $("pw").value = keep.pw; };
  cur = { acts: {
    mode: v => { mode = v; draw(); },
    go: async () => {
      const email = $("em") ? $("em").value.trim() : "", password = $("pw") ? $("pw").value : "";
      if (mode !== "newpw" && !/^\S+@\S+\.\S+$/.test(email)) return draw("Введите email полностью, например name@mail.kg", true);
      if (mode !== "forgot" && password.length < 8) return draw("Пароль должен быть не короче 8 символов", true);
      if (mode === "up" && !$("pd").checked) return draw("Чтобы создать аккаунт, отметьте согласие с Политикой конфиденциальности.", true);
      $("goBtn").disabled = true;
      try {
        if (mode === "in") {
          const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; route();
        } else if (mode === "up") {
          const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname, data: { pd_consent: true, pd_consent_at: new Date().toISOString(), policy_version: POLICY_VERSION } } }); if (error) throw error;
          if (data.session) route(); else { mode = "in"; draw("Мы отправили письмо на " + email + ". Откройте ссылку из письма, затем войдите."); }
        } else if (mode === "forgot") {
          const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) throw error;
          mode = "in"; draw("Если такой аккаунт есть, мы отправили на " + email + " ссылку для смены пароля.");
        } else {
          const { error } = await sb.auth.updateUser({ password }); if (error) throw error;
          RECOVERY = false; history.replaceState(null, "", location.pathname); toast("Пароль изменён"); route();
        }
      } catch (e) {
        const m = String(e.message || "");
        draw(/invalid login/i.test(m) ? "Неверный email или пароль." : /not confirmed/i.test(m) ? "Подтвердите email по ссылке из письма." : /already registered/i.test(m) ? "Такой email уже зарегистрирован. Войдите." : /should be different/i.test(m) ? "Новый пароль должен отличаться от старого." : /rate limit|too many|security purposes/i.test(m) ? "Слишком много попыток. Подождите минуту и попробуйте снова." : errMsg(e), true);
      }
    }
  } };
  draw();
}
function topbar(ctx, extra) {
  return `<div class="topbar"><div class="in gut"><a class="brand" href="/"><span class="emb">${emblem()}</span>Dastorkon</a>
  <div class="right">${extra || ""}<span class="who">${esc(ctx.email || "")}</span><button type="button" class="btn sm" data-a="logout">Выйти</button></div></div></div>`;
}
async function logout() { await sb.auth.signOut(); route(); }

/* ================= ГОСТЬ ================= */
const GT = {
ru:{open:"Открыть меню",table:"Стол",welcome:"Добро пожаловать",search:"Поиск блюда",all:"Все",cart:"Корзина",empty:"Корзина пуста",comment:"Комментарий к заказу",commentPh:"Например: без лука, принести всё вместе",total:"Итого",toPay:"Перейти к оплате",payT:"Оплата",waiter:"Официанту",waiterD:"Наличными, картой или по QR, когда принесут счёт",place:"Отправить заказ",placing:"Отправляем…",doneT:"Заказ принят",no:"Заказ №",method:"Оплата",status:"Статус заказа",track:"Отследить заказ",more:"Дозаказать",history:"Мои заказы",bill:"Общий счёт",paid:"Оплачен",unpaid:"Не оплачен",ing:"Состав",al:"Аллергены",por:"Порция",addons:"Добавки",off:"Нет в наличии",add:"Добавить",cur:"сом",
 accepted:"Принят",cooking:"Готовится",ready:"Готов",served:"Подан",cancelled:"Отменён",acceptedD:"Ресторан получил заказ",cookingD:"Кухня готовит ваши блюда",readyD:"Блюда готовы к подаче",servedD:"Приятного аппетита",cancelledD:"Заказ отменён рестораном",
 gone:"Этих блюд уже нет в наличии, мы убрали их из корзины:",nothing:"Ничего не найдено",tableOff:"Этот стол сейчас не принимает заказы. Позовите официанта.",net:"Нет связи. Проверьте интернет и нажмите ещё раз, заказ не задвоится.",notFound:"Эта табличка пока не привязана к столу. Позовите официанта.",restOff:"Меню временно недоступно. Позовите официанта.",retry:"Попробовать снова",loading:"Загружаем меню…",fail:"Не удалось отправить заказ. Позовите официанта.",privacy:"Политика конфиденциальности",payNote:"Заказ передаётся ресторану. Мы не просим ваше имя и телефон.",tooFast:"Слишком много заказов подряд. Подождите минуту или позовите официанта."},
ky:{open:"Менюну ачуу",table:"Үстөл",welcome:"Кош келиңиздер",search:"Тамак издөө",all:"Баары",cart:"Себет",empty:"Себет бош",comment:"Буйрутмага комментарий",commentPh:"Мисалы: пиязсыз",total:"Жыйынтыгы",toPay:"Төлөөгө өтүү",payT:"Төлөө",waiter:"Официантка",waiterD:"Эсеп келгенде накталай, карта же QR менен",place:"Буйрутма жөнөтүү",placing:"Жөнөтүлүүдө…",doneT:"Буйрутма кабыл алынды",no:"Буйрутма №",method:"Төлөө",status:"Буйрутманын абалы",track:"Буйрутманы көзөмөлдөө",more:"Дагы буйрутма берүү",history:"Менин буйрутмаларым",bill:"Жалпы эсеп",paid:"Төлөндү",unpaid:"Төлөнө элек",ing:"Курамы",al:"Аллергендер",por:"Порция",addons:"Кошумчалар",off:"Азыр жок",add:"Кошуу",cur:"сом",
 accepted:"Кабыл алынды",cooking:"Даярдалууда",ready:"Даяр",served:"Берилди",cancelled:"Жокко чыгарылды",acceptedD:"Ресторан буйрутманы алды",cookingD:"Ашкана тамакты даярдап жатат",readyD:"Тамак даяр",servedD:"Тамагыңыз таттуу болсун",cancelledD:"Ресторан буйрутманы жокко чыгарды",
 gone:"Бул тамактар азыр жок, себеттен алынды:",nothing:"Эч нерсе табылган жок",tableOff:"Бул үстөл азыр буйрутма кабыл албайт. Официантты чакырыңыз.",net:"Байланыш жок. Интернетти текшерип, кайра басыңыз, буйрутма кайталанбайт.",notFound:"Бул белги азырынча үстөлгө байланган эмес. Официантты чакырыңыз.",restOff:"Меню убактылуу жеткиликсиз. Официантты чакырыңыз.",retry:"Кайра аракет кылуу",loading:"Меню жүктөлүүдө…",fail:"Буйрутма жөнөтүлгөн жок. Официантты чакырыңыз.",privacy:"Купуялуулук саясаты",payNote:"Буйрутма ресторанга жөнөтүлөт. Биз атыңызды жана телефонуңузду сурабайбыз.",tooFast:"Буйрутмалар өтө көп. Бир мүнөт күтүңүз же официантты чакырыңыз."},
en:{open:"Open menu",table:"Table",welcome:"Welcome",search:"Search dishes",all:"All",cart:"Cart",empty:"Your cart is empty",comment:"Order comment",commentPh:"E.g. no onion, bring everything together",total:"Total",toPay:"Go to payment",payT:"Payment",waiter:"Pay the waiter",waiterD:"Cash, card or QR when the bill arrives",place:"Send order",placing:"Sending…",doneT:"Order accepted",no:"Order #",method:"Payment",status:"Order status",track:"Track order",more:"Order more",history:"My orders",bill:"Total bill",paid:"Paid",unpaid:"Unpaid",ing:"Ingredients",al:"Allergens",por:"Portion",addons:"Add-ons",off:"Sold out",add:"Add",cur:"KGS",
 accepted:"Accepted",cooking:"Cooking",ready:"Ready",served:"Served",cancelled:"Cancelled",acceptedD:"The restaurant has your order",cookingD:"The kitchen is preparing your dishes",readyD:"Your dishes are ready to serve",servedD:"Enjoy your meal",cancelledD:"The restaurant cancelled this order",
 gone:"These dishes are sold out and were removed from your cart:",nothing:"Nothing found",tableOff:"This table is not taking orders right now. Please call a waiter.",net:"No connection. Check the internet and tap again, the order will not be duplicated.",notFound:"This tag is not linked to a table yet. Please call a waiter.",restOff:"The menu is temporarily unavailable. Please call a waiter.",retry:"Try again",loading:"Loading menu…",fail:"The order was not sent. Please call a waiter.",privacy:"Privacy policy",payNote:"Your order goes to the restaurant. We don\u2019t ask for your name or phone.",tooFast:"Too many orders in a row. Wait a minute or call a waiter."}
};
const AL = { gluten: { ru: "Глютен", ky: "Глютен", en: "Gluten" }, milk: { ru: "Молоко", ky: "Сүт", en: "Milk" }, egg: { ru: "Яйца", ky: "Жумуртка", en: "Egg" }, nuts: { ru: "Орехи", ky: "Жаңгак", en: "Nuts" }, fish: { ru: "Рыба", ky: "Балык", en: "Fish" }, soy: { ru: "Соя", ky: "Соя", en: "Soy" }, sesame: { ru: "Кунжут", ky: "Кунжут", en: "Sesame" } };
const ST = ["accepted", "cooking", "ready", "served"];

function Guest(tag) {
  const KEY = "nfc-g-" + tag;
  let tok = store.get("nfc-guest-token"); if (!tok) { tok = uid(); store.set("nfc-guest-token", tok); }
  const navLang = (navigator.language || "ru").slice(0, 2);
  const G = Object.assign({ lang: navLang === "en" ? "en" : navLang === "ky" ? "ky" : "ru", screen: "welcome", cart: [], note: "", orders: [], cur: null }, store.get(KEY) || {});
  const U = { cat: "all", q: "", busy: false, err: "", idem: store.get(KEY + "-idem"), sh: null };
  let M = null; const O = {};
  const t = k => (GT[G.lang] || GT.ru)[k] ?? GT.ru[k] ?? k;
  const tr = o => o && typeof o === "object" ? (o[G.lang] || o.ru || o.ky || o.en || "") : (o || "");
  const money = n => num(n) + " " + t("cur");
  const I = id => M.items.find(x => x.id === id);
  const save = () => store.set(KEY, { lang: G.lang, screen: G.screen, cart: G.cart, note: G.note, orders: G.orders.slice(-20), cur: G.cur });
  const resetIdem = () => { U.idem = null; store.set(KEY + "-idem", null); };
  const pic = (it, cls) => `<span class="pic ${cls || ""}" style="--h:${hue(it.id)}">${it.photo_url ? `<img src="${esc(it.photo_url)}" alt="" loading="lazy" decoding="async">` : esc((tr(it.name) || "?")[0])}</span>`;
  const unitOf = l => { const it = I(l.itemId); if (!it) return 0; return it.price + it.addons.filter(a => l.addons.includes(a.id)).reduce((s, a) => s + a.price, 0); };
  const cartTotal = () => G.cart.reduce((s, l) => s + unitOf(l) * l.qty, 0);
  const cartCount = () => G.cart.reduce((s, l) => s + l.qty, 0);
  const qtyOf = id => G.cart.filter(l => l.itemId === id).reduce((s, l) => s + l.qty, 0);
  const myOrders = () => G.orders.map(id => O[id]).filter(Boolean);
  const payPill = o => o.paid ? `<span class="pill ok">${t("paid")}</span>` : `<span class="pill warn">${t("unpaid")}</span>`;
  function addLine(itemId, addons, qty) {
    const key = itemId + "|" + [...addons].sort().join(",");
    const l = G.cart.find(x => x.key === key); if (l) l.qty = Math.min(50, l.qty + qty); else G.cart.push({ key, itemId, addons: [...addons], qty });
    resetIdem(); save();
  }
  const langs = cls => `<div class="langs ${cls || ""}" role="group" aria-label="Language">${["ru", "ky", "en"].map(l => `<button type="button" data-a="lang" data-v="${l}" aria-pressed="${G.lang === l}">${l === "ky" ? "KG" : l.toUpperCase()}</button>`).join("")}</div>`;
  const head = (title, back) => `<div class="g-head gut"><div class="g-top">${back ? `<button type="button" class="back" data-a="go" data-v="${back}" aria-label="Back">${BACK}</button>` : ""}<h2>${esc(title)}</h2><span class="pill red">${t("table")} ${M.table.number}</span></div></div>`;

  function sWelcome() {
    const r = M.restaurant;
    return `<div class="g"><div class="cover">${r.cover_url ? `<img class="ph" src="${esc(r.cover_url)}" alt="">` : `<span class="big-emb">${emblem()}</span>`}${langs()}</div>
    <div class="welcome-body gut stag">
      <div class="w-logo" style="--i:0">${r.logo_url ? `<img src="${esc(r.logo_url)}" alt="">` : emblem()}</div>
      <div style="--i:1"><p class="note">${t("welcome")}</p><h1 class="w-name">${esc(r.name)}</h1>${tr(r.tagline) ? `<p class="w-tag">${esc(tr(r.tagline))}</p>` : ""}</div>
      <div class="table-card" style="--i:2"><small>${t("table")}</small><b>${M.table.number}</b></div>
      <button type="button" class="btn primary block" style="--i:3" data-a="go" data-v="menu">${t("open")}</button>
      ${myOrders().length ? `<button type="button" class="btn block" style="--i:4" data-a="go" data-v="history">${t("history")}</button>` : ""}
      <a class="note" style="--i:5" href="/privacy">${t("privacy")}</a>
    </div></div>`;
  }
  function dishList() {
    const qq = U.q.trim().toLowerCase(); let h = "", i = 0;
    const cats = M.categories.concat([{ id: null, name: { ru: "Другое", ky: "Башка", en: "Other" } }]);
    cats.forEach(c => {
      if (U.cat !== "all" && U.cat !== c.id) return;
      const its = M.items.filter(x => (x.category_id || null) === c.id && (c.id !== null || !M.categories.some(k => k.id === x.category_id)) && (!qq || (tr(x.name) + " " + (x.name.ru || "")).toLowerCase().includes(qq)));
      if (!its.length) return;
      h += `<h3 class="sec" style="--i:${Math.min(i, 8)}">${esc(tr(c.name))}</h3>`;
      its.forEach(x => {
        i++; const n = qtyOf(x.id);
        h += `<div class="dish ${x.available ? "" : "off"}" style="--i:${Math.min(i, 8)}" role="button" tabindex="0" data-a="sheet" data-v="${x.id}">${pic(x)}
        <div><h4>${esc(tr(x.name))}</h4>${tr(x.descr) ? `<p>${esc(tr(x.descr))}</p>` : ""}<div class="row"><span class="price">${money(x.price)}</span>
        ${x.available ? `<button type="button" class="plus" data-a="quick" data-v="${x.id}" aria-label="${t("add")}">+${n ? `<span class="q">${n}</span>` : ""}</button>` : `<span class="pill">${t("off")}</span>`}</div></div></div>`;
      });
    });
    return h || `<p class="empty">${t("nothing")}</p>`;
  }
  const cartBar = bump => { const n = cartCount(); return n ? `<button type="button" class="btn primary block ${bump ? "bump" : ""}" data-a="go" data-v="cart"><span>${t("cart")} <span class="cnt">${n}</span></span><span>${money(cartTotal())}</span></button>` : ""; };
  function sMenu() {
    return `<div class="g"><div class="g-head gut">
      <div class="g-top"><span class="emb" style="width:30px;height:30px">${emblem()}</span><h2>${esc(M.restaurant.name)}</h2><span class="pill red">${t("table")} ${M.table.number}</span>${langs("plain")}</div>
      <input type="search" id="q" placeholder="${t("search")}" value="${esc(U.q)}" aria-label="${t("search")}">
      <div class="cats"><button type="button" data-a="cat" data-v="all" aria-pressed="${U.cat === "all"}">${t("all")}</button>${M.categories.filter(c => M.items.some(x => x.category_id === c.id)).map(c => `<button type="button" data-a="cat" data-v="${c.id}" aria-pressed="${U.cat === c.id}">${esc(tr(c.name))}</button>`).join("")}</div>
    </div>
    <div class="list gut stag" id="dishList">${dishList()}</div>
    <div class="cartbar gut" id="cartBar">${cartBar()}</div>
    ${myOrders().length ? `<div class="gut" style="padding-bottom:16px"><button type="button" class="btn block" data-a="go" data-v="history">${t("history")}</button></div>` : ""}</div>`;
  }
  function sCart() {
    G.cart = G.cart.filter(l => I(l.itemId));
    return `<div class="g">${head(t("cart"), "menu")}<div class="gut stag" style="display:grid;gap:14px;padding-block:14px;flex:1;align-content:start">
    ${U.err ? `<div class="err">${esc(U.err)}</div>` : ""}
    ${G.cart.length ? `<div class="card" style="--i:0;padding-block:2px">${G.cart.map(l => {
      const it = I(l.itemId); const adds = it.addons.filter(a => l.addons.includes(a.id));
      return `<div class="line"><div><b>${esc(tr(it.name))}</b>${adds.length ? `<small>+ ${adds.map(a => esc(tr(a.name))).join(", ")}</small>` : ""}<small>${money(unitOf(l))}</small></div>
      <div style="display:grid;gap:6px;justify-items:end"><span class="price">${money(unitOf(l) * l.qty)}</span><span class="stepper"><button type="button" data-a="lq" data-v="${esc(l.key)}" data-d="-1" aria-label="−">−</button><span>${l.qty}</span><button type="button" data-a="lq" data-v="${esc(l.key)}" data-d="1" aria-label="+">+</button></span></div></div>`;
    }).join("")}</div>
    <div class="fld" style="--i:1"><label for="note">${t("comment")}</label><textarea id="note" rows="2" maxlength="300" placeholder="${t("commentPh")}">${esc(G.note)}</textarea></div>
    <div class="sum" style="--i:2"><span>${t("total")}</span><b>${money(cartTotal())}</b></div>
    <button type="button" class="btn primary block" style="--i:3" data-a="go" data-v="pay">${t("toPay")}</button>`
    : `<p class="empty" style="padding:60px 0">${t("empty")}</p><button type="button" class="btn block" data-a="go" data-v="menu">${t("open")}</button>`}
    </div></div>`;
  }
  function sPay() {
    return `<div class="g">${head(t("payT"), "cart")}<div class="gut stag" style="display:grid;gap:12px;padding-block:14px;flex:1;align-content:start">
    ${U.err ? `<div class="err">${esc(U.err)}</div>` : ""}
    <div style="--i:0"><div class="opt" aria-pressed="true"><span class="dot"></span><span><b>${t("waiter")}</b><small>${t("waiterD")}</small></span></div></div>
    <div class="sum" style="--i:1"><span>${t("total")}</span><b>${money(cartTotal())}</b></div>
    <button type="button" class="btn primary block" style="--i:2" id="placeBtn" data-a="place" ${U.busy ? "disabled" : ""}>${U.busy ? t("placing") : t("place")}</button>
    <p class="note" style="--i:3;text-align:center">${t("payNote")} <a href="/privacy">${t("privacy")}</a></p></div></div>`;
  }
  function sDone() {
    const o = O[G.cur]; if (!o) return sMenu();
    return `<div class="g">${head(t("doneT"))}<div class="gut"><div class="done stag">
    <svg class="check" viewBox="0 0 84 84" style="--i:0"><circle cx="42" cy="42" r="42"/><path d="M26 43l11 11 21-23"/></svg>
    <h2 style="--i:1;font-family:var(--f-serif);font-size:28px">${t("doneT")}</h2>
    <dl class="kv card" style="--i:2"><dt>${t("no").replace(/[№#]\s*$/, "").trim()}</dt><dd>№ ${o.no}</dd><dt>${t("table")}</dt><dd>${o.table_number}</dd><dt>${t("total")}</dt><dd>${money(o.total)}</dd><dt>${t("method")}</dt><dd>${t("waiter")} · ${o.paid ? t("paid") : t("unpaid")}</dd></dl>
    <button type="button" class="btn primary block" style="--i:3" data-a="track" data-v="${o.id}">${t("track")}</button>
    <button type="button" class="btn block" style="--i:4" data-a="go" data-v="menu">${t("more")}</button></div></div></div>`;
  }
  function trackBody() {
    const o = O[G.cur]; if (!o) return "";
    const c = ST.indexOf(o.status), done = o.status === "served";
    const steps = o.status === "cancelled" ? `<div class="err">${t("cancelledD")}</div>` :
      `<div class="steps">${ST.map((s, i) => `<div class="stp ${i < c || done ? "past" : i === c ? "now" : ""}"><i>${i < c || done ? "✓" : i + 1}</i><div><b>${t(s)}</b><small>${t(s + "D")}</small></div></div>`).join("")}</div>`;
    return `<div class="card" style="--i:0;display:flex;justify-content:space-between;align-items:center;gap:10px"><div><b style="font-size:20px">${t("no")}${o.no}</b><div class="note">${time(o.created_at)} · ${t("table")} ${o.table_number}</div></div>${payPill(o)}</div>
    <div class="card" style="--i:1">${steps}</div>
    <div class="card" style="--i:2;padding-block:2px">${o.lines.map(l => `<div class="line"><div><b>${esc(tr(l.name))}</b>${l.addons.length ? `<small>+ ${l.addons.map(a => esc(tr(a))).join(", ")}</small>` : ""}</div><span>${l.qty} × ${money(l.unit_price)}</span></div>`).join("")}</div>
    <div class="sum" style="--i:3"><span>${t("total")}</span><b>${money(o.total)}</b></div>`;
  }
  const sTrack = () => `<div class="g">${head(t("status"), "history")}<div class="gut stag" id="trackBody" style="display:grid;gap:12px;padding-block:14px;flex:1;align-content:start">${trackBody()}</div>
    <div class="gut" style="padding-bottom:18px"><button type="button" class="btn primary block" data-a="go" data-v="menu">${t("more")}</button></div></div>`;
  function histBody() {
    const os = myOrders().slice().reverse();
    if (!os.length) return `<p class="empty" style="padding:50px 0">${t("empty")}</p>`;
    const live = os.filter(o => o.status !== "cancelled");
    const bill = live.reduce((s, o) => s + o.total, 0), due = live.filter(o => !o.paid).reduce((s, o) => s + o.total, 0);
    return os.map((o, i) => `<button type="button" class="card" style="--i:${Math.min(i, 6)};text-align:left;display:grid;gap:6px;width:100%" data-a="track" data-v="${o.id}">
      <span style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${t("no")}${o.no} · ${time(o.created_at)}</b><span class="pill ${o.status === "served" ? "ok" : "red"}">${t(o.status)}</span></span>
      <span class="note">${o.lines.map(l => esc(tr(l.name)) + " × " + l.qty).join(", ")}</span>
      <span style="display:flex;justify-content:space-between;align-items:center"><span class="price">${money(o.total)}</span>${payPill(o)}</span></button>`).join("")
    + `<div class="card" style="display:grid;gap:4px"><div class="sum"><span>${t("bill")}</span><b>${money(bill)}</b></div>${due ? `<div class="note" style="display:flex;justify-content:space-between"><span>${t("unpaid")}</span><b>${money(due)}</b></div>` : ""}</div>`;
  }
  const sHistory = () => `<div class="g">${head(t("history"), "menu")}<div class="gut stag" id="histBody" style="display:grid;gap:12px;padding-block:14px;flex:1;align-content:start">${histBody()}</div>
    <div class="gut" style="padding-bottom:18px"><button type="button" class="btn primary block" data-a="go" data-v="menu">${t("more")}</button></div></div>`;
  const S = { welcome: sWelcome, menu: sMenu, cart: sCart, pay: sPay, done: sDone, track: sTrack, history: sHistory };

  function render(anim) { document.documentElement.lang = G.lang === "ky" ? "ky" : G.lang; mount((S[G.screen] || sWelcome)(), anim); if (anim) window.scrollTo(0, 0); }
  function go(s) { U.err = ""; G.screen = s; save(); render(true); }
  function partial(bump) { quiet(); const dl = $("dishList"); if (dl) { dl.innerHTML = dishList(); $("cartBar").innerHTML = cartBar(bump); } else render(false); }

  function sheetHTML() {
    const it = I(U.sh.id); const unit = it.price + it.addons.filter(a => U.sh.add.has(a.id)).reduce((s, a) => s + a.price, 0);
    return `<div style="position:relative"><button type="button" class="x" data-a="x" aria-label="Close">✕</button>${pic(it, "hero")}</div>
    <div class="sheet-body gut"><div><h3>${esc(tr(it.name))}</h3>${tr(it.descr) ? `<p class="note" style="font-size:15px">${esc(tr(it.descr))}</p>` : ""}</div>
    <div class="meta">${tr(it.ingredients) ? `<div><b>${t("ing")}</b>${esc(tr(it.ingredients))}</div>` : ""}
    ${it.allergens && it.allergens.length ? `<div><b>${t("al")}</b><span class="row" style="margin-top:4px">${it.allergens.map(a => `<span class="pill warn">${esc(tr(AL[a]) || a)}</span>`).join("")}</span></div>` : ""}
    ${it.portion ? `<div><b>${t("por")}</b>${esc(it.portion)}</div>` : ""}</div>
    ${it.addons.length ? `<div style="display:grid;gap:8px"><b style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">${t("addons")}</b>${it.addons.map(a => `<label class="addon"><input type="checkbox" id="ad-${a.id}" data-add="${a.id}" ${U.sh.add.has(a.id) ? "checked" : ""}><span>${esc(tr(a.name))}</span><b>+${money(a.price)}</b></label>`).join("")}</div>` : ""}
    </div>
    <div class="sheet-foot gut">${it.available ? `<span class="stepper"><button type="button" data-a="sq" data-d="-1" aria-label="−">−</button><span>${U.sh.qty}</span><button type="button" data-a="sq" data-d="1" aria-label="+">+</button></span>
    <button type="button" class="btn primary" data-a="sadd">${t("add")} · ${money(unit * U.sh.qty)}</button>` : `<span class="pill">${t("off")}</span>`}</div>`;
  }
  const openDish = id => { U.sh = { id, qty: 1, add: new Set() }; openSheet(sheetHTML()); };
  const redrawSheet = () => { const b = $("sheetBox"), st = b.scrollTop; b.innerHTML = sheetHTML(); b.scrollTop = st; };

  async function refreshOrders() {
    try {
      const list = await rpc("guest_orders", { p_guest: tok });
      list.forEach(o => O[o.id] = o);
      const known = new Set(list.map(o => o.id)); G.orders = G.orders.filter(id => known.has(id)); save();
      if (G.screen === "track" && $("trackBody")) { quiet(); $("trackBody").innerHTML = trackBody(); }
      else if (G.screen === "history" && $("histBody")) { quiet(); $("histBody").innerHTML = histBody(); }
    } catch (e) { /* тихо: следующая попытка через несколько секунд */ }
  }
  async function place() {
    if (U.busy) return;
    if (!G.cart.length) return go("menu");
    U.busy = true; U.err = "";
    if (!U.idem) { U.idem = "o_" + uid(); store.set(KEY + "-idem", U.idem); }
    quiet(); const b = $("placeBtn"); if (b) { b.disabled = true; b.textContent = t("placing"); }
    let res;
    try {
      res = await rpc("create_order", { p_tag: tag, p_lines: G.cart.map(l => ({ item_id: l.itemId, qty: l.qty, addons: l.addons })), p_pay: "waiter", p_note: G.note, p_idem: U.idem, p_guest: tok });
    } catch (e) { U.busy = false; U.err = t("net"); render(false); return; }
    U.busy = false;
    if (!res.ok) {
      resetIdem();
      if (res.code === "unavailable") {
        const names = (res.gone || []).map(id => { const it = I(id); return it ? tr(it.name) : ""; }).filter(Boolean);
        G.cart = G.cart.filter(l => !(res.gone || []).includes(l.itemId)); save();
        await loadMenu(true);
        U.err = t("gone") + " " + names.join(", "); G.screen = "cart"; save(); render(true); return;
      }
      U.err = res.code === "table_off" ? t("tableOff") : res.code === "too_fast" ? t("tooFast") : res.code === "empty" ? t("empty") : t("fail");
      render(false); return;
    }
    resetIdem();
    const o = res.order; O[o.id] = o; if (!G.orders.includes(o.id)) G.orders.push(o.id);
    G.cart = []; G.note = ""; G.cur = o.id; go("done");
  }
  async function loadMenu(silent) {
    try {
      const r = await rpc("get_menu", { p_tag: tag });
      if (!r.ok) { if (!silent) msgScreen(r.code === "tag_not_found" ? t("notFound") : t("restOff")); return false; }
      M = r; return true;
    } catch (e) { if (!silent) msgScreen(t("net"), true); return false; }
  }
  function msgScreen(m, retry) {
    mount(`<div class="g"><div class="center"><div class="box"><span class="emb" style="width:72px;height:72px">${emblem()}</span><p style="font-size:17px">${esc(m)}</p>${retry ? `<button type="button" class="btn primary" data-a="reload">${t("retry")}</button>` : ""}</div></div></div>`);
  }

  cur = {
    acts: {
      go: v => { if (v === "pay" && !G.cart.length) return; go(v); },
      lang: v => { G.lang = v; save(); render(false); if (!$("sheet").hidden && U.sh) redrawSheet(); },
      cat: v => { U.cat = v; quiet(); document.querySelectorAll(".cats button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === v)); const dl = $("dishList"); dl.innerHTML = dishList(); dl.style.animation = "none"; void dl.offsetWidth; dl.style.animation = "fade .3s var(--ease)"; },
      sheet: (v, b, e) => { if (e.target.closest(".plus")) return; openDish(v); },
      quick: v => { const it = I(v); if (!it || !it.available) return; if (it.addons.length) openDish(v); else { addLine(v, [], 1); partial(true); } },
      lq: (v, b) => { const l = G.cart.find(x => x.key === v); if (!l) return; l.qty += Number(b.dataset.d); if (l.qty <= 0) G.cart = G.cart.filter(x => x !== l); l.qty = Math.min(50, l.qty); resetIdem(); save(); render(false); },
      place,
      track: v => { G.cur = v; go("track"); refreshOrders(); },
      reload: () => route(),
      sq: (v, b) => { U.sh.qty = Math.max(1, Math.min(20, U.sh.qty + Number(b.dataset.d))); redrawSheet(); },
      sadd: () => { addLine(U.sh.id, U.sh.add, U.sh.qty); closeSheet(); partial(true); }
    },
    onInput: e => {
      if (e.target.id === "q") { U.q = e.target.value; quiet(); $("dishList").innerHTML = dishList(); }
      if (e.target.id === "note") { G.note = e.target.value; resetIdem(); save(); }
    },
    onSheetChange: e => { const c = e.target.closest("[data-add]"); if (!c) return; c.checked ? U.sh.add.add(c.dataset.add) : U.sh.add.delete(c.dataset.add); redrawSheet(); }
  };

  (async () => {
    mount(`<div class="g"><div class="center"><div class="box"><span class="spinner emb">${emblem()}</span><p class="note">${t("loading")}</p></div></div></div>`, false);
    if (!(await loadMenu())) return;
    document.title = M.restaurant.name + " · Dastorkon";
    if (G.orders.length) await refreshOrders();
    if (!S[G.screen] || (["done", "track"].includes(G.screen) && !O[G.cur])) G.screen = "welcome";
    if (G.screen === "pay" && !G.cart.length) G.screen = "menu";
    render(true);
    timers.push(setInterval(() => { if (document.visibilityState === "visible" && G.orders.length && ["done", "track", "history", "welcome", "menu"].includes(G.screen)) refreshOrders(); }, 6000));
    timers.push(setInterval(() => { if (document.visibilityState === "visible" && G.screen === "menu" && !U.q) loadMenu(true).then(ok => ok && partial(false)); }, 60000));
  })();
}

/* ================= КАБИНЕТ РЕСТОРАНА ================= */
const ST_RU = { accepted: "Принят", cooking: "Готовится", ready: "Готов", served: "Подан", cancelled: "Отменён" };
const ROLE_RU = { owner: "Владелец", manager: "Управляющий", waiter: "Официант", kitchen: "Кухня", admin: "Администратор платформы" };
let audioCtx = null;
document.addEventListener("pointerdown", () => { if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } }, { once: true });
function beep() {
  if (!audioCtx) return;
  try { [0, .18].forEach(d => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(.0001, audioCtx.currentTime + d); g.gain.exponentialRampToValueAtTime(.3, audioCtx.currentTime + d + .02); g.gain.exponentialRampToValueAtTime(.0001, audioCtx.currentTime + d + .15); o.connect(g).connect(audioCtx.destination); o.start(audioCtx.currentTime + d); o.stop(audioCtx.currentTime + d + .16); }); } catch (e) {}
}

function Cabinet(ctx) {
  const rs = ctx.restaurants || [];
  if (!rs.length) {
    cur = { acts: { logout } };
    mount(topbar(ctx) + `<div class="center"><div class="box"><span class="emb" style="width:64px;height:64px">${emblem()}</span><h1 style="font-size:22px">Аккаунт ещё не привязан к ресторану</h1>
    <p class="note" style="font-size:15px">Сообщите администратору Dastorkon ваш email: <b>${esc(ctx.email)}</b>. После привязки обновите страницу.</p>
    ${ctx.is_admin ? `<a class="btn primary" href="/admin">Открыть панель платформы</a>` : ""}</div></div>`);
    return;
  }
  const qr = new URLSearchParams(location.search).get("r");
  let rid = qr && rs.find(r => r.id === qr) ? qr : store.get("nfc-rid");
  if (!rs.find(r => r.id === rid)) rid = rs[0].id;
  store.set("nfc-rid", rid);
  const role = rs.find(r => r.id === rid).role;
  const canManage = ["owner", "manager", "admin"].includes(role);
  const canStaff = ["owner", "admin"].includes(role);
  const D = { rest: null, cats: [], items: [], addons: [], tables: [], tags: [], orders: [], staff: null, stats: null };
  const U = { tab: canManage ? (store.get("nfc-ctab") || "orders") : "orders", view: role === "kitchen" ? "kitchen" : (store.get("nfc-cview") || "all"), seen: null, known: null, confirm: null, busy: false };
  if (!canManage) U.tab = "orders";
  const I = id => D.items.find(x => x.id === id);

  async function loadAll() {
    const [rest, cats, items, addons, tables, tags] = await Promise.all([
      q(sb.from("restaurants").select("*").eq("id", rid).single()),
      q(sb.from("categories").select("*").eq("restaurant_id", rid).order("sort").order("id")),
      q(sb.from("items").select("*").eq("restaurant_id", rid).order("sort").order("created_at")),
      q(sb.from("addons").select("*").eq("restaurant_id", rid).order("sort").order("price")),
      q(sb.from("tables").select("*").eq("restaurant_id", rid).order("number")),
      q(sb.from("tags").select("code").eq("restaurant_id", rid).order("code"))
    ]);
    Object.assign(D, { rest, cats, items, addons, tables, tags });
    await loadOrders(true);
  }
  async function loadOrders(first) {
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    const list = await q(sb.from("orders").select("*, order_lines(*)").eq("restaurant_id", rid).gte("created_at", since).order("created_at").limit(500));
    if (!U.known) { U.known = new Set(list.map(o => o.id)); U.seen = new Set(list.map(o => o.id)); }
    const fresh = list.filter(o => !U.known.has(o.id) && o.status === "accepted");
    list.forEach(o => U.known.add(o.id));
    D.orders = list;
    if (fresh.length && !first) { beep(); toast(fresh.length === 1 ? `Новый заказ: стол ${fresh[0].table_number}` : `Новых заказов: ${fresh.length}`); }
    return fresh;
  }

  /* --- заказы --- */
  function ordCard(o) {
    const isNew = !U.seen.has(o.id); U.seen.add(o.id);
    const i = ST.indexOf(o.status);
    const labels = { accepted: D.rest.route === "waiter" ? "Отправить на кухню" : "Начать готовить", cooking: "Готово", ready: "Подано" };
    const pay = o.paid ? `<span class="pill ok">Оплачен</span>` : `<span class="pill red">Не оплачен</span>`;
    const lines = (o.order_lines || []).slice().sort((a, b) => a.id - b.id);
    return `<div class="ord ${isNew ? "new" : ""}"><div class="hd"><b>Стол ${o.table_number}</b><span class="note">№ ${o.no} · ${time(o.created_at)}</span></div>
    <ul>${lines.map(l => `<li>${l.qty} × ${esc(l.name.ru || l.name.ky || l.name.en || "")}${(l.addons || []).length ? ` <small>+ ${l.addons.map(a => esc(a.ru || a.ky || a.en || "")).join(", ")}</small>` : ""}</li>`).join("")}</ul>
    ${o.note ? `<div class="cm">${esc(o.note)}</div>` : ""}
    <div class="ft"><b>${num(o.total)} сом</b>${pay}</div>
    <div class="acts">${i >= 0 && i < 3 ? `<button type="button" class="btn sm primary" data-a="next" data-v="${o.id}">${labels[o.status]} →</button>` : ""}
    ${!o.paid && o.pay_method === "waiter" && U.view !== "kitchen" ? `<button type="button" class="btn sm" data-a="paid" data-v="${o.id}">Оплата получена</button>` : ""}
    ${!o.paid && o.status !== "served" && U.view !== "kitchen" ? `<button type="button" class="btn sm danger" data-a="cancel" data-v="${o.id}">${U.confirm === o.id ? "Точно отменить?" : "Отменить"}</button>` : ""}</div></div>`;
  }
  function tOrders() {
    const active = D.orders.filter(o => o.status !== "cancelled");
    let cols;
    if (U.view === "kitchen") cols = D.rest.route === "kitchen" ? ["accepted", "cooking"] : ["cooking"];
    else cols = ST;
    const viewSw = role === "kitchen" ? "" : `<div class="langs plain" role="group" aria-label="Экран"><button type="button" data-a="view" data-v="all" aria-pressed="${U.view === "all"}">Все заказы</button><button type="button" data-a="view" data-v="kitchen" aria-pressed="${U.view === "kitchen"}">Экран кухни</button></div>`;
    return `<div class="banner">${viewSw}<span class="note" style="flex:1;min-width:200px">${D.rest.route === "waiter" ? "Новые заказы сначала видят официанты, на кухню их отправляет официант." : "Новые заказы сразу видит кухня."} Заказы обновляются сами, новый сопровождается звуком.</span>
    ${canManage ? `<label for="route" class="lbl">Новые заказы:</label><select id="route" data-f="route"><option value="waiter" ${D.rest.route === "waiter" ? "selected" : ""}>сначала официантам</option><option value="kitchen" ${D.rest.route === "kitchen" ? "selected" : ""}>сразу на кухню</option></select>` : ""}</div>
    <div class="board ${cols.length === 2 ? "k2" : cols.length === 1 ? "k1" : ""} ${U.view === "kitchen" ? "big" : ""}">${cols.map(s => {
      let os = active.filter(o => o.status === s);
      if (s === "served") os = os.filter(o => Date.now() - new Date(o.updated_at || o.created_at) < 3 * 3600e3).reverse().slice(0, 10);
      return `<div class="col"><h3>${ST_RU[s]}<span class="pill">${os.length}</span></h3>${os.map(ordCard).join("") || `<p class="empty">Пусто</p>`}</div>`;
    }).join("")}</div>`;
  }

  /* --- блюда --- */
  function tMenu() {
    return `<div class="card" style="display:grid;gap:10px"><div class="row" style="justify-content:space-between"><b>Категории</b><button type="button" class="btn sm" data-a="catadd">+ Категория</button></div>
    <div class="cat-list">${D.cats.map((c, i) => `<span class="cat-chip"><input type="text" id="cn-${c.id}" value="${esc(c.name.ru || "")}" data-f="catname" data-id="${c.id}" aria-label="Название категории" size="${Math.max(8, (c.name.ru || "").length)}">
      ${i ? `<button type="button" data-a="catup" data-v="${c.id}" aria-label="Левее" title="Левее">←</button>` : ""}<button type="button" data-a="catdel" data-v="${c.id}" aria-label="Удалить категорию" title="Удалить">${U.confirm === c.id ? "?" : "✕"}</button></span>`).join("") || `<span class="note">Добавьте первую категорию, например «Горячие блюда».</span>`}</div>
    ${D.cats.some(c => U.confirm === c.id) ? `<p class="note">Нажмите «?» ещё раз, чтобы удалить категорию. Блюда останутся в разделе «Другое».</p>` : ""}</div>
    <div class="row"><button type="button" class="btn sm primary" data-a="dishnew">+ Блюдо</button><span class="note">Цена и наличие меняются у гостей сразу. Нажмите на название, чтобы изменить состав, аллергены, добавки и перевод.</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Фото</th><th>Название</th><th>Категория</th><th>Цена, сом</th><th>В наличии</th><th></th></tr></thead><tbody>
    ${D.items.map(x => `<tr><td><button type="button" class="pic" style="--h:${hue(x.id)}" data-a="dishphoto" data-v="${x.id}" aria-label="Загрузить фото">${x.photo_url ? `<img src="${esc(x.photo_url)}" alt="" loading="lazy">` : "+"}</button></td>
    <td><a href="#" data-a="dishedit" data-v="${x.id}" style="font-weight:700">${esc(x.name.ru || "Без названия")}</a></td>
    <td><select id="dc-${x.id}" data-f="cat" data-id="${x.id}" aria-label="Категория"><option value="">Другое</option>${D.cats.map(c => `<option value="${c.id}" ${c.id === x.category_id ? "selected" : ""}>${esc(c.name.ru || "")}</option>`).join("")}</select></td>
    <td><input type="number" id="dr-${x.id}" min="0" step="10" value="${x.price}" data-f="price" data-id="${x.id}" style="width:110px" aria-label="Цена"></td>
    <td><label class="sw"><input type="checkbox" id="do-${x.id}" data-f="avail" data-id="${x.id}" ${x.available ? "checked" : ""} aria-label="В наличии"><i></i></label></td>
    <td><button type="button" class="btn sm" data-a="dishedit" data-v="${x.id}">Изменить</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty">Блюд пока нет. Нажмите «+ Блюдо».</td></tr>`}
    </tbody></table></div>`;
  }
  const L3 = (id, label, obj, area) => `<div class="fld"><span class="lbl">${label}</span><div class="grid3">${["ru", "ky", "en"].map(l => area
    ? `<textarea id="${id}-${l}" rows="2" placeholder="${l === "ru" ? "Русский" : l === "ky" ? "Кыргызча" : "English"}" aria-label="${label} ${l}">${esc((obj || {})[l] || "")}</textarea>`
    : `<input type="text" id="${id}-${l}" value="${esc((obj || {})[l] || "")}" placeholder="${l === "ru" ? "Русский" : l === "ky" ? "Кыргызча" : "English"}" aria-label="${label} ${l}">`).join("")}</div></div>`;
  const read3 = id => { const o = {}; ["ru", "ky", "en"].forEach(l => { const v = $(id + "-" + l).value.trim(); if (v) o[l] = v; }); return o; };
  let E = null;
  function addonRow(a) { const k = a.id || "n" + Math.random().toString(36).slice(2, 7); return `<div class="row" data-addon="${k}" data-existing="${a.id ? 1 : 0}" style="flex-wrap:nowrap;align-items:start">
    <div class="grid3" style="flex:1">${["ru", "ky", "en"].map(l => `<input type="text" data-al="${l}" value="${esc((a.name || {})[l] || "")}" placeholder="${l === "ru" ? "Добавка" : l === "ky" ? "Кыргызча" : "English"}" aria-label="Добавка ${l}">`).join("")}</div>
    <input type="number" data-ap min="0" step="10" value="${a.price || 0}" style="width:100px;flex:none" aria-label="Цена добавки"><button type="button" class="btn sm" data-a="addondel" aria-label="Удалить добавку">✕</button></div>`; }
  function editor(x) {
    E = { id: x ? x.id : null, photo: x ? x.photo_url : null };
    const adds = x ? D.addons.filter(a => a.item_id === x.id) : [];
    openSheet(`<button type="button" class="x" data-a="x" aria-label="Закрыть">✕</button><div class="sheet-body gut" style="padding-top:22px">
    <h3 style="font-family:var(--f-ui);font-size:22px">${x ? "Блюдо" : "Новое блюдо"}</h3>
    ${L3("en", "Название", x && x.name)}
    ${L3("ed", "Описание", x && x.descr, true)}
    ${L3("ei", "Состав", x && x.ingredients, true)}
    <div class="grid3"><div class="fld"><label for="e-cat">Категория</label><select id="e-cat"><option value="">Другое</option>${D.cats.map(c => `<option value="${c.id}" ${x && c.id === x.category_id ? "selected" : ""}>${esc(c.name.ru || "")}</option>`).join("")}</select></div>
    <div class="fld"><label for="e-price">Цена, сом</label><input type="number" id="e-price" min="0" step="10" value="${x ? x.price : ""}"></div>
    <div class="fld"><label for="e-por">Порция</label><input type="text" id="e-por" value="${esc(x ? x.portion : "")}" placeholder="350 г или 0,5 л"></div></div>
    <div class="fld"><span class="lbl">Аллергены</span><div class="row">${Object.entries(AL).map(([k, v]) => `<label class="chk"><input type="checkbox" data-alg="${k}" ${x && (x.allergens || []).includes(k) ? "checked" : ""}>${v.ru}</label>`).join("")}</div></div>
    <div class="fld"><span class="lbl">Фото</span><div class="row"><span class="pic" id="e-ph" style="--h:${hue(x ? x.id : "n")};width:64px;height:64px;border-radius:12px;font-size:24px">${E.photo ? `<img src="${esc(E.photo)}" alt="">` : "+"}</span><button type="button" class="btn sm" data-a="ephoto">Загрузить фото</button>${E.photo ? `<button type="button" class="btn sm" data-a="ephotodel">Убрать</button>` : ""}</div></div>
    <div class="fld"><span class="lbl">Добавки (название и цена)</span><div id="e-adds" style="display:grid;gap:8px">${adds.map(addonRow).join("")}</div><div><button type="button" class="btn sm" data-a="addonadd">+ Добавка</button></div></div>
    <label class="chk" style="justify-self:start"><input type="checkbox" id="e-av" ${!x || x.available ? "checked" : ""}>В наличии</label>
    <div id="e-err"></div></div>
    <div class="sheet-foot gut"><button type="button" class="btn primary" data-a="esave">Сохранить</button>${x ? `<button type="button" class="btn danger" data-a="edel" style="flex:none">${U.confirm === "d" + x.id ? "Точно удалить?" : "Удалить"}</button>` : ""}</div>`, true);
  }
  async function saveEditor() {
    const name = read3("en"); if (!name.ru && !name.ky && !name.en) { $("e-err").innerHTML = `<div class="err">Введите название блюда</div>`; return; }
    const row = { restaurant_id: rid, name, descr: read3("ed"), ingredients: read3("ei"), category_id: $("e-cat").value || null,
      price: Math.max(0, Math.round(Number($("e-price").value) || 0)), portion: $("e-por").value.trim(), available: $("e-av").checked,
      allergens: [...document.querySelectorAll("[data-alg]:checked")].map(c => c.dataset.alg), photo_url: E.photo || null };
    const rows = [...document.querySelectorAll("#e-adds [data-addon]")].map((r, i) => {
      const n = {}; r.querySelectorAll("[data-al]").forEach(inp => { const v = inp.value.trim(); if (v) n[inp.dataset.al] = v; });
      return { key: r.dataset.addon, existing: r.dataset.existing === "1", name: n, price: Math.max(0, Math.round(Number(r.querySelector("[data-ap]").value) || 0)), sort: i };
    }).filter(a => a.name.ru || a.name.ky || a.name.en);
    const btn = document.querySelector('[data-a="esave"]'); btn.disabled = true;
    try {
      let itemId = E.id;
      if (itemId) await q(sb.from("items").update(row).eq("id", itemId));
      else { row.sort = D.items.length; const ins = await q(sb.from("items").insert(row).select("id").single()); itemId = ins.id; }
      const old = D.addons.filter(a => a.item_id === itemId), keep = new Set(rows.filter(a => a.existing).map(a => a.key));
      const del = old.filter(a => !keep.has(a.id)).map(a => a.id);
      if (del.length) await q(sb.from("addons").delete().in("id", del));
      for (const a of rows.filter(a => a.existing)) await q(sb.from("addons").update({ name: a.name, price: a.price, sort: a.sort }).eq("id", a.key));
      const fresh = rows.filter(a => !a.existing).map(a => ({ restaurant_id: rid, item_id: itemId, name: a.name, price: a.price, sort: a.sort }));
      if (fresh.length) await q(sb.from("addons").insert(fresh));
      closeSheet(); toast("Сохранено"); await reloadMenu();
    } catch (e) { btn.disabled = false; $("e-err").innerHTML = `<div class="err">${esc(errMsg(e))}</div>`; }
  }
  async function reloadMenu() {
    const [cats, items, addons] = await Promise.all([
      q(sb.from("categories").select("*").eq("restaurant_id", rid).order("sort").order("id")),
      q(sb.from("items").select("*").eq("restaurant_id", rid).order("sort").order("created_at")),
      q(sb.from("addons").select("*").eq("restaurant_id", rid).order("sort").order("price"))]);
    Object.assign(D, { cats, items, addons }); render(false);
  }

  /* --- столы --- */
  const tagLink = code => `${location.origin}/t/${code}`;
  function tTables() {
    const used = new Set(D.tables.map(x => x.tag_code).filter(Boolean)), free = D.tags.filter(x => !used.has(x.code));
    return `<div class="row"><button type="button" class="btn sm primary" data-a="tableadd">+ Стол</button>${D.tables.length ? `<button type="button" class="btn sm" data-a="copyall">Скопировать все ссылки</button>` : ""}
    <span class="note">Свободных меток: ${free.length}. ${free.length ? "" : "Новые метки выдаёт администратор Dastorkon."} Ссылку из таблицы записывают на NFC-метку стола.</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Стол</th><th>Метка</th><th>Ссылка для метки</th><th>Принимает заказы</th><th></th></tr></thead><tbody>
    ${D.tables.map(x => `<tr><td><input type="number" id="tn-${x.id}" min="1" value="${x.number}" data-f="tnum" data-id="${x.id}" style="width:90px;min-width:0" aria-label="Номер стола"></td>
    <td><select id="tt-${x.id}" data-f="ttag" data-id="${x.id}" aria-label="Метка"><option value="">— нет —</option>${(x.tag_code ? [{ code: x.tag_code }] : []).concat(free).map(g => `<option value="${g.code}" ${g.code === x.tag_code ? "selected" : ""}>${g.code}</option>`).join("")}</select></td>
    <td>${x.tag_code ? `<a class="mono" href="${esc(tagLink(x.tag_code))}" target="_blank" rel="noopener">${esc(tagLink(x.tag_code).replace(/^https?:\/\//, ""))}</a>` : `<span class="note">Выберите метку</span>`}</td>
    <td><label class="sw"><input type="checkbox" id="ta-${x.id}" data-f="tact" data-id="${x.id}" ${x.active ? "checked" : ""} aria-label="Принимает заказы"><i></i></label></td>
    <td><span class="row" style="flex-wrap:nowrap">${x.tag_code ? `<button type="button" class="btn sm" data-a="qr" data-v="${x.id}">QR</button><button type="button" class="btn sm" data-a="copy" data-v="${x.tag_code}">Копировать</button>` : ""}<button type="button" class="btn sm danger" data-a="tabledel" data-v="${x.id}">${U.confirm === x.id ? "Точно?" : "Удалить"}</button></span></td></tr>`).join("") || `<tr><td colspan="5" class="empty">Столов пока нет. Нажмите «+ Стол».</td></tr>`}
    </tbody></table></div>`;
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast("Скопировано"); }
    catch (e) { openSheet(`<button type="button" class="x" data-a="x" aria-label="Закрыть">✕</button><div class="sheet-body gut" style="padding-top:22px"><b>Скопируйте вручную</b><textarea rows="8" readonly id="cpy">${esc(text)}</textarea></div>`, true); setTimeout(() => $("cpy") && $("cpy").select(), 50); }
  }

  /* --- аналитика --- */
  async function loadStats() {
    const since = new Date(Date.now() - 30 * 86400e3).toISOString();
    D.stats = await q(sb.from("orders").select("total, paid, status, table_number, created_at, order_lines(name, qty)").eq("restaurant_id", rid).gte("created_at", since).neq("status", "cancelled").limit(10000));
    if (U.tab === "stats") render(false);
  }
  function tStats() {
    if (!D.stats) { loadStats().catch(e => toast(errMsg(e))); return `<p class="empty">Считаем…</p>`; }
    const os = D.stats, rev = os.filter(o => o.paid).reduce((s, o) => s + o.total, 0), sum = os.reduce((s, o) => s + o.total, 0), due = os.filter(o => !o.paid).reduce((s, o) => s + o.total, 0);
    const top = {}; os.forEach(o => (o.order_lines || []).forEach(l => { const n = l.name.ru || l.name.ky || l.name.en || "—"; top[n] = (top[n] || 0) + l.qty; }));
    const rows = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 8), mx = rows.length ? rows[0][1] : 1;
    const days = []; for (let i = 13; i >= 0; i--) { const d = addDays(today(), -i); days.push([d, os.filter(o => o.created_at.slice(0, 10) === d).reduce((s, o) => s + o.total, 0)]); }
    const mxd = Math.max(1, ...days.map(d => d[1]));
    const byT = {}; os.forEach(o => byT[o.table_number] = (byT[o.table_number] || 0) + o.total);
    const tt = Object.entries(byT).sort((a, b) => b[1] - a[1]).slice(0, 8), mxt = tt.length ? tt[0][1] : 1;
    const bars = (arr, m, fmt) => arr.map(([n, v]) => `<div class="bar"><span>${esc(n)}</span><span><i data-w="${Math.round(v / m * 100)}"></i></span><b>${fmt(v)}</b></div>`).join("") || `<p class="empty">Пока нет заказов</p>`;
    return `<p class="note">За последние 30 дней, без отменённых заказов.</p>
    <div class="tiles"><div class="tile"><small>Оплачено</small><b>${num(rev)} сом</b></div><div class="tile"><small>Заказов</small><b>${os.length}</b></div><div class="tile"><small>Средний чек</small><b>${num(os.length ? Math.round(sum / os.length) : 0)} сом</b></div><div class="tile"><small>Не оплачено</small><b>${num(due)} сом</b></div></div>
    <div class="card"><h3 style="margin-bottom:12px;font-size:16px">Сумма заказов по дням, сом</h3><div class="bars">${bars(days.map(([d, v]) => [dmy(d).slice(0, 5), v]), mxd, num)}</div></div>
    <div class="two"><div class="card"><h3 style="margin-bottom:12px;font-size:16px">Популярные блюда, порций</h3><div class="bars">${bars(rows, mx, v => v)}</div></div>
    <div class="card"><h3 style="margin-bottom:12px;font-size:16px">Сумма по столам, сом</h3><div class="bars">${bars(tt.map(([n, v]) => ["Стол " + n, v]), mxt, num)}</div></div></div>`;
  }

  /* --- заведение --- */
  function tRest() {
    const r = D.rest;
    if (canStaff && !D.staff) rpc("list_staff", { p_rid: rid }).then(s => { D.staff = s; if (U.tab === "rest") render(false); }).catch(e => toast(errMsg(e)));
    return `<div class="two"><div class="card" style="display:grid;gap:12px;align-content:start">
      <div class="fld"><label for="rname">Название</label><input type="text" id="rname" data-f="rname" value="${esc(r.name)}" maxlength="80"></div>
      ${L3("rt", "Подпись под названием", r.tagline)}
      <div><button type="button" class="btn sm" data-a="savetag">Сохранить подпись</button></div>
      <div class="fld"><span class="lbl">Фото интерьера (экран приветствия)</span><div class="row"><button type="button" class="btn sm" data-a="cover">Загрузить</button>${r.cover_url ? `<button type="button" class="btn sm" data-a="coverdel">Убрать</button><a class="note" href="${esc(r.cover_url)}" target="_blank" rel="noopener">посмотреть</a>` : ""}</div></div>
      <div class="fld"><span class="lbl">Логотип</span><div class="row"><button type="button" class="btn sm" data-a="logo">Загрузить</button>${r.logo_url ? `<button type="button" class="btn sm" data-a="logodel">Убрать</button>` : ""}</div></div>
    </div>
    <div style="display:grid;gap:16px;align-content:start">
      <div class="card" style="display:grid;gap:8px"><h3 style="font-size:16px">Подписка</h3>
        <div class="row"><span class="pill">${esc((PLANS[r.plan] || {}).name || r.plan)}</span><span class="note">оплачено до ${dmy(r.paid_until)}</span></div>
        ${CFG.SUPPORT ? `<p class="note">Продление и поддержка: ${esc(CFG.SUPPORT)}</p>` : ""}</div>
      ${canStaff ? `<div class="card" style="display:grid;gap:10px"><h3 style="font-size:16px">Сотрудники</h3>
        ${D.staff ? D.staff.map(s => `<div class="row" style="justify-content:space-between"><span>${esc(s.email)} <span class="pill">${ROLE_RU[s.role] || s.role}</span></span>${s.user_id !== ctx.user_id ? `<button type="button" class="btn sm danger" data-a="staffdel" data-v="${s.user_id}">${U.confirm === s.user_id ? "Точно?" : "Убрать"}</button>` : ""}</div>`).join("") : `<p class="note">Загружаем…</p>`}
        <form class="row" data-submit="staffadd"><input type="email" id="se" placeholder="email сотрудника" aria-label="Email сотрудника" required><select id="sr" aria-label="Роль" style="flex:0 1 160px"><option value="waiter">Официант</option><option value="kitchen">Кухня</option><option value="manager">Управляющий</option></select><button type="submit" class="btn sm primary">Добавить</button></form>
        <p class="note">Сотрудник сначала сам создаёт аккаунт на странице кабинета, потом вы добавляете его по email.</p></div>` : ""}
    </div></div>`;
  }

  const TABS = { orders: ["Заказы", tOrders], menu: ["Блюда и цены", tMenu], tables: ["Столы и NFC", tTables], stats: ["Аналитика", tStats], rest: ["Заведение", tRest] };
  function render(anim) {
    const active = D.orders.filter(o => o.status === "accepted" || o.status === "cooking" || o.status === "ready").length;
    const tabs = canManage ? Object.keys(TABS) : ["orders"];
    const sel = rs.length > 1 ? `<select id="rsel" data-f="rsel" aria-label="Ресторан" style="width:auto">${rs.map(r => `<option value="${r.id}" ${r.id === rid ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>` : "";
    document.title = (active ? `(${active}) ` : "") + D.rest.name + " · кабинет";
    mount(topbar(ctx, sel) + `<div class="ws gut"><div class="ws-head"><div><h1>${esc(D.rest.name)}</h1><p>Кабинет ресторана · ${ROLE_RU[role] || role}</p></div></div>
    ${tabs.length > 1 ? `<div class="tabs" role="tablist">${tabs.map(k => `<button type="button" role="tab" data-a="tab" data-v="${k}" aria-selected="${U.tab === k}">${TABS[k][0]}${k === "orders" && active ? `<span class="n">${active}</span>` : ""}</button>`).join("")}</div>` : ""}
    <div class="stag" style="display:grid;gap:14px">${TABS[U.tab][1]()}</div></div>`, anim);
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll(".bar i[data-w]").forEach(b => b.style.width = b.dataset.w + "%")));
  }
  const busyWrap = fn => async (...a) => { if (U.busy) return; U.busy = true; try { await fn(...a); } catch (e) { toast(errMsg(e)); } finally { U.busy = false; } };
  const twoStep = (key, fn) => async () => { if (U.confirm !== key) { U.confirm = key; quiet(); render(false); setTimeout(() => { if (U.confirm === key) { U.confirm = null; if (!$("sheet").hidden && E) return; quiet(); render(false); } }, 4000); return; } U.confirm = null; await fn(); };
  const patchRest = async patch => { await q(sb.from("restaurants").update(patch).eq("id", rid)); Object.assign(D.rest, patch); };

  cur = {
    acts: {
      logout,
      tab: v => { U.tab = v; store.set("nfc-ctab", v); if (v === "stats") D.stats = null; render(true); },
      view: v => { U.view = v; store.set("nfc-cview", v); render(false); },
      next: busyWrap(async v => { await rpc("advance_order", { p_id: v }); await loadOrders(); render(false); }),
      paid: busyWrap(async v => { await rpc("mark_paid", { p_id: v }); await loadOrders(); render(false); toast("Оплата отмечена"); }),
      cancel: v => twoStep(v, busyWrap(async () => { await rpc("cancel_order", { p_id: v }); await loadOrders(); render(false); toast("Заказ отменён"); }))(),
      catadd: busyWrap(async () => { await q(sb.from("categories").insert({ restaurant_id: rid, name: { ru: "Новая категория" }, sort: D.cats.length })); await reloadMenu(); const last = D.cats[D.cats.length - 1]; const el = last && $("cn-" + last.id); el && (el.focus(), el.select()); }),
      catup: busyWrap(async v => { const i = D.cats.findIndex(c => c.id === v); if (i < 1) return; const a = D.cats[i - 1], b = D.cats[i];
        const order = D.cats.map(c => c.id); order[i - 1] = b.id; order[i] = a.id;
        await Promise.all(order.map((id, k) => q(sb.from("categories").update({ sort: k }).eq("id", id)))); await reloadMenu(); }),
      catdel: v => twoStep(v, busyWrap(async () => { await q(sb.from("categories").delete().eq("id", v)); await reloadMenu(); }))(),
      dishnew: () => editor(null),
      dishedit: v => editor(I(v)),
      dishphoto: busyWrap(async v => { const url = await uploadPhoto(rid, "dish", 900); if (!url) return; await q(sb.from("items").update({ photo_url: url }).eq("id", v)); I(v).photo_url = url; render(false); toast("Фото обновлено"); }),
      ephoto: busyWrap(async () => { const url = await uploadPhoto(rid, "dish", 900); if (!url) return; E.photo = url; $("e-ph").innerHTML = `<img src="${esc(url)}" alt="">`; }),
      ephotodel: () => { E.photo = null; $("e-ph").innerHTML = "+"; },
      addonadd: () => { $("e-adds").insertAdjacentHTML("beforeend", addonRow({})); const r = $("e-adds").lastElementChild; r.querySelector("input").focus(); },
      addondel: (v, b) => b.closest("[data-addon]").remove(),
      esave: () => saveEditor(),
      edel: () => { const key = "d" + E.id; if (U.confirm !== key) { U.confirm = key; const b = document.querySelector('[data-a="edel"]'); b.textContent = "Точно удалить?"; return; } U.confirm = null;
        busyWrap(async () => { await q(sb.from("items").delete().eq("id", E.id)); closeSheet(); toast("Блюдо удалено"); await reloadMenu(); })(); },
      tableadd: busyWrap(async () => { const used = new Set(D.tables.map(x => x.tag_code).filter(Boolean)); const free = D.tags.find(x => !used.has(x.code));
        const n = D.tables.reduce((m, x) => Math.max(m, x.number), 0) + 1;
        await q(sb.from("tables").insert({ restaurant_id: rid, number: n, tag_code: free ? free.code : null }));
        D.tables = await q(sb.from("tables").select("*").eq("restaurant_id", rid).order("number")); render(false); }),
      tabledel: v => twoStep(v, busyWrap(async () => { await q(sb.from("tables").delete().eq("id", v)); D.tables = D.tables.filter(x => x.id !== v); render(false); }))(),
      copy: v => copyText(tagLink(v)),
      qr: v => { const x = D.tables.find(t => t.id === v); if (!x || !x.tag_code) return; const link = tagLink(x.tag_code); let svg = `<p class="note">Не удалось построить QR-код</p>`;
        try { if (typeof qrcode === "function") { const qq = qrcode(0, "M"); qq.addData(link); qq.make(); svg = qq.createSvgTag({ cellSize: 8, margin: 2, scalable: true }); } } catch (e) {}
        openSheet(`<button type="button" class="x" data-a="x" aria-label="Закрыть">✕</button><div class="sheet-body gut" style="padding-top:22px;justify-items:center;text-align:center"><h3 style="font-family:var(--f-ui);font-size:22px">Стол ${x.number}</h3><div style="background:#fff;padding:12px;border-radius:16px;width:min(320px,100%)">${svg}</div><a class="mono" href="${esc(link)}" target="_blank" rel="noopener">${esc(link.replace(/^https?:\/\//, ""))}</a><p class="note">QR-код ведёт туда же, куда NFC-метка: для телефонов без NFC. Сохраните картинку или сделайте скриншот для печати на табличке.</p></div>`, true); },
      copyall: () => copyText(D.tables.filter(x => x.tag_code).map(x => `Стол ${x.number}: ${tagLink(x.tag_code)}`).join("\n")),
      savetag: busyWrap(async () => { await patchRest({ tagline: read3("rt") }); toast("Сохранено"); }),
      cover: busyWrap(async () => { const url = await uploadPhoto(rid, "cover", 1400); if (!url) return; await patchRest({ cover_url: url }); render(false); toast("Фото обновлено"); }),
      coverdel: busyWrap(async () => { await patchRest({ cover_url: null }); render(false); }),
      logo: busyWrap(async () => { const url = await uploadPhoto(rid, "logo", 400); if (!url) return; await patchRest({ logo_url: url }); render(false); toast("Логотип обновлён"); }),
      logodel: busyWrap(async () => { await patchRest({ logo_url: null }); render(false); }),
      staffadd: busyWrap(async () => { const email = $("se").value.trim(); if (!email) return; const r = await rpc("add_staff", { p_rid: rid, p_email: email, p_role: $("sr").value });
        if (!r.ok) { toast("Аккаунт с таким email не найден. Пусть сотрудник сначала зарегистрируется в кабинете."); return; }
        D.staff = await rpc("list_staff", { p_rid: rid }); render(false); toast("Сотрудник добавлен"); }),
      staffdel: v => twoStep(v, busyWrap(async () => { await rpc("remove_staff", { p_rid: rid, p_user: v }); D.staff = await rpc("list_staff", { p_rid: rid }); render(false); }))()
    },
    onChange: busyWrap(async e => {
      const el = e.target, f = el.dataset.f; if (!f) return; const id = el.dataset.id;
      if (f === "rsel") { store.set("nfc-rid", el.value); history.replaceState(null, "", location.pathname); route(); return; }
      if (f === "route") { await patchRest({ route: el.value }); render(false); return; }
      if (f === "rname") { const v = el.value.trim(); if (!v) { el.value = D.rest.name; return; } await patchRest({ name: v }); render(false); toast("Сохранено"); return; }
      if (f === "catname") { const v = el.value.trim() || "Без названия"; const c = D.cats.find(x => x.id === id); const name = Object.assign({}, c.name, { ru: v }); await q(sb.from("categories").update({ name }).eq("id", id)); c.name = name; return; }
      if (f === "cat") { await q(sb.from("items").update({ category_id: el.value || null }).eq("id", id)); I(id).category_id = el.value || null; return; }
      if (f === "price") { const v = Math.max(0, Math.round(Number(el.value) || 0)); el.value = v; await q(sb.from("items").update({ price: v }).eq("id", id)); I(id).price = v; toast("Цена обновлена"); return; }
      if (f === "avail") { await q(sb.from("items").update({ available: el.checked }).eq("id", id)); I(id).available = el.checked; toast(el.checked ? "Блюдо снова в меню" : "Блюдо помечено «нет в наличии»"); return; }
      const tb = D.tables.find(x => x.id === id);
      if (f === "tnum") { const v = Math.round(Number(el.value)); if (!(v >= 1)) { el.value = tb.number; return; } try { await q(sb.from("tables").update({ number: v }).eq("id", id)); tb.number = v; } catch (err) { el.value = tb.number; throw err; } D.tables.sort((a, b) => a.number - b.number); render(false); return; }
      if (f === "ttag") { await q(sb.from("tables").update({ tag_code: el.value || null }).eq("id", id)); tb.tag_code = el.value || null; render(false); return; }
      if (f === "tact") { await q(sb.from("tables").update({ active: el.checked }).eq("id", id)); tb.active = el.checked; return; }
    })
  };

  (async () => {
    mount(topbar(ctx) + `<div class="center"><div class="box"><span class="spinner emb">${emblem()}</span></div></div>`, false);
    try { await loadAll(); } catch (e) { return fatal(errMsg(e), true); }
    render(true);
    const refresh = async () => { try { await loadOrders(); if (U.tab === "orders" && $("sheet").hidden && !(document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))) { quiet(); render(false); } } catch (e) {} };
    channel = sb.channel("orders-" + rid).on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: "restaurant_id=eq." + rid }, () => { clearTimeout(refresh.t); refresh.t = setTimeout(refresh, 400); }).subscribe();
    timers.push(setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 20000));
  })();
}

/* ================= ПАНЕЛЬ ПЛАТФОРМЫ ================= */
function Admin(ctx) {
  if (!ctx.is_admin) {
    cur = { acts: { logout } };
    mount(topbar(ctx) + `<div class="center"><div class="box"><span class="emb" style="width:64px;height:64px">${emblem()}</span>
    <h1 style="font-size:22px">Нет доступа</h1><p class="note">Эта страница только для администраторов Dastorkon.</p><a class="btn" href="/cabinet">Кабинет ресторана</a></div></div>`);
    return;
  }
  const D = { rests: [], tags: [], tables: [], staff: { admins: [], staff: [] } };
  const U = { tab: store.get("nfc-atab") || "rests", filter: "", confirm: null, busy: false };
  async function load() {
    const [rests, tags, tables, staff] = await Promise.all([
      q(sb.from("restaurants").select("*").order("created_at")),
      q(sb.from("tags").select("*").order("created_at", { ascending: false }).limit(5000)),
      q(sb.from("tables").select("id, restaurant_id, number, tag_code")),
      rpc("admin_staff")]);
    Object.assign(D, { rests, tags, tables, staff });
  }
  const rName = id => (D.rests.find(r => r.id === id) || {}).name || "—";
  const planOpts = sel => Object.entries(PLANS).map(([k, p]) => `<option value="${k}" ${sel === k ? "selected" : ""}>${esc(p.name)} · ${num(p.price)} сом</option>`).join("");
  const restOpts = sel => D.rests.map(r => `<option value="${r.id}" ${sel === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("");
  function tRests() {
    return `<form class="row" data-submit="restadd"><input type="text" id="nr" placeholder="Название ресторана" aria-label="Название ресторана" maxlength="80" required><input type="text" id="nc" placeholder="Город" aria-label="Город" value="Бишкек"><select id="np" aria-label="Тариф" style="flex:0 1 220px">${planOpts("cafe")}</select><button type="submit" class="btn sm primary">Подключить</button></form>
    <div class="tbl-wrap"><table><thead><tr><th>Ресторан</th><th>Город</th><th>Тариф</th><th>Оплачено до</th><th>Столов / меток</th><th>Работает</th><th></th></tr></thead><tbody>
    ${D.rests.map(r => { const exp = r.paid_until && r.paid_until < today(), soon = r.paid_until && !exp && r.paid_until < addDays(today(), 14);
      return `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.city)}</td><td><select id="pl-${r.id}" data-f="plan" data-id="${r.id}" aria-label="Тариф">${planOpts(r.plan)}</select></td>
      <td><span class="row" style="flex-wrap:nowrap"><input type="date" id="pu-${r.id}" value="${r.paid_until || ""}" data-f="until" data-id="${r.id}" style="width:150px;min-width:0" aria-label="Оплачено до">${exp ? `<span class="pill red">Просрочено</span>` : soon ? `<span class="pill warn">Скоро</span>` : ""}</span></td>
      <td>${D.tables.filter(x => x.restaurant_id === r.id).length} / ${D.tags.filter(x => x.restaurant_id === r.id).length}</td>
      <td><label class="sw"><input type="checkbox" id="ra-${r.id}" data-f="ract" data-id="${r.id}" ${r.active ? "checked" : ""} aria-label="Работает"><i></i></label></td>
      <td><span class="row" style="flex-wrap:nowrap"><a class="btn sm" href="/cabinet?r=${r.id}">Кабинет</a><button type="button" class="btn sm" data-a="plus30" data-v="${r.id}">+30 дней</button></span></td></tr>`; }).join("") || `<tr><td colspan="7" class="empty">Ресторанов пока нет</td></tr>`}
    </tbody></table></div><p class="note">Если подписка просрочена больше 3 дней или выключен переключатель «Работает», гости увидят «Меню временно недоступно».</p>`;
  }
  function tTags() {
    const list = D.tags.filter(g => !U.filter || g.restaurant_id === U.filter);
    return `<form class="row" data-submit="issue"><select id="ir" aria-label="Ресторан" required><option value="">Выберите ресторан</option>${restOpts(U.filter)}</select><input type="number" id="ic" min="1" max="200" value="10" aria-label="Количество" style="flex:0 1 110px"><button type="submit" class="btn sm primary">Выпустить метки</button></form>
    <div class="row"><label for="tf" class="lbl">Показать:</label><select id="tf" data-f="tfilter" style="flex:0 1 260px"><option value="">Все рестораны</option>${restOpts(U.filter)}</select>${list.length ? `<button type="button" class="btn sm" data-a="copytags">Скопировать ссылки</button>` : ""}<span class="note">Меток: ${list.length}</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Метка</th><th>Ресторан</th><th>Стол</th><th>Ссылка для записи на метку</th></tr></thead><tbody>
    ${list.slice(0, 500).map(g => { const tb = D.tables.find(x => x.tag_code === g.code); return `<tr><td><code>${g.code}</code></td><td>${esc(rName(g.restaurant_id))}</td><td>${tb ? "Стол " + tb.number : `<span class="pill">Свободна</span>`}</td><td class="mono">${esc(location.origin)}/t/${g.code}</td></tr>`; }).join("") || `<tr><td colspan="4" class="empty">Меток пока нет</td></tr>`}
    </tbody></table></div>`;
  }
  function tSubs() {
    const act = D.rests.filter(r => r.active), mrr = act.reduce((s, r) => s + ((PLANS[r.plan] || {}).price || 0), 0);
    const exp = D.rests.filter(r => r.paid_until && r.paid_until < today()), soon = D.rests.filter(r => r.paid_until && r.paid_until >= today() && r.paid_until < addDays(today(), 14));
    const by = Object.entries(PLANS).map(([k, p]) => [p.name, D.rests.filter(r => r.plan === k && r.active).length]), mx = Math.max(1, ...by.map(b => b[1]));
    return `<div class="tiles"><div class="tile"><small>Работающих ресторанов</small><b>${act.length}</b></div><div class="tile"><small>Подписки в месяц</small><b>${num(mrr)} сом</b></div><div class="tile"><small>Истекают за 14 дней</small><b>${soon.length}</b></div><div class="tile"><small>Просрочены</small><b>${exp.length}</b></div></div>
    <div class="card"><h3 style="margin-bottom:12px;font-size:16px">Рестораны по тарифам</h3><div class="bars">${by.map(([n, v]) => `<div class="bar"><span>${esc(n)}</span><span><i data-w="${Math.round(v / mx * 100)}"></i></span><b>${v}</b></div>`).join("")}</div></div>
    ${exp.concat(soon).length ? `<div class="card" style="display:grid;gap:6px"><h3 style="font-size:16px">Напомнить об оплате</h3>${exp.concat(soon).map(r => `<div class="row" style="justify-content:space-between"><span>${esc(r.name)}</span><span class="pill ${r.paid_until < today() ? "red" : "warn"}">до ${dmy(r.paid_until)}</span></div>`).join("")}</div>` : ""}`;
  }
  function tUsers() {
    const s = D.staff;
    return `<div class="card" style="display:grid;gap:6px"><h3 style="font-size:16px">Администраторы платформы</h3>${s.admins.map(a => `<div>${esc(a.email)}</div>`).join("")}
    <p class="note">Добавить ещё одного администратора можно в Supabase: таблица platform_admins.</p></div>
    <form class="row" data-submit="staffadd"><select id="sr2" aria-label="Ресторан" required><option value="">Ресторан</option>${restOpts("")}</select><input type="email" id="se2" placeholder="email сотрудника" aria-label="Email" required><select id="sl2" aria-label="Роль" style="flex:0 1 170px"><option value="owner">Владелец</option><option value="manager">Управляющий</option><option value="waiter">Официант</option><option value="kitchen">Кухня</option></select><button type="submit" class="btn sm primary">Выдать доступ</button></form>
    <p class="note">Человек сначала сам создаёт аккаунт на странице /cabinet, потом вы выдаёте доступ по его email. Владелец ресторана сможет сам добавлять своих сотрудников.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Email</th><th>Ресторан</th><th>Роль</th><th></th></tr></thead><tbody>
    ${s.staff.map(x => `<tr><td>${esc(x.email)}</td><td>${esc(x.restaurant)}</td><td>${ROLE_RU[x.role] || x.role}</td><td><button type="button" class="btn sm danger" data-a="staffdel" data-v="${x.restaurant_id}|${x.user_id}">${U.confirm === x.restaurant_id + "|" + x.user_id ? "Точно?" : "Убрать"}</button></td></tr>`).join("") || `<tr><td colspan="4" class="empty">Сотрудников пока нет</td></tr>`}
    </tbody></table></div>`;
  }
  const TABS = { rests: ["Рестораны", tRests], tags: ["NFC-метки", tTags], subs: ["Подписки", tSubs], users: ["Доступы", tUsers] };
  function render(anim) {
    document.title = "Панель Dastorkon";
    mount(topbar(ctx) + `<div class="ws gut"><div class="ws-head"><div><h1>Панель Dastorkon</h1><p>Рестораны, метки, подписки и доступы</p></div></div>
    <div class="tabs" role="tablist">${Object.entries(TABS).map(([k, [n]]) => `<button type="button" role="tab" data-a="tab" data-v="${k}" aria-selected="${U.tab === k}">${n}</button>`).join("")}</div>
    <div class="stag" style="display:grid;gap:14px">${TABS[U.tab][1]()}</div></div>`, anim);
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll(".bar i[data-w]").forEach(b => b.style.width = b.dataset.w + "%")));
  }
  const busyWrap = fn => async (...a) => { if (U.busy) return; U.busy = true; try { await fn(...a); } catch (e) { toast(errMsg(e)); } finally { U.busy = false; } };
  const reload = async () => { await load(); render(false); };
  cur = {
    acts: {
      logout,
      tab: v => { U.tab = v; store.set("nfc-atab", v); render(true); },
      restadd: busyWrap(async () => { const name = $("nr").value.trim(); if (!name) return toast("Введите название ресторана");
        await q(sb.from("restaurants").insert({ name, city: $("nc").value.trim() || "Бишкек", plan: $("np").value, paid_until: addDays(today(), 14) })); await reload(); toast("Ресторан подключён, 14 дней бесплатно"); }),
      plus30: busyWrap(async v => { const r = D.rests.find(x => x.id === v); const base = r.paid_until && r.paid_until > today() ? r.paid_until : today();
        await q(sb.from("restaurants").update({ paid_until: addDays(base, 30), active: true }).eq("id", v)); await reload(); toast("Подписка продлена на 30 дней"); }),
      issue: busyWrap(async () => { const r = $("ir").value, n = Math.round(Number($("ic").value)); if (!r) return toast("Выберите ресторан"); if (!(n >= 1 && n <= 200)) return toast("От 1 до 200 меток за раз");
        const made = await rpc("issue_tags", { p_rid: r, p_count: n }); U.filter = r; await reload(); toast(`Выпущено меток: ${made.length}`); }),
      copytags: async () => { const list = D.tags.filter(g => !U.filter || g.restaurant_id === U.filter); const text = list.map(g => `${rName(g.restaurant_id)}\t${g.code}\t${location.origin}/t/${g.code}`).join("\n");
        try { await navigator.clipboard.writeText(text); toast("Скопировано"); } catch (e) { openSheet(`<button type="button" class="x" data-a="x" aria-label="Закрыть">✕</button><div class="sheet-body gut" style="padding-top:22px"><b>Скопируйте вручную</b><textarea rows="10" readonly>${esc(text)}</textarea></div>`, true); } },
      staffadd: busyWrap(async () => { const r = $("sr2").value, email = $("se2").value.trim(); if (!r || !email) return toast("Выберите ресторан и введите email");
        const res = await rpc("add_staff", { p_rid: r, p_email: email, p_role: $("sl2").value });
        if (!res.ok) return toast("Аккаунт с таким email не найден. Пусть человек сначала зарегистрируется на /cabinet.");
        await reload(); toast("Доступ выдан"); }),
      staffdel: v => { if (U.confirm !== v) { U.confirm = v; quiet(); render(false); return; } U.confirm = null;
        busyWrap(async () => { const [r, u] = v.split("|"); await rpc("remove_staff", { p_rid: r, p_user: u }); await reload(); })(); }
    },
    onChange: busyWrap(async e => {
      const el = e.target, f = el.dataset.f, id = el.dataset.id; if (!f) return;
      if (f === "tfilter") { U.filter = el.value; render(false); return; }
      const r = D.rests.find(x => x.id === id);
      if (f === "plan") { await q(sb.from("restaurants").update({ plan: el.value }).eq("id", id)); r.plan = el.value; toast("Тариф изменён"); }
      if (f === "until") { await q(sb.from("restaurants").update({ paid_until: el.value || null }).eq("id", id)); r.paid_until = el.value || null; render(false); }
      if (f === "ract") { await q(sb.from("restaurants").update({ active: el.checked }).eq("id", id)); r.active = el.checked; toast(el.checked ? "Ресторан включён" : "Ресторан выключен, гости видят «меню недоступно»"); }
    })
  };
  (async () => {
    mount(topbar(ctx) + `<div class="center"><div class="box"><span class="spinner emb">${emblem()}</span></div></div>`, false);
    try { await load(); } catch (e) { return fatal(errMsg(e), true); }
    render(true);
  })();
}

if (sb) sb.auth.onAuthStateChange(ev => {
  if (ev === "SIGNED_OUT") route();
  if (ev === "PASSWORD_RECOVERY") { RECOVERY = true; clearTimers(); dropChannel(); closeSheet(); authView("Смена пароля", "newpw"); }
});
route();
})();
