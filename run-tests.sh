#!/bin/sh
# 跑自测套件：构建 → 注入 tests/suite.js → headless Chrome → 打印结果
# 有任何 FAIL 时退出码为 1
set -e
cd "$(dirname "$0")"

./build.sh > /dev/null
echo "build ok"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
  for c in /Applications/Chromium.app/Contents/MacOS/Chromium \
           "$(command -v google-chrome 2>/dev/null)" \
           "$(command -v chromium 2>/dev/null)"; do
    [ -n "$c" ] && [ -x "$c" ] && CHROME="$c" && break
  done
fi
[ -x "$CHROME" ] || { echo "找不到 Chrome，设置环境变量 CHROME=/path/to/chrome"; exit 2; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

python3 - "$WORK" <<'PY'
import sys, pathlib
work = pathlib.Path(sys.argv[1])
html = pathlib.Path('index.html').read_text()
suite = pathlib.Path('tests/suite.js').read_text()
assert '</body>' in html
(work / 'run.html').write_text(
    html.replace('</body>', '<script>\n' + suite + '\n</script>\n</body>'))
PY
cp -R tests "$WORK/tests" 2>/dev/null || true

# localStorage 在 file:// 下不可靠，用本地 http 起一个临时服务
PORT=$(python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()")
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$WORK" > /dev/null 2>&1 &
SRV=$!
cleanup() { kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; rm -rf "$WORK"; true; }
trap cleanup EXIT
sleep 1

"$CHROME" --headless=new --disable-gpu --no-sandbox --no-first-run \
  --disable-extensions --user-data-dir="$WORK/profile" \
  --dump-dom "http://127.0.0.1:$PORT/run.html" > "$WORK/out.html" 2>/dev/null &
CPID=$!
i=0
while kill -0 $CPID 2>/dev/null; do
  i=$((i+1)); [ $i -gt 60 ] && kill -9 $CPID 2>/dev/null && break
  sleep 1
done
wait $CPID 2>/dev/null || true

set +e
python3 - "$WORK/out.html" <<'PY'
import sys, re, html, pathlib
s = pathlib.Path(sys.argv[1]).read_text(errors='replace')
m = re.search(r'<pre id="MT_TEST_RESULTS">(.*?)</pre>', s, re.S)
if not m:
    print('测试没有产出结果 —— 页面可能在加载时就抛异常了。')
    sys.exit(1)
out = html.unescape(m.group(1))
print(out)
last = [l for l in out.splitlines() if l.startswith('SUMMARY')]
sys.exit(0 if last and ' 0 failed' in last[0] else 1)
PY
RC=$?
cleanup
trap - EXIT
exit $RC
