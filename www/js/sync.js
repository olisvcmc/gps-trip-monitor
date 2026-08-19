/**
sync.js — Auto-sync antrian trip yang belum terkirim ke server.
Alur:
Setiap trip SELALU disimpan ke SQLite lokal dulu (lihat db.js), apapun status internet.
Modul ini mendengarkan event online/offline (dari cordova-plugin-network-information,
fallback ke window.online/offline di browser biasa).
Begitu status berubah jadi online, semua trip dengan synced=0 otomatis diupload satu per satu.
Dipanggil juga secara manual setelah trip baru selesai dicatat, untuk percobaan sync langsung.
*/
(function (global) {
    'use strict';
    var isSyncing = false;
    var onStatusChange = null;

    // PERBAIKAN: Deteksi status online yang lebih akurat
    function isOnline() {
        // 1. Prioritaskan navigator.onLine (lebih akurat di Android WebView modern)
        if (navigator.onLine === false) return false;
        if (navigator.onLine === true) return true;

        // 2. Fallback ke plugin network-info (jika ada)
        if (navigator.connection && typeof navigator.connection.type !== 'undefined') {
            var type = navigator.connection.type;
            // 'none' = benar-benar tidak ada jaringan
            if (type === 'none') return false;
            // 'unknown' di Android sering berarti ONLINE (bug plugin), jangan anggap offline
            // 'wifi', '4g', 'cellular', 'ethernet', dll = jelas online
            return true;
        }

        // 3. Default: anggap online (lebih aman daripada offline)
        return true;
    }

    function init(statusCallback) {
        onStatusChange = statusCallback || null;
        document.addEventListener('online', processQueue, false);
        document.addEventListener('offline', function () { report(); }, false);
        window.addEventListener('online', processQueue);
        window.addEventListener('offline', function () { report(); });
        setTimeout(processQueue, 1500);
        setInterval(function () {
            if (isOnline()) processQueue();
        }, 30000);
    }

    function processQueue() {
        if (isSyncing || !isOnline()) { report(); return; }
        TripDB.getSession(function (session) {
            if (!session || !session.token) { report(); return; }
            TripDB.getUnsyncedTrips(function (trips) {
                if (!trips.length) { report(); return; }
                isSyncing = true;
                report();
                uploadNext(trips.slice(), session.token, function () {
                    isSyncing = false;
                    report();
                });
            });
        });
    }

    function uploadNext(queue, token, done) {
        if (!queue.length) { done(); return; }
        var trip = queue.shift();
        TripAPI.uploadTrip(trip, token)
            .then(function () {
                TripDB.markSynced(trip.id, function () {
                    uploadNext(queue, token, done);
                });
            })
            .catch(function (err) {
                console.warn('Gagal sync trip', trip.id, err);
                done();
            });
    }

    function report() {
        if (!onStatusChange) return;
        TripDB.getUnsyncedTrips(function (trips) {
            onStatusChange({ online: isOnline(), syncing: isSyncing, pending: trips.length });
        });
    }

    function syncNow() { processQueue(); }

    global.TripSync = {
        init: init,
        syncNow: syncNow,
        isOnline: isOnline
    };
})(window);
