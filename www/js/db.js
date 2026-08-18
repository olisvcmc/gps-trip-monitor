/**
 * db.js — Lapisan penyimpanan lokal offline-first.
 *
 * Memakai cordova-sqlite-storage jika tersedia (app native Android/iOS),
 * sehingga data TETAP TERSIMPAN walau HP tidak ada koneksi internet sama sekali.
 * Kalau dibuka di browser biasa (tanpa Cordova) untuk uji coba, otomatis
 * fallback ke localStorage supaya tetap bisa dites tanpa build APK.
 *
 * Tabel:
 *  - session(id, user_id, username, token, server_url)  -> satu baris, sesi login aktif
 *  - trips(id, user_id, date, distance_km, duration_ms, avg_speed_kmh,
 *          points_json, synced, created_at)
 */
(function (global) {
    'use strict';

    var db = null;
    var useSqlite = false;
    var LS_TRIPS_KEY = 'gpsTripMonitor.trips.v2';
    var LS_SESSION_KEY = 'gpsTripMonitor.session';

    function init(callback) {
        if (window.sqlitePlugin) {
            useSqlite = true;
            db = window.sqlitePlugin.openDatabase({ name: 'gpstracker.db', location: 'default' });
            db.transaction(function (tx) {
                tx.executeSql('CREATE TABLE IF NOT EXISTS session (' +
                    'id INTEGER PRIMARY KEY CHECK (id = 1), ' +
                    'user_id INTEGER, username TEXT, token TEXT, server_url TEXT)');
                tx.executeSql('CREATE TABLE IF NOT EXISTS trips (' +
                    'id TEXT PRIMARY KEY, user_id INTEGER, date TEXT, ' +
                    'distance_km REAL, duration_ms INTEGER, avg_speed_kmh REAL, ' +
                    'points_json TEXT, synced INTEGER DEFAULT 0, created_at TEXT)');
            }, function (err) {
                console.error('DB init error', err);
                callback(err);
            }, function () { callback(null); });
        } else {
            // Fallback browser (tanpa Cordova): pakai localStorage, cukup untuk uji coba UI.
            useSqlite = false;
            callback(null);
        }
    }

    // ---------- Session (login aktif) ----------
    function saveSession(session, callback) {
        if (useSqlite) {
            db.transaction(function (tx) {
                tx.executeSql(
                    'INSERT OR REPLACE INTO session (id, user_id, username, token, server_url) VALUES (1, ?, ?, ?, ?)',
                    [session.user_id, session.username, session.token, session.server_url]
                );
            }, function (err) { callback && callback(err); }, function () { callback && callback(null); });
        } else {
            localStorage.setItem(LS_SESSION_KEY, JSON.stringify(session));
            callback && callback(null);
        }
    }

    function getSession(callback) {
        if (useSqlite) {
            db.transaction(function (tx) {
                tx.executeSql('SELECT * FROM session WHERE id = 1', [], function (tx, res) {
                    callback(res.rows.length ? res.rows.item(0) : null);
                });
            }, function () { callback(null); });
        } else {
            try {
                var raw = localStorage.getItem(LS_SESSION_KEY);
                callback(raw ? JSON.parse(raw) : null);
            } catch (e) { callback(null); }
        }
    }

    function clearSession(callback) {
        if (useSqlite) {
            db.transaction(function (tx) {
                tx.executeSql('DELETE FROM session WHERE id = 1');
            }, function (err) { callback && callback(err); }, function () { callback && callback(null); });
        } else {
            localStorage.removeItem(LS_SESSION_KEY);
            callback && callback(null);
        }
    }

    // ---------- Trips ----------
    function saveTrip(trip, callback) {
        if (useSqlite) {
            db.transaction(function (tx) {
                tx.executeSql(
                    'INSERT INTO trips (id, user_id, date, distance_km, duration_ms, avg_speed_kmh, points_json, synced, created_at) ' +
                    'VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
                    [trip.id, trip.user_id, trip.date, trip.distanceKm, trip.durationMs,
                    trip.avgSpeedKmh, JSON.stringify(trip.points), new Date().toISOString()]
                );
            }, function (err) { callback && callback(err); }, function () { callback && callback(null); });
        } else {
            var trips = readLocalTrips();
            trip.synced = 0;
            trips.unshift(trip);
            localStorage.setItem(LS_TRIPS_KEY, JSON.stringify(trips));
            callback && callback(null);
        }
    }

    function getAllTrips(callback) {
        if (useSqlite) {
            db.transaction(function (tx) {
                tx.executeSql('SELECT * FROM trips ORDER BY created_at DESC', [], function (tx, res) {
                    var out = [];
                    for (var i = 0; i < res.rows.length; i++) {
                        out.push(rowToTrip(res.rows.item(i)));
                    }
                    callback(out);
                });
            }, function () { callback([]); });
        } else {
            callback(readLocalTrips());
        }
    }

    function getUnsyncedTrips(callback) {
        if (useSqlite) {
            db.transaction(function (tx) {
                tx.executeSql('SELECT * FROM trips WHERE synced = 0 ORDER BY created_at ASC', [], function (tx, res) {
                    var out = [];
                    for (var i = 0; i < res.rows.length; i++) {
                        out.push(rowToTrip(res.rows.item(i)));
                    }
                    callback(out);
                });
            }, function () { callback([]); });
        } else {
            callback(readLocalTrips().filter(function (t) { return !t.synced; }));
        }
    }

    function markSynced(tripId, callback) {
        if (useSqlite) {
            db.transaction(function (tx) {
                tx.executeSql('UPDATE trips SET synced = 1 WHERE id = ?', [tripId]);
            }, function (err) { callback && callback(err); }, function () { callback && callback(null); });
        } else {
            var trips = readLocalTrips();
            trips.forEach(function (t) { if (t.id === tripId) t.synced = 1; });
            localStorage.setItem(LS_TRIPS_KEY, JSON.stringify(trips));
            callback && callback(null);
        }
    }

    function deleteTrip(tripId, callback) {
        if (useSqlite) {
            db.transaction(function (tx) {
                tx.executeSql('DELETE FROM trips WHERE id = ?', [tripId]);
            }, function (err) { callback && callback(err); }, function () { callback && callback(null); });
        } else {
            var trips = readLocalTrips().filter(function (t) { return t.id !== tripId; });
            localStorage.setItem(LS_TRIPS_KEY, JSON.stringify(trips));
            callback && callback(null);
        }
    }

    function rowToTrip(row) {
        return {
            id: row.id,
            user_id: row.user_id,
            date: row.date,
            distanceKm: row.distance_km,
            durationMs: row.duration_ms,
            avgSpeedKmh: row.avg_speed_kmh,
            points: JSON.parse(row.points_json || '[]'),
            synced: row.synced
        };
    }

    function readLocalTrips() {
        try { return JSON.parse(localStorage.getItem(LS_TRIPS_KEY)) || []; } catch (e) { return []; }
    }

    global.TripDB = {
        init: init,
        saveSession: saveSession,
        getSession: getSession,
        clearSession: clearSession,
        saveTrip: saveTrip,
        getAllTrips: getAllTrips,
        getUnsyncedTrips: getUnsyncedTrips,
        markSynced: markSynced,
        deleteTrip: deleteTrip,
        isUsingSqlite: function () { return useSqlite; }
    };

})(window);
