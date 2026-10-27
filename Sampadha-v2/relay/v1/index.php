<?php
// Sampadha v2 — fixed-IP relay for the NSE PDC Strategy API (CARE PaRRVA), version 1.
//
// NSE PDC only answers whitelisted IP addresses and Supabase Edge Functions have no fixed outgoing
// address, so the parrva Edge Function sends its already-encrypted Strategy request here and this
// server (fixed outgoing IP) forwards it unchanged. It can reach only the one PDC URL below: it is
// not a general proxy, and it stores nothing.
//
//   GET  /relay/v1/health          → 200 {"status":"ok","version":1}                    (no key)
//   GET  /relay/v1/egress-ip       → 200 {"ip":"…"}, the address NSE has to whitelist     (key)
//   POST /relay/v1/pdc/strategies  → PDC's own status, Content-Type and body              (key)
//        body: the JSON body for PDC; optional header X-PDC-Authorization: Bearer <PaRRVA token>
//
// Every route except health needs header X-Relay-Key: the parrva Edge Function's secret
// PDC_RELAY_KEY (only its SHA-256 is kept here). Errors raised by the relay itself carry header
// X-Relay-Error and the body {"error":{"code","message","timestamp"}}; answers from PDC carry
// X-Relay-Upstream: pdc, so the two are never confused.

declare(strict_types=1);

const PDC_STRATEGY_URL = 'https://pdc.nseindia.com/advice/rainput/strategy';
const RELAY_KEY_SHA256 = '91bd0e17f2b452f588823e2f026f4ad73bf35c9d4ca7a0f85b707e69bf48275b';
const USER_AGENT = 'Sampadha-RA-Portal/1.0 (+https://racrm.fintecindia.com)';
const UPSTREAM_TIMEOUT = 20; // seconds, as in the Edge Function
const MAX_BODY_BYTES = 1048576;
const CALLS_PER_MINUTE = 30;

function fail(int $status, string $code, string $message, array $headers = []): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Relay-Error: ' . $code);
    foreach ($headers as $name => $value) {
        header($name . ': ' . $value);
    }
    echo json_encode(['error' => ['code' => $code, 'message' => $message, 'timestamp' => gmdate('c')]]);
    exit;
}

function ok(array $body): void
{
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body);
    exit;
}

function authorised(): bool
{
    $key = $_SERVER['HTTP_X_RELAY_KEY'] ?? '';
    return is_string($key) && $key !== '' && hash_equals(RELAY_KEY_SHA256, hash('sha256', $key));
}

// At most CALLS_PER_MINUTE authorised calls per minute, counted in a small file in the temp folder.
// Only key holders are counted, so strangers cannot use up the allowance.
function within_rate_limit(): bool
{
    $handle = @fopen(sys_get_temp_dir() . '/sampadha-pdc-relay-calls.json', 'c+');
    if (!$handle) {
        return true; // never block a submission because the counter is unavailable
    }
    flock($handle, LOCK_EX);
    $now = time();
    $calls = array_values(array_filter(
        json_decode(stream_get_contents($handle) ?: '[]', true) ?: [],
        function ($at) use ($now) {
            return is_int($at) && $at > $now - 60;
        }
    ));
    $allowed = count($calls) < CALLS_PER_MINUTE;
    if ($allowed) {
        $calls[] = $now;
    }
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode($calls));
    flock($handle, LOCK_UN);
    fclose($handle);
    return $allowed;
}

// HTTPS only, no redirects. Returns [status (0 = no answer), content type, body, error, curl errno].
function call(string $url, ?string $body, array $headers, int $timeout): array
{
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_CONNECTTIMEOUT => min(10, $timeout),
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_USERAGENT => USER_AGENT,
        CURLOPT_HTTPHEADER => $headers,
    ]);
    if ($body !== null) {
        curl_setopt($curl, CURLOPT_POST, true);
        curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
    }
    $answer = curl_exec($curl);
    $result = [
        (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE),
        (string) curl_getinfo($curl, CURLINFO_CONTENT_TYPE),
        $answer === false ? '' : (string) $answer,
        curl_error($curl),
        curl_errno($curl),
    ];
    curl_close($curl);
    return $result;
}

header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

$routes = ['/health' => 'GET', '/egress-ip' => 'GET', '/pdc/strategies' => 'POST'];
$path = '/' . trim((string) parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH), '/');
$route = (string) preg_replace('#^/relay/v1(?=/|$)#', '', $path);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!isset($routes[$route])) {
    fail(404, 'not_found', 'Unknown relay route.');
}
if ($method !== $routes[$route]) {
    fail(405, 'method_not_allowed', 'Use ' . $routes[$route] . '.', ['Allow' => $routes[$route]]);
}
if ($route === '/health') {
    ok(['status' => 'ok', 'version' => 1]);
}
if (!authorised()) {
    fail(401, 'unauthorized', 'Missing or wrong X-Relay-Key.');
}
if (!within_rate_limit()) {
    fail(429, 'rate_limited', 'Too many relay calls; try again in a minute.', ['Retry-After' => '60']);
}
if (!function_exists('curl_init')) {
    fail(500, 'curl_missing', 'PHP cURL is not available on this server.');
}

if ($route === '/egress-ip') {
    [$status, , $answer, $error] = call('https://api.ipify.org?format=json', null, [], 10);
    $ip = $status === 200 ? (json_decode($answer, true)['ip'] ?? null) : null;
    if (!is_string($ip)) {
        fail(502, 'egress_ip_unavailable', 'Could not look up the outgoing IP' . ($error ? ': ' . $error : '.'));
    }
    ok(['ip' => $ip]);
}

// POST /pdc/strategies
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
    fail(415, 'unsupported_media_type', 'Send the PDC body as application/json.');
}
$body = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
if ($body === false || strlen($body) > MAX_BODY_BYTES) {
    fail(413, 'payload_too_large', 'The body must be 1 MB or smaller.');
}
json_decode($body);
if (json_last_error() !== JSON_ERROR_NONE) {
    fail(400, 'invalid_json', 'The body is not valid JSON.');
}
$headers = ['Accept: */*', 'Content-Type: application/json'];
$token = $_SERVER['HTTP_X_PDC_AUTHORIZATION'] ?? '';
if ($token !== '') {
    if (!preg_match('#^Bearer [A-Za-z0-9._~+/=-]{1,8192}$#', $token)) {
        fail(400, 'invalid_pdc_authorization', 'X-PDC-Authorization must be "Bearer <token>".');
    }
    $headers[] = 'Authorization: ' . $token;
}

$started = microtime(true);
[$status, $type, $answer, $error, $errno] = call(PDC_STRATEGY_URL, $body, $headers, UPSTREAM_TIMEOUT);
error_log(sprintf(
    'sampadha pdc-relay: status=%s ms=%d error=%s',
    $status ?: '-',
    (int) ((microtime(true) - $started) * 1000),
    $error ?: '-'
));
if ($status === 0) {
    if ($errno === CURLE_OPERATION_TIMEDOUT) {
        fail(504, 'upstream_timeout', 'NSE PDC did not answer within ' . UPSTREAM_TIMEOUT . ' seconds.');
    }
    fail(502, 'upstream_unreachable', 'Could not reach NSE PDC: ' . $error);
}
http_response_code($status);
header('Content-Type: ' . ($type ?: 'application/octet-stream'));
header('X-Relay-Upstream: pdc');
echo $answer;
