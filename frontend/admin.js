/* ==========================================================================
   프로젝트 관리자 - 로그인, 목록, 저장/수정/삭제
   비밀번호는 서버로 보내 검증만 하고, 브라우저에는 저장하지 않는다.
   ========================================================================== */

(function initAdmin() {
  // admin.html의 진단 배너에게 스크립트가 살아 있다고 알린다.
  window.__adminBooted = true;

  const loginView = document.getElementById('login-view');
  const adminView = document.getElementById('admin-view');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password-input');
  const loginAlert = document.getElementById('login-alert');
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');

  const listEl = document.getElementById('project-list');
  const listSummary = document.getElementById('list-summary');
  const newBtn = document.getElementById('new-btn');

  const form = document.getElementById('project-form');
  const formTitle = document.getElementById('form-title');
  const formBadge = document.getElementById('form-badge');
  const formAlert = document.getElementById('form-alert');
  const formOk = document.getElementById('form-ok');
  const saveBtn = document.getElementById('save-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const deleteBtn = document.getElementById('delete-btn');

  const FIELDS = [
    'title', 'role', 'description', 'date', 'teamSize',
    'notes', 'category', 'result', 'linkUrl', 'linkLabel',
  ];

  // 공개하려면 참고사항을 뺀 칸이 모두 필요하다. 서버에서도 같은 규칙으로 다시 검사한다.
  const PUBLISH_REQUIRED = [
    ['title', '제목을'],
    ['role', '내가 한 역할을'],
    ['description', '설명을'],
    ['date', '날짜를'],
    ['teamSize', '참여인원 수를'],
    ['category', '분야를'],
  ];

  const dupPanel = document.getElementById('dup-panel');

  // 통합할 때 옮겨 담을 항목들
  const MERGE_FIELDS = [
    'title', 'role', 'description', 'date', 'teamSize',
    'notes', 'category', 'result', 'linkUrl', 'linkLabel',
  ];

  let projects = [];
  let editingId = null;

  /* ---------- 중복 확인 ---------- */

  // 띄어쓰기와 대소문자만 무시하고 제목이 같으면 중복으로 본다.
  function normalizeTitle(title) {
    return (title || '').trim().replace(/\s+/g, '').toLowerCase();
  }

  function isEmpty(value) {
    return value === '' || value === null || value === undefined;
  }

  function findDuplicateGroups(list) {
    const groups = new Map();

    list.forEach((project) => {
      const key = normalizeTitle(project.title);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(project);
    });

    return Array.from(groups.values()).filter((group) => group.length > 1);
  }

  // 내용이 가장 많이 채워진 항목을 남기고, 빈칸만 나머지에서 가져온다.
  function buildMerged(group) {
    const filledCount = (project) =>
      MERGE_FIELDS.filter((field) => !isEmpty(project[field])).length;

    const sorted = group.slice().sort((a, b) => {
      const diff = filledCount(b) - filledCount(a);
      return diff !== 0 ? diff : String(b.updatedAt).localeCompare(String(a.updatedAt));
    });

    const merged = Object.assign({}, sorted[0]);
    sorted.slice(1).forEach((other) => {
      MERGE_FIELDS.forEach((field) => {
        if (isEmpty(merged[field]) && !isEmpty(other[field])) merged[field] = other[field];
      });
      if (other.status === 'published') merged.status = 'published';
    });

    // 합쳐도 필수 칸이 비면 공개할 수 없으므로 초안으로 되돌린다.
    if (merged.status === 'published') {
      const missing = PUBLISH_REQUIRED.some(([field]) => isEmpty(merged[field]));
      if (missing) merged.status = 'draft';
    }

    return { merged, removeIds: sorted.slice(1).map((project) => project.id) };
  }

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
    loadProjects();
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

  function clearFormMessages() {
    setAlert(formAlert, '');
    setAlert(formOk, '');
    FIELDS.forEach((name) => {
      const input = document.getElementById(`f-${name}`);
      if (input) input.classList.remove('is-invalid');
    });
  }

  /* ---------- 통신 ---------- */

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
      throw new Error('서버에 연결하지 못했어요. 주소가 http://localhost:3000/admin 인지 확인해 주세요.');
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

  /* ---------- 로그인 ---------- */

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
    projects = [];
    editingId = null;
    showLogin();
  });

  /* ---------- 목록 ---------- */

  function missingForPublish(project) {
    return PUBLISH_REQUIRED.filter(([field]) => {
      const value = project[field];
      return value === '' || value === null || value === undefined;
    });
  }

  async function mergeDuplicates(group) {
    const { merged, removeIds } = buildMerged(group);
    const label = merged.title || '제목 없음';

    const question =
      `"${label}" ${group.length}건을 하나로 합칠까요?\n` +
      `내용이 가장 많은 항목에 빈칸만 채우고, 나머지 ${removeIds.length}건은 삭제돼요.` +
      (merged.status === 'draft' && group.some((p) => p.status === 'published')
        ? '\n필수 칸이 비어 있어서 초안으로 저장돼요.'
        : '');

    if (!window.confirm(question)) return;

    try {
      const payload = {};
      MERGE_FIELDS.forEach((field) => { payload[field] = merged[field]; });
      payload.status = merged.status;

      const saved = await api(`/api/admin/projects/${merged.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (!saved.ok) {
        setAlert(formAlert, (saved.data.errors || [saved.data.error]).join('\n'));
        return;
      }

      for (const id of removeIds) {
        await api(`/api/admin/projects/${id}`, { method: 'DELETE' });
      }

      await loadProjects();
      selectProject(merged.id);
      setAlert(formOk, `"${label}" ${group.length}건을 하나로 합쳤어요.`);
    } catch (error) {
      setAlert(formAlert, error.message || '합치지 못했어요.');
    }
  }

  function renderDuplicates() {
    const groups = findDuplicateGroups(projects);
    dupPanel.textContent = '';

    if (!groups.length) {
      dupPanel.hidden = true;
      return;
    }

    dupPanel.hidden = false;

    const heading = document.createElement('p');
    heading.className = 'dup-heading';
    heading.textContent = `⚠️ 제목이 겹치는 프로젝트가 ${groups.length}건 있어요.`;
    dupPanel.appendChild(heading);

    groups.forEach((group) => {
      const row = document.createElement('div');
      row.className = 'dup-row';

      const text = document.createElement('span');
      text.className = 'dup-text';
      text.textContent = `"${group[0].title}" ${group.length}건`;

      const mergeBtn = document.createElement('button');
      mergeBtn.type = 'button';
      mergeBtn.className = 'btn btn-primary btn-small';
      mergeBtn.textContent = '하나로 합치기';
      mergeBtn.addEventListener('click', () => mergeDuplicates(group));

      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'btn btn-ghost btn-small';
      viewBtn.textContent = '직접 고르기';
      viewBtn.addEventListener('click', () => selectProject(group[0].id));

      row.append(text, mergeBtn, viewBtn);
      dupPanel.appendChild(row);
    });
  }

  function renderList() {
    renderDuplicates();
    listEl.textContent = '';

    if (!projects.length) {
      const empty = document.createElement('li');
      empty.className = 'list-empty';
      empty.textContent = '아직 프로젝트가 없어요. "+ 새 프로젝트"를 눌러 만들어 보세요.';
      listEl.appendChild(empty);
      listSummary.textContent = '프로젝트 0개';
      return;
    }

    const publishedCount = projects.filter((p) => p.status === 'published').length;
    listSummary.textContent =
      `전체 ${projects.length}개 · 공개 ${publishedCount}개 · 초안 ${projects.length - publishedCount}개`;

    projects.forEach((project) => {
      const item = document.createElement('li');

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'list-item' + (project.id === editingId ? ' is-active' : '');

      const top = document.createElement('div');
      top.className = 'item-top';

      const tag = document.createElement('span');
      const isPublished = project.status === 'published';
      tag.className = 'status-tag ' + (isPublished ? 'is-published' : 'is-draft');
      tag.textContent = isPublished ? '공개' : '초안';

      const title = document.createElement('span');
      title.className = 'item-title';
      title.textContent = project.title || '(제목 없음)';

      top.append(tag, title);

      // 기존에 공개 중이지만 날짜/인원이 비어 있는 항목을 눈에 띄게 표시한다.
      const missing = missingForPublish(project);
      if (isPublished && missing.length) {
        const warn = document.createElement('span');
        warn.className = 'warn-tag';
        warn.textContent = '입력 필요';
        top.appendChild(warn);
      }

      const meta = document.createElement('div');
      meta.className = 'item-meta';
      const parts = [];
      if (project.category) parts.push(project.category);
      if (project.date) parts.push(project.date);
      if (project.teamSize) parts.push(`${project.teamSize}명`);
      meta.textContent = parts.length ? parts.join(' · ') : '정보 없음';

      button.append(top, meta);
      button.addEventListener('click', () => selectProject(project.id));

      item.appendChild(button);
      listEl.appendChild(item);
    });
  }

  async function loadProjects() {
    listSummary.textContent = '불러오는 중이에요.';
    try {
      const result = await api('/api/admin/projects');
      if (!result.ok) {
        listSummary.textContent = '목록을 불러오지 못했어요.';
        return;
      }
      projects = result.data.projects || [];
      renderList();
    } catch (error) {
      listSummary.textContent = '목록을 불러오지 못했어요.';
    }
  }

  /* ---------- 폼 ---------- */

  function setFieldValue(name, value) {
    const input = document.getElementById(`f-${name}`);
    if (!input) return;
    input.value = value === null || value === undefined ? '' : value;
    // 날짜 칸은 값이 있을 때만 달력 입력으로 바꾼다.
    if (input.dataset.dateInput !== undefined) {
      input.type = input.value ? 'date' : 'text';
    }
  }

  function readForm() {
    const data = {};
    FIELDS.forEach((name) => {
      const input = document.getElementById(`f-${name}`);
      data[name] = input ? input.value.trim() : '';
    });
    data.status = form.querySelector('input[name="status"]:checked').value;
    return data;
  }

  function resetForm() {
    editingId = null;
    FIELDS.forEach((name) => setFieldValue(name, ''));
    form.querySelector('input[name="status"][value="draft"]').checked = true;
    formTitle.textContent = '새 프로젝트';
    formBadge.hidden = true;
    saveBtn.textContent = '저장';
    cancelBtn.hidden = true;
    deleteBtn.hidden = true;
    clearFormMessages();
    renderList();
  }

  function selectProject(id) {
    const project = projects.find((item) => item.id === id);
    if (!project) return;

    editingId = id;
    FIELDS.forEach((name) => setFieldValue(name, project[name]));
    form.querySelector(`input[name="status"][value="${project.status}"]`).checked = true;

    formTitle.textContent = project.title || '(제목 없음)';
    formBadge.hidden = false;
    saveBtn.textContent = '수정 저장';
    cancelBtn.hidden = false;
    deleteBtn.hidden = false;
    clearFormMessages();
    renderList();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function validateBeforeSave(data) {
    if (data.status !== 'published') return [];

    const messages = [];
    PUBLISH_REQUIRED.forEach(([field, label]) => {
      if (!data[field]) {
        messages.push(`${label} 입력해 주세요.`);
        const input = document.getElementById(`f-${field}`);
        if (input) input.classList.add('is-invalid');
      }
    });

    if (messages.length) {
      messages.unshift('공개하려면 참고사항을 뺀 모든 칸이 필요해요.');
    }
    return messages;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFormMessages();

    const data = readForm();
    const localErrors = validateBeforeSave(data);
    if (localErrors.length) {
      setAlert(formAlert, localErrors.join('\n'));
      return;
    }

    // 새로 만들 때만 확인한다. 수정은 자기 자신과 겹치는 게 당연하다.
    const key = normalizeTitle(data.title);
    const clash = key && projects.find((project) => normalizeTitle(project.title) === key);
    if (!editingId && clash) {
      const goAhead = window.confirm(
        `"${clash.title}"와(과) 제목이 같아요.\n그래도 새 프로젝트로 저장할까요?\n` +
        '취소를 누르면 기존 항목을 열어서 수정할 수 있어요.'
      );
      if (!goAhead) {
        selectProject(clash.id);
        return;
      }
    }

    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';

    try {
      const result = editingId
        ? await api(`/api/admin/projects/${editingId}`, { method: 'PUT', body: JSON.stringify(data) })
        : await api('/api/admin/projects', { method: 'POST', body: JSON.stringify(data) });

      if (!result.ok) {
        const errors = result.data.errors || [result.data.error || '저장하지 못했어요.'];
        setAlert(formAlert, errors.join('\n'));
        return;
      }

      const saved = result.data.project;
      await loadProjects();
      selectProject(saved.id);
      setAlert(
        formOk,
        saved.status === 'published'
          ? '저장했어요. 포트폴리오 사이트에 바로 보여요.'
          : '초안으로 저장했어요. 사이트에는 보이지 않아요.'
      );
    } catch (error) {
      setAlert(formAlert, error.message || '저장하지 못했어요.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = editingId ? '수정 저장' : '저장';
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!editingId) return;
    const project = projects.find((item) => item.id === editingId);
    const name = project && project.title ? project.title : '이 프로젝트';
    if (!window.confirm(`"${name}"을(를) 삭제할까요? 되돌릴 수 없어요.`)) return;

    deleteBtn.disabled = true;
    try {
      const result = await api(`/api/admin/projects/${editingId}`, { method: 'DELETE' });
      if (!result.ok) {
        setAlert(formAlert, result.data.error || '삭제하지 못했어요.');
        return;
      }
      resetForm();
      await loadProjects();
      setAlert(formOk, '삭제했어요.');
    } catch (error) {
      setAlert(formAlert, error.message || '삭제하지 못했어요.');
    } finally {
      deleteBtn.disabled = false;
    }
  });

  newBtn.addEventListener('click', resetForm);
  cancelBtn.addEventListener('click', resetForm);

  /* ---------- 날짜 칸: 예시 문구와 달력을 함께 쓰기 위한 처리 ---------- */

  document.querySelectorAll('[data-date-input]').forEach((input) => {
    input.addEventListener('focus', () => {
      input.type = 'date';
      if (typeof input.showPicker === 'function') {
        try {
          input.showPicker();
        } catch (error) {
          // 브라우저가 막으면 기본 동작에 맡긴다.
        }
      }
    });

    input.addEventListener('blur', () => {
      if (!input.value) input.type = 'text';
    });
  });

  /* ---------- 시작 ---------- */

  (async function start() {
    try {
      const result = await api('/api/admin/session');
      if (result.data.authenticated) {
        showAdmin();
        return;
      }
    } catch (error) {
      // 연결 실패 시에도 로그인 화면을 보여준다.
    }
    showLogin();
  })();
})();
