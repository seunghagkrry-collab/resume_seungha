'use strict';

// 이 서버가 프로젝트를 저장할 수 있는 환경인지 판단한다.
//
// Vercel 같은 서버리스는 파일 시스템이 읽기 전용이고 요청마다 인스턴스가 바뀐다.
// 그대로 저장을 허용하면 내용이 조용히 사라지므로, 외부 저장소가 연결된 경우에만
// 쓰기를 연다.

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function hasExternalStorage() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function isServerless() {
  return IS_SERVERLESS;
}

function isWritable() {
  return !IS_SERVERLESS || hasExternalStorage();
}

module.exports = { isServerless, isWritable, hasExternalStorage };
