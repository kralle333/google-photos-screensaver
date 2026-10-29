# Google Photos Screensaver

A Homebrew Channel app for rooted LG TVs that turns the TV's screen saver
into a slideshow of a shared Google Photos album. Photos cross-fade, drift and
zoom slowly, so nothing stays still on an OLED panel, and a dim setting holds
the picture down for dark rooms.

## Use

1. Install the app from the Homebrew Channel and open it. The first start sets
   up a small service on the TV, which takes a few seconds.
2. In Google Photos, open an album, choose **Share**, then **Create link**,
   and paste the link into the app. The page is also served to phones and
   computers on the same network, at the address it shows, which is easier
   than typing a link with the remote.
3. Choose **Use as screen saver**. **Show it now** starts it straight away.

The TV keeps up to 100 of the album's photos (50 to 500, chosen on the page),
optionally only the landscape ones, resized to 1920×1080. It shows them in a
random order and reads the album again every six hours, or on **Read again**.

## Why a shared link

Since March 2025 the Google Photos Library API only lets an app read photos it
uploaded itself, so there is no supported way for a TV to read an existing
album. A shared album's public page lists its photos, and that is what this
app reads. Google can change that page and break it; the parser is
`parseAlbum` in `service/album.js`.

Anyone with a shared album's link can see the album.

## Which TVs

The app replaces LG's screen saver by bind-mounting its QML over LG's
`qml/main.qml`, the way Custom Screensaver and the Aerial apps do. That needs
a rooted TV whose screen saver is QML: webOS 4 to webOS 9. On webOS 10 and
later LG's screen saver is a Flutter app and cannot be replaced this way.

With [Glasshouse](https://github.com/rorygallagher2024/glasshouse) installed,
the screen saver is listed on Glasshouse's Screensaver tab with the other
installed apps' and is chosen there. The app sees that and leaves the choice
to Glasshouse.

## How it works

| Part | Where on the TV |
| :--- | :--- |
| Launch page, `app/index.html` | Starts the service through the Homebrew Channel's exec service, then opens the settings page |
| Service, `service/server.js` | Port 8095: the settings page and its API; caches the album; mounts the screen saver. Started at boot by `/var/lib/webosbrew/init.d/60-google-photos-screensaver` |
| Screen saver, `app/assets/screensaver-main.qml` | Reads `photos.json` and the photos by their full path |
| Settings, photos, log | `/media/developer/google-photos-screensaver/` |

The settings page has no password: anyone on the network can change the
album or switch the screen saver. Changes are only accepted as JSON from the
page's own origin, so other websites cannot make them.

Uninstalling the app leaves its screen saver mounted until the TV restarts.
To remove the cached photos, delete `/media/developer/google-photos-screensaver/`.

## Development

The service and both pages are strict ES5: the service runs under node 0.12
on webOS 4, and the pages in the TV's Chromium 53.

    node test/run.js          # parser, cache and the service's API
    scripts/build-ipk.py      # dist/*.ipk and the repository manifest; needs ares-package

## License

MIT
