'use strict';

// 관리자 페이지에서 고친 프로젝트를 공개 사이트에 올린다.
// 사용법: npm.cmd run publish
//
// projects.json 하나만 커밋한다. 작업 중인 다른 파일은 건드리지 않는다.

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = 'backend/data/projects.json';

function git(args, options) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...options }).trim();
}

try {
  const changed = git(['status', '--porcelain', '--', DATA_FILE]);

  if (!changed) {
    console.log('바뀐 프로젝트가 없어요. 올릴 내용이 없습니다.');
    process.exit(0);
  }

  const projects = require(path.join(ROOT, DATA_FILE)).projects || [];
  const published = projects.filter((project) => project.status === 'published').length;

  git(['add', '--', DATA_FILE]);
  git(['commit', '-m', `chore: 프로젝트 내용 갱신 (공개 ${published}건 / 전체 ${projects.length}건)`]);
  git(['push', 'origin', 'HEAD']);

  console.log(`올렸어요. 공개 ${published}건 / 전체 ${projects.length}건`);
  console.log('Render가 다시 배포하는 데 1~2분쯤 걸려요.');
  console.log('확인: https://resume-seungha.vercel.app');
} catch (error) {
  console.error('올리지 못했어요.');
  console.error(error.stderr ? String(error.stderr).trim() : error.message);
  process.exit(1);
}
