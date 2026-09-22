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

// 실제 Vercel Blob 토큰만 받아들인다. 환경변수에 설명이나 한글을 적어둔 경우
// 값이 있다는 이유로 저장소가 붙었다고 오해하면, 저장이 계속 실패한다.
const BLOB_TOKEN_PATTERN = /^vercel_blob_rw_[A-Za-z0-9_-]+$/;

function rawBlobToken() {
  return (process.env.BLOB_READ_WRITE_TOKEN || '').trim();
}

function blobToken() {
  const raw = rawBlobToken();
  return BLOB_TOKEN_PATTERN.test(raw) ? raw : '';
}

// 값은 들어 있는데 토큰 모양이 아닌 경우를 알려주기 위한 판별.
function hasMalformedBlobToken() {
  return rawBlobToken().length > 0 && blobToken().length === 0;
}

function isEphemeralHost() {
  return IS_EPHEMERAL_HOST;
}

function hasExternalStorage() {
  return blobToken().length > 0;
}

// 내 컴퓨터이거나, 외부 저장소가 붙어 있을 때만 쓰기를 허용한다.
function isWritable() {
  return !IS_EPHEMERAL_HOST || hasExternalStorage();
}

module.exports = {
  isEphemeralHost,
  isWritable,
  hasExternalStorage,
  hasMalformedBlobToken,
  blobToken,
};
