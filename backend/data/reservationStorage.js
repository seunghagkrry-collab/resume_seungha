'use strict';

// 방문 예약 기록을 어디에 두는지 결정하는 곳.
// - Supabase: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY가 있을 때 (추천)
// - 내 컴퓨터: backend/data/reservations.json (.gitignore 대상)
// - Vercel Blob: BLOB_READ_WRITE_TOKEN이 있을 때
//
// 예약은 방문자의 이름·이메일이 들어 있는 개인정보라서 공개 저장소(projects)와는
// 항상 분리해서 다룬다. 어떤 저장소든 { reservations: [...] } 모양(캐멀케이스 필드)을
// 그대로 주고받는다.

const fs = require('node:fs');
const path = require('node:path');
const { blobToken } = require('../runtime');
const supabase = require('./supabaseClient');

const DATA_FILE = path.resolve(__dirname, 'reservations.json');
const TEMP_FILE = `${DATA_FILE}.tmp`;
const BLOB_PATH = 'portfolio/reservations.json';
const TABLE = 'reservations';

function usesBlob() {
  return blobToken().length > 0;
}

function mode() {
  if (supabase.isConfigured()) return 'supabase';
  if (usesBlob()) return 'blob';
  return 'file';
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

/* ---------- Supabase 저장소 ---------- */

// DB 열(snake_case) <-> 코드에서 쓰는 필드(camelCase) 변환.
function toDbRow(record) {
  return {
    id: record.id,
    status: record.status,
    name: record.name,
    email: record.email,
    purpose: record.purpose,
    visit_date: record.visitDate,
    visit_time: record.visitTime,
    consent: record.consent,
    code: record.code,
    created_at: record.createdAt,
    updated_at: record.updatedAt || null,
  };
}

function fromDbRow(row) {
  return {
    id: row.id,
    status: row.status,
    name: row.name,
    email: row.email,
    purpose: row.purpose,
    visitDate: row.visit_date,
    visitTime: row.visit_time,
    consent: row.consent,
    code: row.code,
    createdAt: row.created_at,
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  };
}

async function readSupabase() {
  const { data, error } = await supabase.client
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(fromDbRow);
}

// reservations.json과 같은 "전체를 통째로 바꿔 끼운다" 방식을 테이블에서도 맞춘다.
async function writeSupabase(reservations) {
  const { data: existing, error: selectError } = await supabase.client.from(TABLE).select('id');
  if (selectError) throw new Error(selectError.message);

  const nextIds = new Set(reservations.map((record) => record.id));
  const toDelete = (existing || []).map((row) => row.id).filter((id) => !nextIds.has(id));

  if (reservations.length) {
    const { error } = await supabase.client.from(TABLE).upsert(reservations.map(toDbRow), { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }

  if (toDelete.length) {
    const { error } = await supabase.client.from(TABLE).delete().in('id', toDelete);
    if (error) throw new Error(error.message);
  }
}

/* ---------- 공통 진입점 ---------- */

async function readReservations() {
  if (mode() === 'supabase') {
    try {
      cache = await readSupabase();
      lastBlobError = '';
      return cache;
    } catch (error) {
      lastBlobError = error.message || String(error);
      console.error('[예약 저장소] Supabase를 읽지 못했어요:', lastBlobError);
      throw error;
    }
  }

  if (mode() === 'blob') {
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

  return readLocal();
}

async function writeReservations(reservations) {
  if (mode() === 'supabase') {
    try {
      await writeSupabase(reservations);
      lastBlobError = '';
      cache = reservations;
    } catch (error) {
      lastBlobError = error.message || String(error);
      console.error('[예약 저장소] Supabase에 쓰지 못했어요:', lastBlobError);
      throw new Error('예약을 저장소에 기록하지 못했어요.');
    }
    return;
  }

  if (mode() === 'blob') {
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
    return;
  }

  writeLocal(reservations);
}

function describe() {
  return {
    mode: mode(),
    healthy: !lastBlobError,
    ...(lastBlobError ? { problem: lastBlobError } : {}),
  };
}

module.exports = { readReservations, writeReservations, usesBlob, describe };
