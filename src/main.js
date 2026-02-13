// import './style.css'

// Configuration & State
const STORAGE_KEY_API = 'safetube_api_key';
const STORAGE_KEY_DATA = 'safetube_data';
const STORAGE_KEY_STATS = 'safetube_stats_meta';
// Scopes: Drive access + User Info for display
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';
const STATS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyryKTFoTom_fhoJ6ImvnfbYUn8wtKABPvMMLX_g3OP7yiBLj14m2kL0EDEOJVKDjtA6g/exec';

import { translations } from './i18n.js';
const STORAGE_KEY_LANG = 'safetube_lang';

// ...

async function saveToDrive() {
  if (!state.accessToken) return;

  // Clean data before saving (remove large cached videos to save space/bandwidth)
  const cleanData = JSON.parse(JSON.stringify(state.data));
  const configData = {
    ...cleanData,
    lastUpdated: new Date().toISOString()
  };

  const fileId = await findConfigFile();
  const metadata = {
    name: 'safetube_settings.json', // New visible filename
    mimeType: 'application/json'
  };

  const boundary = 'foo_bar_baz_' + Date.now();
  const delimiter = "\r\n--" + boundary + "\r\n";
  const close_delim = "\r\n--" + boundary + "--";

  const body = delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    JSON.stringify(configData) +
    close_delim;

  let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  let method = 'POST';

  if (fileId) {
    url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
    method = 'PATCH';
  }

  try {
    const res = await fetch(url, {
      method: method,
      headers: {
        'Authorization': 'Bearer ' + state.accessToken,
        'Content-Type': 'multipart/related; boundary=' + boundary
      },
      body: body
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }
    console.log('Saved to Drive (Visible File)');

    // Optional: Update a status indicator if visible
    const apiStatus = document.getElementById('api-status');
    if (apiStatus && apiStatus.classList.contains('show')) {
      // Append cloud icon to existing toast if it's showing
      apiStatus.textContent += t('save_drive_success');
    }

  } catch (e) {
    console.error('Save to Drive failed', e);
    // If permission error, suggest re-login
    if (e.message.includes('401') || e.message.includes('403')) {
      console.warn('Sync Error: Permission Denied. Token likely expired.');
      state.accessToken = null;
      const loginBtn = document.getElementById('google-login-btn');
      if (loginBtn) {
        loginBtn.textContent = 'Login with Google to Sync';
        loginBtn.disabled = false;
      }
    } else {
      console.warn(t('save_drive_failed', { message: e.message }));
    }
  }
}

async function findConfigFile() {
  // Search in visible drive, explicitly for our file
  const q = "name = 'safetube_settings.json' and trashed = false";
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`, {
      headers: { 'Authorization': 'Bearer ' + state.accessToken }
    });
    const data = await res.json();
    return data.files && data.files.length > 0 ? data.files[0].id : null;
  } catch (e) {
    console.error('Find config failed', e);
    return null;
  }
}

async function downloadConfigFile(fileId) {
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { 'Authorization': 'Bearer ' + state.accessToken }
    });
    return await res.json();
  } catch (e) {
    console.error('Download config failed', e);
    return null;
  }
}
// Old implementations removed. Using the new ones at the top.
const GOOGLE_CLIENT_ID = '959694478718-pksctjg2pbmtd1fnvp9geha2imqbi72j.apps.googleusercontent.com';

// Avatars
const AVATARS = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🦄', '🦖', '🐙', '🦋', '🚀', '🎈', '⭐', '⚽', '🎮', '🎨'];

// Default Data Structure
const DEFAULT_PROFILE_ID = 'default_child';
const DEFAULT_DATA = {
  profiles: [
    {
      id: DEFAULT_PROFILE_ID,
      name: '', // Empty name triggers Setup Wizard
      channels: [] // Empty channels
    }
  ],
  currentProfileId: DEFAULT_PROFILE_ID,
  apiKey: '',
  shareStats: true, // Default ON - help community discover safe channels
  anonymousUserId: null, // Generated upon opt-in
  filterShorts: true // Default ON
};

// ...

// Mock Data for Demo Mode
const MOCK_VIDEOS = [
  {
    id: 'WRVsOCh907o',
    title: 'Baby Shark Dance | #babyshark Most Viewed Video | Animal Songs | PINKFONG Songs for Children',
    thumbnail: 'https://img.youtube.com/vi/WRVsOCh907o/maxresdefault.jpg',
    channelTitle: 'Pinkfong Baby Shark - Kids\' Songs & Stories',
    publishedAt: new Date().toISOString()
  },
  {
    id: 'yCjJyiqpAuU',
    title: 'Phonics Song with TWO Words - A For Apple - ABC Alphabet Songs with Sounds for Children',
    thumbnail: 'https://img.youtube.com/vi/yCjJyiqpAuU/maxresdefault.jpg',
    channelTitle: 'ChuChu TV',
    publishedAt: new Date().toISOString()
  },
  {
    id: '_6HzoUcx3eo',
    title: 'Twinkle Twinkle Little Star',
    thumbnail: 'https://img.youtube.com/vi/_6HzoUcx3eo/maxresdefault.jpg',
    channelTitle: 'Super Simple Songs',
    publishedAt: new Date().toISOString()
  }
];

let state = {
  data: DEFAULT_DATA,
  videos: [],
  tokenClient: null,
  accessToken: null,
  lang: localStorage.getItem(STORAGE_KEY_LANG) || (navigator.language?.startsWith('zh') ? 'zh' : 'en')
};

// --- i18n Logic ---
function t(key, variables = {}) {
  const transObj = translations[key];
  let text = key;
  if (transObj) {
    text = transObj[state.lang] || transObj['en'] || key;
  }

  Object.keys(variables).forEach(varKey => {
    text = text.replace(`{${varKey}}`, variables[varKey]);
  });
  return text;
}

function setLanguage(lang) {
  state.lang = lang;
  localStorage.setItem(STORAGE_KEY_LANG, lang);
  updateLanguageUI();
}

function updateLanguageUI() {
  // Update static elements in index.html
  // Header
  document.querySelector('.logo-text').textContent = t('app_title');
  document.getElementById('refresh-btn').title = t('refresh_videos');
  document.getElementById('settings-btn').title = t('parent_settings');

  // Toolbar
  const label = document.getElementById('active-channel-display');
  if (label && !state.activeChannelId) {
    label.textContent = t('all_videos');
  }
  // videoCount.textContent is updated in renderVideos

  // Modal
  const settingsTitleText = document.getElementById('settings-title-text');
  if (settingsTitleText) settingsTitleText.textContent = t('parent_settings');

  // Google Sync
  const googleSyncTitle = document.getElementById('google-sync-title');
  if (googleSyncTitle) googleSyncTitle.textContent = t('google_sync');

  document.querySelector('.settings-section .small-text').textContent = t('sync_desc');
  const loginBtn = document.getElementById('google-login-btn');
  if (loginBtn && !state.accessToken) loginBtn.textContent = t('login_google');
  else if (loginBtn && state.accessToken) loginBtn.textContent = t('sync_now');

  // Who is watching
  const sections = document.querySelectorAll('.settings-section');
  sections[1].querySelector('h3').textContent = t('who_is_watching');
  document.getElementById('new-profile-name').placeholder = t('add_child_placeholder');

  // Manage Channels
  sections[2].querySelector('h3').textContent = t('manage_channels');
  document.getElementById('channel-search-input').placeholder = t('search_channels_placeholder');
  sections[2].querySelector('.small-text').textContent = t('tip_channel_id');

  // Connection Mode
  sections[3].querySelector('h3').textContent = t('connection_mode');
  document.getElementById('mode-lite').innerHTML = `<span class="mode-icon">🎈</span> ${t('lite_mode')}`;
  document.getElementById('mode-pro').innerHTML = `<span class="mode-icon">🚀</span> ${t('pro_mode')}`;

  // Update Mode Desc Box (based on current mode)
  const isLite = document.getElementById('mode-lite').classList.contains('active');
  document.getElementById('mode-title-text').textContent = isLite ? t('lite_mode_title') : t('pro_mode_title');
  document.getElementById('mode-desc-text').textContent = isLite ? t('lite_mode_desc') : t('pro_mode_desc');

  // API Section Labels & Help
  document.querySelector('#api-section label').textContent = t('api_key_label');
  document.getElementById('api-key-input').placeholder = t('api_key_placeholder');
  document.getElementById('get-free-key-link').textContent = t('get_free_key');
  document.getElementById('toggle-api-help').textContent = t('how_to_get_key');
  document.getElementById('save-api-key').textContent = t('save_settings');

  // API Help Content
  document.getElementById('api-help-title').textContent = t('api_help_title');
  document.getElementById('api-help-step1').firstChild.textContent = t('api_help_step1'); // Preserve link
  document.getElementById('api-help-step2').textContent = t('api_help_step2');
  document.getElementById('api-help-step3').textContent = t('api_help_step3');
  document.getElementById('api-help-step4').textContent = t('api_help_step4');
  document.getElementById('api-help-step5').textContent = t('api_help_step5');
  document.getElementById('full-tutorial-link').textContent = t('full_tutorial');

  // Security Note
  document.getElementById('security-note-title').textContent = t('security_note_title');
  document.getElementById('security-note-text').textContent = t('security_note_text');

  // Content Preferences
  sections[4].querySelector('h3').textContent = t('content_preferences');
  sections[4].querySelector('span').textContent = t('filter_shorts');
  sections[4].querySelector('.small-text').innerHTML = `
    <strong>${t('lite_mode')}:</strong> ${t('lite_filter_desc')}<br>
    <strong>${t('pro_mode')}:</strong> ${t('pro_filter_desc')}
  `;

  // Participate in Ranking
  sections[5].querySelector('span').textContent = t('participate_ranking');
  sections[5].querySelector('.small-text').textContent = t('ranking_desc');

  // Gate Modal
  document.querySelector('#gate-modal h3').textContent = t('parents_only');
  document.getElementById('gate-submit').textContent = t('unlock');

  // Update active state of buttons
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === state.lang);
  });

  // Re-render dynamic content
  renderVideos();
  renderChannelList();
  updateProfileUI();
}

// DOM Elements
const videoContainer = document.getElementById('video-container');
const settingsModal = document.getElementById('settings-modal');
const playerModal = document.getElementById('player-modal');
const gateModal = document.getElementById('gate-modal');
const apiKeyInput = document.getElementById('api-key-input');
const channelList = document.getElementById('channel-list');
const apiStatus = document.getElementById('api-status');
const channelSearchInput = document.getElementById('channel-search-input');
const searchResultsDropdown = document.getElementById('search-results-dropdown');
const loginBtn = document.getElementById('google-login-btn');

// Profile Elements
const profileSelector = document.getElementById('profile-selector');
const headerProfileName = document.getElementById('header-profile-name');
const newProfileNameInput = document.getElementById('new-profile-name');
const addProfileBtn = document.getElementById('add-profile-btn');
const profileListContainer = document.getElementById('profile-list-container');
const profileDropdown = document.getElementById('profile-dropdown');
const channelNav = document.getElementById('channel-nav'); // New Element
const videoCount = document.getElementById('video-count');
const sortButtons = document.querySelectorAll('.sort-btn');

// --- Initialization ---
// --- Google User Info ---
async function fetchGoogleUserInfo() {
  if (!state.accessToken) return;
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { 'Authorization': 'Bearer ' + state.accessToken }
    });
    const userInfo = await res.json();

    if (userInfo.name) {
      const userCard = document.getElementById('google-user-info');
      const avatar = document.getElementById('google-avatar');
      const nameEl = document.getElementById('google-name');
      const emailEl = document.getElementById('google-email');

      if (userCard && avatar && nameEl) {
        userCard.classList.remove('hidden');
        userCard.style.display = 'flex'; // Ensure flex layout

        nameEl.textContent = userInfo.name;
        // Only show email if it's not super long or private, but userinfo.email is fine
        if (emailEl && userInfo.email) emailEl.textContent = userInfo.email;

        if (userInfo.picture) avatar.src = userInfo.picture;
        else avatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(userInfo.name)}&background=random`;
      }
    }
  } catch (e) {
    console.warn('Failed to fetch Google User Info', e);
  }
}

// --- Sync UI & Logout ---
function updateSyncUI() {
  const loginBtn = document.getElementById('google-login-btn');
  const logoutBtn = document.getElementById('google-logout-btn');
  const userInfoCard = document.getElementById('google-user-info');

  if (!loginBtn) return;

  if (state.accessToken) {
    // Logged In State
    loginBtn.style.display = 'block';
    loginBtn.textContent = t('sync_now');
    loginBtn.disabled = false;
    loginBtn.onclick = async () => {
      loginBtn.disabled = true;
      loginBtn.textContent = t('syncing');
      await syncWithDrive();
      loginBtn.disabled = false;
      loginBtn.textContent = t('sync_now');
    };

    if (logoutBtn) {
      logoutBtn.style.display = 'block';
      logoutBtn.textContent = t('logout');
      logoutBtn.onclick = handleLogout;
    }

    if (userInfoCard) {
      userInfoCard.classList.remove('hidden');
      userInfoCard.style.display = 'flex';
    }

    // Check if wizard needs to be closed (Restored Backup)
    const wizard = document.querySelector('.wizard-modal');
    if (wizard) {
      wizard.remove();
      if (typeof startApp === 'function') startApp();
    }

  } else {
    // Logged Out State
    loginBtn.style.display = 'block';
    loginBtn.textContent = t('login_google');
    loginBtn.disabled = false;
    loginBtn.onclick = () => {
      if (state.tokenClient) {
        state.tokenClient.requestAccessToken({ prompt: 'consent' });
      } else {
        console.warn('Google Token Client not initialized');
      }
    };

    if (logoutBtn) logoutBtn.style.display = 'none';

    if (userInfoCard) {
      userInfoCard.classList.add('hidden');
      userInfoCard.style.display = 'none';
    }
  }
}

function handleLogout() {
  if (state.accessToken) {
    const token = state.accessToken;
    state.accessToken = null;

    // Attempt revoke (best effort)
    try {
      if (window.google && window.google.accounts) {
        google.accounts.oauth2.revoke(token, () => { console.log('Token revoked'); });
      }
    } catch (e) { console.warn('Revoke failed', e); }
  }
  updateSyncUI();
  alert(t('logout_success') || 'Logged out successfully.');
}

// --- App Startup ---
let appStarted = false;

function startApp() {
  // Hide spinner when app starts proper
  const spinner = document.querySelector('.loading-state');
  if (spinner) spinner.style.display = 'none';

  // One-time setup (event listeners, GSI, etc.)
  if (!appStarted) {
    console.log('Starting App (first time setup)...');
    appStarted = true;

    setupEventListeners();
    setupDangerZoneListener();
    setupSearch();

    // Initialize GSI if not already active
    const clientId = (typeof GOOGLE_CLIENT_ID !== 'undefined' && GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID_HERE')
      ? GOOGLE_CLIENT_ID
      : localStorage.getItem('safetube_client_id');

    if (clientId) initializeGSI(clientId);
  }

  // Always run: UI updates & video fetch
  updateProfileUI();
  updateSyncUI();
  fetchMissingChannelIcons();
  fetchAllVideos();
}

function init() {
  loadLocalData();

  // Check if first-time setup is needed
  const currentProfile = getCurrentProfile();
  if (!currentProfile || !currentProfile.name) {
    // Hide spinner immediately for wizard text clarity
    const spinner = document.querySelector('.loading-state');
    if (spinner) spinner.style.display = 'none';

    showOnboardingWizard();
    return; // Pause init until wizard finishes
  }

  // Normal Start
  startApp();

  // Show Onboarding Tooltip (Login Nudge) for users who finished setup but aren't logged in
  if (currentProfile && !state.accessToken && !localStorage.getItem('onboarding_dismissed')) {
    setTimeout(() => {
      const tooltip = document.getElementById('onboarding-tooltip');
      if (tooltip) {
        const textEl = tooltip.querySelector('p');
        if (textEl) textEl.innerHTML = t('onboarding_login_tooltip');
        if (tooltip.classList.contains('hidden')) tooltip.classList.remove('hidden');
        tooltip.classList.add('show');
      }
    }, 3000);
  }
}

function showOnboardingTooltip() {
  const dismissed = localStorage.getItem('safetube_onboarding_dismissed');
  if (dismissed) return;

  // Check if this looks like a new/default setup
  const profile = getCurrentProfile();
  const isDefault = profile.name === 'Default Child' || (profile.channels.length <= 3 && !state.data.apiKey);
  if (!isDefault) return;

  // Create the tooltip element
  const tooltip = document.createElement('div');
  tooltip.id = 'onboarding-tooltip';
  tooltip.innerHTML = `
    <div class="onboarding-content">
      <div class="onboarding-title">${t('onboarding_title')}</div>
      <p class="onboarding-text">${t('onboarding_text')}</p>
      <div class="onboarding-actions">
        <button id="onboarding-go" class="onboarding-btn-primary">${t('onboarding_btn')}</button>
        <button id="onboarding-dismiss" class="onboarding-btn-dismiss">${t('onboarding_dismiss')}</button>
      </div>
    </div>
  `;

  document.body.appendChild(tooltip);

  // Animate in
  requestAnimationFrame(() => {
    tooltip.classList.add('show');
  });

  document.getElementById('onboarding-go').onclick = () => {
    dismissOnboarding(tooltip);
    settingsModal.classList.remove('hidden');
    renderChannelList();
    updateProfileUI();
  };

  document.getElementById('onboarding-dismiss').onclick = () => {
    dismissOnboarding(tooltip);
  };
}

function dismissOnboarding(tooltip) {
  localStorage.setItem('safetube_onboarding_dismissed', '1');
  tooltip.classList.remove('show');
  setTimeout(() => tooltip.remove(), 400);
}


function loadLocalData() {
  const rawData = localStorage.getItem(STORAGE_KEY_DATA);

  if (rawData) {
    state.data = JSON.parse(rawData);
  } else {
    // Migration: Check if old format exists
    const oldKey = localStorage.getItem('safetube_api_key');
    const oldChannels = localStorage.getItem('safetube_channels');

    if (oldKey || oldChannels) {
      console.log('Migrating old data...');
      state.data.apiKey = oldKey || '';
      if (oldChannels) {
        state.data.profiles[0].channels = JSON.parse(oldChannels);
      }
      saveLocalData();
    }
  }

  // Ensure strict structure
  if (!state.data.profiles) state.data = DEFAULT_DATA;
}

function saveLocalData() {
  state.data.lastUpdated = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(state.data));
  // Sync if logged in
  if (state.accessToken) saveToDrive();
}

function getCurrentProfile() {
  return state.data.profiles.find(p => p.id === state.data.currentProfileId) || state.data.profiles[0];
}

// --- GSI & Drive Sync ---
function initializeGSI(clientId) {
  if (!window.google) {
    setTimeout(() => initializeGSI(clientId), 500);
    return;
  }

  try {
    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: async (response) => {
        if (response.error !== undefined) {
          throw (response);
        }
        state.accessToken = response.access_token;

        // Show syncing state
        const loginBtn = document.getElementById('google-login-btn');
        if (loginBtn) {
          loginBtn.textContent = t('syncing');
          loginBtn.disabled = true;
        }

        await fetchGoogleUserInfo().catch(console.warn);
        await syncWithDrive();

        // Reset UI to Logged In state
        updateSyncUI();

        // After sync, upload stats with correct channel data (force=true)
        checkAndUploadStats(true);

        loginBtn.textContent = 'Sync Now (Re-sync)';
        loginBtn.disabled = false; // Re-enable for manual sync
        loginBtn.onclick = async () => {
          loginBtn.textContent = 'Syncing...';
          loginBtn.disabled = true;
          await syncWithDrive();
          loginBtn.textContent = 'Sync Now (Re-sync)';
          loginBtn.disabled = false;
        };
      },
    });
    loginBtn.style.display = 'block';
    // If we already have a token (rare in this flow but possible), update UI
    if (state.accessToken) {
      fetchGoogleUserInfo();
      loginBtn.textContent = 'Sync Now (Re-sync)';
    } else {
      loginBtn.textContent = 'Login with Google to Sync';
    }

  } catch (e) {
    console.error("GSI Init Error", e);
  }
}

async function syncWithDrive() {
  const fileId = await findConfigFile();

  if (!fileId) {
    console.log('No config file found on Drive, creating new...');
    await saveToDrive(); // First time sync (Upload)
    alert(t('save_drive_success'));
    return;
  }

  const driveConfig = await downloadConfigFile(fileId);
  if (!driveConfig) {
    // File exists but empty/corrupt? Try saving local.
    await saveToDrive();
    return;
  }

  // Compare Timestamps
  const localTime = state.data.lastUpdated ? new Date(state.data.lastUpdated).getTime() : 0;
  const cloudTime = driveConfig.lastUpdated ? new Date(driveConfig.lastUpdated).getTime() : 0;

  console.log(`Sync Check: Local (${state.data.lastUpdated}) vs Cloud (${driveConfig.lastUpdated})`);

  if (localTime > cloudTime) {
    // Local is newer: Upload
    console.log('Local is newer, uploading to Drive...');
    await saveToDrive();
    alert(t('save_drive_success')); // "Saved to Drive"

  } else if (cloudTime > localTime) {
    // Cloud is newer: Download
    console.log('Cloud is newer, downloading from Drive...');
    if (driveConfig.profiles && Array.isArray(driveConfig.profiles)) {
      state.data = driveConfig;
      saveLocalData(); // Save to localStorage
      updateProfileUI();
      renderChannelList();

      if (state.data.apiKey) {
        fetchAllVideos(true);
        setTimeout(fetchMissingChannelIcons, 1000);
      }
      alert(t('loaded_from_drive')); // "Loaded from Drive"
    }

  } else {
    // Timestamps equal or no meaningful diff
    console.log('Sync: Data is up to date.');
    alert(t('sync_complete')); // New key needed
  }
}

// Old implementations removed. Using the new ones at the top.

// --- Video Fetching ---
const CORS_PROXY = 'https://api.allorigins.win/get?url=';

// --- Video Fetching ---
const CACHE_DURATION = 1000 * 60 * 60; // 1 Hour

async function fetchAllVideos(forceRefresh = false) {
  const profile = getCurrentProfile();

  if (!profile.channels || profile.channels.length === 0) {
    state.videos = [];
    renderVideos();
    apiStatus.textContent = t('no_channels');
    return;
  }

  // 0. Decide Mode: API Key vs RSS (Lite Mode)
  const useLiteMode = !state.data.apiKey;

  // 1. Check Cache (Works for both modes)
  const cacheKey = `safetube_cache_${profile.id}`;
  const cachedData = localStorage.getItem(cacheKey);

  if (!forceRefresh && cachedData) {
    try {
      const { timestamp, videos } = JSON.parse(cachedData);
      const age = Date.now() - timestamp;
      if (age < CACHE_DURATION) {
        const currentChannelIds = new Set(profile.channels.map(c => c.id));
        const validVideos = videos.filter(v => currentChannelIds.has(v.channelId));

        if (validVideos.length > 0) {
          console.log('Using cached videos (filtered)');
          state.videos = validVideos;
          state.activeChannelId = null;
          state.currentSort = 'newest';
          renderChannelNav();
          updateSortUI();
          renderVideos();
          apiStatus.textContent = t('loaded_from_cache', { age: Math.round(age / 60000) });
          apiStatus.style.color = '#4ecdc4';
          return;
        } else if (videos.length > 0) {
          console.log('Cache invalid (all videos belong to deleted channels), fetching fresh...');
        }
      }
    } catch (e) {
      console.warn('Cache parse error', e);
    }
  }

  // 2. Show Loading UI
  videoContainer.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>${useLiteMode ? (t('loading_lite_mode') || '🌐 Loading videos (Free Mode)...') : t('loading_videos', { name: profile.name })}</p>
      ${useLiteMode ? `<p class="small-text" style="color:#999; margin-top:8px;">${t('lite_mode_hint') || 'No API key needed! Using public feeds.'}</p>` : ''}
    </div>
  `;

  try {
    let checkVideos = [];

    if (useLiteMode) {
      // --- Lite Mode (RSS) with Progressive Rendering ---
      console.log('Fetching videos via Lite Mode (RSS)...');
      let loadedCount = 0;
      const totalChannels = profile.channels.length;

      // Process channels and render progressively
      const promises = profile.channels.map(async (channel) => {
        try {
          const videos = await fetchChannelRSS(channel);
          loadedCount++;

          // Add to state and re-render as each channel loads
          if (videos.length > 0) {
            checkVideos.push(...videos);
            checkVideos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
            state.videos = [...checkVideos];

            // Progressive render
            state.activeChannelId = null;
            state.currentSort = 'newest';
            renderChannelNav();
            updateSortUI();
            renderVideos();
          }

          apiStatus.textContent = `Loading channels... ${loadedCount}/${totalChannels}`;
          apiStatus.style.color = '#FFA500';
          return videos;
        } catch (e) {
          loadedCount++;
          console.warn(`Failed to fetch ${channel.name}:`, e);
          return [];
        }
      });

      await Promise.all(promises);

      // Final state
      if (checkVideos.length === 0) {
        console.warn('RSS returned no videos, falling back to demo content');
        checkVideos = MOCK_VIDEOS;

        videoContainer.innerHTML = `<div style="text-align:center; padding: 2rem;">
            <p style="font-size: 1.2rem;">🎬</p>
            <p style="font-weight: 600; margin: 10px 0;">${t('no_videos_yet') || 'Videos are loading...'}</p>
            <p class="small-text" style="color: #888; max-width: 300px; margin: 0 auto;">${t('lite_mode_slow_hint') ||
          'Free Mode uses public feeds which may be slow. For instant loading, add a YouTube API Key in Settings ⚙️'}</p>
          </div>`;

        apiStatus.textContent = t('status_demo_mode') || 'Demo Mode';
        apiStatus.style.color = '#FFA500';
      } else {
        apiStatus.textContent = `✅ ${checkVideos.length} videos loaded (Free Mode)`;
        apiStatus.style.color = '#4ecdc4';
      }

    } else {
      // --- API Mode ---
      const validChannels = profile.channels.filter(c => c && c.id);
      const promises = validChannels.map(channel => fetchChannelVideos(channel));
      const results = await Promise.all(promises);
      checkVideos = results.flat().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

      apiStatus.textContent = t('status_updated');
      apiStatus.style.color = '#4ecdc4';

      fetchMissingChannelIcons(); // Only in Full API Mode
    }

    state.videos = checkVideos;

    // Save to Cache
    const cacheKey2 = `safetube_cache_${profile.id}`;
    localStorage.setItem(cacheKey2, JSON.stringify({
      timestamp: Date.now(),
      videos: state.videos
    }));

    if (!useLiteMode) saveLocalData();

    state.activeChannelId = null;
    state.currentSort = 'newest';

    renderChannelNav();
    updateSortUI();
    renderVideos();

  } catch (error) {
    if (useLiteMode) {
      console.error('RSS Lite Mode Error:', error);
      apiStatus.textContent = 'Error: Cannot fetch RSS feed.';
      apiStatus.style.color = '#ff6b6b';
      videoContainer.innerHTML = `<div style="text-align:center; padding: 2rem;">
            <p>😕 Free Mode encountered an error.</p>
            <p class="small-text" style="margin-top: 8px;">Try refreshing, or add a YouTube API Key in Settings for better reliability.</p>
        </div>`;
    } else {
      console.error('Error fetching videos:', error);
      apiStatus.textContent = 'Error: ' + error.message;
      apiStatus.style.color = '#ff6b6b';
      videoContainer.innerHTML = `<div style="text-align:center; padding: 2rem;">
            <p>😕 Something went wrong (API Mode).</p>
            <p style="color:red; font-size: 0.8rem;">${error.message}</p>
            <p>Check API Key or internet.</p>
        </div>`;
    }
  }
}

// --- Lite Mode: RSS Fetcher ---
async function fetchChannelRSS(channel) {
  // Public YouTube RSS Feed URL
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`;

  // CORS Proxies - ordered by reliability (corsproxy.io verified working)
  const proxyConfigs = [
    { url: `https://corsproxy.io/?url=${encodeURIComponent(rssUrl)}`, type: 'text' },
    { url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(rssUrl)}`, type: 'text' },
    { url: `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`, type: 'json' },
    { url: `https://thingproxy.freeboard.io/fetch/${rssUrl}`, type: 'text' }
  ];

  for (const proxy of proxyConfigs) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

      const res = await fetch(proxy.url, { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timeoutId);

      // Fail fast on non-OK status
      if (!res.ok) continue;

      let xmlText;
      if (proxy.type === 'json') {
        const data = await res.json();
        if (!data.contents) continue;
        xmlText = data.contents;
      } else {
        xmlText = await res.text();
        if (!xmlText || !xmlText.includes('<feed')) continue; // Must look like XML
      }

      // Parse XML
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      const entries = xmlDoc.getElementsByTagName("entry");

      const videos = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        // Robust tag finding for different browsers/parsers
        const videoId = (entry.getElementsByTagName("yt:videoId")[0] || entry.getElementsByTagName("videoId")[0])?.textContent;
        const title = (entry.getElementsByTagName("title")[0])?.textContent;
        const published = (entry.getElementsByTagName("published")[0])?.textContent;

        if (videoId && title) {
          // Filter Shorts by Title (RSS Limitation)
          const titleLower = title.toLowerCase();
          const isShortsKeyword = /#shorts|\[shorts\]|\(shorts\)|^shorts$| shorts$/.test(titleLower);

          if (state.data.filterShorts && isShortsKeyword) {
            continue;
          }

          const thumb = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

          videos.push({
            id: videoId,
            title: title,
            thumbnail: thumb,
            channelTitle: channel.name,
            channelId: channel.id,
            publishedAt: published
          });
        }
      }
      return videos;

    } catch (e) {
      console.warn(`RSS proxy failed for ${channel.name}`, e);
      continue; // Try next proxy
    }
  }

  // All proxies failed
  console.warn(`All RSS proxies failed for ${channel.name}`);
  return [];
}

async function fetchChannelVideos(channel) {
  // Optimization: If we already have uploadsId, skip first call
  let uploadsPlaylistId = channel.uploadsId;

  if (!uploadsPlaylistId) {
    // Fetch uploads ID cost: 1 unit
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channel.id}&key=${state.data.apiKey}`;
    try {
      const chRes = await fetch(channelUrl);
      const chData = await chRes.json();

      if (!chData.items || chData.items.length === 0) return [];
      uploadsPlaylistId = chData.items[0].contentDetails.relatedPlaylists.uploads;

      // Save for next time!
      channel.uploadsId = uploadsPlaylistId;
    } catch (e) {
      console.error(`Failed to fetch channel details for ${channel.id}`, e);
      return [];
    }
  }

  // Fetch Videos cost: 1 unit
  // Increased maxResults to 20 to buffer for Shorts filtering
  const plUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=20&key=${state.data.apiKey}`;

  try {
    const plRes = await fetch(plUrl);
    const plData = await plRes.json();

    if (!plData.items) return [];

    const rawItems = plData.items;

    // --- Shorts Filtering (API Mode) ---
    // We need to fetch 'contentDetails' to check duration. 
    // This costs 1 extra unit per batch, but ensures accuracy.
    const videoIds = rawItems.map(item => item.snippet.resourceId.videoId).join(',');
    const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${state.data.apiKey}`;

    let allowedIds = new Set();

    try {
      const dRes = await fetch(detailsUrl);
      const dData = await dRes.json();

      if (dData.items) {
        dData.items.forEach(v => {
          const duration = parseDuration(v.contentDetails.duration);

          // Filter: Updated for new YouTube Shorts policy (up to 3 mins)
          // If duration > 180 seconds (3 mins), it's definitely NOT a Short.
          if (duration > 180) {
            allowedIds.add(v.id);
          } else {
            console.log(`Filtered Short: ${v.snippet?.title || v.id} (${duration}s)`);
          }
        });
      }
    } catch (err) {
      console.warn('Failed to fetch video durations, skipping filter', err);
      // Fallback: Allow all if detailed check fails
      rawItems.forEach(item => allowedIds.add(item.snippet.resourceId.videoId));
    }

    return rawItems
      .filter(item => allowedIds.has(item.snippet.resourceId.videoId))
      .map(item => ({
        id: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url,
        channelTitle: item.snippet.channelTitle,
        channelId: channel.id, // Store Channel ID
        publishedAt: item.snippet.publishedAt
      }));

  } catch (e) {
    console.error(`Failed to fetch videos for ${channel.id}`, e);
    return [];
  }
}

// Helper: Parse ISO 8601 Duration to Seconds
function parseDuration(duration) {
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  if (!match) return 0;

  const hours = (parseInt(match[1]) || 0);
  const minutes = (parseInt(match[2]) || 0);
  const seconds = (parseInt(match[3]) || 0);

  return (hours * 3600) + (minutes * 60) + seconds;
}

// --- Sorting Logic ---
function sortVideos(sortType) {
  state.currentSort = sortType;
  updateSortUI();
  renderVideos();
}

function updateSortUI() {
  sortButtons.forEach(btn => {
    if (btn.dataset.sort === state.currentSort) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function getSortedVideos(videos) {
  const v = [...videos]; // Copy array
  if (state.currentSort === 'newest') {
    return v.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  } else if (state.currentSort === 'oldest') {
    return v.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
  } else if (state.currentSort === 'shuffle') {
    // Fisher-Yates Shuffle
    for (let i = v.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [v[i], v[j]] = [v[j], v[i]];
    }
    return v;
  }
  return v;
}

// --- Icon Auto-Fetch ---
async function fetchMissingChannelIcons() {
  const profile = getCurrentProfile();
  // Find channels without thumbnails
  let missingIcons = profile.channels.filter(c => !c.thumbnail);
  if (missingIcons.length === 0) return;

  // Option 1: Official YouTube API (if key exists)
  if (state.data.apiKey) {
    console.log(`Fetching icons via YouTube API for ${missingIcons.length} channels...`);
    const ids = missingIcons.map(c => c.id).join(',');
    const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${ids}&key=${state.data.apiKey}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.items) {
        let updated = false;
        data.items.forEach(item => {
          const channel = profile.channels.find(c => c.id === item.id);
          if (channel) {
            channel.thumbnail = item.snippet.thumbnails.default?.url;
            updated = true;
          }
        });
        if (updated) finalizeIconUpdate();
      }
    } catch (e) {
      console.warn('YouTube API icon fetch failed', e);
    }
  }

  // Recheck what's still missing
  missingIcons = profile.channels.filter(c => !c.thumbnail);
  if (missingIcons.length === 0) return;

  // Option 2: Ranking API Fallback (Google Sheet)
  try {
    console.log(`Fetching icons via Google Sheet (Rankings) for ${missingIcons.length} channels...`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    // Append timestamp to avoid caching
    const response = await fetch(STATS_ENDPOINT + '?action=getRankings&t=' + Date.now(), { signal: controller.signal });
    clearTimeout(timeoutId);

    const data = await response.json();
    if (data.channels) {
      let updated = false;
      missingIcons.forEach(missing => {
        // Strict ID Match Only (User Request)
        const match = data.channels.find(rank => rank.id === missing.id);

        if (match && match.thumbnail) {
          console.log(`Found icon for ${missing.name}: ${match.thumbnail}`);
          missing.thumbnail = match.thumbnail;
          updated = true;
        }
      });
      if (updated) finalizeIconUpdate();
    }
  } catch (e) {
    console.warn('Google Sheet icon fetch failed', e);
  }

  // Recheck what's still missing
  missingIcons = profile.channels.filter(c => !c.thumbnail);
  if (missingIcons.length === 0) return;

  // Option 3: Scrape YouTube channel page for og:image via CORS proxy
  console.log(`Scraping YouTube pages for ${missingIcons.length} channel icons...`);
  for (const channel of missingIcons) {
    try {
      const pageUrl = `https://www.youtube.com/channel/${channel.id}`;
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(pageUrl)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (data.contents) {
        // Extract og:image from HTML
        const match = data.contents.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
        if (match && match[1]) {
          channel.thumbnail = match[1];
          finalizeIconUpdate();
        }
      }
    } catch (e) {
      console.warn(`Page scrape failed for ${channel.name}`, e);
    }
  }
}

function finalizeIconUpdate() {
  saveLocalData();
  renderChannelNav();
  if (state.accessToken) saveToDrive();
}


// --- Channel Search ---
let searchDebounce;

// --- Fetch Top Ranked Channels from Stats ---
async function fetchTopRankedChannels() {
  try {
    const response = await fetch(STATS_ENDPOINT + '?action=getRankings');
    const data = await response.json();

    if (!data.channels || !Array.isArray(data.channels)) {
      return [];
    }

    // Transform the ranking data to match the search result format
    return data.channels.map(ch => ({
      snippet: {
        channelId: ch.id,
        channelTitle: ch.name,
        description: `${ch.count || 0} users subscribed`,
        thumbnails: {
          default: {
            url: ch.thumbnail || `https://ui-avatars.com/api/?name=${encodeURIComponent(ch.name)}&size=88&background=random`
          }
        }
      }
    }));
  } catch (e) {
    console.warn('Failed to fetch top ranked channels', e);
    return [];
  }
}

async function searchChannels(query) {
  if (!state.data.apiKey) {
    alert('Please enter a valid API Key first.');
    return;
  }
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(query)}&maxResults=5&key=${state.data.apiKey}`;
  try {
    const res = await fetch(searchUrl);
    const data = await res.json();
    renderSearchResults(data.items || []);
  } catch (error) {
    console.error('Search error:', error);
  }
}

function renderSearchResults(items) {
  if (items.length === 0) {
    searchResultsDropdown.innerHTML = '<li style="padding:10px;">No channels found.</li>';
    searchResultsDropdown.classList.remove('hidden');
    return;
  }
  searchResultsDropdown.innerHTML = '';
  items.forEach(item => {
    const li = document.createElement('li');
    li.className = 'search-result-item';
    li.onclick = () => addChannelFromSearch(item);
    const thumb = item.snippet.thumbnails.default?.url;
    const fallbackThumb = `https://ui-avatars.com/api/?name=${encodeURIComponent(item.snippet.channelTitle)}&size=88&background=random`;
    li.innerHTML = `
      <img src="${thumb || fallbackThumb}" class="search-avatar" onerror="this.onerror=null;this.src='${fallbackThumb}'" />
      <div class="search-info">
        <span class="search-name">${item.snippet.channelTitle}</span>
        <span class="search-sub">${item.snippet.description.substring(0, 30)}...</span>
      </div>
    `;
    searchResultsDropdown.appendChild(li);
  });
  searchResultsDropdown.classList.remove('hidden');
}

function addChannelFromSearch(item) {
  const profile = getCurrentProfile();
  const newChannel = {
    id: item.snippet.channelId,
    name: item.snippet.channelTitle,
    thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.high?.url || item.snippet.thumbnails.default?.url || '' // Store Thumbnail
  };

  if (profile.channels.some(c => c.id === newChannel.id)) {
    alert('Channel already added!');
    return;
  }

  profile.channels.push(newChannel);
  saveLocalData();
  renderChannelList();
  renderChannelNav(); // Update Nav

  channelSearchInput.value = '';
  searchResultsDropdown.classList.add('hidden');
  fetchAllVideos(); // Will refresh videos
}


// --- Rendering ---
// --- Avatar Picker Logic ---
function openAvatarPicker(profileId) {
  // Check if picker already exists
  let picker = document.getElementById('avatar-picker-overlay');

  if (!picker) {
    picker = document.createElement('div');
    picker.id = 'avatar-picker-overlay';
    picker.className = 'avatar-picker-overlay hidden';
    picker.innerHTML = `
      <div class="avatar-picker-content">
        <h3 style="margin-top:0; margin-bottom: 20px;">Pick an Avatar 🎨</h3>
        <div class="avatar-grid" id="avatar-grid"></div>
        <button id="close-avatar-picker-btn" class="secondary-btn" style="margin-top:1.5rem; width:100%;">Cancel</button>
      </div>
    `;
    document.body.appendChild(picker);

    // Close logic
    const closeBtn = document.getElementById('close-avatar-picker-btn');
    if (closeBtn) closeBtn.onclick = () => picker.classList.add('hidden');

    picker.onclick = (e) => {
      if (e.target === picker) picker.classList.add('hidden');
    };
  }

  const grid = document.getElementById('avatar-grid');
  grid.innerHTML = '';

  AVATARS.forEach(avatar => {
    const div = document.createElement('div');
    div.className = 'avatar-option';
    div.textContent = avatar;
    div.onclick = () => {
      // Update Profile
      const profile = state.data.profiles.find(p => p.id === profileId);
      if (profile) {
        profile.avatar = avatar;
        saveLocalData();
        updateProfileUI(); // Refresh list and header
      }
      picker.classList.add('hidden');
    };
    grid.appendChild(div);
  });

  picker.classList.remove('hidden');
}


// Helper to keep Homepage Header in sync
function renderUserProfileHeader() {
  const profile = getCurrentProfile();
  headerProfileName.textContent = profile.name;
  profileSelector.classList.remove('hidden');
  renderProfileDropdown();
  renderChannelNav(); // Render nav for current profile
}

function updateProfileUI() {
  renderUserProfileHeader();
  renderProfileList();
}

function renderChannelNav() {
  if (!channelNav) return;
  const profile = getCurrentProfile();
  channelNav.innerHTML = '';

  // "All" Button
  const allBtn = document.createElement('div');
  allBtn.className = `nav-item ${state.activeChannelId === null ? 'active' : ''}`;
  allBtn.title = t('all_videos'); // Tooltip
  allBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
        <span>${t('all_videos')}</span>
    `;
  allBtn.onclick = () => filterVideos(null);
  channelNav.appendChild(allBtn);

  // Channel Buttons
  profile.channels.forEach(channel => {
    const btn = document.createElement('div');
    btn.className = `nav-item ${state.activeChannelId === channel.id ? 'active' : ''}`;
    btn.title = channel.name; // Tooltip

    let avatarSrc = channel.thumbnail;
    if (!avatarSrc) {
      // Fallback avatar
      avatarSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent(channel.name)}&background=random&size=128`;
    }

    const fallbackSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent(channel.name)}&background=random&size=128`;

    btn.innerHTML = `
            <img src="${avatarSrc}" class="nav-pill-icon" alt="${channel.name}" onerror="this.onerror=null;this.src='${fallbackSrc}'" />
            <span>${channel.name}</span>
        `;
    btn.onclick = () => filterVideos(channel.id);
    channelNav.appendChild(btn);
  });
}

function filterVideos(channelId) {
  state.activeChannelId = channelId;
  const label = document.getElementById('active-channel-display');

  if (label) {
    label.classList.remove('show');
    // Short delay for fade effect
    setTimeout(() => {
      if (channelId === null) {
        label.textContent = t('all_videos');
      } else {
        const channel = getCurrentProfile().channels.find(c => c.id === channelId);
        label.textContent = channel ? channel.name : "Unknown Channel";
      }
      label.classList.add('show');
    }, 150);
  }

  renderChannelNav(); // Update visual state
  renderVideos();     // Re-render video list
}

function renderProfileDropdown() {
  if (!profileDropdown) return;
  profileDropdown.innerHTML = '';
  // Force show
  profileDropdown.classList.remove('hidden');

  state.data.profiles.forEach(p => {
    // Ensure avatar exists (migration)
    if (!p.avatar) p.avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];

    const li = document.createElement('li');
    li.className = 'profile-dropdown-item';
    if (p.id === state.data.currentProfileId) li.classList.add('active');

    // Add icon for better visual
    li.innerHTML = `<span style="margin-right:6px; font-size:1.2rem;">${p.avatar}</span> ${p.name}`;

    li.onclick = (e) => {
      e.stopPropagation();
      switchProfile(p.id);
    };
    profileDropdown.appendChild(li);
  });
}

function renderProfileList() {
  if (!profileListContainer) return;
  profileListContainer.innerHTML = '';

  state.data.profiles.forEach((p, index) => {
    // Ensure avatar exists (migration)
    if (!p.avatar) p.avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];

    const div = document.createElement('div');
    div.className = `profile-list-item ${p.id === state.data.currentProfileId ? 'active' : ''}`;
    div.draggable = true; // Enable Drag
    div.dataset.index = index;

    // Drag Events
    div.ondragstart = (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index);
      div.classList.add('dragging');
    };
    div.ondragend = () => {
      div.classList.remove('dragging');
      document.querySelectorAll('.profile-list-item').forEach(item => item.classList.remove('drag-over'));
    };
    div.ondragover = (e) => {
      e.preventDefault();
      div.classList.add('drag-over');
    };
    div.ondragleave = () => {
      div.classList.remove('drag-over');
    };
    div.ondrop = (e) => {
      e.preventDefault();
      const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
      const toIndex = index;

      if (fromIndex !== toIndex) {
        // Reorder Array
        const movedItem = state.data.profiles.splice(fromIndex, 1)[0];
        state.data.profiles.splice(toIndex, 0, movedItem);

        saveLocalData();
        updateProfileUI(); // Re-render everything
      }
    };

    div.innerHTML = `
            <div class="profile-info-row" style="display:flex; align-items:center; width:100%; gap: 10px;">
                <span class="drag-handle" style="cursor: grab; color: #ccc; font-size: 1.2rem; padding: 5px;">⣿</span>
                
                <button class="avatar-btn" title="Click to change avatar" style="background: #f0f0f0; border:none; font-size: 1.5rem; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; transition: transform 0.2s;">
                  ${p.avatar}
                </button>

                <div class="profile-click-area" style="flex:1; display:flex; flex-direction:column; justify-content:center; cursor: pointer;">
                    <span style="font-weight:600; font-size:1rem;">${p.name}</span>
                    <span style="font-size:0.8rem; color:#888;">${p.channels.length} channels</span>
                </div>

                <div class="profile-actions" style="margin-left: auto; display: flex; align-items: center; gap: 8px;">
                    ${p.id === state.data.currentProfileId
        ? `<span class="status-badge active" style="background:#e6fffa; color:#2c7a7b; padding:4px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;">${t('current_badge')}</span>`
        : ''
      }
                    <button class="btn-icon btn-edit" data-id="${p.id}" title="Rename">✏️</button>
                    ${state.data.profiles.length > 1 ? `<button class="btn-icon btn-delete" data-id="${p.id}" title="Delete">🗑️</button>` : ''}
                </div>
            </div>
        `;

    // Avatar Change Logic (Picker Modal)
    const avatarBtn = div.querySelector('.avatar-btn');
    avatarBtn.onclick = (e) => {
      e.stopPropagation();
      openAvatarPicker(p.id);
    };

    avatarBtn.onmouseenter = () => avatarBtn.style.transform = 'scale(1.1)';
    avatarBtn.onmouseleave = () => avatarBtn.style.transform = 'scale(1)';

    // Make the text area clickable to switch
    const clickArea = div.querySelector('.profile-click-area');
    if (clickArea && p.id !== state.data.currentProfileId) {
      clickArea.onclick = () => switchProfile(p.id);
      clickArea.title = "Click to switch";
    }

    profileListContainer.appendChild(div);
  });

  // Attach listeners (Edit/Delete)
  profileListContainer.querySelectorAll('.btn-edit').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); editProfileName(btn.dataset.id); };
  });
  profileListContainer.querySelectorAll('.btn-delete').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); deleteProfile(btn.dataset.id); };
  });
}

function renderVideos() {
  videoContainer.innerHTML = '';

  // Filter logic
  let displayVideos = state.videos;
  if (state.activeChannelId) {
    displayVideos = state.videos.filter(v => v.channelId === state.activeChannelId);
  }

  // Sort
  displayVideos = getSortedVideos(displayVideos);

  // Update Count
  if (videoCount) {
    videoCount.textContent = t('video_count', { count: displayVideos.length });
  }

  if (displayVideos.length === 0) {
    if (state.activeChannelId) {
      videoContainer.innerHTML = `<p style="text-align:center; width: 100%;">${t('no_videos_channel')}</p>`;
    } else {
      videoContainer.innerHTML = `<p style="text-align:center; width: 100%;">${t('no_videos_found')}</p>`;
    }
    return;
  }

  displayVideos.forEach(video => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.onclick = () => openPlayer(video);
    card.innerHTML = `
      <div class="thumbnail-wrapper">
        <img src="${video.thumbnail}" alt="${video.title}" class="thumbnail-img" loading="lazy" />
        <div class="play-icon-overlay">▶</div>
      </div>
      <div class="card-content">
        <h3 class="card-title">${video.title}</h3>
        <div class="card-meta">
          <span>${video.channelTitle}</span>
          <span>${new Date(video.publishedAt).toLocaleDateString()}</span>
        </div>
      </div>
    `;
    videoContainer.appendChild(card);
  });
}

function renderChannelList() {
  const profile = getCurrentProfile();
  channelList.innerHTML = '';
  profile.channels.forEach((channel, index) => {
    const li = document.createElement('li');
    li.className = 'channel-item';
    li.draggable = true;
    li.dataset.index = index;

    // Drag Events
    li.ondragstart = (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index);
      li.classList.add('dragging');
    };
    li.ondragend = () => {
      li.classList.remove('dragging');
      document.querySelectorAll('.channel-item').forEach(item => item.classList.remove('drag-over'));
    };
    li.ondragover = (e) => {
      e.preventDefault();
      li.classList.add('drag-over');
    };
    li.ondragleave = () => {
      li.classList.remove('drag-over');
    };
    li.ondrop = (e) => {
      e.preventDefault();
      const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
      const toIndex = index;

      if (fromIndex !== toIndex) {
        // Reorder Array
        const movedItem = profile.channels.splice(fromIndex, 1)[0];
        profile.channels.splice(toIndex, 0, movedItem);

        saveLocalData();
        renderChannelList();
        renderChannelNav();
      }
    };

    li.innerHTML = `
      <div class="channel-item-content">
        <span class="drag-handle">⣿</span>
        <span class="channel-name">${channel.name || channel.id}</span>
      </div>
      <button class="remove-btn" data-index="${index}" title="${t('remove_channel')}">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      </button>
    `;
    channelList.appendChild(li);
  });

  document.querySelectorAll('.remove-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = btn.closest('.remove-btn').getAttribute('data-index');
      profile.channels.splice(idx, 1);
      saveLocalData();
      renderChannelList();
      renderChannelNav(); // Update nav on remove
      saveToDrive();
    };
  });
}

// --- Player Logic ---
function openPlayer(video) {
  const embedUrl = `https://www.youtube.com/embed/${video.id}?autoplay=1&rel=0&modestbranding=1`;
  document.getElementById('youtube-player').innerHTML = `
    <iframe width="100%" height="100%" src="${embedUrl}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
  `;
  document.getElementById('video-title').textContent = video.title;
  document.getElementById('video-channel').textContent = video.channelTitle;
  playerModal.classList.remove('hidden');
}

function closePlayer() {
  playerModal.classList.add('hidden');
  document.getElementById('youtube-player').innerHTML = '';
}

// --- Profile Actions ---

function addProfile(name) {
  if (!name) return;
  const newId = 'child_' + Date.now();
  state.data.profiles.push({
    id: newId,
    name: name,
    avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)], // Random Avatar
    channels: []
  });
  saveLocalData();
  updateProfileUI();
  newProfileNameInput.value = '';
}

function switchProfile(id) {
  state.data.currentProfileId = id;
  state.activeChannelId = null; // Reset filter on switch
  saveLocalData();
  updateProfileUI();
  renderChannelList();
  fetchAllVideos();
  fetchMissingChannelIcons();
}

function editProfileName(id) {
  const profile = state.data.profiles.find(p => p.id === id);
  if (!profile) return;

  const newName = prompt(t('rename_prompt', { name: profile.name }), profile.name);
  if (newName && newName.trim() !== "") {
    profile.name = newName.trim();
    saveLocalData();
    updateProfileUI();
    if (state.data.currentProfileId === id) {
      headerProfileName.textContent = profile.name;
    }
  }
}

function deleteProfile(id) {
  if (confirm(t('confirm_delete_profile'))) {
    state.data.profiles = state.data.profiles.filter(p => p.id !== id);
    // If deleted current, switch to first available
    if (state.data.currentProfileId === id) {
      state.data.currentProfileId = state.data.profiles[0].id; // There should always be at least one
    }
    saveLocalData();
    updateProfileUI();
    renderChannelList();
    fetchAllVideos();
  }
}

// --- Anonymous Stats Sharing ---
async function checkAndUploadStats(force = false) {
  if (!state.data.shareStats) return;

  const lastUpload = localStorage.getItem(STORAGE_KEY_STATS);
  const ONE_DAY = 24 * 60 * 60 * 1000;

  // Check if uploaded within last 24 hours
  if (!force && lastUpload && (Date.now() - parseInt(lastUpload) < ONE_DAY)) {
    console.log('Stats already uploaded today.');
    return;
  }

  // Check if we have an anonymous ID (should exist if shareStats is true)
  if (!state.data.anonymousUserId) {
    state.data.anonymousUserId = crypto.randomUUID ? crypto.randomUUID() : 'user_' + Date.now();
    saveLocalData();
    if (state.accessToken) saveToDrive(); // Force push ID to cloud
  }

  console.log('Uploading anonymous stats...');

  // Prepare Data: Aggregate ALL channels from ALL profiles
  const allChannelsMap = new Map();
  state.data.profiles.forEach(p => {
    p.channels.forEach(c => {
      if (!allChannelsMap.has(c.id)) {
        allChannelsMap.set(c.id, { id: c.id, name: c.name, thumbnail: c.thumbnail || '' });
      }
    });
  });

  const payload = {
    userId: state.data.anonymousUserId,
    channels: Array.from(allChannelsMap.values())
  };

  // Send to Google Script
  try {
    // Use no-cors mode because GAS returns a redirect which fetch logic handles weirdly in browser sometimes
    // But for POST data, 'no-cors' is fine if we don't need the response content.
    // However, GAS Web App requires following redirects usually.
    // Let's try standard fetch first.

    await fetch(STATS_ENDPOINT, {
      method: 'POST',
      mode: 'no-cors', // Important for GAS Web App to avoid CORS errors
      // headers removed for no-cors
      body: JSON.stringify(payload)
    });

    console.log('Stats uploaded successfully.');
    localStorage.setItem(STORAGE_KEY_STATS, Date.now().toString());

  } catch (e) {
    console.warn('Failed to upload stats', e);
  }
}

// --- Event Listeners ---
function setupEventListeners() {
  document.getElementById('refresh-btn').onclick = fetchAllVideos;

  // Language Switcher
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      setLanguage(btn.dataset.lang);
    };
  });

  // Header Profile Switcher Dropdown Toggle
  profileSelector.onclick = (e) => {
    e.stopPropagation();
    profileDropdown.classList.toggle('hidden');
  };

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!profileDropdown.classList.contains('hidden') && !profileSelector.contains(e.target)) {
      profileDropdown.classList.add('hidden');
    }
  });

  // Sort Buttons
  // Sort Buttons - Replace with SVG content if not already done in HTML, 
  // but better to just update HTML structure or let JS handle active states.
  // Actually, let's update the HTML for sort buttons to have SVGs directly.
  // Wait, I should do this in HTML or JS. Since I can't edit HTML easily for all 3 buttons without replacing a block, 
  // I will inject the SVGs on init or just assume the user wants me to change the HTML file.
  // Let's change the JS to inject SVGs into those buttons if they exist, or better yet, I will use replace_file_content on index.html next.
  // For now, let's just keep the JS logic the same.
  sortButtons.forEach(btn => {
    btn.onclick = () => sortVideos(btn.dataset.sort);
  });

  document.getElementById('settings-btn').onclick = () => {
    // Open Settings Directly (No Parent Gate)
    settingsModal.classList.remove('hidden');
    // Refresh Lists just in case
    renderChannelList();
    updateProfileUI();
    const apiKeyInput = document.getElementById('api-key-input');
    if (apiKeyInput) apiKeyInput.value = state.data.apiKey;

    // Load Stats Checkbox
    const shareStatsCb = document.getElementById('share-stats-checkbox');
    if (shareStatsCb) shareStatsCb.checked = !!state.data.shareStats;
  };

  document.getElementById('close-settings').onclick = () => {
    settingsModal.classList.add('hidden');
    searchResultsDropdown.classList.add('hidden');
  };

  // UX: Close Modal on Overlay Click
  settingsModal.onclick = (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.add('hidden');
      searchResultsDropdown.classList.add('hidden');
    }
  };

  // UX: Close Modal on Escape Key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!settingsModal.classList.contains('hidden')) {
        settingsModal.classList.add('hidden');
        searchResultsDropdown.classList.add('hidden');
      }
      if (!gateModal.classList.contains('hidden')) {
        gateModal.classList.add('hidden');
      }
      if (!playerModal.classList.contains('hidden')) {
        // Player modal might need special cleanup if playing
        playerModal.classList.add('hidden');
        const player = document.getElementById('player-iframe');
        if (player) player.src = '';
      }
    }
  });

  // Stats Toggle Listener
  const shareStatsCb = document.getElementById('share-stats-checkbox');
  if (shareStatsCb) {
    shareStatsCb.onchange = (e) => {
      state.data.shareStats = e.target.checked;
      if (state.data.shareStats && !state.data.anonymousUserId) {
        // Generate UUID
        state.data.anonymousUserId = crypto.randomUUID ? crypto.randomUUID() : 'user_' + Date.now() + Math.random().toString(36).substr(2, 9);
      }
      saveLocalData();
      if (state.data.shareStats) {
        // Ensure ID exists
        if (!state.data.anonymousUserId) {
          state.data.anonymousUserId = crypto.randomUUID ? crypto.randomUUID() : 'user_' + Date.now();
        }

        // Critical: Save immediately so ID persists to Drive
        // This prevents ID regeneration on next reload/login
        saveLocalData();

        checkAndUploadStats(true); // Attempt upload immediately if opted in
      }
    };
  }

  // --- Connection Mode Logic ---
  const modeLite = document.getElementById('mode-lite');
  const modePro = document.getElementById('mode-pro');
  const apiSection = document.getElementById('api-section');
  const modeDescBox = document.getElementById('mode-desc-box');
  const modeTitle = document.getElementById('mode-title-text');
  const modeDesc = document.getElementById('mode-desc-text');
  const apiKeyInput = document.getElementById('api-key-input');
  const apiStatus = document.getElementById('api-status');

  // Helper to set UI State
  function setModeUI(isPro) {
    if (isPro) {
      modeLite.classList.remove('active');
      modePro.classList.add('active');
      apiSection.classList.add('visible');

      modeDescBox.classList.remove('lite');
      modeTitle.textContent = t('pro_mode_title');
      modeDesc.textContent = t('pro_mode_desc');
    } else {
      modePro.classList.remove('active');
      modeLite.classList.add('active');
      apiSection.classList.remove('visible');

      modeDescBox.classList.add('lite');
      modeTitle.textContent = t('lite_mode_title');
      modeDesc.textContent = t('lite_mode_desc');
    }
  }

  // Initial State Check
  if (state.data.apiKey) {
    setModeUI(true);
    apiKeyInput.value = state.data.apiKey;
  } else {
    setModeUI(false);
  }

  // Mode Switch Listeners
  modeLite.onclick = () => setModeUI(false);

  modePro.onclick = () => {
    setModeUI(true);
    // Auto-focus input if empty
    if (!apiKeyInput.value) setTimeout(() => apiKeyInput.focus(), 100);
  };

  // Toggle Eye Icon
  document.getElementById('toggle-api-visibility').onclick = () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  };

  // Toggle API Help
  const helpBtn = document.getElementById('toggle-api-help');
  if (helpBtn) {
    helpBtn.onclick = () => {
      document.getElementById('api-help-content').classList.toggle('hidden');
    };
  }

  // Save Logic
  document.getElementById('save-api-key').onclick = () => {
    const isPro = modePro.classList.contains('active');

    // Reset Toast
    apiStatus.className = 'status-toast';
    void apiStatus.offsetWidth; // trigger reflow

    if (!isPro) {
      // Saving Lite Mode
      state.data.apiKey = '';
      saveLocalData();

      apiStatus.textContent = t('status_lite_active');
      apiStatus.classList.add('success', 'show');

      searchResultsDropdown.classList.add('hidden'); // Clear search
      fetchAllVideos(true);

    } else {
      // Saving Pro Mode
      const key = apiKeyInput.value.trim();
      if (!key) {
        apiStatus.textContent = t('status_pro_warning');
        apiStatus.classList.add('warning', 'show');
        apiKeyInput.focus();
        return;
      }

      state.data.apiKey = key;
      saveLocalData();

      apiStatus.textContent = t('status_pro_active');
      apiStatus.classList.add('success', 'show');
      fetchAllVideos(true);
    }

    // Auto hide toast
    setTimeout(() => {
      apiStatus.classList.remove('show');
    }, 3000);
  };

  if (loginBtn) {
    loginBtn.onclick = () => {
      if (state.tokenClient) {
        // Force consent prompt to ensure permissions are granted
        state.tokenClient.requestAccessToken({ prompt: 'consent' });
      } else {
        // Should not happen if configured correctly in code
        alert('OAuth Client ID not configured.');
      }
    };
  }

  // Profile Listeners
  addProfileBtn.onclick = () => {
    addProfile(newProfileNameInput.value.trim());
  };

  // Search Input Listeners
  channelSearchInput.addEventListener('focus', async () => {
    if (!channelSearchInput.value.trim()) {
      const topChannels = await fetchTopRankedChannels();
      renderSearchResults(topChannels);
    }
  });

  channelSearchInput.addEventListener('input', async (e) => {
    const query = e.target.value.trim();
    clearTimeout(searchDebounce);

    if (query.length === 0) {
      const topChannels = await fetchTopRankedChannels();
      renderSearchResults(topChannels);
      return;
    }

    if (query.length < 3) {
      searchResultsDropdown.classList.add('hidden');
      return;
    }
    searchDebounce = setTimeout(() => {
      searchChannels(query);
    }, 500);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
      searchResultsDropdown.classList.add('hidden');
    }
  });

  document.getElementById('close-player').onclick = closePlayer;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePlayer();
      settingsModal.classList.add('hidden');
      gateModal.classList.add('hidden');
      searchResultsDropdown.classList.add('hidden');
    }
  });
}

// --- Onboarding Wizard Logic ---
async function showOnboardingWizard() {
  // Create Modal Elements
  const modal = document.createElement('div');
  modal.className = 'wizard-modal';

  modal.innerHTML = `
    <div class="wizard-content">
      <div class="wizard-step" id="wizard-step-1">
        <h2 class="wizard-step-title">${t('welcome_title')}</h2>
        <p class="wizard-desc">${t('welcome_desc')}</p>
        
        <div class="wizard-input-group">
          <label>${t('step1_label')}</label>
          <input type="text" id="wizard-child-name" placeholder="${t('step1_placeholder')}" autofocus autocomplete="off" />
        </div>

        <button class="wizard-btn-primary" id="wizard-next-btn" disabled>${t('next_step') || 'Next'}</button>
        
        <div style="display:flex; align-items:center; margin: 20px 0; color:#ccc; font-size:0.8rem; font-weight:600;">
            <div style="flex:1; height:1px; background:#eee;"></div>
            <span style="padding:0 10px;">OR</span>
            <div style="flex:1; height:1px; background:#eee;"></div>
        </div>

        <div id="wizard-google-container"></div>
      </div>

      <div class="wizard-step" id="wizard-step-2" style="display:none;">
        <h2 class="wizard-step-title">${t('step2_label')}</h2>
        
        <div id="channel-loading" class="channel-loading-area">${t('loading_recommendations')}</div>
        <div class="wizard-channel-grid" id="wizard-channel-grid"></div>

        <button class="wizard-btn-primary" id="wizard-finish-btn">${t('finish_setup')}</button>
        <div class="wizard-skip" id="wizard-login-note" style="margin-top:20px; font-weight:bold; color:var(--primary-color); font-size: 0.9rem; text-align: center;">${t('setup_login_note')}</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Step 1 Logic
  const nameInput = modal.querySelector('#wizard-child-name');
  const nextBtn = modal.querySelector('#wizard-next-btn');
  const step1 = modal.querySelector('#wizard-step-1');
  const step2 = modal.querySelector('#wizard-step-2');
  const googleContainer = modal.querySelector('#wizard-google-container');

  // Pre-fetch channel data NOW (during Step 1, while user types name)
  let prefetchedChannels = null;
  const prefetchPromise = fetch(STATS_ENDPOINT + '?action=getRankings&t=' + Date.now())
    .then(r => r.json())
    .then(data => {
      if (data.channels && data.channels.length > 0) {
        prefetchedChannels = data.channels.slice(0, 16);
        return prefetchedChannels;
      }
      return null;
    })
    .catch(e => { console.warn('Prefetch rankings failed:', e); return null; });

  nameInput.oninput = () => {
    nextBtn.disabled = nameInput.value.trim().length === 0;
  };

  // Enter key support
  nameInput.onkeydown = (e) => {
    if (e.key === 'Enter' && !nextBtn.disabled) nextBtn.click();
  };

  nextBtn.onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) return;

    // Update local profile name temporarily
    state.data.profiles[0].name = name;

    // Switch to Step 2
    step1.style.display = 'none';
    step2.style.display = 'block';

    // Use pre-fetched data if available
    await loadWizardRecommendations(modal, prefetchedChannels, prefetchPromise);
  };

  // Google Login Logic (Directly Visible)
  const clientId = (typeof GOOGLE_CLIENT_ID !== 'undefined' && GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID_HERE')
    ? GOOGLE_CLIENT_ID
    : localStorage.getItem('safetube_client_id');

  if (clientId) {
    initializeGSI(clientId);

    googleContainer.innerHTML = `
        <button class="wizard-btn-google">
           <svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
             <g transform="matrix(1, 0, 0, 1, 27.009001, -39.238998)">
               <path fill="#4285F4" d="M -3.264 51.509 C -3.264 50.719 -3.334 49.969 -3.454 49.239 L -14.754 49.239 L -14.754 53.749 L -8.284 53.749 C -8.574 55.229 -9.424 56.479 -10.684 57.329 L -10.684 60.329 L -6.824 60.329 C -4.564 58.239 -3.264 55.159 -3.264 51.509 Z"/>
               <path fill="#34A853" d="M -14.754 63.239 C -11.514 63.239 -8.804 62.159 -6.824 60.329 L -10.684 57.329 C -11.764 58.049 -13.134 58.489 -14.754 58.489 C -17.884 58.489 -20.534 56.379 -21.484 53.529 L -25.464 53.529 L -25.464 56.619 C -23.494 60.539 -19.464 63.239 -14.754 63.239 Z"/>
               <path fill="#FBBC05" d="M -21.484 53.529 C -21.734 52.809 -21.864 52.039 -21.864 51.239 C -21.864 50.439 -21.734 49.669 -21.484 48.949 L -21.484 45.859 L -25.464 45.859 C -26.284 47.479 -26.754 49.299 -26.754 51.239 C -26.754 53.179 -26.284 54.999 -25.464 56.619 L -21.484 53.529 Z"/>
               <path fill="#EA4335" d="M -14.754 43.989 C -12.984 43.989 -11.404 44.599 -10.154 45.789 L -6.734 42.369 C -8.804 40.429 -11.514 39.239 -14.754 39.239 C -19.464 39.239 -23.494 41.939 -25.464 45.859 L -21.484 48.949 C -20.534 46.099 -17.884 43.989 -14.754 43.989 Z"/>
             </g>
           </svg>
           ${t('restore_backup')}
        </button>
      `;

    const btn = googleContainer.querySelector('button');
    btn.onclick = () => {
      btn.innerHTML = `${t('syncing')}`;
      btn.disabled = true;
      if (state.tokenClient) {
        state.tokenClient.requestAccessToken({ prompt: 'consent' });
      } else {
        initializeGSI(clientId); // retry
        setTimeout(() => { if (state.tokenClient) state.tokenClient.requestAccessToken({ prompt: 'consent' }); }, 500);
      }
    };
  }

  // Step 2 Logic: Finish
  const finishBtn = modal.querySelector('#wizard-finish-btn');
  finishBtn.onclick = () => {
    // 1. Get selected channels
    const selected = document.querySelectorAll('.channel-option-card.selected');
    const newChannels = [];
    selected.forEach(card => {
      newChannels.push({
        id: card.dataset.id,
        name: card.dataset.name,
        thumbnail: card.dataset.thumb
      });
    });

    // 2. Save to profile
    state.data.profiles[0].channels = newChannels;
    saveLocalData();

    // 3. Close Modal & Init App
    modal.remove();

    startApp();

    // Show Login Tooltip
    setTimeout(() => {
      const tooltip = document.getElementById('onboarding-tooltip');
      if (tooltip) {
        const textEl = tooltip.querySelector('p');
        if (textEl) textEl.textContent = t('onboarding_login_tooltip');
        tooltip.classList.add('show');
      }
    }, 1000);
  };
}

// Helper: Danger Zone Listener
function setupDangerZoneListener() {
  const resetBtn = document.getElementById('reset-app-btn');
  if (resetBtn) {
    resetBtn.onclick = () => {
      // Hardcoded confirmation messages as they are critical
      if (confirm('⚠️ WARNING: This will delete ALL data on this device.\n\nAre you sure you want to reset everything?')) {
        if (confirm('This action cannot be undone. \n(Note: Your cloud backup will NOT be deleted.)\n\nProceed with reset?')) {
          // Clear Local Data
          localStorage.removeItem(STORAGE_KEY_DATA);
          localStorage.removeItem('safetube_client_id');
          localStorage.removeItem('safetube_onboarding_dismissed');
          localStorage.removeItem('onboarding_dismissed');

          // Google Token Logout
          if (state.accessToken) {
            try {
              if (window.google) google.accounts.oauth2.revoke(state.accessToken, () => { });
            } catch (e) { }
          }

          // Reload
          location.reload();
        }
      };
    }
  }
}

// Top channels for instant rendering (avoid GAS cold start delay)
const CURATED_CHANNELS = [
  { id: 'UCbCmjCuTUZos6Inko4u57UQ', name: 'Cocomelon' },
  { id: 'UCLsooMJoIpl_7ux2jvdPB-Q', name: 'Super Simple Songs' },
  { id: 'UCcdwLMPsaU2ezNSJU1nFoBQ', name: 'Pinkfong Baby Shark' },
  { id: 'UCCDiULnPSl1g3K_sO4fG-6Q', name: 'Little Baby Bum' },
  { id: 'UC41aFAI9F3caYzKA6KzKBSQ', name: 'ChuChu TV' },
  { id: 'UCpVo_w0p3lLY5NN8u7y768A', name: 'Sesame Street' },
  { id: 'UCXMVaxrax7RNDPdfRrXXgtQ', name: 'PBS Kids' },
  { id: 'UC513PdAP2-jWkJunTh5kXRw', name: 'Blippi' },
  { id: 'UC2pmfLm7iq6Ov1Uw7W4IPZA', name: 'Masha and the Bear' },
  { id: 'UCAOtE1V7Ots4DjM8JLlrYgg', name: 'Peppa Pig' },
  { id: 'UCPlwvN0w4qFSP1FllALB92w', name: 'BabyBus' },
  { id: 'UC_qs3c0ehDvZkbiEbOj6Drg', name: 'LooLoo Kids' }
];

async function loadWizardRecommendations(modal, prefetchedChannels, prefetchPromise) {
  const grid = modal.querySelector('#wizard-channel-grid');
  const loader = modal.querySelector('#channel-loading');

  // Helper to render a single channel card
  const renderCard = (channel) => {
    if (grid.querySelector(`[data-id="${channel.id}"]`)) return; // Avoid duplicates

    const card = document.createElement('div');
    card.className = 'channel-option-card';
    card.dataset.id = channel.id;
    card.dataset.name = channel.name;
    card.dataset.thumb = channel.thumbnail || '';

    const thumbSrc = channel.thumbnail || `https://ui-avatars.com/api/?name=${encodeURIComponent(channel.name)}&background=random&size=128&rounded=true`;
    const fallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(channel.name)}`;

    card.innerHTML = `
          <img src="${thumbSrc}" class="channel-option-img" onerror="this.src='${fallback}'" loading="lazy"/>
          <span class="channel-check-badge">✔</span>
          <div class="channel-option-label">${channel.name}</div>
       `;

    card.onclick = () => card.classList.toggle('selected');
    grid.appendChild(card);
  };

  // Helper to render a full channel list (replaces existing grid)
  const renderAll = (channels) => {
    grid.innerHTML = '';
    channels.forEach(renderCard);
    if (loader) loader.style.display = 'none';
  };

  // Strategy 1: Pre-fetched data already available (fast path - real icons!)
  if (prefetchedChannels && prefetchedChannels.length > 0) {
    console.log('Using pre-fetched channel data (instant with real icons)');
    renderAll(prefetchedChannels);
    return;
  }

  // Strategy 2: Show curated fallback instantly, then try to get real data
  grid.innerHTML = '';
  CURATED_CHANNELS.forEach(renderCard);

  if (loader) {
    loader.style.fontSize = '0.75rem';
    loader.innerHTML = '⏳ Loading real channel icons...';
  }

  try {
    // Wait for the in-flight prefetch if it exists
    if (prefetchPromise) {
      const resolved = await prefetchPromise;
      if (resolved && resolved.length > 0) {
        renderAll(resolved);
        return;
      }
    }

    // Strategy 3: Direct fetch as last resort
    const response = await fetch(STATS_ENDPOINT + '?action=getRankings&t=' + Date.now());
    const data = await response.json();

    if (data.channels && data.channels.length > 0) {
      renderAll(data.channels.slice(0, 16));
    } else {
      if (loader) loader.style.display = 'none';
    }
  } catch (e) {
    console.warn('Failed to load dynamic rankings:', e);
    if (loader) loader.style.display = 'none';
    // Curated fallback is already visible - that's fine
  }
}

// Start
init();
