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
