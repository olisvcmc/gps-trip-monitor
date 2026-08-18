<?php
require __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['message' => 'Metode tidak diizinkan']);
    exit;
}

$body = readJsonBody();
$username = isset($body['username']) ? trim($body['username']) : '';
$password = isset($body['password']) ? (string) $body['password'] : '';

if ($username === '' || $password === '') {
    http_response_code(400);
    echo json_encode(['message' => 'Username dan password wajib diisi.']);
    exit;
}

$stmt = $pdo->prepare('SELECT id, password_hash FROM users WHERE username = ?');
$stmt->execute([$username]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$user || !password_verify($password, $user['password_hash'])) {
    http_response_code(401);
    echo json_encode(['message' => 'Username atau password salah.']);
    exit;
}

$token = generateToken();
$stmt = $pdo->prepare('INSERT INTO tokens (token, user_id, created_at) VALUES (?, ?, ?)');
$stmt->execute([$token, $user['id'], date('c')]);

echo json_encode([
    'user_id' => (int) $user['id'],
    'username' => $username,
    'token' => $token
]);
