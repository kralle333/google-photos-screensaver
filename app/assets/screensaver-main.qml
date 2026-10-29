/*
 * Google Photos Screensaver: a slideshow of the photos the daemon cached.
 *
 * Mounted over LG's com.webos.app.screensaver qml/main.qml by this app, or
 * staged by Glasshouse, which copies this one file. Everything else is read
 * by its full path: photos.json and the photos beside it.
 *
 * QtQuick 2.4 and Eos.Window are what webOS 4 has. XMLHttpRequest reads a
 * file:// URL on Qt 5.6 to 5.12 (5.15 would need QML_XHR_ALLOW_FILE_READ).
 */
import QtQuick 2.4
import Eos.Window 0.1

WebOSWindow {
    id: win

    // The compositor's layout, not Screen, which can report smaller.
    width: 1920
    height: 1080

    windowType: "_WEBOS_WINDOW_TYPE_SCREENSAVER"
    appId: "com.webos.app.screensaver"
    title: "Screen Saver"
    visible: true
    color: "black"

    property string dataUrl: "file:///media/developer/google-photos-screensaver/photos.json"
    property string dir: ""
    property var photos: []
    property var order: []
    property int pos: 0
    property int interval: 20
    property bool bright: false
    property int fadeMs: 2000
    // Which of the two slides is in front.
    property bool frontA: true
    property bool empty: false

    function shuffled(n) {
        var a = [];
        for (var i = 0; i < n; i++) a.push(i);
        for (var j = n - 1; j > 0; j--) {
            var k = Math.floor(Math.random() * (j + 1));
            var t = a[j]; a[j] = a[k]; a[k] = t;
        }
        return a;
    }

    // Read again at the end of every round, so photos added since show up
    // without the screen saver being restarted.
    function load(then) {
        var x = new XMLHttpRequest();
        x.onreadystatechange = function () {
            if (x.readyState !== XMLHttpRequest.DONE) return;
            try {
                var d = JSON.parse(x.responseText);
                win.dir = d.dir || "";
                win.photos = d.photos || [];
                win.interval = Math.max(5, d.interval || 20);
                win.bright = d.level === "bright";
            } catch (e) { }
            win.order = win.shuffled(win.photos.length);
            win.pos = 0;
            win.empty = win.photos.length === 0;
            then();
        };
        x.open("GET", win.dataUrl);
        x.send();
    }

    function next() {
        if (win.pos >= win.order.length) {
            load(function () { if (!win.empty) win.show(); });
            return;
        }
        win.show();
    }

    function show() {
        var p = win.photos[win.order[win.pos++]];
        var slide = win.frontA ? slideB : slideA;
        slide.start("file://" + win.dir + "/" + p.file);
    }

    // A slide that has loaded comes to the front, the other fades out.
    function loaded(slide) {
        var other = slide === slideA ? slideB : slideA;
        slide.z = 1;
        other.z = 0;
        slide.reveal();
        other.hide();
        win.frontA = slide === slideA;
        advance.restart();
    }

    Timer {
        id: advance
        interval: win.interval * 1000
        onTriggered: win.next()
    }

    Component {
        id: slideComponent

        Item {
            id: slide
            width: win.width
            height: win.height
            opacity: 0

            function start(src) {
                img.source = "";
                img.source = src;
            }
            function reveal() {
                fadeOut.stop();
                fadeIn.start();
                /*
                 * Ken Burns: from slightly larger to larger still, drifting
                 * one way, over the photo's whole time on screen, so no
                 * edge sits still on the panel.
                 */
                var s0 = 1.04 + Math.random() * 0.03;
                var s1 = s0 + 0.06;
                var dx = (Math.random() - 0.5) * win.width * 0.05;
                var dy = (Math.random() - 0.5) * win.height * 0.05;
                drift.stop();
                scaleAnim.from = s0; scaleAnim.to = s1;
                xAnim.from = -dx; xAnim.to = dx;
                yAnim.from = -dy; yAnim.to = dy;
                drift.start();
            }
            function hide() {
                fadeIn.stop();
                fadeOut.start();
            }

            Image {
                id: img
                anchors.centerIn: parent
                width: win.width
                height: win.height
                asynchronous: true
                cache: false
                smooth: true
                sourceSize.width: 1920
                sourceSize.height: 1080
                // Landscape photos fill the screen; portrait and panoramas are
                // shown whole, on black.
                fillMode: (implicitWidth > 0 && implicitWidth / implicitHeight > 1.3 && implicitWidth / implicitHeight < 2.1)
                          ? Image.PreserveAspectCrop : Image.PreserveAspectFit
                onStatusChanged: {
                    if (status === Image.Ready) win.loaded(slide);
                    else if (status === Image.Error) skip.restart();
                }
            }

            NumberAnimation { id: fadeIn; target: slide; property: "opacity"; to: 1; duration: win.fadeMs; easing.type: Easing.InOutQuad }
            NumberAnimation { id: fadeOut; target: slide; property: "opacity"; to: 0; duration: win.fadeMs; easing.type: Easing.InOutQuad }
            ParallelAnimation {
                id: drift
                NumberAnimation { id: scaleAnim; target: img; property: "scale"; duration: win.interval * 1000 + win.fadeMs * 2 }
                NumberAnimation { id: xAnim; target: img; property: "anchors.horizontalCenterOffset"; duration: win.interval * 1000 + win.fadeMs * 2 }
                NumberAnimation { id: yAnim; target: img; property: "anchors.verticalCenterOffset"; duration: win.interval * 1000 + win.fadeMs * 2 }
            }
        }
    }

    // Made in Component.onCompleted, as children of the window, so their z
    // orders them against each other and the dimming above.
    property Item slideA: null
    property Item slideB: null

    // A photo that would not load is passed over, after a moment, so a cache
    // of unreadable files does not spin.
    Timer { id: skip; interval: 1000; onTriggered: win.next() }

    // Dim: the whole picture held down, for a dark room and the panel's sake.
    Rectangle {
        anchors.fill: parent
        color: "black"
        opacity: win.bright ? 0 : 0.45
        z: 2
    }

    // Until there are photos: a line saying where to add them, moving every
    // minute like any other screen saver.
    Text {
        id: hint
        visible: win.empty
        z: 3
        color: "#6b7078"
        font.pixelSize: 30
        text: "No photos yet. Open Google Photos Screensaver on the TV to add a shared Google Photos album."
        Behavior on x { NumberAnimation { duration: 2600; easing.type: Easing.InOutQuad } }
        Behavior on y { NumberAnimation { duration: 2600; easing.type: Easing.InOutQuad } }
        function move() {
            x = 80 + Math.random() * Math.max(0, win.width - width - 160);
            y = 80 + Math.random() * Math.max(0, win.height - height - 160);
        }
    }
    Timer {
        interval: 60000; running: win.empty; repeat: true
        onTriggered: { hint.move(); win.load(function () { if (!win.empty) win.show(); }); }
    }

    Component.onCompleted: {
        slideA = slideComponent.createObject(win.contentItem);
        slideB = slideComponent.createObject(win.contentItem);
        hint.move();
        load(function () { if (!win.empty) win.show(); });
    }
}
