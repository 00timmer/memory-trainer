#!/bin/sh
# Build single-file index.html from src/. No npm, no toolchain.
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
import glob, io
base = open('src/base.html').read()
css  = '\n'.join(open(f).read() for f in sorted(glob.glob('src/*.css')))
js   = '\n'.join('/* ==== %s ==== */\n%s' % (f.split('/')[-1], open(f).read())
                 for f in sorted(glob.glob('src/*.js')))
scr  = '\n'.join(open(f).read() for f in sorted(glob.glob('src/screens/*.html')))
out = base.replace('/* @INJECT_CSS@ */', css)
out = out.replace('<!--@INJECT_SCREENS@-->', scr)
out = out.replace('/* @INJECT_JS@ */', js)
open('index.html','w').write(out)
print('built index.html: %d bytes' % len(out))
PY
