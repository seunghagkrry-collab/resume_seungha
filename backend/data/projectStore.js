'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isReadOnly } = require('../runtime');

const DATA_FILE = path.resolve(__dirname, 'projects.json');
const TEMP_FILE = `${DATA_FILE}.tmp`;

const CATEGORIES = ['웹', '데이터', '디자인'];

// 참고사항(notes)만 선택 입력이다. 나머지는 공개 상태에서 필수.
const REQUIRED_TEXT_FIELDS = [
  ['title', '제목을'],
  ['role', '내가 한 역할을'],
  ['description', '설명을'],
  ['date', '날짜를'],
  ['category', '분야를'],
];

function readFileSafely() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// 쓰기 도중 종료되어도 기존 파일이 깨지지 않도록 임시 파일에 먼저 쓴다.
function writeFileSafely(projects) {
  const payload = JSON.stringify({ projects }, null, 2);
  fs.writeFileSync(TEMP_FILE, payload, 'utf8');
  fs.renameSync(TEMP_FILE, DATA_FILE);
}

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTeamSize(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

// 브라우저가 href로 그대로 쓰므로 http/https만 허용한다.
function normalizeLinkUrl(value) {
  const text = trimText(value);
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? text : '';
  } catch (error) {
    return '';
  }
}

function normalizeStatus(value) {
  return value === 'published' ? 'published' : 'draft';
}

function normalizeInput(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    status: normalizeStatus(source.status),
    title: trimText(source.title),
    role: trimText(source.role),
    description: trimText(source.description),
    date: trimText(source.date),
    teamSize: normalizeTeamSize(source.teamSize),
    notes: trimText(source.notes),
    category: trimText(source.category),
    result: trimText(source.result),
    linkUrl: normalizeLinkUrl(source.linkUrl),
    linkLabel: trimText(source.linkLabel),
  };
}

// 초안은 빈칸을 허용한다. 공개는 참고사항을 뺀 모든 칸이 채워져야 한다.
function validate(record) {
  const errors = [];

  if (record.date && !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
    errors.push('날짜는 2026-03-15 형식으로 입력해 주세요.');
  }
  if (record.category && !CATEGORIES.includes(record.category)) {
    errors.push(`분야는 ${CATEGORIES.join(', ')} 중에서 선택해 주세요.`);
  }
  if (record.title.length > 120) errors.push('제목은 120자 이내로 입력해 주세요.');
  if (record.description.length > 2000) errors.push('설명은 2000자 이내로 입력해 주세요.');

  if (record.status !== 'published') return errors;

  REQUIRED_TEXT_FIELDS.forEach(([field, label]) => {
    if (!record[field]) errors.push(`${label} 입력해야 공개할 수 있어요.`);
  });
  if (record.teamSize === null) {
    errors.push('참여인원 수를 1명 이상으로 입력해야 공개할 수 있어요.');
  }

  return errors;
}

function listAll() {
  return readFileSafely();
}

function listPublished() {
  return readFileSafely().filter((project) => project.status === 'published');
}

function create(input) {
  if (isReadOnly()) return { readOnly: true };
  const record = normalizeInput(input);
  const errors = validate(record);
  if (errors.length) return { errors };

  const now = new Date().toISOString();
  const project = {
    id: `p_${crypto.randomBytes(8).toString('hex')}`,
    ...record,
    createdAt: now,
    updatedAt: now,
  };

  const projects = readFileSafely();
  projects.push(project);
  writeFileSafely(projects);
  return { project };
}

function update(id, input) {
  if (isReadOnly()) return { readOnly: true };
  const projects = readFileSafely();
  const index = projects.findIndex((project) => project.id === id);
  if (index === -1) return { notFound: true };

  const record = normalizeInput(input);
  const errors = validate(record);
  if (errors.length) return { errors };

  const project = {
    ...projects[index],
    ...record,
    updatedAt: new Date().toISOString(),
  };
  projects[index] = project;
  writeFileSafely(projects);
  return { project };
}

function remove(id) {
  if (isReadOnly()) return { readOnly: true };
  const projects = readFileSafely();
  const next = projects.filter((project) => project.id !== id);
  if (next.length === projects.length) return { notFound: true };
  writeFileSafely(next);
  return { removed: true };
}

module.exports = {
  CATEGORIES,
  listAll,
  listPublished,
  create,
  update,
  remove,
};
