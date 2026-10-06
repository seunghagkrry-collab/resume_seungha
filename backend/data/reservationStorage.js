'use strict';

// 방문 예약 기록을 어디에 두는지 결정하는 곳.
// projects.json을 다루는 storage.js와 같은 방식이지만, 예약은 방문자의
// 이름·이메일이 들어 있는 개인정보라서 파일을 따로 두고 커밋하지 않는다.
//
// - 내 컴퓨터: backend/data/reservations.json (.gitignore 대상)
// - Vercel Blob: BLOB_READ_WRITE_TOKEN이 있을 때
//
// 두 경우 모두 { reservations: [...] } 모양을 그대로 주고받는다.

const fs = require('node:fs');
const path = require('node:path');
const { blobToken } = require('../runtime');

const DATA_FILE = path.resolve(__dirname, 'reservations.json');
const TEMP_FILE = `${DATA_FILE}.tmp`;
const BLOB_PATH = 'portfolio/reservations.json';

function usesBlob() {
  return blobToken().length > 0;
}

let lastBlobError = '';

/* ---------- 파일 저장소 ---------- */

function readLocal() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(parsed.reservations) ? parsed.reservations : [];
  } catch (error) {
    // 예약이 한 건도 없으면 파일이 아직 없다. 빈 목록이 정상이다.
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// 쓰기 도중 종료되어도 기존 파일이 깨지지 않도록 임시 파일에 먼저 쓴다.
function writeLocal(reservations) {
  fs.writeFileSync(TEMP_FILE, JSON.stringify({ reservations }, null, 2), 'utf8');
  fs.renameSync(TEMP_FILE, DATA_FILE);
}

/* ---------- Vercel Blob 저장소 ---------- */

// 같은 인스턴스가 방금 쓴 내용을 바로 읽도록 들고 있는다.
let cache = null;

function loadBlobSdk() {
  return require('@vercel/blob');
}

async function readBlob() {
  const { list } = loadBlobSdk();
  const found = await list({ prefix: BLOB_PATH, limit: 1, token: blobToken() });
  const entry = found.blobs.find((blob) => blob.pathname === BLOB_PATH);

  // 아직 한 건도 저장된 적이 없는 상태.
  if (!entry) return [];

  const response = await fetch(`${entry.url}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Blob 읽기 실패: HTTP ${response.status}`);

  const parsed = await response.json();
  return Array.isArray(parsed.reservations) ? parsed.reservations : [];
}

async function writeBlob(reservations) {
  const { put } = loadBlobSdk();
  await put(BLOB_PATH, JSON.stringify({ reservations }, null, 2), {
    // 예약은 개인정보다. 프로젝트 목록과 달리 공개 URL로 열리면 안 되므로
    // 토큰이 있어야 읽히는 비공개 접근으로 올린다.
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    token: blobToken(),
  });
}

/* ---------- 공통 진입점 ---------- */

async function readReservations() {
  if (!usesBlob()) return readLocal();
  if (cache) return cache;

  try {
    cache = await readBlob();
    lastBlobError = '';
    return cache;
  } catch (error) {
    lastBlobError = error.message || String(error);
    console.error('[예약 저장소] Blob을 읽지 못했어요:', lastBlobError);
    throw error;
  }
}

async function writeReservations(reservations) {
  if (!usesBlob()) {
    writeLocal(reservations);
    return;
  }

  // 쓰기 실패를 조용히 넘기면 예약이 사라진다. 그대로 올려 알린다.
  try {
    await writeBlob(reservations);
    lastBlobError = '';
    cache = reservations;
  } catch (error) {
    lastBlobError = error.message || String(error);
    console.error('[예약 저장소] Blob에 쓰지 못했어요:', lastBlobError);
    throw new Error('예약을 저장소에 기록하지 못했어요.');
  }
}

function describe() {
  return {
    mode: usesBlob() ? 'blob' : 'file',
    healthy: !lastBlobError,
    ...(lastBlobError ? { problem: lastBlobError } : {}),
  };
}

module.exports = { readReservations, writeReservations, usesBlob, describe };
