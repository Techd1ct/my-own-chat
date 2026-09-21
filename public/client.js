const socket = io({
  transports: ['websocket', 'polling'],
  upgrade: true,
  reconnection: true,
  reconnectionAttempts: 10
});

let aesKey = null;
let currentRoom = null;
let currentNickname = null;

let typingTimeout = null;
const typingUsers = new Set();
let currentUsers = [];

// ---------- UI Elements ----------
const joinScreen = document.getElementById('join-screen');
const chatScreen = document.getElementById('chat-screen');
const messagesDiv = document.getElementById('messages');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const inviteBtn = document.getElementById('invite-btn');
const themeBtn = document.getElementById('theme-btn');
const themeBtnJoin = document.getElementById('theme-btn-join');
const leaveBtn = document.getElementById('leave-btn');
const usersBtn = document.getElementById('users-btn');
const usersPopup = document.getElementById('users-popup');
const closeUsersBtn = document.getElementById('close-users-btn');
const usersList = document.getElementById('users-list');

// Link popup elements
const linkPopup = document.getElementById('link-popup');
const linkUrlPreview = document.getElementById('link-url-preview');
const linkCancelBtn = document.getElementById('link-cancel-btn');
const linkConfirmBtn = document.getElementById('link-confirm-btn');

// ---------- Web Crypto helpers ----------
async function deriveKey(passphrase, room) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const salt = encoder.encode(room + '-secure-chat-salt-v1');

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 250000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptMessage(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    encoded
  );

  return {
    ciphertext: bufferToBase64(ciphertext),
    iv: bufferToBase64(iv)
  };
}

async function decryptMessage(ciphertextB64, ivB64) {
  try {
    const ciphertext = base64ToBuffer(ciphertextB64);
    const iv = base64ToBuffer(ivB64);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch (err) {
    return '[Unable to decrypt – wrong secret?]';
  }
}

function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// ---------- Join Room ----------
document.getElementById('join-btn').addEventListener('click', async () => {
  const nickname = document.getElementById('nickname').value.trim();
  const room = document.getElementById('room').value.trim().toLowerCase();
  const passphrase = document.getElementById('passphrase').value;

  if (!nickname || !room || !passphrase) {
    alert('Please fill all fields');
    return;
  }

  currentNickname = nickname;
  currentRoom = room;

  window.currentPassphrase = passphrase;
  aesKey = await deriveKey(passphrase, room);

  socket.emit('join-room', { room, nickname });

  document.getElementById('room-name').textContent = `Room: ${room}`;
  joinScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  messageInput.focus();
});

// ---------- Send Message ----------
messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !aesKey) return;

  const { ciphertext, iv } = await encryptMessage(text);

  socket.emit('encrypted-message', {
    room: currentRoom,
    nickname: currentNickname,
    ciphertext,
    iv
  });

  addMessage(currentNickname, text, true);

  socket.emit('stop-typing');
  clearTimeout(typingTimeout);

  messageInput.value = '';
});

// ---------- Typing Detection ----------
messageInput.addEventListener('input', () => {
  if (!currentRoom) return;

  socket.emit('typing');
  clearTimeout(typingTimeout);

  typingTimeout = setTimeout(() => {
    socket.emit('stop-typing');
  }, 1500);
});

// ========== LEAVE ROOM (double click confirmation) ==========
let leaveConfirm = false;
let leaveTimeout = null;

if (leaveBtn) {
  leaveBtn.addEventListener('click', () => {
    if (!currentRoom) return;

    if (!leaveConfirm) {
      leaveConfirm = true;
      leaveBtn.classList.add('confirm');
      leaveBtn.title = 'Click again to leave';

      clearTimeout(leaveTimeout);
      leaveTimeout = setTimeout(() => {
        leaveConfirm = false;
        leaveBtn.classList.remove('confirm');
        leaveBtn.title = 'Leave room';
      }, 3000);
    } else {
      clearTimeout(leaveTimeout);
      leaveConfirm = false;
      leaveBtn.classList.remove('confirm');
      leaveBtn.title = 'Leave room';

      socket.emit('stop-typing');
      socket.disconnect();
      socket.connect();

      currentRoom = null;
      currentNickname = null;
      aesKey = null;
      window.currentPassphrase = null;
      typingUsers.clear();
      currentUsers = [];

      messagesDiv.innerHTML = '';

      chatScreen.classList.add('hidden');
      joinScreen.classList.remove('hidden');

      document.getElementById('nickname').value = '';
      document.getElementById('room').value = '';
      document.getElementById('passphrase').value = '';
    }
  });
}

// ========== USERS LIST ==========
socket.on('room-users', (users) => {
  currentUsers = users;
  const countEl = document.getElementById('users-count');
  if (countEl) countEl.textContent = `${users.length} online`;
});

if (usersBtn) {
  usersBtn.addEventListener('click', () => {
    if (!usersList) return;

    usersList.innerHTML = '';

    if (currentUsers.length === 0) {
      usersList.innerHTML = '<li>No one else is here</li>';
    } else {
      currentUsers.forEach(user => {
        const li = document.createElement('li');
        li.textContent = user;
        usersList.appendChild(li);
      });
    }

    if (usersPopup) usersPopup.classList.remove('hidden');
  });
}

if (closeUsersBtn) {
  closeUsersBtn.addEventListener('click', () => {
    if (usersPopup) usersPopup.classList.add('hidden');
  });
}

if (usersPopup) {
  usersPopup.addEventListener('click', (e) => {
    if (e.target === usersPopup) {
      usersPopup.classList.add('hidden');
    }
  });
}

// ========== EXTERNAL LINK WARNING ==========
let pendingLink = null;
let linkConfirmStep = false;
let linkTimeout = null;

if (messagesDiv) {
  messagesDiv.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;

    e.preventDefault();

    pendingLink = link.href;
    if (linkUrlPreview) linkUrlPreview.textContent = pendingLink;

    linkConfirmStep = false;
    if (linkConfirmBtn) {
      linkConfirmBtn.classList.remove('confirm');
      linkConfirmBtn.textContent = 'Continue';
    }

    if (linkPopup) linkPopup.classList.remove('hidden');
  });
}

if (linkCancelBtn) {
  linkCancelBtn.addEventListener('click', () => {
    if (linkPopup) linkPopup.classList.add('hidden');
    pendingLink = null;
    linkConfirmStep = false;
    clearTimeout(linkTimeout);
  });
}

if (linkConfirmBtn) {
  linkConfirmBtn.addEventListener('click', () => {
    if (!pendingLink) return;

    if (!linkConfirmStep) {
      linkConfirmStep = true;
      linkConfirmBtn.classList.add('confirm');
      linkConfirmBtn.textContent = 'Click again to open';

      clearTimeout(linkTimeout);
      linkTimeout = setTimeout(() => {
        linkConfirmStep = false;
        linkConfirmBtn.classList.remove('confirm');
        linkConfirmBtn.textContent = 'Continue';
      }, 3000);
    } else {
      clearTimeout(linkTimeout);
      window.open(pendingLink, '_blank', 'noopener,noreferrer');

      if (linkPopup) linkPopup.classList.add('hidden');
      pendingLink = null;
      linkConfirmStep = false;
      linkConfirmBtn.classList.remove('confirm');
      linkConfirmBtn.textContent = 'Continue';
    }
  });
}

if (linkPopup) {
  linkPopup.addEventListener('click', (e) => {
    if (e.target === linkPopup) {
      linkPopup.classList.add('hidden');
      pendingLink = null;
      linkConfirmStep = false;
      clearTimeout(linkTimeout);
    }
  });
}

// ========== INVITE LINK ==========
if (inviteBtn) {
  inviteBtn.addEventListener('click', () => {
    if (!currentRoom) return;

    const secret = window.currentPassphrase;
    const url = new URL(window.location.href);
    url.hash = `room=${encodeURIComponent(currentRoom)}&secret=${encodeURIComponent(secret)}`;

    navigator.clipboard.writeText(url.toString()).then(() => {
      const originalText = inviteBtn.textContent;
      inviteBtn.textContent = 'Copied!';
      setTimeout(() => {
        inviteBtn.textContent = originalText;
      }, 1500);
    }).catch(() => {
      alert('Could not copy link. Please copy it manually:\n\n' + url.toString());
    });
  });
}

// Auto-fill form if someone opens an invite link
window.addEventListener('DOMContentLoaded', () => {
  if (window.location.hash) {
    const params = new URLSearchParams(window.location.hash.substring(1));
    const room = params.get('room');
    const secret = params.get('secret');

    if (room) document.getElementById('room').value = room;
    if (secret) document.getElementById('passphrase').value = secret;

    document.getElementById('nickname').focus();
  }
});

// ========== THEME TOGGLE ==========
function applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('light');
    if (themeBtn) themeBtn.textContent = '☀️';
    if (themeBtnJoin) themeBtnJoin.textContent = '☀️';
  } else {
    document.body.classList.remove('light');
    if (themeBtn) themeBtn.textContent = '🌙';
    if (themeBtnJoin) themeBtnJoin.textContent = '🌙';
  }
  localStorage.setItem('theme', theme);
}

function toggleTheme() {
  const isLight = document.body.classList.contains('light');
  applyTheme(isLight ? 'dark' : 'light');
}

const savedTheme = localStorage.getItem('theme') || 'dark';
applyTheme(savedTheme);

if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
if (themeBtnJoin) themeBtnJoin.addEventListener('click', toggleTheme);

// ---------- Socket Events ----------
socket.on('encrypted-message', async (data) => {
  if (data.nickname === currentNickname) return;

  const plaintext = await decryptMessage(data.ciphertext, data.iv);
  addMessage(data.nickname, plaintext, false);
});

socket.on('user-joined', (data) => {
  addSystemMessage(`${data.nickname} joined`);
});

socket.on('user-left', (data) => {
  addSystemMessage(`${data.nickname} left`);
});

socket.on('typing', (data) => {
  if (data.nickname === currentNickname) return;
  typingUsers.add(data.nickname);
  updateTypingIndicator();
});

socket.on('stop-typing', (data) => {
  typingUsers.delete(data.nickname);
  updateTypingIndicator();
});

// ---------- Helper Functions ----------
function updateTypingIndicator() {
  let indicator = document.getElementById('typing-indicator');

  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'typing-indicator';
    indicator.className = 'typing';
  }

  if (typingUsers.size === 0) {
    if (indicator.parentNode) {
      indicator.remove();
    }
    return;
  }

  const names = Array.from(typingUsers);
  let text = '';

  if (names.length === 1) {
    text = `${names[0]} is typing…`;
  } else if (names.length === 2) {
    text = `${names[0]} and ${names[1]} are typing…`;
  } else {
    text = `${names[0]} and ${names.length - 1} others are typing…`;
  }

  indicator.textContent = text;
  messagesDiv.appendChild(indicator);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function addMessage(nickname, text, isOwn) {
  const div = document.createElement('div');
  div.className = `message ${isOwn ? 'own' : ''}`;

  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const linkedText = linkify(text);

  div.innerHTML = `
    <div class="message-header">
      <strong>${escapeHtml(nickname)}</strong>
      <span class="timestamp">${time}</span>
    </div>
    <div class="message-content">${linkedText}</div>
  `;

  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function linkify(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return escapeHtml(text).replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

function addSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'system';
  div.textContent = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}