'use strict';

// Supabase 연결을 한곳에서만 만든다. 다른 파일은 이 모듈을 가져다 쓰기만 한다.
// .env에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY를 넣기 전까지는 client가 null이라,
// 기존 파일/Blob 저장소가 그대로 동작한다.

const { createClient } = require('@supabase/supabase-js');

function readEnv(name) {
  return (process.env[name] || '').trim();
}

const SUPABASE_URL = readEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = readEnv('SUPABASE_SERVICE_ROLE_KEY');

function isConfigured() {
  return SUPABASE_URL.length > 0 && SUPABASE_SERVICE_ROLE_KEY.length > 0;
}

// service_role 키는 RLS를 건너뛴다. 절대 프론트엔드로 보내면 안 된다.
const client = isConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  : null;

module.exports = { client, isConfigured };
