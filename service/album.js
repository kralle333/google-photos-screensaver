/*
 * album.js - reads a shared Google Photos album and keeps a copy of its photos
 * on the TV, resized for the screen.
 *
 * There is no API for this: since March 2025 the Google Photos Library API only
 * reads what the calling app uploaded itself. A shared album's public page
 * lists every photo's address in the data it embeds, and that is what is read
 * here. Google can change that page; parseAlbum is the one place to follow it.
 *
 * Strict ES5: the TV runs node 0.12 (webOS 4) or newer.
 */
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var execFile = require('child_process').execFile;

// A desktop browser's: the page Google sends an unknown client leaves the
// photo list out.
var USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
// node's own https cannot reach Google on webOS 4 (no current CA bundle or
// TLS); the TV's curl can. wget is the fallback.
var CLIENTS = ['/usr/bin/curl', '/media/developer/bin/curl', '/usr/bin/wget', '/bin/wget'];
var MAX_BYTES = 80 * 1024 * 1024;

/**
 * A share link, or null where it is not one. Short links (photos.app.goo.gl)
 * redirect to the full one, which the HTTP client follows.
 * @param {any} url
 * @returns {?string}
 */
function albumUrl(url) {
  var s = String(url || '').trim();
  if (/^https:\/\/photos\.app\.goo\.gl\/[A-Za-z0-9]+\/?$/.test(s)) return s;
  if (/^https:\/\/photos\.google\.com\/(u\/\d+\/)?share\/[A-Za-z0-9_-]+\/?(\?key=[A-Za-z0-9_-]+)?$/.test(s)) return s;
  return null;
}

/**
 * Every photo in an album page, in album order: { id, url, w, h }. Each item
 * is embedded as ["AF1Q<id>",["https://lh3.googleusercontent.com/pw/...",w,h,
 * where the url takes a size suffix (=w1920-h1080) when fetched.
 * @param {string} html
 */
function parseAlbum(html) {
  var out = [], seen = {}, m;
  var item = /\["(AF1Q[\w-]+)",\["(https:\/\/lh3\.googleusercontent\.com\/[\w\/-]+)",(\d+),(\d+)/g;
  while ((m = item.exec(html))) {
    if (seen[m[1]]) continue;
    seen[m[1]] = true;
    out.push({ id: m[1], url: m[2], w: parseInt(m[3], 10), h: parseInt(m[4], 10) });
  }
  if (out.length) return out;
  // Without the item list, any photo address on the page. The owner's avatar
  // is under /a/, not /pw/, so it is not among them.
  var bare = /"(https:\/\/lh3\.googleusercontent\.com\/pw\/[\w-]+)"/g;
  while ((m = bare.exec(html))) {
    if (seen[m[1]]) continue;
    seen[m[1]] = true;
    out.push({ id: m[1], url: m[1], w: 0, h: 0 });
  }
  return out;
}

// The cache file for a photo: the same name as long as the album keeps it.
function fileName(id) {
  return crypto.createHash('sha1').update(id).digest('hex').slice(0, 16) + '.jpg';
}

function clientArgs(bin, url, outFile, seconds) {
  if (/wget$/.test(bin)) return ['-q', '-T', String(seconds), '-U', USER_AGENT, '-O', outFile, url];
  return ['-fsSL', '--proto', '=https', '--proto-redir', '=https', '--max-time', String(seconds),
          '-A', USER_AGENT, '-o', outFile, url];
}

/**
 * Fetches url into outFile with the first HTTP client the TV has.
 * @param {string} url
 * @param {string} outFile
 * @param {number} seconds
 * @param {function(?Error): void} cb
 */
function download(url, outFile, seconds, cb) {
  var i = 0, last = '';
  (function next() {
    while (i < CLIENTS.length && !fs.existsSync(CLIENTS[i])) i++;
    if (i >= CLIENTS.length) return cb(new Error(last || 'no curl or wget on this TV'));
    var bin = CLIENTS[i++];
    execFile(bin, clientArgs(bin, url, outFile, seconds), { timeout: (seconds + 10) * 1000 }, function (err, stdout, stderr) {
      if (!err) return cb(null);
      last = path.basename(bin) + ': ' + (String(stderr || '').split('\n')[0].trim() || (err.killed ? 'timed out' : 'exited ' + err.code));
      try { fs.unlinkSync(outFile); } catch (e) {}
      next();
    });
  })();
}

function isJpeg(file) {
  var fd, buf = new Buffer(3);
  try {
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, 3, 0);
  } catch (e) { return false; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (e2) {} }
  return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/**
 * Brings the cache in dir up to date with the album: photos new to it are
 * downloaded, ones gone from it removed. cb(err, photos) with what is in the
 * cache, [{ file, w, h }], in album order; err only when the album itself could
 * not be read, in which case the cache is left as it was.
 * @param {{ url: string, dir: string, max: number, download?: Function }} opts
 * @param {function(?Error, Array=): void} cb
 */
function sync(opts, cb) {
  var get = opts.download || download;
  var page = path.join(opts.dir, '.album.html');
  get(opts.url, page, 60, function (err) {
    if (err) return cb(new Error('could not read the album: ' + err.message));
    var html = '';
    try { html = fs.readFileSync(page, 'utf8'); } catch (e) {}
    try { fs.unlinkSync(page); } catch (e) {}
    var items = parseAlbum(html);
    if (!items.length) {
      return cb(new Error('no photos found at that link: is it a shared album with link sharing on?'));
    }
    items = items.slice(0, opts.max);
    var keep = {}, have = [], bytes = 0, i = 0;

    function finish() {
      // Anything else in the folder is from an earlier album or state.
      var names = [];
      try { names = fs.readdirSync(opts.dir); } catch (e) {}
      for (var k = 0; k < names.length; k++) {
        if (/\.jpg(\.part)?$/.test(names[k]) && !keep[names[k]]) {
          try { fs.unlinkSync(path.join(opts.dir, names[k])); } catch (e) {}
        }
      }
      cb(null, have);
    }

    function added(it, file) {
      var size = 0;
      try { size = fs.statSync(path.join(opts.dir, file)).size; } catch (e) { return; }
      bytes += size;
      keep[file] = true;
      have.push({ file: file, w: it.w, h: it.h });
    }

    (function next() {
      if (i >= items.length || bytes >= MAX_BYTES) return finish();
      var it = items[i++];
      var file = fileName(it.id);
      var full = path.join(opts.dir, file);
      if (fs.existsSync(full)) { added(it, file); return next(); }
      // Fits within the screen, aspect kept; Google scales it.
      get(it.url + '=w1920-h1080', full + '.part', 60, function (err2) {
        if (!err2 && isJpeg(full + '.part')) {
          try { fs.renameSync(full + '.part', full); added(it, file); } catch (e) {}
        } else {
          try { fs.unlinkSync(full + '.part'); } catch (e) {}
        }
        next();
      });
    })();
  });
}

module.exports = {
  albumUrl: albumUrl,
  parseAlbum: parseAlbum,
  fileName: fileName,
  sync: sync,
  download: download
};
