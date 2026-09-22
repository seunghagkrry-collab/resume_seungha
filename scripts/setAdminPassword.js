'use strict';

// 사용법: npm.cmd run set-password -- 새비밀번호
const adminAuth = require('../backend/auth/adminAuth');

const password = process.argv[2];

if (!password) {
  console.error('사용법: npm.cmd run set-password -- 새비밀번호');
  process.exit(1);
}

if (password.length < 4) {
  console.error('비밀번호는 4자 이상으로 정해 주세요.');
  process.exit(1);
}

adminAuth.setPassword(password);

if (password.length < 8 || /^\d+$/.test(password)) {
  console.warn('');
  console.warn('[주의] 짧거나 숫자로만 된 비밀번호는 대입 공격에 약해요.');
  console.warn('       인터넷에 공개 배포할 때는 더 긴 비밀번호를 권합니다.');
  console.warn('');
}

console.log('관리자 비밀번호를 바꿨어요.');
console.log(`저장 위치: ${adminAuth.CREDENTIAL_FILE}`);
console.log('평문이 아니라 해시만 저장되고, 이 파일은 .gitignore에 들어 있어요.');
console.log('서버가 켜져 있다면 다시 시작해 주세요.');
