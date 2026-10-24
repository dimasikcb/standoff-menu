/* ============================================================
   GOOSE STRIKE — 3D режим выживания
   Three.js r149
   ============================================================ */
'use strict';

/* ---------- КОНСТАНТЫ ---------- */
const ARENA = 80;                 // 80x80
const HALF = ARENA / 2;
const EYE = 1.7;                  // высота глаз
const GRAVITY = -26;
const JUMP_V = 9.2;
const WALK = 6.2;
const RUN = 10.2;
const CLIMB_V = 5.0;
const TURN_V = 2.6;               // рад/с поворота камеры с клавиатуры (Q/E)
/* Чувствительность мыши: одна и та же и с захватом курсора, и без него,
   чтобы первый запуск ощущался ровно как второй — без разгонов. */
const LOOK_SENS = 0.0024;         // рад на пиксель смещения мыши
/* Доворот у края окна: без захвата курсор упирается в границу и обзор
   встаёт. За EDGE_BAND (доля полуэкрана от центра) камера доворачивается
   сама — с ПОСТОЯННОЙ скоростью, никакого разгона. */
const EDGE_BAND = 0.82;
const EDGE_TURN = 2.2;            // рад/с
const BUNKER_Y = -5;
const GOLD_PER_SEC = 1;
/* Потолок скорости мемов. Игрок идёт WALK = 6.2 м/с, бежит RUN = 10.2.
   Скорость мемов жёстко ограничена сверху: всегда чуть медленнее шага. */
const BOT_MAX = WALK - 0.5;       // 5.7 м/с
/* Радиус и высота тела мема — для столкновений со стенами */
const MEME_R = 0.45;
const MEME_H = 1.5;

/* ============================================================
   БОЙ: здоровье игрока, оружие, волны
   ============================================================ */
const PLAYER_HP = 100;
const STEP_H = 0.45;              // максимальная ступенька, на которую всходим
const COYOTE = 0.12;              // прыжок чуть после схода с края (сек)
const JUMP_BUF = 0.14;            // прыжок, нажатый чуть раньше приземления
const ACCEL_GROUND = 62;          // разгон по земле, м/с²
const ACCEL_AIR = 16;             // управление в воздухе
const FRICTION = 11;              // торможение без ввода

/* Оружие: автоматический ПП «ГУСЬ-9» */
const WEAPON = {
  name: 'ГУСЬ-9',
  dmg: 24,
  headMul: 2.0,
  rpm: 600,
  mag: 30,
  reserve: 150,
  maxReserve: 240,
  reload: 1.65,
  range: 140,
  spread: 0.006,
  spreadShot: 0.0045,
  spreadMax: 0.055,
  spreadDecay: 0.09,
  recoil: 0.0135,
  recoilDecay: 9
};

/* Сколько мемов в волне: 3, 4, 6, 7, 9… (потолок 12) */
function waveCount(n) {
  return Math.min(12, 2 + Math.ceil(n * 1.5));
}

const RARITY_SPEED = {
  common: { sp: 2.8, color: '#8d9199', label: 'COMMON' },
  rare:   { sp: 3.5, color: '#4a8fe0', label: 'RARE' },
  epic:   { sp: 4.2, color: '#a855f7', label: 'EPIC' },
  arcana: { sp: 4.9, color: '#e03b7a', label: 'ARCANA' },
  gold:   { sp: 5.6, color: '#ffc531', label: 'GOLD' }
};

/* Типы мемов — ровно те картинки, которые должны быть в игре. */
const MEME_DEFS = [
  { key: 'okak',     name: 'okaK',   img: 'memes/okak.png',     rar: 'common', hp: 60,  sp: 3.0, dmg: 8,  reward: 18,  sc: 1.5 },
  { key: 'skebob',   name: 'СКЕБОБ', img: 'memes/skebob.png',   rar: 'rare',   hp: 85,  sp: 3.6, dmg: 11, reward: 32,  sc: 1.55 },
  { key: 'icecream', name: '6/7',    img: 'memes/icecream.png', rar: 'epic',   hp: 115, sp: 4.0, dmg: 14, reward: 55,  sc: 1.6 },
  { key: 'italian',  name: 'ИТАЛО-МЕМ', img: 'memes/italian.png', rar: 'gold', hp: 160, sp: 4.3, dmg: 18, reward: 95, sc: 1.7 }
];

/* ---------- НАСТРОЙКИ (в UI, хранятся в localStorage) ---------- */
const Opt = (function loadOpt() {
  const d = { sens: 1, edgeTurn: true };
  try {
    const s = JSON.parse(localStorage.getItem('gs_opt') || '{}') || {};
    if (typeof s.sens === 'number' && isFinite(s.sens)) d.sens = Math.min(3, Math.max(0.2, s.sens));
    if (typeof s.edgeTurn === 'boolean') d.edgeTurn = s.edgeTurn;
  } catch (e) { /* настроек нет — берём defaults */ }
  return d;
})();

function saveOpt() {
  try { localStorage.setItem('gs_opt', JSON.stringify(Opt)); } catch (e) { /* ignore */ }
}

/* ============================================================
   ЗВУК (WebAudio, без файлов)
   Контекст создаётся лениво на первом клике — политика автозапуска
   иначе не даёт браузеру играть звук.
   ============================================================ */
const Sfx = {
  ctx: null,
  noise: null,

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') { try { this.ctx.resume(); } catch (e) {} }
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const len = Math.floor(this.ctx.sampleRate * 0.3);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      this.noise = buf;
    } catch (e) { this.ctx = null; }
  },

  burst(dur, freq, vol) {
    if (!this.ctx || !this.noise) return;
    try {
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.9;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.ctx.destination);
      src.start(t); src.stop(t + dur + 0.02);
    } catch (e) { /* звук не критичен */ }
  },

  tone(f0, f1, dur, vol, type) {
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* звук не критичен */ }
  },

  shot() { this.burst(0.09, 1100, 0.16); this.tone(150, 55, 0.1, 0.12, 'triangle'); },
  hit(head) { this.tone(head ? 1350 : 880, head ? 950 : 700, 0.06, 0.07, 'square'); },
  kill() { this.tone(520, 240, 0.18, 0.08, 'triangle'); },
  hurt() { this.tone(190, 65, 0.22, 0.16, 'sawtooth'); this.burst(0.12, 300, 0.12); },
  reload() { this.tone(320, 210, 0.05, 0.06, 'square'); setTimeout(() => this.tone(240, 160, 0.05, 0.06, 'square'), 130); },
  empty() { this.tone(210, 170, 0.04, 0.05, 'square'); }
};

/* ---------- СОСТОЯНИЕ ---------- */
const G = {
  scene: null, camera: null, renderer: null, clock: null,
  colliders: [],          // {min:{x,y,z}, max:{x,y,z}}
  climbables: [],         // палки/лестницы
  memes: [],
  running: false,
  paused: false,
  gold: 0,
  goldAcc: 0,
  startTime: 0,
  elapsed: 0,
  onGround: false,
  vel: new THREE.Vector3(),
  yaw: 0, pitch: 0,
  keys: {},
  climbing: false,
  climbTarget: null,
  dragLook: false,        // ЛКМ зажата — поворот камеры без Pointer Lock
  lockDenied: false,      // браузер отказал в захвате курсора
  lockWorked: false,      // захват хоть раз удался (значит он вообще доступен)
  fsTried: false,         // полный экран уже пробовали включить
  userTouched: false,     // игрок уже кликнул в игровое поле
  winMode: false,         // запущено в отдельном окне (?win=1)
  mouseX: 0, mouseY: 0,    // позиция курсора (HUD, отладка)
  mouseInside: false,      // курсор внутри окна игры
  lookPrimed: false,       // первое движение мыши после старта — только запоминаем
  /* Доворот у края включается только после того, как курсор побывал в
     центральной зоне. Иначе сразу после старта (курсор остался у края после
     клика по кнопке) камера сама уезжала вбок. */
  edgeArmed: false,
  frames: 0,              // всего отрисовано кадров
  framesNoY: 0,           // кадров подряд без изменения Y
  lastFrame: 0,

  /* ---- бой ---- */
  hp: PLAYER_HP,
  maxHp: PLAYER_HP,
  kills: 0,
  score: 0,
  ammo: WEAPON.mag,
  reserve: WEAPON.reserve,
  reloading: false,
  reloadT: 0,
  fireCd: 0,
  firing: false,
  firePressed: false,
  gunKick: 0,
  viewmodel: null,
  spread: WEAPON.spread,
  recoil: 0,              // визуальный подброс камеры (рад)
  shake: 0,               // тряска камеры при попадании
  coyote: 0,
  jumpBuf: 0,
  jumpPressed: false,
  stepAllowed: false,
  bobT: 0,
  bobRoll: 0,
  bobAmp: 0,
  hurtCd: 0,

  /* ---- волны ---- */
  wave: 1,
  waveState: 'fight',     // fight | break
  waveT: 0,
  fx: []                  // трассеры/вспышки/частицы
};

/* запущено в отдельном окне (открыли кнопкой «ОТКРЫТЬ ОТДЕЛЬНОЕ ОКНО»)? */
G.winMode = /[?&]win=1/.test(location.search);

/* ---------- ИНВЕНТАРЬ ИЗ МЕНЮ ---------- */
function loadInventory() {
  try {
    const raw = localStorage.getItem('gs_inventory');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch (e) { /* ignore */ }
  // fallback — если инвентарь пуст, даём стартовый набор мемов
  return [
    { name: 'okaK',    img: 'memes/okak.png',    rar: 'common' },
    { name: 'okaK',    img: 'memes/okak.png',    rar: 'common' },
    { name: 'СКЕБОБ',  img: 'memes/skebob.png',  rar: 'epic'   },
    { name: 'КРИК',    img: 'memes/screamer.png',rar: 'rare'   },
    { name: 'СКЕБОБ',  img: 'memes/skebob.png',  rar: 'gold'   }
  ];
}

/* ============================================================
   ИНИЦИАЛИЗАЦИЯ СЦЕНЫ
   ============================================================ */
function initScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b6e0);
  scene.fog = new THREE.Fog(0x9cc4e4, 55, 135);

  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 400);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  /* свет */
  scene.add(new THREE.HemisphereLight(0xbfd8f0, 0x4a5c42, 0.85));
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.05);
  sun.position.set(38, 60, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 62;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;   sun.shadow.camera.bottom = -d;
  sun.shadow.camera.far = 190;
  scene.add(sun);

  G.scene = scene; G.camera = camera; G.renderer = renderer;
  G.clock = new THREE.Clock();

  /* потеря/восстановление WebGL-контекста.
     Потеря контекста — НЕ повод выбрасывать игрока в меню:
     ставим паузу и тихо восстанавливаемся. */
  let ctxLostCount = 0;
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    ctxLostCount++;
    Health.lost = true;
    G.running = false;
    G.paused = true;
    console.warn('[GOOSE] WebGL-контекст потерян, попытка восстановления №' + ctxLostCount);
    if (ctxLostCount >= 3) {
      fail('ГРАФИКА ОТКЛЮЧИЛАСЬ', 'Видеоустройство потеряло WebGL-контекст.',
        'Обычно помогает перезагрузка страницы или закрытие тяжёлых вкладок.');
    }
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    Health.lost = false;
    G.running = true;
    G.paused = false;
    G.clock.getDelta();   /* сбрасываем накопленную дельту — иначе рывок физики */
    G.vel.y = 0;
    console.info('[GOOSE] WebGL-контекст восстановлен');
  });

  /* Оружие в руках. Камеру добавляем в сцену: дети камеры рисуются,
     только если она сама в графе сцены. */
  scene.add(camera);
  buildViewModel();

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

/* Простой вьюмодель ПП: несколько коробок в правом нижнем углу кадра.
   Живёт в системе координат камеры, поэтому всегда «в руках». */
function buildViewModel() {
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x24272c });
  const mid = new THREE.MeshLambertMaterial({ color: 0x353a42 });
  const accent = new THREE.MeshLambertMaterial({ color: 0x8a6f42 });

  const add = (geo, mat, x, y, z, rx) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    g.add(m);
    return m;
  };

  /* ствольная коробка */
  add(new THREE.BoxGeometry(0.085, 0.105, 0.42), dark, 0, 0, 0);
  /* ствол */
  add(new THREE.BoxGeometry(0.045, 0.045, 0.26), mid, 0, 0.015, -0.31);
  /* дуло */
  add(new THREE.BoxGeometry(0.06, 0.06, 0.05), dark, 0, 0.015, -0.45);
  /* магазин */
  add(new THREE.BoxGeometry(0.055, 0.19, 0.085), mid, 0, -0.135, 0.03, 0.18);
  /* рукоять */
  add(new THREE.BoxGeometry(0.055, 0.13, 0.07), dark, 0, -0.105, 0.16, -0.25);
  /* приклад */
  add(new THREE.BoxGeometry(0.05, 0.075, 0.16), accent, 0, -0.01, 0.28);
  /* прицельная планка */
  add(new THREE.BoxGeometry(0.02, 0.03, 0.12), mid, 0, 0.068, -0.06);

  /* масштаб подобран так, чтобы оружие занимало правый нижний угол,
     а не пол-экрана (камера без отдельного FOV для вьюмодели) */
  g.scale.setScalar(0.45);
  g.position.set(0.29, -0.31, -0.7);
  g.rotation.y = -0.06;
  G.camera.add(g);
  G.viewmodel = g;
}

/* ---------- ХЕЛПЕРЫ ---------- */
const $ = (sel) => document.querySelector(sel);

function box(w, h, d, color, x, y, z, opts) {
  opts = opts || {};
  const mat = new THREE.MeshLambertMaterial({ color: color });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = opts.noShadow !== true;
  m.receiveShadow = true;
  G.scene.add(m);
  if (opts.collide !== false) {
    G.colliders.push({
      min: { x: x - w / 2, y: y - h / 2, z: z - d / 2 },
      max: { x: x + w / 2, y: y + h / 2, z: z + d / 2 }
    });
  }
  return m;
}

function flatBox(w, d, color, x, y, z, collide) {
  return box(w, 0.1, d, color, x, y, z, { collide: collide !== false, noShadow: true });
}

/* ============================================================
   КАРТА
   ============================================================ */
function buildGround() {
  /* Трава — 80x80, но с НАСТОЯЩИМИ дырами над входами в подземелье.
     Раньше земля была сплошной плоскостью, а дыры рисовались чёрными
     плитками на 2 см выше: на расстоянии плитка проигрывала z-борьбу
     траве, и вход выглядел заросшим. Теперь это вырез в геометрии. */
  const shape = new THREE.Shape();
  shape.moveTo(-HALF, -HALF);
  shape.lineTo(HALF, -HALF);
  shape.lineTo(HALF, HALF);
  shape.lineTo(-HALF, HALF);
  shape.lineTo(-HALF, -HALF);
  /* Shape живёт в XY, после поворота на -90° по X: world z = -shape.y */
  SHAFTS.forEach((s) => {
    const p = new THREE.Path();
    const y0 = -(s.z - s.hd), y1 = -(s.z + s.hd);
    p.moveTo(s.x - s.hw, y0);
    p.lineTo(s.x - s.hw, y1);
    p.lineTo(s.x + s.hw, y1);
    p.lineTo(s.x + s.hw, y0);
    p.lineTo(s.x - s.hw, y0);
    shape.holes.push(p);
  });

  const gMat = new THREE.MeshLambertMaterial({ color: 0x5c8a3c, side: THREE.DoubleSide });
  const ground = new THREE.Mesh(new THREE.ShapeGeometry(shape), gMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  G.scene.add(ground);

  /* подземная плита бункера (пол на Y=-5) — ровно под комнату 28x24,
     иначе она залезала под коридоры сети и мерцала с их плитами */
  const bMat = new THREE.MeshLambertMaterial({ color: 0x3a3d42 });
  const bunkerFloor = new THREE.Mesh(new THREE.PlaneGeometry(28, 24), bMat);
  bunkerFloor.rotation.x = -Math.PI / 2;
  bunkerFloor.position.set(0, BUNKER_Y, 0);
  bunkerFloor.receiveShadow = true;
  G.scene.add(bunkerFloor);

  /* границы арены — забор */
  const wallCol = 0x6b5b47;
  box(ARENA, 6, 0.6, wallCol, 0, 3, -HALF);
  box(ARENA, 6, 0.6, wallCol, 0, 3,  HALF);
  box(0.6, 6, ARENA, wallCol, -HALF, 3, 0);
  box(0.6, 6, ARENA, wallCol,  HALF, 3, 0);
}

function buildTrees() {
  /* Позиции подобраны так, чтобы дерево НЕ попадало внутрь зданий:
     раньше два дерева стояли в домах 1 и 2. Вертикальных палок у деревьев
     больше нет — все палки стали плоскими наклонными балками (BEAM_LIST). */
  const spots = [
    [-34, -14], [-14, 28], [30, -8], [30, 20], [-32, 12],
    [-8, -30], [18, 33], [34, -30], [-34, -32], [8, 20]
  ];

  /* Дом считается занятым, если точка внутри его пятна + запас 1 м */
  const blocked = (x, z) => (G.buildings || []).some((b) =>
    Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1);

  spots.forEach(([x, z]) => {
    /* подстраховка: пропускаем точку, если она всё же в здании */
    if (blocked(x, z) || blocked(x + 2.2, z + 0.6)) return;

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.42, 4.2, 8),
      new THREE.MeshLambertMaterial({ color: 0x5a4630 })
    );
    trunk.position.set(x, 2.1, z);
    trunk.castShadow = true; trunk.receiveShadow = true;
    G.scene.add(trunk);

    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(2.4, 4.6, 9),
      new THREE.MeshLambertMaterial({ color: 0x3f6b2c })
    );
    crown.position.set(x, 5.6, z);
    crown.castShadow = true;
    G.scene.add(crown);
  });
}

function buildGrass() {
  /* внутрь зданий траву и камни не ставим: дом 1 теперь полый,
     и случайный камень оказывался ровно в люке */
  const inHouse = (x, z) => (G.buildings || []).some((b) =>
    Math.abs(x - b.x) < b.w / 2 + 0.8 && Math.abs(z - b.z) < b.d / 2 + 0.8);
  /* в проёмах входов и на рампах травы и камней быть не должно:
     раньше куст мог вырасти прямо в дыре и «закрыть» вход */
  const inHole = (x, z) => {
    for (let i = 0; i < SHAFTS.length; i++) {
      const s = SHAFTS[i];
      if (Math.abs(x - s.x) < s.hw + 2.5 && Math.abs(z - s.z) < s.hd + 2.5) return true;
    }
    return rampAt(x, z) !== null;
  };

  /* декоративные кусты травы */
  const gMat = new THREE.MeshLambertMaterial({ color: 0x6f9c46 });
  const geo = new THREE.ConeGeometry(0.32, 1.1, 5);
  const inst = new THREE.InstancedMesh(geo, gMat, 420);
  const m4 = new THREE.Matrix4();
  let n = 0;
  for (let i = 0; i < 420; i++) {
    const x = (Math.random() - 0.5) * (ARENA - 6);
    const z = (Math.random() - 0.5) * (ARENA - 6);
    if (inHouse(x, z) || inHole(x, z)) continue;
    m4.makeTranslation(x, 0.55, z);
    inst.setMatrixAt(n++, m4);
  }
  inst.count = n;
  inst.castShadow = false;
  G.scene.add(inst);

  /* камни */
  const rMat = new THREE.MeshLambertMaterial({ color: 0x8a8d92 });
  for (let i = 0; i < 26; i++) {
    const s = 0.4 + Math.random() * 0.9;
    const x = (Math.random() - 0.5) * (ARENA - 8);
    const z = (Math.random() - 0.5) * (ARENA - 8);
    if (inHouse(x, z) || inHole(x, z)) continue;
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s), rMat);
    r.position.set(x, s * 0.5, z);
    r.rotation.set(Math.random(), Math.random(), Math.random());
    r.castShadow = true; r.receiveShadow = true;
    G.scene.add(r);
  }
}

/* ---------- УКРЫТИЯ ---------- */
/* Ящики и мешки с песком: за ними прячешься от мемов, и они же ломают
   прямые линии обстрела. Ставим только в открытых местах — не на входах
   в подземелье, не на рампах и не на путях балок. */
function buildCover() {
  const crateCol = 0x8a6a3e;
  const sandCol = 0x9b9076;

  const crates = [
    [6, 8], [7.3, 8], [6.6, 9.2],
    [-8, -6], [-8, -4.7],
    [10, -8], [11.3, -7.4],
    [-12, 12], [-13.3, 12],
    [26, -4], [26, -2.7],
    [-26, 6], [-27.3, 6],
    [0, 26], [1.3, 26],
    [-18, 4], [-19.3, 4]
  ];
  crates.forEach(([x, z]) => box(1.1, 1.1, 1.1, crateCol, x, 0.55, z));

  /* мешки с песком: длинные низкие стены, 1 м — не перешагнуть */
  const walls = [
    [4, -14, 3.2, 0.6],
    [-6, 16, 3.2, 0.6],
    [24, 10, 0.6, 3.2],
    [-24, -8, 0.6, 3.2],
    [12, 4, 2.6, 0.6],
    [-14, -4, 0.6, 2.6]
  ];
  walls.forEach(([x, z, w, d]) => {
    box(w, 1.0, d, sandCol, x, 0.5, z);
    /* верхний ряд мешков — только вид, коллайдер уже есть */
    const n = Math.max(2, Math.round(Math.max(w, d) / 0.9));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      const bag = new THREE.Mesh(
        new THREE.BoxGeometry(w > d ? w / n - 0.06 : w + 0.08, 0.22, d > w ? d / n - 0.06 : d + 0.08),
        new THREE.MeshLambertMaterial({ color: 0xada189 })
      );
      bag.position.set(x + (w > d ? t * w : 0), 1.11, z + (d > w ? t * d : 0));
      bag.castShadow = true;
      G.scene.add(bag);
    }
  });

  /* морские контейнеры: высокие глухие укрытия, делят арену на сектора */
  const boxes = [
    [14, -6, 6, 2.6, 0xa8503c],
    [-14, -10, 2.6, 6, 0x3f6b8a],
    [28, 28, 6, 2.6, 0x6b7a4a]
  ];
  boxes.forEach(([x, z, w, d, col]) => {
    box(w, 2.6, d, col, x, 1.3, z);
    /* рёбра жёсткости — тонкие полоски по бокам */
    const ribMat = new THREE.MeshLambertMaterial({ color: 0x2f3338 });
    for (let i = -2; i <= 2; i++) {
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(w > d ? 0.12 : w + 0.06, 2.3, d > w ? 0.12 : d + 0.06),
        ribMat
      );
      rib.position.set(
        x + (w > d ? (i / 2.5) * (w / 2) : 0),
        1.3,
        z + (d > w ? (i / 2.5) * (d / 2) : 0)
      );
      G.scene.add(rib);
    }
  });
}


/* ---------- БАЛКИ ---------- */
/* ПЛОСКАЯ НАКЛОННАЯ БАЛКА вместо вертикального шеста: плоская доска,
   поставленная под углом к горизонту. По ней ХОДЯТ обычной ходьбой с
   гравитацией — не лезут вертикально вверх под 90°. Сошёл вбок или
   вышел за конец — падаешь. (x, z) — нижний конец у земли,
   (dirX, dirZ) — направление подъёма, topY — высота верхнего конца. */
const BEAM_ANGLE = 40 * Math.PI / 180;   // наклон к горизонту
const BEAM_W = 0.8;                      // ширина доски
const BEAM_T = 0.14;                     // толщина доски

function addBeam(x, z, topY, dirX, dirZ) {
  const alpha = BEAM_ANGLE;
  const run = topY / Math.tan(alpha);    // горизонтальный пролёт
  const len = Math.hypot(run, topY);
  const dl = Math.hypot(dirX, dirZ) || 1;
  const dx = dirX / dl, dz = dirZ / dl;

  const g = new THREE.Group();
  g.position.set(x + dx * run / 2, topY / 2, z + dz * run / 2);
  g.rotation.y = Math.atan2(dx, dz);

  /* доска: длина вдоль локальной Z, наклон — поворот вокруг X на -alpha */
  const plank = new THREE.Mesh(
    new THREE.BoxGeometry(BEAM_W, BEAM_T, len),
    new THREE.MeshLambertMaterial({ color: 0xc9ab74 })
  );
  plank.rotation.x = -alpha;
  plank.castShadow = true; plank.receiveShadow = true;
  g.add(plank);

  /* поперечины-настил: читается как дорожка и не даёт доске выглядеть
     гладкой гладкой плитой */
  const slatMat = new THREE.MeshLambertMaterial({ color: 0x8a6f42 });
  const sinA = Math.sin(alpha), cosA = Math.cos(alpha);
  for (let s = 0.9; s < len - 0.4; s += 1.1) {
    const t = -len / 2 + s;
    const sl = new THREE.Mesh(new THREE.BoxGeometry(BEAM_W + 0.12, 0.06, 0.14), slatMat);
    sl.position.set(0, sinA * t + 0.1 * cosA, cosA * t - 0.1 * sinA);
    sl.rotation.x = -alpha;
    g.add(sl);
  }
  G.scene.add(g);

  /* опора под верхним концом — доска не висит в воздухе */
  const post = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, topY, 0.24),
    new THREE.MeshLambertMaterial({ color: 0x9a7b52 })
  );
  post.position.set(x + dx * run, topY / 2, z + dz * run);
  post.castShadow = true;
  G.scene.add(post);
  /* Коллизии у опоры НЕТ: иначе она упирала игрока в стену/крышу
     ровно перед верхом балки и не давала взойти на крышу. Палка —
     чисто декоративная опора, по ней ходят через groundAt(). */

  /* Пол балки: узкая полоса (чуть шире радиуса игрока).
     За её пределами groundAt() отдаёт землю — то есть игрок падает. */
  BEAMS.push({
    x0: x, z0: z, dx: dx, dz: dz, run: run, top: topY,
    hw: 0.42, lip: BEAM_T / 2
  });
}

/* Лестница. rotY — поворот вокруг своей оси: лестницы у домов
   разворачиваем «лицом» к стене дома (стойки параллельны стене). */
function addLadder(x, z, baseY, topY, rotY) {
  const h = topY - baseY;
  const mat = new THREE.MeshLambertMaterial({ color: 0xb08c56 });
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY || 0;
  /* две стойки */
  [-0.42, 0.42].forEach((off) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, h, 0.1), mat);
    rail.position.set(off, baseY + h / 2, 0);
    rail.castShadow = true;
    g.add(rail);
  });
  /* ступени */
  const steps = Math.floor(h / 0.42);
  for (let i = 1; i <= steps; i++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.07, 0.12), mat);
    st.position.set(0, baseY + i * (h / (steps + 1)), 0);
    st.castShadow = true;
    g.add(st);
  }
  G.scene.add(g);
  G.climbables.push({ x: x, z: z, top: topY, base: baseY, r: 1.35 });
}

/* ---------- ЗДАНИЯ ---------- */
function buildBuildings() {
  /* --- Дом 1: низкий, широкий (H=5). ПОЛЫЙ — внутри тайный люк в подземелье --- */
  const b1 = { x: -22, z: -20, w: 12, d: 10, h: 5 };
  makeBuilding(b1, 0xb9a88e, 0x8a7a62, true);

  /* --- Дом 2: средний (H=8) --- */
  const b2 = { x: 20, z: -18, w: 10, d: 10, h: 8 };
  makeBuilding(b2, 0xa89b86, 0x7d7264);

  /* --- Дом 3: высокий (H=12) --- */
  const b3 = { x: 18, z: 20, w: 11, d: 11, h: 12 };
  makeBuilding(b3, 0x9c8f7b, 0x6f6558);

  /* Палки и лестницы к крышам.
     rotY = Math.PI/2 — лестница у западной/восточной стены дома:
     её полотно разворачивается ВДОЛЬ стены (лицом к дому), а не
     торчком поперёк, как было раньше. */
  const R = Math.PI / 2;
  addLadder(b1.x - b1.w / 2 - 0.6, b1.z, 0, b1.h, R);
  addLadder(b2.x + b2.w / 2 + 0.6, b2.z + 2.2, 0, b2.h, R);
  addLadder(b3.x - b3.w / 2 - 0.6, b3.z - 3, 0, b3.h, R);
  addLadder(b3.x + 3.2, b3.z + b3.d / 2 + 0.6, 0, b3.h, 0);

  /* Плоские наклонные балки. Вместо вертикальных шестов: по ним идут,
     а не лезут под 90°. [низ X, низ Z, высота верха, напр. X, напр. Z] */
  const BEAM_LIST = [
    /* у домов: верх выходит ПОД крышу (topY = h + 0.04 → поверхность
       балки совпадает с верхом крыши h + 0.11), игрок заходит на крышу
       прямо с балки, без ступеньки и без упора в стену */
    [-15.7, -28.4, 5.04,  0,  1],   /* дом 1, вдоль вост. стены */
    [14.4,  -29.3, 8.04,  0,  1],   /* дом 2, вдоль зап. стены (снаружи) */
    [12.0,  11.9, 12.04, 0,  1],   /* дом 3, вдоль зап. стены (снаружи) */
    /* на открытых местах */
    [-6,  -27, 11, 0,  1],
    [27,  12,  10, 0, -1],
    [-31, 25,  9,  1,  0],
    [11,  -31, 12, 0,  1],
    [-17, 7,   10, 1,  0]
  ];
  BEAM_LIST.forEach((b) => addBeam(b[0], b[1], b[2], b[3], b[4]));

  G.buildings = [b1, b2, b3];
}

function makeBuilding(b, wallCol, roofCol, hollow) {
  if (hollow) {
    /* ПОЛЫЙ дом: внутрь можно зайти через дверь, внутри — пол и
       тайный люк (вход №2 в подземелье). Стены — 4 полосы, крыша
       плоская, дверной проём в южной стене. */
    const T = 0.45, doorW = 2.8;
    box(b.w, b.h, T, wallCol, b.x, b.h / 2, b.z - b.d / 2);                 // север
    box((b.w - doorW) / 2, b.h, T, wallCol,
        b.x - (b.w + doorW) / 4, b.h / 2, b.z + b.d / 2);                   // юг-лево
    box((b.w - doorW) / 2, b.h, T, wallCol,
        b.x + (b.w + doorW) / 4, b.h / 2, b.z + b.d / 2);                   // юг-право
    box(T, b.h, b.d, wallCol, b.x - b.w / 2, b.h / 2, b.z);                 // запад
    box(T, b.h, b.d, wallCol, b.x + b.w / 2, b.h / 2, b.z);                 // восток
    flatBox(b.w + 0.8, b.d + 0.8, roofCol, b.x, b.h + 0.06, b.z, false);     // крыша
    /* Внутренний пол — косметика, чуть выше травы.
       Собираем из 4 полос ВОКРУГ люка: сплошная плита закрывала бы
       проём, и дыра в полу была бы не видна. */
    const fw = b.w - 0.9, fd = b.d - 0.9, fy = 0.06, hw = 1.7, hd = 1.7;
    const fx0 = b.x - fw / 2, fx1 = b.x + fw / 2;
    const fz0 = b.z - fd / 2, fz1 = b.z + fd / 2;
    const hx0 = HATCH.x - hw, hx1 = HATCH.x + hw;
    const hz0 = HATCH.z - hd, hz1 = HATCH.z + hd;
    const strip = (x0, x1, z0, z1) => {
      if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return;
      flatBox(x1 - x0, z1 - z0, 0x6e6b64, (x0 + x1) / 2, fy, (z0 + z1) / 2, false);
    };
    strip(fx0, fx1, fz0, hz0);   // северная полоса
    strip(fx0, fx1, hz1, fz1);   // южная полоса
    strip(fx0, hx0, hz0, hz1);   // западная
    strip(hx1, fx1, hz0, hz1);   // восточная
    /* окна-декор */
    const wMat = new THREE.MeshLambertMaterial({ color: 0x2b3a4a });
    for (let i = 0; i < Math.floor(b.h / 2.4); i++) {
      const wy = 1.6 + i * 2.4;
      if (wy > b.h - 0.8) break;
      [-1, 1].forEach((side) => {
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 0.12), wMat);
        win.position.set(b.x + side * (b.w / 2 + 0.02), wy, b.z - b.d / 4);
        G.scene.add(win);
        const win2 = win.clone();
        win2.position.z = b.z + b.d / 4;
        G.scene.add(win2);
      });
    }
    return;
  }

  /* стены */
  box(b.w, b.h, b.d, wallCol, b.x, b.h / 2, b.z, { collide: true });
  /* плоская крыша (чуть шире, создаёт карниз) */
  flatBox(b.w + 0.8, b.d + 0.8, roofCol, b.x, b.h + 0.06, b.z, false);
  /* окна-декор */
  const wMat = new THREE.MeshLambertMaterial({ color: 0x2b3a4a });
  for (let i = 0; i < Math.floor(b.h / 2.4); i++) {
    const wy = 1.6 + i * 2.4;
    if (wy > b.h - 0.8) break;
    [-1, 1].forEach((side) => {
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 0.12), wMat);
      win.position.set(b.x + side * (b.w / 2 + 0.02), wy, b.z - b.d / 4);
      G.scene.add(win);
      const win2 = win.clone();
      win2.position.z = b.z + b.d / 4;
      G.scene.add(win2);
    });
  }
}

/* ============================================================
   БУНКЕР (Y = -5) + 3 ВХОДА
   ============================================================ */
function buildBunker() {
  const BE = BUNKER_Y;               // -5
  const W = 28, D = 24, H = 4.4;     // комната: x∈[-14,14], z∈[-12,12]
  const T = 0.5;                     // толщина стен
  const wallCol = 0x4a4e55;

  /* ---- СТЕНЫ С ПРОЁМАМИ ПОД ТОННЕЛИ СЕТИ ----
     Проёмы: запад z∈[-2,2], восток z∈[-2,2], север x∈[-2,2], юг x∈[8,12].
     Через них подземные коридоры стыкуются с бункером. */
  /* север (z=-D/2), проём x∈[-2,2] */
  box(12, H, T, wallCol, -8, BE + H / 2, -D / 2);
  box(12, H, T, wallCol,  8, BE + H / 2, -D / 2);
  /* юг (z=+D/2), проём x∈[8,12] */
  box(22, H, T, wallCol, -3, BE + H / 2,  D / 2);
  box(2,  H, T, wallCol, 13, BE + H / 2,  D / 2);
  /* запад (x=-W/2), проём z∈[-2,2] */
  box(T, H, 10, wallCol, -W / 2, BE + H / 2, -7);
  box(T, H, 10, wallCol, -W / 2, BE + H / 2,  7);
  /* восток (x=+W/2), проём z∈[-2,2] */
  box(T, H, 10, wallCol,  W / 2, BE + H / 2, -7);
  box(T, H, 10, wallCol,  W / 2, BE + H / 2,  7);

  /* Перемычки над проёмами: потолок тоннеля на -2 ниже потолка
     бункера (-0.6), и без них в щели над входом просвечивало небо. */
  const lintelH = 1.4, lintelY = -2 + lintelH / 2;   // y от -2 до -0.6
  box(4, lintelH, T, wallCol, 0,  lintelY, -D / 2);  // север
  box(4, lintelH, T, wallCol, 10, lintelY,  D / 2);  // юг
  box(T, lintelH, 4, wallCol, -W / 2, lintelY, 0);   // запад
  box(T, lintelH, 4, wallCol,  W / 2, lintelY, 0);   // восток


  /* потолок с центральным проёмом x,z ∈ [-2,2] */

  /* потолок: 4 сегмента вокруг центрального проёма */
  const holeW = 4, holeD = 4;
  /* западная полоса */
  box(W / 2 - holeW / 2 - 6, 0.4, D, wallCol, -(W / 4 + holeW / 4 + 3), BE + H, 0, { collide: false, noShadow: true });
  /* восточная полоса */
  box(W / 2 - holeW / 2 - 6, 0.4, D, wallCol,  (W / 4 + holeW / 4 + 3), BE + H, 0, { collide: false, noShadow: true });
  /* северная полоса (у z-) */
  box(holeW + 12, 0.4, D / 2 - holeD / 2, wallCol, 0, BE + H, -(D / 4 + holeD / 4), { collide: false, noShadow: true });
  /* южная полоса */
  box(holeW + 12, 0.4, D / 2 - holeD / 2, wallCol, 0, BE + H,  (D / 4 + holeD / 4), { collide: false, noShadow: true });

  /* --- ВХОД 1: ГЛАВНЫЙ ЦЕНТРАЛЬНЫЙ СПУСК (вертикальная лестница вниз) --- */
  /* Дыры вырезаны в самой геометрии земли (см. buildGround), поэтому
     чёрных плиток поверх травы больше нет — вниз реально видно. */

  /* Обсадки над шахтой больше нет: она поднималась на 2.6 м и снаружи
     выглядела глухим чёрным ящиком. Теперь это честная дыра в земле
     с низким парапетом — вниз видно лестницу и пол бункера. */
  /* лестница вниз от земли до пола бункера (BE = -5) */
  addLadderDown(0, 0, 0, BE, 4.2);

  /* парапет шахты: три борта, юг с проходом 4 м — к лестнице можно
     подойти пешком, и мемы за игроком тоже спускаются в дыру */
  const railCol = 0x6b6f76;
  box(0.3, 0.7, 5.3, railCol, -2.5, 0.35, 0, { noShadow: true });
  box(0.3, 0.7, 5.3, railCol,  2.5, 0.35, 0, { noShadow: true });
  box(5.3, 0.7, 0.3, railCol, 0, 0.35, -2.5, { noShadow: true });
  box(0.65, 0.7, 0.3, railCol, -2.325, 0.35, 2.5, { noShadow: true });
  box(0.65, 0.7, 0.3, railCol,  2.325, 0.35, 2.5, { noShadow: true });

  /* --- ВХОД 2: ТАЙНЫЙ ЛЮК В ПОЛУ ДОМА 1 ---
     Дом 1 полый: входишь через дверь, внутри — люк в полу и
     вертикальная лестница на глубину -5 (в подземный коридор сети). */
  const hx = HATCH.x, hz = HATCH.z;
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.1, 1.5),
    new THREE.MeshLambertMaterial({ color: 0x6b5a3c })
  );
  lid.position.set(hx - 1.5, 0.14, hz);
  lid.rotation.z = 0.35;
  lid.castShadow = true;
  G.scene.add(lid);
  /* обсадка колодца люка (без коллизий — узкий колодец) */
  const hCol = 0x44484f;
  box(0.25, 2.6, 2.8, hCol, hx - 1.4, -0.8, hz, { collide: false, noShadow: true });
  box(0.25, 2.6, 2.8, hCol, hx + 1.4, -0.8, hz, { collide: false, noShadow: true });
  box(2.8, 2.6, 0.25, hCol, hx, -0.8, hz - 1.4, { collide: false, noShadow: true });
  box(2.8, 2.6, 0.25, hCol, hx, -0.8, hz + 1.4, { collide: false, noShadow: true });
  addLadderDown(hx, hz, 0, BE, 5);

  /* --- ВХОД 3: БОКОВОЙ ТРАНШЕЙНЫЙ ЛАЗ С ЗАПАДНОГО КРАЯ КАРТЫ ---
     Яма x∈[-36,-32] у края карты, лестница вниз, дальше — подземный
     коридор сети до западной стены бункера. Подземные стены ямы
     строит сетка (buildUnderground), здесь только борта над землёй. */
  const tx = -34, tz = 0;
  const trMat = new THREE.MeshLambertMaterial({ color: 0x5d4f3c });
  box(0.4, 3.6, 4.8, trMat, -36.3, -1.3, tz, { noShadow: true });
  box(4.8, 3.6, 0.4, trMat, tx, -1.3, tz - 2.3, { noShadow: true });
  box(4.8, 3.6, 0.4, trMat, tx, -1.3, tz + 2.3, { noShadow: true });
  addLadderDown(tx, tz, 0.1, BE, 5);

  /* --- ДЕКОР БУНКЕРА: лампы, ящики --- */
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd88a });
  for (let i = -2; i <= 2; i++) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), lampMat);
    lamp.position.set(i * 5.5, BE + H - 0.5, 0);
    G.scene.add(lamp);
    const pl = new THREE.PointLight(0xffd88a, 0.75, 16);
    pl.position.copy(lamp.position);
    G.scene.add(pl);
  }
  /* ящики */
  const crateMat = new THREE.MeshLambertMaterial({ color: 0x7a5f3a });
  [[-9, -7], [-8.4, -7], [10, 7], [10.8, 7], [-5, -9]].forEach(([cx, cz], i) => {
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), crateMat);
    c.position.set(cx, BE + 0.6 + (i % 2 ? 1.2 : 0), cz);
    c.castShadow = true; c.receiveShadow = true;
    G.scene.add(c);
    G.colliders.push({
      min: { x: cx - 0.6, y: BE + (i % 2 ? 0 : 0), z: cz - 0.6 },
      max: { x: cx + 0.6, y: BE + 1.2 + (i % 2 ? 1.2 : 0), z: cz + 0.6 }
    });
  });
}

/* лестница вниз (для спуска в бункер) */
function addLadderDown(x, z, baseY, bottomY, depth) {
  const h = Math.abs(baseY - bottomY);
  const mat = new THREE.MeshLambertMaterial({ color: 0xb08c56 });
  [-0.45, 0.45].forEach((off) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, h, 0.1), mat);
    rail.position.set(x + off, (baseY + bottomY) / 2, z);
    rail.castShadow = true;
    G.scene.add(rail);
  });
  const steps = Math.floor(h / 0.45);
  for (let i = 1; i <= steps; i++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.14), mat);
    st.position.set(x, baseY - i * (h / (steps + 1)), z);
    G.scene.add(st);
  }
  /* регистрируем как лазалку (работает вверх и вниз) */
  G.climbables.push({ x: x, z: z, top: Math.max(baseY, bottomY), bottom: Math.min(baseY, bottomY), r: 1.5, vertical: true });
}

/* ============================================================
   ПОДЗЕМНАЯ СЕТЬ ПРОХОДОВ (Y = -5)
   Разметка идёт по клеткам 2x2 м, геометрия собирается
   InstancedMesh'ами (пол/потолок/стены) — сотни стен в одном
   вызове отрисовки. Стены между двумя открытыми клетками не
   ставятся, поэтому перекрёстки и развилки получаются сами.
   ============================================================ */
function buildUnderground() {
  const nx = UG.i1 - UG.i0 + 1, nz = UG.j1 - UG.j0 + 1;
  const N = nx * nz;
  UG.open = new Uint8Array(N);
  UG.hub = new Uint8Array(N);
  UG.ceil = new Uint8Array(N).fill(1);
  UG.skip = new Uint8Array(N);

  /* ---- РАЗМЕТКА: где под землёй есть проход ---- */
  ugMark(-7, 6, -6, 5, true);               /* бункер (геометрию строит buildBunker) */
  ugMark(-18, -8, -1, 0);                   /* западный коридор */
  ugMark(-18, -17, -1, 0, false, true);     /*   проём ямы траншеи (входа 3) */
  ugMark(-12, -11, -10, -1);                /* ветка к люку дома 1 */
  ugMark(-11, -11, -10, -10, false, true);  /*   проём люка (входа 2) */
  ugMark(-14, -13, 0, 11);                  /* западная петля */
  ugMark(7, 17, -1, 0);                     /* восточная магистраль */
  ugMark(9, 10, -12, -1);                   /* ветка под дом 2 */
  ugMark(14, 15, 1, 12);                    /* юго-восточная ветка */
  ugMark(-1, 0, -12, -7);                   /* северный тоннель */
  ugMark(-14, 10, -13, -12);                /* северная поперечина */
  ugMark(4, 5, 6, 12);                      /* южный тоннель */
  ugMark(-14, 15, 11, 12);                  /* южная поперечина */
  /* стыки с рампами: проход открыт, но плита там своя */
  ugSkipMark(16, 17, 1, 1);                 /* рампа A → восточная магистраль */
  ugSkipMark(-3, -2, 13, 13);               /* рампа B → южная поперечина */

  /* ---- СБОР ГЕОМЕТРИИ ---- */
  const cells = [];
  for (let j = UG.j0; j <= UG.j1; j++) {
    for (let i = UG.i0; i <= UG.i1; i++) {
      if (ugOpen(i, j) && !ugHub(i, j) && !ugSkip(i, j)) cells.push({ i: i, j: j });
    }
  }
  const walls = [];
  cells.forEach((c) => {
    const i = c.i, j = c.j;
    const x0 = i * UG.cs, x1 = x0 + UG.cs, z0 = j * UG.cs, z1 = z0 + UG.cs;
    if (!ugOpen(i - 1, j)) walls.push({ x: x0, z: (z0 + z1) / 2, sx: 0.3, sz: UG.cs });
    if (!ugOpen(i + 1, j)) walls.push({ x: x1, z: (z0 + z1) / 2, sx: 0.3, sz: UG.cs });
    if (!ugOpen(i, j - 1)) walls.push({ x: (x0 + x1) / 2, z: z0, sx: UG.cs, sz: 0.3 });
    if (!ugOpen(i, j + 1)) walls.push({ x: (x0 + x1) / 2, z: z1, sx: UG.cs, sz: 0.3 });
  });

  const m4 = new THREE.Matrix4();
  const q0 = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();

  /* пол */
  const fMat = new THREE.MeshLambertMaterial({ color: 0x3a3d42 });
  const floor = new THREE.InstancedMesh(new THREE.BoxGeometry(UG.cs, 0.3, UG.cs), fMat, cells.length);
  cells.forEach((c, n) => {
    m4.makeTranslation(c.i * UG.cs + UG.cs / 2, BUNKER_Y - 0.15, c.j * UG.cs + UG.cs / 2);
    floor.setMatrixAt(n, m4);
  });
  floor.receiveShadow = true;
  G.scene.add(floor);

  /* потолок (кроме клеток под проёмами) */
  const cMat = new THREE.MeshLambertMaterial({ color: 0x3d4148 });
  const ceilCells = cells.filter((c) => UG.ceil[ugIdx(c.i, c.j)] === 1);
  const ceil = new THREE.InstancedMesh(new THREE.BoxGeometry(UG.cs, 0.3, UG.cs), cMat, ceilCells.length);
  ceilCells.forEach((c, n) => {
    m4.makeTranslation(c.i * UG.cs + UG.cs / 2, BUNKER_Y + 3.15, c.j * UG.cs + UG.cs / 2);
    ceil.setMatrixAt(n, m4);
  });
  G.scene.add(ceil);

  /* стены + коллайдеры (низ -5, верх -2) */
  const wMat = new THREE.MeshLambertMaterial({ color: 0x4a4e55 });
  const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wMat, walls.length);
  walls.forEach((w, n) => {
    v3.set(w.x, BUNKER_Y + 1.5, w.z);
    s3.set(w.sx, 3, w.sz);
    m4.compose(v3, q0, s3);
    wallMesh.setMatrixAt(n, m4);
    G.colliders.push({
      min: { x: w.x - w.sx / 2, y: BUNKER_Y, z: w.z - w.sz / 2 },
      max: { x: w.x + w.sx / 2, y: BUNKER_Y + 3, z: w.z + w.sz / 2 }
    });
  });
  wallMesh.receiveShadow = true;
  G.scene.add(wallMesh);

  /* лампы: светящиеся шарики под потолком вдоль коридоров */
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffcf7a });
  let li = 0;
  cells.forEach((c) => {
    if (UG.ceil[ugIdx(c.i, c.j)] !== 1) return;
    if (((c.i * 7 + c.j * 13) % 5) !== 0) return;
    const lp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), lampMat);
    lp.position.set(c.i * UG.cs + UG.cs / 2, BUNKER_Y + 2.75, c.j * UG.cs + UG.cs / 2);
    G.scene.add(lp);
    li++;
    /* точечные источники дорогие — ставим редко, остальное светится
       самосветящимися шариками */
    if (li % 14 === 0) {
      const pl = new THREE.PointLight(0xffcf7a, 0.5, 14);
      pl.position.copy(lp.position);
      G.scene.add(pl);
    }
  });

  /* ---- ПЛАВНЫЕ СПУСКИ (рампы) ---- */
  /* Ramp A: восточная магистраль → поверхность (x∈[32,36]) */
  addRamp(34, 0, 4, 2, 16, BUNKER_Y, 0, 'z');
  /* Ramp B: южная поперечина → поверхность (z∈[26,34]) */
  addRamp(-4, 0, 4, 26, 34, BUNKER_Y, 0, 'z');
}

/* Наклонный спуск: плита + борта + регистрация в RAMPS.
   axis 'z': подъём идёт вдоль Z (p0→p1), 'x': вдоль X. */
function addRamp(cx, cz, w, p0, p1, y0, y1, axis) {
  const len = Math.hypot(p1 - p0, y1 - y0);
  const ang = Math.atan2(y1 - y0, p1 - p0);
  const midP = (p0 + p1) / 2, midY = (y0 + y1) / 2;
  const mat = new THREE.MeshLambertMaterial({ color: 0x3a3d42 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, len), mat);
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x4a4e55 });
  const wallH = 4.6;

  if (axis === 'z') {
    slab.position.set(cx, midY, midP); slab.rotation.x = -ang;
    [-w / 2 - 0.2, w / 2 + 0.2].forEach((off) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, wallH, len), wallMat);
      m.position.set(cx + off, midY + 0.5, midP);
      m.rotation.x = -ang;
      m.receiveShadow = true;
      G.scene.add(m);
      G.colliders.push({
        min: { x: cx + off - 0.2, y: y0 - 0.6, z: Math.min(p0, p1) },
        max: { x: cx + off + 0.2, y: y1 + 1.2, z: Math.max(p0, p1) + 0.2 }
      });
    });
    RAMPS.push({ x: cx, z: midP, hw: w / 2, hd: Math.abs(p1 - p0) / 2, axis: 'z', p0: p0, p1: p1, y0: y0, y1: y1 });
  } else {
    slab.position.set(midP, midY, cz); slab.rotation.z = ang;
    [-w / 2 - 0.2, w / 2 + 0.2].forEach((off) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, wallH, 0.4), wallMat);
      m.position.set(midP, midY + 0.5, cz + off);
      m.rotation.z = ang;
      m.receiveShadow = true;
      G.scene.add(m);
      G.colliders.push({
        min: { x: Math.min(p0, p1), y: y0 - 0.6, z: cz + off - 0.2 },
        max: { x: Math.max(p0, p1) + 0.2, y: y1 + 1.2, z: cz + off + 0.2 }
      });
    });
    RAMPS.push({ x: midP, z: cz, hw: Math.abs(p1 - p0) / 2, hd: w / 2, axis: 'x', p0: p0, p1: p1, y0: y0, y1: y1 });
  }
  slab.receiveShadow = true;
  G.scene.add(slab);
}

/* ============================================================
   МЕМЫ-ВРАГИ
   Ровно четыре мема из memes/: okaK, СКЕБОБ, 6/7 и ИТАЛО-МЕМ.
   ============================================================ */
const MemeTex = {};

/* Заглушка на случай, если PNG не загрузился (file://, 404, CORS).
   ВАЖНО: спрайт с текстурой без картинки в WebGL полностью прозрачен —
   мемы «есть», но их не видно. Поэтому рисуем карточку на canvas. */
function fallbackMemeCanvas(def) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const rs = RARITY_SPEED[def.rar] || RARITY_SPEED.common;
  const grd = g.createLinearGradient(0, 0, S, S);
  grd.addColorStop(0, '#171a20');
  grd.addColorStop(1, rs.color);
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  g.strokeStyle = '#0b0d10'; g.lineWidth = 12; g.strokeRect(6, 6, S - 12, S - 12);
  /* глаза и рот — чтобы силуэт читался как «мем», а не как квадрат */
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(88, 96, 27, 0, 7); g.fill();
  g.beginPath(); g.arc(168, 96, 27, 0, 7); g.fill();
  g.fillStyle = '#000000';
  g.beginPath(); g.arc(96, 101, 12, 0, 7); g.fill();
  g.beginPath(); g.arc(160, 101, 12, 0, 7); g.fill();
  g.beginPath(); g.ellipse(128, 172, 48, 27, 0, 0, 7); g.fill();
  g.fillStyle = '#ffffff';
  g.font = 'bold 30px sans-serif';
  g.textAlign = 'center';
  g.fillText(def.name, 128, 232);
  return c;
}

/* Текстура мема.
   1) window.MEME_IMG (memes/data.js) — те самые картинки пользователя в base64.
      Работает даже когда PNG не отдаются: file://, 404, 502 у превью-сервера.
   2) memes/*.png — если встроенной нет.
   3) canvas-заглушка — если и файл не пришёл (иначе спрайт прозрачный). */
function memeTexture(def) {
  if (MemeTex[def.key]) return MemeTex[def.key];
  Health.texTotal++;

  const emb = (typeof window !== 'undefined' && window.MEME_IMG) ? window.MEME_IMG[def.key] : null;
  if (emb) {
    const img = new Image();
    const tex = new THREE.Texture(img);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    img.onload = () => {
      Health.textures++;
      tex.needsUpdate = true;
    };
    img.onerror = () => {
      console.warn('[GOOSE] встроенная картинка битая, рисую заглушку:', def.key);
      tex.image = fallbackMemeCanvas(def);
      tex.needsUpdate = true;
    };
    img.src = emb;
    MemeTex[def.key] = tex;
    return tex;
  }

  const tex = new THREE.TextureLoader().load(
    def.img,
    () => { Health.textures++; },
    undefined,
    () => {
      console.warn('[GOOSE] текстура не загрузилась, рисую заглушку:', def.img);
      tex.image = fallbackMemeCanvas(def);
      tex.needsUpdate = true;
    }
  );
  tex.minFilter = THREE.LinearFilter;
  MemeTex[def.key] = tex;
  return tex;
}

/* точка спавна: кольцо вокруг центра, не в доме и не рядом с игроком */
function pickSpawnPoint() {
  const px = G.camera ? G.camera.position.x : 0;
  const pz = G.camera ? G.camera.position.z : 0;
  for (let i = 0; i < 50; i++) {
    /* 15–24 м ВОКРУГ ИГРОКА: раньше радиус откладывался от центра карты,
       и мемы могли появиться за спиной или в другом конце арены.
       Сейчас — в секторе ±75° по направлению взгляда, чтобы их было видно
       сразу, а не после разворота на 180°. */
    const r = 15 + Math.random() * 9;
    const fwd = G.yaw + Math.PI;
    const ang = fwd + (Math.random() - 0.5) * 2.6;
    const x = px + Math.sin(ang) * r, z = pz + Math.cos(ang) * r;
    if (Math.abs(x) > HALF - 4 || Math.abs(z) > HALF - 4) continue;
    /* не спавним в дыре входа и на рампе — иначе мем сразу провалится */
    if (inShaft(x, z) || rampAt(x, z) !== null) continue;
    const inB = (G.buildings || []).some((b) =>
      Math.abs(x - b.x) < b.w / 2 + 2 && Math.abs(z - b.z) < b.d / 2 + 2);
    if (inB) continue;
    /* не спавним в укрытии/стене */
    let inProp = false;
    for (let k = 0; k < G.colliders.length; k++) {
      const c = G.colliders[k];
      if (c.max.y < 0.2) continue;
      if (x > c.min.x - 1 && x < c.max.x + 1 &&
          z > c.min.z - 1 && z < c.max.z + 1) { inProp = true; break; }
    }
    if (inProp) continue;
    if (Math.hypot(x - px, z - pz) < 13) continue;
    return { x: x, z: z };
  }
  return { x: 0, z: 30 };
}

/* выбор типа мема: чем дальше волна, тем чаще сильные */
function pickMemeDef(n) {
  const w = {
    common: Math.max(6, 55 - n * 6),
    rare: 26,
    epic: 14 + n * 2,
    gold: 3 + n * 1.2
  };
  let total = 0;
  MEME_DEFS.forEach((d) => { total += w[d.rar] || 1; });
  let r = Math.random() * total;
  for (let i = 0; i < MEME_DEFS.length; i++) {
    const d = MEME_DEFS[i];
    r -= (w[d.rar] || 1);
    if (r <= 0) return d;
  }
  return MEME_DEFS[0];
}

function makeMeme(def, x, z, hpMul) {
  const rs = RARITY_SPEED[def.rar] || RARITY_SPEED.common;
  const H = 1.5 * def.sc;
  const mat = new THREE.MeshBasicMaterial({
    map: memeTexture(def), side: THREE.DoubleSide, transparent: true
  });
  const sprite = new THREE.Mesh(new THREE.PlaneGeometry(H, H), mat);
  sprite.position.set(x, H / 2, z);
  G.scene.add(sprite);

  /* Метка редкости под спрайтом.
     ВАЖНО: спрайт мема прозрачный и рисуется в transparent-проходе ПОСЛЕ
     непрозрачных объектов, поэтому полоски обязаны быть тоже transparent,
     иначе спрайт перекрывает их собой. */
  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.16),
    new THREE.MeshBasicMaterial({
      color: rs.color, side: THREE.DoubleSide,
      transparent: true, depthTest: true, depthWrite: false
    })
  );
  badge.position.set(0, -H / 2 - 0.12, 0.02);
  badge.renderOrder = 7;
  sprite.add(badge);

  /* полоска здоровья над мемом */
  const barBg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.15, 0.11),
    new THREE.MeshBasicMaterial({
      color: 0x0e1014, transparent: true, opacity: 0.82,
      depthTest: true, depthWrite: false
    })
  );
  barBg.position.set(0, H / 2 + 0.18, 0.02);
  barBg.renderOrder = 8;
  sprite.add(barBg);
  const barFill = new THREE.Mesh(
    new THREE.PlaneGeometry(1.06, 0.06),
    new THREE.MeshBasicMaterial({
      color: rs.color, transparent: true, depthTest: true, depthWrite: false
    })
  );
  barFill.position.set(0, H / 2 + 0.18, 0.03);
  barFill.renderOrder = 9;
  sprite.add(barFill);

  const hp = Math.round(def.hp * hpMul);
  const m = {
    obj: sprite,
    def: def,
    hp: hp,
    maxHp: hp,
    dmg: def.dmg + Math.floor((hpMul - 1) * 6),
    speed: def.sp,
    reward: def.reward,
    rar: def.rar,
    label: rs.label,
    color: rs.color,
    name: def.name,
    y: H / 2,
    h: H,
    seed: Math.random() * 6.28,
    path: null, pathI: 0, repathT: 0, stuckT: 0,
    atkCd: 0, kx: 0, kz: 0, dying: 0, dead: false,
    barFill: barFill, baseScale: 1
  };
  G.memes.push(m);
  return m;
}

/* новая волна */
function startWave(n) {
  /* убираем остатки предыдущей волны */
  G.memes.forEach((m) => {
    if (m.obj && m.obj.parent) G.scene.remove(m.obj);
  });
  G.memes.length = 0;

  G.wave = n;
  G.waveState = 'fight';
  const count = waveCount(n);
  const hpMul = 1 + 0.12 * (n - 1);
  for (let i = 0; i < count; i++) {
    const def = pickMemeDef(n);
    const p = pickSpawnPoint();
    makeMeme(def, p.x, p.z, hpMul);
  }
  showWaveBanner(n);
}

/* точка входа при загрузке */
function spawnMemes() {
  /* прогреваем текстуры, чтобы первый спавн не мигал пустым спрайтом */
  MEME_DEFS.forEach((d) => memeTexture(d));
  startWave(1);
}

/* баннер волны */
function showWaveBanner(n) {
  const el = document.getElementById('waveBanner');
  if (!el) return;
  el.innerHTML = 'ВОЛНА <b>' + n + '</b><span>МЕМОВ: ' + waveCount(n) + '</span>';
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- ИИ МЕМА: ДВА СЛОЯ + ПОЛЕ ПУТИ ---------- */
/* Поверхность и подземелье — две сетки 1x1 м. Раз в 0.3 с строим поле
   расстояний до игрока (BFS по 8 направлениям), мем просто идёт по
   градиенту. Слои связаны тремя входами (спуск) и двумя рампами
   (подъём) — поэтому мем может упасть в подземный переход и вернуться. */
const AI = {
  navCell: 1,
  min: -HALF,
  N: 0,
  total: 0,
  nodes: 0,
  grid: [null, null],      /* 0 = проходимо, 1 = стена */
  inMap: null,             /* входящие рёбра: inMap[to] = [{from, cost, via}] */
  dist: null,
  nextPt: null,
  fieldT: 0,
  fieldTick: 0.3
};

const NAV_DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1]
];

function navIdx(x, z, layer) {
  const gx = Math.floor((x - AI.min) / AI.navCell);
  const gz = Math.floor((z - AI.min) / AI.navCell);
  if (gx < 0 || gz < 0 || gx >= AI.N || gz >= AI.N) return -1;
  return layer * AI.total + gz * AI.N + gx;
}

function navWorld(i) {
  const gz = Math.floor(i / AI.N), gx = i % AI.N;
  return { x: AI.min + (gx + 0.5) * AI.navCell, z: AI.min + (gz + 0.5) * AI.navCell };
}

/* ближайшая проходимая клетка слоя — из дыры или из стены тоже */
function navNearestOpen(layer, x, z, maxR) {
  const start = navIdx(x, z, layer);
  if (start < 0) return -1;
  const base = layer * AI.total;
  const cell0 = start - base;
  const g = AI.grid[layer];
  if (g[cell0] === 0) return start;

  const N = AI.N, total = AI.total;
  const seen = new Uint8Array(total);
  const q = [cell0];
  seen[cell0] = 1;
  const sx = cell0 % N, sz = (cell0 / N) | 0;
  const lim = (maxR || 8) * (maxR || 8);

  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    const cx = cur % N, cz = (cur / N) | 0;
    if (g[cur] === 0) return base + cur;
    const ddx = cx - sx, ddz = cz - sz;
    if (ddx * ddx + ddz * ddz > lim) continue;
    for (let k = 0; k < 4; k++) {
      const nx = cx + NAV_DIRS[k][0], nz = cz + NAV_DIRS[k][1];
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const ni = nz * N + nx;
      if (seen[ni]) continue;
      seen[ni] = 1; q.push(ni);
    }
  }
  return -1;
}

function addNavLink(from, to, cost, via) {
  if (!AI.inMap[to]) AI.inMap[to] = [];
  AI.inMap[to].push({ from: from, cost: cost, via: via });
}

/* сетка по коллайдерам: слой 0 — полоса 0..1.85, слой 1 — бункер */
function buildNavGrid() {
  const cs = AI.navCell;
  AI.N = Math.ceil(ARENA / cs);
  AI.total = AI.N * AI.N;
  AI.nodes = AI.total * 2;
  AI.grid = [new Uint8Array(AI.total), new Uint8Array(AI.total)];
  AI.dist = new Int32Array(AI.nodes);
  AI.nextPt = new Array(AI.nodes).fill(null);
  AI.inMap = new Array(AI.nodes).fill(null);

  const N = AI.N;
  const hit = (x0, x1, z0, z1, c) =>
    x1 > c.min.x && x0 < c.max.x && z1 > c.min.z && z0 < c.max.z;

  for (let gz = 0; gz < N; gz++) {
    for (let gx = 0; gx < N; gx++) {
      const x0 = AI.min + gx * cs, x1 = x0 + cs;
      const z0 = AI.min + gz * cs, z1 = z0 + cs;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const idx = gz * N + gx;

      /* --- поверхность --- */
      let b0 = 0;
      for (let k = 0; k < G.colliders.length; k++) {
        const c = G.colliders[k];
        if (c.max.y < 0.05 || c.min.y > 1.85) continue;
        if (hit(x0, x1, z0, z1, c)) { b0 = 1; break; }
      }
      if (inShaft(cx, cz)) b0 = 1;      /* дыра — только через линк вниз */
      AI.grid[0][idx] = b0;

      /* --- подземелье --- */
      let b1 = 0;
      if (!inUnderground(cx, cz)) b1 = 1;
      else {
        for (let k = 0; k < G.colliders.length; k++) {
          const c = G.colliders[k];
          if (c.max.y < BUNKER_Y + 0.2 || c.min.y > BUNKER_Y + 1.7) continue;
          if (hit(x0, x1, z0, z1, c)) { b1 = 1; break; }
        }
      }
      AI.grid[1][idx] = b1;
    }
  }

  /* --- связь слоёв: входы вниз --- */
  SHAFTS.forEach((s) => {
    const a = navNearestOpen(0, s.x, s.z, 10);   /* край дыры сверху */
    const b = navNearestOpen(1, s.x, s.z, 10);   /* пол под дырой */
    if (a < 0 || b < 0) return;
    addNavLink(a, b, 5, { x: s.x, z: s.z });
  });

  /* --- связь слоёв: рампы (вверх и вниз по наклонной плите) --- */
  RAMPS.forEach((r) => {
    const topX = r.axis === 'z' ? r.x : r.p1;
    const topZ = r.axis === 'z' ? r.p1 : r.z;
    const botX = r.axis === 'z' ? r.x : r.p0;
    const botZ = r.axis === 'z' ? r.p0 : r.z;
    const up = navNearestOpen(0, topX, topZ, 6);
    const dn = navNearestOpen(1, botX, botZ, 6);
    if (up < 0 || dn < 0) return;
    addNavLink(dn, up, 10, { x: topX, z: topZ });
    addNavLink(up, dn, 10, { x: botX, z: botZ });
  });
}

/* Поле расстояний до игрока. Считается один раз на всех мемов:
   это и дешевле, и надёжнее, чем отдельный путь каждому. */
function buildFlowField() {
  const N = AI.N, total = AI.total;
  const dist = AI.dist, nextPt = AI.nextPt;
  dist.fill(0x3fffffff);
  nextPt.fill(null);

  const p = G.camera.position;
  const playerLayer = (p.y - EYE) < -2.5 ? 1 : 0;
  let start = navIdx(p.x, p.z, playerLayer);
  if (start < 0 || AI.grid[playerLayer][start - playerLayer * total] === 1) {
    start = navNearestOpen(playerLayer, p.x, p.z, 10);
  }
  if (start < 0) return;

  dist[start] = 0;
  const q = [start];

  for (let h = 0; h < q.length; h++) {
    const u = q[h];
    const layer = u >= total ? 1 : 0;
    const cell = u - layer * total;
    const g = AI.grid[layer];
    const cx = cell % N, cz = (cell / N) | 0;
    const du = dist[u];

    /* соседние клетки того же слоя */
    for (let k = 0; k < 8; k++) {
      const dx = NAV_DIRS[k][0], dz = NAV_DIRS[k][1];
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const ni = nz * N + nx;
      if (g[ni] === 1) continue;
      /* по диагонали нельзя срезать угол */
      if (dx !== 0 && dz !== 0 &&
          (g[cz * N + nx] === 1 || g[nz * N + cx] === 1)) continue;
      const v = layer * total + ni;
      if (du + 1 < dist[v]) {
        dist[v] = du + 1;
        nextPt[v] = navWorld(cell);
        q.push(v);
      }
    }

    /* переходы между слоями */
    const inc = AI.inMap[u];
    if (inc) {
      for (let k = 0; k < inc.length; k++) {
        const e = inc[k];
        if (du + e.cost < dist[e.from]) {
          dist[e.from] = du + e.cost;
          nextPt[e.from] = e.via;
          q.push(e.from);
        }
      }
    }
  }
}

/* Столкновения мема со стенами — поосевой проход с выталкиванием,
   как у игрока (collideMove), но телом мема (MEME_R / MEME_H).
   Без этого мемы проходили сквозь стены домов и подземных коридоров. */
function collideMeme(o, dx, dz) {
  const feet = o.position.y - MEME_H / 2;
  const head = o.position.y + MEME_H / 2;
  let hit = false;

  if (dx !== 0) {
    o.position.x += dx;
    for (let i = 0; i < G.colliders.length; i++) {
      const c = G.colliders[i];
      if (head <= c.min.y || feet >= c.max.y) continue;
      if (o.position.x + MEME_R > c.min.x && o.position.x - MEME_R < c.max.x &&
          o.position.z + MEME_R > c.min.z && o.position.z - MEME_R < c.max.z) {
        o.position.x = dx > 0 ? c.min.x - MEME_R : c.max.x + MEME_R;
        hit = true;
      }
    }
  }

  if (dz !== 0) {
    o.position.z += dz;
    for (let i = 0; i < G.colliders.length; i++) {
      const c = G.colliders[i];
      if (head <= c.min.y || feet >= c.max.y) continue;
      if (o.position.x + MEME_R > c.min.x && o.position.x - MEME_R < c.max.x &&
          o.position.z + MEME_R > c.min.z && o.position.z - MEME_R < c.max.z) {
        o.position.z = dz > 0 ? c.min.z - MEME_R : c.max.z + MEME_R;
        hit = true;
      }
    }
  }
  return hit;
}

function updateMemes(dt) {
  const p = G.camera.position;
  const now = performance.now() / 1000;

  /* поле пути пересчитываем редко и сразу на всех — мемы идут по градиенту */
  AI.fieldT -= dt;
  if (AI.fieldT <= 0 && G.memes.length) {
    AI.fieldT = AI.fieldTick;
    buildFlowField();
  }

  G.memes.forEach((m) => {
    const o = m.obj;
    if (m.dead) return;
    /* billboard */
    o.rotation.y = Math.atan2(p.x - o.position.x, p.z - o.position.z);

    /* --- смерть: заваливается, крутится и растворяется --- */
    if (m.dying > 0) {
      m.dying -= dt;
      const t = Math.max(0, m.dying / 0.7);
      o.rotation.z += dt * 7;
      o.position.y -= dt * 2.4;
      o.material.transparent = true;
      o.material.opacity = t;
      const s = 0.35 + 0.65 * t;
      o.scale.set(s, s, s);
      if (m.dying <= 0) {
        m.dead = true;
        if (o.parent) G.scene.remove(o);
      }
      return;
    }

    const dx = p.x - o.position.x;
    const dz = p.z - o.position.z;
    const dist = Math.hypot(dx, dz);

    /* --- слой: поверхность (0) или подземелье (1) --- */
    const rampY = rampAt(o.position.x, o.position.z);
    const onRamp = rampY !== null;
    const feet = o.position.y - m.h / 2;
    if (onRamp) m.layer = rampY < -2.5 ? 1 : 0;
    else m.layer = feet < -2.5 ? 1 : 0;

    /* --- вертикаль: пол своего слоя, в дыру падаем с ускорением --- */
    let groundY;
    if (onRamp) groundY = rampY;
    else if (inShaft(o.position.x, o.position.z)) groundY = BUNKER_Y;
    else groundY = m.layer === 1 ? BUNKER_Y : 0;
    const targetY = groundY + m.h / 2;

    if (o.position.y > targetY + 0.02) {
      m.vy = Math.max(-22, (m.vy || 0) - 26 * dt);
      o.position.y = Math.max(targetY, o.position.y + m.vy * dt);
      if (o.position.y <= targetY + 0.001) m.vy = 0;
    } else if (o.position.y < targetY - 0.02) {
      m.vy = 0;
      o.position.y = Math.min(targetY,
        o.position.y + Math.min(m.speed, BOT_MAX) * 0.9 * dt);
    } else {
      m.vy = 0;
      o.position.y = targetY + Math.sin(now * 11 + m.seed) * 0.04;
    }

    /* --- горизонталь: идём по градиенту поля до игрока --- */
    let dirX = dx, dirZ = dz;
    if (dist > 2.2 && !onRamp) {
      const node = navIdx(o.position.x, o.position.z, m.layer);
      const pt = node >= 0 ? AI.nextPt[node] : null;
      if (pt) { dirX = pt.x - o.position.x; dirZ = pt.z - o.position.z; }
    }
    /* в колодце не болтаемся по горизонтали — иначе не провалимся */
    if (inShaft(o.position.x, o.position.z) && o.position.y > targetY + 0.1) {
      dirX = 0; dirZ = 0;
    }

    const dl = Math.hypot(dirX, dirZ) || 1;
    /* Лёгкое покачивание — «живой» бег, но БЕЗ ускорения: итоговая
       скорость всегда ограничена BOT_MAX, поэтому мем ни при каких
       условиях не быстрее игрока. Рывка (rage) больше нет. */
    const wobble = 1 + Math.sin(now * 2.4 + m.seed) * 0.05;
    const spd = Math.min(m.speed * wobble, BOT_MAX);
    const step = Math.min(dist, spd * dt);

    const px = o.position.x, pz = o.position.z;
    /* шаг со столкновениями: сквозь стены мем не проходит */
    collideMeme(o, (dirX / dl) * step, (dirZ / dl) * step);

    /* застревание: если почти не сдвинулись — сбрасываем путь */
    if (Math.hypot(o.position.x - px, o.position.z - pz) < step * 0.35) {
      m.stuckT = (m.stuckT || 0) + dt;
      if (m.stuckT > 0.45) {
        m.repathT = 0; m.stuckT = 0;
        /* Распутывание: пробуем сдвинуться вбок (перпендикуляр к курсу)
           тем же шагом, что и обычное движение — со столкновениями.
           Никаких телепортов на полметра: иначе мем «дёргался». */
        const ux = dirX / dl, uz = dirZ / dl;
        const nudge = spd * dt;
        const sx = px, sz = pz;
        let moved = false;
        for (let s = 1; s >= -1 && !moved; s -= 2) {
          o.position.x = sx; o.position.z = sz;
          collideMeme(o, -uz * s * nudge, ux * s * nudge);
          if (Math.hypot(o.position.x - sx, o.position.z - sz) > nudge * 0.5) moved = true;
        }
        if (!moved) { o.position.x = sx; o.position.z = sz; }
      }
    } else { m.stuckT = 0; }

    /* отдача от попадания — мема отбрасывает, он тормозит */
    if (Math.abs(m.kx) + Math.abs(m.kz) > 0.02) {
      collideMeme(o, m.kx * dt, m.kz * dt);
      const damp = Math.exp(-7 * dt);
      m.kx *= damp; m.kz *= damp;
    } else { m.kx = 0; m.kz = 0; }

    /* подсветка при попадании */
    if (m.flash > 0) {
      m.flash = Math.max(0, m.flash - dt * 6);
      o.material.color.setRGB(1, 1 - m.flash * 0.55, 1 - m.flash * 0.55);
    } else {
      o.material.color.setRGB(1, 1, 1);
    }

    /* полоска здоровья над мемом */
    if (m.barFill) {
      const frac = Math.max(0, m.hp / m.maxHp);
      m.barFill.scale.x = Math.max(0.001, frac);
      m.barFill.position.x = -0.53 * (1 - frac);
      m.barFill.material.color.setHex(frac > 0.55 ? 0x3ddc57 : frac > 0.25 ? 0xffc531 : 0xe03b3b);
    }

    /* --- атака в упор --- */
    m.atkCd = Math.max(0, (m.atkCd || 0) - dt);
    const vOverlap = Math.abs((o.position.y - m.h / 2) - (p.y - EYE)) < 2.0;
    if (dist < 1.75 && vOverlap && m.atkCd <= 0) {
      m.atkCd = 1.15;
      damagePlayer(m.dmg, m);
      /* отбрасываем игрока от мема — удар чувствуется */
      if (dist > 0.001) {
        G.vel.x += (dx / dist) * 2.4;
        G.vel.z += (dz / dist) * 2.4;
      }
      G.shake = Math.max(G.shake, 0.5);
    }

    /* рывка нет: мем всегда идёт с одной скоростью (см. BOT_MAX выше) */
    m.rage = 1;
  });

  /* мягкое расталкивание: мемы не слипаются в одну точку */
  for (let i = 0; i < G.memes.length; i++) {
    const a = G.memes[i];
    if (a.dead || a.dying > 0) continue;
    for (let j = i + 1; j < G.memes.length; j++) {
      const b = G.memes[j];
      if (b.dead || b.dying > 0) continue;
      const sx = b.obj.position.x - a.obj.position.x;
      const sz = b.obj.position.z - a.obj.position.z;
      const sd = Math.hypot(sx, sz);
      const minD = 1.15;
      if (sd < minD && sd > 1e-4) {
        const push = (minD - sd) * 0.5;
        const ux = sx / sd, uz = sz / sd;
        collideMeme(a.obj, -ux * push, -uz * push);
        collideMeme(b.obj, ux * push, uz * push);
      }
    }
  }

  /* убираем отработавших */
  for (let i = G.memes.length - 1; i >= 0; i--) {
    if (G.memes[i].dead) G.memes.splice(i, 1);
  }
}

/* ============================================================
   ОРУЖИЕ, УРОН, ЭФФЕКТЫ
   ============================================================ */
const _vDir = new THREE.Vector3();
const _vMuzzle = new THREE.Vector3();
const _vEnd = new THREE.Vector3();

/* попадание в AABB: расстояние вдоль луча или Infinity */
function rayBox(ox, oy, oz, dx, dy, dz, c) {
  let tmin = 0, tmax = 1e9;
  const axes = [
    [ox, dx, c.min.x, c.max.x],
    [oy, dy, c.min.y, c.max.y],
    [oz, dz, c.min.z, c.max.z]
  ];
  for (let i = 0; i < 3; i++) {
    const o = axes[i][0], d = axes[i][1], mn = axes[i][2], mx = axes[i][3];
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return Infinity;
    } else {
      let t1 = (mn - o) / d, t2 = (mx - o) / d;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

/* попадание в сферу мема */
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

function addTracer(a, b) {
  const geo = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
  const mat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85 });
  const line = new THREE.Line(geo, mat);
  G.scene.add(line);
  G.fx.push({ obj: line, life: 0.07, max: 0.07, kind: 'tracer' });
}

function addImpact(p, color) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 6, 6),
    new THREE.MeshBasicMaterial({ color: color || 0xffd27a, transparent: true, opacity: 0.95 })
  );
  mesh.position.copy(p);
  G.scene.add(mesh);
  G.fx.push({ obj: mesh, life: 0.22, max: 0.22, kind: 'impact' });
}

function updateFx(dt) {
  for (let i = G.fx.length - 1; i >= 0; i--) {
    const f = G.fx[i];
    f.life -= dt;
    const k = Math.max(0, f.life / f.max);
    if (f.kind === 'tracer' || f.kind === 'impact') {
      if (f.obj.material) f.obj.material.opacity = k;
    }
    if (f.kind === 'impact') {
      const s = 1 + (1 - k) * 3;
      f.obj.scale.set(s, s, s);
    }
    if (f.life <= 0) {
      if (f.obj.parent) f.obj.parent.remove(f.obj);
      if (f.obj.geometry) f.obj.geometry.dispose();
      if (f.obj.material && f.obj.material.dispose) f.obj.material.dispose();
      G.fx.splice(i, 1);
    }
  }
}

function hitMarker(head) {
  const el = document.getElementById('hitmarker');
  if (!el) return;
  el.classList.remove('show', 'head');
  void el.offsetWidth;
  if (head) el.classList.add('head');
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 150);
}

function addKillFeed(m) {
  const box = document.getElementById('killFeed');
  if (!box) return;
  const row = document.createElement('div');
  row.className = 'kf-row';
  row.innerHTML = '<b>ТЫ</b><span>›</span><em style="color:' + m.color + '">' + m.name + '</em>';
  box.appendChild(row);
  setTimeout(() => { if (row.parentNode) row.parentNode.removeChild(row); }, 2600);
}

function damagePlayer(v, m) {
  if (G.hp <= 0) return;
  /* короткое окно неуязвимости: несколько мемов в упор не сносят
     весь запас HP за один кадр */
  if (G.hurtCd > 0) return;
  G.hurtCd = 0.32;
  Sfx.hurt();
  G.hp = Math.max(0, G.hp - v);
  const vg = document.getElementById('dmgVignette');
  if (vg) {
    vg.classList.remove('hit');
    void vg.offsetWidth;
    vg.classList.add('hit');
  }
  if (G.hp <= 0) gameOver(m || { label: 'МЕМ', name: '—' });
}

function killMeme(m) {
  if (m.dying > 0 || m.dead) return;
  m.dying = 0.7;
  G.kills++;
  G.score += m.reward;
  G.gold += m.reward;
  Sfx.kill();
  addKillFeed(m);
}

function damageMeme(m, dmg, head, dx, dz) {
  if (m.dying > 0 || m.dead) return;
  m.hp -= dmg;
  m.flash = 1;
  /* отбрасывание по направлению выстрела */
  m.kx += dx * (head ? 5 : 3.2);
  m.kz += dz * (head ? 5 : 3.2);
  hitMarker(head);
  Sfx.hit(head);
  if (m.hp <= 0) killMeme(m);
}

function reloadWeapon() {
  if (G.reloading || G.ammo >= WEAPON.mag || G.reserve <= 0) return;
  G.reloading = true;
  G.reloadT = WEAPON.reload;
  Sfx.reload();
}

function shoot() {
  if (G.reloading || G.ammo <= 0) return;

  G.ammo--;
  Sfx.shot();
  G.fireCd = 60 / WEAPON.rpm;
  G.gunKick = 1;
  G.spread = Math.min(WEAPON.spreadMax, G.spread + WEAPON.spreadShot);
  G.recoil = Math.min(0.17, G.recoil + WEAPON.recoil * (0.85 + Math.random() * 0.3));

  const o = G.camera.position;
  const yaw = G.yaw + (Math.random() - 0.5) * 2 * G.spread;
  const pitch = G.pitch + G.recoil + (Math.random() - 0.5) * 2 * G.spread;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const dx = -Math.sin(yaw) * cp;
  const dy = sp;
  const dz = -Math.cos(yaw) * cp;

  /* ближайшая стена на пути луча */
  let wallT = WEAPON.range;
  for (let i = 0; i < G.colliders.length; i++) {
    const t = rayBox(o.x, o.y, o.z, dx, dy, dz, G.colliders[i]);
    if (t < wallT) wallT = t;
  }
  /* пол: земля на 0 или пол бункера на -5 (пол — не коллайдер) */
  const groundY = (o.y - EYE) < -1 ? BUNKER_Y : 0;
  if (dy < -1e-6) {
    const tg = (groundY - o.y) / dy;
    if (tg > 0 && tg < wallT) wallT = tg;
  }

  /* ближайший мем, но не за стеной */
  let hitM = null, hitT = wallT, hitY = 0;
  for (let i = 0; i < G.memes.length; i++) {
    const m = G.memes[i];
    if (m.dead || m.dying > 0) continue;
    const c = m.obj.position;
    const r = m.h * 0.46;
    const t = raySphere(o.x, o.y, o.z, dx, dy, dz, c.x, c.y, c.z, r);
    if (t < hitT) { hitT = t; hitM = m; hitY = o.y + dy * t; }
  }

  const endT = Math.min(hitT, WEAPON.range);
  _vMuzzle.set(
    o.x + dx * 0.55 + Math.cos(yaw) * 0.16,
    o.y + dy * 0.55 - 0.14,
    o.z + dz * 0.55 - Math.sin(yaw) * 0.16
  );
  _vEnd.set(o.x + dx * endT, o.y + dy * endT, o.z + dz * endT);

  addTracer(_vMuzzle, _vEnd);

  /* вспышка ствола — один постоянный источник, без создания ламп на выстрел */
  if (!G.muzzleLight) {
    G.muzzleLight = new THREE.PointLight(0xffd27a, 0, 7);
    G.scene.add(G.muzzleLight);
  }
  G.muzzleLight.position.copy(_vMuzzle);
  G.muzzleLight.intensity = 2.2;

  if (hitM) {
    const head = hitY > hitM.obj.position.y + hitM.h * 0.17;
    damageMeme(hitM, Math.round(WEAPON.dmg * (head ? WEAPON.headMul : 1)), head, dx, dz);
    addImpact(_vEnd, 0xff8a5c);
  } else if (wallT < WEAPON.range) {
    addImpact(_vEnd, 0xffd27a);
  }
}

function updateWeapon(dt) {
  G.fireCd = Math.max(0, G.fireCd - dt);
  /* разброс плавно возвращается к базовому */
  G.spread += (WEAPON.spread - G.spread) * Math.min(1, 6 * dt);
  /* отдача камеры затухает */
  G.recoil *= Math.exp(-WEAPON.recoilDecay * dt);
  if (G.muzzleLight && G.muzzleLight.intensity > 0) {
    G.muzzleLight.intensity = Math.max(0, G.muzzleLight.intensity - dt * 18);
  }

  if (G.reloading) {
    G.reloadT -= dt;
    if (G.reloadT <= 0) {
      const need = WEAPON.mag - G.ammo;
      const take = Math.min(need, G.reserve);
      G.ammo += take;
      G.reserve -= take;
      G.reloading = false;
    }
  }

  /* одиночный клик: выстрел не должен теряться, даже если кнопку
     отпустили между кадрами */
  if (G.firePressed) {
    G.firePressed = false;
    if (!G.reloading) {
      if (G.ammo > 0 && G.fireCd <= 0) shoot();
      else if (G.ammo <= 0 && G.reserve > 0) reloadWeapon();
      else if (G.ammo <= 0 && G.fireCd <= 0) { G.fireCd = 0.3; Sfx.empty(); }
    }
  }

  if (G.firing && !G.reloading) {
    if (G.ammo <= 0 && G.reserve > 0) reloadWeapon();
    else if (G.ammo <= 0 && G.fireCd <= 0) { G.fireCd = 0.3; Sfx.empty(); }
    else if (G.fireCd <= 0) shoot();
  }

  /* --- анимация оружия в руках --- */
  if (G.viewmodel) {
    G.gunKick = Math.max(0, G.gunKick - dt * 9);
    const amp = G.bobAmp || 0;
    const bx = Math.sin(G.bobT) * 0.014 * amp;
    const by = Math.abs(Math.cos(G.bobT)) * 0.012 * amp;
    const rl = G.reloading ? 1 : 0;
    const tx = 0.29 + bx;
    const ty = -0.31 + by - G.gunKick * 0.025 - rl * 0.07;
    const tz = -0.7 + G.gunKick * 0.07;
    const v = G.viewmodel;
    const k = Math.min(1, 14 * dt);
    v.position.x += (tx - v.position.x) * k;
    v.position.y += (ty - v.position.y) * k;
    v.position.z += (tz - v.position.z) * k;
    v.rotation.z += ((rl ? 0.55 : 0) - v.rotation.z) * Math.min(1, 10 * dt);
    v.rotation.x += ((G.gunKick * 0.22) - v.rotation.x) * Math.min(1, 18 * dt);
  }
}

/* --- волны: зачистил всех → передышка → следующая --- */
function updateWaves(dt) {
  if (G.waveState === 'fight') {
    let alive = 0;
    for (let i = 0; i < G.memes.length; i++) {
      if (!G.memes[i].dead && G.memes[i].dying <= 0) alive++;
    }
    if (alive === 0) {
      G.waveState = 'break';
      G.waveT = 3.2;
      G.reserve = Math.min(WEAPON.maxReserve, G.reserve + 60);
      G.hp = Math.min(G.maxHp, G.hp + 15);
      showWaveClear(G.wave);
    }
  } else {
    G.waveT -= dt;
    if (G.waveT <= 0) startWave(G.wave + 1);
  }
}

function showWaveClear(n) {
  const el = document.getElementById('waveBanner');
  if (!el) return;
  el.innerHTML = 'ВОЛНА ' + n + ' ЗАЧИЩЕНА<span>+60 ПАТРОНОВ · +15 HP</span>';
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ============================================================
   ИГРОК: ФИЗИКА, КОЛЛИЗИИ, ПАРКУР
   ============================================================ */
const PLAYER_R = 0.42;
const PLAYER_H = 1.75;

/* Координаты входа №2 — тайного люка в полу дома 1.
   Держим их в одном месте: и геометрия, и физика берут отсюда. */
const HATCH = { x: -21, z: -19 };

/* пол в точке (x,z) — земля 0, под землёй BUNKER_Y.
   РОВНО ТРИ входа в подземелье:
     1) центральная вертикальная шахта (0,0);
     2) тайный люк в полу дома 1;
     3) яма траншеи у западного края карты.
   Плавные спуски-рампы считаются отдельно (RAMPS), это не «входы». */
const SHAFTS = [
  { x: 0,       z: 0,       hw: 2.2, hd: 2.2 },   /* вход 1: центральная шахта */
  { x: HATCH.x, z: HATCH.z, hw: 1.3, hd: 1.3 },   /* вход 2: люк в полу дома 1 */
  { x: -34,     z: 0,       hw: 2.0, hd: 2.0 }    /* вход 3: яма траншеи */
];

/* Наклонные спуски: {x,z,hw,hd,axis,p0,p1,y0,y1}. Пол = линейная
   интерполяция высоты вдоль оси. */
const RAMPS = [];

/* Плоские наклонные балки (бывшие вертикальные шесты): по ним ХОДЯТ.
   BEAMS[] заполняет addBeam(); пол балки считает beamAt(). */
const BEAMS = [];

function beamAt(x, z) {
  for (let i = 0; i < BEAMS.length; i++) {
    const b = BEAMS[i];
    const px = x - b.x0, pz = z - b.z0;
    const t = px * b.dx + pz * b.dz;              // вдоль балки
    if (t < -0.25 || t > b.run + 0.6) continue;   // за концами — падаешь
    if (Math.abs(-px * b.dz + pz * b.dx) > b.hw) continue;  // сошёл вбок
    const c = Math.max(0, Math.min(b.run, t));
    return (c / b.run) * b.top + b.lip;
  }
  return null;
}

function rampAt(x, z) {
  for (let i = 0; i < RAMPS.length; i++) {
    const r = RAMPS[i];
    if (Math.abs(x - r.x) > r.hw || Math.abs(z - r.z) > r.hd) continue;
    const p = (r.axis === 'z') ? z : x;
    let t = (p - r.p0) / (r.p1 - r.p0);
    t = Math.max(0, Math.min(1, t));
    return r.y0 + (r.y1 - r.y0) * t;
  }
  return null;
}

/* --- ПОДЗЕМНАЯ СЕТЬ: клеточная разметка --- */
const UG = {
  cs: 2,                    // размер клетки
  i0: -20, i1: 19,          // клетки по X (x = i*cs .. i*cs+cs)
  j0: -18, j1: 17,          // клетки по Z
  open: null, hub: null, ceil: null, skip: null
};
function ugIdx(i, j) {
  if (i < UG.i0 || i > UG.i1 || j < UG.j0 || j > UG.j1) return -1;
  return (j - UG.j0) * (UG.i1 - UG.i0 + 1) + (i - UG.i0);
}
function ugOpen(i, j) { const k = ugIdx(i, j); return k >= 0 && UG.open && UG.open[k] === 1; }
function ugHub(i, j) { const k = ugIdx(i, j); return k >= 0 && UG.hub && UG.hub[k] === 1; }
function ugMark(i0, i1, j0, j1, isHub, noCeil) {
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = ugIdx(i, j); if (k < 0) continue;
      UG.open[k] = 1;
      if (isHub) UG.hub[k] = 1;
      if (noCeil) UG.ceil[k] = 0;
    }
  }
}
/* Клетка стыка с рампой: открыта для прохода (стена не строится),
   но своей геометрии не получает — там плита рампы. */
function ugSkipMark(i0, i1, j0, j1) {
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = ugIdx(i, j); if (k < 0) continue;
      UG.open[k] = 1; UG.skip[k] = 1; UG.ceil[k] = 0;
    }
  }
}
function ugSkip(i, j) { const k = ugIdx(i, j); return k >= 0 && UG.skip && UG.skip[k] === 1; }
function inUnderground(x, z) {
  if (!UG.open) return false;
  return ugOpen(Math.floor(x / UG.cs), Math.floor(z / UG.cs));
}

function shaftRect(s) { return { x: s.x, z: s.z, hw: s.hw, hd: s.hd }; }

/* проём в земле — там пола нет, игрок проваливается в бункер */
function inShaft(x, z) {
  for (let i = 0; i < SHAFTS.length; i++) {
    const s = shaftRect(SHAFTS[i]);
    if (Math.abs(x - s.x) < s.hw && Math.abs(z - s.z) < s.hd) return true;
  }
  return false;
}

/* Выталкивает игрока из проёма на твёрдую землю.
   Нужно при подъёме: вылез из шахты — и сразу провалился обратно. */
function exitShaft(pos) {
  for (let i = 0; i < SHAFTS.length; i++) {
    const s = shaftRect(SHAFTS[i]);
    const dx = pos.x - s.x, dz = pos.z - s.z;
    if (Math.abs(dx) >= s.hw || Math.abs(dz) >= s.hd) continue;

    const needX = (s.hw + PLAYER_R + 0.4) - Math.abs(dx);
    const needZ = (s.hd + PLAYER_R + 0.4) - Math.abs(dz);
    if (needX < needZ) {
      pos.x = s.x + (dx >= 0 ? 1 : -1) * (s.hw + PLAYER_R + 0.4);
    } else {
      pos.z = s.z + (dz >= 0 ? 1 : -1) * (s.hd + PLAYER_R + 0.4);
    }
    return true;
  }
  return false;
}

function groundAt(x, z) {
  /* Плоская наклонная балка: по ней идут пешком, сошёл — падаешь */
  const bm = beamAt(x, z);
  if (bm !== null) return bm;
  /* Наклонный спуск — плавный пол по всей его длине */
  const r = rampAt(x, z);
  if (r !== null) return r;
  /* Проём в земле: пока игрок внутри и НЕ лезет — падает в бункер */
  if (inShaft(x, z)) {
    if (G.climbing) return 0;
    return BUNKER_Y;
  }
  /* Подземная сеть действует, только если игрок уже под землёй
     (ноги ниже -1). Иначе клетка накрыла бы поверхность и прижала
     игрока к -5 прямо на траве. */
  const under = G.camera && (G.camera.position.y - EYE) < -1;
  if (under && inUnderground(x, z)) return BUNKER_Y;

  /* Крыша здания: игрок стоит на ней, только если уже на уровне крыши
     (ноги выше стен). У основания и внутри дома пол — земля (0), иначе
     игрока засасывало бы на крышу прямо с земли. Крыша — отдельная плита
     поверх стен (h + 0.06, толщина 0.1), её верх ≈ h + 0.11. Сама плита
     коллайдером НЕ является (чтобы не блокировала игрока сбоку на уровне
     ног), опора на крышу — только через эту функцию. */
  if (G.buildings) {
    const feet = G.camera ? (G.camera.position.y - EYE) : 0;
    for (let bi = 0; bi < G.buildings.length; bi++) {
      const b = G.buildings[bi];
      const hx = (b.w + 1.6) / 2, hz = (b.d + 1.6) / 2;
      if (x >= b.x - hx && x <= b.x + hx && z >= b.z - hz && z <= b.z + hz &&
          feet >= b.h - 0.5) {
        return b.h + 0.11;
      }
    }
  }

  return 0;
}

function collideMove(pos, delta) {
  /* раздельное движение по осям — позволяет скользить по стенам */
  ['x', 'z', 'y'].forEach((axis) => {
    const before = pos[axis];
    pos[axis] += delta[axis];

    if (axis === 'y') {
      /* вертикаль: проверка пола/потолка.
         pos.y — уровень ГЛАЗ, ноги ниже на EYE, макушка выше на PLAYER_H - EYE. */
      G.colliders.forEach((c) => {
        const overlapX = pos.x + PLAYER_R > c.min.x && pos.x - PLAYER_R < c.max.x;
        const overlapZ = pos.z + PLAYER_R > c.min.z && pos.z - PLAYER_R < c.max.z;
        if (!overlapX || !overlapZ) return;
        const feet = pos.y - EYE;
        const head = pos.y + (PLAYER_H - EYE);
        if (feet < c.max.y && head > c.min.y) {
          if (before - EYE >= c.max.y - 0.01 && delta.y <= 0) {
            pos.y = c.max.y + EYE; G.onGround = true; G.vel.y = 0;
          } else if (before + (PLAYER_H - EYE) <= c.min.y + 0.01 && delta.y > 0) {
            pos.y = c.min.y - (PLAYER_H - EYE); G.vel.y = 0;
          }
        }
      });
      return;
    }

    /* горизонталь */
    G.colliders.forEach((c) => {
      const overlapY = (pos.y - EYE) + PLAYER_H > c.min.y && (pos.y - EYE) < c.max.y;
      if (!overlapY) return;
      const ovX = pos.x + PLAYER_R > c.min.x && pos.x - PLAYER_R < c.max.x;
      const ovZ = pos.z + PLAYER_R > c.min.z && pos.z - PLAYER_R < c.max.z;
      if (!ovX || !ovZ) return;

      /* Небольшая ступенька (ящик, бортик, край рампы): не упираемся,
         а поднимаемся на неё. Иначе игрок застревал перед любым
         препятствием выше колена. */
      const feet = pos.y - EYE;
      const rise = c.max.y - feet;
      if (G.stepAllowed && rise > 0.02 && rise <= STEP_H) {
        pos.y = c.max.y + EYE + 0.001;
        G.onGround = true;
        G.vel.y = 0;
        return;
      }

      if (axis === 'x') {
        pos.x = delta.x > 0 ? c.min.x - PLAYER_R : c.max.x + PLAYER_R;
      } else {
        pos.z = delta.z > 0 ? c.min.z - PLAYER_R : c.max.z + PLAYER_R;
      }
    });
  });
}

function findClimbable(pos, goingDown) {
  let best = null, bestD = 1e9;
  G.climbables.forEach((c) => {
    const d = Math.hypot(pos.x - c.x, pos.z - c.z);
    if (d >= c.r || d >= bestD) return;

    if (c.bottom !== undefined) {
      /* Вертикальный пролёт: лестницы в бункер, траншею и люк дома 1.
         Границы пролёта — от пола бункера до верха лестницы. */
      const bBottom = Math.min(c.bottom, c.top);
      const bTop = Math.max(c.bottom, c.top);
      /* Верхняя граница с запасом на высоту глаз: стоя на крыше
         (глаза на bTop + EYE) игрок должен мочь взяться за люк. */
      if (pos.y < bBottom - 1.0 || pos.y > bTop + EYE + 0.5) return;

      /* Направление. Раньше условие было перевёрнуто: у ВЕРХА лестницы
         спуск запрещался, поэтому слезть в бункер было нельзя.
         Теперь: на дне нельзя ниже, наверху нельзя выше. */
      if (goingDown && pos.y < bBottom + 0.6) return;
      if (!goingDown && pos.y > bTop - 0.3) return;
    } else {
      /* Палка/лестница на крышу.
         ВАЖНО: `pos.y` — это уровень ГЛАЗ (камера), а не ноги.
         Раньше зажим `pos.y >= c.top - 0.15` отключал лазалку задолго
         до верха — глаза достигают top на 1.7 м раньше ног, поэтому
         на крышу было не залезть. Теперь запас 2.2 м. */
      if (pos.y >= c.top + 2.2) return;
    }
    best = c; bestD = d;
  });
  return best;
}

function updatePlayer(dt) {
  const p = G.camera.position;
  const k = G.keys;

  /* Q/E — поворот камеры с клавиатуры, R/F — наклон вверх/вниз.
     Работает всегда: мышь может упереться в край окна, когда захват курсора
     недоступен. Стрелки заняты под движение, поэтому наклон на R/F. */
  if (k['KeyQ']) G.yaw += TURN_V * dt;
  if (k['KeyE']) G.yaw -= TURN_V * dt;
  /* Наклон с клавиатуры — PageUp/PageDown. R теперь перезарядка. */
  if (k['PageUp'] || k['PageDown']) {
    if (k['PageUp']) G.pitch += TURN_V * dt;
    if (k['PageDown']) G.pitch -= TURN_V * dt;
    const lim = Math.PI / 2 - 0.02;
    G.pitch = Math.max(-lim, Math.min(lim, G.pitch));
  }

  /* Камера идёт ровно за смещением мыши (дельта) — как при Pointer Lock,
     без мёртвых зон и разгонов: одинаково на первом запуске и на любом
     следующем. Без захвата курсор упирается в границу окна и дельты
     перестают приходить, поэтому у самого края камера доворачивается
     сама — постоянной скоростью, без разгона (отключаемо в настройках). */
  if (Opt.edgeTurn && G.mouseInside && G.edgeArmed &&
      document.pointerLockElement !== G.renderer.domElement) {
    const nx = (G.mouseX / window.innerWidth) * 2 - 1;
    const ny = (G.mouseY / window.innerHeight) * 2 - 1;
    if (Math.abs(nx) > EDGE_BAND) G.yaw -= EDGE_TURN * dt * Math.sign(nx);
    if (Math.abs(ny) > EDGE_BAND) {
      G.pitch -= EDGE_TURN * dt * Math.sign(ny);
      const lim = Math.PI / 2 - 0.02;
      G.pitch = Math.max(-lim, Math.min(lim, G.pitch));
    }
  }

  /* ---- лазание ---- */
  /* S — вниз, W/Shift — вверх */
  const wantDown = !!k['KeyS'];
  /* Ищем лазалку заново. Липкость нужна только чтобы не соскочить
     ВО ВРЕМЯ подъёма, поэтому цепляемся за прежнюю цель лишь если
     игрок реально рядом с ней и она всё ещё достижима. */
  let climb = findClimbable(p, wantDown);
  if (!climb && G.climbing && G.climbTarget) {
    const d = Math.hypot(p.x - G.climbTarget.x, p.z - G.climbTarget.z);
    if (d < G.climbTarget.r + 0.6) climb = G.climbTarget;
  }
  G.climbTarget = climb;

  /* Space — «разжать руки»: с шеста и лестницы можно сорваться и упасть.
     Отпустил клавишу подъёма — тоже падаешь (лазалка держит только
     пока её держишь). */
  /* Схватиться можно только СВЕЖИМ нажатием W/S и не в свободном
     падении. Иначе, проваливаясь в шахту с зажатым W, игрок цеплялся
     за лестницу и уезжал обратно наверх — «телепорт на самый верх». */
  const climbKey = !!(k['KeyW'] || k['KeyS'] || k['ShiftLeft'] || k['ShiftRight']);
  const freshClimb = (!!k['KeyW'] && !G.prevW) || (!!k['KeyS'] && !G.prevS) ||
    ((!!(k['ShiftLeft'] || k['ShiftRight'])) && !G.prevShift);
  G.prevW = !!k['KeyW'];
  G.prevS = !!k['KeyS'];
  G.prevShift = !!(k['ShiftLeft'] || k['ShiftRight']);

  /* Вверх по ВЕРТИКАЛЬНОЙ лестнице (в бункер/из бункера) цепляемся только
     глядя вверх: иначе, стоя на дне шахты, обычное W уносило игрока наверх.
     Наклонные лестницы к крышам работают как раньше — там W сразу лезет. */
  const needAim = !!climb && climb.bottom !== undefined && !wantDown;
  const wantClimb = !!climb && !k['Space'] && climbKey &&
    (G.climbing || (freshClimb && G.vel.y > -6 && (!needAim || G.pitch > 0.12)));
  G.climbing = !!wantClimb;
  $('#climbHint').classList.toggle('show', !!climb && !G.climbing);

  if (G.climbing) {
    const goingDown = !!k['KeyS'];
    /* Низ и верх пролёта. ВАЖНО: pos.y — уровень ГЛАЗ, а не ног,
       поэтому низ пролёта поднимаем на EYE. Иначе на дне лестницы
       глаза оказывались на уровне пола — игрок «стоял в земле». */
    const cLow = ((climb.bottom !== undefined)
      ? Math.min(climb.bottom, climb.top)
      : (climb.base !== undefined ? climb.base : 0)) + EYE;
    const cHigh = (climb.bottom !== undefined)
      ? Math.max(climb.bottom, climb.top)
      : climb.top;

    if (goingDown) p.y -= CLIMB_V * dt;
    else           p.y += CLIMB_V * dt;

    /* Подъём идёт до уровня крыши: ноги на топ, глаза выше.
       +0.2 — крыша это отдельная плита поверх стен (h + 0.06, толщина 0.1).
       Без запаса ноги оказывались ВНУТРИ плиты, и коллизия уже не могла
       поймать игрока: он проваливался сквозь крышу на землю. */
    const topLimit = cHigh + EYE + 0.2;
    if (p.y >= topLimit) { p.y = topLimit; G.vel.y = 0; }
    if (p.y <= cLow)     { p.y = cLow;    G.vel.y = 0; G.onGround = true; }

    /* пока лезем вверх — точно не «на земле», иначе гравитация
       в том же кадре стянет обратно вниз */
    if (!goingDown) G.onGround = false;
    G.vel.y = 0;

    /* Пока лезем — тело проходит сквозь здание. Иначе лестница,
       стоящая вплотную к стене, упирается в её коллизию и игрок
       не может оторваться от земли. */
    if (climb.bottom === undefined && !goingDown) {
      G.climbing = true;
      G.camera.rotation.order = 'YXZ';
      G.camera.rotation.y = G.yaw;
      G.camera.rotation.x = G.pitch + G.recoil;
      return;
    }

    /* Дошёл до верха вертикальной лестницы — выбираемся из проёма
       на твёрдую землю, иначе игрок тут же падал обратно вниз. */
    if (!goingDown && climb.bottom !== undefined && p.y >= topLimit - 0.05) {
      exitShaft(p);
      G.climbing = false;
      G.climbTarget = null;
      G.vel.y = 0;
      G.onGround = true;
      G.camera.rotation.order = 'YXZ';
      G.camera.rotation.y = G.yaw;
      G.camera.rotation.x = G.pitch + G.recoil;
      return;
    }

    /* можно чуть подруливать — но только если игрок сам жмёт A или D */
    let sx = 0, sz = 0;
    if (k['KeyA'] || k['ArrowLeft'])  sx -= 1;
    if (k['KeyD'] || k['ArrowRight']) sx += 1;
    if (sx !== 0) {
      const cos = Math.cos(G.yaw), sin = Math.sin(G.yaw);
      p.x += (sx * cos) * WALK * 0.35 * dt;
      p.z += (-sx * sin) * WALK * 0.35 * dt;
    }
    if (sz !== 0 || sx !== 0) applyCollisionOnly(p);
  } else {
    /* ---- ходьба: разгон и торможение, а не мгновенная скорость ---- */
    let mx = 0, mz = 0;
    if (k['KeyW'] || k['ArrowUp'])    mz -= 1;
    if (k['KeyS'] || k['ArrowDown'])  mz += 1;
    if (k['KeyA'] || k['ArrowLeft'])  mx -= 1;
    if (k['KeyD'] || k['ArrowRight']) mx += 1;

    const len = Math.hypot(mx, mz);
    const speed = (k['ShiftLeft'] || k['ShiftRight']) ? RUN : WALK;

    /* Поворот ввода в мировые координаты. Матрица — та же, что для
       взгляда камеры: вперёд (W, mz=-1) идёт вдоль взгляда
       (-sin, -cos), вправо (D, mx=+1) — вдоль правого вектора
       (cos, -sin). */
    let wishX = 0, wishZ = 0;
    if (len > 0) {
      mx /= len; mz /= len;
      const cos = Math.cos(G.yaw), sin = Math.sin(G.yaw);
      wishX = mx * cos + mz * sin;
      wishZ = -mx * sin + mz * cos;
    }

    /* плавный разгон к желаемой скорости: на земле резче, в воздухе
       управление слабее — как в нормальном шутере */
    const tvx = wishX * speed, tvz = wishZ * speed;
    const accel = G.onGround ? ACCEL_GROUND : ACCEL_AIR;
    const dvx = tvx - G.vel.x, dvz = tvz - G.vel.z;
    const dvl = Math.hypot(dvx, dvz);
    const maxDv = accel * dt;
    if (dvl > maxDv && dvl > 1e-6) {
      G.vel.x += (dvx / dvl) * maxDv;
      G.vel.z += (dvz / dvl) * maxDv;
    } else {
      G.vel.x = tvx; G.vel.z = tvz;
    }
    /* без ввода на земле — трение, чтобы не скользить */
    if (len === 0 && G.onGround) {
      const damp = Math.exp(-FRICTION * dt);
      G.vel.x *= damp; G.vel.z *= damp;
      if (Math.abs(G.vel.x) < 0.02) G.vel.x = 0;
      if (Math.abs(G.vel.z) < 0.02) G.vel.z = 0;
    }

    /* ---- прыжок: буфер нажатия + coyote-time ---- */
    if (G.jumpPressed) { G.jumpBuf = JUMP_BUF; G.jumpPressed = false; }
    G.jumpBuf = Math.max(0, G.jumpBuf - dt);
    /* Space зажат — держим буфер полным: коснулся пола и сразу прыгнул */
    if (G.jumpHeld) G.jumpBuf = JUMP_BUF;
    G.coyote = G.onGround ? COYOTE : Math.max(0, G.coyote - dt);
    if (G.jumpBuf > 0 && G.coyote > 0) {
      G.vel.y = JUMP_V;
      G.onGround = false;
      G.coyote = 0; G.jumpBuf = 0;
    }

    G.vel.y += GRAVITY * dt;
    if (G.vel.y < -30) G.vel.y = -30;

    G.stepAllowed = G.onGround;
    G.onGround = false;
    collideMove(p, { x: G.vel.x * dt, y: G.vel.y * dt, z: G.vel.z * dt });
    G.stepAllowed = false;

    /* покачивание камеры при ходьбе — только визуальный крен */
    const hs = Math.hypot(G.vel.x, G.vel.z);
    if (G.onGround && hs > 0.6) G.bobT += dt * (4.4 + hs * 0.5);
    G.bobAmp = G.onGround ? Math.min(1, hs / WALK) : 0;

    /* Пол по зонам. groundAt() возвращает уровень НОГ, а pos.y — это
       ГЛАЗА, поэтому к полу прибавляем EYE. Без этого камера стояла
       ровно на поверхности земли — игрок «сидел в земле». */
    const gy = groundAt(p.x, p.z) + EYE;
    if (p.y <= gy + 0.02) {
      p.y = gy; G.vel.y = 0; G.onGround = true;
    } else {
      G.onGround = false;
    }

    /* ЯМА: если игрок над открытым проёмом в потолке бункера
       (центральная шахта, люк дома 1, траншея) — земли там нет,
       он должен провалиться вниз до пола бункера. */
    const pitFloor = BUNKER_Y + EYE;
    if (p.y > pitFloor + 0.05 && p.y < EYE + 0.6 && inShaft(p.x, p.z)) {
      G.onGround = false;
      G.vel.y += GRAVITY * dt;
      if (G.vel.y < -30) G.vel.y = -30;
      p.y += G.vel.y * dt;
      if (p.y <= pitFloor) { p.y = pitFloor; G.vel.y = 0; G.onGround = true; }
    }

    /* жёсткий зажим: никогда ниже своего пола */
    if (p.y < gy) { p.y = gy; G.vel.y = 0; G.onGround = true; }
    if (p.y > gy + 400) { p.y = gy; G.vel.y = 0; }
  }

  /* ограничение арены */
  p.x = Math.max(-HALF + 0.8, Math.min(HALF - 0.8, p.x));
  p.z = Math.max(-HALF + 0.8, Math.min(HALF - 0.8, p.z));

  /* страховка: ниже пола в любом случае не уходим.
     ВО ВРЕМЯ лазания её применять нельзя: в проёме groundAt() отдаёт
     поверхность (0), и игрок не мог спуститься в бункер — его каждый
     кадр выталкивало обратно наверх. */
  if (!G.climbing) {
    const floor = groundAt(p.x, p.z) + EYE;
    if (p.y < floor) { p.y = floor; G.vel.y = 0; G.onGround = true; }
  }

  /* тряска и окно неуязвимости затухают */
  G.shake = Math.max(0, G.shake - dt * 2.2);
  G.hurtCd = Math.max(0, G.hurtCd - dt);

  /* Камера смотрит по направлению. Отдача, тряска и покачивание —
     только визуальный поворот: физику и прицел они не сдвигают. */
  G.bobRoll = Math.sin(G.bobT) * 0.012 * (G.bobAmp || 0);
  G.camera.rotation.order = 'YXZ';
  G.camera.rotation.y = G.yaw + (Math.random() - 0.5) * G.shake * 0.02;
  G.camera.rotation.x = G.pitch + G.recoil + (Math.random() - 0.5) * G.shake * 0.02;
  G.camera.rotation.z = (G.bobRoll || 0) + (Math.random() - 0.5) * G.shake * 0.03;
}

function applyCollisionOnly(pos) {
  G.colliders.forEach((c) => {
    /* pos.y — глаза, тело занимает [pos.y - EYE, pos.y - EYE + PLAYER_H] */
    const ovY = (pos.y - EYE) + PLAYER_H > c.min.y && (pos.y - EYE) < c.max.y;
    if (!ovY) return;
    const ovX = pos.x + PLAYER_R > c.min.x && pos.x - PLAYER_R < c.max.x;
    const ovZ = pos.z + PLAYER_R > c.min.z && pos.z - PLAYER_R < c.max.z;
    if (!ovX || !ovZ) return;
    const pushL = Math.abs(pos.x - (c.min.x - PLAYER_R));
    const pushR = Math.abs((c.max.x + PLAYER_R) - pos.x);
    const pushU = Math.abs(pos.z - (c.min.z - PLAYER_R));
    const pushD = Math.abs((c.max.z + PLAYER_R) - pos.z);
    const min = Math.min(pushL, pushR, pushU, pushD);
    if (min === pushL) pos.x = c.min.x - PLAYER_R;
    else if (min === pushR) pos.x = c.max.x + PLAYER_R;
    else if (min === pushU) pos.z = c.min.z - PLAYER_R;
    else pos.z = c.max.z + PLAYER_R;
  });
}

/* ---------- РАДАР УГРОЗЫ ---------- */
function updateThreat() {
  const p = G.camera.position;
  let nearest = null, nd = 1e9;
  G.memes.forEach((m) => {
    const d = Math.hypot(p.x - m.obj.position.x, p.z - m.obj.position.z);
    if (d < nd) { nd = d; nearest = m; }
  });
  const fill = $('#threatFill');
  const pct = Math.max(0, Math.min(100, 100 - (nd / 45) * 100));
  fill.style.width = pct + '%';
  let col = '#3ddc57';
  if (nd < 18) col = '#ffc531';
  if (nd < 9)  col = '#e03b3b';
  fill.style.background = col;
  $('#threatLabel').textContent = nearest
    ? `БЛИЖАЙШИЙ: ${nearest.label} ${nearest.name} · ${nd.toFixed(1)} М`
    : 'БЛИЖАЙШИЙ МЕМ: —';
}

/* ============================================================
   СОСТОЯНИЯ UI + ОБРАБОТКА ОШИБОК
   ============================================================ */
const UI = {
  LOADING: 'loading',   // загрузка ресурсов
  READY:   'ready',     // всё готово, ждём клик
  PLAYING: 'playing',   // активная игра
  PAUSED:  'paused',    // пауза
  ERROR:   'error'      // сбой
};

const Health = {
  three: false,       // THREE загружен
  scene: false,       // сцена создана
  map: false,         // карта построена
  memes: false,       // мемы заспавнены
  textures: 0,        // сколько текстур реально загрузилось
  texTotal: 0,
  lost: false         // контекст WebGL потерян
};

let uiState = UI.LOADING;
let fatalError = null;

/* --- переключение состояния интерфейса --- */
/* Никаких предупреждений про курсор и границы окна: всё, что нужно знать
   об управлении, лежит в «НАСТРОЙКИ». Здесь только поддерживаем ссылку
   «открыть в отдельном окне» — это ссылка, а не плашка. */
function updateLockNote() {
  const open = document.getElementById('lockOpen');
  if (open) open.href = location.pathname + '?autostart=1';
}

/* ============================================================
   НАСТРОЙКИ: управление и мышь
   ============================================================ */
let settingsBack = 'pause';   // 'play' — вернуться сразу в игру, 'pause' — в паузу

function syncSettingsUI() {
  const r = document.getElementById('sensRange');
  const v = document.getElementById('sensVal');
  if (r) r.value = String(Math.round(Opt.sens * 100));
  if (v) v.textContent = Opt.sens.toFixed(2) + '×';
  const t = document.getElementById('btnEdgeTurn');
  if (t) {
    t.textContent = Opt.edgeTurn ? 'ВКЛ' : 'ВЫКЛ';
    t.classList.toggle('off', !Opt.edgeTurn);
  }
}

function openSettings() {
  if (uiState === UI.PLAYING) { settingsBack = 'play'; pauseGame(); }
  else settingsBack = 'pause';
  const o = document.getElementById('settingsOverlay');
  if (o) o.classList.add('show');
  syncSettingsUI();
}

function closeSettings() {
  const o = document.getElementById('settingsOverlay');
  if (o) o.classList.remove('show');
  if (settingsBack === 'play') resumeGame();
  else setUI(UI.PAUSED);
}

function bindSettings() {
  const r = document.getElementById('sensRange');
  if (r) r.addEventListener('input', () => {
    Opt.sens = Math.min(3, Math.max(0.2, (+r.value || 100) / 100));
    const v = document.getElementById('sensVal');
    if (v) v.textContent = Opt.sens.toFixed(2) + '×';
    saveOpt();
  });
  const t = document.getElementById('btnEdgeTurn');
  if (t) t.addEventListener('click', () => {
    Opt.edgeTurn = !Opt.edgeTurn; syncSettingsUI(); saveOpt();
  });
  const c = document.getElementById('btnSettingsClose');
  if (c) c.addEventListener('click', closeSettings);
  const s = document.getElementById('btnSettings');
  if (s) s.addEventListener('click', openSettings);
  const g = document.getElementById('btnGear');
  if (g) g.addEventListener('click', openSettings);
  syncSettingsUI();
}

function openGameWindow() {
  const url = location.pathname + '?autostart=1&win=1';
  try {
    if (window.open(url, 'gooseStrike', 'width=1280,height=780')) return;
  } catch (e) {}
  /* окно не открылось — уводим текущую вкладку */
  try { location.href = url; } catch (e) {}
}

function setUI(state, payload) {
  uiState = state;
  document.body.dataset.state = state;
  document.documentElement.dataset.state = state;

  const $el = (id) => document.getElementById(id);
  const show = (id, on) => { const e = $el(id); if (e) e.classList.toggle('show', on); };

  show('loadOverlay', state === UI.LOADING);
  show('errorOverlay', state === UI.ERROR);
  show('pauseOverlay', state === UI.PAUSED);
  show('overOverlay', state === 'over' || state === 'over');
  show('settingsOverlay', false);

  const hud = $el('hud');
  if (hud) hud.classList.toggle('show', state === UI.PLAYING || state === UI.PAUSED);

  if (state === UI.ERROR && payload) {
    const t = $el('errTitle'), m = $el('errMsg'), d = $el('errDetail');
    if (t && payload.title) t.textContent = payload.title;
    if (m && payload.msg) m.textContent = payload.msg;
    if (d) d.textContent = payload.detail || '';
  }

  updateLockNote();
  /* во время катки курсор прячем и в родительском документе (если доступен) */
  syncParentCursor();
}
UI.GAME_OVER_ALIAS = 'over';

/* --- фатальная ошибка с человеческим текстом --- */
function fail(title, msg, detail) {
  fatalError = { title, msg, detail, time: new Date() };
  console.error('[GOOSE]', title, msg, detail || '');
  if (G.running) { G.running = false; }
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
  setUI(UI.ERROR, { title, msg, detail });
}

/* --- безопасная обёртка для критичных операций --- */
/* --- безопасная обёртка для критичных операций --- */
let bootFailed = false;

function guard(label, fn) {
  try { return fn(); }
  catch (e) {
    bootFailed = true;
    fail('СБОЙ ИНИЦИАЛИЗАЦИИ', 'Не удалось выполнить: ' + label,
      (e && e.stack) ? e.stack.split('\n').slice(0, 4).join('\n') : String(e));
    return null;
  }
}

/* --- прогресс загрузки --- */
const Load = {
  total: 13, done: 0,
  step(label) {
    this.done++;
    const pct = Math.min(100, Math.round((this.done / this.total) * 100));
    const f = document.getElementById('loadFill');
    const t = document.getElementById('loadTip');
    if (f) f.style.width = pct + '%';
    if (t && label) t.textContent = label;
  }
};

/* --- валидация зависимостей перед стартом --- */
function validateDependencies() {
  const problems = [];

  if (typeof THREE === 'undefined') problems.push('Three.js не загружен (lib/three.min.js)');
  if (!G.renderer) problems.push('WebGL-рендерер не создан');
  if (!G.scene) problems.push('Сцена не создана');
  if (!G.camera) problems.push('Камера не создана');
  if (!Health.map) problems.push('Карта не построена');
  if (!Health.memes || !G.memes.length) problems.push('Мемы не заспавнены (инвентарь пуст?)');
  if (!G.renderer || !G.renderer.domElement) problems.push('Canvas не добавлен в DOM');

  if (G.renderer) {
    const gl = G.renderer.getContext && G.renderer.getContext();
    if (!gl || (gl.isContextLost && gl.isContextLost())) problems.push('WebGL-контекст потерян');
  }

  return problems;
}

/* ============================================================
   ЦИКЛ
   ============================================================ */
let frameErrors = 0;

function loop() {
  requestAnimationFrame(loop);
  G.frames = (G.frames || 0) + 1;

  /* защита от зависания: считаем ошибки кадров */
  try {
    const dt = Math.min(G.clock.getDelta(), 0.05);
    /* если физика не двигает игрока по вертикали много кадров подряд — считаем */
    if (G.lastY === undefined) G.lastY = G.camera.position.y;
    if (Math.abs(G.camera.position.y - G.lastY) < 0.0001) G.framesNoY = (G.framesNoY || 0) + 1;
    else G.framesNoY = 0;
    G.lastY = G.camera.position.y;

    /* рендер идёт ВСЕГДА — иначе получаем чёрный экран */
    if (G.renderer && G.scene && G.camera) {
      if (G.running && !G.paused) {
        G.elapsed += dt;
        updatePlayer(dt);
        updateWeapon(dt);
        updateMemes(dt);
        updateWaves(dt);
        updateFx(dt);

        /* пассивная голда: +1 в секунду */
        G.goldAcc += dt * GOLD_PER_SEC;
        while (G.goldAcc >= 1) { G.goldAcc -= 1; G.gold += 1; }

        updateHud();
        updateThreat();
      }
      G.renderer.render(G.scene, G.camera);
    }

    frameErrors = 0;
  } catch (e) {
    frameErrors++;
    console.error('[GOOSE] ошибка кадра:', e);
    if (frameErrors > 3) {
      fail('ЗАВИСАНИЕ ИГРЫ', 'Игровой цикл упал несколько кадров подряд.',
        (e && e.message) || String(e));
    }
  }

  watchdog();
}

function updateHud() {
  const $el = (id) => document.getElementById(id);
  const g = $el('hudGold');
  if (g) g.textContent = G.gold.toLocaleString('ru-RU').replace(/\u00A0/g, ' ');

  const t = Math.floor(G.elapsed);
  const tm = $el('hudTimer');
  if (tm) tm.textContent =
    String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');

  const zone = G.camera.position.y - EYE < -1.5 ? 'В БУНКЕРЕ'
             : (G.camera.position.y - EYE > 1.5 ? 'НА ВЫСОТЕ' : 'НА ЗЕМЛЕ');
  const hz = $el('hudZone');
  if (hz) {
    hz.textContent = zone;
    hz.classList.toggle('underground', G.camera.position.y - EYE < -1.5);
  }

  /* --- здоровье --- */
  const hp = $el('hudHp');
  if (hp) hp.textContent = String(Math.ceil(G.hp));
  const hpf = $el('hudHpFill');
  if (hpf) {
    const frac = Math.max(0, G.hp / G.maxHp);
    hpf.style.width = (frac * 100) + '%';
    hpf.style.background = frac > 0.5 ? '#3ddc57' : frac > 0.25 ? '#ffc531' : '#e03b3b';
  }

  /* --- патроны --- */
  const am = $el('hudAmmo');
  if (am) am.textContent = G.reloading ? '··' : String(G.ammo);
  const rs = $el('hudReserve');
  if (rs) rs.textContent = String(G.reserve);
  const wn = $el('hudWeapon');
  if (wn) wn.textContent = G.reloading ? 'ПЕРЕЗАРЯДКА' : WEAPON.name;
  const wb = $el('hudAmmoBox');
  if (wb) wb.classList.toggle('reloading', G.reloading);

  /* --- волна и живые мемы --- */
  const wv = $el('hudWave');
  if (wv) wv.textContent = String(G.wave);
  let alive = 0;
  for (let i = 0; i < G.memes.length; i++) {
    if (!G.memes[i].dead && G.memes[i].dying <= 0) alive++;
  }
  const en = $el('hudEnemies');
  if (en) en.textContent = String(alive);
  const kl = $el('hudKills');
  if (kl) kl.textContent = String(G.kills);

  /* --- прицел расширяется от разброса --- */
  const ch = $el('crosshair');
  if (ch) {
    const px = 8 + G.spread * 620;
    ch.style.setProperty('--gap', px.toFixed(1) + 'px');
  }
}

/* сторожевой таймер: если катка идёт, а кадры не рисуются — сообщаем */
const Watch = { last: 0, warned: false };
function watchdog() {
  if (uiState !== UI.PLAYING) { Watch.last = performance.now(); Watch.warned = false; return; }
  /* Пока WebGL-контекст потерян, кадры законно не идут: это не зависание.
     Раньше на слабых/софтверных драйверах игра вылетала в «ОТСУТСТВИЕ
     ОТКЛИКА» ровно в момент восстановления контекста. */
  if (Health.lost) { Watch.last = performance.now(); Watch.warned = false; return; }
  const now = performance.now();
  if (now - Watch.last > 2500 && !Watch.warned) {
    Watch.warned = true;
    fail('ОТСУТСТВИЕ ОТКЛИКА', 'Игра перестала отвечать — кадры не отрисовываются.',
      'Возможно, видеокарта не справляется или вкладка свёрнута надолго.');
  }
  Watch.last = now;
}

/* ============================================================
   ПОЛНЫЙ ЭКРАН
   Если браузер не даёт захватить курсор (панель предпросмотра),
   курсор выезжает за пределы игрового поля и становится виден.
   В полном экране игра занимает весь экран — курсору некуда
   «уехать», и он остаётся скрытым.
   ============================================================ */
function enterFullscreen() {
  const el = document.documentElement;
  if (!el || !el.requestFullscreen || document.fullscreenElement) return;
  try {
    const p = el.requestFullscreen({ navigationUI: 'hide' });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) {}
}

/* Курсор за границей игры рисует уже родительская страница. Если фрейм
   того же происхождения (панель предпросмотра) — прячем курсор и там,
   чтобы он не появлялся, даже когда мышь уходит за пределы поля.
   Любая ошибка доступа (другое происхождение) просто игнорируется. */
function setParentCursor(hidden) {
  let d = null;
  try { d = (window.parent && window.parent !== window) ? window.parent.document : null; } catch (e) { d = null; }
  if (!d || !d.documentElement) return;
  try {
    const el = d.documentElement;
    if (hidden) {
      el.dataset.gsCursorHidden = '1';
      el.style.setProperty('cursor', 'none', 'important');
      if (d.body) d.body.style.setProperty('cursor', 'none', 'important');
    } else if (el.dataset.gsCursorHidden) {
      delete el.dataset.gsCursorHidden;
      el.style.removeProperty('cursor');
      if (d.body) d.body.style.removeProperty('cursor');
    }
  } catch (e) {}
}

/* Скрывать курсор родителю есть смысл, только когда игрок реально играет
   (кликнул в игру): иначе при загрузке страницы в панели у приложения
   пропал бы курсор ещё до начала катки. */
function syncParentCursor() {
  setParentCursor(uiState === UI.PLAYING && !!G.userTouched);
}

/* один раз, при первом клике, если захват курсора недоступен.
   Если захват работает — полный экран не навязываем. */
function requestFullscreenOnce() {
  if (G.fsTried || G.lockWorked) return;
  G.fsTried = true;
  enterFullscreen();
}

function updateFullscreenBtn() {
  const b = document.getElementById('btnFullscreen');
  if (b) b.textContent = document.fullscreenElement ? 'ВЫЙТИ ИЗ ПОЛНОГО ЭКРАНА' : 'ВО ВЕСЬ ЭКРАН';
}

/* ============================================================
   УПРАВЛЕНИЕ
   ============================================================ */
function bindControls() {
  /* разблокировка звука первым жестом пользователя */
  document.addEventListener('mousedown', () => Sfx.init());
  document.addEventListener('keydown', () => Sfx.init());

  addEventListener('keydown', (e) => {
    G.keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
    /* Прыжок: нажатие даёт буфер, удержание — банихоп.
       Пока Space зажат, буфер обновляется каждый кадр, поэтому сразу
       после приземления персонаж прыгает снова, без отпускания клавиши. */
    if (e.code === 'Space') {
      G.jumpHeld = true;
      if (!e.repeat) G.jumpPressed = true;
    }
    /* R — перезарядка */
    if (e.code === 'KeyR' && !e.repeat && uiState === UI.PLAYING && !G.paused) reloadWeapon();
    if (e.code === 'Escape') {
      const so = document.getElementById('settingsOverlay');
      if (so && so.classList.contains('show')) { closeSettings(); return; }
      if (G.running && !G.paused) pauseGame();
    }
  });
  addEventListener('keyup', (e) => {
    G.keys[e.code] = false;
    if (e.code === 'Space') G.jumpHeld = false;
  });
  /* потеря фокуса — клавиши «залипли» бы, а с банихопом это бесконечный прыжок */
  addEventListener('blur', () => { G.jumpHeld = false; G.keys = {}; });

  const cv = G.renderer.domElement;

  /* захват курсора СИНХРОННО внутри жеста — только так браузер разрешает */
  const grab = (e) => {
    if (uiState !== UI.PLAYING || G.paused) return;
    if (!G.userTouched) { G.userTouched = true; syncParentCursor(); }
    if (document.pointerLockElement === cv) return;
    requestLockWithFallback();
    /* захват не дали — уходим в полный экран, чтобы курсор не выезжал
       за пределы игрового поля */
    if (G.lockDenied) requestFullscreenOnce();
    else {
      /* захват решается асинхронно: если через 150 мс его так и нет —
         уходим в полный экран */
      setTimeout(() => { if (G.lockDenied && !G.lockWorked) requestFullscreenOnce(); }, 150);
    }
    if (e && e.type === 'mousedown') e.preventDefault();
  };
  cv.addEventListener('mousedown', grab);
  document.addEventListener('mousedown', (e) => {
    const t = e.target;
    if (t && t.closest && t.closest('button, a, .overlay')) return;
    grab(e);
  });

  /* --- огонь: ЛКМ, автоматический --- */
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const t = e.target;
    if (t && t.closest && t.closest('button, a, .overlay')) return;
    if (uiState !== UI.PLAYING || G.paused) return;
    G.firing = true;
    G.firePressed = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) G.firing = false;
  });
  addEventListener('blur', () => { G.firing = false; });

  /* Мышь — единственный источник поворота камеры, с захватом курсора и без.
     Один и тот же путь, одна чувствительность, никаких разгонов и мёртвых зон.
     Позиция курсора пишется всегда (HUD/отладка), на поворот она не влияет. */
  document.addEventListener('mousemove', (e) => {
    if (uiState !== UI.PLAYING || G.paused) return;
    G.mouseX = e.clientX; G.mouseY = e.clientY;

    /* Самое первое движение после старта (или после возврата курсора в окно)
       только запоминаем: у браузера ещё нет предыдущей точки, movementX/Y
       может прийти «от нуля» — получался рывок на пол-экрана.
       Дальше — ровно как во второй раз, без разгона. */
    if (!G.lookPrimed) { G.lookPrimed = true; G.mouseInside = true; return; }
    G.mouseInside = true;

    /* курсор зашёл в центральную зону — доворот у края можно включать */
    const bnx = (G.mouseX / window.innerWidth) * 2 - 1;
    const bny = (G.mouseY / window.innerHeight) * 2 - 1;
    if (Math.abs(bnx) <= EDGE_BAND && Math.abs(bny) <= EDGE_BAND) G.edgeArmed = true;

    const sens = LOOK_SENS * Opt.sens;
    G.yaw   -= e.movementX * sens;
    G.pitch -= e.movementY * sens;
    const lim = Math.PI / 2 - 0.02;
    G.pitch = Math.max(-lim, Math.min(lim, G.pitch));
  });

  /* браузер явно отказал в захвате — сразу включаем поворот без захвата */
  document.addEventListener('pointerlockerror', () => {
    G.lockDenied = true;
    updateLockNote();
    requestFullscreenOnce();
  });
  document.addEventListener('pointerlockchange', () => {
    const on = document.pointerLockElement === cv;
    G.lockDenied = !on;
    if (on) G.lockWorked = true;
    updateLockNote();
  });

  /* курсор в родительском документе возвращаем, когда игра уходит со сцены */
  addEventListener('pagehide', () => setParentCursor(false));
  addEventListener('beforeunload', () => setParentCursor(false));
  document.addEventListener('visibilitychange', () => {
    setParentCursor(!document.hidden && uiState === UI.PLAYING);
  });
  addEventListener('focus', syncParentCursor);
  const mouseOut = () => { G.mouseInside = false; G.lookPrimed = false; };
  addEventListener('blur', () => { setParentCursor(false); mouseOut(); });
  /* курсор покинул документ игры — следующее движение только «зацепится»
     за позицию, без рывка камеры */
  document.addEventListener('mouseleave', mouseOut);

  /* зажали ЛКМ и водим — поворот камеры работает всегда,
     даже если Pointer Lock запрещён политикой браузера */
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const t = e.target;
    if (t && t.closest && t.closest('button, a, .overlay')) return;
    G.dragLook = true;
  });
  document.addEventListener('mouseup', () => { G.dragLook = false; });
  addEventListener('blur', () => { G.dragLook = false; });

  /* колесо — тоже крутит камеру по горизонтали, если захвата нет */
  addEventListener('wheel', (e) => {
    if (document.pointerLockElement === cv) return;
    if (uiState !== UI.PLAYING || G.paused) return;
    G.yaw -= e.deltaY * 0.0012;
  }, { passive: true });

  /* позиция курсора — нужна только для подсказки о захвате */
  const fsBtn = document.getElementById('btnFullscreen');
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        try { document.exitFullscreen(); } catch (e) {}
      } else {
        enterFullscreen();
      }
    });
    updateFullscreenBtn();
  }
  document.addEventListener('fullscreenchange', () => {
    updateFullscreenBtn();
    updateLockNote();
  });

  const ow = document.getElementById('btnOpenWindow');
  if (ow) ow.addEventListener('click', openGameWindow);

  addEventListener('resize', () => {
    if (!G.renderer) return;
    G.camera.aspect = innerWidth / innerHeight;
    G.camera.updateProjectionMatrix();
    G.renderer.setSize(innerWidth, innerHeight);
  });
}

/* ============================================================
   ЖИЗНЕННЫЙ ЦИКЛ
   ============================================================ */
/* основной вход: клик по «ИГРАТЬ» */
function startGame(attempt) {
  attempt = attempt || 1;
  const btn = document.getElementById('btnRetry');
  if (btn) btn.disabled = true;

  /* 1. валидация всех зависимостей перед стартом */
  const problems = validateDependencies();
  if (problems.length) {
    fail('ИГРА НЕ ГОТОВА',
      'Не запустилось из-за проблем с ресурсами:',
      problems.map((p, i) => (i + 1) + '. ' + p).join('\n'));
    if (btn) btn.disabled = false;
    return false;
  }

  /* 2. инициализация катки под защитой */
  const ok = guard('подготовка уровня', () => {
    $('#overOverlay').classList.remove('show');
    $('#pauseOverlay').classList.remove('show');

    G.running = true; G.paused = false;
    G.gold = 0; G.goldAcc = 0; G.elapsed = 0;
    G.vel.set(0, 0, 0); G.yaw = 0; G.pitch = 0;

    /* боевые характеристики — с чистого листа */
    G.hp = PLAYER_HP;
    G.kills = 0; G.score = 0;
    G.ammo = WEAPON.mag; G.reserve = WEAPON.reserve;
    G.reloading = false; G.reloadT = 0; G.fireCd = 0; G.firing = false;
    G.firePressed = false; G.gunKick = 0;
    G.spread = WEAPON.spread; G.recoil = 0; G.shake = 0;
    G.coyote = 0; G.jumpBuf = 0; G.jumpPressed = false; G.stepAllowed = false;
    G.bobT = 0; G.bobRoll = 0; G.bobAmp = 0;
    G.wave = 1; G.waveState = 'fight'; G.waveT = 0;
    /* центрируем «виртуальный джойстик» — иначе первое же движение мыши
       даст рывок, если курсор после клика по «ИГРАТЬ» сместился от центра */
    /* Курсор считаем «вне окна»: первое движение мыши после старта только
       запоминает позицию и НЕ крутит камеру — иначе получался рывок. */
    G.mouseInside = false;
    G.lookPrimed = false;
    G.edgeArmed = false;
    G.mouseX = innerWidth / 2;
    G.mouseY = innerHeight / 2;
    G.camera.position.set(0, EYE, 26);

    /* эффекты прошлой катки — в мусор */
    G.fx.forEach((f) => { if (f.obj && f.obj.parent) f.obj.parent.remove(f.obj); });
    G.fx.length = 0;

    /* первая волна мемов */
    startWave(1);

    G.clock.getDelta();

    /* 3. первый рендер ДО захвата мыши — иначе чёрный экран */
    G.renderer.render(G.scene, G.camera);

    setUI(UI.PLAYING);
    updateHud();
    return true;
  });

  if (!ok) { if (btn) btn.disabled = false; return false; }

  /* 4. захват курсора — с обработкой отказа */
  requestLockWithFallback();
  if (btn) btn.disabled = false;
  /* отладочный доступ к состоянию: только при ?debug=1 */
  if (/[?&]debug=1/.test(location.search)) {
    window.G = G;
    G.inShaft = inShaft; G.rampAt = rampAt; G.groundAt = groundAt;
    G.inUnderground = inUnderground;
    G.beamAt = beamAt; G.beams = BEAMS;
    /* боевые функции — для автотестов */
    G.startWave = startWave;
    G.shoot = shoot;
    G.reloadWeapon = reloadWeapon;
    G.damageMeme = damageMeme;
    G.damagePlayer = damagePlayer;
    G.updateWeapon = updateWeapon;
    G.updateMemes = updateMemes;
    G.updateWaves = updateWaves;
    G.weapon = WEAPON;
    G.AI = AI;
    G.navIdx = navIdx;
    G.buildFlowField = buildFlowField;
  }
  return true;
}
/* Pointer Lock: тихо, без плашек и без падения */
/* Пробуем ВСЕГДА, даже внутри iframe: если панель разрешает захват,
   получим полноценный бесконечный поворот. Если нет — браузер откажет
   (pointerlockerror / reject), и включится свободный поворот + доворот
   у краёв экрана. */
function lockImpossible() {
  const cv = G.renderer && G.renderer.domElement;
  if (!cv || typeof cv.requestPointerLock !== 'function') return true;
  /* НЕ отказываем по document.hasFocus(): проверка часто ложно срабатывает
     (фокус может быть на дочернем узле, а не на document, или в момент
     клика ещё не перешёл). Лучше попробовать requestPointerLock внутри
     жеста — если браузер откажет, придёт pointerlockerror/reject и мы
     переключимся на свободный поворот. Так шанс получить настоящий захват
     курсора в реальном окне максимальный. */
  return false;
}

function requestLockWithFallback() {
  const cv = G.renderer && G.renderer.domElement;
  if (!cv || document.pointerLockElement === cv) return;
  if (lockImpossible()) { G.lockDenied = true; updateLockNote(); return; }
  /* страховка: через 300 мс смотрим факт. Если захвата нет — играем
     свободным поворотом, даже если браузер ничего не ответил. */
  setTimeout(() => {
    if (document.pointerLockElement !== cv) { G.lockDenied = true; updateLockNote(); }
  }, 300);
  try {
    const p = cv.requestPointerLock();
    if (p && typeof p.catch === 'function') {
      p.then(() => { G.lockDenied = false; G.lockWorked = true; updateLockNote(); })
       .catch(() => { G.lockDenied = true; updateLockNote(); requestFullscreenOnce(); });
    } else {
      /* старая версия API — узнаём результат по событию */
      setTimeout(() => {
        G.lockDenied = document.pointerLockElement !== cv;
      }, 120);
    }
  } catch (e) {
    G.lockDenied = true;   /* играем без захвата — мышь работает через dragLook */
  }
}

/* повторяем попытку при взаимодействии с игровым полем */
function installLockRetry() {
  const tryLock = (e) => {
    if (uiState !== UI.PLAYING || G.paused) return;
    const t = e && e.target;
    if (t && t.closest && t.closest('button, a, .overlay')) return;
    requestLockWithFallback();
  };
  document.addEventListener('mousedown', tryLock);
  document.addEventListener('keydown', tryLock);
}

function pauseGame() {
  if (uiState !== UI.PLAYING || G.paused) return;
  G.paused = true;
  G.running = false;
  G.firing = false;
  const ps = document.getElementById('pauseStats');
  if (ps) ps.textContent = 'Голды накоплено: ' + G.gold + ' G';
  setUI(UI.PAUSED);
  if (document.pointerLockElement) document.exitPointerLock();
}

function resumeGame() {
  if (uiState !== UI.PAUSED) return;
  G.paused = false; G.running = true;
  G.clock.getDelta();
  setUI(UI.PLAYING);
  requestLockWithFallback();
  saveGoldToMenu();
}

function gameOver(killer) {
  if (!G.running) return;
  G.running = false;
  G.firing = false;
  if (document.pointerLockElement) document.exitPointerLock();

  const t = Math.floor(G.elapsed);
  const k = document.getElementById('overKiller');
  if (k) {
    k.textContent = killer
      ? 'Тебя догнал ' + killer.label + ' · ' + killer.name
      : 'Ты не выжил';
  }
  const ot = document.getElementById('overTime');
  if (ot) ot.textContent =
    String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  const og = document.getElementById('overGold');
  if (og) og.textContent = G.gold.toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
  const om = document.getElementById('overMemes');
  if (om) om.textContent = String(G.kills);
  const ow = document.getElementById('overWave');
  if (ow) ow.textContent = String(G.wave);

  setUI('over');
  saveGoldToMenu();

  /* вспышка урона */
  const f = document.createElement('div');
  f.className = 'dmg-flash';
  document.body.appendChild(f);
  f.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 700 });
  setTimeout(() => f.remove(), 750);
}

function saveGoldToMenu() {
  try {
    const prev = parseInt(localStorage.getItem('gs_gold') || '0', 10) || 0;
    localStorage.setItem('gs_gold', String(prev + G.gold));
  } catch (e) { /* ignore */ }
}

/* ============================================================
   ЗАПУСК
   ============================================================ */
(function boot() {
  setUI(UI.LOADING);

  /* --- глобальные перехватчики: любая ошибка ведёт на экран сбоя --- */
  addEventListener('error', (e) => {
    if (uiState === UI.ERROR) return;
    fail('ОШИБКА', 'Непредвиденный сбой во время работы игры.',
      (e && e.message) || 'подробности в консоли');
  });
  addEventListener('unhandledrejection', (e) => {
    const msg = (e.reason && e.reason.message) || String(e.reason || '');
    /* отказ Pointer Lock — не ошибка, игра работает без него */
    if (/pointer lock/i.test(msg)) { e.preventDefault(); return; }
    if (uiState === UI.ERROR) return;
    fail('ОШИБКА', 'Промис завершился с ошибкой.', msg);
  });

  /* --- проверка Three.js --- */
  try {
    if (typeof THREE === 'undefined') throw new Error('lib/three.min.js не подключён');
    Health.three = true;
    Load.step('Библиотека Three.js загружена');
  } catch (e) {
    fail('РЕСУРСЫ НЕ ЗАГРУЖЕНЫ', 'Не удалось загрузить графическую библиотеку.',
      'Проверь наличие файла lib/three.min.js и обнови страницу.');
    return;
  }

  /* --- WebGL доступен? --- */
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) throw new Error('WebGL недоступен');
    Load.step('WebGL доступен');
  } catch (e) {
    fail('ВИДЕОКАРТА НЕ ПОДДЕРЖИВАЕТСЯ', 'Браузер не смог создать WebGL-контекст.',
      'Включи аппаратное ускорение в настройках браузера или обнови драйверы.');
    return;
  }

  /* --- построение сцены --- */
  guard('создание сцены', () => { initScene(); Health.scene = true; });
  if (bootFailed) return;
  Load.step('Сцена создана');

  /* каждый шаг отдельно — видно, где именно падает */
  guard('земля', () => buildGround());
  Load.step('Земля');

  guard('здания', () => { buildBuildings(); Health.buildings = true; });
  Load.step('Здания');

  guard('бункер', () => buildBunker());
  Load.step('Бункер');

  guard('подземные проходы', () => buildUnderground());
  Load.step('Подземные проходы');

  guard('деревья', () => buildTrees());
  Load.step('Деревья');

  guard('трава', () => buildGrass());
  Load.step('Трава');

  guard('укрытия', () => buildCover());
  Load.step('Укрытия');

  guard('навигация', () => buildNavGrid());
  Load.step('Навигация');

  Health.map = true;
  Load.step('Карта и бункер построены');

  guard('спавн мемов', () => { spawnMemes(); Health.memes = true; });
  Load.step('Мемы заспавнены');

  guard('привязка управления', () => { bindControls(); });

  /* --- готово: убираем загрузку и играем --- */
  const btnR = document.getElementById('btnResume');
  if (btnR) btnR.addEventListener('click', resumeGame);
  bindSettings();
  const rbR = document.getElementById('btnRestart');
  if (rbR) rbR.addEventListener('click', () => startGame());
  const rtR = document.getElementById('btnRetry');
  if (rtR) rtR.addEventListener('click', () => location.reload());

  Load.step('Готово');

  /* если что-то упало при загрузке — не стартуем, оставляем экран сбоя */
  if (bootFailed || uiState === UI.ERROR) return;

  setUI(UI.READY);
  startGame();

  /* управление и настройки мыши — в панели «НАСТРОЙКИ» (шестерёнка в HUD
     или кнопка в паузе), поверх игры ничего не висит */

  loop();
})();

