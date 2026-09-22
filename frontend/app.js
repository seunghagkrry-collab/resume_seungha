/* ==========================================================================
   Choi Seung-ha Portfolio - Cute & Cozy Interactive Script
   ========================================================================== */

function copyPhone() {
  const phone = '010-4127-2581';
  navigator.clipboard.writeText(phone).then(() => {
    showCuteToast(`📞 최승하 학생의 전화번호(${phone})가 복사되었어요!`);
  }).catch(() => {
    showCuteToast(`📞 전화번호: ${phone}`);
  });
}

function copyAddress() {
  const address = '천안시 동남구 상명대길31';
  navigator.clipboard.writeText(address).then(() => {
    showCuteToast(`📍 상명대학교 주소(${address})가 복사되었어요!`);
  }).catch(() => {
    showCuteToast(`📍 주소: ${address}`);
  });
}

let toastTimer;
function showCuteToast(msg) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-msg');
  if (!toast || !toastMsg) return;

  toastMsg.textContent = msg;
  toast.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}


/* ==========================================================================
   Projects - API 데이터 렌더링 & 분야별 필터 & 카드 접기/펼치기
   ========================================================================== */
(function initProjects() {
  const grid = document.getElementById('project-grid');
  if (!grid) return;

  const chips = Array.from(document.querySelectorAll('.filter-chip'));
  const countText = document.getElementById('project-count');
  const emptyMsg = document.getElementById('project-empty');
  const statusMsg = document.getElementById('project-status');

  // API 응답으로 카드를 그린 뒤에 다시 채운다.
  let cards = [];
  let activeCategory = '전체';

  function setStatus(emoji, message) {
    if (!statusMsg) return;
    const icon = statusMsg.querySelector('.empty-emoji');
    if (icon) icon.textContent = emoji;
    // 이모지 노드는 그대로 두고 안내 문구만 바꾼다.
    while (statusMsg.lastChild && statusMsg.lastChild !== icon) {
      statusMsg.removeChild(statusMsg.lastChild);
    }
    statusMsg.appendChild(document.createTextNode(' ' + message));
    statusMsg.hidden = false;
  }

  function clearStatus() {
    if (statusMsg) statusMsg.hidden = true;
  }

  function applyFilter(category) {
    activeCategory = category;
    let shown = 0;

    cards.forEach((card) => {
      const match = category === '전체' || card.dataset.category === category;
      card.hidden = !match;
      if (match) shown += 1;
    });

    chips.forEach((chip) => {
      const isActive = chip.dataset.filter === category;
      chip.classList.toggle('is-active', isActive);
      chip.setAttribute('aria-pressed', String(isActive));
    });

    countText.textContent = `프로젝트 ${shown}개`;
    emptyMsg.hidden = shown !== 0;
    grid.hidden = shown === 0;
  }

  function externalLink(url, className) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = className;
    return link;
  }

  function icon(className) {
    const i = document.createElement('i');
    i.className = className;
    return i;
  }

  function detailRow(label, value) {
    const row = document.createElement('div');
    row.className = 'p-detail-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'p-detail-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'p-detail-value';
    valueEl.textContent = value;

    row.append(labelEl, valueEl);
    return row;
  }

  // API 값은 textContent로만 넣는다. innerHTML 연결은 하지 않는다.
  function createCard(project) {
    const card = document.createElement('article');
    card.className = 'project-card';
    card.dataset.category = project.category || '';

    const category = document.createElement('span');
    category.className = 'p-category-label';
    category.textContent = project.category || '';

    const title = document.createElement('h3');
    title.className = 'p-card-title';
    if (project.linkUrl) {
      const titleLink = externalLink(project.linkUrl, 'p-title-link');
      titleLink.append(
        document.createTextNode((project.title || '') + ' '),
        icon('ri-external-link-line title-ext-icon')
      );
      title.appendChild(titleLink);
    } else {
      title.textContent = project.title || '';
    }

    const desc = document.createElement('p');
    desc.className = 'p-card-desc';
    desc.textContent = project.description || '';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'p-toggle-btn';
    toggleBtn.setAttribute('aria-expanded', 'false');

    const toggleLabel = document.createElement('span');
    toggleLabel.className = 'toggle-label';
    toggleLabel.textContent = '자세히 보기';
    toggleBtn.append(toggleLabel, icon('ri-arrow-down-s-line toggle-arrow'));

    const detail = document.createElement('div');
    detail.className = 'p-detail-box';
    detail.hidden = true;
    detail.appendChild(detailRow('내 역할', project.role || ''));
    // 관리자 페이지에서 비워둘 수 있는 항목은 값이 있을 때만 줄을 만든다.
    if (project.result) detail.appendChild(detailRow('확인된 결과', project.result));
    if (project.date) detail.appendChild(detailRow('진행 날짜', project.date));
    if (project.teamSize) detail.appendChild(detailRow('참여인원', `${project.teamSize}명`));
    if (project.notes) detail.appendChild(detailRow('참고사항', project.notes));

    // 누른 카드 하나만 펼치고 접는다. 다른 카드는 그대로 둔다.
    toggleBtn.addEventListener('click', () => {
      const willOpen = toggleBtn.getAttribute('aria-expanded') === 'false';
      toggleBtn.setAttribute('aria-expanded', String(willOpen));
      detail.hidden = !willOpen;
      toggleLabel.textContent = willOpen ? '접기' : '자세히 보기';
    });

    card.append(category, title, desc, toggleBtn, detail);

    if (project.linkUrl) {
      const bottomLink = externalLink(project.linkUrl, 'p-link');
      bottomLink.append(
        document.createTextNode((project.linkLabel || '링크 열기') + ' '),
        icon('ri-external-link-line')
      );
      card.appendChild(bottomLink);
    }

    return card;
  }

  function renderProjects(projects) {
    grid.textContent = '';
    projects.forEach((project) => grid.appendChild(createCard(project)));
    // PDF 생성기가 렌더된 카드를 읽으므로 필터보다 먼저 DOM에 넣는다.
    cards = Array.from(grid.querySelectorAll('.project-card'));
    applyFilter(activeCategory);
  }

  chips.forEach((chip) => {
    chip.addEventListener('click', () => applyFilter(chip.dataset.filter));
  });

  function loadProjects() {
    setStatus('⏳', '프로젝트를 불러오는 중이에요.');
    grid.hidden = true;
    emptyMsg.hidden = true;
    countText.textContent = '프로젝트를 불러오는 중';

    fetch('/api/portfolio')
      .then((response) => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then((data) => {
        const projects = data && Array.isArray(data.projects) ? data.projects : [];
        clearStatus();
        renderProjects(projects);
      })
      .catch(() => {
        setStatus('🌧️', '프로젝트를 불러오지 못했어요. 잠시 후 새로고침해 주세요.');
        grid.hidden = true;
        emptyMsg.hidden = true;
        countText.textContent = '프로젝트 0개';
      });
  }

  loadProjects();
})();


/* ==========================================================================
   공유하기 - 링크 공유 & 구조화된 PDF 문서 추출
   ========================================================================== */
(function initShareMenu() {
  const toggle = document.getElementById('share-toggle');
  const dropdown = document.getElementById('share-dropdown');
  const linkBtn = document.getElementById('share-link-btn');
  const pdfBtn = document.getElementById('share-pdf-btn');
  const pdfDoc = document.getElementById('pdf-doc');
  if (!toggle || !dropdown || !pdfDoc) return;

  /* ---------- 드롭다운 열고 닫기 ---------- */
  function setOpen(open) {
    dropdown.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('is-open', open);
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(dropdown.hidden);
  });

  document.addEventListener('click', (e) => {
    if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== toggle) {
      setOpen(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dropdown.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });

  /* ---------- 링크 공유 ---------- */
  linkBtn.addEventListener('click', async () => {
    setOpen(false);
    const url = window.location.href;
    const title = '상명대학교 그린스마트시티학과 최승하 포트폴리오';

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // 사용자가 공유창을 닫은 경우
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      showCuteToast('🔗 페이지 주소가 복사되었어요! 붙여넣기로 공유해보세요.');
    } catch (err) {
      showCuteToast('🔗 페이지 주소: ' + url);
    }
  });

  /* ---------- 페이지에서 핵심 내용만 뽑아내기 ---------- */
  function text(sel, root) {
    const el = (root || document).querySelector(sel);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function collectProfile() {
    const fields = {};
    document.querySelectorAll('#id-card .id-field').forEach((row) => {
      const label = text('.f-label', row).replace(/\s+/g, '');
      const value = text('.f-value', row);
      if (label) fields[label] = value;
    });
    return {
      name: text('.profile-name').replace(/\s+/g, ''),
      dept: fields['소속'] || text('.profile-dept'),
      studentId: fields['학번'] || text('.profile-id-tag').replace(/[^0-9]/g, ''),
      phone: fields['연락처'] || '',
      campus: fields['캠퍼스'] || '',
      address: text('.map-addr-text'),
    };
  }

  function collectIntro() {
    return Array.from(document.querySelectorAll('.story-explanation .story-p'))
      .map((p) => p.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function collectMajors() {
    return Array.from(document.querySelectorAll('.major-detail-card')).map((card) => ({
      tag: text('.card-tag', card),
      title: text('h3', card),
      intro: text('.card-intro-p', card),
      points: Array.from(card.querySelectorAll('.card-detail-box li')).map((li) =>
        li.textContent.replace(/\s+/g, ' ').trim()
      ),
    }));
  }

  function collectProjects() {
    return Array.from(document.querySelectorAll('.project-card')).map((card) => {
      const rows = card.querySelectorAll('.p-detail-row');
      const link = card.querySelector('.p-link');
      return {
        category: text('.p-category-label', card),
        title: text('.p-title-link', card) || text('.p-card-title', card),
        desc: text('.p-card-desc', card),
        role: rows[0] ? text('.p-detail-value', rows[0]) : '',
        result: rows[1] ? text('.p-detail-value', rows[1]) : '',
        linkUrl: link ? link.href : '',
      };
    });
  }

  function collectProgram() {
    return Array.from(document.querySelectorAll('.board-item')).map((item) => ({
      label: text('.b-label', item),
      value: text('.b-val', item),
      note: text('.b-subtext', item),
    }));
  }

  /* ---------- 뽑아낸 내용을 문서 형태로 조립 ---------- */
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

  function esc(value) {
    return String(value).replace(/[&<>"]/g, (c) => ESCAPES[c]);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function buildDocument() {
    const p = collectProfile();
    const intro = collectIntro();
    const majors = collectMajors();
    const projects = collectProjects();
    const program = collectProgram();

    const today = new Date();
    const printedOn = today.getFullYear() + '. ' + pad2(today.getMonth() + 1) + '. ' + pad2(today.getDate());

    const parts = [];
    let no = 0;

    parts.push(
      '<header class="pdf-head">' +
        '<p class="pdf-kicker">상명대학교 포트폴리오</p>' +
        '<h1 class="pdf-name">' + esc(p.name) + '</h1>' +
        '<p class="pdf-role">' + esc(p.dept) + '</p>' +
        '<table class="pdf-meta"><tbody>' +
          '<tr><th>학번</th><td>' + esc(p.studentId) + '</td><th>연락처</th><td>' + esc(p.phone) + '</td></tr>' +
          '<tr><th>캠퍼스</th><td>' + esc(p.campus) + '</td><th>소재지</th><td>' + esc(p.address) + '</td></tr>' +
        '</tbody></table>' +
      '</header>'
    );

    if (intro.length) {
      no += 1;
      parts.push(
        '<section class="pdf-section">' +
          '<h2 class="pdf-h2">' + no + '. 소개</h2>' +
          intro.map((t) => '<p class="pdf-p">' + esc(t) + '</p>').join('') +
        '</section>'
      );
    }

    if (majors.length) {
      no += 1;
      parts.push(
        '<section class="pdf-section">' +
          '<h2 class="pdf-h2">' + no + '. 전공 학습 분야</h2>' +
          majors.map((m) =>
            '<div class="pdf-block">' +
              '<h3 class="pdf-h3">' + esc(m.title) + '<span class="pdf-tag">' + esc(m.tag) + '</span></h3>' +
              '<p class="pdf-p">' + esc(m.intro) + '</p>' +
              (m.points.length
                ? '<ul class="pdf-list">' + m.points.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>'
                : '') +
            '</div>'
          ).join('') +
        '</section>'
      );
    }

    if (projects.length) {
      no += 1;
      const refs = projects.filter((pr) => pr.linkUrl && pr.linkUrl.indexOf('#') !== pr.linkUrl.length - 1);
      parts.push(
        '<section class="pdf-section">' +
          '<h2 class="pdf-h2">' + no + '. 프로젝트<span class="pdf-count">총 ' + projects.length + '건</span></h2>' +
          '<table class="pdf-table"><thead><tr>' +
            '<th style="width:12%">분야</th>' +
            '<th style="width:28%">프로젝트</th>' +
            '<th style="width:24%">내 역할</th>' +
            '<th style="width:36%">확인된 결과</th>' +
          '</tr></thead><tbody>' +
          projects.map((pr) =>
            '<tr>' +
              '<td>' + esc(pr.category) + '</td>' +
              '<td><strong>' + esc(pr.title) + '</strong><br><span class="pdf-sub">' + esc(pr.desc) + '</span></td>' +
              '<td>' + esc(pr.role) + '</td>' +
              '<td>' + esc(pr.result) + '</td>' +
            '</tr>'
          ).join('') +
          '</tbody></table>' +
          (refs.length
            ? '<div class="pdf-refs"><p class="pdf-refs-title">관련 자료</p><ul class="pdf-list">' +
              refs.map((pr) => '<li>' + esc(pr.title) + ' — ' + esc(pr.linkUrl) + '</li>').join('') +
              '</ul></div>'
            : '') +
        '</section>'
      );
    }

    if (program.length) {
      no += 1;
      parts.push(
        '<section class="pdf-section">' +
          '<h2 class="pdf-h2">' + no + '. 선도대학 프로젝트</h2>' +
          '<table class="pdf-table"><tbody>' +
          program.map((it) =>
            '<tr>' +
              '<th style="width:26%">' + esc(it.label) + '</th>' +
              '<td><strong>' + esc(it.value) + '</strong><br><span class="pdf-sub">' + esc(it.note) + '</span></td>' +
            '</tr>'
          ).join('') +
          '</tbody></table>' +
        '</section>'
      );
    }

    parts.push(
      '<footer class="pdf-foot">' +
        '<span>' + esc(p.name) + ' · ' + esc(p.dept) + ' · ' + esc(p.studentId) + '</span>' +
        '<span>출력일 ' + printedOn + '</span>' +
      '</footer>'
    );

    pdfDoc.innerHTML = parts.join('');
  }

  /* ---------- PDF 공유 ---------- */
  pdfBtn.addEventListener('click', () => {
    setOpen(false);
    buildDocument();
    showCuteToast('📄 인쇄 창에서 대상을 "PDF로 저장"으로 선택해 주세요!');
    setTimeout(() => window.print(), 400);
  });

  // 문서 제목이 PDF 기본 파일 이름이 되므로 인쇄 동안만 바꿔 둔다.
  const originalTitle = document.title;
  window.addEventListener('beforeprint', () => {
    if (!pdfDoc.innerHTML) buildDocument();
    const p = collectProfile();
    document.title = p.name + '_포트폴리오';
  });
  window.addEventListener('afterprint', () => {
    document.title = originalTitle;
  });
})();
