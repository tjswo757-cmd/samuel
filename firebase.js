import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getDatabase, ref, set, update, get, remove, onValue, onDisconnect, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAyuSWXxP78K-EqqXZZA4BteYi7asJp5Cg",
  authDomain: "samuel-e3e07.firebaseapp.com",
  // ▼ Realtime Database를 만들면 콘솔에 표시되는 주소입니다. 지역이 아시아면 끝부분이 다를 수 있어요(아래 안내 참고).
  databaseURL: "https://samuel-e3e07-default-rtdb.firebaseio.com",
  projectId: "samuel-e3e07",
  storageBucket: "samuel-e3e07.firebasestorage.app",
  messagingSenderId: "642131849305",
  appId: "1:642131849305:web:113675f0af00ad2a034148",
  measurementId: "G-1856KNEGQE"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const provider = new GoogleAuthProvider();

// ===== 앱 스타일 알림/확인 모달 (브라우저 기본 팝업 대체) =====
function ensureDialog(){
  if (document.getElementById('smDlg')) return;
  const ov = document.createElement('div');
  ov.id = 'smDlg'; ov.className = 'nk-overlay';
  ov.innerHTML = '<div class="nk-box">' +
    '<p id="smDlgMsg" style="font-size:1.05em;font-weight:600;white-space:pre-line;line-height:1.55;margin:6px 2px 4px;"></p>' +
    '<div class="nk-btns"><button class="nk-btn ghost" id="smDlgCancel">취소</button><button class="nk-btn primary" id="smDlgOk">확인</button></div>' +
    '</div>';
  document.body.appendChild(ov);
}
let smResolve = null;
function smClose(val){ const ov = document.getElementById('smDlg'); if (ov) ov.classList.remove('show'); if (smResolve){ const r = smResolve; smResolve = null; r(val); } }
function smConfirm(message, opts){
  opts = opts || {};
  if (smResolve) smClose(false);
  ensureDialog();
  const ov = document.getElementById('smDlg');
  document.getElementById('smDlgMsg').textContent = String(message);
  const ok = document.getElementById('smDlgOk'), cancel = document.getElementById('smDlgCancel');
  ok.textContent = opts.okText || '확인'; cancel.textContent = opts.cancelText || '취소';
  cancel.style.display = '';
  ov.classList.add('show');
  ok.onclick = () => smClose(true);
  cancel.onclick = () => smClose(false);
  ov.onclick = (e) => { if (e.target === ov) smClose(false); };
  return new Promise(res => { smResolve = res; });
}
function smAlert(message){
  if (smResolve) smClose(true);
  ensureDialog();
  const ov = document.getElementById('smDlg');
  document.getElementById('smDlgMsg').textContent = String(message);
  const ok = document.getElementById('smDlgOk'), cancel = document.getElementById('smDlgCancel');
  ok.textContent = '확인'; cancel.style.display = 'none';
  ov.classList.add('show');
  ok.onclick = () => smClose(true);
  ov.onclick = (e) => { if (e.target === ov) smClose(true); };
  return new Promise(res => { smResolve = res; });
}
window.smAlert = smAlert; window.smConfirm = smConfirm;
window.alert = smAlert; // 모든 기본 alert을 앱 스타일로 교체

// 기기마다 달라야 하는(동기화 제외) 키
const DEVICE_KEYS = new Set(['theme','autoFullscreen','fingerDraw','toolbarVertical','toolbarMinimized','toolbarPos','sidebar_layout','studyZoom']);

let currentUser = null;
let applyingRemote = false;
let uploadTimer = null;
let myNickname = null;
let myCourse = null; // 로그인 시 선택한 본인 과정(1~4)

// localStorage 쓰기를 가로채 변경 시 자동 업로드
const _setItem = Storage.prototype.setItem;
const _removeItem = Storage.prototype.removeItem;
Storage.prototype.setItem = function(k, v){ _setItem.apply(this, arguments); scheduleUpload(k); };
Storage.prototype.removeItem = function(k){ _removeItem.apply(this, arguments); scheduleUpload(k); };

function scheduleUpload(key){
  if (applyingRemote || !currentUser || currentUser.isAnonymous) return;
  if (key && DEVICE_KEYS.has(key)) return;
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(uploadSnapshot, 1200);
}

function buildSnapshot(){
  const obj = {};
  for (let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if (DEVICE_KEYS.has(k)) continue;
    obj[k] = localStorage.getItem(k);
  }
  return obj;
}

async function uploadSnapshot(){
  if (!currentUser || currentUser.isAnonymous) return;
  try {
    // [수정] set은 users/{uid} 노드 전체를 덮어써 nickname·course 필드를 지워버림.
    // update로 store·updatedAt만 갱신해 닉네임/과정이 로그아웃·재로그인 후에도 유지되게 함.
    await update(ref(db, 'users/' + currentUser.uid), { store: buildSnapshot(), updatedAt: serverTimestamp() });
  } catch(e){ console.warn('동기화 업로드 실패', e); }
  publishLeaderboard();
}

// 랭킹에 내 기록 반영
function publishLeaderboard(){
  if (!currentUser || currentUser.isAnonymous || !myNickname) return;
  try {
    const comp = (typeof window.computeCompletion === 'function') ? window.computeCompletion() : { mem: 0 };
    let days = {};
    try { days = (JSON.parse(localStorage.getItem('samuel_stats')) || {}).days || {}; } catch(e){}
    const streak = (typeof window.computeStreak === 'function') ? window.computeStreak(days) : { current: 0, longest: 0 };
    const today = (typeof progressToday === 'function') ? progressToday() : '';
    const dayCount = (typeof window.memorizedToday === 'function') ? window.memorizedToday() : 0;
    set(ref(db, 'leaderboard/' + currentUser.uid), {
      nick: myNickname,
      mem: comp.mem || 0,
      streak: streak.current || 0,
      longest: streak.longest || 0,
      dayCount: dayCount,        // 오늘 외운 구절 수(일간 랭킹용)
      dayDate: today,            // 그 카운트의 날짜 — 다른 날이면 일간 랭킹에서 제외
      updatedAt: serverTimestamp()
    });
  } catch(e){ console.warn('랭킹 업데이트 실패', e); }
}

function applyRemote(store){
  applyingRemote = true;
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if (!DEVICE_KEYS.has(k)) toRemove.push(k); }
    toRemove.forEach(k => _removeItem.call(localStorage, k));
    Object.keys(store || {}).forEach(k => { if (!DEVICE_KEYS.has(k)) _setItem.call(localStorage, k, store[k]); });
  } finally { applyingRemote = false; }
  // 화면 새로고침 없이 진도 패널만 다시 그림
  try { if (typeof window.resetHomeProgressToMyCourse === 'function') window.resetHomeProgressToMyCourse(); else if (typeof window.renderHomeProgress === 'function') window.renderHomeProgress(); } catch(e){}
}

// [신규] 로그아웃 시 이전 계정의 로컬 동기데이터(필기·진도·통계·오답 등)를 비움.
// 기기 설정(DEVICE_KEYS: 테마·툴바 위치 등)은 유지. 원본 removeItem 사용 → 업로드 트리거 방지.
function clearSyncedLocal(){
  clearTimeout(uploadTimer);
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if (k && !DEVICE_KEYS.has(k)) toRemove.push(k); }
  toRemove.forEach(k => _removeItem.call(localStorage, k));
}
window.clearSyncedLocal = clearSyncedLocal;

// 접속자 수(프레즌스) — 리스너는 한 번만, 항상 현재 사용자만 표시
let presenceUid = null;
let connectedListenerSet = false;

function goOnline(){
  if (!presenceUid) return;
  const myStatus = ref(db, 'status/' + presenceUid);
  onDisconnect(myStatus).remove();
  set(myStatus, { online: true, ts: serverTimestamp() });
}

function setupPresence(uid){
  // 이전 사용자(익명 등) 기록 + 예약된 onDisconnect 정리
  if (presenceUid && presenceUid !== uid){
    const old = ref(db, 'status/' + presenceUid);
    try { onDisconnect(old).cancel(); } catch(e){}
    try { remove(old); } catch(e){}
  }
  presenceUid = uid;
  if (!connectedListenerSet){
    connectedListenerSet = true;
    onValue(ref(db, '.info/connected'), (snap) => { if (snap.val() === true) goOnline(); });
  } else {
    goOnline();
  }
}

// 집계 기준: 이 시간 안에 살아있다는 신호(하트비트)가 있어야 접속으로 셈. 하트비트(150초)보다 넉넉하게.
// [비용 최적화] 하트비트를 25초→150초로 늦춰 status 전파(N²) 트래픽을 ~6배 줄임. 정상 종료는 onDisconnect로 즉시 정리되고,
//   이 윈도우/PRUNE은 비정상 종료(크래시) 유령만 처리하므로 넉넉히 잡아도 무방.
const PRESENCE_WINDOW = 210000; // 3.5분 (하트비트 150초보다 길어야 살아있는 사용자가 안 빠짐)
const PRUNE_AGE = 480000;       // 8분 넘게 신호 없는(또는 시간값 없는) 항목은 DB에서 자동 삭제
let countSubscribed = false;
let lastStatusEntries = [];    // 마지막으로 받은 status 목록(시간 경과 재계산용)
let gotStatus = false;         // 첫 데이터 받기 전엔 '–' 유지
// [대규모 비용 최적화 스위치] Cloud Function(functions/index.js)을 배포해 meta/onlineCount를 유지하면 true로 바꾸세요.
//   true면 클라가 전체 status 목록을 구독하지 않고 '숫자 하나'(meta/onlineCount)만 읽음 → N² 트래픽 제거(동시 1000명도 사실상 무료).
//   false(기본)면 기존 방식 그대로. 함수 미배포 상태에서 true로 두면 접속자수가 표시되지 않으니 주의.
const USE_ONLINE_COUNTER = false;
// 시간값 없는 유령 제외 + 최근 신호만 집계
function renderCount(){
  if (!gotStatus) return;
  const now = Date.now();
  let n = 0;
  for (const e of lastStatusEntries){ if (typeof e.ts === 'number' && (now - e.ts) < PRESENCE_WINDOW) n++; }
  const el = document.getElementById('onlineCountNum');
  if (el) el.textContent = n;
}
function subscribeCount(){
  if (countSubscribed) return;
  countSubscribed = true;
  // [대규모 모드] Cloud Function이 유지하는 단일 카운터만 읽음 — 전체 목록 미구독(O(1), N² 트래픽 없음)
  if (USE_ONLINE_COUNTER){
    onValue(ref(db, 'meta/onlineCount'), (snap) => {
      const v = snap.val();
      gotStatus = true;
      const el = document.getElementById('onlineCountNum');
      if (el) el.textContent = (typeof v === 'number') ? Math.max(0, v) : 0;
    }, (err) => {
      countSubscribed = false;
      setTimeout(() => { if (currentUser) subscribeCount(); }, 1500);
    });
    return;
  }
  onValue(ref(db, 'status'), (snap) => {
    const now = Date.now();
    const arr = [], stale = [];
    snap.forEach((child) => {
      const v = child.val() || {};
      arr.push({ ts: v.ts });
      // 시간값 없거나 2분 넘게 신호 없는 = 죽은 표식(유령) → 정리 대상
      if (typeof v.ts !== 'number' || (now - v.ts) > PRUNE_AGE) stale.push(child.key);
    });
    lastStatusEntries = arr;
    gotStatus = true;
    renderCount(); // 누가 들어오거나 나가면(데이터 변화) 즉시 반영 — 실시간
    // 죽은 표식 자동 청소(규칙이 오래된 항목 삭제를 허용). 내 것은 건드리지 않음.
    stale.forEach((k) => { if (k !== presenceUid) { try { remove(ref(db, 'status/' + k)); } catch(e){} } });
  }, (err) => {
    // 아직 인증 전이라 읽기가 거부되면 리스너가 취소됨 → 잠시 뒤 재구독
    countSubscribed = false;
    setTimeout(() => { if (currentUser) subscribeCount(); }, 1500);
  });
}

// 살아있음을 주기적으로 갱신(heartbeat) — 150초(2.5분)마다 [비용 최적화: 25초→150초로 N² 전파 트래픽 ~6배↓]
setInterval(() => { if (presenceUid) goOnline(); }, 150000);
// 데이터 변화가 없어도, 시간이 지나 오래된(끊긴) 항목이 빠지는 것을 실시간 반영(3초마다 재계산)
setInterval(renderCount, 3000);

// ===== 관리자 전용 접속자 디버그 =====
// 관리자 구글 이메일(소문자). 여러 명이면 콤마로 추가: ['a@gmail.com','b@gmail.com']
const ADMIN_EMAILS = ['tjswo757@gmail.com', 'sseonjae757@gmail.com'];
function isAdmin(){
  return !!(currentUser && currentUser.email && ADMIN_EMAILS.includes(currentUser.email.toLowerCase()));
}

async function showAdminPresence(){
  if (!isAdmin()) return; // 관리자만
  let statusSnap = null, lbSnap = null;
  try { statusSnap = await get(ref(db, 'status')); }
  catch(e){ smAlert('status 읽기 실패: ' + (e.message || e)); return; }
  try { lbSnap = await get(ref(db, 'leaderboard')); } catch(e){}
  const nickMap = {};
  if (lbSnap && lbSnap.exists()) lbSnap.forEach(c => { const v = c.val(); if (v && v.nick) nickMap[c.key] = v.nick; });
  const now = Date.now();
  const rows = []; let counted = 0;
  if (statusSnap && statusSnap.exists()){
    statusSnap.forEach(c => {
      const v = c.val() || {};
      const ts = v.ts;
      const hasTs = typeof ts === 'number';
      const isCounted = hasTs && (now - ts) < PRESENCE_WINDOW;
      if (isCounted) counted++;
      rows.push({ nick: nickMap[c.key] || '(익명·기록 없음)', uid: c.key, ageS: hasTs ? Math.round((now - ts) / 1000) : null, hasTs, isCounted });
    });
  }
  rows.sort((a, b) => (a.hasTs ? a.ageS : 1e9) - (b.hasTs ? b.ageS : 1e9));
  let ov = document.getElementById('admOverlay');
  if (!ov){
    ov = document.createElement('div'); ov.id = 'admOverlay'; ov.className = 'sm-overlay';
    ov.innerHTML = "<div class='sm-panel'><div class='sm-head'><h2><svg class='ttl-ico' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M22 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/></svg>접속자 디버그</h2><button class='sm-close' id='admClose'>✕</button></div><div class='sm-body' id='admBody'></div></div>";
    document.body.appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('show'); });
    document.getElementById('admClose').onclick = () => ov.classList.remove('show');
  }
  const list = rows.map((r, i) => {
    const age = r.hasTs ? (r.ageS + '초 전') : '시간값 없음';
    const tag = r.isCounted
      ? "<span class='lb-val' style='color:#27ae60'>집계</span>"
      : "<span class='lb-val' style='color:#e74c3c'>제외</span>";
    return "<div class='lb-row'><div class='lb-rank'>" + (i + 1) + "</div><div class='lb-nick'>" + escapeHtml(r.nick) +
      "<div style='font-size:.72em;color:#9aa6b3;font-weight:600;'>…" + escapeHtml(String(r.uid).slice(-6)) + " · " + age + "</div></div>" + tag + "</div>";
  }).join('') || "<div class='lb-empty'>status에 항목이 없어요.</div>";
  document.getElementById('admBody').innerHTML =
    "<div style='text-align:center;font-weight:800;margin-bottom:12px;'>실제 집계 인원: <span style='color:var(--primary)'>" + counted + "명</span> · 전체 항목 " + rows.length + "개</div>" +
    list + "<button class='g-btn ghost' id='admRefresh' style='margin-top:14px;'>새로고침</button>";
  document.getElementById('admRefresh').onclick = showAdminPresence;
  ov.classList.add('show');
}
window.samuelAdminPresence = showAdminPresence;
// 👥 배지 클릭 → 관리자면 디버그 패널
(function(){ const oc = document.getElementById('homeTogether'); if (oc) oc.addEventListener('click', () => { if (isAdmin()) showAdminPresence(); }); })();

function updateAuthUI(user){
  const btn = document.getElementById('authBtn');
  const wel = document.getElementById('welcomeText');
  const loggedIn = !!(user && !user.isAnonymous);
  if (btn){
    if (loggedIn){
      btn.textContent = myNickname || '내 계정';
      btn.title = (myNickname ? myNickname + ' — ' : '') + '계정 관리';
      btn.classList.add('logged-in');
    } else {
      btn.textContent = '로그인';
      btn.title = '구글 계정으로 로그인';
      btn.classList.remove('logged-in');
    }
  }
  if (wel){
    wel.style.display = loggedIn ? 'inline' : 'none';
  }
  // 관리자면 함께 접속 배너를 눌러 접속자 상세를 볼 수 있게 표시
  const oc = document.getElementById('homeTogether');
  if (oc){ const adm = isAdmin(); oc.style.cursor = adm ? 'pointer' : ''; oc.title = adm ? '접속자 상세 보기(관리자)' : '지금 함께 접속 중인 인원'; }
  // 마이페이지·점수 계산기 등 classic 코드에서 쓰도록 전역 노출
  window.myNickname = loggedIn ? myNickname : null;
  window.myCourse = loggedIn ? myCourse : null;
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user){
    myNickname = null; myCourse = null;
    updateAuthUI(null);
    try { await signInAnonymously(auth); } catch(e){ console.warn('익명 로그인 실패', e); }
    return;
  }
  setupPresence(user.uid);
  subscribeCount(); // 인증된 뒤에 구독해야 status 읽기 권한 통과(새 도메인은 캐시된 세션이 없어 더 중요)
  if (!user.isAnonymous){
    let snap = null;
    try {
      snap = await get(ref(db, 'users/' + user.uid));
      if (snap.exists() && snap.val().store){
        applyRemote(snap.val().store);
      } else {
        await uploadSnapshot(); // 첫 로그인 시 이 기기 데이터를 클라우드에 올림
      }
    } catch(e){ console.warn('동기화 불러오기 실패', e); }
    myNickname = (snap && snap.exists() && snap.val().nickname) ? snap.val().nickname : null;
    const sc = snap && snap.exists() && parseInt(snap.val().course, 10);
    myCourse = [1, 2, 3, 4].includes(sc) ? sc : null;
    updateAuthUI(user);
    if (!myNickname || !myCourse) openNicknameModal(true); // 닉네임·과정 없으면 설정 요구
    else publishLeaderboard();
    try { if (typeof window.resetHomeProgressToMyCourse === 'function') window.resetHomeProgressToMyCourse(); else if (typeof window.renderHomeProgress === 'function') window.renderHomeProgress(); } catch(e){}
  } else {
    updateAuthUI(user);
  }
});

// subscribeCount()는 onAuthStateChanged에서 인증 완료 후 호출함(권한 거부로 리스너가 취소되는 것 방지)

// ---- 닉네임 등록/검증 ----
async function claimNickname(raw){
  const nick = (raw || '').trim();
  if (nick.length < 2 || nick.length > 12) throw '닉네임은 2~12자로 입력해 주세요.';
  if (!/^[가-힣a-zA-Z0-9_]+$/.test(nick)) throw '한글·영문·숫자·_ 만 사용할 수 있어요.';
  const key = nick.toLowerCase();
  const nickRef = ref(db, 'nicknames/' + key);
  const cur = await get(nickRef);
  if (cur.exists() && cur.val() !== currentUser.uid) throw '이미 사용 중인 닉네임이에요. 다른 닉네임을 입력해 주세요.';
  if (myNickname && myNickname.toLowerCase() !== key){
    try { await remove(ref(db, 'nicknames/' + myNickname.toLowerCase())); } catch(e){}
  }
  await set(nickRef, currentUser.uid);
  await set(ref(db, 'users/' + currentUser.uid + '/nickname'), nick);
  myNickname = nick;
}

// ---- 모달 (동적 생성) ----
function ensureModals(){
  if (document.getElementById('nkOverlay')) return;
  const ov = document.createElement('div');
  ov.id = 'nkOverlay'; ov.className = 'nk-overlay';
  ov.innerHTML =
    '<div class="nk-box">' +
      '<div id="nkAccountView" style="display:none;">' +
        '<h3>내 계정</h3>' +
        '<div class="nk-current" id="nkCurrentNick"></div>' +
        '<div class="nk-btns">' +
          '<button class="nk-btn ghost" id="nkChangeBtn">닉네임·과정 변경</button>' +
          '<button class="nk-btn primary" id="nkLogoutBtn" style="background:#e74c3c;">로그아웃</button>' +
        '</div>' +
        '<div class="nk-btns"><button class="nk-btn ghost" id="nkCloseBtn">닫기</button></div>' +
      '</div>' +
      '<div id="nkEditView" style="display:none;">' +
        '<h3 id="nkEditTitle">닉네임 설정</h3>' +
        '<p class="nk-desc">이 사이트에서 사용할 이름이에요. (2~12자, 중복 불가)</p>' +
        '<input type="text" class="nk-input" id="nkInput" placeholder="닉네임 입력" maxlength="12" autocomplete="off">' +
        '<p class="nk-desc" style="margin-top:14px;">현재 진행 중인 과정을 선택하세요.</p>' +
        '<select class="nk-input" id="nkCourse">' + [1,2,3,4].map(c => '<option value="' + c + '">' + c + '과정</option>').join('') + '</select>' +
        '<div class="nk-msg" id="nkMsg"></div>' +
        '<div class="nk-btns">' +
          '<button class="nk-btn ghost" id="nkCancelBtn">취소</button>' +
          '<button class="nk-btn primary" id="nkSaveBtn">확인</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);

  document.getElementById('nkChangeBtn').onclick = () => showEditView(false);
  document.getElementById('nkLogoutBtn').onclick = () => { closeModal(); samuelLogout(); };
  document.getElementById('nkCloseBtn').onclick = closeModal;
  document.getElementById('nkCancelBtn').onclick = closeModal;
  document.getElementById('nkSaveBtn').onclick = saveNickname;
  document.getElementById('nkInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveNickname(); });
}

let nkRequired = false;
function closeModal(){
  if (nkRequired) return; // 첫 설정은 닫기 금지
  const ov = document.getElementById('nkOverlay');
  if (ov) ov.classList.remove('show');
}
function showEditView(required){
  document.getElementById('nkAccountView').style.display = 'none';
  document.getElementById('nkEditView').style.display = 'block';
  document.getElementById('nkEditTitle').textContent = required ? '닉네임을 설정해 주세요' : '닉네임 변경';
  document.getElementById('nkCancelBtn').style.display = required ? 'none' : '';
  const inp = document.getElementById('nkInput');
  inp.value = myNickname || '';
  const csel = document.getElementById('nkCourse');
  if (csel){
    let c = parseInt(myCourse, 10);
    if (![1,2,3,4].includes(c)) c = parseInt(localStorage.getItem('lastCourse'), 10);
    if (![1,2,3,4].includes(c)) c = 1;
    csel.value = String(c);
  }
  document.getElementById('nkMsg').textContent = '';
  setTimeout(() => inp.focus(), 50);
}
function openNicknameModal(required){
  ensureModals();
  nkRequired = !!required;
  document.getElementById('nkOverlay').classList.add('show');
  showEditView(!!required);
}
// [신규] 마이페이지의 '닉네임·과정 변경' 버튼 → 중복확인 되는 기존 편집기(닉네임+과정)를 연다
window.samuelEditProfile = function(){
  if (!currentUser || currentUser.isAnonymous){ alert('로그인 후 변경할 수 있어요.'); return; }
  openNicknameModal(false);
};
function openAccountModal(){
  ensureModals();
  nkRequired = false;
  document.getElementById('nkCurrentNick').textContent = (myNickname ? ('@' + myNickname) : '(닉네임 없음)') + ([1,2,3,4].includes(parseInt(myCourse,10)) ? '  ·  ' + myCourse + '과정' : '');
  document.getElementById('nkAccountView').style.display = 'block';
  document.getElementById('nkEditView').style.display = 'none';
  document.getElementById('nkOverlay').classList.add('show');
}
// [신규] 로그아웃 — 클라우드 저장 후 로컬 정리 & 새로고침(계정 모달·프로필 드롭다운에서 공용)
async function samuelLogout(){
  try { await uploadSnapshot(); } catch(e){}
  try { const pu = presenceUid; if (pu) { onDisconnect(ref(db, 'status/' + pu)).cancel(); presenceUid = null; await remove(ref(db, 'status/' + pu)); } } catch(e){}
  try { await signOut(auth); } catch(e){ alert('로그아웃 실패: ' + (e.message||e)); }
  try { clearSyncedLocal(); } catch(e){}
  location.reload();
}
// [신규] 프로필 드롭다운 — 인물 아이콘(authBtn) 클릭 시: 최상단 닉네임 · 마이페이지 · 로그아웃
function ensureProfileMenu(){
  if (document.getElementById('profileMenu')) return;
  const m = document.createElement('div');
  m.id = 'profileMenu'; m.className = 'profile-menu';
  m.innerHTML =
    '<div class="pm-head"><div class="pm-nick" id="pmNick"></div><div class="pm-sub" id="pmSub"></div></div>' +
    '<button class="pm-item" id="pmMyPage">마이페이지</button>' +
    '<button class="pm-item" id="pmHelp">사용법 다시 보기</button>' +
    '<button class="pm-item pm-logout" id="pmLogout">로그아웃</button>';
  document.body.appendChild(m);
  document.getElementById('pmMyPage').onclick = () => { closeProfileMenu(); if (typeof window.selectRootMode === 'function') window.selectRootMode('stats'); };
  document.getElementById('pmHelp').onclick = () => { closeProfileMenu(); if (typeof window.coachReset === 'function') window.coachReset(); };
  document.getElementById('pmLogout').onclick = () => { closeProfileMenu(); samuelLogout(); };
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('profileMenu');
    if (!menu || menu.style.display !== 'block') return;
    const btn = document.getElementById('authBtn');
    if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
    closeProfileMenu();
  });
}
function closeProfileMenu(){ const m = document.getElementById('profileMenu'); if (m) m.style.display = 'none'; }
function toggleProfileMenu(){
  ensureProfileMenu();
  const m = document.getElementById('profileMenu');
  const btn = document.getElementById('authBtn');
  if (!m || !btn) return;
  if (m.style.display === 'block'){ closeProfileMenu(); return; }
  document.getElementById('pmNick').textContent = myNickname || '내 계정';
  document.getElementById('pmSub').textContent = [1,2,3,4].includes(parseInt(myCourse,10)) ? (myCourse + '과정') : '';
  const r = btn.getBoundingClientRect();
  m.style.display = 'block';
  m.style.top = (r.bottom + 6) + 'px';
  m.style.right = Math.max(8, (window.innerWidth - r.right)) + 'px';
  m.style.left = 'auto';
}
async function saveNickname(){
  const msg = document.getElementById('nkMsg');
  const btn = document.getElementById('nkSaveBtn');
  msg.className = 'nk-msg'; msg.textContent = '확인 중...';
  btn.disabled = true;
  try {
    await claimNickname(document.getElementById('nkInput').value);
    const csel = document.getElementById('nkCourse');
    let c = csel ? parseInt(csel.value, 10) : NaN;
    if (![1,2,3,4].includes(c)) c = 1;
    await set(ref(db, 'users/' + currentUser.uid + '/course'), c);
    myCourse = c;
    try { localStorage.setItem('lastCourse', String(c)); } catch(e){}
    msg.className = 'nk-msg ok'; msg.textContent = '저장되었어요!';
    nkRequired = false;
    updateAuthUI(currentUser);
    publishLeaderboard();
    try { if (typeof window.resetHomeProgressToMyCourse === 'function') window.resetHomeProgressToMyCourse(); else if (typeof window.renderHomeProgress === 'function') window.renderHomeProgress(); } catch(e){}
    setTimeout(() => { const ov = document.getElementById('nkOverlay'); if (ov) ov.classList.remove('show'); }, 600);
  } catch(e){
    msg.className = 'nk-msg err'; msg.textContent = (typeof e === 'string') ? e : ('오류: ' + (e.message||e));
  } finally { btn.disabled = false; }
}

// ===================== 랭킹 =====================
function ensureLeaderboardUI(){
  if (document.getElementById('lbOverlay')) return;
  const ov = document.createElement('div');
  ov.id = 'lbOverlay'; ov.className = 'sm-overlay';
  ov.innerHTML =
    '<div class="sm-panel">' +
      '<div class="sm-head"><h2><svg class="ttl-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>랭킹</h2><button class="sm-close" id="lbClose">✕</button></div>' +
      '<div class="sm-body">' +
        '<div class="lb-tabs">' +
          '<button class="lb-tab active" data-k="daily">오늘 외운 구절</button>' +
          '<button class="lb-tab" data-k="streak">연속 학습일</button>' +
        '</div>' +
        '<div id="lbList"><div class="lb-empty">불러오는 중...</div></div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('show'); });
  document.getElementById('lbClose').onclick = () => ov.classList.remove('show');
  ov.querySelectorAll('.lb-tab').forEach(t => t.onclick = () => {
    ov.querySelectorAll('.lb-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    renderLeaderboard(t.dataset.k);
  });
}
let lbData = [];
async function renderLeaderboard(kind){
  const list = document.getElementById('lbList');
  const today = (typeof progressToday === 'function') ? progressToday() : '';
  const valOf = (r) => kind === 'daily' ? (r.dayDate === today ? (r.dayCount || 0) : 0) : (r[kind] || 0);
  // 최소 1구절(또는 1일) 이상만 등록 — 0은 제외
  const rows = lbData.slice().filter(r => r && r.nick && valOf(r) >= 1)
    .sort((a, b) => valOf(b) - valOf(a) || (b.mem||0) - (a.mem||0));
  if (!rows.length){
    list.innerHTML = '<div class="lb-empty">' +
      (kind === 'daily' ? '오늘은 아직 순위가 없어요.<br>암송 퀴즈를 풀면 오늘의 순위에 올라갑니다 🌱'
                        : '아직 기록이 없어요.<br>암송 퀴즈를 풀면 순위에 올라갑니다 🌱') +
      '</div>'; return;
  }
  const medal = ['🥇','🥈','🥉'];
  const unit = kind === 'streak' ? '일' : '구절';
  list.innerHTML = rows.slice(0, 50).map((r, i) => {
    const me = currentUser && r.uid === currentUser.uid ? ' me' : '';
    const rk = i < 3 ? medal[i] : (i + 1);
    return '<div class="lb-row' + me + '"><div class="lb-rank">' + rk + '</div>' +
      '<div class="lb-nick">' + escapeHtml(r.nick) + (me ? ' (나)' : '') + '</div>' +
      '<div class="lb-val">' + valOf(r) + unit + '</div></div>';
  }).join('');
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

window.samuelOpenLeaderboard = async function(){
  ensureLeaderboardUI();
  document.getElementById('lbOverlay').classList.add('show');
  document.getElementById('lbList').innerHTML = '<div class="lb-empty">불러오는 중...</div>';
  try {
    const snap = await get(ref(db, 'leaderboard'));
    lbData = [];
    if (snap.exists()) snap.forEach(c => { const v = c.val() || {}; v.uid = c.key; lbData.push(v); });
    renderLeaderboard('daily');
  } catch(e){
    document.getElementById('lbList').innerHTML = '<div class="lb-empty">불러오기 실패: ' + (e.message||e) + '</div>';
  }
};

// ===================== 실시간 암송 게임 =====================
const Q_TIME = 120000;    // 문제당 기본 제한시간(ms) = 2분
const REVEAL = 4500;      // 정답 공개 시간(ms)
const Q_COUNT = 5;        // 기본 문제 수(방장이 변경 가능)
const Q_COUNT_OPTS = [3, 5, 7, 10, 15];
const Q_TIME_PRESETS = [60, 90, 120]; // 제한시간 프리셋(초): 1분 / 1분30초 / 2분
const MAX_PLAYERS = 6;

let gameCode = null;
let gameUnsub = null;
let gameRoom = null;
let hostTimer = null;
let scheduledQ = -1;
let earlyQ = -1;
let tickTimer = null;
let myAnsweredQ = -1;
let renderedQ = -1;
let renderedPhase = '';
let iAmLeaving = false; // 내가 직접 나가는 경우 "방이 종료되었어요" 알림 표시 안 함
let roomConnUnsub = null; // .info/connected 구독(모바일 재접속 복구용)
let lastMyScore = 0;      // 재접속 시 점수 복원용 마지막 점수
let lastMyCourse = null;  // 재접속 시 과정 복원용
let gameWasPlaying = false; // playing 진입 감지(전체화면 전환 1회용)
let gameFsArmed = false;    // 참가자 첫 터치에서 전체화면 예약 여부

// 게임 시작 시 전체화면 전환. 방장은 시작 버튼(제스처)으로 즉시,
// 참가자는 시작이 원격이라 제스처가 없을 수 있어 다음 첫 터치에서 전환되도록 예약.
function enterGameFullscreen(){
  try { if (window.enterAppFullscreen) window.enterAppFullscreen(); } catch(e){}
  if (!gameFsArmed){
    gameFsArmed = true;
    const once = () => {
      document.removeEventListener('pointerdown', once);
      try { if (window.enterAppFullscreen && !(window.isFullscreen && window.isFullscreen())) window.enterAppFullscreen(); } catch(e){}
    };
    document.addEventListener('pointerdown', once, { once: true });
  }
}

// 방의 제한시간(ms) — 방장이 설정한 값, 없으면 기본 2분
function qTimeOf(room){ const t = room && room.qTime; return (typeof t === 'number' && t >= 5000) ? t : Q_TIME; }
function fmtQTime(ms){ const s = Math.round(ms / 1000); const m = Math.floor(s / 60), r = s % 60; return (m ? m + '분' : '') + (r ? (m ? ' ' : '') + r + '초' : (m ? '' : '0초')); }

// 띄어쓰기·문장부호 차이는 무시하고 비교
function normAns(s){ return (s || '').replace(/[\s.,·…"'""''’‘`~!?;:()]/g, ''); }

function shuffle(a){ for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function genCode(){ return String(Math.floor(1000 + Math.random() * 9000)); }
// 한 일차에서 특정 과정에 해당하는 구절들(누적식: c <= course)
function versesFor(day, course){
  const bd = window.bibleData || {};
  const seen = new Set(), out = [];
  (bd[day] || []).forEach(it => {
    if (it.c <= course && it.txt && !seen.has(it.v)){ seen.add(it.v); out.push({ v: it.v, t: it.t, txt: it.txt }); }
  });
  return out;
}
// 방 안에서 내 과정(플레이어 노드에 저장된 값 우선, 없으면 프로필 과정)
function myCourseInRoom(room){
  const p = room && room.players && currentUser && room.players[currentUser.uid];
  let c = p && parseInt(p.course, 10);
  if (![1,2,3,4].includes(c)) c = parseInt(window.myCourse, 10);
  if (![1,2,3,4].includes(c)) c = 4;
  return c;
}
// 이번 라운드에서 '내 과정·방장이 고른 일차'에 맞는 구절(seed로 결정 → 같은 과정끼리는 동일)
function myVerseForRound(room){
  const q = room && room.question; if (!q || q.day == null) return null;
  let pool = versesFor(q.day, myCourseInRoom(room));
  if (!pool.length) pool = versesFor(q.day, 4); // 폴백
  if (!pool.length) return null;
  const seed = (typeof q.seed === 'number') ? q.seed : 0;
  return pool[((seed % pool.length) + pool.length) % pool.length];
}
function isHost(room){ return room && currentUser && room.host === currentUser.uid; }

function ensureGameUI(){
  if (document.getElementById('gmOverlay')) return;
  const ov = document.createElement('div');
  ov.id = 'gmOverlay'; ov.className = 'sm-overlay';
  ov.innerHTML =
    '<div class="sm-panel">' +
      '<div class="sm-head"><h2 id="gmTitle">암송 게임</h2><button class="sm-close" id="gmClose">✕</button></div>' +
      '<div class="sm-body" id="gmBody"></div>' +
    '</div>';
  document.body.appendChild(ov);
  document.getElementById('gmClose').onclick = () => closeGame();
}
function gmBody(){ return document.getElementById('gmBody'); }

async function closeGame(){
  if (gameCode){
    const host = isHost(gameRoom);
    const msg = host ? '방을 종료하시겠습니까?' : '게임에서 나가시겠습니까?';
    const ok = await smConfirm(msg, { okText: '예', cancelText: '아니오' });
    if (!ok) return;
    iAmLeaving = true;
  }
  leaveRoom();
  const ov = document.getElementById('gmOverlay');
  if (ov){ ov.classList.remove('show', 'full'); const p = ov.querySelector('.sm-panel'); if (p) p.classList.remove('big', 'wait'); }
}

window.samuelOpenGame = function(){
  if (!currentUser || currentUser.isAnonymous){
    alert('암송 게임은 로그인 후 이용할 수 있어요. 먼저 구글 로그인을 해주세요!');
    return;
  }
  if (!myNickname){ openNicknameModal(true); return; }
  ensureGameUI();
  document.getElementById('gmOverlay').classList.add('show');
  renderLobby();
};

function renderLobby(){
  document.getElementById('gmTitle').textContent = '암송 게임';
  gmBody().innerHTML =
    '<p style="text-align:center;color:#8a96a3;margin:4px 0 18px;">방을 만들어 친구를 초대하거나, 방 코드로 참가하세요. (최대 ' + MAX_PLAYERS + '명)</p>' +
    '<button class="g-btn purple" id="gmCreate">방 만들기</button>' +
    '<div class="g-or">— 또는 —</div>' +
    '<input class="g-code-in" id="gmCodeIn" inputmode="numeric" maxlength="4" placeholder="0000">' +
    '<button class="g-btn primary" id="gmJoin">방 코드로 참가</button>' +
    '<div class="g-msg" id="gmMsg"></div>';
  document.getElementById('gmCreate').onclick = createRoom;
  document.getElementById('gmJoin').onclick = () => joinRoom(document.getElementById('gmCodeIn').value.trim());
}

async function createRoom(){
  const myC = [1,2,3,4].includes(parseInt(window.myCourse,10)) ? parseInt(window.myCourse,10) : 4;
  let code = genCode();
  try {
    // 코드 중복 회피(몇 번 시도)
    for (let i = 0; i < 5; i++){
      const ex = await get(ref(db, 'rooms/' + code));
      if (!ex.exists()) break;
      code = genCode();
    }
    await set(ref(db, 'rooms/' + code), {
      host: currentUser.uid, hostNick: myNickname, state: 'waiting', qCount: Q_COUNT, qTime: Q_TIME,
      qIndex: -1, createdAt: serverTimestamp(),
      players: { [currentUser.uid]: { nick: myNickname, score: 0, course: myC, joinedAt: serverTimestamp() } }
    });
    // 방 전체는 자동 삭제하지 않음(모바일에서 잠깐 홈화면 갔다 와도 방이 유지되도록).
    // 방은 방장이 '나가기/종료'를 직접 누를 때만 삭제됨.
    enterRoom(code);
  } catch(e){ document.getElementById('gmMsg').textContent = '방 생성 실패: ' + (e.message||e); }
}

async function joinRoom(code){
  const msg = document.getElementById('gmMsg');
  if (!/^\d{4}$/.test(code)){ msg.textContent = '4자리 방 코드를 입력해 주세요.'; return; }
  try {
    const snap = await get(ref(db, 'rooms/' + code));
    if (!snap.exists()){ msg.textContent = '존재하지 않는 방이에요.'; return; }
    const room = snap.val();
    if (room.state !== 'waiting'){ msg.textContent = '이미 게임이 시작된 방이에요.'; return; }
    const cnt = room.players ? Object.keys(room.players).length : 0;
    if (cnt >= MAX_PLAYERS && !(room.players && room.players[currentUser.uid])){ msg.textContent = '방이 가득 찼어요 (최대 ' + MAX_PLAYERS + '명).'; return; }
    const myC = [1,2,3,4].includes(parseInt(window.myCourse,10)) ? parseInt(window.myCourse,10) : 4;
    await set(ref(db, 'rooms/' + code + '/players/' + currentUser.uid), { nick: myNickname, score: 0, course: myC, joinedAt: serverTimestamp() });
    enterRoom(code);
  } catch(e){ msg.textContent = '참가 실패: ' + (e.message||e); }
}

// 접속이 살아있는 동안 '연결 끊기면 내 플레이어 노드 제거' 예약(나만 정리, 방 전체는 안 건드림)
function armRoomPresence(code){
  if (!currentUser) return;
  try { onDisconnect(ref(db, 'rooms/' + code + '/players/' + currentUser.uid)).remove(); } catch(e){}
}
// 재접속 시 내가 방에서 빠졌으면(연결이 끊겨 onDisconnect로 제거됐으면) 점수 유지한 채 다시 합류
async function rejoinIfDropped(code){
  if (!currentUser || gameCode !== code) return;
  try {
    const roomSnap = await get(ref(db, 'rooms/' + code));
    if (!roomSnap.exists()) return; // 방이 정말 종료된 경우는 기존 onValue 처리에 맡김
    const meRef = ref(db, 'rooms/' + code + '/players/' + currentUser.uid);
    const meSnap = await get(meRef);
    if (!meSnap.exists()){
      const c = [1,2,3,4].includes(parseInt(lastMyCourse,10)) ? parseInt(lastMyCourse,10) : ([1,2,3,4].includes(parseInt(window.myCourse,10)) ? parseInt(window.myCourse,10) : 4);
      await set(meRef, { nick: myNickname, score: lastMyScore || 0, course: c, joinedAt: serverTimestamp() });
    }
  } catch(e){}
}
// 모바일에서 화면 복귀 시 즉시 복구 + 다시 그리기
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && gameCode){
    armRoomPresence(gameCode);
    rejoinIfDropped(gameCode);
    if (gameRoom){ try { onRoomUpdate(); } catch(e){} }
  }
});

function enterRoom(code){
  gameCode = code;
  myAnsweredQ = -1; scheduledQ = -1; lastMyScore = 0;
  // 대결 중에는 암송 도우미(사이드바) 사용 차단 + 열려 있으면 닫기
  window.__gameActive = true;
  try { const sb = document.getElementById('sidebar'); if (sb) sb.classList.remove('active'); } catch(e){}
  // 연결이 끊겼다 붙을 때(모바일 홈화면 갔다 오기 등) 내 자리를 자동 복구
  armRoomPresence(code);
  if (roomConnUnsub){ try { roomConnUnsub(); } catch(e){} roomConnUnsub = null; }
  roomConnUnsub = onValue(ref(db, '.info/connected'), (snap) => {
    if (snap.val() === true && gameCode === code && currentUser){
      armRoomPresence(code);
      rejoinIfDropped(code);
    }
  });
  gameUnsub = onValue(ref(db, 'rooms/' + code), (snap) => {
    if (!snap.exists()){ // 방이 사라짐(호스트 나감)
      gameRoom = null;
      const ov = document.getElementById('gmOverlay');
      if (ov && ov.classList.contains('show')){
        ov.classList.remove('full'); const p = ov.querySelector('.sm-panel'); if (p) p.classList.remove('big', 'wait');
        if (!iAmLeaving) smAlert('방이 종료되었어요.');
        renderLobby(); cleanupRoomState();
      }
      iAmLeaving = false;
      return;
    }
    gameRoom = snap.val();
    onRoomUpdate();
  });
}

function cleanupRoomState(){
  if (gameUnsub){ gameUnsub(); gameUnsub = null; }
  if (roomConnUnsub){ try { roomConnUnsub(); } catch(e){} roomConnUnsub = null; }
  clearTimeout(hostTimer); clearInterval(tickTimer);
  gameCode = null; gameRoom = null; scheduledQ = -1; myAnsweredQ = -1; earlyQ = -1; renderedQ = -1; renderedPhase = ''; iAmLeaving = false; lastMyScore = 0; lastMyCourse = null;
  gameWasPlaying = false; gameFsArmed = false;
  window.__gameActive = false;
}

function leaveRoom(){
  if (!gameCode) return;
  const code = gameCode, room = gameRoom;
  try {
    if (room && isHost(room)){ remove(ref(db, 'rooms/' + code)); }
    else { remove(ref(db, 'rooms/' + code + '/players/' + currentUser.uid)); }
  } catch(e){}
  cleanupRoomState();
}

function onRoomUpdate(){
  const room = gameRoom;
  if (!room) return;
  // 재접속 복구를 위해 내 최신 점수·과정 기억
  if (room.players && currentUser && room.players[currentUser.uid]){
    lastMyScore = room.players[currentUser.uid].score || 0;
    if ([1,2,3,4].includes(parseInt(room.players[currentUser.uid].course,10))) lastMyCourse = parseInt(room.players[currentUser.uid].course,10);
  }
  // 게임이 시작되면 화면을 크게(앱처럼) + 실제 전체화면 전환
  const ov = document.getElementById('gmOverlay');
  const panel = ov && ov.querySelector('.sm-panel');
  const inGame = room.state === 'playing' || room.state === 'finished';
  if (panel){
    panel.classList.toggle('big', inGame);
    panel.classList.toggle('wait', room.state === 'waiting');
  }
  if (ov) ov.classList.toggle('full', inGame); // 진행/결과는 화면 전체 차지
  const startedNow = room.state === 'playing' && !gameWasPlaying;
  gameWasPlaying = room.state === 'playing';
  if (startedNow) enterGameFullscreen();
  if (room.state === 'waiting') renderRoom();
  else if (room.state === 'playing'){ renderPlaying(); hostSchedule(); }
  else if (room.state === 'finished'){ renderResult(); clearInterval(tickTimer); }
}

function playersArr(room){
  return Object.keys(room.players || {}).map(uid => ({ uid, ...room.players[uid] }))
    .sort((a, b) => (a.joinedAt||0) - (b.joinedAt||0));
}

function renderRoom(){
  const room = gameRoom;
  document.getElementById('gmTitle').textContent = '대기 중';
  const ps = playersArr(room);
  const host = isHost(room);
  const sel = room.days || [];
  const qCount = room.qCount || Q_COUNT;
  const qtMs = qTimeOf(room);
  const qSec = Math.round(qtMs / 1000);
  const isPresetTime = Q_TIME_PRESETS.includes(qSec);
  const myC = myCourseInRoom(room);
  const dayKeys = Object.keys(window.bibleData || {});
  const plist = ps.map(p => {
    const pc = [1,2,3,4].includes(parseInt(p.course,10)) ? parseInt(p.course,10) : null;
    return '<div class="g-player' + (p.uid === room.host ? ' host' : '') + '">' + escapeHtml(p.nick) +
      (pc ? '<span class="g-p-score">' + pc + '과정</span>' : '') + '</div>';
  }).join('') + Array.from({ length: MAX_PLAYERS - ps.length }, () => '<div class="g-player" style="opacity:.4;">빈 자리</div>').join('');

  // 내 과정 선택(모두) — 과정이 달라도 각자 본인 과정 암송이 나옴
  const myCourseHtml = '<div class="g-set">' +
    '<div class="g-set-row"><span>내 과정</span>' +
      '<select id="gmMyCourse">' + [1,2,3,4].map(c => '<option value="' + c + '"' + (c === myC ? ' selected' : '') + '>' + c + '과정</option>').join('') + '</select>' +
    '</div>' +
    '<div class="g-set-hint">고른 일차에서 내 과정에 맞는 암송이 나와요.</div></div>';

  // 출제 설정(방장: 일차·문제수·제한시간) / 표시(참가자)
  let setHtml;
  if (host){
    setHtml = '<div class="g-set">' +
      '<div class="g-set-row"><span>문제 수</span>' +
        '<select id="gmQCount">' + Q_COUNT_OPTS.map(n => '<option value="' + n + '"' + (n === qCount ? ' selected' : '') + '>' + n + '문제</option>').join('') + '</select>' +
      '</div>' +
      '<div class="g-set-row"><span>제한시간</span>' +
        '<select id="gmTime">' +
          Q_TIME_PRESETS.map(s => '<option value="' + s + '"' + (isPresetTime && s === qSec ? ' selected' : '') + '>' + fmtQTime(s * 1000) + '</option>').join('') +
          '<option value="custom"' + (!isPresetTime ? ' selected' : '') + '>사용자 설정</option>' +
        '</select>' +
      '</div>' +
      '<div class="g-set-row" id="gmTimeCustomRow"' + (isPresetTime ? ' style="display:none;"' : '') + '><span>직접 입력(초)</span>' +
        '<input type="number" id="gmTimeCustom" min="10" max="600" value="' + (isPresetTime ? '' : qSec) + '" placeholder="예: 45"></div>' +
      '<div class="g-set-label">일차 <span class="g-set-hint">(복수 선택 가능 · 안 고르면 전체 랜덤)</span></div>' +
      '<div class="g-daygrid">' + dayKeys.map(d => '<label class="g-day' + (sel.includes(d) ? ' on' : '') + '"><input type="checkbox" data-day="' + d + '"' + (sel.includes(d) ? ' checked' : '') + '>' + d + '</label>').join('') + '</div>' +
      '</div>';
  } else {
    const range = sel.length ? sel.join(', ') : '전체 일차 (랜덤)';
    setHtml = '<div class="g-set"><div class="g-set-label">출제 일차: <b>' + range + '</b><br>문제 수: <b>' + qCount + '문제</b><br>제한시간: <b>' + fmtQTime(qtMs) + '</b></div></div>';
  }

  gmBody().innerHTML =
    '<div class="g-code-big">' + gameCode + '</div>' +
    '<div class="g-code-label">입장 코드 입니다</div>' +
    '<div class="g-players">' + plist + '</div>' +
    myCourseHtml +
    setHtml +
    (host
      ? '<button class="g-btn purple" id="gmStart"' + (ps.length < 2 ? ' disabled' : '') + '>게임 시작 (' + ps.length + '명)</button>' +
        (ps.length < 2 ? '<div class="g-msg">2명 이상 모이면 시작할 수 있어요.</div>' : '')
      : '<div class="g-msg">방장이 시작하기를 기다리는 중...</div>') +
    '<button class="g-btn ghost" id="gmLeave">나가기</button>';

  // 내 과정 선택 — 모두(방장·참가자) 공통
  const myCs = document.getElementById('gmMyCourse');
  if (myCs) myCs.onchange = () => {
    const c = Number(myCs.value);
    try { update(ref(db, 'rooms/' + gameCode + '/players/' + currentUser.uid), { course: c }); } catch(e){}
    try { set(ref(db, 'users/' + currentUser.uid + '/course'), c); } catch(e){}
    myCourse = c; window.myCourse = c; lastMyCourse = c;
    try { localStorage.setItem('lastCourse', String(c)); } catch(e){}
  };

  if (host){
    const s = document.getElementById('gmStart'); if (s) s.onclick = startGame;
    const qc = document.getElementById('gmQCount');
    if (qc) qc.onchange = () => { try { update(ref(db, 'rooms/' + gameCode), { qCount: Number(qc.value) }); } catch(e){} };
    const ts = document.getElementById('gmTime');
    const tcRow = document.getElementById('gmTimeCustomRow');
    const tc = document.getElementById('gmTimeCustom');
    const clampSec = v => Math.min(600, Math.max(10, parseInt(v, 10) || 60));
    if (ts) ts.onchange = () => {
      if (ts.value === 'custom'){
        if (tcRow) tcRow.style.display = '';
        const sec = clampSec(tc && tc.value);
        try { update(ref(db, 'rooms/' + gameCode), { qTime: sec * 1000 }); } catch(e){}
      } else {
        if (tcRow) tcRow.style.display = 'none';
        try { update(ref(db, 'rooms/' + gameCode), { qTime: Number(ts.value) * 1000 }); } catch(e){}
      }
    };
    if (tc) tc.onchange = () => { const sec = clampSec(tc.value); tc.value = sec; try { update(ref(db, 'rooms/' + gameCode), { qTime: sec * 1000 }); } catch(e){} };
    gmBody().querySelectorAll('.g-daygrid input').forEach(chk => chk.onchange = () => {
      const cur = (gameRoom.days || []).slice();
      const day = chk.dataset.day, i = cur.indexOf(day);
      if (chk.checked && i < 0) cur.push(day);
      if (!chk.checked && i >= 0) cur.splice(i, 1);
      try { update(ref(db, 'rooms/' + gameCode), { days: cur.length ? cur : null }); } catch(e){}
    });
  }
  document.getElementById('gmLeave').onclick = closeGame;
}

async function startGame(){
  if (!isHost(gameRoom)) return;
  const bd = window.bibleData || {};
  const days = (gameRoom.days && gameRoom.days.length) ? gameRoom.days : Object.keys(bd);
  const anyVerse = days.some(d => (bd[d] || []).some(it => it.txt));
  if (!anyVerse){ alert('선택한 일차에 외울 구절이 없어요. 일차를 다시 골라주세요.'); return; }
  await genQuestion(gameCode, 0, true);
}

// 방장이 일차만 고르면 됨 — 각자 화면에서 본인 과정에 맞는 구절을 seed로 골라 보여줌
async function genQuestion(code, idx, first){
  const bd = window.bibleData || {};
  const days = (gameRoom && gameRoom.days && gameRoom.days.length) ? gameRoom.days : Object.keys(bd);
  if (!days.length) return;
  const day = days[Math.floor(Math.random() * days.length)];
  const seed = Math.floor(Math.random() * 100000);
  const payload = { qIndex: idx, question: { day: day, seed: seed, startedAt: Date.now() } };
  if (first) payload.state = 'playing';
  await update(ref(db, 'rooms/' + code), payload);
}

function scoreStripHtml(room){
  const ans = (room.answers && room.answers[room.qIndex]) || {};
  return playersArr(room).sort((a, b) => (b.score||0) - (a.score||0)).map(p => {
    const done = ans[p.uid] && ans[p.uid].correct ? ' ✅' : '';
    return '<div class="g-player"' + (p.uid === currentUser.uid ? ' style="outline:2px solid var(--primary);"' : '') + '>' +
      escapeHtml(p.nick) + done + '<span class="g-p-score">' + (p.score||0) + '점</span></div>';
  }).join('');
}
function updateScoreStrip(room){
  const el = document.getElementById('gmScores');
  if (el) el.innerHTML = scoreStripHtml(room);
}

function renderPlaying(){
  const room = gameRoom, q = room.question;
  if (!q) return;
  const myV = myVerseForRound(room); // 내 과정·일차에 맞는 구절
  const elapsed = Date.now() - q.startedAt;
  const revealing = elapsed >= qTimeOf(room) || allAnswered(room);
  const mine = room.answers && room.answers[room.qIndex] && room.answers[room.qIndex][currentUser.uid];
  const solved = !!(mine && mine.correct);
  const phase = (!myV ? 'novers' : (revealing ? 'reveal' : (solved ? 'solved' : 'input')));

  // 같은 문제·같은 단계면 입력칸을 다시 그리지 않고 점수만 갱신(타이핑 중 깨짐 방지)
  if (renderedQ === room.qIndex && renderedPhase === phase){ updateScoreStrip(room); return; }
  renderedQ = room.qIndex; renderedPhase = phase;

  document.getElementById('gmTitle').textContent = '문제 ' + (room.qIndex + 1) + ' / ' + (room.qCount || Q_COUNT);
  const dayLabel = escapeHtml(q.day || '');

  // 내 과정에 이 일차 암송이 없는 경우
  if (!myV){
    let h = '<div class="g-qhead"><div class="g-topic">' + dayLabel + '</div>' +
      '<div class="g-qno" style="margin-top:8px;">이 일차에 해당하는 내 과정 암송이 없어요.<br>다음 문제를 기다려 주세요 🙂</div></div>' +
      '<div class="g-timebar"><i id="gmBar" style="width:100%"></i></div>';
    h += '<div class="g-players" id="gmScores" style="margin-top:14px;">' + scoreStripHtml(room) + '</div>';
    gmBody().innerHTML = h; startTick(); return;
  }

  let html = '<div class="g-qhead"><div class="g-topic">' + escapeHtml(myV.t) + '</div><div class="g-ref">' + escapeHtml(myV.v) + '</div>' +
    '<div class="g-qno" style="margin-top:4px;">' + dayLabel + ' · 이 장절의 본문을 외워서 적어보세요</div></div>' +
    '<div class="g-timebar"><i id="gmBar" style="width:100%"></i></div>';
  if (revealing){
    html += '<div class="g-answer-box">' + escapeHtml(myV.txt) + '</div>';
    html += solved ? '<div class="g-feedback ok">정답! +' + (mine.pts||0) + '점 🎉</div>' : '<div class="g-feedback no">아쉬워요 😢 (정답은 위에)</div>';
  } else if (solved){
    html += '<div class="g-feedback ok">정답! 다른 사람을 기다리는 중... 🎉 (+' + (mine.pts||0) + '점)</div>';
  } else {
    html += '<textarea id="gmInput" class="g-input" rows="4" placeholder="본문을 외워서 입력하세요&#10;(띄어쓰기·문장부호는 달라도 괜찮아요)"></textarea>' +
      '<div class="g-feedback" id="gmFb"></div>' +
      '<button class="g-btn primary" id="gmSubmit">제출</button>';
  }
  html += '<div class="g-players" id="gmScores" style="margin-top:14px;">' + scoreStripHtml(room) + '</div>';
  gmBody().innerHTML = html;

  if (phase === 'input'){
    const sub = document.getElementById('gmSubmit');
    if (sub) sub.onclick = trySubmit;
    const inp = document.getElementById('gmInput');
    if (inp){ try { inp.focus(); } catch(e){} }
  }
  startTick();
}

function allAnswered(room){
  const players = room.players || {};
  const uids = Object.keys(players);
  if (!uids.length) return false;
  const ans = (room.answers && room.answers[room.qIndex]) || {};
  const q = room.question;
  let done = 0;
  uids.forEach(u => {
    const correct = ans[u] && ans[u].correct;
    // 그 플레이어 과정에 이번 일차 구절이 없으면 자동 완료로 간주(게임 멈춤 방지)
    let hasVerse = true;
    if (q && q.day != null){
      let c = parseInt(players[u].course, 10); if (![1,2,3,4].includes(c)) c = 4;
      hasVerse = versesFor(q.day, c).length > 0;
    }
    if (correct || !hasVerse) done++;
  });
  return done >= uids.length;
}

function startTick(){
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    if (!gameRoom || gameRoom.state !== 'playing' || !gameRoom.question){ clearInterval(tickTimer); return; }
    const qt = qTimeOf(gameRoom);
    const elapsed = Date.now() - gameRoom.question.startedAt;
    const ratio = Math.max(0, 1 - elapsed / qt);
    const bar = document.getElementById('gmBar');
    if (bar) bar.style.width = (ratio * 100) + '%';
    if (elapsed >= qt){ renderPlaying(); clearInterval(tickTimer); } // 시간 종료 → 정답 공개
  }, 250);
}

async function trySubmit(){
  const room = gameRoom; if (!room || !room.question) return;
  if (myAnsweredQ === room.qIndex) return;
  const myV = myVerseForRound(room); if (!myV) return;
  const inp = document.getElementById('gmInput');
  const val = inp ? inp.value : '';
  if (!normAns(val)) return;
  const fb = document.getElementById('gmFb');
  if (normAns(val) !== normAns(myV.txt)){
    if (fb){ fb.className = 'g-feedback no'; fb.textContent = '틀렸어요. 다시 도전! (띄어쓰기는 무시돼요)'; }
    return;
  }
  // 정답
  myAnsweredQ = room.qIndex;
  const elapsed = Date.now() - room.question.startedAt;
  const pts = Math.max(200, 1000 - Math.floor(elapsed / 200)); // 빠를수록 높은 점수
  try {
    await set(ref(db, 'rooms/' + gameCode + '/answers/' + room.qIndex + '/' + currentUser.uid), { correct: true, ms: elapsed, pts });
    const cur = (room.players[currentUser.uid] && room.players[currentUser.uid].score) || 0;
    await set(ref(db, 'rooms/' + gameCode + '/players/' + currentUser.uid + '/score'), cur + pts);
  } catch(e){ console.warn('답안 제출 실패', e); }
  renderPlaying();
}

// 호스트만: 문제 진행 타이머
function hostAdvance(room){
  const next = room.qIndex + 1;
  if (next >= (room.qCount || Q_COUNT)) update(ref(db, 'rooms/' + gameCode), { state: 'finished' });
  else genQuestion(gameCode, next);
}
function hostSchedule(){
  const room = gameRoom;
  if (!isHost(room) || room.state !== 'playing' || !room.question) return;
  // 모두 답하면 잠깐 정답 공개 후 바로 다음 문제
  if (allAnswered(room) && earlyQ !== room.qIndex){
    earlyQ = room.qIndex;
    clearTimeout(hostTimer);
    hostTimer = setTimeout(() => hostAdvance(room), REVEAL);
    return;
  }
  if (scheduledQ === room.qIndex) return;
  scheduledQ = room.qIndex;
  const end = room.question.startedAt + qTimeOf(room) + REVEAL;
  clearTimeout(hostTimer);
  hostTimer = setTimeout(() => hostAdvance(room), Math.max(300, end - Date.now()));
}

function renderResult(){
  const room = gameRoom;
  clearTimeout(hostTimer);
  document.getElementById('gmTitle').textContent = '🏁 결과';
  const ps = playersArr(room).sort((a, b) => (b.score||0) - (a.score||0));
  const medal = ['🥇','🥈','🥉'];
  const rows = ps.map((p, i) =>
    '<div class="g-result-row' + (i === 0 ? ' win' : '') + '"><div class="lb-rank">' + (i < 3 ? medal[i] : (i + 1)) + '</div>' +
    '<div class="lb-nick">' + escapeHtml(p.nick) + (p.uid === currentUser.uid ? ' (나)' : '') + '</div>' +
    '<div class="lb-val">' + (p.score||0) + '점</div></div>').join('');
  gmBody().innerHTML = '<div style="text-align:center;font-size:1.1em;font-weight:800;margin:6px 0 14px;">🎉 ' + escapeHtml(ps[0] ? ps[0].nick : '') + ' 님 우승!</div>' +
    rows +
    (isHost(room) ? '<button class="g-btn purple" id="gmAgain" style="margin-top:16px;">한 번 더</button>' : '<div class="g-msg" style="margin-top:14px;">방장이 다시 시작하기를 기다리는 중...</div>') +
    '<button class="g-btn ghost" id="gmLeave2">나가기</button>';
  if (isHost(room)){ const a = document.getElementById('gmAgain'); if (a) a.onclick = restartGame; }
  document.getElementById('gmLeave2').onclick = closeGame;
}

async function restartGame(){
  if (!isHost(gameRoom)) return;
  const ps = gameRoom.players || {};
  const resetPlayers = {};
  Object.keys(ps).forEach(uid => resetPlayers[uid] = { ...ps[uid], score: 0 });
  scheduledQ = -1; myAnsweredQ = -1; earlyQ = -1; renderedQ = -1; renderedPhase = '';
  await update(ref(db, 'rooms/' + gameCode), { players: resetPlayers, answers: null, state: 'waiting', qIndex: -1, question: null });
}

// 카카오톡·인스타 등 앱 내장 브라우저(웹뷰) 감지 — 구글 로그인 차단됨
function isInAppBrowser(){
  const ua = navigator.userAgent || '';
  return /KAKAOTALK|Instagram|FBAN|FBAV|FB_IAB|Line\/|NAVER\(inapp|DaumApps|everytimeApp|Snapchat|TwitterAndroid|; wv\)/i.test(ua);
}
function isMobile(){ return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || ''); }

async function copyLink(){
  try { await navigator.clipboard.writeText('https://jbchcampusministry.github.io/samuel/'); return true; } catch(e){ return false; }
}

// 리다이렉트 로그인 결과 처리(모바일)
getRedirectResult(auth).catch((e) => {
  if (e && e.code === 'auth/unauthorized-domain'){
    alert('이 도메인이 Firebase에 등록되지 않았습니다.\n승인된 도메인에 jbchcampusministry.github.io 를 추가하세요.');
  }
});

window.samuelToggleAuth = async function(){
  if (currentUser && !currentUser.isAnonymous){
    toggleProfileMenu();   // 인물 아이콘 → 드롭다운(닉네임 / 마이페이지 / 로그아웃)
    return;
  }
  // 인앱 브라우저면 안내 후 중단
  if (isInAppBrowser()){
    const copied = await copyLink();
    alert('카카오톡·인스타그램 등 "앱 안의 브라우저"에서는 구글 로그인이 막혀 있어요.\n\n' +
      '오른쪽 위/아래 메뉴(⋯ 또는 ≡)에서 "다른 브라우저로 열기"(Chrome·Safari)를 눌러주세요.' +
      (copied ? '\n\n(주소를 복사해 뒀어요 — 크롬/사파리 주소창에 붙여넣어 열어도 됩니다.)' : ''));
    return;
  }
  const wasFs = !!(window.isFullscreen && window.isFullscreen()); // 로그인 전 전체화면 여부
  // 구글로 바뀌기 전(아직 익명으로 인증된 상태)에 익명 접속 항목을 제거 → 로그인 후 유령으로 남아 +1 되는 것 방지
  try { const pu = presenceUid; if (pu) { onDisconnect(ref(db, 'status/' + pu)).cancel(); presenceUid = null; await remove(ref(db, 'status/' + pu)); } } catch(e){}
  try {
    await signInWithPopup(auth, provider);
    if (wasFs) restoreFullscreen(); // 팝업으로 깨진 전체화면 복원
  }
  catch(e){
    if (e && e.code === 'auth/unauthorized-domain'){
      alert('이 도메인이 Firebase에 등록되지 않았습니다.\nFirebase 콘솔 → Authentication → Settings → 승인된 도메인 에 jbchcampusministry.github.io 를 추가하세요.');
    } else if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/cancelled-popup-request')){
      alert('팝업이 차단되었어요. 브라우저에서 팝업을 허용한 뒤 다시 시도해 주세요.');
    } else {
      alert('로그인 실패: ' + (e.message||e));
    }
  }
};

// 로그인 팝업 등으로 전체화면이 풀렸을 때 복원(즉시 시도 + 안 되면 다음 탭에서)
function restoreFullscreen(){
  try { window.enterAppFullscreen && window.enterAppFullscreen(); } catch(e){}
  const re = () => {
    document.removeEventListener('pointerdown', re);
    document.removeEventListener('click', re);
    try { window.enterAppFullscreen && window.enterAppFullscreen(); } catch(e){}
  };
  document.addEventListener('pointerdown', re, { once: true });
  document.addEventListener('click', re, { once: true });
}
