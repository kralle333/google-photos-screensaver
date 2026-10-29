#!/bin/sh
# Homebrew Channel boot hook: starts the daemon, which puts the screen saver
# back in place if it was in use. install.sh links this into
# /var/lib/webosbrew/init.d; once the app is removed the link leads nowhere
# and nothing runs.
HERE=$(dirname "$(readlink -f "$0")")
[ -x "$HERE/ctl.sh" ] || exit 0
"$HERE/ctl.sh" start --boot
exit 0
