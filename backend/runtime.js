'use strict';

// 이 서버가 프로젝트를 "안전하게" 저장할 수 있는 환경인지 판단한다.
//
// Render 무료 플랜과 Vercel 서버리스는 디스크가 유지되지 않는다.
// 저장은 되는 것처럼 보이지만 서버가 다시 뜨면 내용이 사라진다.
// 성공했다고 알려 놓고 잃어버리는 쪽이 가장 나쁘므로,
// 저장이 유지되는 경우에만 관리 기능을 연다.

const IS_EPHEMERAL_HOST = Boolean(
  process.env.RENDER || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
);

function hasExternalStorage() {
  return (process.env.BLOB_READ_WRITE_TOKEN || '').trim().length > 0;
}

function isEphemeralHost() {
  return IS_EPHEMERAL_HOST;
}

// 내 컴퓨터이거나, 외부 저장소가 붙어 있을 때만 쓰기를 허용한다.
function isWritable() {
  return !IS_EPHEMERAL_HOST || hasExternalStorage();
}

module.exports = { isEphemeralHost, isWritable, hasExternalStorage };
