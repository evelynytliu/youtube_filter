// import './style.css'

// Configuration & State
const STORAGE_KEY_API = 'safetube_api_key';
const STORAGE_KEY_DATA = 'safetube_data';
const STORAGE_KEY_STATS = 'safetube_stats_meta';
// Scopes: Drive access + User Info for display
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';
const STATS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyryKTFoTom_fhoJ6ImvnfbYUn8wtKABPvMMLX_g3OP7yiBLj14m2kL0EDEOJVKDjtA6g/exec';

// ...

async function saveToDrive() {
  if (!state.accessToken) return;

  // Clean data before saving (remove large cached videos to save space/bandwidth)
  const cleanData = JSON.parse(JSON.stringify(state.data));
  // Optional: We could strip 'channels' details here if we only want to save IDs, 
  // but for now let's keep it simple. Smart sync is better.

  const configData = {
    ...cleanData,
    lastUpdated: new Date().toISOString()
  };

  const fileId = await findConfigFile();
  const blob = new Blob([JSON.stringify(configData)], { type: 'application/json' });

  // Metadata: Save to Root (Visible to User)
  const metadata = {
    name: 'safetube_settings.json', // New visible filename
    mimeType: 'application/json'
    // No 'parents' means root folder
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

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
        'Authorization': 'Bearer ' + state.accessToken
      },
      body: form
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }
    console.log('Saved to Drive (Visible File)');
    // alert('Cloud Save Success! Settings backed up.'); // Removed to prevent double alerts/annoyance

    // Optional: Update a status indicator if visible
    const apiStatus = document.getElementById('api-status');
    if (apiStatus && apiStatus.classList.contains('show')) {
      // Append cloud icon to existing toast if it's showing
      apiStatus.textContent += ' (☁️ Synced)';
    }

  } catch (e) {
    console.error('Save to Drive failed', e);
    // If permission error, suggest re-login
    if (e.message.includes('401') || e.message.includes('403')) {
      console.warn('Sync Error: Permission Denied. Token likely expired.');
      // Don't alert on auto-save, just log. 
      // Only reset if we are sure? Let's just invalidate for now.
      state.accessToken = null;
      if (typeof loginBtn !== 'undefined' && loginBtn) {
        loginBtn.textContent = 'Login with Google to Sync';
        loginBtn.disabled = false;
      }
    } else {
      console.warn('Cloud Save Failed: ' + e.message);
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
      name: 'Default Child',
      channels: [
        { id: 'UCbCmjCuTUZos6Inko4u57UQ', name: 'Cocomelon - Nursery Rhymes', thumbnail: '' },
        { id: 'UC2h-ucSvsjDMg8gqE2KoVyg', name: 'Super Simple Songs', thumbnail: '' },
        { id: 'UCcdwLMPsaU2ezNSJU1nFoBQ', name: 'Pinkfong Baby Shark - Kids\' Songs & Stories', thumbnail: '' }
      ]
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
  accessToken: null
};

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

function init() {
  loadLocalData();

  // Initialize GSI
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID !== 'YOUR_GOOGLE_CLIENT_ID_HERE') {
    initializeGSI(GOOGLE_CLIENT_ID);
  } else {
    const legacyId = localStorage.getItem('safetube_client_id');
    if (legacyId) {
      initializeGSI(legacyId);
    } else {
      console.warn('Google Client ID not set.');
    }
  }

  updateProfileUI(); // This also renders channel nav
  renderChannelList();

  updateProfileUI(); // This also renders channel nav
  renderChannelList();

  // Always attempt to fetch videos (API or RSS)
  // Check if we need to force refreshing cache due to channel changes?
  // For now, let fetchAllVideos handle cache validation.
  fetchAllVideos();
  // Stats upload moved to after Drive sync to ensure correct channel data


  setupEventListeners();
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
        loginBtn.textContent = 'Syncing...';
        loginBtn.disabled = true; // Temporary disable while syncing

        await fetchGoogleUserInfo().catch(console.warn); // Fetch and display user info

        await syncWithDrive();

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
  if (fileId) {
    const driveConfig = await downloadConfigFile(fileId);
    if (driveConfig) {
      // Merge logic: Drive overwrites local mostly, but we keep structure validity
      if (driveConfig.profiles && Array.isArray(driveConfig.profiles)) {
        state.data = driveConfig;
        saveLocalData(); // Save to local but don't re-trigger upload
        updateProfileUI();
        renderChannelList();
        // If API key exists, fetch videos AND icons
        if (state.data.apiKey) {
          fetchAllVideos(true); // Force refresh
          setTimeout(fetchMissingChannelIcons, 1000); // Check icons
        }
        alert('Settings loaded from Google Drive!');
      }
    } else {
      console.log('No config file found on Drive, creating new...');
      await saveToDrive(); // First time sync
    }
  } else {
    console.log('No config file found on Drive, creating new...');
    await saveToDrive();
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
    apiStatus.textContent = 'No channels in this profile.';
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
        // Filter: Only keep videos from channels that are still in our profile
        const currentChannelIds = new Set(profile.channels.map(c => c.id));
        const validVideos = videos.filter(v => currentChannelIds.has(v.channelId));

        // If we have valid videos, use them. 
        // If the cache is empty (but valid?) or we filtered something out?
        // Actually, if we filtered out videos, the resulting list might be empty.
        // If it's valid videos, show them.

        if (validVideos.length > 0) {
          console.log('Using cached videos (filtered)');
          state.videos = validVideos;

          state.activeChannelId = null;
          state.currentSort = 'newest';

          renderChannelNav();
          updateSortUI();
          renderVideos();
          apiStatus.textContent = `Loaded from cache (${Math.round(age / 60000)}m ago).`;
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

  videoContainer.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading ${profile.name}'s videos...</p>
    </div>
  `;

  try {
    let checkVideos = [];

    if (useLiteMode) {
      // --- Lite Mode (RSS) ---
      console.log('Fetching videos via Lite Mode (RSS)...');
      const promises = profile.channels.map(channel => fetchChannelRSS(channel));
      const results = await Promise.all(promises);
      checkVideos = results.flat().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

      apiStatus.textContent = 'Lite Mode (Free): Shows recent 15 videos only.';
      apiStatus.style.color = '#FFA500'; // Warning Orange

    } else {
      // --- API Mode ---
      const validChannels = profile.channels.filter(c => c && c.id);
      const promises = validChannels.map(channel => fetchChannelVideos(channel));
      const results = await Promise.all(promises);
      checkVideos = results.flat().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

      apiStatus.textContent = 'Updated now (API Mode).';
      apiStatus.style.color = '#4ecdc4';

      fetchMissingChannelIcons(); // Only in Full API Mode
    }

    state.videos = checkVideos;

    // Save to Cache
    const cacheKey = `safetube_cache_${profile.id}`;
    localStorage.setItem(cacheKey, JSON.stringify({
      timestamp: Date.now(),
      videos: state.videos
    }));

    // Save potentially updated channel info (uploadsId)
    if (!useLiteMode) saveLocalData();

    // Reset Filter on New Fetch? Or keep?
    // Let's reset to ALL when fetching fresh videos.
    state.activeChannelId = null;
    state.currentSort = 'newest'; // Default

    state.currentSort = 'newest'; // Default

    renderChannelNav(); // Re-render to clear active state if needed or ensure sync
    updateSortUI();
    renderVideos();

  } catch (error) {
    if (useLiteMode) {
      console.error('RSS Lite Mode Error:', error);
      apiStatus.textContent = 'Error: Cannot fetch RSS feed.';
      apiStatus.style.color = '#ff6b6b';
      videoContainer.innerHTML = `<div style="text-align:center; padding: 2rem;">
            <p>😕 Lite Mode failed.</p>
            <p>Try refreshing or adding an API Key for stability.</p>
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
// --- Lite Mode: RSS Fetcher ---
async function fetchChannelRSS(channel) {
  // Public YouTube RSS Feed URL
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`;
  // Use AllOrigins as CORS Proxy (JSON mode to avoid CORS on raw XML)
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;

  try {
    const res = await fetch(proxyUrl);
    const data = await res.json();

    if (!data.contents) return [];

    // Parse XML
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(data.contents, "text/xml");
    const entries = xmlDoc.getElementsByTagName("entry");

    const videos = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      // Robust tag finding for different browsers/parsers
      const videoId = (entry.getElementsByTagName("yt:videoId")[0] || entry.getElementsByTagName("videoId")[0])?.textContent;
      const title = (entry.getElementsByTagName("title")[0])?.textContent; // Title usually standard
      const published = (entry.getElementsByTagName("published")[0])?.textContent;

      if (videoId && title) {
        // Filter Shorts by Title (RSS Limitation)
        const titleLower = title.toLowerCase();
        const isShortsKeyword = /#shorts|\[shorts\]|\(shorts\)|^shorts$| shorts$/.test(titleLower);

        if (state.data.filterShorts && isShortsKeyword) {
          continue;
        }

        // RSS doesn't give good thumbnails, so we construct standard YT thumbnail URL
        const thumb = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

        videos.push({
          id: videoId,
          title: title,
          thumbnail: thumb,
          channelTitle: channel.name, // Use our name as RSS might differ slightly
          channelId: channel.id,
          publishedAt: published
        });
      }
    }
    return videos;

  } catch (e) {
    console.warn(`RSS fetch failed for ${channel.name}`, e);
    return [];
  }
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
  if (!state.data.apiKey) return;
  const profile = getCurrentProfile();

  // Find channels without thumbnails
  const missingIcons = profile.channels.filter(c => !c.thumbnail);

  if (missingIcons.length === 0) return; // All good

  console.log(`Fetching icons for ${missingIcons.length} channels...`);

  // YouTube API allows fetching up to 50 ids at once
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

      if (updated) {
        saveLocalData();
        renderChannelNav(); // Refresh nav to show new icons
        console.log('Channel icons updated!');
        if (state.accessToken) saveToDrive(); // Sync changes
      }
    }
  } catch (e) {
    console.warn('Failed to auto-fetch channel icons', e);
  }
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
  allBtn.title = "All Videos"; // Tooltip
  allBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
        <span>All</span>
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

    btn.innerHTML = `
            <img src="${avatarSrc}" class="nav-pill-icon" alt="${channel.name}" />
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
        label.textContent = "All Videos";
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
        ? '<span class="status-badge active" style="background:#e6fffa; color:#2c7a7b; padding:4px 8px; border-radius:12px; font-size:0.75rem; font-weight:600;">Current</span>'
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
    videoCount.textContent = `${displayVideos.length} videos`;
  }

  if (displayVideos.length === 0) {
    if (state.activeChannelId) {
      videoContainer.innerHTML = '<p style="text-align:center; width: 100%;">No videos found for this channel.</p>';
    } else {
      videoContainer.innerHTML = '<p style="text-align:center; width: 100%;">No videos found. Check settings.</p>';
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
    li.innerHTML = `
      <span>${channel.name || channel.id}</span>
      <button class="remove-btn" data-index="${index}">Remove</button>
    `;
    channelList.appendChild(li);
  });

  document.querySelectorAll('.remove-btn').forEach(btn => {
    btn.onclick = (e) => {
      const idx = e.target.getAttribute('data-index');
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
}

function editProfileName(id) {
  const profile = state.data.profiles.find(p => p.id === id);
  if (!profile) return;

  const newName = prompt("Enter new name for " + profile.name, profile.name);
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
  if (confirm('Are you sure you want to delete this profile?')) {
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
  }

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
      modeTitle.textContent = 'Advanced Control';
      modeDesc.textContent = 'Unlocks Search, unlimited history, & faster sync. Requires API Key.';
    } else {
      modePro.classList.remove('active');
      modeLite.classList.add('active');
      apiSection.classList.remove('visible');

      modeDescBox.classList.add('lite');
      modeTitle.textContent = 'Free & Simple';
      modeDesc.textContent = 'Shows latest 15 videos. No setup required. Perfect for casual viewing.';
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

      apiStatus.textContent = '🎈 Lite Mode Active!';
      apiStatus.classList.add('success', 'show');

      searchResultsDropdown.classList.add('hidden'); // Clear search
      fetchAllVideos(true);

    } else {
      // Saving Pro Mode
      const key = apiKeyInput.value.trim();
      if (!key) {
        apiStatus.textContent = '⚠️ Please enter an API Key for Pro Mode';
        apiStatus.classList.add('warning', 'show');
        apiKeyInput.focus();
        return;
      }

      state.data.apiKey = key;
      saveLocalData();

      apiStatus.textContent = '🚀 Pro Mode Activated!';
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

// Start
init();
