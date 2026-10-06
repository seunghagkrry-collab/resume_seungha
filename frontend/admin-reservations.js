/* ==========================================================================
   예약하기 관리 - 로그인, 목록, 처리 상태 변경
   admin.js와 같은 세션·api 규칙을 따른다. 비밀번호는 서버로 보내 검증만 하고
   브라우저에는 남기지 않는다.
   ========================================================================== */

(function initReservationAdmin() {
  // admin-reservations.html의 진단 배너에게 스크립트가 살아 있다고 알린다.
  window.__adminBooted = true;

  const loginView = document.getElementById('login-view');
  const adminView = document.getElementById('admin-view');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password-input');
  const loginAlert = document.getElementById('login-alert');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const reloadBtn = document.getElementById('reload-btn');

  const rowsEl = document.getElementById('rsvadm-rows');
  const summaryEl = document.getElementById('rsvadm-summary');
  const countsEl = document.getElementById('rsvadm-counts');
  const emptyEl = document.getElementById('rsvadm-empty');
  const alertEl = document.getElementById('rsvadm-alert');
  const okEl = document.getElementById('rsvadm-ok');

  // 서버(backend/data/reservationStore.js)와 같은 순서·이름을 쓴다.
  const STATUS_ORDER = ['received', 'confirmed', 'change_requested', 'cancelled'];
  const STATUS_LABELS = {
    received: '접수',
    confirmed: '확정',
    change_requested: '변경 요청',
    cancelled: '취소',
  };
  const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

  let reservations = [];

  /* ---------- 화면 전환 ---------- */

  function showLogin() {
    loginView.hidden = false;
    adminView.hidden = true;
    passwordInput.value = '';
    passwordInput.focus();
  }

  function showAdmin() {
    loginView.hidden = true;
    adminView.hidden = false;
    // 탭을 눌러 들어온 즉시 목록이 보여야 한다.
    loadReservations();
  }

  /* ---------- 안내 문구 ---------- */

  function setAlert(element, message) {
    if (!message) {
      element.hidden = true;
      element.textContent = '';
      return;
    }
    element.textContent = message;
    element.hidden = false;
  }

  let okTimer;
  function flashOk(message) {
    setAlert(okEl, message);
    clearTimeout(okTimer);
    okTimer = setTimeout(() => setAlert(okEl, ''), 2500);
  }

  /* ---------- 서버 호출 ---------- */

  async function api(url, options) {
    // 응답이 오지 않을 때 화면이 멈춘 것처럼 보이지 않도록 제한 시간을 둔다.
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 15000) : null;

    let response;
    try {
      response = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...(controller ? { signal: controller.signal } : {}),
        ...options,
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error('서버 응답이 너무 늦어요. 서버가 켜져 있는지 확인해 주세요.');
      }
      throw new Error('서버에 연결하지 못했어요. 주소가 http://localhost:3000/admin-reservations 인지 확인해 주세요.');
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (response.status === 401 && !url.endsWith('/login')) {
      showLogin();
      throw new Error('세션이 만료되었어요. 다시 로그인해 주세요.');
    }

    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }

    return { ok: response.ok, status: response.status, data };
  }

  /* ---------- 로그인 / 로그아웃 ---------- */

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setAlert(loginAlert, '');

    const password = passwordInput.value;
    if (!password) {
      setAlert(loginAlert, '비밀번호를 입력해 주세요.');
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = '확인 중...';

    try {
      const result = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });

      if (result.ok) {
        passwordInput.value = '';
        showAdmin();
      } else {
        setAlert(loginAlert, result.data.error || '로그인하지 못했어요.');
      }
    } catch (error) {
      setAlert(loginAlert, error.message || '서버에 연결하지 못했어요.');
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = '로그인';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try {
      await api('/api/admin/logout', { method: 'POST' });
    } catch (error) {
      // 이미 만료된 경우에도 로그인 화면으로 보낸다.
    }
    reservations = [];
    rowsEl.replaceChildren();
    showLogin();
  });

  reloadBtn.addEventListener('click', () => loadReservations());

  // 관리자 화면끼리의 이동은 로그아웃으로 보지 않는다.
  let leavingToAdminPage = false;
  document.querySelectorAll('[data-admin-nav]').forEach((link) => {
    link.addEventListener('click', () => {
      leavingToAdminPage = true;
    });
  });

  // 창이나 탭을 닫으면 서버 세션을 바로 버린다. (admin.js와 같은 규칙)
  window.addEventListener('pagehide', () => {
    if (adminView.hidden) return;
    if (leavingToAdminPage) return;
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/admin/logout');
    }
  });

  /* ---------- 날짜 표시 ---------- */

  function formatVisitDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return String(iso || '');
    const [year, month, day] = iso.split('-');
    const weekday = WEEKDAY_NAMES[new Date(`${iso}T00:00:00Z`).getUTCDay()];
    return `${year}.${month}.${day} (${weekday})`;
  }

  function formatCreatedAt(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    // 신청이 들어온 시각은 한국 시간으로 보여준다.
    const kst = new Date(parsed.getTime() + 9 * 60 * 60 * 1000);
    const month = String(kst.getUTCMonth() + 1);
    const day = String(kst.getUTCDate());
    const hour = String(kst.getUTCHours()).padStart(2, '0');
    const minute = String(kst.getUTCMinutes()).padStart(2, '0');
    return `${month}/${day} ${hour}:${minute} 신청`;
  }

  /* ---------- 목록 ---------- */

  async function loadReservations() {
    setAlert(alertEl, '');
    summaryEl.textContent = '불러오는 중…';

    try {
      const result = await api('/api/admin/reservations');
      if (!result.ok) {
        summaryEl.textContent = '';
        setAlert(alertEl, result.data.error || '예약 목록을 불러오지 못했어요.');
        return;
      }
      reservations = Array.isArray(result.data.reservations) ? result.data.reservations : [];
      renderTable();
    } catch (error) {
      summaryEl.textContent = '';
      setAlert(alertEl, error.message || '예약 목록을 불러오지 못했어요.');
    }
  }

  function renderCounts() {
    countsEl.replaceChildren();

    STATUS_ORDER.forEach((status) => {
      const total = reservations.filter((item) => item.status === status).length;

      const chip = document.createElement('span');
      chip.className = `rsvadm-count status-${status}`;

      const name = document.createElement('strong');
      name.textContent = STATUS_LABELS[status];

      const number = document.createElement('span');
      number.textContent = `${total}건`;

      chip.append(name, number);
      countsEl.appendChild(chip);
    });
  }

  function renderTable() {
    rowsEl.replaceChildren();

    summaryEl.textContent = reservations.length
      ? `전체 ${reservations.length}건`
      : '';
    emptyEl.hidden = reservations.length > 0;
    renderCounts();

    reservations.forEach((item) => {
      rowsEl.appendChild(buildRow(item));
    });
  }

  function buildRow(item) {
    const row = document.createElement('tr');
    row.dataset.id = item.id;
    if (item.status === 'cancelled') row.classList.add('is-cancelled');

    /* 예약번호 - 이름/이메일 + 방문 희망시간으로 만들어진 값이라
       같은 사람이 다른 시간에 또 신청해도 번호가 겹치지 않는다. */
    const codeCell = document.createElement('td');
    codeCell.className = 'col-code';
    const seq = document.createElement('span');
    seq.className = 'rsvadm-seq';
    seq.textContent = `#${item.seq}`;

    const codeText = document.createElement('strong');
    codeText.className = 'rsvadm-code';
    codeText.textContent = item.code || '';

    codeCell.append(seq, codeText);

    /* 신청자 / 이메일 */
    const whoCell = document.createElement('td');
    whoCell.className = 'col-who';
    const whoName = document.createElement('strong');
    whoName.className = 'rsvadm-name';
    whoName.textContent = item.name || '';
    const whoMail = document.createElement('a');
    whoMail.className = 'rsvadm-email';
    whoMail.href = `mailto:${item.email || ''}`;
    whoMail.textContent = item.email || '';
    const whoWhen = document.createElement('span');
    whoWhen.className = 'rsvadm-created';
    whoWhen.textContent = formatCreatedAt(item.createdAt);
    whoCell.append(whoName, whoMail, whoWhen);

    /* 방문 희망 시간 */
    const whenCell = document.createElement('td');
    whenCell.className = 'col-when';
    const whenDate = document.createElement('strong');
    whenDate.className = 'rsvadm-date';
    whenDate.textContent = formatVisitDate(item.visitDate);
    const whenTime = document.createElement('span');
    whenTime.className = 'rsvadm-time';
    whenTime.textContent = item.visitTime || '';
    whenCell.append(whenDate, whenTime);

    /* 방문 목적 */
    const purposeCell = document.createElement('td');
    purposeCell.className = 'col-purpose';
    const purpose = document.createElement('p');
    purpose.className = 'rsvadm-purpose';
    purpose.textContent = item.purpose || '';
    purposeCell.appendChild(purpose);

    /* 처리 상태 */
    const statusCell = document.createElement('td');
    statusCell.className = 'col-status';
    const badge = document.createElement('span');
    badge.className = `rsvadm-badge status-${item.status}`;
    badge.textContent = item.statusLabel || STATUS_LABELS[item.status] || item.status;
    statusCell.appendChild(badge);

    /* 관리 - 네 가지 상태를 눌러서 고른다 */
    const manageCell = document.createElement('td');
    manageCell.className = 'col-manage';
    const group = document.createElement('div');
    group.className = 'rsvadm-actions';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', `${item.code} 처리 상태 선택`);

    STATUS_ORDER.forEach((status) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `rsvadm-action status-${status}`;
      button.textContent = STATUS_LABELS[status];
      button.dataset.status = status;

      if (item.status === status) {
        // 지금 상태인 버튼은 눌러도 바뀔 것이 없다.
        button.classList.add('is-active');
        button.disabled = true;
        button.setAttribute('aria-pressed', 'true');
      } else {
        button.setAttribute('aria-pressed', 'false');
      }

      button.addEventListener('click', () => changeStatus(item, status, group));
      group.appendChild(button);
    });

    manageCell.appendChild(group);

    row.append(codeCell, whoCell, whenCell, purposeCell, statusCell, manageCell);
    return row;
  }

  /* ---------- 처리 상태 변경 ---------- */

  async function changeStatus(item, status, group) {
    setAlert(alertEl, '');

    const buttons = Array.from(group.querySelectorAll('button'));
    buttons.forEach((button) => { button.disabled = true; });

    try {
      const result = await api(`/api/admin/reservations/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });

      if (!result.ok) {
        setAlert(alertEl, result.data.error || '처리 상태를 바꾸지 못했어요.');
        renderTable(); // 버튼 상태를 원래대로 돌린다.
        return;
      }

      // 서버가 돌려준 값으로 갈아끼운다. 화면만 고치면 실제와 어긋날 수 있다.
      const updated = result.data.reservation;
      const index = reservations.findIndex((row) => row.id === item.id);
      if (index !== -1) {
        reservations[index] = { ...reservations[index], ...updated };
      }

      renderTable();
      flashOk(`${updated.code} → ${STATUS_LABELS[status]}(으)로 바꿨어요.`);
    } catch (error) {
      setAlert(alertEl, error.message || '처리 상태를 바꾸지 못했어요.');
      renderTable();
    }
  }

  /* ---------- 읽기 전용 주소 안내 ---------- */

  function lockOutAdmin(reason) {
    setAlert(loginAlert, reason);
    passwordInput.disabled = true;
    loginBtn.disabled = true;
    loginBtn.textContent = '이 주소에서는 사용할 수 없어요';
  }

  /* ---------- 시작 ---------- */

  (async function start() {
    try {
      const result = await api('/api/admin/session');
      if (result.data.authenticated) {
        showAdmin();
        return;
      }
      showLogin();
      if (result.data.adminAvailable === false) {
        lockOutAdmin(result.data.reason || '이 주소에서는 관리자 기능을 쓸 수 없어요.');
      }
      return;
    } catch (error) {
      // 연결 실패 시에도 로그인 화면을 보여준다.
    }
    showLogin();
  })();
})();
