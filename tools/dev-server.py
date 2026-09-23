#!/usr/bin/env python3
"""開發用伺服器 + 啟動台的後端。

    python3 tools/dev-server.py [port] [root]

跟 `python3 -m http.server` 的兩個差別：

1. **送 no-store。**
   預設的 http.server 不送任何快取標頭，瀏覽器就會用啟發式快取 ——
   改完 src/*.js 重新整理，載進去的還是舊檔。
   這個坑很難察覺：畫面看起來有更新（HTML 變了），但模組是舊的。

2. **多了 /api/*，給啟動台用。**
   仿小球貓電鐵的 `scripts/tool_server.js`：
     GET /api/index  專案盤點（主程式、工具、文件、資產統計）
     GET /api/tests   跑一次 tools/run-tests.sh，回傳結果

⚠️ 這是**本機開發工具**，只綁 127.0.0.1。不要拿去對外服務。
"""
import functools
import http.server
import io
import json
import os
import re
import subprocess
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def dir_size(path):
    total = 0
    for dp, _, fn in os.walk(path):
        for f in fn:
            try:
                total += os.path.getsize(os.path.join(dp, f))
            except OSError:
                pass
    return total


def count_lines(path):
    try:
        with io.open(path, encoding='utf-8', errors='replace') as f:
            return sum(1 for _ in f)
    except OSError:
        return 0


VER_RE = re.compile(r'^(?P<fam>.+?)[ _-]?v(?P<ver>\d+(?:\.\d+)*)$')
META_RE = re.compile(
    r'<meta\s+name=["\'](?P<k>launcher-[a-z]+|description)["\']\s+content=["\'](?P<v>[^"\']*)["\']',
    re.I)
TITLE_RE = re.compile(r'<title>(.*?)</title>', re.I | re.S)
COMMENT_RE = re.compile(r'<!--.*?-->', re.S)


def read_tool_meta(path):
    """從工具檔自己的 <title> / <meta> 讀出它要怎麼被顯示。

    電鐵是把說明寫死在啟動台的 META 表裡，新增工具要回頭改啟動台。
    這裡改成工具自我描述 —— 丟進 devtools/ 就會自己出現、自己帶名字和說明：

        <title>牌面檢視器</title>
        <meta name="description" content="一次看完 34 張牌面">
        <meta name="launcher-icon" content="🀄">
        <meta name="launcher-cat"  content="美術">
        <meta name="launcher-needs-server" content="1">   <!-- 不能雙擊開的工具 -->

    只讀前 8 KB，工具檔可能內嵌很大的資料。
    """
    info = {}
    try:
        with io.open(path, encoding='utf-8', errors='replace') as f:
            head = f.read(8192)
    except OSError:
        return info

    # 先剝掉 HTML 註解再解析。
    # 工具檔的開頭常常有一段說明，裡面會照抄 `<title>…</title>` 當範例 ——
    # 不剝的話抓到的是範例那一行（實測牌面檢視器的標題就變成「…」）。
    head = COMMENT_RE.sub('', head)
    cut = head.find('<!--')          # 8 KB 截斷處可能留下沒收尾的註解
    if cut >= 0:
        head = head[:cut]

    # 需要伺服器的工具（例如要跨 iframe 存取的）。啟動台看到就用 http:// 連。
    if re.search(r'<meta\s+name=["\']launcher-needs-server["\']', head, re.I):
        info['needsServer'] = True

    m = TITLE_RE.search(head)
    if m:
        info['title'] = ' '.join(m.group(1).split())
    for m in META_RE.finditer(head):
        k = m.group('k').lower()
        v = m.group('v').strip()
        if k == 'description':
            info.setdefault('sub', v)
        elif k == 'launcher-icon':
            info['ico'] = v
        elif k == 'launcher-cat':
            info['cat'] = v
        elif k == 'launcher-sub':
            info['sub'] = v
    return info


def scan_tools(dirs, skip):
    """掃 HTML 工具，依「家族」分組，版號最大的當代表、其餘收進舊版。

    檔名 `牌面檢視器v0.2.html` → 家族「牌面檢視器」、版號 0.2。
    沒有版號的就自成一族。跟電鐵的 /api/tools 同一個規則。
    """
    fams = {}
    for d in dirs:
        base = os.path.join(ROOT, d) if d else ROOT
        if not os.path.isdir(base):
            continue
        for f in sorted(os.listdir(base)):
            if not f.endswith('.html') or f in skip:
                continue
            stem = f[:-5]
            m = VER_RE.match(stem)
            fam = m.group('fam') if m else stem
            ver = m.group('ver') if m else ''
            rel = (d + '/' + f) if d else f
            entry = {'ver': ver, 'rel': rel}
            rec = fams.setdefault(fam, {'family': fam, 'all': []})
            rec['all'].append(entry)
            # 代表版：版號最大的；都沒版號就用第一個
            cur = rec.get('newest')
            def key(e):
                return [int(x) for x in e['ver'].split('.')] if e['ver'] else [-1]
            if cur is None or key(entry) > key(cur):
                rec['newest'] = entry

    out = []
    for fam, rec in sorted(fams.items()):
        rec['all'].sort(key=lambda e: ([int(x) for x in e['ver'].split('.')] if e['ver'] else [-1]),
                        reverse=True)
        rec['count'] = len(rec['all'])
        rec.update(read_tool_meta(os.path.join(ROOT, rec['newest']['rel'])))
        out.append(rec)
    return out


def build_index():
    """掃專案，列出啟動台要顯示的東西。掃出來的，不是寫死的 ——
       新增模組或工具會自己出現。"""
    def rel(*p):
        return os.path.join(ROOT, *p)

    modules = []
    src = rel('src')
    if os.path.isdir(src):
        for f in sorted(os.listdir(src)):
            if f.endswith('.js'):
                modules.append({'file': 'src/' + f, 'lines': count_lines(os.path.join(src, f))})

    tools = []
    td = rel('tools')
    if os.path.isdir(td):
        for f in sorted(os.listdir(td)):
            if f.endswith(('.py', '.sh')):
                tools.append({'file': 'tools/' + f})

    docs = []
    for f in ['PLAN.md', 'CLAUDE.md']:
        if os.path.exists(rel(f)):
            docs.append({'file': f})
    dd = rel('docs')
    if os.path.isdir(dd):
        for f in sorted(os.listdir(dd)):
            if f.endswith('.md'):
                docs.append({'file': 'docs/' + f})

    tests = []
    td2 = rel('test')
    if os.path.isdir(td2):
        for f in sorted(os.listdir(td2)):
            if f.endswith('.test.js'):
                tests.append({'file': 'test/' + f})

    assets = {}
    for name in ['assets', 'assets/avatar', 'assets/table']:
        p = rel(*name.split('/'))
        if os.path.isdir(p):
            n = sum(1 for dp, _, fn in os.walk(p) for f in fn)
            assets[name] = {'bytes': dir_size(p), 'files': n}

    # 主程式：latest.json 指的那一版（遊戲檔名帶版號，每次改版另存新檔）。
    # 舊版本的檔案也留在根目錄，但不列成開發小工具。
    apps = []
    latest = latest_game()
    if latest:
        apps.append({'file': latest, 'lines': count_lines(rel(latest))})
    versions = {f for f in os.listdir(ROOT) if f.startswith(GAME_PREFIX) and f.endswith('.html')}

    # 開發小工具：devtools/ 底下，外加根目錄其他的 html（電鐵是全放根目錄）
    devtools = scan_tools(['devtools', ''], skip={'啟動台.html', 'index.html'} | versions)

    return {
        'ok': True,
        'root': ROOT,
        'apps': apps,
        'devtools': devtools,
        'modules': modules,
        'tools': tools,
        'docs': docs,
        'tests': tests,
        'assets': assets,
    }


def run_tests():
    script = os.path.join(ROOT, 'tools', 'run-tests.sh')
    if not os.path.exists(script):
        return {'ok': False, 'error': '找不到 tools/run-tests.sh'}
    try:
        p = subprocess.run(['bash', script], cwd=ROOT, capture_output=True,
                           text=True, timeout=300)
        return {'ok': p.returncode == 0, 'code': p.returncode,
                'out': p.stdout + (p.stderr or '')}
    except subprocess.TimeoutExpired:
        return {'ok': False, 'error': '測試跑超過 5 分鐘，逾時'}


class Handler(http.server.SimpleHTTPRequestHandler):
    # Markdown 用 text/plain 送，瀏覽器才會顯示而不是下載
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map['.md'] = 'text/plain; charset=utf-8'

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def _json(self, payload, code=200):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path != '/api/layout':
            return self._json({'ok': False, 'error': 'unknown endpoint'}, 404)
        try:
            n = int(self.headers.get('Content-Length') or 0)
            tune = json.loads(self.rfile.read(n).decode('utf-8') or '{}')
            changed = save_layout(tune)
            print('layout.js 已更新：' + ('、'.join(changed) if changed else '（沒有變動）'), flush=True)
            return self._json({'ok': True, 'changed': changed})
        except Exception as e:
            return self._json({'ok': False, 'error': str(e)}, 500)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == '/api/index':
            ix = build_index()
            write_devtools_manifest(ix)
            return self._json(ix)
        if path == '/api/tests':
            return self._json(run_tests())
        return super().do_GET()

    def log_message(self, fmt, *args):
        if not args or str(args[1]).startswith(('2', '3')):
            return
        super().log_message(fmt, *args)


def save_layout(tune):
    """把對戰畫面編輯器調好的數值寫回 src/layout.js。

       ⚠️ **只換數字，不重寫整個檔案。** TUNE 裡面每一組上面都有一段註解，
       說明那個數字是怎麼來的、改了會怎樣（例如「原本 44，2000px 寬的螢幕整桌很空」）。
       用產生器重吐一份會把那些全部洗掉 —— 那些註解是這個專案最貴的東西。

       作法：先框出 `const TUNE = {` 到對應的 `};`，
       再按群組逐一把 `key: 數字,` 的數字換掉，其餘一個字不動。"""
    path = os.path.join(ROOT, 'src', 'layout.js')
    with io.open(path, encoding='utf-8') as f:
        src = f.read()

    start = src.index('const TUNE = {')
    end = src.index('\n};', start) + 3
    block = src[start:end]

    changed, missing = [], []
    for group, vals in (tune or {}).items():
        if not isinstance(vals, dict):
            continue
        # 框出這一組：`  own: {` 到同一層的 `  },`
        gm = re.search(r'^  %s:\s*\{' % re.escape(group), block, re.M)
        if not gm:
            continue
        gend = block.index('\n  },', gm.end())
        gtext = block[gm.end():gend]
        new_gtext = gtext
        for key, val in vals.items():
            if not isinstance(val, (int, float)):
                continue
            num = ('%g' % val)
            # ⚠️ 不能用 ^ 錨在行首。TUNE 裡有好幾組是**多個鍵寫在同一行**的
            # （例如 `minW: 90, vmin: 38, maxW: 380,`），錨行首的話那些鍵
            # 永遠比對不到，會變成「只存了一半」而且毫無提示。
            # \b 是為了不讓 maxW 被 minW／W 之類的子字串誤中。
            km = re.search(r'(^|,)(\s*\b%s\s*:\s*)([-\d.]+)' % re.escape(key),
                           new_gtext, re.M)
            if not km:
                missing.append('%s.%s' % (group, key))
                continue
            if km.group(3) != num:
                changed.append('%s.%s %s → %s' % (group, key, km.group(3), num))
            new_gtext = (new_gtext[:km.start()] + km.group(1) + km.group(2) + num
                         + new_gtext[km.end():])
        block = block[:gm.end()] + new_gtext + block[gend:]

    out = src[:start] + block + src[end:]
    # 有鍵對不到就**整個不寫**。寫一半會讓 layout.js 跟編輯器上看到的不一致，
    # 而那種不一致下次只會在別的地方冒出來，很難查。
    if missing:
        raise ValueError('這些設定在 src/layout.js 裡找不到，沒有寫入：' + '、'.join(missing))
    if out != src:
        with io.open(path, 'w', encoding='utf-8') as f:
            f.write(out)
    return changed


def write_devtools_manifest(ix=None):
    """把掃到的小工具清單寫成 devtools/index.js。

       為什麼需要這支：啟動台雙擊開（file://）的時候掃不到硬碟，
       只能靠頁面裡寫死的後備清單 —— 結果新做的工具不會出現，
       而「丟進 devtools/ 就會自己出現」正是這個設計的賣點。

       寫成 <script> 載得動的 .js 而不是 .json，理由跟 assets/manifest.js
       一樣：fetch() 在 file:// 會被 CORS 擋。
       ⚠️ 不要改成 .json。

       伺服器啟動時寫一次、每次 /api/index 也寫一次，
       所以只要用開發伺服器跑過一次，雙擊版的清單就是新的。"""
    try:
        data = (ix or build_index()).get('devtools', [])
        out = os.path.join(ROOT, 'devtools', 'index.js')
        body = ('/* 由 tools/dev-server.py 自動產生，不要手改。\n'
                '   用途：啟動台以 file:// 開啟時掃不到硬碟，靠這份清單顯示小工具。 */\n'
                'window.MJDevtools = ' + json.dumps(data, ensure_ascii=False, indent=1) + ';\n')
        old = ''
        if os.path.exists(out):
            with io.open(out, encoding='utf-8') as f:
                old = f.read()
        if old != body:
            with io.open(out, 'w', encoding='utf-8') as f:
                f.write(body)
    except Exception as e:                      # 寫不出來不該讓伺服器掛掉
        print('devtools/index.js 寫入失敗：', e, flush=True)


GAME_PREFIX = '戰國麻將線上v'


def latest_game():
    """latest.json 指的遊戲檔（例如 戰國麻將線上v1.00.html）。讀不到就挑版號最大的。"""
    try:
        with io.open(os.path.join(ROOT, 'latest.json'), encoding='utf-8') as f:
            name = json.load(f).get('file')
        if name and os.path.exists(os.path.join(ROOT, name)):
            return name
    except Exception:
        pass
    vs = [f for f in os.listdir(ROOT) if f.startswith(GAME_PREFIX) and f.endswith('.html')]
    def ver(f):
        try: return tuple(int(x) for x in f[len(GAME_PREFIX):-5].split('.'))
        except ValueError: return (0,)
    return max(vs, key=ver) if vs else None


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9987
    root = sys.argv[2] if len(sys.argv) > 2 else ROOT
    handler = functools.partial(Handler, directory=root)
    write_devtools_manifest()
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler) as httpd:
        print(f'啟動台　 http://localhost:{port}/啟動台.html', flush=True)
        from urllib.parse import quote
        print(f'四人版　 http://localhost:{port}/{quote(latest_game() or "index.html")}', flush=True)
        httpd.serve_forever()


if __name__ == '__main__':
    main()
