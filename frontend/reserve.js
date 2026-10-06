/* ==========================================================================
   방문 예약 페이지
   - 공휴일을 뺀 평일만 고를 수 있는 캘린더
   - 13:00~18:00 30분 단위 희망 시간
   - 이름 / 이메일 / 방문 목적 필수 입력 + 이메일 형식 검사
   - 필수 항목과 동의 체크가 모두 채워질 때만 예약하기 버튼이 켜진다
   - 예약하기 -> 확인 팝업 -> 확정 시 서버에 저장
   ========================================================================== */

/* ==========================================================================
   규칙 (backend/data/reservationStore.js와 같은 값이어야 한다)
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

// 관공서 공휴일 + 근로자의 날. 공휴일이 아닌 제헌절(7/17)은 넣지 않는다.
// 출처: date.nager.at KR 목록. 해가 바뀌면 다음 해를 추가해야 한다.
const HOLIDAYS = {
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

/* ==========================================================================
   Formspree - 예약 내용을 운영자 이메일로 보내는 곳
   받는 주소는 코드에 적지 않는다. Formspree 대시보드의 폼 설정에 들어 있고,
   공개 페이지에 이메일을 적으면 스팸 수집기에 그대로 긁힌다.
   ========================================================================== */
const FORMSPREE_FORM_ID = 'xqpeaapj';
const FORMSPREE_ENDPOINT = FORMSPREE_FORM_ID
  ? `https://formspree.io/f/${FORMSPREE_FORM_ID}`
  : '';

const BOOKING_WINDOW_DAYS = 90;
const MAX_PURPOSE_LENGTH = 1000;
const MIN_PURPOSE_LENGTH = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const STORAGE_KEY = 'seungha-visit-reservations';
const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/* ==========================================================================
   날짜 도우미 - 한국 시간 기준, 'YYYY-MM-DD' 문자열로만 다룬다.
   Date 객체를 돌려쓰면 시간대 때문에 하루가 밀린다.
   ========================================================================== */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function todayIso() {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function isoOf(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(iso, days) {
  const base = new Date(`${iso}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function weekdayOf(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatKorean(iso) {
  const [year, month, day] = iso.split('-');
  return `${year}년 ${Number(month)}월 ${Number(day)}일 (${WEEKDAY_NAMES[weekdayOf(iso)]})`;
}

const TODAY = todayIso();
// 당일 예약은 받지 않으므로 내일부터.
const FIRST_DATE = addDays(TODAY, 1);
const LAST_DATE = addDays(TODAY, BOOKING_WINDOW_DAYS);

// 고를 수 있는 날인지, 아니면 왜 못 고르는지.
/* 이미 예약이 찬 시간대. { 'YYYY-MM-DD': ['13:00', ...] }
   서버(GET /api/reservations/taken)에서 받아 채운다. 못 받으면 비어 있고,
   그때도 예약은 막지 않는다. 겹침을 끝에서 잡는 쪽은 서버다. */
let takenSlots = {};

function takenAt(iso) {
  return takenSlots[iso] || [];
}

function isFullyBooked(iso) {
  return TIME_SLOTS.every((slot) => takenAt(iso).includes(slot));
}

function dateStatus(iso) {
  if (iso < FIRST_DATE) return { open: false, kind: 'past', note: '지난 날짜' };
  if (iso > LAST_DATE) return { open: false, kind: 'far', note: '예약 기간 밖' };

  const day = weekdayOf(iso);
  if (day === 0) return { open: false, kind: 'weekend', note: '일요일' };
  if (day === 6) return { open: false, kind: 'weekend', note: '토요일' };

  const holiday = HOLIDAYS[iso];
  if (holiday) return { open: false, kind: 'holiday', note: holiday };

  // 그 날의 모든 시간이 차면 골라도 고를 시간이 없다. 미리 막는다.
  if (isFullyBooked(iso)) return { open: false, kind: 'full', note: '예약 마감' };

  return { open: true, kind: 'open', note: '예약 가능' };
}

/* ==========================================================================
   토스트
   ========================================================================== */
let toastTimer;
function showToast(message) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-msg');
  if (!toast || !toastMsg) return;

  toastMsg.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

/* ==========================================================================
   예약 폼
   ========================================================================== */
(function initReservation() {
  const form = document.getElementById('rsv-form');
  if (!form) return;

  const el = {
    calGrid: document.getElementById('rsv-cal-grid'),
    calLabel: document.getElementById('rsv-cal-label'),
    calPrev: document.getElementById('rsv-cal-prev'),
    calNext: document.getElementById('rsv-cal-next'),
    pickedBox: document.getElementById('rsv-picked-box'),
    pickedValue: document.getElementById('rsv-picked-value'),
    dateError: document.getElementById('rsv-date-error'),
    time: document.getElementById('rsv-time'),
    timeError: document.getElementById('rsv-time-error'),
    slotNote: document.getElementById('rsv-slot-note'),
    name: document.getElementById('rsv-name'),
    nameError: document.getElementById('rsv-name-error'),
    email: document.getElementById('rsv-email'),
    emailError: document.getElementById('rsv-email-error'),
    purpose: document.getElementById('rsv-purpose'),
    purposeError: document.getElementById('rsv-purpose-error'),
    purposeCount: document.getElementById('rsv-purpose-count'),
    consent: document.getElementById('rsv-consent'),
    consentError: document.getElementById('rsv-consent-error'),
    submit: document.getElementById('rsv-submit'),
    submitHint: document.getElementById('rsv-submit-hint'),
    modal: document.getElementById('rsv-modal'),
    modalSummary: document.getElementById('rsv-modal-summary'),
    modalError: document.getElementById('rsv-modal-error'),
    modalCancel: document.getElementById('rsv-modal-cancel'),
    modalConfirm: document.getElementById('rsv-modal-confirm'),
    done: document.getElementById('rsv-done'),
    doneDesc: document.getElementById('rsv-done-desc'),
    doneSummary: document.getElementById('rsv-done-summary'),
    doneNote: document.getElementById('rsv-done-note'),
    copySummary: document.getElementById('rsv-copy-summary'),
    again: document.getElementById('rsv-again'),
  };

  let selectedDate = '';
  // 아직 건드리지 않은 칸에 빨간 글씨를 미리 띄우지 않기 위해 추적한다.
  const touched = { name: false, email: false, purpose: false, date: false, time: false, consent: false };
  let viewYear = Number(FIRST_DATE.slice(0, 4));
  let viewMonth = Number(FIRST_DATE.slice(5, 7));

  /* ---------------- 희망 시간 채우기 ----------------
     남은 시간은 그대로, 이미 찬 시간은 "13:00 (완료)"로 적고 고를 수 없게 한다.
     날짜를 바꾸면 그 날짜 기준으로 다시 그린다. */
  function renderTimeOptions() {
    const keep = el.time.value;
    const taken = selectedDate ? takenAt(selectedDate) : [];

    el.time.replaceChildren();

    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = selectedDate ? '시간을 선택해 주세요' : '날짜를 먼저 선택해 주세요';
    el.time.appendChild(blank);

    TIME_SLOTS.forEach((slot) => {
      const option = document.createElement('option');
      option.value = slot;

      if (taken.includes(slot)) {
        option.textContent = `${slot} (완료)`;
        option.disabled = true;
      } else {
        option.textContent = slot;
      }

      el.time.appendChild(option);
    });

    // 고른 시간이 그새 차버렸으면 선택을 비운다.
    el.time.value = keep && !taken.includes(keep) ? keep : '';
  }

  renderTimeOptions();

  /* ---------------- 캘린더 ---------------- */
  const firstMonthKey = FIRST_DATE.slice(0, 7);
  const lastMonthKey = LAST_DATE.slice(0, 7);

  function viewMonthKey() {
    return `${viewYear}-${String(viewMonth).padStart(2, '0')}`;
  }

  function renderCalendar() {
    el.calLabel.textContent = `${viewYear}년 ${viewMonth}월`;
    el.calPrev.disabled = viewMonthKey() <= firstMonthKey;
    el.calNext.disabled = viewMonthKey() >= lastMonthKey;

    el.calGrid.replaceChildren();

    // 1일이 무슨 요일인지에 맞춰 앞칸을 비운다.
    const leading = weekdayOf(isoOf(viewYear, viewMonth, 1));
    for (let i = 0; i < leading; i += 1) {
      const blank = document.createElement('span');
      blank.className = 'rsv-cal-blank';
      blank.setAttribute('aria-hidden', 'true');
      el.calGrid.appendChild(blank);
    }

    const total = daysInMonth(viewYear, viewMonth);
    for (let day = 1; day <= total; day += 1) {
      const iso = isoOf(viewYear, viewMonth, day);
      const status = dateStatus(iso);

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `rsv-cal-day is-${status.kind}`;
      cell.dataset.date = iso;
      cell.textContent = String(day);

      if (!status.open) {
        cell.disabled = true;
        cell.title = status.note;
      } else {
        cell.title = `${formatKorean(iso)} 예약 가능`;
      }

      if (iso === selectedDate) {
        cell.classList.add('is-picked');
        cell.setAttribute('aria-current', 'date');
      }

      // 공휴일은 왜 못 고르는지 날짜 밑에 작게 적어준다.
      if (status.kind === 'holiday') {
        const tag = document.createElement('span');
        tag.className = 'rsv-cal-holiday-tag';
        tag.textContent = status.note;
        cell.appendChild(tag);
      }

      el.calGrid.appendChild(cell);
    }
  }

  el.calGrid.addEventListener('click', (event) => {
    const cell = event.target.closest('.rsv-cal-day');
    if (!cell || cell.disabled) return;

    selectedDate = cell.dataset.date;
    touched.date = true;
    renderCalendar();
    renderPickedDate();
    // 날짜마다 찬 시간이 다르다. 고른 날짜 기준으로 드롭박스를 다시 그린다.
    renderTimeOptions();
    refresh();
  });

  el.calPrev.addEventListener('click', () => {
    viewMonth -= 1;
    if (viewMonth < 1) {
      viewMonth = 12;
      viewYear -= 1;
    }
    renderCalendar();
  });

  el.calNext.addEventListener('click', () => {
    viewMonth += 1;
    if (viewMonth > 12) {
      viewMonth = 1;
      viewYear += 1;
    }
    renderCalendar();
  });

  function renderPickedDate() {
    if (selectedDate) {
      el.pickedValue.textContent = formatKorean(selectedDate);
      el.pickedBox.classList.add('is-filled');
    } else {
      el.pickedValue.textContent = '아직 날짜를 고르지 않았어요';
      el.pickedBox.classList.remove('is-filled');
    }
  }

  /* ---------------- 입력값 검사 ---------------- */
  function readValues() {
    return {
      name: el.name.value.trim(),
      email: el.email.value.trim(),
      purpose: el.purpose.value.trim(),
      visitDate: selectedDate,
      visitTime: el.time.value,
      consent: el.consent.checked,
    };
  }

  function collectErrors(values) {
    const errors = {};

    if (!values.name) errors.name = '이름을 입력해 주세요.';
    else if (values.name.length > 40) errors.name = '이름은 40자 이내로 입력해 주세요.';

    if (!values.email) {
      errors.email = '답장받을 이메일을 입력해 주세요.';
    } else if (!EMAIL_PATTERN.test(values.email)) {
      errors.email = '이메일 형식이 올바르지 않아요. @와 도메인을 포함해 주세요. (예: hong@example.com)';
    }

    if (!values.purpose) {
      errors.purpose = '방문 목적을 입력해 주세요.';
    } else if (values.purpose.length < MIN_PURPOSE_LENGTH) {
      errors.purpose = `방문 목적을 ${MIN_PURPOSE_LENGTH}자 이상 적어주세요.`;
    }

    if (!values.visitDate) {
      errors.visitDate = '방문할 날짜를 선택해 주세요.';
    } else if (!dateStatus(values.visitDate).open) {
      errors.visitDate = '선택할 수 없는 날짜예요. 평일을 다시 골라주세요.';
    }

    if (!values.visitTime) {
      errors.visitTime = '희망 시간을 선택해 주세요.';
    } else if (!TIME_SLOTS.includes(values.visitTime)) {
      errors.visitTime = '예약할 수 없는 시간이에요.';
    } else if (values.visitDate && takenAt(values.visitDate).includes(values.visitTime)) {
      // 드롭박스에서 (완료)는 못 고르게 해 뒀지만, 날짜를 바꾸거나 현황이
      // 늦게 도착하면 고른 값이 그새 찬 시간이 될 수 있다.
      errors.visitTime = '이미 예약이 찬 시간이에요. 다른 시간을 골라주세요.';
    }

    if (!values.consent) errors.consent = '정보 전달에 동의해 주셔야 예약을 받을 수 있어요.';

    return errors;
  }

  function paintError(box, errorEl, message, show) {
    if (errorEl) {
      if (show && message) {
        errorEl.textContent = message;
        errorEl.hidden = false;
      } else {
        errorEl.textContent = '';
        errorEl.hidden = true;
      }
    }
    if (box) box.classList.toggle('has-error', Boolean(show && message));
  }

  // 버튼을 켜고 끄는 일과 빨간 안내를 그리는 일을 한 번에 한다.
  function refresh() {
    const values = readValues();
    const errors = collectErrors(values);

    paintError(el.name, el.nameError, errors.name, touched.name);
    paintError(el.email, el.emailError, errors.email, touched.email);
    paintError(el.purpose, el.purposeError, errors.purpose, touched.purpose);
    paintError(el.pickedBox, el.dateError, errors.visitDate, touched.date);
    paintError(el.time, el.timeError, errors.visitTime, touched.time);
    paintError(null, el.consentError, errors.consent, touched.consent);

    const ready = Object.keys(errors).length === 0;
    el.submit.disabled = !ready;

    if (ready) {
      el.submitHint.textContent = '내용을 확인한 뒤 예약하기를 눌러주세요.';
      el.submitHint.classList.add('is-ready');
    } else {
      el.submitHint.textContent = missingHint(values);
      el.submitHint.classList.remove('is-ready');
    }

    return { values, errors, ready };
  }

  // 무엇이 남았는지 알려주면 사용자가 헤매지 않는다.
  function missingHint(values) {
    const missing = [];
    if (!values.visitDate) missing.push('날짜');
    if (!values.visitTime) missing.push('희망 시간');
    if (!values.name) missing.push('이름');
    if (!values.email || !EMAIL_PATTERN.test(values.email)) missing.push('이메일');
    if (!values.purpose || values.purpose.length < MIN_PURPOSE_LENGTH) missing.push('방문 목적');
    if (!values.consent) missing.push('정보 전달 동의');

    if (missing.length === 0) return '입력한 내용을 다시 확인해 주세요.';
    return `아직 ${missing.join(' · ')}이(가) 남았어요.`;
  }

  /* ---------------- 입력 이벤트 ---------------- */
  [['name', el.name], ['email', el.email], ['purpose', el.purpose]].forEach(([key, input]) => {
    input.addEventListener('input', () => {
      // 이미 지적한 칸은 고치는 즉시 빨간 글씨가 사라지고,
      // 아직 안 건드린 칸은 조용히 버튼 상태만 다시 계산된다.
      refresh();
    });
    input.addEventListener('blur', () => {
      touched[key] = true;
      refresh();
    });
  });

  el.purpose.addEventListener('input', () => {
    el.purposeCount.textContent = `${el.purpose.value.length} / ${MAX_PURPOSE_LENGTH}`;
  });

  el.time.addEventListener('change', () => {
    touched.time = true;
    refresh();
  });

  el.consent.addEventListener('change', () => {
    touched.consent = true;
    refresh();
  });

  /* ---------------- 요약 그리기 ---------------- */
  function fillSummary(target, values) {
    target.replaceChildren();

    const rows = [
      ['📅 방문 날짜', formatKorean(values.visitDate)],
      ['🕒 희망 시간', values.visitTime],
      ['🙋 이름', values.name],
      ['📧 답장받을 이메일', values.email],
      ['📝 방문 목적', values.purpose],
    ];

    rows.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'rsv-summary-row';

      const dt = document.createElement('dt');
      dt.textContent = label;

      const dd = document.createElement('dd');
      // 방문 목적은 줄바꿈을 살려야 읽힌다.
      dd.textContent = value;
      if (label.includes('방문 목적')) dd.classList.add('is-long');

      row.append(dt, dd);
      target.appendChild(row);
    });
  }

  function summaryText(values) {
    return [
      '[상록관 306 방문 예약]',
      `방문 날짜: ${formatKorean(values.visitDate)}`,
      `희망 시간: ${values.visitTime}`,
      `이름: ${values.name}`,
      `답장받을 이메일: ${values.email}`,
      '방문 목적:',
      values.purpose,
    ].join('\n');
  }

  /* ---------------- 확인 팝업 ---------------- */
  let pending = null;
  let lastFocused = null;
  // 보내는 중에 버튼 글자를 바꾸므로 원래 모습을 미리 기억해 둔다.
  const CONFIRM_LABEL = el.modalConfirm.innerHTML;

  function openModal(values) {
    pending = values;
    fillSummary(el.modalSummary, values);
    el.modalError.hidden = true;
    el.modalError.textContent = '';
    el.modalConfirm.disabled = false;
    el.modalConfirm.innerHTML = CONFIRM_LABEL;

    lastFocused = document.activeElement;
    el.modal.hidden = false;
    document.body.classList.add('rsv-modal-open');
    el.modalConfirm.focus();
  }

  function closeModal() {
    el.modal.hidden = true;
    document.body.classList.remove('rsv-modal-open');
    pending = null;
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  el.modalCancel.addEventListener('click', closeModal);

  el.modal.addEventListener('click', (event) => {
    // 팝업 바깥(어두운 배경)을 누르면 닫는다.
    if (event.target === el.modal) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.modal.hidden) closeModal();
  });

  /* ---------------- 제출 ---------------- */
  form.addEventListener('submit', (event) => {
    event.preventDefault();

    // 제출 시점에는 아직 안 건드린 칸도 모두 지적해야 한다.
    Object.keys(touched).forEach((key) => { touched[key] = true; });
    const state = refresh();
    if (!state.ready) {
      const firstBad = form.querySelector('.has-error');
      if (firstBad && typeof firstBad.focus === 'function') firstBad.focus();
      return;
    }

    openModal(state.values);
  });

  el.modalConfirm.addEventListener('click', async () => {
    if (!pending) return;

    const values = pending;
    el.modalConfirm.disabled = true;

    // 어디로도 못 보내더라도 신청자가 적은 내용을 잃지 않도록 먼저 남긴다.
    saveLocally({ ...values, createdAt: new Date().toISOString() });

    // 1) 먼저 서버에 자리를 잡는다.
    //    메일을 먼저 보내면, 이미 찬 시간인데도 예약 메일이 나가버린다.
    //    같은 시간을 두 사람이 동시에 고르는 경우를 끝에서 가려주는 곳은 서버뿐이다.
    setConfirmLabel('<i class="ri-loader-4-line"></i> 시간 확인 중…');
    const held = await holdSlotOnServer(values);

    if (held.taken) {
      // 팝업을 닫지 않는다. 시간만 바꿔 다시 보내면 되는 상황이다.
      showModalError(held.message);
      closeModal();
      await loadTakenSlots();
      el.time.value = '';
      touched.time = true;
      refresh();
      setAlertOnTime(held.message);
      return;
    }

    // 2) 자리를 잡았으면(또는 서버가 확인해줄 수 없으면) 메일을 보낸다.
    setConfirmLabel('<i class="ri-loader-4-line"></i> 보내는 중…');
    const mailed = await sendToFormspree(values);

    // Formspree가 거절한 이유가 입력값이면 팝업을 닫지 않고 고치게 한다.
    if (!mailed.ok && mailed.fieldProblem) {
      showModalError(mailed.message);
      restoreConfirm();
      return;
    }

    closeModal();
    showDone(values, mailed.ok, [mailed.ok ? '' : mailed.message, held.note].filter(Boolean).join(' '));

    // 방금 잡은 자리를 화면에도 반영해 둔다. 바로 또 신청하는 경우를 막는다.
    await loadTakenSlots();
  });

  function setConfirmLabel(html) {
    el.modalConfirm.innerHTML = html;
  }

  // 겹쳐서 돌아왔을 때 시간 칸 아래에 이유를 남긴다.
  function setAlertOnTime(message) {
    if (!el.timeError) return;
    el.timeError.textContent = message;
    el.timeError.hidden = false;
    el.time.classList.add('has-error');
    el.time.focus();
  }

  /* ---------------- 네트워크가 응답하지 않을 때를 위한 제한 시간 ---------------- */
  // 제한이 없으면 응답 없는 요청에 매달려 팝업이 영원히 "보내는 중…"이 된다.
  async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------------- Formspree로 보내기 (예약 알림의 본줄기) ---------------- */
  async function sendToFormspree(values) {
    if (!FORMSPREE_ENDPOINT) {
      return {
        ok: false,
        fieldProblem: false,
        message: '예약 알림 설정이 아직 끝나지 않았어요. '
          + '아래 "예약 내용 복사"로 복사해 010-4127-2581로 보내주시면 확인해 드릴게요.',
      };
    }

    // 받은 메일에서 바로 읽히도록 한국어 항목명으로 보낸다.
    // email 항목은 Formspree가 회신 주소로 알아서 잡아준다.
    const payload = {
      _subject: `[방문 예약] ${values.name} · ${values.visitDate} ${values.visitTime}`,
      email: values.email,
      이름: values.name,
      방문날짜: formatKorean(values.visitDate),
      희망시간: values.visitTime,
      방문목적: values.purpose,
      정보전달동의: '동의함',
      신청시각: `${formatKorean(todayIso())} (한국 시간)`,
      _gotcha: document.getElementById('rsv-gotcha')?.value || '',
    };

    try {
      const response = await fetchWithTimeout(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 이 헤더가 없으면 Formspree가 HTML 페이지로 넘겨버린다.
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      }, 20000);

      if (response.ok) return { ok: true, fieldProblem: false, message: '' };

      const body = await response.json().catch(() => ({}));
      const reasons = Array.isArray(body.errors)
        ? body.errors.map((item) => item.message).filter(Boolean)
        : [];

      // 422는 보낸 값이 문제라는 뜻이라 고쳐서 다시 보낼 수 있다.
      if (response.status === 422) {
        return {
          ok: false,
          fieldProblem: true,
          message: reasons.length
            ? `입력값을 다시 확인해 주세요. (${reasons.join(' / ')})`
            : '입력값을 다시 확인해 주세요.',
        };
      }

      if (response.status === 429) {
        return {
          ok: false,
          fieldProblem: false,
          message: '예약 신청이 한꺼번에 몰려 잠시 접수가 막혔어요. '
            + '조금 뒤에 다시 시도해 주시거나 010-4127-2581로 연락해 주세요.',
        };
      }

      // 원인을 추적할 수 있도록 상태 코드를 문구에 남긴다.
      return {
        ok: false,
        fieldProblem: false,
        message: `예약 알림을 보내지 못했어요. (오류 ${response.status}${
          reasons.length ? `: ${reasons.join(' / ')}` : ''
        }) 아래 "예약 내용 복사"로 복사해 010-4127-2581로 보내주시면 확인해 드릴게요.`,
      };
    } catch (error) {
      const timedOut = error && error.name === 'AbortError';
      return {
        ok: false,
        fieldProblem: false,
        message: timedOut
          ? '응답이 너무 늦어 예약 알림을 보내지 못했어요. 잠시 뒤에 다시 시도해 주시거나, '
            + '아래 "예약 내용 복사"로 복사해 010-4127-2581로 보내주세요.'
          : '네트워크 문제로 예약 알림을 보내지 못했어요. '
            + '아래 "예약 내용 복사"로 복사해 010-4127-2581로 보내주시면 확인해 드릴게요.',
      };
    }
  }

  /* ---------------- 서버에 자리 잡기 ----------------
     겹침을 가려줄 수 있는 곳은 서버뿐이라 메일보다 먼저, 기다려서 호출한다.
     Render 무료 플랜이 잠들어 있으면 깨어나는 데 시간이 걸리므로 제한 시간을
     두고, 확인을 못 받은 경우에는 예약을 막지 않고 넘어간다.
       taken  : 그 시간이 이미 찼다 (팝업을 닫지 않고 고치게 한다)
       note   : 접수는 됐지만 서버에 보관되지 않았을 때의 안내 */
  async function holdSlotOnServer(values) {
    try {
      const response = await fetchWithTimeout('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      }, 30000);

      const payload = await response.json().catch(() => ({}));

      if (response.status === 409) {
        return {
          taken: true,
          message: (payload.errors && payload.errors.visitTime)
            || '그 시간은 이미 예약이 찼어요. 다른 시간을 골라주세요.',
        };
      }

      if (response.status === 201 && payload.saved) {
        return { taken: false, note: '' };
      }

      if (response.ok && payload.saved === false) {
        // 저장소가 없는 호스트. 겹침을 확인해줄 수 없다는 사실을 숨기지 않는다.
        return {
          taken: false,
          note: '지금은 서버에 예약 기록이 보관되지 않아 시간 중복을 확인하지 못했어요. '
            + '겹치는 경우 운영자가 회신으로 조정해 드려요.',
        };
      }

      // 입력값 문제라면 브라우저 검사와 어긋난 것이다. 막지 않고 메일로 넘긴다.
      return { taken: false, note: '' };
    } catch (error) {
      // 서버에 닿지 못했다. 예약 자체를 막지는 않는다.
      return {
        taken: false,
        note: '서버에 연결하지 못해 시간 중복을 확인하지 못했어요. '
          + '겹치는 경우 운영자가 회신으로 조정해 드려요.',
      };
    }
  }

  function restoreConfirm() {
    el.modalConfirm.disabled = false;
    el.modalConfirm.innerHTML = CONFIRM_LABEL;
  }

  function showModalError(message) {
    el.modalError.textContent = message;
    el.modalError.hidden = false;
  }

  /* ---------------- 브라우저 보관 ---------------- */
  function saveLocally(record) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      list.push(record);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(-20)));
    } catch (error) {
      // 시크릿 모드나 저장 차단 환경에서는 그냥 넘어간다.
    }
  }

  /* ---------------- 접수 완료 ---------------- */
  let lastSubmitted = null;

  function showDone(values, mailed, note) {
    lastSubmitted = values;

    fillSummary(el.doneSummary, values);

    // 이메일로 전달되지 않았다면 "접수되었다"고 말하면 안 된다.
    const doneTitle = el.done.querySelector('.rsv-done-title');
    const doneEmoji = el.done.querySelector('.rsv-done-emoji');

    if (mailed) {
      if (doneEmoji) doneEmoji.textContent = '🎉';
      if (doneTitle) doneTitle.textContent = '예약 신청이 접수되었어요!';
      el.doneDesc.textContent = '신청 내용이 운영자에게 전달되었어요. '
        + '적어주신 이메일로 확인 답장을 보내드릴게요.';
    } else {
      if (doneEmoji) doneEmoji.textContent = '🙏';
      if (doneTitle) doneTitle.textContent = '신청 내용을 전달하지 못했어요';
      el.doneDesc.textContent = '적어주신 내용은 아래에 그대로 남아 있어요.';
    }

    if (note) {
      el.doneNote.textContent = note;
      el.doneNote.hidden = false;
    } else {
      el.doneNote.hidden = true;
    }

    form.hidden = true;
    el.done.hidden = false;
    el.done.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  el.copySummary.addEventListener('click', () => {
    if (!lastSubmitted) return;
    const text = summaryText(lastSubmitted);
    navigator.clipboard.writeText(text)
      .then(() => showToast('📋 예약 내용이 복사되었어요!'))
      .catch(() => showToast('📋 복사가 안 되면 내용을 직접 선택해 주세요.'));
  });

  el.again.addEventListener('click', () => {
    form.reset();
    selectedDate = '';
    Object.keys(touched).forEach((key) => { touched[key] = false; });
    el.purposeCount.textContent = `0 / ${MAX_PURPOSE_LENGTH}`;
    viewYear = Number(FIRST_DATE.slice(0, 4));
    viewMonth = Number(FIRST_DATE.slice(5, 7));

    renderCalendar();
    renderPickedDate();
    refresh();

    el.done.hidden = true;
    form.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* ---------------- 예약 현황 불러오기 ----------------
     이미 찬 시간을 (완료)로 막기 위한 값. 못 받아도 예약은 막지 않는다.
     겹침을 끝에서 잡는 쪽은 서버이고, 그때는 409로 알려준다. */
  async function loadTakenSlots() {
    try {
      const response = await fetchWithTimeout('/api/reservations/taken', {
        headers: { Accept: 'application/json' },
      }, 60000);
      if (!response.ok) throw new Error(`현황 응답 오류: ${response.status}`);

      const data = await response.json();
      takenSlots = data && typeof data.taken === 'object' && data.taken ? data.taken : {};

      // 현황이 늦게 도착해도 화면이 그에 맞게 다시 그려져야 한다.
      renderCalendar();
      renderTimeOptions();
      refresh();
      setSlotNote('');
    } catch (error) {
      setSlotNote('지금은 예약 현황을 확인할 수 없어요. 이미 찬 시간을 고르면 접수 단계에서 알려드려요.');
    }
  }

  function setSlotNote(message) {
    if (!el.slotNote) return;
    if (message) {
      el.slotNote.textContent = message;
      el.slotNote.hidden = false;
    } else {
      el.slotNote.textContent = '';
      el.slotNote.hidden = true;
    }
  }

  /* ---------------- 시작 ---------------- */
  renderCalendar();
  renderPickedDate();
  refresh();
  loadTakenSlots();
})();
