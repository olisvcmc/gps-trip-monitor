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
if (strlen($username) < 3) {
    http_response_code(400);
    echo json_encode(['message' => 'Username minimal 3 karakter.']);
    exit;
}
if (strlen($password) < 6) {
    http_response_code(400);
    echo json_encode(['message' => 'Password minimal 6 karakter.']);
    exit;
}

$stmt = $pdo->prepare('SELECT id FROM users WHERE username = ?');
$stmt->execute([$username]);
if ($stmt->fetch()) {
    http_response_code(409);
    echo json_encode(['message' => 'Username sudah dipakai, coba yang lain.']);
    exit;
}

$hash = password_hash($password, PASSWORD_DEFAULT);
$stmt = $pdo->prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)');
$stmt->execute([$username, $hash, date('c')]);
$userId = (int) $pdo->lastInsertId();

$token = generateToken();
$stmt = $pdo->prepare('INSERT INTO tokens (token, user_id, created_at) VALUES (?, ?, ?)');
$stmt->execute([$token, $userId, date('c')]);

echo json_encode([
    'user_id' => $userId,
    'username' => $username,
    'token' => $token
]);
