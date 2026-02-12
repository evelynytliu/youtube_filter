import './style.css'

// Configuration & State
const STORAGE_KEY_API = 'safetube_api_key';
const STORAGE_KEY_DATA = 'safetube_data';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

// --- SECURITY: Client ID ---
const GOOGLE_CLIENT_ID = '959694478718-pksctjg2pbmtd1fnvp9geha2imqbi72j.apps.googleusercontent.com';

// Default Data Structure
const DEFAULT_PROFILE_ID = 'default_child';
const DEFAULT_DATA = {
  profiles: [
    {
      id: DEFAULT_PROFILE_ID,
      name: 'Default Child',
      channels: [
        { id: 'UCbCmjCuTUZos6Inko4u57UQ', name: 'Cocomelon - Nursery Rhymes', thumbnail: 'https://yt3.ggpht.com/ytc/AKedOLRbdv3Di8paQyrgMF_VwFXPkhwVzcW59Vgo8dTsyw=s88-c-k-c0x00ffffff-no-rj' },
        { id: 'UC2h-ucSvsjDMg8gqE2KoVyg', name: 'Super Simple Songs', thumbnail: 'https://yt3.ggpht.com/ytc/AKedOLSGzJceA7O2jO7C7HHaQv5y5U-y7Sg_rQe6kX5G=s88-c-k-c0x00ffffff-no-rj' },
        { id: 'UXI_4T5eMWe8s_8jATfD_25g', name: 'Pinkfong Baby Shark - Kids\' Songs & Stories', thumbnail: 'https://yt3.ggpht.com/ytc/AKedOLTkv3M_k-hSj5uV8t3y6jF_5_k_j5_k_j5_k=s88-c-k-c0x00ffffff-no-rj' }
      ]
    }
  ],
  currentProfileId: DEFAULT_PROFILE_ID,
  apiKey: ''
};

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

  if (!state.data.apiKey) {
    state.videos = MOCK_VIDEOS;
    renderVideos();
    apiStatus.textContent = 'Demo Mode: Add API Key for real content.';
    apiStatus.style.color = 'orange';
  } else {
    fetchAllVideos();
  }

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
        await syncWithDrive();
        loginBtn.textContent = 'Synced with Google';
        loginBtn.disabled = true;
      },
    });
    loginBtn.style.display = 'block';
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
        fetchAllVideos();
        alert('Settings loaded from Google Drive!');
      }
    }
  } else {
    await saveToDrive();
  }
}

async function saveToDrive() {
  if (!state.accessToken) return;

  const configData = {
    ...state.data,
    lastUpdated: new Date().toISOString()
  };

  const fileId = await findConfigFile();
  const blob = new Blob([JSON.stringify(configData)], { type: 'application/json' });
  const metadata = {
    name: 'safetube_config.json',
    mimeType: 'application/json',
    parents: ['appDataFolder']
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

  await fetch(url, {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + state.accessToken
    },
    body: form
  });
  console.log('Saved to Drive');
}

async function findConfigFile() {
  const q = "name = 'safetube_config.json' and 'appDataFolder' in parents and trashed = false";
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&spaces=appDataFolder`, {
    headers: { 'Authorization': 'Bearer ' + state.accessToken }
  });
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

async function downloadConfigFile(fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { 'Authorization': 'Bearer ' + state.accessToken }
  });
  return await res.json();
}

// --- Video Fetching ---
// --- Video Fetching ---
const CACHE_DURATION = 1000 * 60 * 60; // 1 Hour

async function fetchAllVideos(forceRefresh = false) {
  if (!state.data.apiKey) return;
  const profile = getCurrentProfile();

  if (!profile.channels || profile.channels.length === 0) {
    state.videos = [];
    renderVideos();
    apiStatus.textContent = 'No channels in this profile.';
    return;
  }

  // 1. Check Cache
  const cacheKey = `safetube_cache_${profile.id}`;
  const cachedData = localStorage.getItem(cacheKey);

  if (!forceRefresh && cachedData) {
    try {
      const { timestamp, videos } = JSON.parse(cachedData);
      const age = Date.now() - timestamp;
      if (age < CACHE_DURATION) {
        console.log('Using cached videos');
        state.videos = videos;

        // Restore sort/filter state if needed, or just render
        state.activeChannelId = null;
        state.currentSort = 'newest';

        renderChannelNav();
        updateSortUI();
        renderVideos();
        apiStatus.textContent = `Loaded from cache (${Math.round(age / 60000)}m ago).`;
        apiStatus.style.color = '#4ecdc4';
        return;
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
    const validChannels = profile.channels.filter(c => c && c.id);
    const promises = validChannels.map(channel => fetchChannelVideos(channel));
    const results = await Promise.all(promises);
    const checkVideos = results.flat().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    state.videos = checkVideos;
    // Save to Cache
    const cacheKey = `safetube_cache_${profile.id}`;
    localStorage.setItem(cacheKey, JSON.stringify({
      timestamp: Date.now(),
      videos: state.videos
    }));

    // Save potentially updated channel info (uploadsId)
    saveLocalData();

    // Reset Filter on New Fetch? Or keep?
    // Let's reset to ALL when fetching fresh videos.
    state.activeChannelId = null;
    state.currentSort = 'newest'; // Default

    state.currentSort = 'newest'; // Default

    renderChannelNav(); // Re-render to clear active state if needed or ensure sync
    updateSortUI();
    renderVideos();

    fetchMissingChannelIcons(); // Auto-fix missing avatars

    apiStatus.textContent = 'Updated now.';
    apiStatus.style.color = '#4ecdc4';

  } catch (error) {
    console.error('Error fetching videos:', error);
    apiStatus.textContent = 'Error: ' + error.message;
    apiStatus.style.color = '#ff6b6b';
    videoContainer.innerHTML = `<div style="text-align:center; padding: 2rem;">
        <p>😕 Something went wrong.</p>
        <p style="color:red; font-size: 0.8rem;">${error.message}</p>
        <p>Check API Key or internet.</p>
    </div>`;
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
  const plUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=10&key=${state.data.apiKey}`;

  try {
    const plRes = await fetch(plUrl);
    const plData = await plRes.json();

    if (!plData.items) return [];

    return plData.items.map(item => ({
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
    li.innerHTML = `
      <img src="${thumb}" class="search-avatar" />
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
function updateProfileUI() {
  const profile = getCurrentProfile();
  headerProfileName.textContent = profile.name;
  profileSelector.classList.remove('hidden');

  renderProfileList();
  renderProfileDropdown();
  renderChannelNav(); // Render nav for current profile
}

function renderChannelNav() {
  if (!channelNav) return;
  const profile = getCurrentProfile();
  channelNav.innerHTML = '';

  // "All" Button
  const allBtn = document.createElement('div');
  allBtn.className = `nav-item ${state.activeChannelId === null ? 'active' : ''}`;
  // Use a colorful placeholder for "All"
  const allIcon = `https://ui-avatars.com/api/?name=All&background=FF6B6B&color=fff&size=128&bold=true`;
  allBtn.innerHTML = `
        <img src="${allIcon}" class="nav-avatar" alt="All" />
        <span>All Videos</span>
    `;
  allBtn.onclick = () => filterVideos(null);
  channelNav.appendChild(allBtn);

  // Channel Buttons
  profile.channels.forEach(channel => {
    const btn = document.createElement('div');
    btn.className = `nav-item ${state.activeChannelId === channel.id ? 'active' : ''}`;

    let avatarSrc = channel.thumbnail;
    if (!avatarSrc) {
      // Fallback avatar
      avatarSrc = `https://ui-avatars.com/api/?name=${encodeURIComponent(channel.name)}&background=random&size=128`;
    }

    btn.innerHTML = `
            <img src="${avatarSrc}" class="nav-avatar" alt="${channel.name}" />
            <span>${channel.name}</span>
        `;
    btn.onclick = () => filterVideos(channel.id);
    channelNav.appendChild(btn);
  });
}

function filterVideos(channelId) {
  state.activeChannelId = channelId;
  renderChannelNav(); // Update visual state
  renderVideos();     // Re-render video list
}

function renderProfileDropdown() {
  if (!profileDropdown) return;
  profileDropdown.innerHTML = '';

  state.data.profiles.forEach(p => {
    const li = document.createElement('li');
    li.className = 'profile-dropdown-item';
    if (p.id === state.data.currentProfileId) li.classList.add('active');

    li.textContent = p.name;
    li.onclick = (e) => {
      e.stopPropagation();
      switchProfile(p.id);
      profileDropdown.classList.add('hidden');
    };
    profileDropdown.appendChild(li);
  });
}

function renderProfileList() {
  if (!profileListContainer) return;
  profileListContainer.innerHTML = '';

  state.data.profiles.forEach(p => {
    const div = document.createElement('div');
    div.className = `profile-list-item ${p.id === state.data.currentProfileId ? 'active' : ''}`;

    div.innerHTML = `
            <span>${p.name} <small>(${p.channels.length} channels)</small></span>
            <div class="profile-actions">
                ${p.id === state.data.currentProfileId
        ? '<span style="font-size:0.8rem; color:green; display:flex; align-items:center;">Active</span>'
        : `<button class="btn-small btn-select" data-id="${p.id}">Switch</button>`
      }
                <button class="btn-small btn-edit" data-id="${p.id}">Edit</button>
                ${state.data.profiles.length > 1 ? `<button class="btn-small btn-delete" data-id="${p.id}">Delete</button>` : ''}
            </div>
        `;
    profileListContainer.appendChild(div);
  });

  // Attach listeners
  profileListContainer.querySelectorAll('.btn-select').forEach(btn => {
    btn.onclick = () => switchProfile(btn.dataset.id);
  });
  profileListContainer.querySelectorAll('.btn-edit').forEach(btn => {
    btn.onclick = () => editProfileName(btn.dataset.id);
  });
  profileListContainer.querySelectorAll('.btn-delete').forEach(btn => {
    btn.onclick = () => deleteProfile(btn.dataset.id);
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
  sortButtons.forEach(btn => {
    btn.onclick = () => sortVideos(btn.dataset.sort);
  });

  document.getElementById('settings-btn').onclick = () => {
    const a = Math.floor(Math.random() * 5) + 1;
    const b = Math.floor(Math.random() * 5) + 1;
    const sum = a + b;
    document.getElementById('gate-question').textContent = `What is ${a} + ${b}?`;
    document.getElementById('gate-answer').value = '';
    gateModal.dataset.answer = sum;
    gateModal.classList.remove('hidden');
  };

  document.getElementById('gate-submit').onclick = () => {
    const input = parseInt(document.getElementById('gate-answer').value);
    const correct = parseInt(gateModal.dataset.answer);
    if (input === correct) {
      gateModal.classList.add('hidden');
      settingsModal.classList.remove('hidden');
      // Refresh Lists just in case
      renderChannelList();
      updateProfileUI();
      apiKeyInput.value = state.data.apiKey;
    } else {
      alert('Incorrect! Ask your parents.');
      gateModal.classList.add('hidden');
    }
  };

  document.getElementById('close-settings').onclick = () => {
    settingsModal.classList.add('hidden');
    searchResultsDropdown.classList.add('hidden');
  }

  document.getElementById('save-api-key').onclick = () => {
    const key = apiKeyInput.value.trim();
    if (key) {
      state.data.apiKey = key;
      saveLocalData();
      apiStatus.textContent = 'Key saved!';
      fetchAllVideos();
    }
  };

  if (loginBtn) {
    loginBtn.onclick = () => {
      if (state.tokenClient) {
        state.tokenClient.requestAccessToken();
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

  channelSearchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(searchDebounce);
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
