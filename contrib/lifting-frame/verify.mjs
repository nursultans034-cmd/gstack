// Сверка ядра с расчётной запиской TR1224 (CLAUDE.md проекта). Запуск: node contrib/lifting-frame/verify.mjs
import { calculate, PRESET_TR1224, optimizeLiftPoints, cogMargin } from './frame-calc.js';

const r = calculate(structuredClone(PRESET_TR1224));
const expect = [
  ['доля 280°', r.pts[0].share, 0.3088, 0.0005],
  ['доля 160°', r.pts[1].share, 0.3207, 0.0005],
  ['доля 40°', r.pts[2].share, 0.3705, 0.0005],
  ['статика 40°, т', r.pts[2].P, 143.5, 0.2],
  ['V 280°, т', r.pts[0].V, 152.2, 0.3],
  ['V 40°, т', r.pts[2].V, 182.7, 0.3],
  ['h, м', r.h, 9.4, 0.001],
  ['ветвь 280°, м', r.pts[0].Lleg, 10.84, 0.01],
  ['угол 280°', r.pts[0].angle, 60.1, 0.1],
  ['натяжение 40°, т', r.pts[2].T, 202.5, 0.4],
  ['H, т', r.pts[1].H, 87.4, 0.2],
  ['ΣH, т', r.sumH, 0, 0.01],
  ['N 280–160, кН', -r.members.find((m) => m.label === '280°–160°' || m.label === '160°–280°').N, 467.6, 2],
  ['N 160–40, кН', -r.members.find((m) => m.label === '40°–160°' || m.label === '160°–40°').N, 513.9, 2],
  ['max H1-1', r.maxUtil, 0.43, 0.01],
  ['проушина: смятие', r.padeye.bearing.u, 0.45, 0.01],
  ['проушина: срез', r.padeye.shear.u, 0.28, 0.01],
  ['запас верх', r.upper[2].sf, 3.8, 0.05],
  ['запас низ', r.lower[2].sf, 4.3, 0.05],
  ['F_ст крана, т', r.Fst, 363, 0.1],
  ['высота крюка, м', r.hook, 26.0, 0.05],
];
let fail = 0;
for (const [name, got, want, tol] of expect) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(20)} ${got.toFixed(4).padStart(10)}  (ожидается ${want} ± ${tol})`);
}
for (const m of r.members) console.log(`     ${m.label}: L=${m.L.toFixed(2)} N=${m.N.toFixed(1)} λ=${m.check.lam.toFixed(1)} Fa=${m.check.Fa.toFixed(1)} fa=${m.check.fa.toFixed(1)} H1-1=${m.check.H11.toFixed(3)} H1-2=${m.check.H12.toFixed(3)} δ=${m.check.defl.toFixed(1)}`);
const auto = calculate({ ...structuredClone(PRESET_TR1224), frame: { ...PRESET_TR1224.frame, sectionMode: 'auto', massMode: 'auto' } });
console.log(`Автоподбор: ${auto.sec.name}, max ${auto.maxUtil.toFixed(2)}, рама ${auto.frameMass.toFixed(2)} т`);

// Подбор точек: ЦТ в центре, без запретов — должна выйти равномерная расстановка (доли ≈ 1/3).
const P0 = structuredClone(PRESET_TR1224);
const t0 = performance.now();
const o1 = optimizeLiftPoints(P0, { ...P0.placement, sectors: '' });
const gaps = o1[0].polar.map((p, i, a) => (a[(i + 1) % a.length].a - p.a + 360) % 360);
const evenOk = Math.max(...o1[0].shares) - Math.min(...o1[0].shares) < 0.01 && gaps.every((g) => Math.abs(g - 120) < 3);
if (!evenOk) fail++;
console.log(`${evenOk ? 'OK  ' : 'FAIL'} подбор, ЦТ в центре: углы ${o1[0].polar.map((p) => p.a.toFixed(0) + '°/' + p.r.toFixed(2)).join(', ')}; доли ${o1[0].shares.map((s) => s.toFixed(3)).join(' ')} (${(performance.now() - t0).toFixed(0)} мс)`);
// Смещённый ЦТ и сектор мачты: ни одна точка не в секторе, худшая доля не хуже, чем у текущих точек.
const P1 = structuredClone(PRESET_TR1224); P1.cargo.xg = 0.4; P1.cargo.yg = -0.2;
const o2 = optimizeLiftPoints(P1, P1.placement);
const inMast = o2[0].polar.some((p) => p.a >= 290 && p.a <= 310);
const cur = calculate(structuredClone(P1));
const better = Math.max(...o2[0].shares) <= Math.max(...cur.shares) + 1e-6 && !inMast;
if (!better) fail++;
console.log(`${better ? 'OK  ' : 'FAIL'} подбор, ЦТ (0,4; −0,2), мачта 290–310: ${o2[0].polar.map((p) => p.a.toFixed(0) + '°/' + p.r.toFixed(2)).join(', ')}; макс. доля ${Math.max(...o2[0].shares).toFixed(3)} против ${Math.max(...cur.shares).toFixed(3)} у текущих; запас по ЦТ ${o2[0].margin.toFixed(2)} м против ${cogMargin(P1.points, 0.4, -0.2).toFixed(2)}`);
process.exit(fail ? 1 : 0);
