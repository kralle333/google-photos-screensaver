#!/bin/sh
# Start, stop or restart the daemon. Run as root: by install.sh, which the app
# has the Homebrew Channel run, and by boot.sh at boot.
#   ctl.sh start [--boot] | stop | restart | status

HERE=$(cd "$(dirname "$0")" && pwd)
DATA=/media/developer/google-photos-screensaver
PID="$DATA/daemon.pid"
LOG="$DATA/daemon.log"
NODE=/usr/bin/node

running() { [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; }

start() {
  running && return 0
  [ -x "$NODE" ] || { echo "no node on this TV" >&2; return 1; }
  mkdir -p "$DATA"
  [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 65536 ] && mv -f "$LOG" "$LOG.old"
  nohup "$NODE" "$HERE/server.js" "$@" >>"$LOG" 2>&1 </dev/null &
  echo $! > "$PID"
}

stop() {
  running && kill "$(cat "$PID")"
  rm -f "$PID"
}

case "$1" in
  start) shift; start "$@" ;;
  stop) stop ;;
  restart) stop; sleep 1; start ;;
  status) if running; then echo running; else echo stopped; fi ;;
  *) echo "usage: $0 start|stop|restart|status" >&2; exit 2 ;;
esac
