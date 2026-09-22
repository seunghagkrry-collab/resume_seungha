'use strict';

// Vercel 서버리스 진입점.
// 로컬에서는 backend/server.js가 포트를 열고, Vercel에서는 이 파일이 요청을 받는다.
// 두 경우 모두 같은 requestHandler를 쓴다.
const { requestHandler } = require('../backend/server');

module.exports = (request, response) => requestHandler(request, response);
