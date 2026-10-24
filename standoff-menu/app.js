/* ===== GOOSE STRIKE — логика лобби ===== */
'use strict';

const RARITIES = {
  common: { name: 'COMMON', color: '#8d9199', weight: 50, sell: 15,  speed: 1.0 },
  rare:   { name: 'RARE',   color: '#4a8fe0', weight: 27, sell: 45,  speed: 1.15 },
  epic:   { name: 'EPIC',   color: '#a855f7', weight: 15, sell: 120, speed: 1.3 },
  arcana: { name: 'ARCANA', color: '#e03b7a', weight: 6,  sell: 320, speed: 1.5 },
  gold:   { name: 'GOLD',   color: '#ffc531', weight: 2,  sell: 900, speed: 1.75 }
};

/* Мемы-картинки (без эмодзи) — ровно те, что в игре */
const MEMES = [
  { key: 'okak',     n: 'okaK',      img: 'memes/okak.png' },
  { key: 'skebob',   n: 'СКЕБОБ',    img: 'memes/skebob.png' },
  { key: 'icecream', n: '6/7',       img: 'memes/icecream.png' },
  { key: 'italian',  n: 'ИТАЛО-МЕМ', img: 'memes/italian.png' }
];

/* HTML картинки мема: встроенная base64 (memes/data.js) → файл */
function memeMedia(m, cls) {
  const src = (window.MEME_IMG && window.MEME_IMG[m.key]) || m.img;
  return `<img class="${cls}" src="${src}" alt="${m.n}" loading="lazy">`;
}

/* Друзья — как в списке на скрине */
const FRIENDS = [
  { clan: '[YWB]', n: 'Angelok',       s: 'В игре',           play: true,  e: '🦢' },
  { n: 'mr_Ade',                        s: 'В игре',           play: true,  e: '🐱' },
  { clan: '[Aluma]', n: 't.papamozh...',s: 'В игре',           play: true,  e: '🐹' },
  { n: 'ради nei',                      s: 'В игре',           play: true,  e: '🐶' },
  { n: 'СОСИСКА',                       s: 'В игре',           play: false, e: '🌭' },
  { clan: '[ARTK]', n: 'tpk1ivayn1c1...',s: 'Не в сети',       play: false, e: '🐧' },
  { n: 'ГусьВТапках',                   s: 'Был(а) 2 часа назад', play: false, e: '🦆' },
  { n: 'СигмаБой',                      s: 'Не в сети',        play: false, e: '😎' }
];

const S = {
  gold: 12720,
  silver: 94,
  inventory: [],
  totalEarned: 0,
  boostUntil: 0,
  seq: 1,
  bet: 100,
  mult: 2
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const fmt = (n) => Math.floor(n).toLocaleString('ru-RU').replace(/\u00A0/g, ' ');

/* ---------- ЗАГРУЗКА ---------- */
(function boot() {
  const fill = $('#bootFill'), st = $('#bootStatus');
  const steps = [[25,'Загрузка лобби...'],[55,'Синхронизация профиля...'],[80,'Подключение...'],[100,'Готово']];
  let i = 0;
  const t = setInterval(() => {
    if (i >= steps.length) { clearInterval(t); $('#boot').classList.add('hide'); return; }
    fill.style.width = steps[i][0] + '%';
    st.textContent = steps[i][1];
    i++;
  }, 240);
})();

/* ---------- HUD ---------- */
function syncGold(flash) {
  $('#goldVal').textContent = fmt(S.gold);
  $('#silverVal').textContent = fmt(S.silver);
  if (flash) {
    const b = $('#goldBox');
    b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
  }
  $('#invBadge').textContent = S.inventory.length;
  $('#invTotal').textContent = S.inventory.length;
  $('#statGold').textContent = fmt(S.totalEarned);
  $('#statMemes').textContent = S.inventory.length;
}

function addGold(v) {
  S.gold += v; S.totalEarned += Math.max(0, v); syncGold(true);
  saveState();
}

/* ---------- СОХРАНЕНИЕ В localStorage (для 3D-режима) ---------- */
function saveState() {
  try {
    localStorage.setItem('gs_gold', String(S.gold));
    localStorage.setItem('gs_inventory', JSON.stringify(S.inventory.map((x) => ({
      name: x.name, img: x.img, rar: x.rar
    }))));
  } catch (e) { /* ignore */ }
}

function loadState() {
  try {
    const g = parseInt(localStorage.getItem('gs_gold') || '', 10);
    if (!isNaN(g)) S.gold = g;
    const inv = JSON.parse(localStorage.getItem('gs_inventory') || 'null');
    if (Array.isArray(inv) && inv.length) S.inventory = inv;
  } catch (e) { /* ignore */ }
}

/* ---------- ДРУЗЬЯ ---------- */
function renderFriends() {
  $('#frList').innerHTML = FRIENDS.map((f) => `
    <div class="fr-row">
      <div class="fr-av">${f.e}</div>
      <div class="fr-info">
        <div class="fr-name">${f.clan ? `<span class="fr-clan">${f.clan}</span>` : ''}${f.n}</div>
        <div class="fr-status ${f.play ? 'play' : ''}">${f.s}</div>
      </div>
    </div>`).join('');
  $('#frOnline').textContent = FRIENDS.filter((f) => f.play).length;
}

/* ---------- ТОСТЫ ---------- */
function toast(html, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = html;
  $('#toastWrap').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0'; el.style.transform = 'translateX(30px)';
    setTimeout(() => el.remove(), 320);
  }, 2400);
}

/* ---------- МОДАЛКИ ---------- */
function openModal(id) { const m = $(id); if (m) m.classList.add('show'); }
function closeModal(el) { el.classList.remove('show'); }

$$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); }));
$$('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.closest('.modal'))));
$$('.mb-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const box = tab.closest('.modal-box');
    box.querySelectorAll('.mb-tab').forEach((t) => t.classList.remove('active'));
    box.querySelectorAll('.mb-pane').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    const pane = box.querySelector('#' + tab.dataset.pane);
    if (pane) pane.classList.add('active');
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('.modal.show').forEach(closeModal);
});

/* ---------- ЛЕВАЯ ПАНЕЛЬ ---------- */
$$('.rail-btn').forEach((b) => {
  b.addEventListener('click', () => {
    $$('.rail-btn').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
  });
});
$('#navPlay').addEventListener('click', () => openModal('#modalHome'));
$('#navInv').addEventListener('click', () => { renderInv(); openModal('#modalInv'); });
$('#navCase').addEventListener('click', () => openModal('#modalShop'));
$('#navGun').addEventListener('click', () => { renderInv(); openModal('#modalInv'); });
$('#navSkull').addEventListener('click', () => toast('События · <b>День рождения Standoff</b>'));
$('#navChart').addEventListener('click', () => openModal('#modalProfile'));
$('#navGear').addEventListener('click', () => toast('Настройки'));
$('#navChat').addEventListener('click', () => toast('Сообщения'));
$('#navGlobe').addEventListener('click', () => toast('Язык: Русский'));

$('#openProfile').addEventListener('click', () => openModal('#modalProfile'));
$('#openShop').addEventListener('click', () => openModal('#modalShop'));
$('#openModes').addEventListener('click', () => openModal('#modalModes'));
$('#navEvents').addEventListener('click', () => toast('События · <b>Бонусы за вход</b>'));
$('#navPass').addEventListener('click', () => openModal('#modalShop'));
$('#frFind').addEventListener('click', () => toast('Поиск игрока по ID...'));

$('#btnPlay').addEventListener('click', () => { window.location.href = 'game.html?autostart=1'; });
$('#bigPlay').addEventListener('click', () => { window.location.href = 'game.html?autostart=1'; });

/* ---------- КЛИКЕР / РЕКЛАМА ---------- */
$('#btnClick').addEventListener('click', () => { addGold(1); toast('+1 G', 'good'); });
$('#btnAd').addEventListener('click', () => { addGold(100); toast('Реклама просмотрена · <b>+100 G</b>', 'good'); });
$('#btnBoost').addEventListener('click', () => {
  S.boostUntil = Date.now() + 5 * 60 * 1000;
  toast('Буст <b>x2 Голда</b> активен 5 минут', 'good');
});
setInterval(() => {
  const on = Date.now() < S.boostUntil;
  $('#boostState').textContent = on
    ? 'Буст x2 · осталось ' + Math.ceil((S.boostUntil - Date.now()) / 1000) + ' с'
    : 'Буст неактивен';
  $('#boostState').classList.toggle('on', on);
}, 500);

/* ---------- КЕЙС ---------- */
function rollRarity() {
  const total = Object.values(RARITIES).reduce((a, r) => a + r.weight, 0);
  let r = Math.random() * total;
  for (const [k, v] of Object.entries(RARITIES)) { if (r < v.weight) return k; r -= v.weight; }
  return 'common';
}
let spinning = false;

function openCase() {
  if (spinning) return;
  if (S.gold < 100) { toast('Недостаточно Голды · нужно <b>100 G</b>', 'bad'); return; }
  spinning = true;
  addGold(-100);
  $('#btnOpenCase').disabled = true;
  $('#rouResult').textContent = 'Крутим...';

  const strip = $('#rouStrip');
  const ITEM_W = 100, COUNT = 52, WIN = 46;
  const seq = [];
  for (let i = 0; i < COUNT; i++) seq.push({ r: rollRarity(), meme: MEMES[Math.floor(Math.random() * MEMES.length)] });
  const won = { r: rollRarity(), meme: MEMES[Math.floor(Math.random() * MEMES.length)] };
  seq[WIN] = won;

  strip.innerHTML = seq.map((it) => `
    <div class="rou-item">
      ${memeMedia(it.meme, 're-img')}
      <div class="rn" style="color:${RARITIES[it.r].color}">${it.meme.n}</div>
    </div>`).join('');

  const boxW = strip.parentElement.offsetWidth;
  const jitter = (Math.random() - 0.5) * (ITEM_W * 0.55);
  const target = -(WIN * ITEM_W + ITEM_W / 2 - boxW / 2 + jitter);

  strip.style.transition = 'none';
  strip.style.transform = 'translateX(0)';
  void strip.offsetWidth;
  strip.style.transition = 'transform 5.2s cubic-bezier(.10,.72,.12,1)';
  strip.style.transform = `translateX(${target}px)`;

  setTimeout(() => {
    const items = strip.querySelectorAll('.rou-item');
    if (items[WIN]) items[WIN].classList.add('hit');
    const m = RARITIES[won.r];
    S.inventory.push({
      id: S.seq++, name: won.meme.n, img: won.meme.img,
      rar: won.r, rarName: m.name, color: m.color, sell: m.sell, speed: m.speed
    });
    $('#rouResult').innerHTML = `<span style="color:${m.color};font-weight:800">${m.name}</span> · ${won.meme.n}`;
    syncGold(); renderInv();
    toast(`Выпал <b style="color:${m.color}">${m.name}</b>: ${won.meme.n}`, 'good');
    spinning = false;
    $('#btnOpenCase').disabled = false;
  }, 5300);
}
$('#btnOpenCase').addEventListener('click', openCase);

/* ---------- ИНВЕНТАРЬ ---------- */
function renderInv() {
  const grid = $('#invGrid'), empty = $('#invEmpty');
  if (!S.inventory.length) { grid.innerHTML = ''; empty.classList.add('show'); return; }
  empty.classList.remove('show');
  grid.innerHTML = S.inventory.map((it) => `
    <div class="card" style="--rar:${it.color}">
      <div class="card-img-wrap">${memeMedia(it, 'card-img')}</div>
      <div class="card-top">
        <div class="card-seq">#${String(it.id).padStart(3, '0')}</div>
      </div>
      <div class="card-name">${it.name}</div>
      <div class="card-rar">${it.rarName}</div>
      <div class="card-price">◉ ${fmt(it.sell)} G</div>
      <button class="card-sell" data-sell="${it.id}">ПРОДАТЬ</button>
    </div>`).join('');
  grid.querySelectorAll('[data-sell]').forEach((b) => {
    b.addEventListener('click', () => sellOne(+b.dataset.sell));
  });
}
function sellOne(id) {
  const i = S.inventory.findIndex((x) => x.id === id);
  if (i < 0) return;
  const it = S.inventory[i];
  addGold(it.sell);
  S.inventory.splice(i, 1);
  syncGold(); renderInv();
  toast(`Продано: ${it.name} за <b>${fmt(it.sell)} G</b>`, 'good');
}
$('#btnSellAll').addEventListener('click', () => {
  if (!S.inventory.length) { toast('Инвентарь пуст', 'bad'); return; }
  const sum = S.inventory.reduce((a, x) => a + x.sell, 0);
  const n = S.inventory.length;
  addGold(sum); S.inventory = []; syncGold(); renderInv();
  toast(`Продано <b>${n}</b> мемов за <b>${fmt(sum)} G</b>`, 'good');
});

/* ---------- КАЗИНО ---------- */
const MULTS = { 1.5: 66, 2: 50, 3: 33, 5: 20, 10: 10 }; // % зелёной зоны
let needleX = 0, needleDir = 1, needleRaf = null;

function updateCasino() {
  const z = MULTS[S.mult];
  $('#zoneGreen').style.width = z + '%';
  $('#winChance').textContent = z + '%';
  $('#potential').textContent = fmt(Math.floor(S.bet * S.mult)) + ' G';
  $('#betVal').textContent = fmt(S.bet);
}

$$('#multSelect button').forEach((b) => {
  b.addEventListener('click', () => {
    $$('#multSelect button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    S.mult = parseFloat(b.dataset.mult);
    updateCasino();
  });
});
$$('.bet-quick button').forEach((b) => {
  b.addEventListener('click', () => {
    const v = b.dataset.bet;
    S.bet = v === 'all' ? Math.max(1, Math.floor(S.gold)) : parseInt(v, 10);
    if (S.bet > S.gold) S.bet = Math.max(1, Math.floor(S.gold));
    updateCasino();
  });
});

function stopNeedle() {
  if (needleRaf) { cancelAnimationFrame(needleRaf); needleRaf = null; }
}
function poolLoop() {
  const trackW = $('#track').offsetWidth;
  needleX += needleDir * (trackW / 86);
  if (needleX >= trackW - 3) { needleX = trackW - 3; needleDir = -1; }
  if (needleX <= 0) { needleX = 0; needleDir = 1; }
  $('#needle').style.left = needleX + 'px';
  needleRaf = requestAnimationFrame(poolLoop);
}

let spinningCasino = false;
$('#btnSpin').addEventListener('click', () => {
  if (spinningCasino) return;
  if (S.bet > S.gold || S.gold <= 0) { toast('Недостаточно Голды', 'bad'); return; }
  if (S.bet < 1) { toast('Ставка слишком мала', 'bad'); return; }
  spinningCasino = true;
  $('#btnSpin').disabled = true;
  addGold(-S.bet);

  const log = $('#casinoLog');
  log.className = 'casino-log';
  log.textContent = 'Бегунок колеблется...';
  stopNeedle(); poolLoop();

  setTimeout(() => {
    stopNeedle();
    const trackW = $('#track').offsetWidth;
    const pct = (needleX / trackW) * 100;
    const zone = MULTS[S.mult];
    const win = pct <= zone;

    if (win) {
      const gain = Math.floor(S.bet * S.mult);
      addGold(gain);
      log.className = 'casino-log win';
      log.textContent = `ПОБЕДА! x${S.mult} · +${fmt(gain)} G`;
      toast(`Казино: <b>+${fmt(gain)} G</b> (x${S.mult})`, 'good');
    } else {
      log.className = 'casino-log lose';
      log.textContent = `Проигрыш · −${fmt(S.bet)} G`;
      toast(`Казино: <b>−${fmt(S.bet)} G</b>`, 'bad');
    }
    spinningCasino = false;
    $('#btnSpin').disabled = false;
    S.bet = Math.min(S.bet, Math.max(1, Math.floor(S.gold)));
    updateCasino();
  }, 2600);
});

/* ---------- СТАРТ ---------- */
loadState();
renderFriends();
renderInv();
syncGold();
updateCasino();
