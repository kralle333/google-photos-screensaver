/*
 * server.js - the Google Photos Screensaver daemon.
 *
 * Keeps the album's photos cached on the TV, writes photos.json for the
 * screen saver, puts the screen saver in place of LG's, and serves the
 * settings page, to the app on the TV and to any phone or computer on the
 * network.
 *
 * Started at boot by the Homebrew Channel's init.d hook (boot.sh) and by the
 * app's install.sh. Runs as root. Strict ES5: node 0.12 on webOS 4.
 */
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var execFile = require('child_process').execFile;
var album = require('./album');

var VERSION = '@VERSION@';
var APP_DIR = path.dirname(__dirname);
var DATA_DIR = process.env.GOOGLE_PHOTOS_SAVER_DATA || '/media/developer/google-photos-screensaver';
var PHOTOS_DIR = path.join(DATA_DIR, 'photos');
var SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
// What the screen saver reads, by its full path: the QML may be staged
// elsewhere (Glasshouse copies it), so it cannot look beside itself.
var PHOTOS_JSON = path.join(DATA_DIR, 'photos.json');
var APPLIED_FLAG = path.join(DATA_DIR, 'applied');
var SAVER_QML = path.join(APP_DIR, 'assets', 'screensaver-main.qml');
var LG_SAVER_DIR = '/usr/palm/applications/com.webos.app.screensaver';
var LG_SAVER_QML = LG_SAVER_DIR + '/qml/main.qml';
var REFRESH_MS = 6 * 60 * 60 * 1000;
var INTERVALS = [10, 20, 30, 60, 120, 300];
var MAX_PHOTOS = [50, 100, 200, 500];

// The app's launch page opens this port.
var PORT = 8095;
var DEFAULTS = { album: '', interval: 20, level: 'dim', maxPhotos: 100, shape: 'all' };
var settings = readSettings();
var state = { refreshing: false, updated: 0, error: '', count: 0 };
var refreshTimer = null;
var again = false;

function readJson(file, dflt) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return dflt; }
}

function writeJson(file, obj) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(obj, null, 2));
  fs.renameSync(file + '.tmp', file);
}

function readSettings() {
  var s = readJson(SETTINGS_FILE, {}) || {};
  var out = {};
  for (var k in DEFAULTS) out[k] = s[k] === undefined ? DEFAULTS[k] : s[k];
  return out;
}

function mkdirs(dir) {
  if (fs.existsSync(dir)) return;
  mkdirs(path.dirname(dir));
  fs.mkdirSync(dir);
}

// photos.json, from the cache as it is and the settings: written whenever
// either changes, so the screen saver's next start shows it.
function publish(photos) {
  var prev = readJson(PHOTOS_JSON, {}) || {};
  if (!photos) photos = prev.photos || [];
  state.count = photos.length;
  writeJson(PHOTOS_JSON, {
    dir: PHOTOS_DIR,
    interval: settings.interval,
    level: settings.level,
    updated: state.updated,
    photos: photos
  });
}

function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, REFRESH_MS);
  if (state.refreshing) { again = true; return; }
  if (!settings.album) {
    state.error = '';
    return clearCache();
  }
  state.refreshing = true;
  album.sync({ url: settings.album, dir: PHOTOS_DIR, max: settings.maxPhotos, landscape: settings.shape === 'landscape' }, function (err, photos) {
    state.refreshing = false;
    if (err) {
      state.error = err.message;
      console.error('refresh: ' + err.message);
    } else {
      state.error = '';
      state.updated = Date.now();
      publish(photos);
      console.log('refresh: ' + photos.length + ' photos');
    }
    if (again) { again = false; refresh(); }
  });
}

function clearCache() {
  var names = [];
  try { names = fs.readdirSync(PHOTOS_DIR); } catch (e) {}
  for (var i = 0; i < names.length; i++) {
    try { fs.unlinkSync(path.join(PHOTOS_DIR, names[i])); } catch (e) {}
  }
  state.updated = 0;
  publish([]);
}

// ------------------------------------------------------------ the screen saver

function run(bin, args, cb) {
  execFile(bin, args, { timeout: 10000 }, function (err, stdout, stderr) {
    cb(err ? new Error(String(stderr || err.message).split('\n')[0]) : null, String(stdout || ''));
  });
}

function mounts() {
  try { return fs.readFileSync('/proc/mounts', 'utf8').split('\n'); } catch (e) { return []; }
}

function mountedOn(target) {
  var lines = mounts();
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].split(' ')[1] === target) return true;
  }
  return false;
}

/*
 * How LG's screen saver can be replaced here, or why not:
 *   'glasshouse'  Glasshouse has its own app mounted over LG's; it lists this
 *                 screen saver among its own, and is where it is chosen.
 *   'flutter'     webOS 10 and later: LG's is not QML, so there is no main.qml
 *                 to mount over.
 *   'qml'         this app mounts its QML over LG's main.qml.
 */
function saverKind() {
  if (mountedOn(LG_SAVER_DIR)) return 'glasshouse';
  if (!fs.existsSync(LG_SAVER_QML)) return 'flutter';
  return 'qml';
}

function isApplied() {
  return fs.existsSync(APPLIED_FLAG) && mountedOn(LG_SAVER_QML);
}

// Other homebrew screen savers mount over the same file; theirs comes off
// first, so ours is not stacked on top of it.
function unmountAll(cb) {
  if (!mountedOn(LG_SAVER_QML)) return cb(null);
  run('/bin/umount', [LG_SAVER_QML], function (err) {
    if (err) return cb(err);
    unmountAll(cb);
  });
}

function apply(cb) {
  var kind = saverKind();
  if (kind === 'glasshouse') return cb(new Error('Glasshouse is managing the screen saver: choose Google Photos Screensaver on its Screensaver tab.'));
  if (kind === 'flutter') return cb(new Error('LG\'s screen saver on this TV cannot be replaced this way (webOS 10 and later).'));
  unmountAll(function (err) {
    if (err) return cb(err);
    run('/bin/mount', ['--bind', SAVER_QML, LG_SAVER_QML], function (err2) {
      if (err2) return cb(err2);
      fs.writeFileSync(APPLIED_FLAG, '1');
      cb(null);
    });
  });
}

function unapply(cb) {
  try { fs.unlinkSync(APPLIED_FLAG); } catch (e) {}
  if (saverKind() !== 'qml') return cb(null);
  unmountAll(cb);
}

function showNow(cb) {
  run('/usr/bin/luna-send', ['-n', '1', '-f', 'luna://com.webos.service.tvpower/power/turnOnScreenSaver', '{}'], cb);
}

// ------------------------------------------------------------------- the page

function addresses() {
  var out = [], ifs = os.networkInterfaces();
  for (var name in ifs) {
    for (var i = 0; i < ifs[name].length; i++) {
      var a = ifs[name][i];
      if (a.family === 'IPv4' && !a.internal) out.push('http://' + a.address + ':' + PORT + '/');
    }
  }
  return out;
}

function status() {
  return {
    ok: true,
    version: VERSION,
    album: settings.album,
    interval: settings.interval,
    level: settings.level,
    maxPhotos: settings.maxPhotos,
    shape: settings.shape,
    refreshing: state.refreshing,
    updated: state.updated,
    count: state.count,
    error: state.error,
    saver: saverKind(),
    applied: isApplied(),
    addresses: addresses()
  };
}

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, cb) {
  var chunks = [], size = 0;
  req.on('data', function (c) {
    size += c.length;
    if (size > 16384) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', function () {
    var v = null;
    try { v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) {}
    cb(v);
  });
}

/*
 * A change is accepted only as JSON from this page's own origin. The page
 * sends no CORS grant, and a JSON body needs a preflight that is never
 * approved, so another site the viewer has open cannot change anything.
 */
function sameOrigin(req) {
  if (!/^application\/json/.test(String(req.headers['content-type'] || ''))) return false;
  var origin = req.headers.origin;
  if (!origin || origin === 'null') return true;
  return origin.replace(/^https?:\/\//, '') === String(req.headers.host || '');
}

function done(res) {
  return function (err) {
    if (err) return send(res, 400, { ok: false, error: err.message });
    send(res, 200, status());
  };
}

function saveSettings(v, cb) {
  if ('album' in v) {
    var url = v.album ? album.albumUrl(v.album) : '';
    if (url === null) return cb(new Error('That is not a shared album link. It starts with https://photos.app.goo.gl/ or https://photos.google.com/share/.'));
    settings.album = url;
  }
  if ('interval' in v) {
    var n = parseInt(v.interval, 10);
    if (INTERVALS.indexOf(n) === -1) return cb(new Error('unknown interval'));
    settings.interval = n;
  }
  if ('level' in v) settings.level = v.level === 'bright' ? 'bright' : 'dim';
  if ('maxPhotos' in v) {
    var max = parseInt(v.maxPhotos, 10);
    if (MAX_PHOTOS.indexOf(max) === -1) return cb(new Error('unknown photo count'));
    settings.maxPhotos = max;
  }
  if ('shape' in v) settings.shape = v.shape === 'landscape' ? 'landscape' : 'all';
  try { writeJson(SETTINGS_FILE, settings); } catch (e) { return cb(e); }
  publish();
  // A new count or shape downloads the photos it adds and drops the rest.
  if ('album' in v || 'maxPhotos' in v || 'shape' in v) refresh();
  cb(null);
}

function handle(req, res) {
  var url = req.url.split('?')[0];
  if (req.method === 'GET') {
    if (url === '/' || url === '/index.html') {
      return fs.readFile(path.join(__dirname, 'dashboard.html'), function (err, data) {
        if (err) return send(res, 500, { ok: false, error: err.message });
        send(res, 200, data, 'text/html; charset=utf-8');
      });
    }
    if (url === '/api/status') return send(res, 200, status());
    if (url === '/api/photos') return send(res, 200, readJson(PHOTOS_JSON, { photos: [] }));
    var m = /^\/photos\/([0-9a-f]{16}\.jpg)$/.exec(url);
    if (m) {
      return fs.readFile(path.join(PHOTOS_DIR, m[1]), function (err, data) {
        if (err) return send(res, 404, { ok: false, error: 'no such photo' });
        send(res, 200, data, 'image/jpeg');
      });
    }
    return send(res, 404, { ok: false, error: 'not found' });
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method not allowed' });
  if (!sameOrigin(req)) return send(res, 403, { ok: false, error: 'send JSON from this page' });
  readBody(req, function (v) {
    if (!v || typeof v !== 'object') return send(res, 400, { ok: false, error: 'bad JSON' });
    if (url === '/api/settings') return saveSettings(v, done(res));
    if (url === '/api/refresh') { refresh(); return done(res)(null); }
    if (url === '/api/apply') return apply(done(res));
    if (url === '/api/unapply') return unapply(done(res));
    if (url === '/api/show') return showNow(done(res));
    send(res, 404, { ok: false, error: 'not found' });
  });
}

function main() {
  mkdirs(PHOTOS_DIR);
  state.updated = (readJson(PHOTOS_JSON, {}) || {}).updated || 0;
  // A photos.json for the screen saver even before the first refresh.
  publish();
  if (process.argv.indexOf('--boot') !== -1 && fs.existsSync(APPLIED_FLAG)) {
    apply(function (err) { if (err) console.error('boot: screen saver not put back: ' + err.message); });
  }
  http.createServer(handle).listen(PORT, function () {
    console.log('google-photos-screensaver ' + VERSION + ' on port ' + PORT);
  });
  // Straight away only when the copy is stale; a restart keeps the last one.
  if (Date.now() - state.updated > REFRESH_MS) refresh();
  else refreshTimer = setTimeout(refresh, REFRESH_MS - (Date.now() - state.updated));
}

if (require.main === module) main();

module.exports = { saveSettings: saveSettings, status: status, sameOrigin: sameOrigin };
