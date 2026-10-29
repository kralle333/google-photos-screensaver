/*
 * node test/run.js - the album parser and cache, and the daemon's settings and
 * HTTP API, against a temporary data folder.
 */
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var child = require('child_process');

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gps-'));
process.env.GOOGLE_PHOTOS_SAVER_DATA = tmp;
var album = require('../service/album');

// --- links
assert.ok(album.albumUrl('https://photos.app.goo.gl/AbC123xyz'));
assert.ok(album.albumUrl(' https://photos.google.com/share/AF1QipAbc_-1?key=Xyz-_9 '));
assert.ok(album.albumUrl('https://photos.google.com/u/1/share/AF1QipAbc'));
assert.strictEqual(album.albumUrl('http://photos.app.goo.gl/AbC'), null);
assert.strictEqual(album.albumUrl('https://evil.example/photos.app.goo.gl/x'), null);
assert.strictEqual(album.albumUrl('https://photos.google.com/album/AF1Qip'), null);
assert.strictEqual(album.albumUrl('https://photos.app.goo.gl/x;rm -rf'), null);

// --- the page, as the album embeds its items
var page = 'AF_initDataCallback({key: \'ds:1\', data:[null,[' +
  '["AF1QipAAA",["https://lh3.googleusercontent.com/pw/AP1GczAAA-1_x",4032,3024,null,null,null,null,null,null,[1]]],' +
  '["AF1QipBBB",["https://lh3.googleusercontent.com/pw/AP1GczBBB",1080,1920,null]],' +
  '["AF1QipAAA",["https://lh3.googleusercontent.com/pw/AP1GczAAA-1_x",4032,3024,null]]' +
  ']]}); "https://lh3.googleusercontent.com/a/avatar"';
var items = album.parseAlbum(page);
assert.deepEqual(items.map(function (i) { return i.id; }), ['AF1QipAAA', 'AF1QipBBB']);
assert.strictEqual(items[0].url, 'https://lh3.googleusercontent.com/pw/AP1GczAAA-1_x');
assert.strictEqual(items[1].w, 1080);
// Without the item list, the bare photo addresses; never the avatar.
var bare = album.parseAlbum('"https://lh3.googleusercontent.com/pw/P1" "https://lh3.googleusercontent.com/a/me"');
assert.deepEqual(bare.map(function (i) { return i.url; }), ['https://lh3.googleusercontent.com/pw/P1']);
assert.deepEqual(album.parseAlbum('<html>nothing</html>'), []);

// --- the cache
var JPEG = new Buffer([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
var dir = path.join(tmp, 'cache');
fs.mkdirSync(dir);
var fetched = [];
function fake(pageHtml, failing) {
  return function (url, out, secs, cb) {
    fetched.push(url);
    if (/^https:\/\/photos/.test(url)) fs.writeFileSync(out, pageHtml);
    else if (failing && url.indexOf(failing) !== -1) return cb(new Error('404'));
    else if (/BBB/.test(url)) fs.writeFileSync(out, '<html>not a jpeg</html>');
    else fs.writeFileSync(out, JPEG);
    cb(null);
  };
}
fs.writeFileSync(path.join(dir, 'stale0000000000.jpg'), JPEG);
album.sync({ url: 'https://photos.app.goo.gl/x', dir: dir, max: 10, download: fake(page) }, function (err, photos) {
  assert.ifError(err);
  // BBB came back as HTML and is left out; the stale file is gone.
  assert.deepEqual(photos, [{ file: album.fileName('AF1QipAAA'), w: 4032, h: 3024 }]);
  assert.deepEqual(fs.readdirSync(dir).sort(), [album.fileName('AF1QipAAA')]);
  assert.ok(fetched.indexOf('https://lh3.googleusercontent.com/pw/AP1GczAAA-1_x=w1920-h1080') !== -1);

  // A second read downloads only what is new.
  fetched = [];
  album.sync({ url: 'https://photos.app.goo.gl/x', dir: dir, max: 10, download: fake(page) }, function (err2, photos2) {
    assert.ifError(err2);
    assert.strictEqual(photos2.length, 1);
    assert.ok(fetched.every(function (u) { return u.indexOf('AAA') === -1; }));

    // An album page without photos is an error, and the cache stays.
    album.sync({ url: 'https://photos.app.goo.gl/x', dir: dir, max: 10, download: fake('<html/>') }, function (err3) {
      assert.ok(/no photos found/.test(err3.message));
      assert.strictEqual(fs.readdirSync(dir).length, 1);
      serverTests();
    });
  });
});

// --- the daemon, run for real on its port against the temporary folder
function serverTests() {
  var server = require('../service/server');
  assert.ok(server.sameOrigin({ headers: { 'content-type': 'application/json', host: 'tv:8095' } }));
  assert.ok(server.sameOrigin({ headers: { 'content-type': 'application/json', host: 'tv:8095', origin: 'http://tv:8095' } }));
  assert.ok(!server.sameOrigin({ headers: { 'content-type': 'application/json', host: 'tv:8095', origin: 'https://evil.example' } }));
  assert.ok(!server.sameOrigin({ headers: { 'content-type': 'text/plain', host: 'tv:8095' } }));

  var proc = child.spawn(process.execPath, [path.join(__dirname, '..', 'service', 'server.js')], { env: process.env });
  var out = '';
  proc.stdout.on('data', function (d) { out += d; });
  proc.stderr.on('data', function (d) { out += d; });
  function req(method, url, body, headers, cb) {
    var data = body ? JSON.stringify(body) : '';
    var h = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) };
    for (var k in headers) h[k] = headers[k];
    var r = http.request({ host: '127.0.0.1', port: 8095, method: method, path: url, headers: h }, function (res) {
      var b = '';
      res.on('data', function (c) { b += c; });
      res.on('end', function () { cb(res.statusCode, b); });
    });
    r.end(data);
  }
  function finish(e) {
    proc.kill();
    if (e) { console.error(out); throw e; }
    console.log('all tests passed');
  }
  setTimeout(function () {
    try {
      req('GET', '/api/status', null, {}, function (code, b) {
        var s = JSON.parse(b);
        assert.strictEqual(code, 200);
        assert.strictEqual(s.interval, 20);
        assert.strictEqual(s.level, 'dim');
        req('POST', '/api/settings', { album: 'https://example.com/x' }, {}, function (code2, b2) {
          assert.strictEqual(code2, 400);
          assert.ok(/shared album link/.test(JSON.parse(b2).error));
          req('POST', '/api/settings', { interval: 60, level: 'bright' }, { origin: 'https://evil.example' }, function (code3) {
            assert.strictEqual(code3, 403);
            req('POST', '/api/settings', { interval: 60, level: 'bright' }, {}, function (code4, b4) {
              assert.strictEqual(code4, 200);
              assert.strictEqual(JSON.parse(b4).interval, 60);
              var pj = JSON.parse(fs.readFileSync(path.join(tmp, 'photos.json'), 'utf8'));
              assert.strictEqual(pj.interval, 60);
              assert.strictEqual(pj.level, 'bright');
              assert.strictEqual(pj.dir, path.join(tmp, 'photos'));
              req('GET', '/', null, {}, function (code5, page5) {
                assert.strictEqual(code5, 200);
                assert.ok(/Google Photos Screensaver/.test(page5));
                req('GET', '/photos/../settings.json', null, {}, function (code6) {
                  assert.strictEqual(code6, 404);
                  finish();
                });
              });
            });
          });
        });
      });
    } catch (e) { finish(e); }
  }, 700);
}
