# GPS Trip Monitor — Cordova + Leaflet

Aplikasi mobile untuk memantau perjalanan secara **real-time** menggunakan GPS, dengan peta interaktif berbasis **Leaflet** dan tema dark studio dengan aksen aurora gradient.

## Fitur

- **Wajib login** sebelum bisa memakai aplikasi — mendukung banyak user sekaligus, tiap user datanya terpisah di server
- **Offline-first**: setiap perjalanan disimpan ke **SQLite lokal di HP** (`cordova-sqlite-storage`) — tetap tercatat walau HP mati total sinyal/data internet
- **Auto-sync otomatis**: begitu HP kembali online, semua trip yang tertunda otomatis diupload ke server tanpa perlu tindakan manual (pill status di pojok kanan atas menunjukkan status: Offline / Menyinkronkan / Tersinkron)
- **Tetap melacak saat aplikasi diminimize/background**, lewat plugin `cordova-background-geolocation-lt` (gratis, open-source) yang menjalankan foreground service Android dengan notifikasi persisten
- Pelacakan posisi real-time (`navigator.geolocation.watchPosition`, dipatch oleh `cordova-plugin-geolocation`) — dipakai sebagai fallback jika plugin background belum terpasang (mis. saat uji coba di browser)
- Jejak rute (trail) digambar langsung di peta sebagai polyline
- Panel HUD: kecepatan saat ini, jarak tempuh, durasi, kecepatan rata-rata, akurasi GPS, koordinat
- Kontrol Mulai / Jeda / Selesai
- Penyaringan noise GPS sederhana (lompatan kecil di bawah radius akurasi diabaikan)
- Riwayat perjalanan tersimpan di `localStorage`, bisa dibuka kembali di peta atau dihapus
- Marker posisi dengan animasi radar-pulse
- Peta otomatis mengikuti (pan) posisi pengguna

## Struktur proyek

```
gps-tracker/
├── config.xml          # Konfigurasi Cordova (izin lokasi, plugin, dst.)
├── package.json
└── www/
    ├── index.html
    ├── css/style.css
    └── js/app.js        # Semua logika tracking & UI
```

## Cara menjalankan

### 1. Persiapan

```bash
npm install -g cordova
cd gps-tracker
```

### 2. Tambahkan platform

```bash
cordova platform add android
# atau untuk iOS (butuh macOS + Xcode)
cordova platform add ios
```

### 3. Pasang plugin (otomatis terbaca dari config.xml, tapi bisa manual)

```bash
cordova plugin add cordova-plugin-geolocation
cordova plugin add cordova-plugin-whitelist
cordova plugin add cordova-plugin-device
cordova plugin add cordova-plugin-statusbar
```

### 4. Jalankan di emulator / perangkat

```bash
cordova run android
# atau build saja
cordova build android
```

### 5. Uji cepat di browser (opsional, sebelum build native)

Karena `www/index.html` memuat `cordova.js` yang hanya ada setelah `cordova prepare`, untuk uji coba cepat di browser:

```bash
cordova prepare android   # ini akan menghasilkan www/cordova.js
cordova serve
```

Lalu buka `http://localhost:8000/android/www/` di browser desktop (izinkan akses lokasi saat diminta). Akurasi GPS di desktop browser biasanya rendah/simulasi.

## Setup server backend (PHP + SQLite)

Folder `server/` berisi API sederhana untuk login/daftar dan sinkronisasi trip. Cocok untuk XAMPP lokal maupun hosting biasa (asal ada PHP dengan ekstensi `pdo_sqlite`, yang hampir selalu aktif secara default).

### 1. Deploy ke XAMPP (lokal, untuk testing)

1. Salin folder `server/` ke `C:\xampp\htdocs\gps-tracker-server`
2. Jalankan Apache dari XAMPP Control Panel
3. Cek di browser laptop: `http://localhost/gps-tracker-server/register.php` → harus muncul JSON error "Metode tidak diizinkan" (tandanya PHP jalan, bukan 404)
4. Cari **alamat IP lokal laptop** (`ipconfig` di Windows, cari IPv4, contoh `192.168.1.10`)
5. Di `www/js/api.js`, ubah baris:
   ```js
   var API_BASE_URL = 'http://192.168.1.10/gps-tracker-server';
   ```
   Ganti dengan IP laptop Anda. **HP dan laptop harus terhubung ke WiFi yang sama** supaya bisa saling akses.

### 2. Deploy ke hosting (untuk dipakai beneran di luar rumah)

1. Upload folder `server/` ke hosting Anda (cPanel File Manager, FTP, dll) — pastikan support PHP 7.4+
2. Set `API_BASE_URL` di `www/js/api.js` ke `https://domainanda.com/gps-tracker-server`
3. Pastikan folder `server/data/` writable (biasanya otomatis; kalau tidak, `chmod 775 server/data`)

### 3. Rebuild APK setelah mengubah `API_BASE_URL`

Setiap kali `api.js` diubah, push ulang ke GitHub supaya GitHub Actions build ulang APK dengan alamat server yang baru (lihat bagian "Cara paling cepat dapat file .apk" di bawah).

## Pemakaian bersamaan oleh banyak user

- Setiap user **wajib mendaftar akun sendiri** (username unik) lewat layar Daftar di aplikasi, lalu login.
- Server memisahkan data lewat kolom `user_id` — user A tidak akan pernah melihat trip milik user B.
- Beberapa HP dengan akun berbeda **bisa dipakai bersamaan tanpa konflik**, karena tiap request pakai token unik per sesi login dan tiap trip diberi `device_trip_id` unik (mencegah data dobel kalau upload gagal lalu di-retry otomatis).
- Login tersimpan di SQLite lokal, jadi setelah login sekali, user **tidak perlu login ulang tiap buka app** — bahkan saat offline (aplikasi hanya perlu online sekali saat pertama kali daftar/login).

## Cara paling cepat dapat file .apk: GitHub Actions (tanpa install Android SDK)

Repo ini sudah dilengkapi `.github/workflows/build-apk.yml` yang otomatis meng-compile APK di server GitHub. Anda tidak perlu install Android Studio/SDK di HP atau laptop.

1. Buat repository baru di GitHub (bisa privat), lalu upload/push seluruh isi folder `gps-tracker/` ke repo tersebut.
   ```bash
   cd gps-tracker
   git init
   git add .
   git commit -m "GPS Trip Monitor"
   git branch -M main
   git remote add origin https://github.com/USERNAME/gps-trip-monitor.git
   git push -u origin main
   ```
2. Buka repo di GitHub → tab **Actions**. Workflow "Build Android APK" akan berjalan otomatis setelah push (atau klik **Run workflow** manual).
3. Tunggu sampai selesai (±3-5 menit) → status berubah jadi centang hijau.
4. Buka hasil run tersebut → scroll ke bagian **Artifacts** → unduh **gps-trip-monitor-apk** (berupa file `.zip` berisi `app-debug.apk`).
5. Ekstrak zip-nya, salin `app-debug.apk` ke HP Android Anda (lewat kabel USB, Google Drive, WhatsApp ke diri sendiri, dll).
6. Di HP: buka file APK tersebut → jika muncul peringatan "sumber tidak dikenal", izinkan instalasi dari sumber tersebut (Settings → izinkan install dari aplikasi yang Anda pakai untuk membuka file, misalnya Files/Chrome) → **Install**.

APK ini adalah **debug build** (belum ditandatangani untuk rilis Play Store), tapi sudah bisa langsung diinstal dan dipakai di HP Anda sendiri.

### Alternatif tanpa GitHub
Jika tidak ingin pakai GitHub, opsi lain:
- **Build lokal**: install Android Studio + Android SDK + JDK 17 di laptop, lalu jalankan `cordova platform add android && cordova build android --debug` seperti di bagian atas README ini.
- **Layanan build cloud berbayar/gratis-terbatas**: Voltbuilder (voltbuilder.com) — upload folder proyek, dapat APK tanpa setup apapun.

## Cara kerja tracking di latar belakang (background)

Aplikasi memakai `cordova-background-geolocation-lt` (fork gratis dari plugin mauron85, MIT license — bukan versi berbayar Transistorsoft). Saat tombol **Mulai Perjalanan** ditekan:

1. Plugin menjalankan **foreground service** Android dengan notifikasi persisten ("Melacak perjalanan Anda di latar belakang…") — ini **wajib** ada di Android 8+ agar sistem tidak mematikan service saat app diminimize.
2. Update lokasi tetap mengalir ke `handleLocationUpdate()` di `app.js` walau layar HP mati atau app pindah ke background, sehingga jarak, jejak rute, dan durasi tetap tercatat.
3. Saat app dibuka kembali, peta & HUD otomatis menampilkan data terbaru karena semuanya disimpan di state JS yang sama (bukan di-reset).
4. `stopOnTerminate: false` berarti tracking tetap jalan meski app disingkirkan dari daftar recent apps. Tekan **Selesai** untuk menghentikannya secara eksplisit.

### Izin yang perlu diaktifkan manual di HP

- **Android 10+**: saat pertama kali start, sistem akan menampilkan dialog izin lokasi. Pilih **"Izinkan sepanjang waktu" / "Allow all the time"** — bukan "Hanya saat digunakan". Jika Anda tidak sengaja memilih opsi lain, aplikasi akan menampilkan toast dan membuka halaman Pengaturan aplikasi otomatis (`bgGeo.showAppSettings()`).
- **Optimisasi baterai**: beberapa pabrikan (Xiaomi/MIUI, Oppo/ColorOS, Vivo, Samsung) agresif membunuh background service. Buka **Pengaturan → Baterai → GPS Trip Monitor → Jangan optimalkan / Unrestricted**, dan pastikan aplikasi tidak masuk daftar "auto-start terkunci".
- **Notifikasi**: jangan matikan notifikasi aplikasi ini — notifikasi tersebut BUKAN spam, melainkan syarat teknis Android agar background service diizinkan tetap hidup.

## Catatan penting

- **Izin lokasi**: Android akan meminta izin lokasi saat pertama kali `Mulai Perjalanan` ditekan. Pastikan `ACCESS_FINE_LOCATION` **dan** `ACCESS_BACKGROUND_LOCATION` diizinkan.
- **Tile peta**: Aplikasi memakai tile OpenStreetMap via internet (`https://{s}.tile.openstreetmap.org`). Untuk pemakaian produksi dengan volume tinggi, pertimbangkan menyediakan tile server sendiri atau layanan berbayar (Mapbox, MapTiler) sesuai kebijakan penggunaan OSM.
- **Filter noise GPS**: saat ini sederhana (mengabaikan pergeseran < radius akurasi). Bisa ditingkatkan dengan filter Kalman jika presisi jadi masalah di lapangan.
- **Konsumsi baterai**: tracking latar belakang otomatis lebih boros baterai dibanding tracking foreground biasa — ini trade-off yang tidak terhindarkan untuk fitur ini.
- **CSP**: `index.html` sudah menyertakan `Content-Security-Policy` yang mengizinkan Leaflet dari `unpkg.com` dan tile dari `openstreetmap.org`. Jika ingin membundel Leaflet secara lokal (offline-ready), unduh `leaflet.js`/`leaflet.css` ke `www/lib/leaflet/` dan ubah referensi di `index.html`.

## Kustomisasi cepat

| Ingin ubah... | Di mana |
|---|---|
| Warna aksen (aurora teal/violet) | `www/css/style.css` → variabel `--aurora-1`, `--aurora-2` |
| Ambang noise GPS | `www/js/app.js` → fungsi `onPosition`, baris `Math.max(4, ...)` |
| Titik peta awal (sebelum GPS didapat) | `www/js/app.js` → `initMap()`, `setView([...])` |
| Ikon aplikasi | `res/android/icon-*.png` (belum disertakan, tambahkan sendiri) |
