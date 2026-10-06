/* ==========================================================================
   찾아오는 길 페이지 - 지도(Leaflet + OpenStreetMap) & 날씨(Open-Meteo)
   ========================================================================== */

/* 상명대학교 천안캠퍼스(상명대길 31) 좌표.
   OpenStreetMap Nominatim에서 조회한 캠퍼스 중심 좌표를 상수로 박아둔다.
   매 방문마다 지오코딩 API를 때리지 않아도 되고, 외부 API가 죽어도 지도는 뜬다. */
const VISIT_PLACE = {
  lat: 36.833,
  lon: 127.179,
  address: '충청남도 천안시 동남구 상명대길 31',
  building: '상록관 306호',
};

/* --------------------------------------------------------------------------
   토스트 & 주소 복사 (index.html의 동작과 같은 모양을 유지한다)
   -------------------------------------------------------------------------- */
let visitToastTimer;
function showVisitToast(message) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-msg');
  if (!toast || !toastMsg) return;

  toastMsg.textContent = message;
  toast.classList.add('show');

  clearTimeout(visitToastTimer);
  visitToastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

(function initAddressCopy() {
  const button = document.getElementById('visit-copy-address');
  if (!button) return;

  const fullAddress = `${VISIT_PLACE.address} ${VISIT_PLACE.building}`;

  button.addEventListener('click', () => {
    navigator.clipboard.writeText(fullAddress).then(() => {
      showVisitToast(`📍 방문 주소(${fullAddress})가 복사되었어요!`);
    }).catch(() => {
      showVisitToast(`📍 주소: ${fullAddress}`);
    });
  });
})();

/* --------------------------------------------------------------------------
   지도 - Leaflet + OpenStreetMap 타일
   -------------------------------------------------------------------------- */
(function initVisitMap() {
  const mapBox = document.getElementById('visit-leaflet-map');
  const fallback = document.getElementById('visit-map-fallback');
  if (!mapBox) return;

  // CDN이 막히면 L이 없다. 지도 자리를 비워두지 않고 안내 문구로 바꾼다.
  if (typeof L === 'undefined') {
    mapBox.hidden = true;
    if (fallback) fallback.hidden = false;
    return;
  }

  const map = L.map(mapBox, {
    center: [VISIT_PLACE.lat, VISIT_PLACE.lon],
    zoom: 17,
    scrollWheelZoom: false, // 페이지를 스크롤하다가 지도에 갇히지 않게 한다.
  });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자',
  }).addTo(map);

  L.marker([VISIT_PLACE.lat, VISIT_PLACE.lon])
    .addTo(map)
    .bindPopup(`<strong>상명대학교 천안캠퍼스 ${VISIT_PLACE.building}</strong><br>${VISIT_PLACE.address}`)
    .openPopup();

  // 클릭하면 휠 확대를 켜주고, 지도를 벗어나면 다시 끈다.
  map.on('click', () => map.scrollWheelZoom.enable());
  map.on('mouseout', () => map.scrollWheelZoom.disable());
})();

/* --------------------------------------------------------------------------
   날씨 - Open-Meteo (API 키가 필요 없는 공개 API)
   -------------------------------------------------------------------------- */
(function initVisitWeather() {
  const stateEl = document.getElementById('vw-state');
  const emojiEl = document.getElementById('vw-emoji');
  const tempEl = document.getElementById('vw-temp');
  const humidityEl = document.getElementById('vw-humidity');
  const apparentEl = document.getElementById('vw-apparent');
  const updatedEl = document.getElementById('vw-updated');
  if (!stateEl || !tempEl || !humidityEl) return;

  // WMO weather code -> 한국어 설명 + 이모지
  const WEATHER_CODES = {
    0: ['맑음', '☀️'],
    1: ['대체로 맑음', '🌤️'],
    2: ['구름 조금', '⛅'],
    3: ['흐림', '☁️'],
    45: ['안개', '🌫️'],
    48: ['서리 안개', '🌫️'],
    51: ['약한 이슬비', '🌦️'],
    53: ['이슬비', '🌦️'],
    55: ['강한 이슬비', '🌧️'],
    56: ['얼어붙는 이슬비', '🌧️'],
    57: ['강한 얼어붙는 이슬비', '🌧️'],
    61: ['약한 비', '🌦️'],
    63: ['비', '🌧️'],
    65: ['강한 비', '🌧️'],
    66: ['얼어붙는 비', '🌧️'],
    67: ['강한 얼어붙는 비', '🌧️'],
    71: ['약한 눈', '🌨️'],
    73: ['눈', '❄️'],
    75: ['강한 눈', '❄️'],
    77: ['눈날림', '🌨️'],
    80: ['약한 소나기', '🌦️'],
    81: ['소나기', '🌧️'],
    82: ['강한 소나기', '⛈️'],
    85: ['약한 소낙눈', '🌨️'],
    86: ['강한 소낙눈', '❄️'],
    95: ['천둥번개', '⛈️'],
    96: ['천둥번개와 우박', '⛈️'],
    99: ['강한 천둥번개와 우박', '⛈️'],
  };

  const API_URL = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${VISIT_PLACE.lat}&longitude=${VISIT_PLACE.lon}`
    + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code'
    + '&timezone=Asia%2FSeoul';

  function showError(message) {
    if (emojiEl) emojiEl.textContent = '🙏';
    stateEl.textContent = message;
    tempEl.textContent = '—';
    humidityEl.textContent = '—';
    if (apparentEl) apparentEl.textContent = '—';
    if (updatedEl) updatedEl.textContent = '잠시 후 새로고침하면 다시 시도해요.';
  }

  function formatObservedAt(isoText) {
    // Open-Meteo는 timezone=Asia/Seoul일 때 "2026-10-06T13:45" 형태로 돌려준다.
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(isoText));
    if (!match) return '';
    const [, , month, day, hour, minute] = match;
    return `${Number(month)}월 ${Number(day)}일 ${hour}:${minute}`;
  }

  fetch(API_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`날씨 응답 오류: ${response.status}`);
      return response.json();
    })
    .then((data) => {
      const current = data && data.current;
      if (!current || typeof current.temperature_2m !== 'number') {
        throw new Error('날씨 값이 비어 있어요.');
      }

      const [label, emoji] = WEATHER_CODES[current.weather_code] || ['현재 날씨', '🌈'];
      if (emojiEl) emojiEl.textContent = emoji;
      stateEl.textContent = label;

      tempEl.textContent = `${current.temperature_2m.toFixed(1)}°C`;
      humidityEl.textContent = typeof current.relative_humidity_2m === 'number'
        ? `${Math.round(current.relative_humidity_2m)}%`
        : '—';

      if (apparentEl) {
        apparentEl.textContent = typeof current.apparent_temperature === 'number'
          ? `${current.apparent_temperature.toFixed(1)}°C`
          : '—';
      }

      if (updatedEl) {
        const observedAt = formatObservedAt(current.time);
        updatedEl.textContent = observedAt
          ? `🕒 ${observedAt} 관측 기준 (한국 표준시)`
          : '🕒 최근 관측 기준';
      }
    })
    .catch(() => {
      showError('지금은 날씨를 불러오지 못했어요.');
    });
})();
