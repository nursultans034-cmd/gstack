// Автономная версия: локальный сервер на 127.0.0.1 отдаёт страницу и расчётное ядро
// и открывает браузер. Интернет и Claude не нужны.
// Сборка: bun run contrib/lifting-frame/desktop/build.ts
import html from '../index.html' with { type: 'text' };
import calc from '../frame-calc.js' with { type: 'text' };

// Постоянный порт: у браузера одно и то же «место», и сохранённые в форме данные не теряются между запусками.
const PORTS = [47815, 47816, 47817, 47818, 0];

function start() {
  for (const port of PORTS) {
    try {
      return Bun.serve({
        hostname: '127.0.0.1',
        port,
        fetch(req) {
          const { pathname } = new URL(req.url);
          if (pathname === '/' || pathname === '/index.html') {
            return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
          }
          if (pathname === '/frame-calc.js') {
            return new Response(calc, { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
          }
          return new Response('Не найдено', { status: 404 });
        },
      });
    } catch {
      // порт занят — пробуем следующий
    }
  }
  throw new Error('Не удалось открыть локальный порт.');
}

const server = start();
const url = `http://127.0.0.1:${server.port}/`;
console.log('Расчёт подъёмной рамы запущен.');
console.log(`Откройте в браузере: ${url}`);
console.log('Закройте это окно, чтобы завершить программу.');

const opener =
  process.platform === 'win32' ? ['cmd', '/c', 'start', '', url]
  : process.platform === 'darwin' ? ['open', url]
  : ['xdg-open', url];
if (!process.env.LIFTING_FRAME_NO_BROWSER) {
  try { Bun.spawn(opener, { stdout: 'ignore', stderr: 'ignore' }); } catch { /* адрес напечатан выше */ }
}
