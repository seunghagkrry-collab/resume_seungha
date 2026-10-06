'use strict';

// 방문 예약의 규칙과 검증을 한곳에 모은다.
// 브라우저에서도 같은 규칙으로 막아주지만(frontend/reserve.js), 그쪽은
// 사용자에게 바로 알려주기 위한 것이고 진짜 기준은 여기다.

const crypto = require('node:crypto');
const storage = require('./reservationStorage');

/* ==========================================================================
   처리 상태
   운영자가 예약을 네 단계로 관리한다. 저장에는 영어 코드를 쓰고,
   화면에 보일 한국어 이름은 라벨로 함께 내보낸다.
   ========================================================================== */
const STATUS_LABELS = {
  received: '접수',          // 신청자가 넣은 그대로
  confirmed: '확정',          // 그 날짜·시간에 만나기로 승인
  change_requested: '변경 요청', // 만나고는 싶지만 다른 시간을 원할 때
  cancelled: '취소',          // 이 방문을 받지 않을 때
};
const STATUSES = Object.keys(STATUS_LABELS);
const DEFAULT_STATUS = 'received';

function normalizeStatus(value) {
  if (STATUSES.includes(value)) return value;
  // 예약 기능을 처음 넣을 때 쓰던 값.
  if (value === 'new') return DEFAULT_STATUS;
  return DEFAULT_STATUS;
}

/* ==========================================================================
   예약번호
   같은 사람이 여러 번 방문할 수 있으므로 이름/이메일만으로는 구분되지 않는다.
   (이름 + 이메일) 해시에 방문 날짜·시간을 붙여 한 칸(슬롯)당 하나가 되게 한다.
   예: R-261007-1430-A3F1
   ========================================================================== */
function reservationCode(record) {
  const person = `${String(record.email || '').trim().toLowerCase()}|${String(record.name || '').trim()}`;
  const personTag = crypto.createHash('sha256').update(person).digest('hex').slice(0, 4).toUpperCase();

  const date = String(record.visitDate || '').replace(/-/g, '').slice(2); // YYMMDD
  const time = String(record.visitTime || '').replace(':', '');           // HHMM

  return `R-${date}-${time}-${personTag}`;
}

/* ==========================================================================
   예약 가능 시간
   13:00 ~ 18:00, 30분 단위 (18:00 포함)
   ========================================================================== */
const TIME_SLOTS = (() => {
  const slots = [];
  for (let minutes = 13 * 60; minutes <= 18 * 60; minutes += 30) {
    const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
    const minute = String(minutes % 60).padStart(2, '0');
    slots.push(`${hour}:${minute}`);
  }
  return slots;
})();

/* ==========================================================================
   관공서 공휴일 + 근로자의 날
   Nager.Date(date.nager.at) KR 목록을 기준으로 적었고, 공휴일이 아닌
   제헌절(7/17)은 평일로 둔다. 해가 바뀌면 다음 해를 여기에 추가해야 한다.
   frontend/reserve.js에도 같은 표가 있다. 한쪽만 고치면 안 된다.
   ========================================================================== */
const HOLIDAYS = {
  // 2026
  '2026-01-01': '신정',
  '2026-02-16': '설날 연휴',
  '2026-02-17': '설날',
  '2026-02-18': '설날 연휴',
  '2026-03-02': '삼일절 대체공휴일',
  '2026-05-01': '근로자의 날',
  '2026-05-05': '어린이날',
  '2026-05-25': '부처님오신날 대체공휴일',
  '2026-06-03': '지방선거일',
  '2026-06-06': '현충일',
  '2026-08-17': '광복절 대체공휴일',
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-09-26': '추석 연휴',
  '2026-10-05': '개천절 대체공휴일',
  '2026-10-09': '한글날',
  '2026-12-25': '성탄절',
  // 2027
  '2027-01-01': '신정',
  '2027-02-06': '설날 연휴',
  '2027-02-07': '설날',
  '2027-02-08': '설날 연휴',
  '2027-02-09': '설날 대체공휴일',
  '2027-03-01': '삼일절',
  '2027-05-03': '근로자의 날 대체휴일',
  '2027-05-05': '어린이날',
  '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일',
  '2027-08-16': '광복절 대체공휴일',
  '2027-09-14': '추석 연휴',
  '2027-09-15': '추석',
  '2027-09-16': '추석 연휴',
  '2027-10-04': '개천절 대체공휴일',
  '2027-10-11': '한글날 대체공휴일',
  '2027-12-25': '성탄절',
  '2027-12-27': '성탄절 대체공휴일',
};

// 오늘부터 며칠 뒤까지 예약을 받을지. 너무 먼 날짜는 의미가 없다.
const BOOKING_WINDOW_DAYS = 90;

const MAX_NAME_LENGTH = 40;
const MAX_EMAIL_LENGTH = 120;
const MAX_PURPOSE_LENGTH = 1000;
const MIN_PURPOSE_LENGTH = 5;

// 로컬파트@도메인.최상위 형태만 받는다. 공백과 @ 중복을 막는 수준이면 충분하다.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/* ==========================================================================
   날짜 도우미 - 모두 한국 시간(KST) 기준으로 센다.
   서버가 UTC로 돌면 자정 무렵에 하루가 밀리므로 직접 보정한다.
   ========================================================================== */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function todayInKst() {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const base = new Date(`${isoDate}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

// 0=일요일 ... 6=토요일
function weekdayIndex(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

function isRealDate(isoDate) {
  if (!DATE_PATTERN.test(isoDate)) return false;
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === isoDate;
}

function isWeekend(isoDate) {
  const day = weekdayIndex(isoDate);
  return day === 0 || day === 6;
}

function holidayName(isoDate) {
  return HOLIDAYS[isoDate] || '';
}

// 평일이고, 공휴일이 아니고, 예약 창 안에 있는 날인지.
function describeDate(isoDate) {
  if (!isRealDate(isoDate)) return { selectable: false, reason: '날짜 형식이 올바르지 않아요.' };

  const today = todayInKst();
  if (isoDate < today) return { selectable: false, reason: '지난 날짜는 예약할 수 없어요.' };
  if (isoDate === today) {
    return { selectable: false, reason: '당일 예약은 받지 않아요. 다음 평일부터 골라주세요.' };
  }
  if (isoDate > addDays(today, BOOKING_WINDOW_DAYS)) {
    return { selectable: false, reason: `오늘부터 ${BOOKING_WINDOW_DAYS}일 안의 날짜만 예약할 수 있어요.` };
  }
  if (isWeekend(isoDate)) return { selectable: false, reason: '주말은 예약할 수 없어요.' };

  const holiday = holidayName(isoDate);
  if (holiday) return { selectable: false, reason: `${holiday}은 휴일이라 예약할 수 없어요.` };

  return { selectable: true, reason: '' };
}

/* ==========================================================================
   검증
   ========================================================================== */
function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validate(input) {
  const errors = {};
  const source = input && typeof input === 'object' ? input : {};

  const name = asText(source.name);
  if (!name) {
    errors.name = '이름을 입력해 주세요.';
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.name = `이름은 ${MAX_NAME_LENGTH}자 이내로 입력해 주세요.`;
  }

  const email = asText(source.email);
  if (!email) {
    errors.email = '답장받을 이메일을 입력해 주세요.';
  } else if (email.length > MAX_EMAIL_LENGTH) {
    errors.email = `이메일은 ${MAX_EMAIL_LENGTH}자 이내로 입력해 주세요.`;
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = '이메일 형식이 올바르지 않아요. 예: hong@example.com';
  }

  const purpose = asText(source.purpose);
  if (!purpose) {
    errors.purpose = '방문 목적을 입력해 주세요.';
  } else if (purpose.length < MIN_PURPOSE_LENGTH) {
    errors.purpose = `방문 목적을 ${MIN_PURPOSE_LENGTH}자 이상 적어주세요.`;
  } else if (purpose.length > MAX_PURPOSE_LENGTH) {
    errors.purpose = `방문 목적은 ${MAX_PURPOSE_LENGTH}자 이내로 입력해 주세요.`;
  }

  const visitDate = asText(source.visitDate);
  if (!visitDate) {
    errors.visitDate = '방문할 날짜를 선택해 주세요.';
  } else {
    const verdict = describeDate(visitDate);
    if (!verdict.selectable) errors.visitDate = verdict.reason;
  }

  const visitTime = asText(source.visitTime);
  if (!visitTime) {
    errors.visitTime = '희망 시간을 선택해 주세요.';
  } else if (!TIME_SLOTS.includes(visitTime)) {
    errors.visitTime = '예약할 수 없는 시간이에요.';
  }

  if (source.consent !== true) {
    errors.consent = '정보 전달 동의가 필요해요.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: {},
    value: { name, email, purpose, visitDate, visitTime, consent: true },
  };
}

/* ==========================================================================
   저장
   ========================================================================== */
function makeId() {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `rsv_${stamp}_${random}`;
}

// 예전에 저장된 기록에는 code가 없고 status가 'new'일 수 있다.
// 화면에서 분기하지 않도록 읽는 길목에서 모양을 맞춰 준다.
function decorate(record) {
  const status = normalizeStatus(record.status);
  return {
    ...record,
    status,
    statusLabel: STATUS_LABELS[status],
    code: record.code || reservationCode(record),
  };
}

async function listReservations() {
  const reservations = await storage.readReservations();
  return [...reservations]
    // 신청이 들어온 순서대로 번호를 세기 위해 먼저 오래된 것부터 정렬한다.
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .map((record, index) => ({ ...decorate(record), seq: index + 1 }))
    // 보여줄 때는 최근 신청이 위로.
    .reverse();
}

async function addReservation(input) {
  const checked = validate(input);
  if (!checked.ok) return { ok: false, errors: checked.errors };

  const record = {
    id: makeId(),
    status: DEFAULT_STATUS,
    ...checked.value,
    createdAt: new Date().toISOString(),
  };
  record.code = reservationCode(record);

  const reservations = await storage.readReservations();
  reservations.push(record);
  await storage.writeReservations(reservations);

  return { ok: true, record: decorate(record) };
}

async function updateStatus(id, status) {
  if (!STATUSES.includes(status)) {
    return { ok: false, badStatus: true };
  }

  const reservations = await storage.readReservations();
  const found = reservations.find((record) => record.id === id);
  if (!found) return { ok: false, notFound: true };

  found.status = status;
  found.updatedAt = new Date().toISOString();
  // 예전 기록에는 번호가 없다. 손대는 김에 함께 채워 둔다.
  if (!found.code) found.code = reservationCode(found);

  await storage.writeReservations(reservations);
  return { ok: true, record: decorate(found) };
}

module.exports = {
  TIME_SLOTS,
  HOLIDAYS,
  BOOKING_WINDOW_DAYS,
  MAX_PURPOSE_LENGTH,
  STATUSES,
  STATUS_LABELS,
  validate,
  describeDate,
  listReservations,
  addReservation,
  updateStatus,
  describeStorage: storage.describe,
};
