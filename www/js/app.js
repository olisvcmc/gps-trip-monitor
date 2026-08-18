(function () {
'use strict';
// ---------- State ----------
var map, currentMarker, trailPolyline;
var watchId = null;
var bgGeo = null;
var hasBgPlugin = false;
var bgGeoConfigured = false;
var tripPoints = [];       // [{lat, lng, t, speed, accuracy}]
var totalDistanceKm = 0;
var tripState = 'idle';    // idle | tracking | paused
var startTime = null;
var pausedAccumMs = 0;
var lastPauseStart = null;
var durationTimer = null;
var speedSamples = [];
var currentSession = null;
var authMode = 'login';
var authControlsBound = false;
var idleWatchId = null;

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
    btnAuthToggle: document.getElementById('btnAuthToggle'),
    btnLogout: document.getElementById('btnLogout')
};

// ---------- Helper: Waktu Lokal HP (FIX JAM) ----------
function getLocalDateTime() {
    var now = new Date();
    var pad = function(n) { return n < 10 ? '0' + n : n; };
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + 
           ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
}

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
    if (!authControlsBound) { bindAuthControls(); }
    bindLogout();

    if (window.BackgroundGeolocation) {
        hasBgPlugin = true;
        bgGeo = window.BackgroundGeolocation;
    }
    TripSync.init(updateSyncUI);

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function (pos) {
                map.setView([pos.coords.latitude, pos.coords.longitude], 16);
                currentMarker.setLatLng([pos.coords.latitude, pos.coords.longitude]);
                setGpsStatus('ready', 'Siap');
                startIdleWatch();
            },
            function (err) {
                var msg = 'GPS tidak tersedia';
                if (err && err.code === 1) msg = 'Izin lokasi ditolak';
                else if (err && err.code === 3) msg = 'Sinyal GPS lambat, coba tombol pusatkan';
                setGpsStatus('off', msg);
                startIdleWatch();
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
        );
    } else {
        setGpsStatus('off', 'Geolocation tidak didukung');
    }
}

function startIdleWatch() {
    if (idleWatchId !== null || !navigator.geolocation) return;
    idleWatchId = navigator.geolocation.watchPosition(function (pos) {
        if (tripState === 'tracking') return;
        var lat = pos.coords.latitude, lng = pos.coords.longitude;
        currentMarker.setLatLng([lat, lng]);
        setGpsStatus('ready', 'Siap');
        el.statCoords.textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
        el.statAccuracy.textContent = pos.coords.accuracy ? Math.round(pos.coords.accuracy) : '–';
        el.statSpeed.textContent = (typeof pos.coords.speed === 'number' && pos.coords.speed >= 0)
            ? (pos.coords.speed * 3.6).toFixed(1) : '0.0';
    }, function () {}, {
        enableHighAccuracy: false, maximumAge: 8000, timeout: 20000
    });
}

function stopIdleWatch() {
    if (idleWatchId !== null) {
        navigator.geolocation.clearWatch(idleWatchId);
        idleWatchId = null;
    }
}

// ---------- Auth ----------
function bindAuthControls() {
    authControlsBound = true;
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

var logoutBound = false;
function bindLogout() {
    if (logoutBound || !el.btnLogout) return;
    logoutBound = true;
    el.btnLogout.addEventListener('click', doLogout);
}

function doLogout() {
    if (tripState !== 'idle') { stopTrip(); }
    stopIdleWatch();
    TripDB.clearSession(function () {
        currentSession = null;
        el.historyOverlay.hidden = true;
        el.authUsername.value = '';
        el.authPassword.value = '';
        el.authError.hidden = true;
        authMode = 'login';
        el.authTitle.textContent = 'Masuk ke akun Anda';
        el.btnAuthSubmit.textContent = 'Masuk';
        el.btnAuthToggle.textContent = 'Belum punya akun? Daftar di sini';
        if (!authControlsBound) { bindAuthControls(); }
        el.authOverlay.hidden = false;
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
        showAuthError(err.message || 'Tidak bisa terhubung ke server.');
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
    if (status.syncing) el.syncText.textContent = 'Menyinkronkan…';
    else if (!status.online) el.syncText.textContent = status.pending > 0 ? 'Offline · ' + status.pending + ' tertunda' : 'Offline';
    else el.syncText.textContent = status.pending > 0 ? status.pending + ' menunggu sync' : 'Tersinkron';
}

document.addEventListener('deviceready', boot, false);
setTimeout(function () {
    if (!window.cordova) {
        document.removeEventListener('deviceready', boot, false);
        boot();
    }
}, 800);

// ---------- Background Geolocation ----------
function setupBackgroundGeolocation(onReady) {
    bgGeo.configure({
        desiredAccuracy: bgGeo.HIGH_ACCURACY,
        stationaryRadius: 10,
        distanceFilter: 8,
        debug: false,
        interval: 4000,
        fastestInterval: 2000,
        activitiesInterval: 10000,
        stopOnStillActivity: false,
        notificationTitle: 'GPS Trip Monitor',
        notificationText: 'Melacak perjalanan Anda…',
        notificationIconColor: '#00d9c0',
        startForeground: true,
        stopOnTerminate: false,
        startOnBoot: false,
        locationProvider: bgGeo.ACTIVITY_PROVIDER
    }, function () {
        bgGeoConfigured = true;
        if (onReady) onReady();
    }, function (err) {
        showToast('Gagal konfigurasi tracking latar belakang: ' + err);
    });
    bgGeo.on('location', function (location) {
        handleLocationUpdate({
            lat: location.latitude, lng: location.longitude,
            accuracy: location.accuracy,
            speedMs: (typeof location.speed === 'number' && location.speed >= 0) ? location.speed : null,
            time: location.time || Date.now()
        });
        bgGeo.finish();
    });
    bgGeo.on('stationary', function (location) {
        handleLocationUpdate({
            lat: location.latitude, lng: location.longitude,
            accuracy: location.accuracy, speedMs: 0, time: location.time || Date.now()
        });
        bgGeo.finish();
    });
    bgGeo.on('error', function (error) {
        showToast('Background GPS error: ' + (error && error.message ? error.message : error));
    });
    bgGeo.on('authorization', function (status) {
        if (status === bgGeo.AUTHORIZED) return;
        showToast('Izin lokasi "selalu izinkan" diperlukan.');
        setTimeout(function () { bgGeo.showAppSettings(); }, 1000);
    });
}

// ---------- Map ----------
function initMap() {
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([-6.2, 106.816666], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    trailPolyline = L.polyline([], { color: '#00d9c0', weight: 4, opacity: 0.9, lineJoin: 'round' }).addTo(map);
    var icon = L.divIcon({ className: '', html: '<div class="trip-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
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
    if (!navigator.geolocation) { showToast('Perangkat tidak mendukung GPS.'); return; }
    tripState = 'tracking';
    tripPoints = []; speedSamples = []; totalDistanceKm = 0; pausedAccumMs = 0;
    startTime = Date.now();
    trailPolyline.setLatLngs([]);
    updateHud();
    stopIdleWatch();
    el.btnStart.hidden = true; el.btnPause.hidden = false; el.btnPause.textContent = 'Jeda'; el.btnStop.hidden = false;
    
    if (hasBgPlugin) {
        setGpsStatus('live', 'Menyiapkan tracking latar belakang…');
        if (!bgGeoConfigured) {
            setupBackgroundGeolocation(function () { bgGeo.start(); setGpsStatus('live', 'Melacak (latar belakang aktif)…'); });
        } else { bgGeo.start(); setGpsStatus('live', 'Melacak (latar belakang aktif)…'); }
    } else {
        watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
        setGpsStatus('live', 'Melacak…');
    }
    durationTimer = setInterval(updateDuration, 1000);
}

function togglePause() {
    if (tripState === 'tracking') {
        tripState = 'paused'; lastPauseStart = Date.now();
        el.btnPause.textContent = 'Lanjutkan'; setGpsStatus('ready', 'Dijeda');
    } else if (tripState === 'paused') {
        tripState = 'tracking'; pausedAccumMs += Date.now() - lastPauseStart;
        el.btnPause.textContent = 'Jeda'; setGpsStatus('live', 'Melacak…');
    }
}

function stopTrip() {
    if (hasBgPlugin) bgGeo.stop();
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (durationTimer) { clearInterval(durationTimer); durationTimer = null; }
    if (tripPoints.length > 1) saveTrip();
    tripState = 'idle';
    el.btnStart.hidden = false; el.btnPause.hidden = true; el.btnStop.hidden = true;
    setGpsStatus('ready', 'Siap');
    startIdleWatch();
}

function handleLocationUpdate(data) {
    if (tripState !== 'tracking') return;
    var lat = data.lat, lng = data.lng, accuracy = data.accuracy, speedMs = data.speedMs;
    var prev = tripPoints[tripPoints.length - 1];
    var point = { lat: lat, lng: lng, t: data.time || Date.now(), accuracy: accuracy };
    if (prev) {
        var segKm = haversineKm(prev.lat, prev.lng, lat, lng);
        if (segKm * 1000 > Math.max(4, (accuracy || 10) * 0.5)) totalDistanceKm += segKm;
    }
    var speedKmh = (speedMs !== null && speedMs >= 0) ? speedMs * 3.6 : (prev ? haversineKm(prev.lat, prev.lng, lat, lng) / ((point.t - prev.t) / 3600000) : 0);
    point.speed = speedKmh; speedSamples.push(speedKmh); tripPoints.push(point);
    trailPolyline.addLatLng([lat, lng]);
    currentMarker.setLatLng([lat, lng]);
    map.panTo([lat, lng], { animate: true });
    updateHud(point);
}

function onPosition(pos) { handleLocationUpdate({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, speedMs: pos.coords.speed, time: Date.now() }); }
function onPositionError(err) { setGpsStatus('off', 'Sinyal GPS lemah'); showToast('GPS error: ' + (err.message || 'tidak dapat mengambil lokasi')); }

function updateHud(point) {
    el.statDistance.textContent = totalDistanceKm.toFixed(2);
    if (point) {
        el.statSpeed.textContent = point.speed.toFixed(1);
        el.statAccuracy.textContent = point.accuracy ? Math.round(point.accuracy) : '–';
        el.statCoords.textContent = point.lat.toFixed(5) + ', ' + point.lng.toFixed(5);
    } else { el.statSpeed.textContent = '0.0'; }
    if (speedSamples.length) el.statAvgSpeed.textContent = (speedSamples.reduce(function (a, b) { return a + b; }, 0) / speedSamples.length).toFixed(1);
}

function updateDuration() {
    if (!startTime) return;
    var elapsedMs = Date.now() - startTime - pausedAccumMs;
    if (tripState === 'paused' && lastPauseStart) elapsedMs -= (Date.now() - lastPauseStart);
    el.statDuration.textContent = formatDuration(elapsedMs);
}

function formatDuration(ms) {
    var totalSec = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
    return [h, m, s].map(function (v) { return String(v).padStart(2, '0'); }).join(':');
}

function setGpsStatus(kind, text) {
    el.gpsStatusText.textContent = text;
    el.gpsStatusDot.className = 'status-dot' + (kind === 'live' ? ' live' : kind === 'off' ? ' off' : '');
}

function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371, dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function toRad(deg) { return deg * Math.PI / 180; }

// ---------- Save Trip (FIX JAM & KOORDINAT) ----------
function saveTrip() {
    var elapsedMs = Date.now() - startTime - pausedAccumMs;
    
    // DEBUG: Cek di Console apakah titik koordinat benar-benar ada
    console.log('DEBUG saveTrip: Jumlah titik yang akan disimpan =', tripPoints.length);
    console.log('DEBUG saveTrip: Contoh 2 titik pertama =', tripPoints.slice(0, 2));

    var trip = {
        id: 'trip_' + Date.now(),
        user_id: currentSession ? currentSession.user_id : null,
        date: getLocalDateTime(), // FIX JAM: Gunakan waktu lokal HP, bukan UTC
        distanceKm: Number(totalDistanceKm.toFixed(2)),
        durationMs: elapsedMs,
        avgSpeedKmh: speedSamples.length
            ? Number((speedSamples.reduce(function (a, b) { return a + b; }, 0) / speedSamples.length).toFixed(1))
            : 0,
        points: tripPoints.map(function (p) { return [p.lat, p.lng]; }) // FIX KOORDINAT: Pastikan format [lat, lng]
    };
    
    TripDB.saveTrip(trip, function () {
        renderHistory();
        // Tampilkan jumlah titik di notifikasi agar Anda yakin
        showToast('Disimpan: ' + trip.distanceKm + ' km (' + tripPoints.length + ' titik)' + (TripSync.isOnline() ? ' · sync…' : ' · offline'));
        TripSync.syncNow();
    });
}

function deleteTrip(id) { TripDB.deleteTrip(id, function () { renderHistory(); }); }

function renderHistory() {
    TripDB.getAllTrips(function (trips) {
        el.historyList.innerHTML = '';
        if (!trips.length) { el.historyList.innerHTML = '<p class="empty-state">Belum ada perjalanan.</p>'; return; }
        trips.forEach(function (trip) {
            var card = document.createElement('div'); card.className = 'trip-card';
            var info = document.createElement('div'); info.className = 'trip-card-info';
            var dateEl = document.createElement('span'); dateEl.className = 'trip-card-date';
            dateEl.textContent = trip.date + (trip.synced ? ' · tersinkron' : ' · belum sync');
            var statsEl = document.createElement('span'); statsEl.className = 'trip-card-stats';
            statsEl.textContent = trip.distanceKm + ' km · ' + formatDuration(trip.durationMs);
            info.appendChild(dateEl); info.appendChild(statsEl);
            var delBtn = document.createElement('button'); delBtn.className = 'trip-card-del'; delBtn.textContent = '✕';
            delBtn.addEventListener('click', function () { deleteTrip(trip.id); });
            card.appendChild(info); card.appendChild(delBtn);
            card.addEventListener('click', function (ev) { if (ev.target === delBtn) return; showTripOnMap(trip); el.historyOverlay.hidden = true; });
            el.historyList.appendChild(card);
        });
    });
}

function showTripOnMap(trip) {
    if (!trip.points || !trip.points.length) return;
    trailPolyline.setLatLngs(trip.points);
    currentMarker.setLatLng(trip.points[trip.points.length - 1]);
    map.fitBounds(trailPolyline.getBounds(), { padding: [40, 40] });
}

var toastTimer = null;
function showToast(msg) {
    el.toast.textContent = msg; el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 3000);
}
})();
