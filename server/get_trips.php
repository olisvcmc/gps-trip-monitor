<?php
require __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['message' => 'Metode tidak diizinkan']);
    exit;
}

$userId = requireAuth($pdo);

$stmt = $pdo->prepare('SELECT id, device_trip_id, date, distance_km, duration_ms, avg_speed_kmh, points_json, created_at
    FROM trips WHERE user_id = ? ORDER BY date DESC LIMIT 200');
$stmt->execute([$userId]);
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

$trips = array_map(function ($r) {
    return [
        'server_id' => (int) $r['id'],
        'device_trip_id' => $r['device_trip_id'],
        'date' => $r['date'],
        'distance_km' => (float) $r['distance_km'],
        'duration_ms' => (int) $r['duration_ms'],
        'avg_speed_kmh' => (float) $r['avg_speed_kmh'],
        'points' => json_decode($r['points_json'], true),
        'created_at' => $r['created_at']
    ];
}, $rows);

echo json_encode(['trips' => $trips]);
