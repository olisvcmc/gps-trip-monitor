(function () {
    'use strict';

    // ---------- State ----------
    var map, currentMarker, trailPolyline;
    var watchId = null;
    var bgGeo = null;              // instance plugin cordova-background-geolocation-lt (jika tersedia)
    var hasBgPlugin = false;
    var bgGeoConfigured = false;
    var tripPoints = [];       // [{lat, lng, t, speed, accuracy}]
    var totalDistanceKm = 0;
    var tripState = 'idle';    // idle | tracking | paused
    var startTime = null;
    var pausedAccumMs = 0;     // total waktu jeda dikurangi dari durasi
    var lastPauseStart = null;
    var durationTimer = null;
    var speedSamples = [];     // untuk kecepatan rata-rata
    var currentSession = null; // { user_id, username, token, server_url }
    var authMode = 'login';    // login | register

    // ---------- DOM ----------
    var el = {
        statSpeed: document.getElementById('statSpeed'),
        statDistance: document.getElementById('statDistance'),
        statDuration: document.getElementById('statDuration'),
        statAvgSpeed: document.getElementById('statAvgSpeed'),
        statAccuracy: document.getElementById('statAccuracy'),
        statCoords: document.getElementById('statCoords'),
        gpsStatusDot: document.getElementById('gpsStatusDot'),
        gpsStatusText: document.getElementById('gpsStatusText'),
        syncDot: document.getElementById('syncDot'),
        syncText: document.getElementById('syncText'),
        btnStart: document.getElementById('btnStart'),
        btnPause: document.getElementById('btnPause'),
        btnStop: document.getElementById('btnStop'),
        btnCenter: document.getElementById('btnCenter'),
        btnHistory: document.getElementById('btnHistory'),
        btnCloseHistory: document.getElementById('btnCloseHistory'),
        historyOverlay: document.getElementById('historyOverlay'),
        historyList: document.getElementById('historyList'),
        toast: document.getElementById('toast'),
        authOverlay: document.getElementById('authOverlay'),
        authTitle: document.getElementById('authTitle'),
        authUsername: document.getElementById('authUsername'),
        authPassword: document.getElementById('authPassword'),
        authError: document.getElementById('authError'),
        btnAuthSubmit: document.getElementById('btnAuthSubmit'),
        btnAuthToggle: document.getElementById('btnAuthToggle')
    };

    // ---------- Init ----------
    function boot() {
        TripDB.init(function () {
            TripDB.getSession(function (session) {
                if (session && session.token) {
                    currentSession = session;
                    if (session.server_url) TripAPI.setBaseUrl(session.server_url);
                    enterApp();
                } else {
                    bindAuthControls();
                    el.authOverlay.hidden = false;
                }
            });
        });
    }

    function enterApp() {
        el.authOverlay.hidden = true;
        initMap();
        bindControls();
        renderHistory();

        if (window.BackgroundGeolocation) {
            hasBgPlugin = true;
            bgGeo = window.BackgroundGeolocation;
            setupBackgroundGeolocation();
        }

        TripSync.init(updateSyncUI);

        // Coba dapatkan posisi awal supaya peta langsung terpusat
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                function (pos) {
                    map.setView([pos.coords.latitude, pos.coords.longitude], 16);
                    setGpsStatus('ready', 'Siap');
                },
                function () { setGpsStatus('off', 'GPS tidak tersedia'); },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        } else {
            setGpsStatus('off', 'Geolocation tidak didukung');
        }
    }

    // ---------- Auth (login / daftar) ----------
    function bindAuthControls() {
        el.btnAuthSubmit.addEventListener('click', submitAuth);
        el.btnAuthToggle.addEventListener('click', function () {
            authMode = authMode === 'login' ? 'register' : 'login';
            el.authTitle.textContent = authMode === 'login' ? 'Masuk ke akun Anda' : 'Buat akun baru';
            el.btnAuthSubmit.textContent = authMode === 'login' ? 'Masuk' : 'Daftar';
            el.btnAuthToggle.textContent = authMode === 'login'
                ? 'Belum punya akun? Daftar di sini'
                : 'Sudah punya akun? Masuk di sini';
            el.authError.hidden = true;
        });
    }

    function submitAuth() {
        var username = el.authUsername.value.trim();
        var password = el.authPassword.value;
        if (!username || !password) {
            showAuthError('Username dan password wajib diisi.');
            return;
        }
        el.btnAuthSubmit.disabled = true;
        el.btnAuthSubmit.textContent = authMode === 'login' ? 'Memproses…' : 'Mendaftarkan…';

        var call = authMode === 'login' ? TripAPI.login(username, password) : TripAPI.register(username, password);
        call.then(function (data) {
            currentSession = {
                user_id: data.user_id,
                username: username,
                token: data.token,
                server_url: TripAPI.getBaseUrl()
            };
            TripDB.saveSession(currentSession, function () {
                enterApp();
            });
        }).catch(function (err) {
            showAuthError(err.message || 'Tidak bisa terhubung ke server. Cek koneksi internet & alamat server.');
        }).finally(function () {
            el.btnAuthSubmit.disabled = false;
            el.btnAuthSubmit.textContent = authMode === 'login' ? 'Masuk' : 'Daftar';
        });
    }

    function showAuthError(msg) {
        el.authError.textContent = msg;
        el.authError.hidden = false;
    }

    function updateSyncUI(status) {
        el.syncDot.className = 'sync-dot ' + (status.syncing ? 'syncing' : status.online ? 'online' : 'offline');
        if (status.syncing) {
            el.syncText.textContent = 'Menyinkronkan…';
        } else if (!status.online) {
            el.syncText.textContent = status.pending > 0 ? 'Offline · ' + status.pending + ' tertunda' : 'Offline';
        } else {
            el.syncText.textContent = status.pending > 0 ? status.pending + ' menunggu sync' : 'Tersinkron';
        }
    }

    // Cordova: tunggu deviceready. Jika dibuka langsung di browser (tanpa cordova.js), fallback ke DOMContentLoaded.
    document.addEventListener('deviceready', boot, false);
    setTimeout(function () {
        if (!window.cordova) {
            document.removeEventListener('deviceready', boot, false);
            boot();
        }
    }, 800);

    // ---------- Background Geolocation (aktif saat app diminimize) ----------
    function setupBackgroundGeolocation() {
        bgGeo.configure({
            desiredAccuracy: bgGeo.HIGH_ACCURACY,
            stationaryRadius: 10,
            distanceFilter: 8,
            debug: false,
            interval: 4000,            // Android: interval update saat bergerak (ms)
            fastestInterval: 2000,
            activitiesInterval: 10000,
            stopOnStillActivity: false,
            notificationTitle: 'GPS Trip Monitor',
            notificationText: 'Melacak perjalanan Anda di latar belakang…',
            notificationIconColor: '#00d9c0',
            startForeground: true,     // wajib Android 8+ agar service tidak dibunuh sistem
            stopOnTerminate: false,    // tetap lanjut walau app di-swipe dari recent apps
            startOnBoot: false,
            locationProvider: bgGeo.ACTIVITY_PROVIDER
        }, function () {
            bgGeoConfigured = true;
        }, function (err) {
            showToast('Gagal konfigurasi tracking latar belakang: ' + err);
        });

        bgGeo.on('location', function (location) {
            handleLocationUpdate({
                lat: location.latitude,
                lng: location.longitude,
                accuracy: location.accuracy,
                speedMs: (typeof location.speed === 'number' && location.speed >= 0) ? location.speed : null,
                time: location.time || Date.now()
            });
            // Wajib dipanggil di Android agar service tahu lokasi sudah diproses
            bgGeo.finish();
        });

        bgGeo.on('stationary', function (location) {
            handleLocationUpdate({
                lat: location.latitude,
                lng: location.longitude,
                accuracy: location.accuracy,
                speedMs: 0,
                time: location.time || Date.now()
            });
            bgGeo.finish();
        });

        bgGeo.on('error', function (error) {
            showToast('Background GPS error: ' + (error && error.message ? error.message : error));
        });

        bgGeo.on('authorization', function (status) {
            if (status === bgGeo.AUTHORIZED) return;
            showToast('Izin lokasi "selalu izinkan" diperlukan agar tracking berjalan saat app diminimize.');
            setTimeout(function () { bgGeo.showAppSettings(); }, 1000);
        });
    }

    // ---------- Map ----------
    function initMap() {
        map = L.map('map', { zoomControl: false, attributionControl: false }).setView([-6.2, 106.816666], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
        }).addTo(map);

        trailPolyline = L.polyline([], {
            color: '#00d9c0',
            weight: 4,
            opacity: 0.9,
            lineJoin: 'round'
        }).addTo(map);

        var icon = L.divIcon({ className: '', html: '<div class="trip-marker"></div>', iconSize: [18, 18] });
        currentMarker = L.marker([-6.2, 106.816666], { icon: icon, zIndexOffset: 1000 }).addTo(map);
    }

    function bindControls() {
        el.btnStart.addEventListener('click', startTrip);
        el.btnPause.addEventListener('click', togglePause);
        el.btnStop.addEventListener('click', stopTrip);
        el.btnCenter.addEventListener('click', function () {
            if (tripPoints.length) {
                var last = tripPoints[tripPoints.length - 1];
                map.setView([last.lat, last.lng], 17, { animate: true });
            }
        });
        el.btnHistory.addEventListener('click', function () { el.historyOverlay.hidden = false; });
        el.btnCloseHistory.addEventListener('click', function () { el.historyOverlay.hidden = true; });
    }

    // ---------- Trip control ----------
    function startTrip() {
        if (!navigator.geolocation) {
            showToast('Perangkat tidak mendukung GPS.');
            return;
        }
        tripState = 'tracking';
        tripPoints = [];
        speedSamples = [];
        totalDistanceKm = 0;
        pausedAccumMs = 0;
        startTime = Date.now();
        trailPolyline.setLatLngs([]);
        updateHud();

        el.btnStart.hidden = true;
        el.btnPause.hidden = false;
        el.btnPause.textContent = 'Jeda';
        el.btnStop.hidden = false;

        if (hasBgPlugin) {
            // Tracking tetap berjalan walau app diminimize/background,
            // ditandai notifikasi persisten (foreground service Android).
            bgGeo.start();
            setGpsStatus('live', 'Melacak (latar belakang aktif)…');
        } else {
            // Fallback: hanya jalan selagi app di foreground (browser / plugin belum terpasang)
            watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
                enableHighAccuracy: true,
                maximumAge: 1000,
                timeout: 15000
            });
            setGpsStatus('live', 'Melacak…');
        }

        durationTimer = setInterval(updateDuration, 1000);
    }

    function togglePause() {
        if (tripState === 'tracking') {
            tripState = 'paused';
            lastPauseStart = Date.now();
            el.btnPause.textContent = 'Lanjutkan';
            setGpsStatus('ready', 'Dijeda');
        } else if (tripState === 'paused') {
            tripState = 'tracking';
            pausedAccumMs += Date.now() - lastPauseStart;
            el.btnPause.textContent = 'Jeda';
            setGpsStatus('live', hasBgPlugin ? 'Melacak (latar belakang aktif)…' : 'Melacak…');
        }
    }

    function stopTrip() {
        if (hasBgPlugin) {
            bgGeo.stop();
        }
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        if (durationTimer) { clearInterval(durationTimer); durationTimer = null; }

        if (tripPoints.length > 1) {
            saveTrip();
        }

        tripState = 'idle';
        el.btnStart.hidden = false;
        el.btnPause.hidden = true;
        el.btnStop.hidden = true;
        setGpsStatus('ready', 'Siap');
    }

    // ---------- Geolocation callbacks ----------
    // Sumber lokasi bisa dari navigator.geolocation (foreground, browser fallback)
    // ATAU dari plugin BackgroundGeolocation (tetap jalan saat app diminimize).
    // Keduanya bermuara ke fungsi bersama ini supaya HUD, trail, dan penyimpanan konsisten.
    function handleLocationUpdate(data) {
        if (tripState !== 'tracking') return; // abaikan update saat dijeda/idle

        var lat = data.lat;
        var lng = data.lng;
        var accuracy = data.accuracy;
        var speedMs = data.speedMs; // meter/detik, bisa null

        var prev = tripPoints[tripPoints.length - 1];
        var point = { lat: lat, lng: lng, t: data.time || Date.now(), accuracy: accuracy };

        if (prev) {
            var segKm = haversineKm(prev.lat, prev.lng, lat, lng);
            // Saring noise GPS: lompatan kecil di bawah akurasi tidak dihitung
            if (segKm * 1000 > Math.max(4, (accuracy || 10) * 0.5)) {
                totalDistanceKm += segKm;
            }
        }

        var speedKmh;
        if (speedMs !== null && speedMs !== undefined && speedMs >= 0) {
            speedKmh = speedMs * 3.6;
        } else if (prev) {
            var dtH = (point.t - prev.t) / 3600000;
            speedKmh = dtH > 0 ? haversineKm(prev.lat, prev.lng, lat, lng) / dtH : 0;
        } else {
            speedKmh = 0;
        }
        point.speed = speedKmh;
        speedSamples.push(speedKmh);

        tripPoints.push(point);
        trailPolyline.addLatLng([lat, lng]);
        currentMarker.setLatLng([lat, lng]);
        map.panTo([lat, lng], { animate: true });

        updateHud(point);
    }

    // Wrapper untuk navigator.geolocation.watchPosition (dipakai jika plugin background tidak tersedia)
    function onPosition(pos) {
        handleLocationUpdate({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            speedMs: pos.coords.speed,
            time: Date.now()
        });
    }

    function onPositionError(err) {
        setGpsStatus('off', 'Sinyal GPS lemah');
        showToast('GPS error: ' + (err.message || 'tidak dapat mengambil lokasi'));
    }

    // ---------- HUD ----------
    function updateHud(point) {
        el.statDistance.textContent = totalDistanceKm.toFixed(2);

        if (point) {
            el.statSpeed.textContent = point.speed.toFixed(1);
            el.statAccuracy.textContent = point.accuracy ? Math.round(point.accuracy) : '–';
            el.statCoords.textContent = point.lat.toFixed(5) + ', ' + point.lng.toFixed(5);
        } else {
            el.statSpeed.textContent = '0.0';
        }

        if (speedSamples.length) {
            var avg = speedSamples.reduce(function (a, b) { return a + b; }, 0) / speedSamples.length;
            el.statAvgSpeed.textContent = avg.toFixed(1);
        }
    }

    function updateDuration() {
        if (!startTime) return;
        var elapsedMs = Date.now() - startTime - pausedAccumMs;
        if (tripState === 'paused' && lastPauseStart) {
            elapsedMs -= (Date.now() - lastPauseStart);
        }
        el.statDuration.textContent = formatDuration(elapsedMs);
    }

    function formatDuration(ms) {
        var totalSec = Math.max(0, Math.floor(ms / 1000));
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;
        return [h, m, s].map(function (v) { return String(v).padStart(2, '0'); }).join(':');
    }

    function setGpsStatus(kind, text) {
        el.gpsStatusText.textContent = text;
        el.gpsStatusDot.className = 'status-dot' + (kind === 'live' ? ' live' : kind === 'off' ? ' off' : '');
    }

    // ---------- Distance ----------
    function haversineKm(lat1, lon1, lat2, lon2) {
        var R = 6371;
        var dLat = toRad(lat2 - lat1);
        var dLon = toRad(lon2 - lon1);
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    function toRad(deg) { return deg * Math.PI / 180; }

    // ---------- History (SQLite lokal via db.js, offline-first) ----------
    function saveTrip() {
        var elapsedMs = Date.now() - startTime - pausedAccumMs;
        var trip = {
            id: 'trip_' + Date.now(),
            user_id: currentSession ? currentSession.user_id : null,
            date: new Date().toISOString(),
            distanceKm: Number(totalDistanceKm.toFixed(2)),
            durationMs: elapsedMs,
            avgSpeedKmh: speedSamples.length
                ? Number((speedSamples.reduce(function (a, b) { return a + b; }, 0) / speedSamples.length).toFixed(1))
                : 0,
            points: tripPoints.map(function (p) { return [p.lat, p.lng]; })
        };
        // Selalu disimpan lokal dulu (jalan walau tidak ada internet sama sekali)
        TripDB.saveTrip(trip, function () {
            renderHistory();
            showToast('Perjalanan disimpan: ' + trip.distanceKm + ' km' + (TripSync.isOnline() ? ' · menyinkronkan…' : ' · akan disinkronkan saat online'));
            TripSync.syncNow();
        });
    }

    function deleteTrip(id) {
        TripDB.deleteTrip(id, function () { renderHistory(); });
    }

    function renderHistory() {
        TripDB.getAllTrips(function (trips) {
            el.historyList.innerHTML = '';
            if (!trips.length) {
                el.historyList.innerHTML = '<p class="empty-state">Belum ada perjalanan yang tersimpan.</p>';
                return;
            }
            trips.forEach(function (trip) {
                var card = document.createElement('div');
                card.className = 'trip-card';

                var info = document.createElement('div');
                info.className = 'trip-card-info';
                var dateEl = document.createElement('span');
                dateEl.className = 'trip-card-date';
                dateEl.textContent = new Date(trip.date).toLocaleString('id-ID') + (trip.synced ? ' · tersinkron' : ' · belum sync');
                var statsEl = document.createElement('span');
                statsEl.className = 'trip-card-stats';
                statsEl.textContent = trip.distanceKm + ' km · ' + formatDuration(trip.durationMs) + ' · ' + trip.avgSpeedKmh + ' km/j';
                info.appendChild(dateEl);
                info.appendChild(statsEl);

                var delBtn = document.createElement('button');
                delBtn.className = 'trip-card-del';
                delBtn.textContent = '✕';
                delBtn.addEventListener('click', function () { deleteTrip(trip.id); });

                card.appendChild(info);
                card.appendChild(delBtn);

                card.addEventListener('click', function (ev) {
                    if (ev.target === delBtn) return;
                    showTripOnMap(trip);
                    el.historyOverlay.hidden = true;
                });

                el.historyList.appendChild(card);
            });
        });
    }

    function showTripOnMap(trip) {
        if (!trip.points || !trip.points.length) return;
        trailPolyline.setLatLngs(trip.points);
        var last = trip.points[trip.points.length - 1];
        currentMarker.setLatLng(last);
        map.fitBounds(trailPolyline.getBounds(), { padding: [40, 40] });
    }

    // ---------- Toast ----------
    var toastTimer = null;
    function showToast(msg) {
        el.toast.textContent = msg;
        el.toast.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.toast.hidden = true; }, 3000);
    }

})();
