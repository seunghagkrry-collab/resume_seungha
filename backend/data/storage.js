'use strict';

// 프로젝트 목록을 어디에 두는지 결정하는 곳.
// - Supabase: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY가 있을 때 (추천)
// - 내 컴퓨터, Render 디스크: backend/data/projects.json 파일
// - Vercel Blob: BLOB_READ_WRITE_TOKEN이 있을 때
// 어떤 경우든 읽기/쓰기 쪽에서는 { projects: [...] } 모양(캐멀케이스 필드)을 그대로 주고받는다.

const fs = require('node:fs');
const path = require('node:path');
const { blobToken } = require('../runtime');
const supabase = require('./supabaseClient');

const DATA_FILE = path.resolve(__dirname, 'projects.json');
const TEMP_FILE = `${DATA_FILE}.tmp`;
const BLOB_PATH = 'portfolio/projects.json';
const TABLE = 'projects';

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
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// 쓰기 도중 종료되어도 기존 파일이 깨지지 않도록 임시 파일에 먼저 쓴다.
function writeLocal(projects) {
  fs.writeFileSync(TEMP_FILE, JSON.stringify({ projects }, null, 2), 'utf8');
  fs.renameSync(TEMP_FILE, DATA_FILE);
}

/* ---------- Vercel Blob 저장소 ---------- */

// 같은 인스턴스가 방금 쓴 내용을 바로 읽도록 들고 있는다.
let cache = null;

function loadBlobSdk() {
  // 로컬에서는 설치돼 있지 않을 수 있으므로 필요할 때만 불러온다.
  return require('@vercel/blob');
}

async function readBlob() {
  const { list } = loadBlobSdk();
  const found = await list({ prefix: BLOB_PATH, limit: 1, token: blobToken() });
  const entry = found.blobs.find((blob) => blob.pathname === BLOB_PATH);

  // 아직 한 번도 저장한 적이 없으면 저장소에 함께 올라간 파일을 씨앗으로 쓴다.
  if (!entry) return readLocal();

  const response = await fetch(`${entry.url}?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Blob 읽기 실패: HTTP ${response.status}`);

  const parsed = await response.json();
  return Array.isArray(parsed.projects) ? parsed.projects : [];
}

async function writeBlob(projects) {
  const { put } = loadBlobSdk();
  await put(BLOB_PATH, JSON.stringify({ projects }, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    token: blobToken(),
  });
}

/* ---------- Supabase 저장소 ---------- */

// DB 열(snake_case) <-> 코드에서 쓰는 필드(camelCase) 변환.
function toDbRow(project) {
  return {
    id: project.id,
    status: project.status,
    title: project.title,
    role: project.role,
    description: project.description,
    date: project.date || null,
    team_size: project.teamSize,
    notes: project.notes,
    category: project.category,
    result: project.result,
    link_url: project.linkUrl,
    link_label: project.linkLabel,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };
}

function fromDbRow(row) {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    role: row.role,
    description: row.description,
    date: row.date || '',
    teamSize: row.team_size,
    notes: row.notes,
    category: row.category,
    result: row.result,
    linkUrl: row.link_url,
    linkLabel: row.link_label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

// projects.json과 같은 "전체를 통째로 바꿔 끼운다" 방식을 테이블에서도 맞춘다.
// 목록에 있는 건 upsert, 목록에서 빠진(삭제된) 건 지운다.
async function writeSupabase(projects) {
  const { data: existing, error: selectError } = await supabase.client.from(TABLE).select('id');
  if (selectError) throw new Error(selectError.message);

  const nextIds = new Set(projects.map((project) => project.id));
  const toDelete = (existing || []).map((row) => row.id).filter((id) => !nextIds.has(id));

  if (projects.length) {
    const { error } = await supabase.client.from(TABLE).upsert(projects.map(toDbRow), { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }

  if (toDelete.length) {
    const { error } = await supabase.client.from(TABLE).delete().in('id', toDelete);
    if (error) throw new Error(error.message);
  }
}

/* ---------- 공통 진입점 ---------- */

// 저장소가 말썽이어도 공개 사이트는 비지 않아야 한다.
// 읽기에 실패하면 저장소에 함께 올라간 파일을 대신 보여준다.
async function readProjects() {
  if (mode() === 'supabase') {
    try {
      cache = await readSupabase();
      lastBlobError = '';
      return cache;
    } catch (error) {
      lastBlobError = error.message || String(error);
      console.error('[저장소] Supabase를 읽지 못했어요:', lastBlobError);
      console.error('[저장소] 저장소에 올라간 projects.json으로 대신 보여줍니다.');
      return readLocal();
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
      console.error('[저장소] Blob을 읽지 못했어요:', lastBlobError);
      console.error('[저장소] 저장소에 올라간 projects.json으로 대신 보여줍니다.');
      return readLocal();
    }
  }

  return readLocal();
}

async function writeProjects(projects) {
  if (mode() === 'supabase') {
    try {
      await writeSupabase(projects);
      lastBlobError = '';
      cache = projects;
    } catch (error) {
      lastBlobError = error.message || String(error);
      console.error('[저장소] Supabase에 쓰지 못했어요:', lastBlobError);
      throw new Error('저장소에 기록하지 못했어요. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY를 확인해 주세요.');
    }
    return;
  }

  if (mode() === 'blob') {
    try {
      await writeBlob(projects);
      lastBlobError = '';
      cache = projects;
    } catch (error) {
      lastBlobError = error.message || String(error);
      console.error('[저장소] Blob에 쓰지 못했어요:', lastBlobError);
      throw new Error('저장소에 기록하지 못했어요. BLOB_READ_WRITE_TOKEN을 확인해 주세요.');
    }
    return;
  }

  writeLocal(projects);
}

function describe() {
  return {
    mode: mode(),
    healthy: !lastBlobError,
    ...(lastBlobError ? { problem: lastBlobError } : {}),
  };
}

module.exports = { readProjects, writeProjects, usesBlob, describe };
