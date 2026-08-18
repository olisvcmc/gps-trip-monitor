/**
 * api.js — Komunikasi ke server backend (PHP + SQLite).
 *
 * PENTING: ganti API_BASE_URL di bawah ini sesuai alamat server Anda.
 * - Untuk emulator Android: 'http://10.0.2.2/nama_folder_server'
 * - Untuk HP asli via WiFi lokal: 'http://192.168.x.x/nama_folder_server' (WAJIB http://, bukan https://)
 * - Untuk hosting online: 'https://domainanda.com/nama_folder_server'
 */
(function (global) {
    'use strict';

    // GANTI INI dengan IP/Domain server Anda yang sebenarnya!
    // Contoh di bawah menggunakan IP yang Anda sebutkan sebelumnya. 
    // Pastikan folder 'cordova/gps-tracker/server' sesuai dengan struktur folder di server Anda.
    var API_BASE_URL = 'https://10.83.49.107/cordova/gps-tracker/server'; 

    function setBaseUrl(url) { 
        API_BASE_URL = url.replace(/\/$/, ''); 
    }
    
    function getBaseUrl() { 
        return API_BASE_URL; 
    }

    function request(path, method, body, token) {
        var headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = 'Bearer ' + token;
        }

        return fetch(API_BASE_URL + path, {
            method: method,
            headers: headers,
            body: body ? JSON.stringify(body) : undefined
        }).then(function (res) {
            return res.json().then(function (data) {
                if (!res.ok) {
                    var err = new Error(data.message || 'Terjadi kesalahan server');
                    err.status = res.status;
                    throw err;
                }
                return data;
            });
        });
    }

    function register(username, password) {
        return request('/register.php', 'POST', { username: username, password: password });
    }

    function login(username, password) {
        return request('/login.php', 'POST', { username: username, password: password });
    }

    function uploadTrip(trip, token) {
        return request('/upload_trip.php', 'POST', {
            device_trip_id: trip.id,
            date: trip.date,
            distance_km: trip.distanceKm,
            duration_ms: trip.durationMs,
            avg_speed_kmh: trip.avgSpeedKmh,
            points: trip.points
        }, token);
    }

    function fetchTrips(token) {
        return request('/get_trips.php', 'GET', null, token);
    }

    // TAMBAHAN BARU: Fungsi untuk live monitoring (mengirim ping lokasi setiap 10 detik)
    function updateLocation(lat, lng, token) {
        return request('/update_location.php', 'POST', { lat: lat, lng: lng }, token);
    }

    global.TripAPI = {
        setBaseUrl: setBaseUrl,
        getBaseUrl: getBaseUrl,
        register: register,
        login: login,
        uploadTrip: uploadTrip,
        fetchTrips: fetchTrips,
        updateLocation: updateLocation // <-- PENTING: Pastikan ini ada agar app.js tidak error
    };

})(window);
