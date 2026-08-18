<?php
require __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['message' => 'Metode tidak diizinkan']);
    exit;
}

$userId = requireAuth($pdo);
$body = readJsonBody();

$deviceTripId = isset($body['device_trip_id']) ? (string) $body['device_trip_id'] : null;
$date = isset($body['date']) ? (string) $body['date'] : date('c');
$distanceKm = isset($body['distance_km']) ? (float) $body['distance_km'] : 0;
$durationMs = isset($body['duration_ms']) ? (int) $body['duration_ms'] : 0;
$avgSpeedKmh = isset($body['avg_speed_kmh']) ? (float) $body['avg_speed_kmh'] : 0;
$points = isset($body['points']) && is_array($body['points']) ? $body['points'] : [];

try {
    // UNIQUE(user_id, device_trip_id) mencegah trip yang sama terupload dobel
    // kalau device retry upload (misal koneksi putus di tengah request).
    $stmt = $pdo->prepare('INSERT OR IGNORE INTO trips
        (user_id, device_trip_id, date, distance_km, duration_ms, avg_speed_kmh, points_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    $stmt->execute([
        $userId, $deviceTripId, $date, $distanceKm, $durationMs, $avgSpeedKmh,
        json_encode($points), date('c')
    ]);

    echo json_encode(['status' => 'ok', 'server_id' => (int) $pdo->lastInsertId()]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['message' => 'Gagal menyimpan trip: ' . $e->getMessage()]);
}
