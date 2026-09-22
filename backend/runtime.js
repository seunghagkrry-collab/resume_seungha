'use strict';

// Vercel 같은 서버리스 환경은 파일 시스템이 읽기 전용이고, 요청마다 다른 인스턴스가
// 뜰 수 있다. 저장을 시도하면 사라지거나 인스턴스마다 달라지므로 아예 막는다.
const READ_ONLY = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function isReadOnly() {
  return READ_ONLY;
}

module.exports = { isReadOnly };
