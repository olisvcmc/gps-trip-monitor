(function () {
'use strict';

// ---------- State ----------
var map, currentMarker, trailPolyline;
var watchId = null;
var bgGeo = null;
var hasBgPlugin = false;
var bgGeoConfigured = false;
var tripPoints = [];
var totalDistanceKm = 0;
var tripState = 'idle';
var startTime = null;
var pausedAccumMs = 0;
var lastPauseStart = null;
var durationTimer = null;
var speedSamples = [];
var currentSession = null;
var authMode = 'login';

// Flag untuk mencegah inisialisasi ganda & menangani siklus login/logout
var isBooted = false;
var appEntered = false;
var controlsBound = false;

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
    btnLogout: document.getElementById('btnLogout'),
    currentUser: document.getElementById('currentUser')
};

// ---------- Init ----------
function boot() {
    if (isBooted) return;
    isBooted = true;

    TripDB.init(function () {
        TripDB.getSession(function (session) {
            if (session && session.token) {
                currentSession = session;
                if (session.server_url) TripAPI.setBaseUrl(session.server_url);
                enterApp();
            } else {
                showLoginScreen();
            }
        });
    });
}

function showLoginScreen() {
    bindAuthControls();
    el.authOverlay.hidden = false;
}

function enterApp() {
    if (appEntered) return;
    appEntered = true;

    el.authOverlay.hidden = true;
    
    // Tampilkan nama user yang login
    if (el.currentUser && currentSession) {
        el.currentUser.textContent = currentSession.username;
    }

    // Bind controls hanya sekali
    if (!controlsBound) {
        bindControls();
        controlsBound = true;
    }

    initMap();
    renderHistory();
    
    if (window.BackgroundGeolocation) {
        hasBgPlugin = true;
        bgGeo = window.BackgroundGeolocation;
    }
    TripSync.init(updateSyncUI);
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function (pos) {
                if (map) map.setView([pos.coords.latitude, pos.coords.longitude], 16);
                setGpsStatus('ready', 'Siap');
            },
            function (err) {
                var msg = 'GPS tidak tersedia';
                if (err && err.code === 1) msg = 'Izin lokasi ditolak';
                else if (err && err.code === 3) msg = 'Sinyal GPS lambat';
                setGpsStatus('off', msg);
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
        );
    } else {
        setGpsStatus('off', 'Geolocation tidak didukung');
    }
}

// ---------- Auth ----------
function bindAuthControls() {
    // Clone node untuk mencegah duplicate event listener
    var newSubmitBtn = el.btnAuthSubmit.cloneNode(true);
    el.btnAuthSubmit.parentNode.replaceChild(newSubmitBtn, el.btnAuthSubmit);
    el.btnAuthSubmit = newSubmitBtn;
    
    var newToggleBtn = el.btnAuthToggle.cloneNode(true);
    el.btnAuthToggle.parentNode.replaceChild(newToggleBtn, el.btnAuthToggle);
    el.btnAuthToggle = newToggleBtn;

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

// Cordova fallback
document.addEventListener('deviceready', boot, false);
setTimeout(function () {
    if (!window.cordova && !isBooted) {
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
        showToast('Gagal konfigurasi background GPS: ' + err);
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
}

// ---------- Map ----------
function initMap() {
    // Hapus map lama jika ada (mencegah error "container already initialized")
    if (map) {
        map.remove();
        map = null;
    }

    map = L.map('map', { zoomControl: false, attributionControl: false }).setView([-6.2, 106.816666], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    trailPolyline = L.polyline([], { color: '#00d9c0', weight: 4, opacity: 0.9, lineJoin: 'round' }).addTo(map);
    var icon = L.divIcon({ className: '', html: '<div class="trip-marker"></div>', iconSize: [18, 18] });
    currentMarker = L.marker([-6.2, 106.816666], { icon: icon, zIndexOffset: 1000 }).addTo(map);
}

function bindControls() {
    // Tambahkan pengecekan (if) agar aplikasi tidak crash jika ada tombol yang hilang di HTML
    if (el.btnStart) el.btnStart.addEventListener('click', startTrip);
    if (el.btnPause) el.btnPause.addEventListener('click', togglePause);
    
    // PERBAIKAN: Cek apakah btnStop ada sebelum menambahkan event
    if (el.btnStop) {
        el.btnStop.addEventListener('click', stopTrip);
    } else {
        console.error('Tombol btnStop tidak ditemukan di index.html!');
    }

    if (el.btnCenter) {
        el.btnCenter.addEventListener('click', function () {
            if (tripPoints.length && map) {
                var last = tripPoints[tripPoints.length - 1];
                map.setView([last.lat, last.lng], 17, { animate: true });
            }
        });
    }
    if (el.btnHistory) el.btnHistory.addEventListener('click', function () { el.historyOverlay.hidden = false; });
    if (el.btnCloseHistory) el.btnCloseHistory.addEventListener('click', function () { el.historyOverlay.hidden = true; });
    
    if (el.btnLogout) el.btnLogout.addEventListener('click', doLogout);
}

// ---------- Trip control ----------
function startTrip() {
    if (!navigator.geolocation) { showToast('GPS tidak didukung.'); return; }
    tripState = 'tracking';
    tripPoints = []; speedSamples = []; totalDistanceKm = 0; pausedAccumMs = 0;
    startTime = Date.now(); // Simpan waktu mulai
    if (trailPolyline) trailPolyline.setLatLngs([]);
    updateHud();
    el.btnStart.hidden = true; el.btnPause.hidden = false; el.btnPause.textContent = 'Jeda'; el.btnStop.hidden = false;
    
    if (hasBgPlugin) {
        setGpsStatus('live', 'Menyiapkan tracking latar belakang…');
        if (!bgGeoConfigured) {
            setupBackgroundGeolocation(function () { bgGeo.start(); setGpsStatus('live', 'Melacak (latar belakang)…'); });
        } else { bgGeo.start(); setGpsStatus('live', 'Melacak (latar belakang)…'); }
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
    console.log('Tombol Selesai ditekan. Jumlah titik:', tripPoints.length);

    // 1. Hentikan Background Geolocation dengan aman (try-catch)
    try {
        if (hasBgPlugin && bgGeo && bgGeoConfigured) {
            bgGeo.stop();
        }
    } catch (e) {
        console.warn('Gagal menghentikan bgGeo:', e);
    }

    // 2. Hentikan Foreground Geolocation
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    // 3. Hentikan Timer Durasi
    if (durationTimer) { 
        clearInterval(durationTimer); 
        durationTimer = null; 
    }

    // 4. RESET UI LANGSUNG (Wajib dilakukan di awal agar tombol tidak macet)
    tripState = 'idle';
    el.btnStart.hidden = false;
    el.btnPause.hidden = true;
    el.btnStop.hidden = true;
    setGpsStatus('ready', 'Siap');

    // 5. Simpan Trip (Hanya jika titik > 1)
    if (tripPoints.length > 1) {
        saveTrip();
    } else {
        showToast('Perjalanan terlalu pendek, tidak disimpan.');
        // Reset data karena tidak jadi disimpan
        tripPoints = [];
        totalDistanceKm = 0;
        speedSamples = [];
        if (trailPolyline) trailPolyline.setLatLngs([]);
        updateHud();
    }
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
    if (trailPolyline) trailPolyline.addLatLng([lat, lng]);
    if (currentMarker) currentMarker.setLatLng([lat, lng]);
    if (map) map.panTo([lat, lng], { animate: true });
    updateHud(point);
}

function onPosition(pos) { handleLocationUpdate({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, speedMs: pos.coords.speed, time: Date.now() }); }
function onPositionError(err) { setGpsStatus('off', 'Sinyal GPS lemah'); }

function updateHud(point) {
    el.statDistance.textContent = totalDistanceKm.toFixed(2);
    if (point) {
        el.statSpeed.textContent = point.speed.toFixed(1);
        el.statAccuracy.textContent = point.accuracy ? Math.round(point.accuracy) : '–';
        el.statCoords.textContent = point.lat.toFixed(5) + ', ' + point.lng.toFixed(5);
    } else el.statSpeed.textContent = '0.0';
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

function saveTrip() {
    var elapsedMs = Date.now() - startTime - pausedAccumMs;
    var trip = {
        id: 'trip_' + Date.now(),
        user_id: currentSession ? currentSession.user_id : null,
        
        // PERBAIKAN: Gunakan getLocalISOString(startTime) agar jam sesuai waktu HP
        date: getLocalISOString(startTime), 
        
        distanceKm: Number(totalDistanceKm.toFixed(2)),
        durationMs: elapsedMs,
        avgSpeedKmh: speedSamples.length
            ? Number((speedSamples.reduce(function (a, b) { return a + b; }, 0) / speedSamples.length).toFixed(1))
            : 0,
        points: tripPoints.map(function (p) { return [p.lat, p.lng]; })
    };
    
    TripDB.saveTrip(trip, function () {
        renderHistory();
        showToast('Perjalanan disimpan: ' + trip.distanceKm + ' km');
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
            dateEl.textContent = new Date(trip.date).toLocaleString('id-ID') + (trip.synced ? ' · sync' : ' · pending');
            var statsEl = document.createElement('span'); statsEl.className = 'trip-card-stats';
            statsEl.textContent = trip.distanceKm + ' km · ' + formatDuration(trip.durationMs);
            info.appendChild(dateEl); info.appendChild(statsEl);
            var delBtn = document.createElement('button'); delBtn.className = 'trip-card-del'; delBtn.textContent = '✕';
            delBtn.addEventListener('click', function (ev) { ev.stopPropagation(); deleteTrip(trip.id); });
            card.appendChild(info); card.appendChild(delBtn);
            card.addEventListener('click', function () { showTripOnMap(trip); el.historyOverlay.hidden = true; });
            el.historyList.appendChild(card);
        });
    });
}

function showTripOnMap(trip) {
    if (!trip.points || !trip.points.length || !map) return;
    trailPolyline.setLatLngs(trip.points);
    currentMarker.setLatLng(trip.points[trip.points.length - 1]);
    map.fitBounds(trailPolyline.getBounds(), { padding: [40, 40] });
}

// ---------- LOGOUT ----------
function doLogout() {
    if (tripState !== 'idle') stopTrip();
    
    TripDB.clearSession(function () {
        currentSession = null;
        
        // Reset flag agar bisa login lagi
        appEntered = false; 
        controlsBound = false; 
        
        // Reset nama user
        if (el.currentUser) el.currentUser.textContent = 'Guest';
        
        // Tampilkan layar login
        el.authOverlay.hidden = false;
        el.authUsername.value = '';
        el.authPassword.value = '';
        el.authError.hidden = true;
        
        // Reset UI Dashboard
        if (map) map.setView([-6.2, 106.816666], 13);
        if (trailPolyline) trailPolyline.setLatLngs([]);
        el.statSpeed.textContent = '0.0'; el.statDistance.textContent = '0.00';
        el.statDuration.textContent = '00:00:00'; el.statAvgSpeed.textContent = '0.0';
        el.statAccuracy.textContent = '–'; el.statCoords.textContent = '–, –';
        setGpsStatus('ready', 'Mencari sinyal…');
        
        showToast('Berhasil keluar.');
    });
}

var toastTimer = null;
function showToast(msg) {
    el.toast.textContent = msg; el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 3000);
}

// Fungsi untuk mengubah waktu menjadi format ISO tapi menggunakan Waktu Lokal (bukan UTC)
// Fungsi untuk mengubah waktu menjadi format ISO tapi menggunakan Waktu Lokal (bukan UTC)
// Bisa menerima angka timestamp (Date.now()) ATAU objek Date
function getLocalISOString(date) {
    // Jika input adalah angka (timestamp), ubah jadi objek Date dulu
    var d = (typeof date === 'number') ? new Date(date) : date;
    
    var tzoffset = d.getTimezoneOffset() * 60000; // offset dalam milidetik
    return (new Date(d - tzoffset)).toISOString().slice(0, -1);
}

})();
