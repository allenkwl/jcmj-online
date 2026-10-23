/* 端對端測試的共用部分（檔名開頭是底線、不是 .test.js —— run-tests.sh 不會把它當成一支測試跑）
   ‧ 計數與結尾（照其他測試的格式：「通過 N　失敗 M」「全部通過 ✓」）
   ‧ 找 Playwright：找不到就算失敗並說明怎麼裝，不能靜靜跳過（跳過等於沒有這道防線）
   ‧ 靜態伺服器：只送檔案、不快取
   ‧ openGame：開最新版遊戲（#test&mute：靜音、掛出唯讀的牌局狀態）                       */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');

function counter() {
  let pass = 0, fail = 0;
  const fails = [];
  return {
    ok(cond, name, detail) {
      if (cond) pass++;
      else { fail++; fails.push(name + (detail ? '　→ ' + detail : '')); }
    },
    finish() {
      console.log('\n─────────────────────────');
      console.log(`通過 ${pass}　失敗 ${fail}`);
      if (fail) { fails.forEach(f => console.log('  ✗ ' + f)); process.exitCode = 1; return; }
      console.log('全部通過 ✓');
    },
  };
}

function findChromium() {
  for (const p of ['playwright', path.join(os.homedir(), 'Documents/DILA/戰國麻將宣傳片/node_modules/playwright')]) {
    try { return require(p).chromium; } catch (_) {}
  }
  return null;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
function serve() {
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/^\/+/, '');
    const file = path.join(ROOT, rel || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

/* 開遊戲。E2E_FILE 可以指定別的檔（拿有問題的舊版確認測試抓得到錯）。
   回傳 { page, errors, latest, close } —— 用完一定要 close() */
async function openGame(chromium) {
  const latest = process.env.E2E_FILE || JSON.parse(fs.readFileSync(path.join(ROOT, 'latest.json'), 'utf8')).file;
  const srv = await serve();
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (process.env.E2E_DEBUG) page.on('console', m => console.log('  [console]', m.type(), m.text().slice(0, 200)));
  /* E2E_CPU=6：把這一頁的運算速度降成 1/6（Chrome 的 CPU 節流），模擬「電腦很忙」。
     有些錯只在整套測試一起跑、機器忙的時候才出現（2026-10-23 e2e-claims 情境 C 偶發逾時），
     單獨跑重現不了 —— 用這個開關直接把它逼出來。 */
  const cpu = +process.env.E2E_CPU || 0;
  if (cpu > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  }
  await page.goto(`http://127.0.0.1:${srv.address().port}/${encodeURI(latest)}#test&mute`);
  await page.waitForFunction(() => window.MJDev && window.__test, null, { timeout: 20000 * Math.max(1, cpu) });
  return { page, errors, latest, cpu, close: async () => { await browser.close(); srv.close(); } };
}

/* ── 本機 Firebase 模擬器（連線的端對端測試用）──
   用線上同一份規則（database.rules.json），完全在本機，不碰線上資料庫。
   要 Java（brew install openjdk）與 firebase CLI。回傳 { stop() } */
async function startEmulators(opts) {
  const { spawn } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jcmj-emu-'));
  // rules：預設用線上那份；要測還沒部署的規則（例如登入的 /players）傳 'database.rules.next.json'
  const rules = (opts && opts.rules) || 'database.rules.json';
  fs.copyFileSync(path.join(ROOT, fs.existsSync(path.join(ROOT, rules)) ? rules : 'database.rules.json'), path.join(dir, 'database.rules.json'));
  fs.writeFileSync(path.join(dir, 'firebase.json'), JSON.stringify({
    database: { rules: 'database.rules.json' },
    emulators: { database: { port: 9123, host: '127.0.0.1' }, auth: { port: 9099, host: '127.0.0.1' }, ui: { enabled: false } },
  }));
  const env = Object.assign({}, process.env, { PATH: '/opt/homebrew/opt/openjdk/bin:' + process.env.PATH });
  const proc = spawn('firebase', ['emulators:start', '--only', 'database,auth', '--project', 'jcmj-4p'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });
  const up = async () => {
    for (let i = 0; i < 120; i++) {
      if (/All emulators ready/.test(log)) return true;
      if (proc.exitCode != null) return false;
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  };
  if (!(await up())) { try { proc.kill('SIGINT'); } catch (_) {} throw new Error('Firebase 模擬器起不來：' + log.slice(-600)); }
  return {
    stop: () => new Promise(r => {
      proc.once('exit', () => { fs.rmSync(dir, { recursive: true, force: true }); r(); });
      try { proc.kill('SIGINT'); } catch (_) { r(); }
      setTimeout(r, 8000);
    }),
  };
}

module.exports = { ROOT, counter, findChromium, openGame, serve, startEmulators };
