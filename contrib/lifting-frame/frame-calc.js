// Расчёт подъёмной рамы (спредер-рамы) по данным груза.
// Схема: крюк → верхние ветви → плоская рама из труб → вертикальные нижние стропы → точки груза.
// Нормы: DNV-ST-N001 (нагрузки при подъёме), AISC ASD 9-е изд. (стальные элементы).
// Единицы: масса — т, длина — м (сечения — мм), силы — кН, напряжения — МПа.

export const G = 9.81;

// Трубы EN 10210 / EN 10219 (D × t, мм), по возрастанию массы внутри диаметра.
export const PIPE_CATALOG = [
  [168.3, 8], [168.3, 10], [219.1, 8], [219.1, 10], [219.1, 12.5],
  [273, 8], [273, 10], [273, 12.5], [323.9, 10], [323.9, 12.5], [323.9, 16],
  [355.6, 10], [355.6, 12.5], [355.6, 16], [406.4, 10], [406.4, 12.5], [406.4, 16],
  [457, 12.5], [457, 16], [508, 12.5], [508, 16], [508, 20], [610, 12.5], [610, 16], [610, 20],
].map(([D, t]) => ({ D, t }));

// S355: F_y по толщине (EN 10025-2).
export function fyS355(t) {
  if (t <= 16) return 355;
  if (t <= 40) return 345;
  if (t <= 63) return 335;
  if (t <= 80) return 325;
  if (t <= 100) return 315;
  return 295;
}

export function pipeSection(D, t) {
  const d = D - 2 * t;
  const A = (Math.PI / 4) * (D * D - d * d); // мм²
  const I = (Math.PI / 64) * (D ** 4 - d ** 4); // мм⁴
  const S = I / (D / 2); // мм³
  const r = Math.sqrt(I / A); // мм
  const massPerM = A * 1e-6 * 7850; // кг/м
  return { D, t, A, I, S, r, massPerM, name: `${D} × ${t}` };
}

// Доли нагрузки на точки по положению ЦТ.
// 3 точки — статически определимо (правило Крамера); 4 и более — решение с минимальной нормой
// (жёсткий груз, стропы одинаковой жёсткости), затем к нему применяется SKL.
export function loadShares(points, xg, yg) {
  const n = points.length;
  if (n < 3) throw new Error('Нужно не менее 3 точек подвеса.');
  // M = A·Aᵀ, A = [[1…],[x…],[y…]]
  const rows = [points.map(() => 1), points.map((p) => p.x), points.map((p) => p.y)];
  const M = rows.map((ri) => rows.map((rj) => ri.reduce((s, v, k) => s + v * rj[k], 0)));
  const lam = solve3(M, [1, xg, yg]);
  if (!lam) throw new Error('Точки подвеса лежат на одной прямой: раму рассчитать нельзя.');
  return points.map((p) => lam[0] + lam[1] * p.x + lam[2] * p.y);
}

function solve3(M, b) {
  const det = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (Math.abs(D) < 1e-9 * Math.max(1, Math.abs(M[0][0] * M[1][1] * M[2][2]))) return null;
  return [0, 1, 2].map((c) => det(M.map((row, i) => row.map((v, j) => (j === c ? b[i] : v)))) / D);
}

// Плоская шарнирная ферма методом перемещений. Нагрузка самоуравновешенная, поэтому
// узлы держат слабые пружины; если они заметно нагружены — схема изменяема (нужны связи).
export function solveTruss(nodes, members, loads, EA) {
  const n = nodes.length;
  const N = 2 * n;
  const K = Array.from({ length: N }, () => new Float64Array(N));
  const geo = members.map(([i, j]) => {
    const dx = nodes[j].x - nodes[i].x;
    const dy = nodes[j].y - nodes[i].y;
    const L = Math.hypot(dx, dy);
    return { i, j, L, c: dx / L, s: dy / L };
  });
  let kMin = Infinity;
  for (const m of geo) {
    const k = EA / (m.L * 1000); // EA в Н, L в мм → Н/мм; масштаб перемещений сокращается в N = k·Δu
    kMin = Math.min(kMin, k);
    const e = [m.c * m.c, m.c * m.s, m.s * m.s];
    const idx = [2 * m.i, 2 * m.i + 1, 2 * m.j, 2 * m.j + 1];
    const kl = [
      [e[0], e[1], -e[0], -e[1]],
      [e[1], e[2], -e[1], -e[2]],
      [-e[0], -e[1], e[0], e[1]],
      [-e[1], -e[2], e[1], e[2]],
    ];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) K[idx[a]][idx[b]] += k * kl[a][b];
  }
  const kSpring = kMin * 1e-7;
  for (let a = 0; a < N; a++) K[a][a] += kSpring;
  const F = new Float64Array(N);
  loads.forEach((f, i) => { F[2 * i] = f.x; F[2 * i + 1] = f.y; });
  const u = gauss(K, F);
  let springForce = 0;
  let loadSum = 0;
  for (let a = 0; a < N; a++) { springForce += Math.abs(kSpring * u[a]); loadSum += Math.abs(F[a]); }
  const forces = geo.map((m) => {
    const k = EA / (m.L * 1000);
    const du = (u[2 * m.j] - u[2 * m.i]) * m.c + (u[2 * m.j + 1] - u[2 * m.i + 1]) * m.s;
    return { ...m, N: k * du }; // + растяжение, − сжатие
  });
  return { forces, mechanism: springForce > 0.01 * loadSum };
}

function gauss(K, F) {
  const n = F.length;
  const A = K.map((row, i) => [...row, F[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      if (f) for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = A[r][n];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

// Проверка трубчатого стержня по AISC ASD 9-е изд. (H1-1, H1-2, H1-3).
export function checkMember({ sec, L, N, gammaM, daf, E, K }) {
  const Fy = fyS355(sec.t);
  const Lmm = L * 1000;
  const lam = (K * Lmm) / sec.r;
  const Cc = Math.sqrt((2 * Math.PI ** 2 * E) / Fy);
  const Fa = lam <= Cc
    ? ((1 - lam ** 2 / (2 * Cc ** 2)) * Fy) / (5 / 3 + (3 * lam) / (8 * Cc) - lam ** 3 / (8 * Cc ** 3))
    : (12 * Math.PI ** 2 * E) / (23 * lam ** 2);
  const Fe = (12 * Math.PI ** 2 * E) / (23 * lam ** 2);
  const Ft = 0.6 * Fy;
  // Компактность трубы: D/t ≤ 3300/F_y[ksi] — иначе F_b = 0,6F_y; предел местной устойчивости 13000/F_y[ksi].
  const Fyksi = Fy / 6.895;
  const DtRatio = sec.D / sec.t;
  const compact = DtRatio <= 3300 / Fyksi;
  const Fb = (compact ? 0.66 : 0.6) * Fy;
  const fa = (Math.abs(N) * 1000 * gammaM) / sec.A;
  const w = (sec.massPerM * G) / 1000; // Н/мм
  const M = (w * Lmm ** 2) / 8; // Н·мм, от собственного веса
  const fb = (M * daf * gammaM) / sec.S;
  const defl = (5 * w * Lmm ** 4) / (384 * E * sec.I);
  let H11, H12, H13 = null, mode;
  if (N < 0) {
    mode = 'сжатие';
    H11 = fa / Fa + fb / ((1 - fa / Fe) * Fb);
    H12 = fa / Ft + fb / Fb;
    if (fa / Fa <= 0.15) H13 = fa / Fa + fb / Fb;
  } else {
    mode = 'растяжение';
    H11 = fa / Ft + fb / Fb;
    H12 = H11;
  }
  const warnings = [];
  if (N < 0 && lam > 200) warnings.push(`гибкость ${lam.toFixed(0)} > 200`);
  if (N < 0 && fa >= Fe) warnings.push('f_a ≥ F′e — потеря устойчивости');
  if (DtRatio > 13000 / Fyksi) warnings.push(`D/t = ${DtRatio.toFixed(1)} — местная потеря устойчивости`);
  const util = Math.max(H11, H12, H13 ?? 0, fa >= Fe && N < 0 ? 9.99 : 0, N < 0 && lam > 200 ? 9.99 : 0);
  return { Fy, lam, Cc, Fa, Fe, Ft, Fb, fa, fb, M: M / 1e6, defl, H11, H12, H13, mode, compact, util, warnings };
}

// Проушина: растяжение по ослабленному сечению, срез (вырыв), смятие.
export function checkPadeye({ F_kN, tMain, tCheek, nCheek, R, dHole, dPin, oop, e, Lb }) {
  const t = tMain + nCheek * tCheek;
  const Fy = Math.min(fyS355(tMain), nCheek ? fyS355(tCheek) : Infinity);
  const F = F_kN * 1000;
  const sigT = F / ((2 * R - dHole) * t);
  const tauV = F / (2 * (R - dHole / 2) * t);
  const sigB = F / (dPin * t);
  const res = {
    t, Fy,
    tension: { f: sigT, allow: 0.6 * Fy, u: sigT / (0.6 * Fy) },
    shear: { f: tauV, allow: 0.4 * Fy, u: tauV / (0.4 * Fy) },
    bearing: { f: sigB, allow: 0.9 * Fy, u: sigB / (0.9 * Fy) },
    clearance: dHole - dPin,
    clearancePct: ((dHole - dPin) / dPin) * 100,
    oopForce: F_kN * oop,
  };
  if (Lb > 0 && e > 0) {
    // Корень основной пластины: осевое + изгиб из плоскости (5 % F на плече e). Предварительно.
    const FyM = fyS355(tMain);
    const fa = F / (Lb * 1000 * tMain);
    const fb = (F * oop * e * 1000) / ((Lb * 1000 * tMain ** 2) / 6);
    res.base = { fa, fb, u: fa / (0.6 * FyM) + fb / (0.75 * FyM) };
  }
  res.util = Math.max(res.tension.u, res.shear.u, res.bearing.u, res.base?.u ?? 0);
  return res;
}

// Порядок узлов по обходу вокруг ЦТ — для контура рамы.
export function perimeterOrder(points, xg, yg) {
  return points
    .map((p, i) => ({ i, a: Math.atan2(p.x - xg, p.y - yg) }))
    .sort((a, b) => a.a - b.a)
    .map((o) => o.i);
}

export function buildMembers(points, xg, yg, topology) {
  const order = perimeterOrder(points, xg, yg);
  const n = order.length;
  const members = order.map((id, k) => [id, order[(k + 1) % n]]);
  if (topology === 'diagonals' && n >= 4) {
    for (let a = 0; a < n; a++) {
      for (let b = a + 2; b < n; b++) {
        if (a === 0 && b === n - 1) continue;
        members.push([order[a], order[b]]);
      }
    }
  }
  return members;
}

// Полный расчёт для заданного сечения.
function runWithSection(input, sec) {
  const { cargo, points, frame, rigging, factors } = input;
  const n = points.length;
  const xg = cargo.xg, yg = cargo.yg;
  const shares = loadShares(points, xg, yg);
  if (shares.some((s) => s <= 0)) {
    throw new Error('ЦТ лежит вне опорного контура точек подвеса: одна из долей ≤ 0.');
  }
  const skl = n === 3 ? 1 : factors.skl;
  const Wd = cargo.mass * cargo.kWeight;

  const members = buildMembers(points, xg, yg, frame.topology);
  const memberLen = members.map(([i, j]) => Math.hypot(points[j].x - points[i].x, points[j].y - points[i].y));
  const pipeMass = (memberLen.reduce((s, L) => s + L, 0) * sec.massPerM) / 1000;
  const frameMass = frame.massMode === 'manual' ? frame.manualMass : pipeMass * frame.nodeFactor;

  const kc = cargo.kCoG * skl;
  const pts = points.map((p, i) => {
    const P = Wd * shares[i] * kc; // статика на точку груза, т
    const V = (Wd + frameMass + rigging.lowerMass) * shares[i] * kc * factors.daf; // на узел рамы, т
    return { ...p, share: shares[i], P, V, d: Math.hypot(p.x - xg, p.y - yg) };
  });

  const minAng = (frame.minAngle * Math.PI) / 180;
  const hReq = Math.max(...pts.map((p) => p.d)) * Math.tan(minAng);
  const h = frame.hMode === 'auto' ? Math.ceil(hReq * 10 - 1e-9) / 10 : frame.h;

  const loads = [];
  let sumHx = 0, sumHy = 0;
  for (const p of pts) {
    p.Lleg = Math.hypot(p.d, h);
    p.angle = (Math.atan2(h, p.d) * 180) / Math.PI;
    p.T = (p.V * p.Lleg) / h;
    p.H = (p.V * p.d) / h;
    const ux = p.d > 0 ? (xg - p.x) / p.d : 0;
    const uy = p.d > 0 ? (yg - p.y) / p.d : 0;
    loads.push({ x: p.H * G * ux, y: p.H * G * uy });
    sumHx += p.H * ux; sumHy += p.H * uy;
  }

  const truss = solveTruss(points, members, loads, factors.E * sec.A);
  const memberResults = truss.forces.map((m) => ({
    ...m,
    label: `${points[m.i].name}–${points[m.j].name}`,
    check: checkMember({ sec, L: m.L, N: m.N, gammaM: factors.gammaMember, daf: factors.daf, E: factors.E, K: frame.K }),
  }));
  const maxUtil = Math.max(...memberResults.map((m) => m.check.util));

  // Проушины рамы (верхние) — по максимальному натяжению ветви.
  const Tmax = Math.max(...pts.map((p) => p.T));
  const pad = input.padeye;
  const padeye = checkPadeye({
    F_kN: Tmax * factors.gammaPadeye * G,
    tMain: pad.tMain, tCheek: pad.tCheek, nCheek: pad.nCheek, R: pad.R,
    dHole: pad.dHole, dPin: pad.dPin, oop: factors.outOfPlane, e: pad.e, Lb: pad.Lb,
  });

  // Такелаж
  const upper = pts.map((p) => ({ name: p.name, F: p.T * G, sf: rigging.upperMBL / (p.T * G), shackle: p.T / factors.daf }));
  const lower = pts.map((p) => ({ name: p.name, F: p.P * factors.daf * G, sf: rigging.lowerMBL / (p.P * factors.daf * G) }));

  // Высоты
  const zTop = Math.max(...points.map((p) => p.z));
  const zFrame = zTop + rigging.hwLower + rigging.lowerLength;
  const hook = zFrame + h + rigging.hwUpper;
  for (const p of pts) p.lowerLen = zFrame - rigging.hwLower - p.z;
  // Габарит буя: палуба = спайдер + корпус; выше палубы — рубка и мачты.
  const b = input.buoy;
  const deck = b.spider + b.hullH;
  const obstacle = deck + Math.max(b.houseH, b.mast);
  const clearance = zFrame - obstacle;

  const Fst = Wd + frameMass + rigging.lowerMass + rigging.upperMass;
  const craneRec = Math.ceil((Fst * 1.1) / 10) * 10;

  return {
    sec, Wd, skl, shares, pts, h, hReq, members: memberResults, mechanism: truss.mechanism,
    sumH: Math.hypot(sumHx, sumHy), maxUtil, pipeMass, frameMass, padeye, Tmax, upper, lower,
    zFrame, hook, deck, obstacle, clearance, Fst, craneRec,
  };
}

// Главная функция. При frame.sectionMode === 'auto' подбирает самое лёгкое сечение,
// проходящее все проверки стержней с коэффициентом использования ≤ frame.targetUtil.
export function calculate(input) {
  if (input.frame.sectionMode === 'auto') {
    const sorted = PIPE_CATALOG.map((p) => pipeSection(p.D, p.t)).sort((a, b) => a.massPerM - b.massPerM);
    const tried = [];
    for (const sec of sorted) {
      const r = runWithSection(input, sec);
      tried.push({ name: sec.name, massPerM: sec.massPerM, util: r.maxUtil });
      if (r.maxUtil <= input.frame.targetUtil && !r.mechanism) return { ...r, tried };
    }
    const r = runWithSection(input, sorted[sorted.length - 1]);
    return { ...r, tried, noSection: true };
  }
  return runWithSection(input, pipeSection(input.frame.D, input.frame.t));
}

// Исходные данные: буй CALM TR1224 (КТК-Р, проект 1-1962-0).
export const PRESET_TR1224 = {
  cargo: { name: 'Буй CALM TR1224', mass: 320, kWeight: 1.1, kCoG: 1.1, xg: 0, yg: 0 },
  points: [
    { name: '280°', ...polar(280, 5.4), z: 7.3, wll: 300 },
    { name: '160°', ...polar(160, 5.2), z: 7.3, wll: 300 },
    { name: '40°', ...polar(40, 4.5), z: 7.3, wll: 250 },
  ],
  factors: { daf: 1.25, skl: 1.25, gammaMember: 1.15, gammaPadeye: 1.3, outOfPlane: 0.05, E: 205000 },
  frame: {
    hMode: 'auto', h: 9.4, minAngle: 60, sectionMode: 'manual', D: 323.9, t: 12.5,
    targetUtil: 0.9, massMode: 'manual', manualMass: 4.5, nodeFactor: 1.8, topology: 'perimeter', K: 1,
  },
  padeye: { tMain: 70, tCheek: 40, nCheek: 2, R: 300, dHole: 135, dPin: 130, e: 0.35, Lb: 0.8 },
  rigging: {
    lowerLength: 8.5, hwLower: 0.8, hwUpper: 0, lowerMass: 2.0, upperMass: 4.5,
    upperMBL: 7599, lowerMBL: 7599, sfReq: 3.0, shackleUpper: 250,
  },
  // Корпус Ø12 × 5,3 м, спайдер ~1,5 м, рубка Ø9 × 4 м, навигационная мачта ~8 м над палубой.
  buoy: { hullD: 12, hullH: 5.3, spider: 1.5, houseD: 9, houseH: 4, mast: 8 },
};

export function polar(angleDeg, r) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: round(r * Math.sin(a), 4), y: round(r * Math.cos(a), 4) };
}

function round(v, d) {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
