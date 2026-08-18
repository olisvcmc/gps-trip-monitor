<?php
/**
 * config.php — koneksi SQLite + header CORS bersama.
 * File ini di-include di semua endpoint (register.php, login.php, dst).
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$dbPath = __DIR__ . '/data/gpstracker.sqlite';

if (!is_dir(__DIR__ . '/data')) {
    mkdir(__DIR__ . '/data', 0775, true);
}

try {
    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['message' => 'Tidak bisa membuka database: ' . $e->getMessage()]);
    exit;
}

// Buat skema jika belum ada (aman dipanggil berulang)
$pdo->exec('CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
)');

$pdo->exec('CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
)');

$pdo->exec('CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_trip_id TEXT,
    date TEXT,
    distance_km REAL,
    duration_ms INTEGER,
    avg_speed_kmh REAL,
    points_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, device_trip_id)
)');

/**
 * Ambil user_id dari header Authorization: Bearer <token>.
 * Return null kalau token tidak valid/tidak ada -> endpoint pemanggil harus tolak akses.
 */
function requireAuth(PDO $pdo)
{
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $authHeader = '';
    foreach ($headers as $k => $v) {
        if (strtolower($k) === 'authorization') $authHeader = $v;
    }
    if (!$authHeader && isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'];
    }
    if (!preg_match('/Bearer\s+(.+)/i', $authHeader, $m)) {
        http_response_code(401);
        echo json_encode(['message' => 'Token tidak ditemukan. Silakan login ulang.']);
        exit;
    }
    $token = trim($m[1]);
    $stmt = $pdo->prepare('SELECT user_id FROM tokens WHERE token = ?');
    $stmt->execute([$token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        http_response_code(401);
        echo json_encode(['message' => 'Sesi tidak valid atau sudah kedaluwarsa. Silakan login ulang.']);
        exit;
    }
    return (int) $row['user_id'];
}

function readJsonBody()
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function generateToken()
{
    return bin2hex(random_bytes(32));
}
