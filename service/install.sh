#!/bin/sh
# Run as root by the app's launch page, through the Homebrew Channel's exec
# service, whenever the daemon does not answer with the app's version: links
# the boot hook and (re)starts the daemon. Prints one JSON line last.

HERE=$(cd "$(dirname "$0")" && pwd)
HOOK=/var/lib/webosbrew/init.d/60-google-photos-screensaver   # run-parts skips names with a dot

fail() { printf '{"ok":false,"error":"%s"}\n' "$1"; exit 0; }

[ -x /usr/bin/node ] || fail "this TV has no node"
chmod +x "$HERE/ctl.sh" "$HERE/boot.sh" 2>/dev/null
mkdir -p "$(dirname "$HOOK")" && ln -sf "$HERE/boot.sh" "$HOOK" || fail "could not add the boot hook"
"$HERE/ctl.sh" stop
sleep 1
# --boot: an update of the app is a fresh install, which drops nothing, but
# puts the screen saver back the same way a restart of the TV does.
"$HERE/ctl.sh" start --boot || fail "the daemon did not start"
printf '{"ok":true}\n'
