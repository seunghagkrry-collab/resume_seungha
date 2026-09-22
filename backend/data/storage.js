'use strict';

// 프로젝트 목록을 어디에 두는지 결정하는 곳.
// - 내 컴퓨터: backend/data/projects.json 파일
// - Vercel: Vercel Blob (서버리스는 파일에 쓸 수 없다)
// 두 경우 모두 { projects: [...] } 모양을 그대로 주고받는다.

const fs = require('node:fs');
const path = require('node:path');

const DATA_FILE = path.resolve(__dirname, 'projects.json');
const TEMP_FILE = `${DATA_FILE}.tmp`;
const BLOB_PATH = 'portfolio/projects.json';

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN || '';
}

function usesBlob() {
  return Boolean(blobToken());
}

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
// CDN이 잠깐 옛 내용을 줘도 화면이 되돌아가지 않는다.
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

/* ---------- 공통 진입점 ---------- */

async function readProjects() {
  if (!usesBlob()) return readLocal();
  if (cache) return cache;
  cache = await readBlob();
  return cache;
}

async function writeProjects(projects) {
  if (!usesBlob()) {
    writeLocal(projects);
    return;
  }
  await writeBlob(projects);
  cache = projects;
}

module.exports = { readProjects, writeProjects, usesBlob };
