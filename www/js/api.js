/**
 * api.js — Komunikasi ke server backend (PHP + SQLite, lihat folder /server).
 *
 * PENTING: ganti API_BASE_URL di bawah ini sesuai alamat server Anda
 * (contoh: "http://192.168.1.10/gps-tracker-server" untuk XAMPP lokal,
 * atau "https://domainanda.com/gps-tracker-server" untuk hosting).
 */
(function (global) {
    'use strict';

    var API_BASE_URL = 'http://10.83.49.107/cordova/gps-tracker/server'; // 10.0.2.2 = alamat localhost dari emulator Android

    function setBaseUrl(url) { API_BASE_URL = url.replace(/\/$/, ''); }
    function getBaseUrl() { return API_BASE_URL; }

    function request(path, method, body, token) {
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;

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

    global.TripAPI = {
        setBaseUrl: setBaseUrl,
        getBaseUrl: getBaseUrl,
        register: register,
        login: login,
        uploadTrip: uploadTrip,
        fetchTrips: fetchTrips
    };

})(window);
