'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { getPortfolioData } = require('./data/portfolioData');
const projectStore = require('./data/projectStore');
const adminAuth = require('./auth/adminAuth');

const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_ROOT = path.resolve(__dirname, '..', 'frontend');
const SESSION_COOKIE = 'admin_session';
const MAX_BODY_BYTES = 100 * 1024;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function sendJson(response, statusCode, payload, extraHeaders) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(extraHeaders || {}),
  });
  response.end(JSON.stringify(payload));
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index < 0) return;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  });
  return cookies;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error('INVALID_JSON'));
      }
    });

    request.on('error', reject);
  });
}

function sessionToken(request) {
  return parseCookies(request.headers.cookie)[SESSION_COOKIE] || '';
}

function isAuthenticated(request) {
  return adminAuth.isValidSession(sessionToken(request));
}

function serveFrontend(response, requestPath) {
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const filePath = path.resolve(FRONTEND_ROOT, relativePath);

  if (!filePath.startsWith(FRONTEND_ROOT + path.sep)) {
    sendJson(response, 403, { error: 'Forbidden' });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        sendJson(response, 404, { error: 'Not found' });
        return;
      }
      sendJson(response, 500, { error: 'Unable to read frontend file' });
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    response.end(content);
  });
}

/* ==========================================================================
   관리자 API
   ========================================================================== */

async function handleLogin(request, response) {
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, { error: '요청을 읽을 수 없어요.' });
    return;
  }

  const clientKey = request.socket.remoteAddress || 'unknown';
  const result = adminAuth.login(body.password, clientKey);

  if (result.locked) {
    sendJson(response, 429, {
      error: `로그인 시도가 많아요. ${result.retryAfterSeconds}초 뒤에 다시 시도해 주세요.`,
    });
    return;
  }

  if (!result.ok) {
    // 비밀번호 값이나 힌트는 응답에 담지 않는다.
    sendJson(response, 401, { error: '비밀번호가 올바르지 않아요.' });
    return;
  }

  const cookie = [
    `${SESSION_COOKIE}=${result.session.token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${result.session.maxAgeSeconds}`,
  ].join('; ');

  sendJson(response, 200, { authenticated: true }, { 'Set-Cookie': cookie });
}

function handleLogout(request, response) {
  adminAuth.destroySession(sessionToken(request));
  const cookie = `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
  sendJson(response, 200, { authenticated: false }, { 'Set-Cookie': cookie });
}

async function handleAdminProjects(request, response, requestUrl) {
  if (!isAuthenticated(request)) {
    sendJson(response, 401, { error: '로그인이 필요해요.' });
    return;
  }

  // /api/admin/projects/:id
  const segments = requestUrl.pathname.split('/').filter(Boolean);
  const id = segments[3] || '';

  if (request.method === 'GET' && !id) {
    sendJson(response, 200, { projects: projectStore.listAll() });
    return;
  }

  if (request.method === 'DELETE' && id) {
    const result = projectStore.remove(id);
    if (result.notFound) {
      sendJson(response, 404, { error: '프로젝트를 찾을 수 없어요.' });
      return;
    }
    sendJson(response, 200, { removed: true });
    return;
  }

  if (request.method === 'POST' || request.method === 'PUT') {
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      const message =
        error.message === 'PAYLOAD_TOO_LARGE' ? '내용이 너무 길어요.' : '요청을 읽을 수 없어요.';
      sendJson(response, 400, { error: message });
      return;
    }

    const result =
      request.method === 'POST' ? projectStore.create(body) : projectStore.update(id, body);

    if (result.notFound) {
      sendJson(response, 404, { error: '프로젝트를 찾을 수 없어요.' });
      return;
    }
    if (result.errors) {
      sendJson(response, 400, { errors: result.errors });
      return;
    }

    sendJson(response, request.method === 'POST' ? 201 : 200, { project: result.project });
    return;
  }

  sendJson(response, 405, { error: 'Method not allowed' });
}

/* ==========================================================================
   라우팅
   ========================================================================== */

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;

  if (pathname === '/api/admin/login' && request.method === 'POST') {
    handleLogin(request, response);
    return;
  }

  if (pathname === '/api/admin/logout' && request.method === 'POST') {
    handleLogout(request, response);
    return;
  }

  if (pathname === '/api/admin/session' && request.method === 'GET') {
    sendJson(response, 200, { authenticated: isAuthenticated(request) });
    return;
  }

  if (pathname === '/api/admin/projects' || pathname.startsWith('/api/admin/projects/')) {
    handleAdminProjects(request, response, requestUrl);
    return;
  }

  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  if (pathname === '/api/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (pathname === '/api/portfolio') {
    sendJson(response, 200, getPortfolioData());
    return;
  }

  if (pathname === '/api/categories') {
    sendJson(response, 200, { categories: projectStore.CATEGORIES });
    return;
  }

  if (pathname === '/admin' || pathname === '/admin/') {
    serveFrontend(response, '/admin.html');
    return;
  }

  serveFrontend(response, pathname);
});

const credentialInfo = adminAuth.init();

server.listen(PORT, () => {
  console.log(`Portfolio server is running at http://localhost:${PORT}`);
  console.log(`Admin page: http://localhost:${PORT}/admin`);

  if (credentialInfo.source === 'generated') {
    console.log('');
    console.log('============================================================');
    console.log('관리자 비밀번호가 새로 만들어졌어요. 이 값을 저장해 두세요.');
    console.log(`  비밀번호: ${credentialInfo.password}`);
    console.log('바꾸려면: npm.cmd run set-password -- 새비밀번호');
    console.log('============================================================');
    console.log('');
  } else if (credentialInfo.source === 'env') {
    console.log('관리자 비밀번호: 환경변수 ADMIN_PASSWORD 사용 중');
  }
});
