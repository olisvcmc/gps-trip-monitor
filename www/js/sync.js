/**
 * sync.js — Auto-sync antrian trip yang belum terkirim ke server.
 *
 * Alur:
 *  1. Setiap trip SELALU disimpan ke SQLite lokal dulu (lihat db.js), apapun status internet.
 *  2. Modul ini mendengarkan event online/offline (dari cordova-plugin-network-information,
 *     fallback ke window.online/offline di browser biasa).
 *  3. Begitu status berubah jadi online, semua trip dengan synced=0 otomatis diupload satu per satu.
 *  4. Dipanggil juga secara manual setelah trip baru selesai dicatat, untuk percobaan sync langsung.
 */
(function (global) {
    'use strict';

    var isSyncing = false;
    var onStatusChange = null; // callback opsional untuk update UI (jumlah pending, dsb.)

    function isOnline() {
        if (navigator.connection && typeof navigator.connection.type !== 'undefined') {
            return navigator.connection.type !== 'none' && navigator.connection.type !== 'unknown';
        }
        return navigator.onLine !== false;
    }

    function init(statusCallback) {
        onStatusChange = statusCallback || null;

        // cordova-plugin-network-information memicu event ini di document
        document.addEventListener('online', processQueue, false);
        document.addEventListener('offline', function () { report(); }, false);

        // Fallback untuk browser biasa
        window.addEventListener('online', processQueue);
        window.addEventListener('offline', function () { report(); });

        // Cek sekali saat startup, kalau kebetulan sudah online & ada antrian lama
        setTimeout(processQueue, 1500);

        // Polling ringan tiap 30 detik sebagai jaring pengaman
        // (beberapa perangkat/ROM tidak selalu memicu event online dengan konsisten)
        setInterval(function () {
            if (isOnline()) processQueue();
        }, 30000);
    }

    function processQueue() {
        if (isSyncing || !isOnline()) { report(); return; }

        TripDB.getSession(function (session) {
            if (!session || !session.token) { report(); return; } // belum login, tidak ada yang disync

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
                // Hentikan batch ini kalau errornya bukan soal jaringan (misal token invalid),
                // supaya tidak spam request gagal berulang-ulang.
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
