'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CREDENTIAL_FILE = path.resolve(__dirname, '..', 'data', 'admin.local.json');
// 마지막 사용 시점부터 30분이 지나면 서버 쪽 세션을 버린다.
const SESSION_IDLE_MS = 30 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const KEY_LENGTH = 64;

// 짧은 비밀번호도 쉽게 대입하지 못하도록 scrypt 비용을 기본값보다 높게 잡는다.
// 해시 한 번에 약 0.5초가 걸려서, 파일이 유출돼도 전수 대입이 느려진다.
const SCRYPT_PARAMS = { N: 131072, r: 8, p: 1 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

const sessions = new Map();
const loginAttempts = new Map();

function hashPassword(password, salt, params) {
  const { N, r, p } = params || SCRYPT_PARAMS;
  return crypto
    .scryptSync(password, salt, KEY_LENGTH, { N, r, p, maxmem: SCRYPT_MAXMEM })
    .toString('hex');
}

function buildCredential(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    algorithm: 'scrypt',
    ...SCRYPT_PARAMS,
    keyLength: KEY_LENGTH,
    salt,
    hash: hashPassword(password, salt, SCRYPT_PARAMS),
  };
}

function readCredentialFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CREDENTIAL_FILE, 'utf8'));
    if (parsed && parsed.salt && parsed.hash) return parsed;
    return null;
  } catch (error) {
    return null;
  }
}

function writeCredentialFile(credential) {
  fs.writeFileSync(CREDENTIAL_FILE, JSON.stringify(credential, null, 2), 'utf8');
}

// 평문 비밀번호는 저장하지 않는다. 해시만 보관하고 비교는 서버에서만 한다.
let credential = null;

function init() {
  if (process.env.ADMIN_PASSWORD) {
    credential = buildCredential(process.env.ADMIN_PASSWORD);
    // 해시를 만든 뒤에는 환경변수에 평문을 남겨 두지 않는다.
    delete process.env.ADMIN_PASSWORD;
    return { source: 'env' };
  }

  const stored = readCredentialFile();
  if (stored) {
    credential = stored;
    return { source: 'file' };
  }

  // 처음 만든 비밀번호는 콘솔에 한 번 보여주기 위해서만 반환하고 모듈에 보관하지 않는다.
  const firstPassword = crypto.randomBytes(6).toString('base64url');
  credential = buildCredential(firstPassword);
  writeCredentialFile(credential);
  return { source: 'generated', password: firstPassword };
}

function setPassword(password) {
  writeCredentialFile(buildCredential(password));
}

function isLockedOut(clientKey) {
  const attempt = loginAttempts.get(clientKey);
  if (!attempt || !attempt.lockedUntil) return 0;
  const remaining = attempt.lockedUntil - Date.now();
  if (remaining <= 0) {
    loginAttempts.delete(clientKey);
    return 0;
  }
  return remaining;
}

function recordFailure(clientKey) {
  const attempt = loginAttempts.get(clientKey) || { count: 0, lockedUntil: 0 };
  attempt.count += 1;
  if (attempt.count >= MAX_FAILED_ATTEMPTS) {
    attempt.lockedUntil = Date.now() + LOCKOUT_MS;
    attempt.count = 0;
  }
  loginAttempts.set(clientKey, attempt);
}

function verifyPassword(password) {
  if (!credential || typeof password !== 'string' || !password) return false;
  // 저장할 때 쓴 파라미터로 다시 계산해야 예전 자격 증명도 열린다.
  const params = {
    N: credential.N || 16384,
    r: credential.r || 8,
    p: credential.p || 1,
  };
  const candidate = Buffer.from(hashPassword(password, credential.salt, params), 'hex');
  const expected = Buffer.from(credential.hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function pruneSessions() {
  const now = Date.now();
  sessions.forEach((session, token) => {
    if (session.expiresAt <= now) sessions.delete(token);
  });
}

function createSession() {
  pruneSessions();
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expiresAt: Date.now() + SESSION_IDLE_MS });
  return { token };
}

function isValidSession(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  // 쓰는 동안에는 끊기지 않도록 만료 시각을 뒤로 민다.
  session.expiresAt = Date.now() + SESSION_IDLE_MS;
  return true;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

function login(password, clientKey) {
  const lockedMs = isLockedOut(clientKey);
  if (lockedMs > 0) {
    return { locked: true, retryAfterSeconds: Math.ceil(lockedMs / 1000) };
  }
  if (!verifyPassword(password)) {
    recordFailure(clientKey);
    return { ok: false };
  }
  loginAttempts.delete(clientKey);
  return { ok: true, session: createSession() };
}

module.exports = {
  init,
  setPassword,
  login,
  isValidSession,
  destroySession,
  CREDENTIAL_FILE,
};
