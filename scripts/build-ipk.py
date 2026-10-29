#!/usr/bin/env python3
"""
Build the .ipk the Homebrew Channel installs, and its repository manifest.

    scripts/build-ipk.py    -> dist/<id>_<version>_all.ipk
                               dist/<id>.manifest.json

The package is made by LG's ares-package (npm install -g @webos-tools/cli):
the Homebrew Channel's repository rejects packages without the control
fields only an official packager writes. ares-package is found on PATH, or
named by $ARES_PACKAGE.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')

APP_ID = 'io.github.kralle333.google-photos-screensaver'
VERSION = '0.2.0'
TITLE = 'Google Photos Screensaver'
DESCRIPTION = 'The screen saver as a slideshow of a shared Google Photos album'
REPO = 'https://github.com/kralle333/google-photos-screensaver'
ICON_URI = 'https://raw.githubusercontent.com/kralle333/google-photos-screensaver/main/app/icon130.png'

# Source -> place in the app. @VERSION@ is filled in where it appears.
FILES = [
    ('app/index.html', 'index.html', 0o644),
    ('app/icon80.png', 'icon80.png', 0o644),
    ('app/icon130.png', 'icon130.png', 0o644),
    # The name and place Glasshouse looks for in an installed app.
    ('app/assets/screensaver-main.qml', 'assets/screensaver-main.qml', 0o644),
    ('service/server.js', 'service/server.js', 0o644),
    ('service/album.js', 'service/album.js', 0o644),
    ('service/dashboard.html', 'service/dashboard.html', 0o644),
    ('service/install.sh', 'service/install.sh', 0o755),
    ('service/ctl.sh', 'service/ctl.sh', 0o755),
    ('service/boot.sh', 'service/boot.sh', 0o755),
]


def stage(app):
    appinfo = {
        'id': APP_ID, 'version': VERSION, 'vendor': 'kralle333', 'type': 'web',
        'main': 'index.html', 'title': TITLE, 'appDescription': DESCRIPTION,
        'icon': 'icon80.png', 'largeIcon': 'icon130.png',
        'iconColor': '#1a73e8', 'bgColor': '#000000', 'resolution': '1920x1080',
        'disableBackHistoryAPI': True,
    }
    os.makedirs(app)
    with open(os.path.join(app, 'appinfo.json'), 'w') as f:
        json.dump(appinfo, f, indent=2)
    for src, dst, mode in FILES:
        with open(os.path.join(ROOT, src), 'rb') as f:
            data = f.read()
        data = data.replace(b'@VERSION@', VERSION.encode())
        out = os.path.join(app, dst)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, 'wb') as f:
            f.write(data)
        os.chmod(out, mode)


def main():
    ares = os.environ.get('ARES_PACKAGE') or shutil.which('ares-package')
    if not ares:
        sys.exit('ares-package not found: npm install -g @webos-tools/cli, or set ARES_PACKAGE')
    work = os.path.join(DIST, 'stage')
    shutil.rmtree(work, ignore_errors=True)
    app = os.path.join(work, APP_ID)
    stage(app)

    ipk_name = '%s_%s_all.ipk' % (APP_ID, VERSION)
    ipk_path = os.path.join(DIST, ipk_name)
    if os.path.exists(ipk_path):
        os.remove(ipk_path)
    # Not minified: the daemon has to stay the ES5 node 0.12 parses.
    run = subprocess.run([ares, '--no-minify', '--outdir', DIST, app], capture_output=True, text=True)
    if run.returncode != 0 or not os.path.isfile(ipk_path):
        sys.exit('ares-package failed:\n' + run.stdout + run.stderr)
    shutil.rmtree(work, ignore_errors=True)

    with open(ipk_path, 'rb') as f:
        ipk = f.read()
    manifest = {
        'id': APP_ID, 'version': VERSION, 'type': 'web', 'title': TITLE,
        'appDescription': DESCRIPTION, 'iconUri': ICON_URI, 'sourceUrl': REPO,
        'rootRequired': True, 'ipkUrl': ipk_name,
        'ipkHash': {'sha256': hashlib.sha256(ipk).hexdigest()},
    }
    with open(os.path.join(DIST, APP_ID + '.manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    print('%s  %d KB' % (ipk_name, len(ipk) // 1024))


if __name__ == '__main__':
    main()
