// import './style.css'

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/kiddolens-for-youtube/sw.js', { scope: '/kiddolens-for-youtube/' })
      .then(() => console.log('SW registered'))
      .catch((err) => console.warn('SW registration failed:', err));
  });
}

// Configuration & State
const STORAGE_KEY_API = 'safetube_api_key';
const STORAGE_KEY_DATA = 'safetube_data';
const STORAGE_KEY_STATS = 'safetube_stats_meta';
const STORAGE_KEY_WATCH_HISTORY = 'safetube_watch_history_'; // Per-profile: + profileId
const INTEREST_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days in ms
const MAX_WATCH_HISTORY = 50;
const STORAGE_KEY_WATCH_TIME = 'safetube_watch_time_'; // Per-profile per day: + profileId_YYYY-MM-DD
const STORAGE_KEY_PLAYLIST = 'kiddolens_playlist_'; // Per-profile: + profileId
const STORAGE_KEY_ACTIVE_CHANNEL = 'kiddolens_active_channel_'; // Per-profile: + profileId
const STORAGE_KEY_SORT = 'kiddolens_sort';
import { createClient } from '@supabase/supabase-js';
import { getMockData } from './mockData.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
const STATS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyryKTFoTom_fhoJ6ImvnfbYUn8wtKABPvMMLX_g3OP7yiBLj14m2kL0EDEOJVKDjtA6g/exec';

import { translations } from './i18n.js';
const STORAGE_KEY_LANG = 'safetube_lang';

// ...

/** Renames per-profile localStorage keys when a profile id changes (UUID migration) */
function migrateProfileStorageKeys(oldId, newId) {
  const prefixes = [STORAGE_KEY_WATCH_HISTORY, STORAGE_KEY_WATCH_TIME, 'safetube_v2_', STORAGE_KEY_PLAYLIST, STORAGE_KEY_ACTIVE_CHANNEL];
  Object.keys(localStorage).forEach(key => {
    for (const prefix of prefixes) {
      if (key.startsWith(prefix + oldId)) {
        const newKey = prefix + newId + key.slice((prefix + oldId).length);
        localStorage.setItem(newKey, localStorage.getItem(key));
        localStorage.removeItem(key);
      }
    }
  });
}

function ensureUUIDs() {
  let changed = false;
  state.data.profiles.forEach(p => {
    // Basic UUID format check: 8-4-4-4-12
    const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(p.id);
    if (!isUUID) {
      const oldId = p.id;
      p.id = crypto.randomUUID();
      // Carry watch history, watch time, caches & playlist over to the new id
      migrateProfileStorageKeys(oldId, p.id);
      changed = true;
      if (state.data.currentProfileId === oldId) {
        state.data.currentProfileId = p.id;
      }
    }
  });
  if (changed) {
    saveLocalData();
  }
}

async function saveToSupabase() {
  if (!state.user) return;
  ensureUUIDs(); // Ensure all profiles have valid UUIDs before inserting

  try {
    // 1. Save user settings
    const { error: errSettings } = await supabase.from('kiddolens_user_settings').upsert({
      user_id: state.user.id,
      youtube_api_key: state.data.apiKey,
      filter_shorts: state.data.filterShorts,
      share_stats: state.data.shareStats,
      autoplay_next: !!state.data.autoPlayNext,
      parent_lock_enabled: !!state.data.parentLock?.enabled,
      parent_lock_mode: state.data.parentLock?.mode || 'pin',
      parent_pin_hash: state.data.parentLock?.pinHash || null,
      updated_at: state.data.lastUpdated   // match local timestamp to avoid false conflicts
    });
    if (errSettings) throw errSettings;

    // 2. Sync Profiles (Delete removed ones, then Upsert)
    const { data: remoteProfiles } = await supabase.from('kiddolens_profiles').select('id');
    const localProfileIds = state.data.profiles.map(p => p.id);
    const profilesToDelete = (remoteProfiles || []).map(p => p.id).filter(id => !localProfileIds.includes(id));

    if (profilesToDelete.length > 0) {
      await supabase.from('kiddolens_profiles').delete().in('id', profilesToDelete);
    }

    const profilesToUpsert = state.data.profiles.map(p => ({
      id: p.id,
      user_id: state.user.id,
      name: p.name,
      avatar: p.avatar || '',
      created_at: p.created_at || new Date().toISOString()
    }));
    if (profilesToUpsert.length > 0) {
      const { error: errProf } = await supabase.from('kiddolens_profiles').upsert(profilesToUpsert);
      if (errProf) throw errProf;
    }

    // 3. Sync Channels 
    // Delete existing channels in remote that are not in local
    // To be safe, we'll only delete from this user's profiles
    if (localProfileIds.length > 0) {
      const { data: remoteChannels } = await supabase.from('kiddolens_channels').select('id, profile_id, youtube_channel_id');
      const localChannelKeys = new Set();
      state.data.profiles.forEach(p => {
        p.channels.forEach(c => localChannelKeys.add(`${p.id}_${c.id}`));
      });

      const channelsToDelete = (remoteChannels || [])
        .filter(c => localProfileIds.includes(c.profile_id))
        .filter(c => !localChannelKeys.has(`${c.profile_id}_${c.youtube_channel_id}`))
        .map(c => c.id);

      if (channelsToDelete.length > 0) {
        await supabase.from('kiddolens_channels').delete().in('id', channelsToDelete);
      }
    }

    // 3a. Upsert shared channel metadata (de-duplicated by youtube_channel_id)
    const channelInfoMap = new Map();
    state.data.profiles.forEach(p => {
      p.channels.forEach(c => {
        if (!channelInfoMap.has(c.id)) {
          channelInfoMap.set(c.id, {
            youtube_channel_id: c.id,
            title: c.name,
            thumbnail_url: c.thumbnail || '',
            updated_at: new Date().toISOString()
          });
        }
      });
    });
    const channelInfoToUpsert = [...channelInfoMap.values()];
    if (channelInfoToUpsert.length > 0) {
      const { error: errInfo } = await supabase
        .from('kiddolens_channel_info')
        .upsert(channelInfoToUpsert, { onConflict: 'youtube_channel_id' });
      if (errInfo) throw errInfo;
    }

    // 3b. Upsert lean join rows (profile ↔ channel, with sort order only)
    const channelsToInsert = [];
    state.data.profiles.forEach(p => {
      p.channels.forEach((c, idx) => {
        channelsToInsert.push({
          profile_id: p.id,
          youtube_channel_id: c.id,
          sort_order: idx,
        });
      });
    });

    if (channelsToInsert.length > 0) {
      const { error: errChan } = await supabase
        .from('kiddolens_channels')
        .upsert(channelsToInsert, { onConflict: 'profile_id, youtube_channel_id' });
      if (errChan) throw errChan;
    }

    // 4. Sync playlists (per profile): delete removed items, upsert the rest
    if (localProfileIds.length > 0) {
      const { data: remoteItems } = await supabase
        .from('kiddolens_playlist_items').select('id, profile_id, video_id');

      const localKeys = new Set();
      const itemsToUpsert = [];
      state.data.profiles.forEach(p => {
        getPlaylist(p.id).forEach((v, idx) => {
          localKeys.add(`${p.id}_${v.id}`);
          itemsToUpsert.push({
            profile_id: p.id,
            video_id: v.id,
            title: v.title || '',
            thumbnail_url: v.thumbnail || '',
            channel_id: v.channelId || '',
            channel_title: v.channelTitle || '',
            duration: v.duration ?? null,
            sort_order: idx
          });
        });
      });

      const itemsToDelete = (remoteItems || [])
        .filter(r => localProfileIds.includes(r.profile_id))
        .filter(r => !localKeys.has(`${r.profile_id}_${r.video_id}`))
        .map(r => r.id);
      if (itemsToDelete.length > 0) {
        await supabase.from('kiddolens_playlist_items').delete().in('id', itemsToDelete);
      }
      if (itemsToUpsert.length > 0) {
        const { error: errPl } = await supabase
          .from('kiddolens_playlist_items')
          .upsert(itemsToUpsert, { onConflict: 'profile_id, video_id' });
        if (errPl) throw errPl;
      }
    }

    console.log('Saved to Supabase.');
    state.lastSyncedAt = new Date().toISOString();
    updateLastSyncedUI();
  } catch (e) {
    console.error('Save to Supabase failed', e);
    showSyncToast(t('save_drive_failed', { message: e.message }), 'warning');
  }
}

async function downloadFromSupabase() {
  if (!state.user) return null;
  try {
    // Run independent queries in parallel — halves restore/sync latency
    const [{ data: settings }, { data: profiles }, { data: profileChannels }, { data: playlistItems }] = await Promise.all([
      supabase.from('kiddolens_user_settings').select('*').single(),
      supabase.from('kiddolens_profiles').select('*').order('created_at', { ascending: true }),
      supabase.from('kiddolens_channels')
        .select('profile_id, youtube_channel_id, sort_order')
        .order('sort_order', { ascending: true }),
      supabase.from('kiddolens_playlist_items')
        .select('*')
        .order('sort_order', { ascending: true })
    ]);

    // Query 2: get metadata for those specific channels (name, thumbnail)
    const channelInfoMap = {};
    const channelIds = [...new Set((profileChannels || []).map(c => c.youtube_channel_id))];
    if (channelIds.length > 0) {
      const { data: channelInfos } = await supabase
        .from('kiddolens_channel_info')
        .select('youtube_channel_id, title, thumbnail_url')
        .in('youtube_channel_id', channelIds);
      (channelInfos || []).forEach(ci => { channelInfoMap[ci.youtube_channel_id] = ci; });
    }

    if (!settings && (!profiles || profiles.length === 0)) return null; // No data

    // Build similar structure to configData
    const configData = {
      apiKey: settings?.youtube_api_key || '',
      filterShorts: settings?.filter_shorts ?? true,
      shareStats: settings?.share_stats ?? true,
      autoPlayNext: settings?.autoplay_next ?? false,
      parentLock: {
        enabled: settings?.parent_lock_enabled ?? false,
        mode: settings?.parent_lock_mode || 'pin',
        pinHash: settings?.parent_pin_hash || null
      },
      profiles: (profiles || []).map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        channels: (profileChannels || [])
          .filter(c => c.profile_id === p.id)
          .map(c => ({
            id: c.youtube_channel_id,
            name: channelInfoMap[c.youtube_channel_id]?.title || '',
            thumbnail: channelInfoMap[c.youtube_channel_id]?.thumbnail_url || ''
          }))
      })),
      lastUpdated: settings?.updated_at || new Date().toISOString()
    };

    if (configData.profiles.length > 0) {
      configData.currentProfileId = configData.profiles[0].id; // Assign a valid active profile
    }

    // Per-profile playlists (applied to localStorage by applyCloudData)
    configData._playlists = {};
    (playlistItems || []).forEach(item => {
      if (!configData._playlists[item.profile_id]) configData._playlists[item.profile_id] = [];
      configData._playlists[item.profile_id].push({
        id: item.video_id,
        title: item.title,
        thumbnail: item.thumbnail_url,
        channelId: item.channel_id,
        channelTitle: item.channel_title,
        duration: item.duration ?? undefined
      });
    });

    return configData;
  } catch (e) {
    console.error('Download from Supabase failed', e);
    return null;
  }
}

// --- Sync Helpers ---

/** Returns true if data contains at least one profile with at least one channel */
function hasMeaningfulData(data) {
  if (!data || !Array.isArray(data.profiles)) return false;
  return data.profiles.some(p => p.channels && p.channels.length > 0);
}

/** Show a toast in the settings footer (visible whenever settings panel is open) */
function showSyncToast(msg, type = 'success') {
  const el = document.getElementById('api-status');
  if (!el) return;
  el.className = `status-toast ${type} show`;
  el.textContent = msg;
  clearTimeout(el._toastTimer);
  el._toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

/** Returns a human-readable "X ago" string from an ISO timestamp */
function formatSyncTime(isoString) {
  if (!isoString) return '';
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return t('sync_just_now');
  if (diff < 3600) return t('sync_minutes_ago', { n: Math.floor(diff / 60) });
  return t('sync_hours_ago', { n: Math.floor(diff / 3600) });
}

/** Updates the "Last synced" indicator in the sync section */
function updateLastSyncedUI() {
  const el = document.getElementById('sync-last-time');
  if (!el) return;
  if (state.lastSyncedAt) {
    el.textContent = t('sync_last_synced', { time: formatSyncTime(state.lastSyncedAt) });
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

/**
 * Applies cloud data to local state without triggering an upload loop.
 * Sets isApplyingCloudData so saveLocalData() skips the Drive call.
 */
function applyCloudData(driveConfig) {
  state.isApplyingCloudData = true;
  // Preserve device-local anonymous id (not part of the cloud payload)
  driveConfig.anonymousUserId = driveConfig.anonymousUserId || state.data.anonymousUserId;
  // Keep the currently active child selected if it still exists in the cloud
  // data — restoring must never silently jump back to the first profile.
  if (driveConfig.profiles?.some(p => p.id === state.data.currentProfileId)) {
    driveConfig.currentProfileId = state.data.currentProfileId;
  }

  // Apply per-profile playlists from the cloud (cloud wins on restore)
  if (driveConfig._playlists) {
    (driveConfig.profiles || []).forEach(p => {
      const list = driveConfig._playlists[p.id] || [];
      try { localStorage.setItem(STORAGE_KEY_PLAYLIST + p.id, JSON.stringify(list)); } catch (e) { /* full */ }
    });
    delete driveConfig._playlists;
  }

  state.data = driveConfig;
  saveLocalData(); // persists to localStorage only (flag blocks cloud upload)
  state.isApplyingCloudData = false;
  updateProfileUI();
  updatePlaylistBadge();
  renderChannelNav();    // refresh channel nav bar with cloud channels
  fetchAllVideos(true);  // always refresh videos regardless of API key
  setTimeout(fetchMissingChannelIcons, 1000);
}


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
  filterShorts: true, // Default ON
  autoPlayNext: false, // Default OFF - parent opt-in for continuous play
  parentLock: { enabled: false, mode: 'quiz', pinHash: null } // gate for switching child profiles ('quiz' | 'pin')
};

let state = {
  data: DEFAULT_DATA,
  videos: [],
  user: null, // Track Supabase logged-in user
  lang: 'zh', // Lock app to Traditional Chinese
  channelNextPageTokens: {}, // Track pagination per channel for "Load More"
  currentSort: 'shuffle',    // Default to shuffle
  isApplyingCloudData: false, // Prevents save-loop when applying downloaded cloud data
  driveSaveTimer: null,       // Debounce timer for background cloud saves
  lastSyncedAt: null,         // Timestamp of last successful cloud sync
  initialSyncDone: false,     // Cloud sync runs once per page load, not on every token refresh
  playQueue: null,            // Active playlist queue (array of videos) while playing
  queueIndex: 0               // Current position in playQueue
};

// --- Shared Helpers ---

/** Escape untrusted text (video titles, channel/profile names) before inserting into innerHTML */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ui-avatars fallback URL, safe to embed inside an inline onerror handler (no quotes survive) */
function avatarFallbackUrl(name, size = 128) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || '?').replace(/'/g, '%27')}&background=random&size=${size}`;
}

/**
 * Title-based Shorts detection (used in Lite Mode and as cache fallback).
 * Matches #shorts / [shorts] / (shorts) / standalone "shorts", but NOT the
 * ordinary English word "short" (e.g. "A Short Story") to avoid over-filtering.
 */
const SHORTS_TITLE_REGEX = /#shorts?\b|\[shorts?\]|\(shorts?\)|\bshorts\b/i;
function isShortsTitle(title) {
  return SHORTS_TITLE_REGEX.test(title || '');
}

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
  document.getElementById('history-btn').title = t('watch_history');
  document.getElementById('settings-btn').title = t('parent_settings');
  const playlistBtnEl = document.getElementById('playlist-btn');
  if (playlistBtnEl) playlistBtnEl.title = t('playlist');

  // Toolbar — reflect the active channel filter (also on restored sessions)
  const label = document.getElementById('active-channel-display');
  if (label) {
    if (state.activeChannelId) {
      const activeCh = getCurrentProfile().channels.find(c => c.id === state.activeChannelId);
      label.textContent = activeCh ? activeCh.name : t('all_videos');
    } else {
      label.textContent = t('all_videos');
    }
    label.classList.add('show');
  }
  // videoCount.textContent is updated in renderVideos

  // Modal
  const settingsTitleText = document.getElementById('settings-title-text');
  if (settingsTitleText) settingsTitleText.textContent = t('parent_settings');

  // Cloud Sync
  const syncTitle = document.getElementById('sync-title');
  if (syncTitle) syncTitle.textContent = t('google_sync');
  document.querySelector('.settings-section .small-text').textContent = t('sync_desc');

  // Who is watching
  const whoTitle = document.getElementById('who-title');
  if (whoTitle) whoTitle.textContent = t('who_is_watching');
  document.getElementById('new-profile-name').placeholder = t('add_child_placeholder');

  // Parent Lock
  const lockTitle = document.getElementById('parent-lock-title');
  if (lockTitle) lockTitle.textContent = t('parent_lock');
  const lockLabel = document.getElementById('parent-lock-label-text');
  if (lockLabel) lockLabel.textContent = t('parent_lock_toggle');
  const lockDesc = document.getElementById('parent-lock-desc');
  if (lockDesc) lockDesc.textContent = t('parent_lock_desc');
  const changePinEl = document.getElementById('change-pin-btn');
  if (changePinEl) changePinEl.textContent = t('change_pin');
  const quizLabel = document.getElementById('lock-mode-quiz-label');
  if (quizLabel) quizLabel.textContent = t('lock_mode_quiz');
  const quizDesc = document.getElementById('lock-mode-quiz-desc');
  if (quizDesc) quizDesc.textContent = t('lock_mode_quiz_desc');
  const pinLabel = document.getElementById('lock-mode-pin-label');
  if (pinLabel) pinLabel.textContent = t('lock_mode_pin');
  const pinDesc = document.getElementById('lock-mode-pin-desc');
  if (pinDesc) pinDesc.textContent = t('lock_mode_pin_desc');

  // Connection Mode
  const connTitle = document.getElementById('connection-title');
  if (connTitle) connTitle.textContent = t('connection_mode');
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
  const contentTitle = document.getElementById('content-title');
  if (contentTitle) contentTitle.textContent = t('content_preferences');
  const fsLabel = document.getElementById('filter-shorts-label');
  if (fsLabel) fsLabel.textContent = t('filter_shorts');
  const fsDesc = document.getElementById('filter-shorts-desc');
  if (fsDesc) fsDesc.innerHTML = `
    <strong>${t('lite_mode')}:</strong> ${t('lite_filter_desc')}<br>
    <strong>${t('pro_mode')}:</strong> ${t('pro_filter_desc')}
  `;

  // Autoplay & anonymous-stats toggles
  const apLabel = document.getElementById('autoplay-label-text');
  if (apLabel) apLabel.textContent = t('autoplay_next');
  const apDesc = document.getElementById('autoplay-desc');
  if (apDesc) apDesc.textContent = t('autoplay_next_desc');
  const ssLabel = document.getElementById('share-stats-label-text');
  if (ssLabel) ssLabel.textContent = t('participate_ranking');
  const ssDesc = document.getElementById('share-stats-desc');
  if (ssDesc) ssDesc.textContent = t('ranking_desc');

  // Parent Audit Log
  const auditTitle = document.getElementById('audit-title');
  if (auditTitle) auditTitle.textContent = t('audit_log');
  const auditDescEl = document.getElementById('audit-desc');
  if (auditDescEl) auditDescEl.textContent = t('audit_desc');

  // Email login
  const emailInput = document.getElementById('email-login-input');
  if (emailInput) emailInput.placeholder = t('email_login_placeholder');
  const emailBtn = document.getElementById('email-login-btn');
  if (emailBtn) emailBtn.textContent = t('email_login_btn');

  // Footer privacy link
  const privacyLink = document.getElementById('privacy-link');
  if (privacyLink) privacyLink.textContent = t('privacy_policy');

  // Danger Zone (id-based — section order may change)
  const dangerTitle = document.getElementById('danger-title');
  if (dangerTitle) {
    dangerTitle.textContent = t('danger_zone');
    const resetBtn = document.getElementById('reset-app-btn');
    if (resetBtn) resetBtn.textContent = t('reset_app');
    const dzNote = dangerTitle.closest('.settings-section')?.querySelector('.small-text');
    if (dzNote) dzNote.textContent = t('reset_app_note');
  }

  // Footer
  const footerText = document.getElementById('footer-text');
  if (footerText) footerText.textContent = t('footer_made_by');

  // Re-render dynamic content
  renderVideos();
  updateProfileUI();
}

// DOM Elements
const videoContainer = document.getElementById('video-container');
const settingsModal = document.getElementById('settings-modal');
const playerModal = document.getElementById('player-modal');
const apiKeyInput = document.getElementById('api-key-input');
const apiStatus = document.getElementById('api-status');

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
// --- Supabase Auth & Sync ---
function setupSupabaseAuth() {
  supabase.auth.onAuthStateChange((event, session) => {
    state.user = session?.user || null;
    updateSyncUI();

    // Sync once per page load when a session appears (fresh login OR restored
    // session). Guarded so hourly token refreshes don't re-sync and re-render
    // the grid while a child is watching.
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && state.user && !state.initialSyncDone) {
      state.initialSyncDone = true;

      // If a different user was previously logged in on this device, reload the page
      // so init() runs fresh for the new user (shows wizard if they have no data, or restores their backup).
      const prevUid = localStorage.getItem('kiddolens_uid');
      if (prevUid && prevUid !== state.user.id) {
        console.log('New user detected — reloading for a fresh session.');
        state.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
        saveLocalData();
        localStorage.setItem('kiddolens_uid', state.user.id);
        location.reload();
        return;
      }
      localStorage.setItem('kiddolens_uid', state.user.id);

      syncWithSupabase();
      checkAndUploadStats(true); // Anonymous stats
    }
  });
}

function handleLogin() {
  supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname
    }
  });
}

function handleLogout() {
  supabase.auth.signOut();
  showSyncToast(t('logout_success') || 'Logged out successfully.');
}

function updateSyncUI() {
  const loginBtn = document.getElementById('sync-login-btn');
  const logoutBtn = document.getElementById('sync-logout-btn');
  const userInfoCard = document.getElementById('sync-user-info');

  if (!loginBtn) return;

  if (state.user) {
    // Logged In State
    loginBtn.style.display = 'block';
    loginBtn.textContent = t('sync_now');
    loginBtn.disabled = false;
    loginBtn.onclick = async () => {
      loginBtn.disabled = true;
      loginBtn.textContent = t('syncing');
      await syncWithSupabase();
      loginBtn.disabled = false;
      loginBtn.textContent = t('sync_now');
    };

    if (logoutBtn) {
      logoutBtn.style.display = 'block';
      logoutBtn.textContent = t('logout');
      logoutBtn.onclick = handleLogout;
    }

    const emailRowIn = document.getElementById('email-login-row');
    if (emailRowIn) emailRowIn.style.display = 'none';

    if (userInfoCard) {
      userInfoCard.classList.remove('hidden');
      userInfoCard.style.display = 'flex';

      const metadata = state.user.user_metadata;
      const avatar = document.getElementById('sync-avatar');
      const nameEl = document.getElementById('sync-name');
      const emailEl = document.getElementById('sync-email');

      if (nameEl && metadata?.name) nameEl.textContent = metadata.name;
      if (emailEl && state.user.email) emailEl.textContent = state.user.email;

      if (avatar) {
        if (metadata?.avatar_url) avatar.src = metadata.avatar_url;
        else if (metadata?.name) avatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(metadata.name)}&background=random`;
      }
    }

    // Check if wizard needs to be closed (Restored Backup)
    const wizard = document.querySelector('.wizard-modal');
    if (wizard) {
      wizard.remove();
      if (typeof startApp === 'function') startApp();
    }

    // Already logged in — the login nudge is no longer relevant
    document.getElementById('onboarding-tooltip')?.remove();

    updateLastSyncedUI();

  } else {
    // Logged Out State
    loginBtn.style.display = 'block';
    loginBtn.textContent = t('login_google');
    loginBtn.disabled = false;
    loginBtn.onclick = handleLogin;

    if (logoutBtn) logoutBtn.style.display = 'none';

    const emailRow = document.getElementById('email-login-row');
    if (emailRow) emailRow.style.display = 'flex';

    if (userInfoCard) {
      userInfoCard.classList.add('hidden');
      userInfoCard.style.display = 'none';
    }
  }
}

async function syncWithSupabase() {
  const dbConfig = await downloadFromSupabase();

  // ── Case 1: No cloud backup yet → first-time upload ──────────────────────
  if (!dbConfig) {
    console.log('Sync: No cloud file found — uploading local data for the first time.');
    await saveToSupabase();
    state.lastSyncedAt = new Date().toISOString();
    showSyncToast(t('sync_backed_up'));
    updateLastSyncedUI();
    return;
  }

  const localHasData = hasMeaningfulData(state.data);
  const cloudHasData = hasMeaningfulData(dbConfig);

  // ── Case 3: Local is empty, cloud has real data → silently restore ────────
  if (!localHasData && cloudHasData) {
    console.log('Sync: Local has no channels — restoring from cloud.');
    applyCloudData(dbConfig);
    state.lastSyncedAt = new Date().toISOString();
    showSyncToast(t('sync_restored'));
    updateLastSyncedUI();
    return;
  }

  // ── Case 4: Cloud is empty, local has real data → push to cloud ──────────
  if (localHasData && !cloudHasData) {
    console.log('Sync: Cloud has no channels — uploading local data.');
    await saveToSupabase();
    state.lastSyncedAt = new Date().toISOString();
    showSyncToast(t('sync_backed_up'));
    updateLastSyncedUI();
    return;
  }

  // ── Case 5: Neither side has meaningful data ──────────────────────────────
  if (!localHasData && !cloudHasData) {
    await saveToSupabase();
    return;
  }

  // ── Case 6: Both sides have real data — compare timestamps ───────────────
  const localTime = state.data.lastUpdated ? new Date(state.data.lastUpdated).getTime() : 0;
  const cloudTime = dbConfig.lastUpdated ? new Date(dbConfig.lastUpdated).getTime() : 0;
  console.log(`Sync: Local (${state.data.lastUpdated}) vs Cloud (${dbConfig.lastUpdated})`);

  if (localTime === cloudTime) {
    console.log('Sync: Already up to date.');
    state.lastSyncedAt = new Date().toISOString();
    showSyncToast(t('sync_uptodate'));
    updateLastSyncedUI();
    return;
  }

  if (localTime > cloudTime) {
    // Local is newer → push to cloud (user just made changes on this device)
    console.log('Sync: Local is newer — uploading to cloud.');
    await saveToSupabase();
    state.lastSyncedAt = new Date().toISOString();
    showSyncToast(t('sync_backed_up'));
    updateLastSyncedUI();
    return;
  }

  // Cloud is newer → automatically use cloud data (Supabase is authoritative)
  console.log('Sync: Cloud is newer — restoring from cloud.');
  applyCloudData(dbConfig);
  showSyncToast(t('sync_restored'));
  state.lastSyncedAt = new Date().toISOString();
  updateLastSyncedUI();
}

// --- App Startup ---
let appStarted = false;

function startApp() {
  // Hide spinner when app starts proper
  const spinner = document.querySelector('.loading-state');
  if (spinner) spinner.style.display = 'none';

  // One-time setup (event listeners, Supabase Auth, etc.)
  if (!appStarted) {
    console.log('Starting App (first time setup)...');
    appStarted = true;

    setupEventListeners();
    setupDangerZoneListener();

    setupSupabaseAuth();
  }

  // Restore last-session state (sort mode & this child's channel filter)
  const savedSort = localStorage.getItem(STORAGE_KEY_SORT);
  if (savedSort === 'newest' || savedSort === 'shuffle' || savedSort === 'oldest') {
    state.currentSort = savedSort;
  }
  if (state.activeChannelId == null) {
    state.activeChannelId = restoreActiveChannel(getCurrentProfile().id);
  }

  // Always run: UI updates & video fetch
  updateLanguageUI();
  updateProfileUI();
  updateSyncUI();
  updateTimeIndicator();
  updatePlaylistBadge();
  fetchMissingChannelIcons();
  fetchAllVideos();
}

/** Removes expired 24h API-cache entries so localStorage never fills up over time */
function purgeStaleApiCache() {
  const now = Date.now();
  Object.keys(localStorage).filter(k => k.startsWith('yt_api_cache_')).forEach(k => {
    try {
      const { timestamp } = JSON.parse(localStorage.getItem(k));
      if (!timestamp || now - timestamp > 24 * 60 * 60 * 1000) localStorage.removeItem(k);
    } catch (e) {
      localStorage.removeItem(k); // unparsable → junk
    }
  });
}

async function init() {
  purgeStaleApiCache();
  loadLocalData();

  // Check if first-time setup is needed
  const currentProfile = getCurrentProfile();
  if (!currentProfile || !currentProfile.name) {
    // Hide spinner immediately for wizard text clarity
    const spinner = document.querySelector('.loading-state');
    if (spinner) spinner.style.display = 'none';

    // Before showing wizard: check if Supabase has an active session.
    // This happens after the Google OAuth redirect or if the user was previously logged in.
    // If they have cloud data, restore it silently instead of showing the wizard again.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        state.user = session.user;
        localStorage.setItem('kiddolens_uid', session.user.id);
        const dbConfig = await downloadFromSupabase();
        if (dbConfig && dbConfig.profiles?.some(p => p.name)) {
          // Returning user with cloud backup — restore and bypass wizard
          applyCloudData(dbConfig);
          startApp();
          return;
        }
      }
    } catch (e) { console.warn('Pre-wizard session check failed:', e); }

    showOnboardingWizard();
    return; // Pause init until wizard finishes
  }

  // Normal Start
  startApp();

  // Show Login Nudge for users who finished setup but aren't logged in
  if (currentProfile && !state.user) {
    setTimeout(showLoginNudge, 3000);
  }
}

/**
 * Login nudge: shown once to users who finished setup but aren't logged in,
 * suggesting they back up their list with a Google login.
 */
function showLoginNudge() {
  if (state.user) return;
  if (localStorage.getItem('onboarding_dismissed')) return;
  if (document.getElementById('onboarding-tooltip')) return;

  const tooltip = document.createElement('div');
  tooltip.id = 'onboarding-tooltip';
  tooltip.innerHTML = `
    <div class="onboarding-content">
      <p class="onboarding-text">${t('onboarding_login_tooltip')}</p>
      <div class="onboarding-actions">
        <button id="onboarding-go" class="onboarding-btn-primary">${t('login_google')}</button>
        <button id="onboarding-dismiss" class="onboarding-btn-dismiss">${t('onboarding_dismiss')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(tooltip);

  requestAnimationFrame(() => tooltip.classList.add('show'));

  tooltip.querySelector('#onboarding-go').onclick = () => {
    dismissLoginNudge(tooltip);
    handleLogin();
  };
  tooltip.querySelector('#onboarding-dismiss').onclick = () => dismissLoginNudge(tooltip);
}

function dismissLoginNudge(tooltip) {
  localStorage.setItem('onboarding_dismissed', '1');
  tooltip.classList.remove('show');
  setTimeout(() => tooltip.remove(), 400);
}

function loadLocalData() {
  const rawData = localStorage.getItem(STORAGE_KEY_DATA);

  if (rawData) {
    try {
      state.data = JSON.parse(rawData);
    } catch (e) {
      console.error('Local data corrupted, resetting to defaults', e);
      state.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
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

  // Self-heal: earlier mock-mode sessions may have persisted fake uploads
  // playlist ids, which make real API calls fail with 400. Strip them so
  // they get re-derived from the real API on the next fetch.
  let healed = false;
  state.data.profiles.forEach(p => (p.channels || []).forEach(c => {
    if (c.uploadsId && c.uploadsId.includes('mock')) {
      delete c.uploadsId;
      healed = true;
    }
  }));
  if (healed) saveLocalData();
}

function saveLocalData() {
  state.data.lastUpdated = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(state.data));
  // Auto-sync to cloud with debounce — skip if we're currently applying cloud data (prevents save loop)
  if (state.user && !state.isApplyingCloudData) {
    clearTimeout(state.driveSaveTimer);
    state.driveSaveTimer = setTimeout(() => saveToSupabase(), 3000);
  }
}

function getCurrentProfile() {
  return state.data.profiles.find(p => p.id === state.data.currentProfileId) || state.data.profiles[0];
}

// Old implementations removed. Using the new ones at the top.

// --- Video Fetching ---
const CACHE_DURATION = 1000 * 60 * 60; // 1 Hour
// Mock mode (local dev only): all YouTube API calls return fake data to save quota
const IS_MOCK = import.meta.env.VITE_USE_MOCK_YOUTUBE_API === 'true';

// --- Optimized API Fetcher (Mock & Cache) ---
// Cost-saving wrapper for all YouTube API calls
async function ytFetch(url, forceNetwork = false) {
  // 1. Mock Mode (100% Free - local development only)
  if (IS_MOCK) {
    console.log('[Mock Mode] Simulating API call:', url.split('?')[0]);
    return await getMockData(url);
  }

  // 2. Cache Mode (Save Quota on repeated requests - Valid for 24h)
  const cacheKey = `yt_api_cache_${btoa(url)}`; // Base64 encode URL for safe key
  const cachedStr = localStorage.getItem(cacheKey);

  if (cachedStr && !forceNetwork) {
    try {
      const { timestamp, data } = JSON.parse(cachedStr);
      const ageHours = (Date.now() - timestamp) / (1000 * 60 * 60);
      if (ageHours < 24) {
        console.log('[API Cache Hit] Saved quota for:', url.split('?')[0]);
        return data; // Return cached JSON
      }
    } catch (e) { console.warn('ytFetch cache parse error'); }
  }

  // 3. Network Request (Costs Quota)
  console.log('[API Net Req] Fetching:', url.split('?')[0]);
  const res = await fetch(url);
  const data = await res.json();

  if (res.ok) {
    try {
      // Save to localStorage
      localStorage.setItem(cacheKey, JSON.stringify({
        timestamp: Date.now(),
        data: data
      }));
    } catch (e) { console.warn('localStorage full, skipping cache save'); }
  }

  return data;
}

async function fetchAllVideos(forceRefresh = false) {
  const profile = getCurrentProfile();
  const preservedChannelId = state.activeChannelId;

  if (!profile.channels || profile.channels.length === 0) {
    state.videos = [];
    renderVideos();
    apiStatus.textContent = t('no_channels');
    return;
  }

  // 0. Decide Mode: API Key vs RSS (Lite Mode)
  const useLiteMode = !state.data.apiKey;

  // 1. Check Cache (Works for both modes)
  const cacheKey = `safetube_v2_${profile.id}`;
  const cachedData = localStorage.getItem(cacheKey);

  if (!forceRefresh && cachedData) {
    try {
      const { timestamp, videos, channelIds, nextPageTokens } = JSON.parse(cachedData);
      const age = Date.now() - timestamp;
      // Invalidate cache when a channel was added after it was written,
      // otherwise the new channel's videos would not appear for up to 1 hour.
      const cachedChannelSet = new Set(channelIds || []);
      const hasNewChannel = profile.channels.some(c => !cachedChannelSet.has(c.id));
      if (age < CACHE_DURATION && !hasNewChannel) {
        const currentChannelIds = new Set(profile.channels.map(c => c.id));
        let validVideos = videos.filter(v => currentChannelIds.has(v.channelId));

        // Re-apply filter on cached videos
        if (state.data.filterShorts) {
          validVideos = validVideos.filter(v => {
            if (v.duration && v.duration > 0) return v.duration > 90;
            return !isShortsTitle(v.title);
          });
        }

        if (validVideos.length > 0) {
          console.log('Using cached videos (filtered)');
          state.videos = validVideos;
          // Restore pagination tokens so the "Load More" button survives reloads
          state.channelNextPageTokens = nextPageTokens || {};
          state.activeChannelId = preservedChannelId;
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
  videoContainer.innerHTML = '';
  // Show 8 skeletons
  for (let i = 0; i < 8; i++) {
    const skel = document.createElement('div');
    skel.className = 'skeleton-card';
    skel.innerHTML = `
      <div class="skeleton-thumb"></div>
      <div class="skeleton-text"></div>
      <div class="skeleton-text short"></div>
    `;
    videoContainer.appendChild(skel);
  }

  // Still show status toast for context
  apiStatus.textContent = useLiteMode ? (t('loading_lite_mode') || '🌐 Loading (Free Mode)...') : t('loading_videos', { name: profile.name });
  apiStatus.style.color = '#FFA500';

  try {
    let checkVideos = [];
    state.channelNextPageTokens = {}; // Reset pagination tokens for fresh fetch

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
            state.activeChannelId = preservedChannelId;
            renderChannelNav();
            updateSortUI();
            renderVideos();
          }

          apiStatus.textContent = t('loading_progress', { done: loadedCount, total: totalChannels });
          apiStatus.style.color = '#FFA500';
          return videos;
        } catch (e) {
          loadedCount++;
          console.warn(`Failed to fetch ${channel.name}:`, e);
          return [];
        }
      });

      await Promise.all(promises);

      // Final state: all RSS proxies failed → show a friendly hint,
      // and do NOT cache anything so the next attempt retries for real.
      if (checkVideos.length === 0) {
        console.warn('RSS returned no videos');
        state.videos = [];

        videoContainer.innerHTML = `<div style="text-align:center; padding: 2rem;">
            <p style="font-size: 1.2rem;">🎬</p>
            <p style="font-weight: 600; margin: 10px 0;">${t('no_videos_yet')}</p>
            <p class="small-text" style="color: #888; max-width: 300px; margin: 0 auto;">${t('lite_mode_slow_hint')}</p>
          </div>`;

        apiStatus.textContent = t('status_demo_mode');
        apiStatus.style.color = '#FFA500';
        return;
      }

      apiStatus.textContent = t('videos_loaded_free', { count: checkVideos.length });
      apiStatus.style.color = '#4ecdc4';

    } else {
      // --- API Mode ---
      const validChannels = profile.channels.filter(c => c && c.id);
      const promises = validChannels.map(channel => fetchChannelVideos(channel, null, forceRefresh));
      const results = await Promise.all(promises);
      checkVideos = results.flat().sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

      apiStatus.textContent = t('status_updated');
      apiStatus.style.color = '#4ecdc4';

      fetchMissingChannelIcons(); // Only in Full API Mode
    }

    state.videos = checkVideos;

    // Save to Cache (must match the read key safetube_v2_*)
    // channelIds lets the cache be invalidated when a new channel is added.
    const cacheKey2 = `safetube_v2_${profile.id}`;
    try {
      localStorage.setItem(cacheKey2, JSON.stringify({
        timestamp: Date.now(),
        videos: state.videos,
        channelIds: profile.channels.map(c => c.id),
        nextPageTokens: state.channelNextPageTokens
      }));
    } catch (e) { console.warn('localStorage full, skipping video cache save'); }

    if (!useLiteMode) saveLocalData();

    state.activeChannelId = preservedChannelId;

    renderChannelNav();
    updateSortUI();
    renderVideos();

  } catch (error) {
    if (useLiteMode) {
      console.error('RSS Lite Mode Error:', error);
      apiStatus.textContent = t('error_rss');
      apiStatus.style.color = '#ff6b6b';
      videoContainer.innerHTML = `<div style="text-align:center; padding: 2rem;">
            <p>😕 ${t('error_rss')}</p>
            <p class="small-text" style="margin-top: 8px;">${t('lite_mode_slow_hint')}</p>
        </div>`;
    } else {
      console.error('Error fetching videos:', error);
      apiStatus.textContent = t('error_api', { message: error.message });
      apiStatus.style.color = '#ff6b6b';
      videoContainer.innerHTML = `<div style="text-align:center; padding: 2rem;">
            <p>😕 ${t('error_api', { message: esc(error.message) })}</p>
            <p class="small-text" style="margin-top: 8px;">${t('lite_mode_slow_hint')}</p>
        </div>`;
    }
  }
}

// --- Lite Mode: RSS Fetcher ---
async function fetchChannelRSS(channel) {
  // Public YouTube RSS Feed URL
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`;

  // Our own Supabase Edge Function proxy first (fast, reliable, private),
  // free third-party CORS proxies only as fallback.
  const proxyConfigs = [
    {
      url: `${supabaseUrl}/functions/v1/rss-proxy?channel_id=${channel.id}`,
      type: 'text',
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}` }
    },
    { url: `https://corsproxy.io/?url=${encodeURIComponent(rssUrl)}`, type: 'text' },
    { url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(rssUrl)}`, type: 'text' },
    { url: `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`, type: 'json' }
  ];

  for (const proxy of proxyConfigs) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

      const res = await fetch(proxy.url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: proxy.headers || {}
      });
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
          if (state.data.filterShorts && isShortsTitle(title)) {
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

async function fetchChannelVideos(channel, startPageToken = null, forceRefresh = false) {
  // Optimization: If we already have uploadsId, skip first call
  let uploadsPlaylistId = channel.uploadsId;

  if (!uploadsPlaylistId) {
    // Fetch uploads ID cost: 1 unit
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channel.id}&key=${state.data.apiKey}`;
    try {
      const chData = await ytFetch(channelUrl, forceRefresh);

      if (!chData.items || chData.items.length === 0) return [];
      uploadsPlaylistId = chData.items[0].contentDetails.relatedPlaylists.uploads;

      // Save for next time! (skip in mock mode — a fake playlist id must
      // never be persisted, or real API calls will 400 once mock is off)
      if (!IS_MOCK) channel.uploadsId = uploadsPlaylistId;
    } catch (e) {
      console.error(`Failed to fetch channel details for ${channel.id}`, e);
      return [];
    }
  }

  // --- Smart Pagination for Shorts-heavy channels ---
  // Strategy: Fetch first page. If filterShorts is on and too few long videos
  // remain, fetch additional pages until we have enough or hit a limit.
  // Cost: 2 units per extra page (1 playlistItems + 1 videos detail check).
  // Most channels won't trigger extra pages, keeping quota usage low.
  // Quota math: each extra page costs 2 units (playlistItems + videos detail),
  // and ytFetch caches every URL for 24h, so worst case is ~10 units per
  // channel per day — trivial against the 10,000/day default quota.
  const MIN_DESIRED_VIDEOS = 12; // Target minimum long videos per channel
  const MAX_PAGES = 5;           // Safety cap: max pages to fetch
  const isLoadMore = !!startPageToken; // If called with a token, this is a "Load More" request

  let allFilteredVideos = [];
  let nextPageToken = startPageToken || null;
  let page = 0;

  try {
    do {
      // Fetch Videos cost: 1 unit per page
      let plUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=20&key=${state.data.apiKey}`;
      if (nextPageToken) {
        plUrl += `&pageToken=${nextPageToken}`;
      }

      const plData = await ytFetch(plUrl, forceRefresh);

      if (!plData.items || plData.items.length === 0) break;

      const rawItems = plData.items;
      nextPageToken = plData.nextPageToken || null;
      page++;

      // --- Shorts Filtering (API Mode) ---
      if (state.data.filterShorts) {
        // Check duration to filter Shorts. Cost: 1 unit per batch.
        const videoIds = rawItems.map(item => item.snippet.resourceId.videoId).join(',');
        const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${state.data.apiKey}`;

        // Build title lookup from rawItems (already have snippet from playlistItems)
        const titleMap = new Map(rawItems.map(item => [
          item.snippet.resourceId.videoId,
          item.snippet.title
        ]));

        let allowedIds = new Set();
        let dData = null; // Declare outside try so durationMap can access it below

        try {
          dData = await ytFetch(detailsUrl, forceRefresh); // Assign (not declare) so it's accessible after the block

          if (dData.items) {
            dData.items.forEach(v => {
              const durRaw = v.contentDetails.duration;
              const duration = parseDuration(durRaw);
              const title = titleMap.get(v.id) || v.id;

              // Filter: Shorts are <= 60s, threshold 90s allows short music clips through.
              // If duration is 0 (parse fail), ALLOW it to avoid hiding valid videos.
              if (duration > 90 || duration === 0) {
                allowedIds.add(v.id);
              } else {
                console.log(`Filtered Short: ${title} (${duration}s) [Raw: ${durRaw}]`);
              }
            });
          }
        } catch (err) {
          console.warn('Failed to fetch video durations, skipping filter', err);

          // Show a warning to the user so they know filtering might be incomplete
          const apiStatus = document.getElementById('api-status');
          if (apiStatus) {
            apiStatus.textContent = "⚠️ Duration check failed - Check API Quota";
            apiStatus.className = "status-toast warning show";
            setTimeout(() => apiStatus.classList.remove('show'), 5000);
          }

          // Fallback: allow all videos if we can't check duration
          rawItems.forEach(item => allowedIds.add(item.snippet.resourceId.videoId));
        }

        // Create a map for duration lookup (used to store duration on video objects for cache)
        const durationMap = new Map();
        if (dData && dData.items) {
          dData.items.forEach(v => {
            durationMap.set(v.id, parseDuration(v.contentDetails.duration));
          });
        }

        const pageVideos = rawItems
          .filter(item => allowedIds.has(item.snippet.resourceId.videoId))
          .map(item => {
            const vidId = item.snippet.resourceId.videoId;
            return {
              id: vidId,
              title: item.snippet.title,
              thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url,
              channelTitle: item.snippet.channelTitle,
              channelId: channel.id,
              publishedAt: item.snippet.publishedAt,
              duration: durationMap.get(vidId)
            };
          });

        allFilteredVideos.push(...pageVideos);

        if (allFilteredVideos.length >= MIN_DESIRED_VIDEOS) {
          console.log(`[${channel.name}] Got ${allFilteredVideos.length} long videos in ${page} page(s) ✓`);
          break;
        }

        if (page < MAX_PAGES && nextPageToken) {
          // Not enough yet, fetch next page
          console.log(`[${channel.name}] Only ${allFilteredVideos.length} long videos after page ${page}, fetching more...`);
        }

      } else {
        // filterShorts is OFF: take all videos from first page
        const mapped = rawItems.map(item => ({
          id: item.snippet.resourceId.videoId,
          title: item.snippet.title,
          thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url,
          channelTitle: item.snippet.channelTitle,
          channelId: channel.id,
          publishedAt: item.snippet.publishedAt
        }));

        allFilteredVideos.push(...mapped);

        // Use break to exit loop but trigger token save below
        break;
      }

    } while (page < MAX_PAGES && nextPageToken);

    if (allFilteredVideos.length < MIN_DESIRED_VIDEOS && !isLoadMore) {
      console.warn(`[${channel.name}] Could only find ${allFilteredVideos.length} long videos after ${page} page(s)`);
    }

    // Save nextPageToken for "Load More" feature
    state.channelNextPageTokens[channel.id] = nextPageToken || null;

    return allFilteredVideos;

  } catch (e) {
    console.error(`Failed to fetch videos for ${channel.id}`, e);
    return allFilteredVideos.length > 0 ? allFilteredVideos : [];
  }
}

// Helper: Parse ISO 8601 Duration to Seconds (Robust)
function parseDuration(duration) {
  if (!duration) return 0;

  const matchH = duration.match(/(\d+)H/);
  const matchM = duration.match(/(\d+)M/);
  const matchS = duration.match(/(\d+)S/);

  const hours = matchH ? parseInt(matchH[1]) : 0;
  const minutes = matchM ? parseInt(matchM[1]) : 0;
  const seconds = matchS ? parseInt(matchS[1]) : 0;

  return (hours * 3600) + (minutes * 60) + seconds;
}

// --- Sorting Logic ---
function sortVideos(sortType) {
  state.currentSort = sortType;
  localStorage.setItem(STORAGE_KEY_SORT, sortType); // remember across reloads
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

// --- Parent Audit Log ---
// Records settings changes on this device so parents can always see what was
// changed (kids old enough to solve a math gate can't hide their tracks).
const STORAGE_KEY_AUDIT = 'kiddolens_audit_log';
const MAX_AUDIT_ENTRIES = 100;

function logAudit(msgKey, vars = {}) {
  try {
    const log = JSON.parse(localStorage.getItem(STORAGE_KEY_AUDIT) || '[]');
    log.unshift({ msg: t(msgKey, vars), ts: Date.now() });
    localStorage.setItem(STORAGE_KEY_AUDIT, JSON.stringify(log.slice(0, MAX_AUDIT_ENTRIES)));
  } catch (e) { /* ignore */ }
}

function renderAuditLog() {
  const el = document.getElementById('audit-log-list');
  if (!el) return;
  let log = [];
  try { log = JSON.parse(localStorage.getItem(STORAGE_KEY_AUDIT) || '[]'); } catch (e) { /* ignore */ }

  if (log.length === 0) {
    el.innerHTML = `<p class="small-text" style="color:#999;">${t('audit_empty')}</p>`;
    return;
  }

  el.innerHTML = log.slice(0, 50).map(entry => `
    <div class="audit-item">
      <span class="audit-time">${relativeTime(entry.ts)}</span>
      <span class="audit-msg">${esc(entry.msg)}</span>
    </div>
  `).join('');
}

// --- Watch History & Interest Scoring ---

function recordWatch(video) {
  const profile = getCurrentProfile();
  if (!profile) return;
  const key = STORAGE_KEY_WATCH_HISTORY + profile.id;
  // Re-watching a video moves it to the top instead of duplicating the entry
  const history = JSON.parse(localStorage.getItem(key) || '[]').filter(h => h.videoId !== video.id);
  history.unshift({
    videoId: video.id,
    title: video.title,
    thumbnail: video.thumbnail,
    channelId: video.channelId,
    channelTitle: video.channelTitle,
    watchedAt: Date.now()
  });
  const cutoff = Date.now() - INTEREST_WINDOW_MS;
  const trimmed = history.filter(h => h.watchedAt > cutoff).slice(0, MAX_WATCH_HISTORY);
  localStorage.setItem(key, JSON.stringify(trimmed));
}

function getChannelInterestScores(profileId) {
  const key = STORAGE_KEY_WATCH_HISTORY + profileId;
  const history = JSON.parse(localStorage.getItem(key) || '[]');
  const scores = {};
  const now = Date.now();
  history.forEach(({ channelId, watchedAt }) => {
    const daysAgo = (now - watchedAt) / 86400000;
    if (!scores[channelId]) scores[channelId] = 0;
    if (daysAgo < 3) scores[channelId] += 3;
    else if (daysAgo < 7) scores[channelId] += 2;
    else scores[channelId] += 1;
  });
  return scores;
}

/** Video ids this child has already watched (within the 14-day history window) */
function getWatchedVideoIds(profileId) {
  const history = JSON.parse(localStorage.getItem(STORAGE_KEY_WATCH_HISTORY + profileId) || '[]');
  return new Set(history.map(h => h.videoId));
}

// --- Smart Interleaving Algorithm ---
// Ensures channel diversity (max 2 consecutive from same channel) while
// prioritising channels the child has recently shown interest in.

function applySmartInterleaving(videos) {
  const profile = getCurrentProfile();
  const interestScores = profile ? getChannelInterestScores(profile.id) : {};
  const watchedIds = profile ? getWatchedVideoIds(profile.id) : new Set();
  const now = Date.now();

  // Per-video score: unwatched videos rank far above watched ones, and fresh
  // uploads get a boost so a channel's new video surfaces first.
  const videoScore = (v) => {
    let s = 0;
    const daysOld = (now - new Date(v.publishedAt).getTime()) / 86400000;
    if (daysOld < 2) s += 30;
    else if (daysOld < 7) s += 20;
    else if (daysOld < 30) s += 10;
    if (watchedIds.has(v.id)) s -= 100; // watched sinks to the back of its channel queue
    return s;
  };

  // Group videos by channel; each queue ordered by score, then newest-first
  const byChannel = {};
  videos.forEach(v => {
    if (!byChannel[v.channelId]) byChannel[v.channelId] = [];
    byChannel[v.channelId].push(v);
  });
  for (const id in byChannel) {
    byChannel[id].sort((a, b) =>
      videoScore(b) - videoScore(a) || new Date(b.publishedAt) - new Date(a.publishedAt)
    );
  }

  // Channel weights: interest counts double (recently-watched channels appear
  // noticeably more), plus a bonus when the channel has a fresh unwatched
  // upload (<48h) waiting at the head of its queue. Base 1 keeps every
  // channel in rotation even with no watch history.
  const effectiveScores = {};
  for (const id in byChannel) {
    effectiveScores[id] = 1 + 2 * (interestScores[id] || 0);
    const head = byChannel[id][0];
    if (head && !watchedIds.has(head.id) &&
      (now - new Date(head.publishedAt).getTime()) < 48 * 3600 * 1000) {
      effectiveScores[id] += 4;
    }
  }

  const result = [];
  const queues = {};
  for (const id in byChannel) queues[id] = [...byChannel[id]];

  let lastChannelId = null;
  let consecutiveCount = 0;
  const MAX_CONSECUTIVE = 2;

  while (Object.keys(queues).length > 0) {
    const available = Object.keys(queues);

    // Avoid picking the same channel more than MAX_CONSECUTIVE times in a row
    let eligible = available;
    if (lastChannelId && consecutiveCount >= MAX_CONSECUTIVE) {
      const others = available.filter(id => id !== lastChannelId);
      if (others.length > 0) eligible = others;
    }

    // Weighted random selection
    const totalScore = eligible.reduce((sum, id) => sum + effectiveScores[id], 0);
    let rand = Math.random() * totalScore;
    let selected = eligible[0];
    for (const id of eligible) {
      rand -= effectiveScores[id];
      if (rand <= 0) { selected = id; break; }
    }

    result.push(queues[selected].shift());
    if (queues[selected].length === 0) delete queues[selected];

    if (selected === lastChannelId) {
      consecutiveCount++;
    } else {
      lastChannelId = selected;
      consecutiveCount = 1;
    }
  }

  return result;
}

// === WATCH TIME MANAGEMENT ===

function getTodayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getTodayWatchSeconds(profileId) {
  const key = STORAGE_KEY_WATCH_TIME + profileId + '_' + getTodayStr();
  return parseInt(localStorage.getItem(key) || '0', 10);
}

function addWatchSeconds(profileId, seconds) {
  const key = STORAGE_KEY_WATCH_TIME + profileId + '_' + getTodayStr();
  const current = getTodayWatchSeconds(profileId);
  localStorage.setItem(key, String(current + Math.round(seconds)));
}

function fmtTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Timer state — tracks a currently-playing session
let _watchTimerStart = null;    // Date.now() when playback last started
let _watchTimerInterval = null; // setInterval handle

function startWatchTimer() {
  if (_watchTimerStart !== null) return; // already running
  _watchTimerStart = Date.now();
  _watchTimerInterval = setInterval(() => {
    checkWatchTimeLimit();
    updateTimeIndicator();
  }, 10000); // check every 10 s
}

function stopWatchTimer() {
  if (_watchTimerStart === null) return;
  const elapsed = (Date.now() - _watchTimerStart) / 1000;
  _watchTimerStart = null;
  clearInterval(_watchTimerInterval);
  _watchTimerInterval = null;
  const profile = getCurrentProfile();
  if (profile && elapsed > 1) {
    addWatchSeconds(profile.id, elapsed);
    updateTimeIndicator();
  }
}

let _limitWarningShown = false; // ensures the 5-minute warning fires exactly once

function checkWatchTimeLimit() {
  const profile = getCurrentProfile();
  if (!profile || !profile.dailyLimit) return;
  const limitSec = profile.dailyLimit * 60;
  const elapsed = _watchTimerStart ? (Date.now() - _watchTimerStart) / 1000 : 0;
  const todayTotal = getTodayWatchSeconds(profile.id) + elapsed;
  const remaining = limitSec - todayTotal;
  if (remaining > 300) _limitWarningShown = false;
  if (remaining <= 300 && remaining > 0 && !_limitWarningShown) {
    _limitWarningShown = true;
    showWatchTimeWarning(Math.ceil(remaining / 60));
  }
  if (remaining <= 0) {
    stopWatchTimer();
    pauseAndShowTimeLimitReached();
  }
}

function updateTimeIndicator() {
  const badge = document.getElementById('watch-time-badge');
  if (!badge) return;
  const profile = getCurrentProfile();
  if (!profile || !profile.dailyLimit) {
    badge.textContent = '';
    badge.className = 'watch-time-badge';
    return;
  }
  const limitSec = profile.dailyLimit * 60;
  const elapsed = _watchTimerStart ? (Date.now() - _watchTimerStart) / 1000 : 0;
  const todayTotal = getTodayWatchSeconds(profile.id) + elapsed;
  const remaining = Math.max(0, limitSec - todayTotal);
  badge.textContent = t('time_remaining', { t: fmtTime(remaining) });
  badge.className = 'watch-time-badge' + (remaining <= 300 ? ' time-low' : '');
}

function showWatchTimeWarning(minutesLeft) {
  // Show the warning where the child is actually looking: inside the player.
  // (The settings toast is invisible while the settings panel is closed.)
  const wrapper = document.querySelector('#player-modal .video-wrapper');
  if (!wrapper) return;
  wrapper.querySelector('.time-warning-banner')?.remove();
  const banner = document.createElement('div');
  banner.className = 'time-warning-banner';
  banner.textContent = t('time_limit_warning', { n: minutesLeft });
  wrapper.appendChild(banner);
  setTimeout(() => banner.remove(), 8000);
}

function pauseAndShowTimeLimitReached() {
  if (activeYTPlayer) {
    try { activeYTPlayer.pauseVideo(); } catch (e) { /* ignore */ }
  }
  document.querySelector('.time-limit-overlay')?.remove();
  const wrapper = document.querySelector('#player-modal .video-wrapper');
  if (!wrapper) return;
  const overlay = document.createElement('div');
  overlay.className = 'time-limit-overlay';
  overlay.innerHTML = `
    <div class="time-limit-content">
      <div class="time-limit-icon">⏰</div>
      <p class="time-limit-msg">${t('time_limit_reached_title')}</p>
      <p class="time-limit-sub">${t('time_limit_reached_sub')}</p>
      <button class="ended-btn ended-close">${t('close')}</button>
    </div>
  `;
  overlay.querySelector('.ended-close').onclick = closePlayer;
  wrapper.appendChild(overlay);
}

function getSortedVideos(videos) {
  const v = [...videos]; // Copy array
  if (state.currentSort === 'newest') {
    return v.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  } else if (state.currentSort === 'oldest') {
    return v.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
  } else if (state.currentSort === 'shuffle') {
    // Smart interleaving: balances channel diversity with personalised interest scoring
    return applySmartInterleaving(v);
  }
  return v;
}

// --- Icon Auto-Fetch ---
async function fetchMissingChannelIcons() {
  const profile = getCurrentProfile();
  let missingIcons = profile.channels.filter(c => !c.thumbnail);
  if (missingIcons.length === 0) return; // all thumbnails present (loaded from Supabase) — done

  // Option 1: YouTube Data API — one batch request for all missing channels
  if (state.data.apiKey) {
    const ids = missingIcons.map(c => c.id).join(',');
    try {
      const data = await ytFetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${ids}&key=${state.data.apiKey}`
      );
      if (data.items) {
        let updated = false;
        data.items.forEach(item => {
          const ch = profile.channels.find(c => c.id === item.id);
          if (ch) { ch.thumbnail = item.snippet.thumbnails.default?.url; updated = true; }
        });
        if (updated) finalizeIconUpdate();
      }
    } catch (e) {
      console.warn('YouTube API icon fetch failed', e);
    }
  }

  // Option 2: Rankings cache — uses _rankingsCache if already fetched (zero extra network calls),
  // otherwise one shared request. No CORS proxy, no per-channel scraping.
  missingIcons = profile.channels.filter(c => !c.thumbnail);
  if (missingIcons.length === 0) return;
  try {
    const rankings = await fetchRankingsRaw(); // cached — free on subsequent calls
    let updated = false;
    missingIcons.forEach(missing => {
      const match = rankings.find(r => r.id === missing.id);
      if (match?.thumbnail) { missing.thumbnail = match.thumbnail; updated = true; }
    });
    if (updated) finalizeIconUpdate();
  } catch (e) {
    console.warn('Rankings icon fallback failed', e);
  }
}

function finalizeIconUpdate() {
  saveLocalData();
  renderChannelNav();
  if (state.user) saveToSupabase();
}


// Shared cache so all callers (recommendation modal, wizard) share one fetch
let _rankingsCache = null;
let _rankingsFetchPromise = null;

async function fetchRankingsRaw() {
  if (_rankingsCache) return _rankingsCache;
  if (_rankingsFetchPromise) return _rankingsFetchPromise;

  const run = async () => {
    // 24h localStorage cache — makes the wizard & manage-channel modal open instantly
    const CACHE_KEY = 'kiddolens_rankings_cache';
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached && cached.data?.length && Date.now() - cached.ts < 24 * 60 * 60 * 1000) {
        return cached.data;
      }
    } catch (e) { /* ignore bad cache */ }

    try {
      const { data, error } = await supabase.rpc('get_channel_rankings');
      if (error) throw new Error(error.message);
      if (data && data.length > 0) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch (e) { /* full */ }
        return data;
      }
    } catch (e) {
      console.warn('Supabase rankings fetch failed, using curated fallback:', e);
    }
    return [...CURATED_CHANNELS];
  };

  _rankingsFetchPromise = run().then(result => {
    _rankingsCache = result;
    _rankingsFetchPromise = null;
    return result;
  });

  return _rankingsFetchPromise;
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

  // "管理頻道" button — right after "所有影片", before individual channels
  const manageBtn = document.createElement('div');
  manageBtn.className = 'nav-item nav-item-add';
  manageBtn.title = '管理頻道';
  manageBtn.innerHTML = `
    <div class="nav-add-circle">
      <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="4" y1="6" x2="20" y2="6"/>
        <circle cx="8" cy="6" r="2.5" fill="currentColor" stroke="none"/>
        <line x1="4" y1="12" x2="20" y2="12"/>
        <circle cx="16" cy="12" r="2.5" fill="currentColor" stroke="none"/>
        <line x1="4" y1="18" x2="20" y2="18"/>
        <circle cx="8" cy="18" r="2.5" fill="currentColor" stroke="none"/>
      </svg>
    </div>
    <span>管理頻道</span>
  `;
  manageBtn.onclick = () => showAddChannelModal();
  channelNav.appendChild(manageBtn);

  // Channel Buttons
  profile.channels.forEach(channel => {
    const btn = document.createElement('div');
    btn.className = `nav-item ${state.activeChannelId === channel.id ? 'active' : ''}`;
    btn.title = channel.name; // Tooltip

    const fallbackSrc = avatarFallbackUrl(channel.name);
    const avatarSrc = channel.thumbnail || fallbackSrc;

    btn.innerHTML = `
            <img src="${esc(avatarSrc)}" class="nav-pill-icon" alt="${esc(channel.name)}" onerror="this.onerror=null;this.src='${fallbackSrc}'" />
            <span>${esc(channel.name)}</span>
        `;
    btn.onclick = () => filterVideos(channel.id);
    channelNav.appendChild(btn);
  });

}

/** Returns the child's last-used channel filter, or null if it no longer exists */
function restoreActiveChannel(profileId) {
  const saved = localStorage.getItem(STORAGE_KEY_ACTIVE_CHANNEL + profileId);
  if (!saved) return null;
  const profile = state.data.profiles.find(p => p.id === profileId);
  return profile?.channels.some(c => c.id === saved) ? saved : null;
}

function filterVideos(channelId) {
  state.activeChannelId = channelId;
  // Remember this child's channel filter across reloads
  const profileId = getCurrentProfile().id;
  if (channelId) localStorage.setItem(STORAGE_KEY_ACTIVE_CHANNEL + profileId, channelId);
  else localStorage.removeItem(STORAGE_KEY_ACTIVE_CHANNEL + profileId);

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
    li.innerHTML = `<span style="margin-right:6px; font-size:1.2rem;">${p.avatar}</span> ${esc(p.name)}`;

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

    const todayUsed = fmtTime(getTodayWatchSeconds(p.id));
    const limitOptions = [0, 30, 60, 90, 120].map(v => {
      const label = v === 0 ? t('no_limit') : (v < 60 ? `${v} ${t('minutes')}` : `${v / 60} ${t('hours')}`);
      return `<option value="${v}" ${(p.dailyLimit || 0) === v ? 'selected' : ''}>${label}</option>`;
    }).join('');

    div.innerHTML = `
            <div class="profile-info-row" style="display:flex; align-items:center; width:100%; gap: 10px;">
                <span class="drag-handle" style="cursor: grab; color: #ccc; font-size: 1.2rem; padding: 5px;">⣿</span>

                <button class="avatar-btn" title="Click to change avatar" style="background: #f0f0f0; border:none; font-size: 1.5rem; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; transition: transform 0.2s;">
                  ${p.avatar}
                </button>

                <div class="profile-click-area" style="flex:1; display:flex; flex-direction:column; justify-content:center; cursor: pointer;">
                    <span style="font-weight:600; font-size:1rem;">${esc(p.name)}</span>
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
            <div class="profile-time-limit-row">
              <span class="time-limit-label">⏱ ${t('daily_limit')}</span>
              <select class="time-limit-select" data-profile-id="${p.id}">
                ${limitOptions}
              </select>
              ${(p.dailyLimit || 0) > 0 ? `<span class="time-used-label">${t('time_used_today', { t: todayUsed })}</span>` : ''}
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

  // Daily limit selectors
  profileListContainer.querySelectorAll('.time-limit-select').forEach(sel => {
    sel.onchange = () => {
      const profile = state.data.profiles.find(p => p.id === sel.dataset.profileId);
      if (profile) {
        profile.dailyLimit = parseInt(sel.value, 10);
        saveLocalData();
        const limitLabel = profile.dailyLimit === 0 ? t('no_limit') : `${profile.dailyLimit} ${t('minutes')}`;
        logAudit('audit_limit_changed', { name: profile.name, limit: limitLabel });
        renderAuditLog();
        updateTimeIndicator();
        renderProfileList(); // re-render to show/hide "used today" label
      }
    };
  });
}

function renderVideos() {
  videoContainer.innerHTML = '';

  // Filter logic
  let displayVideos = state.videos;
  if (state.activeChannelId) {
    displayVideos = state.videos.filter(v => v.channelId === state.activeChannelId);
  }

  // Double-Check Filter: Re-apply Shorts filter (Title-based) for cached data
  // This handles the case where old cache contains Shorts, or API filter missed them.
  if (state.data.filterShorts) {
    displayVideos = displayVideos.filter(v => {
      // If we have duration (new cache), use it!
      if (v.duration && v.duration > 0) {
        return v.duration > 90;
      }
      // Fallback: Filter by Title
      return !isShortsTitle(v.title);
    });
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

  const playlistIds = new Set(getPlaylist(getCurrentProfile().id).map(v => v.id));

  displayVideos.forEach(video => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.onclick = () => openPlayer(video);
    const inQueue = playlistIds.has(video.id);
    card.innerHTML = `
      <div class="thumbnail-wrapper">
        <img src="${esc(video.thumbnail)}" alt="${esc(video.title)}" class="thumbnail-img" loading="lazy" />
        <div class="play-icon-overlay">▶</div>
        <button class="card-queue-btn${inQueue ? ' in-queue' : ''}"
          title="${t(inQueue ? 'playlist_remove_tip' : 'playlist_add_tip')}">${inQueue ? '✓' : '+'}</button>
      </div>
      <div class="card-content">
        <h3 class="card-title">${esc(video.title)}</h3>
        <div class="card-meta">
          <span>${esc(video.channelTitle)}</span>
          <span>${new Date(video.publishedAt).toLocaleDateString()}</span>
        </div>
      </div>
    `;
    card.querySelector('.card-queue-btn').onclick = (e) => {
      e.stopPropagation();
      togglePlaylistVideo(video);
      const nowIn = isInPlaylist(video.id);
      const btn = e.currentTarget;
      btn.classList.toggle('in-queue', nowIn);
      btn.textContent = nowIn ? '✓' : '+';
      btn.title = t(nowIn ? 'playlist_remove_tip' : 'playlist_add_tip');
    };
    videoContainer.appendChild(card);
  });

  // --- "Load More" Button (API Mode) ---
  if (state.activeChannelId && state.data.apiKey) {
    const nextToken = state.channelNextPageTokens[state.activeChannelId];
    if (nextToken) {
      const loadMoreContainer = document.createElement('div');
      loadMoreContainer.className = 'load-more-container';
      loadMoreContainer.innerHTML = `
        <button class="load-more-btn" id="load-more-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="7 13 12 18 17 13"></polyline>
            <polyline points="7 6 12 11 17 6"></polyline>
          </svg>
          ${t('load_more')}
        </button>
        <p class="load-more-hint">${t('load_more_hint')}</p>
      `;
      videoContainer.appendChild(loadMoreContainer);

      document.getElementById('load-more-btn').onclick = () => loadMoreChannelVideos(state.activeChannelId);
    }
  }
  // --- "Watch on YouTube" Button (Lite Mode) ---
  else if (state.activeChannelId && !state.data.apiKey) {
    const profile = getCurrentProfile();
    const channel = profile.channels.find(c => c.id === state.activeChannelId);
    if (channel) {
      const loadMoreContainer = document.createElement('div');
      loadMoreContainer.className = 'load-more-container';
      loadMoreContainer.innerHTML = `
        <a href="https://www.youtube.com/channel/${channel.id}" target="_blank" class="load-more-btn" style="text-decoration:none;">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.33 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
          ${t('watch_on_youtube')}
        </a>
        <p class="load-more-hint">${t('lite_mode_more_hint')}</p>
      `;
      videoContainer.appendChild(loadMoreContainer);
    }
  }
}

// --- Load More Videos for a Specific Channel ---
async function loadMoreChannelVideos(channelId) {
  const channel = getCurrentProfile().channels.find(c => c.id === channelId);
  if (!channel) return;

  const nextToken = state.channelNextPageTokens[channelId];
  if (!nextToken) return;

  // Update button to loading state
  const btn = document.getElementById('load-more-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <div class="spinner" style="width:20px;height:20px;border-width:2px;"></div>
      ${t('loading_more')}
    `;
  }

  try {
    const newVideos = await fetchChannelVideos(channel, nextToken);

    if (newVideos.length > 0) {
      // Add new videos (avoid duplicates)
      const existingIds = new Set(state.videos.map(v => v.id));
      const uniqueNew = newVideos.filter(v => !existingIds.has(v.id));
      state.videos.push(...uniqueNew);

      // Update cache
      const profile = getCurrentProfile();
      const cacheKey = `safetube_v2_${profile.id}`;
      try {
        localStorage.setItem(cacheKey, JSON.stringify({
          timestamp: Date.now(),
          videos: state.videos,
          channelIds: profile.channels.map(c => c.id),
          nextPageTokens: state.channelNextPageTokens
        }));
      } catch (e) { console.warn('localStorage full, skipping video cache save'); }

      console.log(`Loaded ${uniqueNew.length} more videos for ${channel.name}`);
    }

    // Re-render to show new videos + updated button state
    renderVideos();

  } catch (e) {
    console.error('Load more failed:', e);
    if (btn) {
      btn.disabled = false;
      btn.textContent = t('load_more_error');
    }
  }
}

// --- Parent Lock (PIN gate for switching child profiles) ---

async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('kiddolens:' + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Shows a 4-digit PIN dialog.
 * opts.onSubmit(pin) returns: true → success & close; 'again' → clear input and
 * show opts.againSubtitle (two-step confirm); false → wrong-PIN shake.
 * opts.onCancel fires if the dialog is dismissed without success.
 */
function showPinDialog(opts) {
  document.querySelector('.pin-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'pin-overlay';
  overlay.innerHTML = `
    <div class="pin-dialog glass">
      <div class="pin-icon">🔒</div>
      <h3 class="pin-title">${esc(opts.title)}</h3>
      <p class="pin-subtitle">${esc(opts.subtitle || '')}</p>
      <input class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*"
        maxlength="4" autocomplete="off" aria-label="PIN" />
      <p class="pin-error">${t('pin_wrong')}</p>
      <button class="secondary-btn pin-cancel">${t('close')}</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.pin-input');
  const errEl = overlay.querySelector('.pin-error');
  const subtitleEl = overlay.querySelector('.pin-subtitle');
  const dialog = overlay.querySelector('.pin-dialog');
  setTimeout(() => input.focus(), 60);

  let succeeded = false;
  let busy = false;
  const close = () => {
    overlay.remove();
    if (!succeeded) opts.onCancel?.();
  };
  overlay.querySelector('.pin-cancel').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };

  input.oninput = async () => {
    input.value = input.value.replace(/\D/g, '');
    if (input.value.length < 4 || busy) return;
    busy = true;
    const res = await opts.onSubmit(input.value);
    busy = false;
    if (res === true) {
      succeeded = true;
      overlay.remove();
    } else if (res === 'again') {
      input.value = '';
      errEl.classList.remove('visible');
      if (opts.againSubtitle) subtitleEl.textContent = opts.againSubtitle;
    } else {
      input.value = '';
      errEl.classList.add('visible');
      if (opts.subtitle) subtitleEl.textContent = opts.subtitle; // restart two-step flows
      dialog.classList.remove('shake');
      void dialog.offsetWidth;
      dialog.classList.add('shake');
    }
  };
}

/** Runs onSuccess immediately if the parent lock is off; otherwise asks for the PIN. */
function verifyParentPin(onSuccess, onCancel) {
  const lock = state.data.parentLock;
  if (!lock?.enabled || !lock?.pinHash) { onSuccess(); return; }
  showPinDialog({
    title: t('pin_title'),
    subtitle: t('pin_subtitle'),
    onCancel,
    onSubmit: async (pin) => {
      const ok = (await hashPin(pin)) === lock.pinHash;
      if (ok) onSuccess();
      return ok;
    }
  });
}

// --- Quiz gate (Chinese-numeral math question) ---
// Softer than a PIN: older siblings who can read Chinese numerals and do
// arithmetic can pass (e.g. to help switch profiles); preschoolers cannot.

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function numToChinese(n) {
  if (n < 10) return CN_DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  let s = (tens === 1 ? '' : CN_DIGITS[tens]) + '十';
  if (ones) s += CN_DIGITS[ones];
  return s;
}

function makeQuiz() {
  const isAdd = Math.random() < 0.5;
  let a = 11 + Math.floor(Math.random() * 39); // 11–49
  let b = 11 + Math.floor(Math.random() * 39);
  if (!isAdd && a < b) [a, b] = [b, a]; // keep answers positive
  return {
    text: `${numToChinese(a)} ${isAdd ? '加' : '減'} ${numToChinese(b)} 等於多少？`,
    answer: isAdd ? a + b : a - b
  };
}

function showQuizDialog(onSuccess, onCancel) {
  document.querySelector('.pin-overlay')?.remove();

  let quiz = makeQuiz();
  const overlay = document.createElement('div');
  overlay.className = 'pin-overlay';
  overlay.innerHTML = `
    <div class="pin-dialog glass">
      <div class="pin-icon">🧮</div>
      <h3 class="pin-title">${t('quiz_title')}</h3>
      <p class="pin-subtitle quiz-question"></p>
      <input class="pin-input quiz-input" type="text" inputmode="numeric" pattern="[0-9]*"
        maxlength="3" autocomplete="off" aria-label="answer" />
      <p class="pin-error">${t('quiz_wrong')}</p>
      <button class="primary-btn quiz-confirm" style="width:100%; margin-top:10px;">${t('quiz_confirm')}</button>
      <button class="secondary-btn pin-cancel">${t('close')}</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const qEl = overlay.querySelector('.quiz-question');
  const input = overlay.querySelector('.quiz-input');
  const errEl = overlay.querySelector('.pin-error');
  const dialog = overlay.querySelector('.pin-dialog');
  qEl.textContent = quiz.text;
  setTimeout(() => input.focus(), 60);

  let succeeded = false;
  const close = () => {
    overlay.remove();
    if (!succeeded) onCancel?.();
  };
  overlay.querySelector('.pin-cancel').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };

  const check = () => {
    const val = parseInt(input.value, 10);
    if (Number.isNaN(val)) { input.focus(); return; }
    if (val === quiz.answer) {
      succeeded = true;
      overlay.remove();
      onSuccess();
    } else {
      quiz = makeQuiz(); // new question on every wrong answer (no brute-forcing one)
      qEl.textContent = quiz.text;
      input.value = '';
      errEl.classList.add('visible');
      dialog.classList.remove('shake');
      void dialog.offsetWidth;
      dialog.classList.add('shake');
      input.focus();
    }
  };
  overlay.querySelector('.quiz-confirm').onclick = check;
  input.onkeydown = (e) => { if (e.key === 'Enter') check(); };
  input.oninput = () => { input.value = input.value.replace(/\D/g, ''); };
}

/**
 * The parent gate for switching profiles etc.: passes straight through when the
 * lock is off, otherwise challenges with the configured mode (quiz or PIN).
 */
function verifyParentGate(onSuccess, onCancel) {
  const lock = state.data.parentLock;
  if (!lock?.enabled) { onSuccess(); return; }
  if ((lock.mode || 'pin') === 'quiz') {
    showQuizDialog(onSuccess, onCancel);
    return;
  }
  verifyParentPin(onSuccess, onCancel);
}

/** Two-step "set new PIN" flow (enter + confirm). */
function startSetPin(onDone, onCancel) {
  let firstPin = null;
  showPinDialog({
    title: t('pin_set_title'),
    subtitle: t('pin_set_subtitle'),
    againSubtitle: t('pin_confirm_subtitle'),
    onCancel,
    onSubmit: async (pin) => {
      if (firstPin === null) {
        firstPin = pin;
        return 'again';
      }
      if (pin === firstPin) {
        state.data.parentLock = { enabled: true, mode: 'pin', pinHash: await hashPin(pin) };
        saveLocalData();
        onDone?.();
        return true;
      }
      firstPin = null; // mismatch → start over
      return false;
    }
  });
}

function updateParentLockUI() {
  const lock = state.data.parentLock || {};
  const cb = document.getElementById('parent-lock-checkbox');
  if (cb) cb.checked = !!lock.enabled;

  const modeRow = document.getElementById('parent-lock-mode-row');
  if (modeRow) modeRow.style.display = lock.enabled ? 'block' : 'none';
  document.querySelectorAll('input[name="lock-mode"]').forEach(r => {
    r.checked = r.value === (lock.mode || 'pin');
  });

  const changeBtn = document.getElementById('change-pin-btn');
  if (changeBtn) {
    changeBtn.style.display = lock.enabled && (lock.mode || 'pin') === 'pin' ? 'inline-block' : 'none';
  }
}

// --- Playlist (parent-curated queue) ---

function getPlaylist(profileId) {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_PLAYLIST + profileId) || '[]'); }
  catch (e) { return []; }
}

function savePlaylist(profileId, list) {
  try { localStorage.setItem(STORAGE_KEY_PLAYLIST + profileId, JSON.stringify(list)); }
  catch (e) { console.warn('localStorage full, playlist not saved'); }
  updatePlaylistBadge();
  saveLocalData(); // bump lastUpdated & schedule cloud sync (playlists sync too)
}

function isInPlaylist(videoId) {
  return getPlaylist(getCurrentProfile().id).some(v => v.id === videoId);
}

function togglePlaylistVideo(video) {
  const profile = getCurrentProfile();
  let list = getPlaylist(profile.id);
  if (list.some(v => v.id === video.id)) {
    list = list.filter(v => v.id !== video.id);
  } else {
    list.push({
      id: video.id,
      title: video.title,
      thumbnail: video.thumbnail,
      channelId: video.channelId || '',
      channelTitle: video.channelTitle || '',
      duration: video.duration
    });
  }
  savePlaylist(profile.id, list);
}

function updatePlaylistBadge() {
  const badge = document.getElementById('playlist-count-badge');
  if (!badge) return;
  const n = getPlaylist(getCurrentProfile().id).length;
  badge.textContent = n;
  badge.style.display = n > 0 ? 'flex' : 'none';
}

function startPlaylistPlayback(startIndex = 0) {
  const list = getPlaylist(getCurrentProfile().id);
  if (list.length === 0) return;
  state.playQueue = list;
  state.queueIndex = Math.min(startIndex, list.length - 1);
  const modal = document.getElementById('playlist-modal');
  if (modal) { modal.remove(); toggleBodyScroll(false); }
  openPlayer(state.playQueue[state.queueIndex]);
}

function showPlaylistPanel() {
  const existing = document.getElementById('playlist-modal');
  if (existing) { existing.remove(); toggleBodyScroll(false); return; }

  const modal = document.createElement('div');
  modal.id = 'playlist-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content glass playlist-modal-content">
      <button class="close-btn-corner" id="close-playlist" aria-label="Close">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <div class="modal-header">
        <h2>📃 ${t('playlist')}</h2>
      </div>
      <p class="small-text" style="margin-top:0;">${t('playlist_hint')}</p>
      <div class="playlist-actions-row">
        <button id="playlist-play-all" class="primary-btn" style="flex:1;">▶ ${t('playlist_play_all')}</button>
        <button id="playlist-clear" class="secondary-btn">${t('playlist_clear')}</button>
      </div>
      <button id="playlist-import-btn" class="secondary-btn" style="width:100%; margin-bottom:12px;">
        📥 ${t('playlist_import')}
      </button>
      <div id="playlist-import-area" style="display:none;">
        <p id="import-status" class="small-text" style="margin:4px 0 8px;"></p>
        <div id="import-channel-chips" class="import-channel-chips"></div>
        <div id="import-playlists" class="import-playlists"></div>
      </div>
      <ul id="playlist-list" class="playlist-list"></ul>
    </div>
  `;
  document.body.appendChild(modal);
  toggleBodyScroll(true);

  const close = () => { modal.remove(); toggleBodyScroll(false); };
  modal.querySelector('#close-playlist').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };

  modal.querySelector('#playlist-play-all').onclick = () => startPlaylistPlayback(0);
  modal.querySelector('#playlist-clear').onclick = () => {
    if (!confirm(t('playlist_clear_confirm'))) return;
    savePlaylist(getCurrentProfile().id, []);
    renderPlaylistList();
    renderVideos(); // refresh the "+" buttons on video cards
  };

  // Import a channel's own YouTube playlist (Pro Mode / API key required)
  const importArea = modal.querySelector('#playlist-import-area');
  modal.querySelector('#playlist-import-btn').onclick = () => {
    const showing = importArea.style.display !== 'none';
    importArea.style.display = showing ? 'none' : 'block';
    if (showing) return;
    if (!state.data.apiKey) {
      modal.querySelector('#import-status').textContent = t('playlist_import_need_api');
      return;
    }
    renderImportChannelChips(modal);
  };

  renderPlaylistList();
}

// --- Import from a channel's official YouTube playlists ---

function renderImportChannelChips(modal) {
  const chipsEl = modal.querySelector('#import-channel-chips');
  const statusEl = modal.querySelector('#import-status');
  const listEl = modal.querySelector('#import-playlists');
  statusEl.textContent = t('playlist_import_pick_channel');
  chipsEl.innerHTML = '';
  listEl.innerHTML = '';

  getCurrentProfile().channels.forEach(ch => {
    const chip = document.createElement('button');
    chip.className = 'import-channel-chip';
    chip.innerHTML = `
      <img src="${esc(ch.thumbnail || avatarFallbackUrl(ch.name, 64))}" alt=""
        onerror="this.onerror=null;this.src='${avatarFallbackUrl(ch.name, 64)}'" />
      <span>${esc(ch.name)}</span>
    `;
    chip.onclick = () => loadChannelPlaylists(modal, ch, chip);
    chipsEl.appendChild(chip);
  });
}

async function loadChannelPlaylists(modal, channel, chip) {
  modal.querySelectorAll('.import-channel-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  const listEl = modal.querySelector('#import-playlists');
  listEl.innerHTML = `<p class="small-text" style="color:#99a3b8;">${t('playlist_import_loading')}</p>`;

  try {
    // Cost: 1 unit (cached 24h by ytFetch)
    const data = await ytFetch(
      `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&channelId=${channel.id}&maxResults=25&key=${state.data.apiKey}`
    );
    if (!modal.isConnected) return;

    const playlists = (data.items || []).map(p => ({
      id: p.id,
      title: p.snippet?.title || '',
      thumbnail: p.snippet?.thumbnails?.medium?.url || p.snippet?.thumbnails?.default?.url || '',
      count: p.contentDetails?.itemCount || 0
    })).filter(p => p.count > 0);

    if (playlists.length === 0) {
      listEl.innerHTML = `<p class="small-text" style="color:#99a3b8;">${t('playlist_import_none')}</p>`;
      return;
    }

    listEl.innerHTML = '';
    playlists.forEach(pl => {
      const row = document.createElement('div');
      row.className = 'import-playlist-item';
      row.innerHTML = `
        <img class="playlist-thumb" src="${esc(pl.thumbnail)}" alt="" loading="lazy" />
        <div class="playlist-info">
          <div class="playlist-title">${esc(pl.title)}</div>
          <div class="playlist-channel">${t('video_count', { count: pl.count })}</div>
        </div>
        <span class="import-add-icon">＋</span>
      `;
      row.onclick = () => importYtPlaylist(modal, pl);
      listEl.appendChild(row);
    });
  } catch (e) {
    console.warn('Failed to load channel playlists', e);
    if (modal.isConnected) {
      listEl.innerHTML = `<p class="small-text" style="color:#e55;">${t('playlist_import_error')}</p>`;
    }
  }
}

async function importYtPlaylist(modal, pl) {
  if (!confirm(t('playlist_import_confirm', { title: pl.title, n: Math.min(pl.count, 50) }))) return;

  try {
    // Cost: 1 unit (cached 24h)
    const data = await ytFetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${pl.id}&maxResults=50&key=${state.data.apiKey}`
    );
    const videos = (data.items || [])
      .filter(i => {
        const title = i.snippet?.title;
        return i.snippet?.resourceId?.videoId &&
          title && title !== 'Private video' && title !== 'Deleted video';
      })
      .map(i => ({
        id: i.snippet.resourceId.videoId,
        title: i.snippet.title,
        thumbnail: i.snippet.thumbnails?.medium?.url
          || `https://i.ytimg.com/vi/${i.snippet.resourceId.videoId}/mqdefault.jpg`,
        channelId: i.snippet.videoOwnerChannelId || i.snippet.channelId || '',
        channelTitle: i.snippet.videoOwnerChannelTitle || i.snippet.channelTitle || ''
      }));

    const profile = getCurrentProfile();
    const current = getPlaylist(profile.id);
    const existing = new Set(current.map(v => v.id));
    const fresh = videos.filter(v => !existing.has(v.id));
    savePlaylist(profile.id, [...current, ...fresh]);

    renderPlaylistList();
    renderVideos(); // refresh "+" buttons on cards
    if (modal.isConnected) {
      modal.querySelector('#import-status').textContent = t('playlist_import_done', { n: fresh.length });
    }
  } catch (e) {
    console.warn('Playlist import failed', e);
    if (modal.isConnected) {
      modal.querySelector('#import-status').textContent = t('playlist_import_error');
    }
  }
}

function renderPlaylistList() {
  const listEl = document.getElementById('playlist-list');
  if (!listEl) return;
  const profile = getCurrentProfile();
  const list = getPlaylist(profile.id);

  const playAllBtn = document.getElementById('playlist-play-all');
  if (playAllBtn) playAllBtn.disabled = list.length === 0;

  if (list.length === 0) {
    listEl.innerHTML = `<li class="playlist-empty">${t('playlist_empty')}</li>`;
    return;
  }

  let suppressClick = false; // don't start playback right after a drag-reorder

  listEl.innerHTML = '';
  list.forEach((video, index) => {
    const li = document.createElement('li');
    li.className = 'playlist-item';
    li.dataset.id = video.id;
    li.innerHTML = `
      <span class="drag-handle" title="${t('playlist_drag_tip')}">⠿</span>
      <span class="playlist-index">${index + 1}</span>
      <img class="playlist-thumb" src="${esc(video.thumbnail || '')}" alt="" loading="lazy" />
      <div class="playlist-info">
        <div class="playlist-title">${esc(video.title)}</div>
        <div class="playlist-channel">${esc(video.channelTitle || '')}</div>
      </div>
      <button class="playlist-remove" title="${t('playlist_remove_tip')}">✕</button>
    `;
    li.onclick = () => {
      if (suppressClick) return;
      startPlaylistPlayback(index);
    };
    li.querySelector('.playlist-remove').onclick = (e) => {
      e.stopPropagation();
      savePlaylist(profile.id, getPlaylist(profile.id).filter(v => v.id !== video.id));
      renderPlaylistList();
      renderVideos();
    };
    listEl.appendChild(li);
  });

  // Pointer-based drag to reorder (works with mouse & touch)
  let dragEl = null;
  const saveOrder = () => {
    const byId = new Map(getPlaylist(profile.id).map(v => [v.id, v]));
    const newOrder = [];
    listEl.querySelectorAll('.playlist-item[data-id]').forEach(item => {
      const v = byId.get(item.dataset.id);
      if (v) newOrder.push(v);
    });
    savePlaylist(profile.id, newOrder);
    renderPlaylistList(); // refresh index numbers
  };
  listEl.onpointerdown = (e) => {
    if (!e.target.closest('.drag-handle')) return;
    const li = e.target.closest('.playlist-item');
    if (!li) return;
    e.preventDefault();
    dragEl = li;
    listEl.setPointerCapture(e.pointerId);
    li.classList.add('dragging');
  };
  listEl.onpointermove = (e) => {
    if (!dragEl) return;
    e.preventDefault();
    dragEl.style.pointerEvents = 'none';
    const below = document.elementFromPoint(e.clientX, e.clientY);
    dragEl.style.pointerEvents = '';
    const target = below?.closest('.playlist-item');
    if (!target || target === dragEl) return;
    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) target.before(dragEl);
    else target.after(dragEl);
  };
  const endDrag = () => {
    if (!dragEl) return;
    dragEl.classList.remove('dragging');
    dragEl = null;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 100);
    saveOrder();
  };
  listEl.onpointerup = endDrag;
  listEl.onpointercancel = endDrag;
}

// --- Player Logic ---
let activeYTPlayer = null;
let _autoNextTimer = null; // countdown timer for auto-play next

/**
 * Picks the next video to auto-play: same pool the child currently sees
 * (active channel filter + Shorts filter), excluding the one that just ended.
 */
function getNextVideo(current) {
  let pool = state.videos;
  if (state.activeChannelId) {
    pool = pool.filter(v => v.channelId === state.activeChannelId);
  }
  if (state.data.filterShorts) {
    pool = pool.filter(v => (v.duration && v.duration > 0) ? v.duration > 90 : !isShortsTitle(v.title));
  }
  pool = pool.filter(v => v.id !== current.id);
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function clearAutoNextTimer() {
  if (_autoNextTimer) {
    clearInterval(_autoNextTimer);
    _autoNextTimer = null;
  }
}

function openPlayer(video) {
  recordWatch(video);

  const playerContainer = document.getElementById('youtube-player');
  playerContainer.innerHTML = '';
  document.querySelector('.video-ended-overlay')?.remove();

  document.getElementById('video-title').textContent = video.title;
  document.getElementById('video-channel').textContent = video.channelTitle;
  playerModal.classList.remove('hidden');
  toggleBodyScroll(true);

  if (window.YT && window.YT.Player) {
    // Use IFrame API so we can detect video end and block the end screen
    const playerDiv = document.createElement('div');
    playerContainer.appendChild(playerDiv);

    activeYTPlayer = new YT.Player(playerDiv, {
      host: 'https://www.youtube-nocookie.com', // privacy-enhanced mode: fewer tracking cookies
      videoId: video.id,
      playerVars: {
        autoplay: 1,
        rel: 0,
        modestbranding: 1,
        iv_load_policy: 3  // hide annotations/cards
      },
      events: {
        onStateChange: (event) => {
          if (event.data === 1) {      // playing
            startWatchTimer();
          } else if (event.data === 2) { // paused
            stopWatchTimer();
          } else if (event.data === 0) { // ended
            stopWatchTimer();
            showEndedOverlay(video, activeYTPlayer);
          }
        }
      }
    });
  } else {
    // Fallback: direct iframe (YT API not ready yet)
    activeYTPlayer = null;
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&modestbranding=1&iv_load_policy=3`;
    iframe.setAttribute('frameborder', '0');
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    playerContainer.appendChild(iframe);
    // No play/pause events available in this mode — count the whole open time
    // so daily limits are still (approximately) enforced.
    startWatchTimer();
  }
}

// --- Watch History Panel ---

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('history_just_now');
  if (mins < 60) return t('history_minutes_ago', { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('history_hours_ago', { n: hrs });
  return t('history_days_ago', { n: Math.floor(hrs / 24) });
}

function renderHistoryPanel() {
  const profile = getCurrentProfile();
  const listEl = document.getElementById('history-list');
  const titleEl = document.getElementById('history-title-text');
  if (titleEl) titleEl.textContent = t('watch_history');
  const clearBtn = document.getElementById('clear-history-btn');
  if (clearBtn) clearBtn.textContent = t('watch_history_clear');

  if (!profile || !listEl) return;

  const key = STORAGE_KEY_WATCH_HISTORY + profile.id;
  const history = JSON.parse(localStorage.getItem(key) || '[]');

  if (history.length === 0) {
    listEl.innerHTML = `<p class="history-empty">${t('watch_history_empty')}</p>`;
    return;
  }

  listEl.innerHTML = history.map(item => `
    <div class="history-item" data-video-id="${esc(item.videoId)}"
         data-title="${esc(item.title || '')}"
         data-thumbnail="${esc(item.thumbnail || '')}"
         data-channel-id="${esc(item.channelId || '')}"
         data-channel-title="${esc(item.channelTitle || '')}">
      <img class="history-thumb" src="${esc(item.thumbnail || '')}" alt="" loading="lazy" />
      <div class="history-info">
        <div class="history-video-title">${esc(item.title || '')}</div>
        <div class="history-meta">
          <span class="history-channel">${esc(item.channelTitle || '')}</span>
          <span class="history-time">${relativeTime(item.watchedAt)}</span>
        </div>
      </div>
      <div class="history-play-icon">▶</div>
    </div>
  `).join('');

  listEl.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => {
      const video = {
        id: el.dataset.videoId,
        title: el.dataset.title,
        thumbnail: el.dataset.thumbnail,
        channelId: el.dataset.channelId,
        channelTitle: el.dataset.channelTitle
      };
      closeHistoryPanel();
      openPlayer(video);
    });
  });
}

function openHistoryPanel() {
  renderHistoryPanel();
  document.getElementById('history-modal').classList.remove('hidden');
  toggleBodyScroll(true);
}

function closeHistoryPanel() {
  document.getElementById('history-modal').classList.add('hidden');
  toggleBodyScroll(false);
}

function showEndedOverlay(video, player) {
  document.querySelector('.video-ended-overlay')?.remove();
  clearAutoNextTimer();

  const wrapper = document.querySelector('#player-modal .video-wrapper');
  if (!wrapper) return;

  // The parent playlist queue takes priority; random auto-play (if enabled)
  // is only the fallback when no queue is active.
  let next = null;
  let fromQueue = false;
  if (state.playQueue && state.queueIndex < state.playQueue.length - 1) {
    next = state.playQueue[state.queueIndex + 1];
    fromQueue = true;
  } else if (state.data.autoPlayNext) {
    next = getNextVideo(video);
  }

  const overlay = document.createElement('div');
  overlay.className = 'video-ended-overlay';
  overlay.innerHTML = `
    <div class="ended-content">
      <div class="ended-icon">🎬</div>
      <p class="ended-msg">${t('video_ended')}</p>
      ${next ? `
        <p class="autoplay-next-info">${t('autoplay_up_next')}<br><strong>${esc(next.title)}</strong></p>
        <p class="autoplay-countdown"></p>
      ` : ''}
      <div class="ended-actions">
        <button class="ended-btn ended-replay">↺ ${t('watch_again')}</button>
        ${next ? `<button class="ended-btn ended-cancel-next">${t('autoplay_cancel')}</button>` : ''}
        <button class="ended-btn ended-close">✕ ${t('close')}</button>
      </div>
    </div>
  `;

  overlay.querySelector('.ended-replay').onclick = () => {
    clearAutoNextTimer();
    overlay.remove();
    if (player) { player.seekTo(0); player.playVideo(); }
  };
  overlay.querySelector('.ended-close').onclick = () => closePlayer();

  if (next) {
    const countdownEl = overlay.querySelector('.autoplay-countdown');
    let secs = fromQueue ? 5 : 10; // parent-curated queue advances faster
    const tick = () => {
      if (secs <= 0) {
        clearAutoNextTimer();
        overlay.remove();
        if (fromQueue) state.queueIndex++;
        openPlayer(next);
        return;
      }
      countdownEl.textContent = t('autoplay_countdown', { n: secs });
      secs--;
    };
    tick();
    _autoNextTimer = setInterval(tick, 1000);

    overlay.querySelector('.ended-cancel-next').onclick = () => {
      clearAutoNextTimer();
      overlay.querySelector('.autoplay-next-info')?.remove();
      countdownEl?.remove();
      overlay.querySelector('.ended-cancel-next')?.remove();
    };
  }

  wrapper.appendChild(overlay);
}

function closePlayer() {
  stopWatchTimer(); // save elapsed time before destroying player
  clearAutoNextTimer();
  state.playQueue = null; // closing the player ends any active playlist queue
  state.queueIndex = 0;
  document.querySelector('.time-limit-overlay')?.remove();
  playerModal.classList.add('hidden');
  document.getElementById('youtube-player').innerHTML = '';
  document.querySelector('.video-ended-overlay')?.remove();
  if (activeYTPlayer) {
    try { activeYTPlayer.destroy(); } catch (e) { /* ignore */ }
    activeYTPlayer = null;
  }
  toggleBodyScroll(false);
}

// --- Settings Logic ---
function openSettings() {
  settingsModal.classList.remove('hidden');
  toggleBodyScroll(true);
  updateProfileUI();
  const apiKeyInput = document.getElementById('api-key-input');
  if (apiKeyInput) apiKeyInput.value = state.data.apiKey;

  // Load Preferences
  const filterShortsCb = document.getElementById('filter-shorts-checkbox');
  if (filterShortsCb) filterShortsCb.checked = !!state.data.filterShorts;
  const autoplayCb = document.getElementById('autoplay-next-checkbox');
  if (autoplayCb) autoplayCb.checked = !!state.data.autoPlayNext;
  const shareStatsCb = document.getElementById('share-stats-checkbox');
  if (shareStatsCb) shareStatsCb.checked = !!state.data.shareStats;

  updateParentLockUI();
  renderAuditLog();
}

function closeSettings() {
  settingsModal.classList.add('hidden');
  toggleBodyScroll(false);
}

// --- Helper: Body Scroll Lock ---
function toggleBodyScroll(lock) {
  document.body.style.overflow = lock ? 'hidden' : '';
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
  logAudit('audit_profile_added', { name });
  updateProfileUI();
  newProfileNameInput.value = '';
}

function switchProfile(id) {
  if (id === state.data.currentProfileId) return;
  profileDropdown?.classList.add('hidden');
  // Parent lock: little siblings can't hop onto another child's list
  verifyParentGate(() => doSwitchProfile(id));
}

function doSwitchProfile(id) {
  stopWatchTimer(); // stop any running timer from the previous profile
  state.data.currentProfileId = id;
  state.activeChannelId = restoreActiveChannel(id); // restore this child's last channel filter
  saveLocalData();
  updateProfileUI();
  fetchAllVideos();
  fetchMissingChannelIcons();
  updateTimeIndicator();
  updatePlaylistBadge();
}

function editProfileName(id) {
  const profile = state.data.profiles.find(p => p.id === id);
  if (!profile) return;

  const newName = prompt(t('rename_prompt', { name: profile.name }), profile.name);
  if (newName && newName.trim() !== "") {
    logAudit('audit_profile_renamed', { from: profile.name, to: newName.trim() });
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
    const deletedName = state.data.profiles.find(p => p.id === id)?.name || '?';
    state.data.profiles = state.data.profiles.filter(p => p.id !== id);
    logAudit('audit_profile_deleted', { name: deletedName });
    // Clean up this profile's local traces (watch history, watch time, video cache, playlist)
    const prefixes = [STORAGE_KEY_WATCH_HISTORY + id, STORAGE_KEY_WATCH_TIME + id, `safetube_v2_${id}`,
      STORAGE_KEY_PLAYLIST + id, STORAGE_KEY_ACTIVE_CHANNEL + id];
    Object.keys(localStorage)
      .filter(k => prefixes.some(p => k.startsWith(p)))
      .forEach(k => localStorage.removeItem(k));
    // If deleted current, switch to first available
    if (state.data.currentProfileId === id) {
      state.data.currentProfileId = state.data.profiles[0].id; // There should always be at least one
    }
    saveLocalData();
    updateProfileUI();
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
    saveLocalData(); // saveLocalData already schedules a cloud sync when logged in
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
  document.getElementById('refresh-btn').onclick = () => fetchAllVideos(true);

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

  document.getElementById('settings-btn').onclick = openSettings;
  document.getElementById('close-settings').onclick = closeSettings;
  document.getElementById('close-player').onclick = closePlayer;

  document.getElementById('history-btn').onclick = openHistoryPanel;
  document.getElementById('close-history').onclick = closeHistoryPanel;

  const playlistBtn = document.getElementById('playlist-btn');
  if (playlistBtn) playlistBtn.onclick = showPlaylistPanel;
  document.getElementById('clear-history-btn').onclick = () => {
    const profile = getCurrentProfile();
    if (profile) {
      localStorage.removeItem(STORAGE_KEY_WATCH_HISTORY + profile.id);
      logAudit('audit_history_cleared', { name: profile.name });
    }
    renderHistoryPanel();
  };

  // Overlay Clicks
  settingsModal.onclick = (e) => { if (e.target === settingsModal) closeSettings(); };
  playerModal.onclick = (e) => { if (e.target === playerModal) closePlayer(); };
  document.getElementById('history-modal').onclick = (e) => { if (e.target.id === 'history-modal') closeHistoryPanel(); };

  // Filter Shorts Listener
  const filterShortsCb = document.getElementById('filter-shorts-checkbox');
  if (filterShortsCb) {
    filterShortsCb.onchange = (e) => {
      state.data.filterShorts = e.target.checked;
      saveLocalData();
      logAudit('audit_filter_shorts', { state: t(e.target.checked ? 'state_on' : 'state_off') });
      renderAuditLog();
      fetchAllVideos(true); // Re-fetch with new filter applied
    };
  }

  // Autoplay Next Listener
  const autoplayCb = document.getElementById('autoplay-next-checkbox');
  if (autoplayCb) {
    autoplayCb.onchange = (e) => {
      state.data.autoPlayNext = e.target.checked;
      saveLocalData();
      logAudit('audit_autoplay', { state: t(e.target.checked ? 'state_on' : 'state_off') });
      renderAuditLog();
    };
  }

  // Anonymous Stats Listener
  const shareStatsCb = document.getElementById('share-stats-checkbox');
  if (shareStatsCb) {
    shareStatsCb.onchange = (e) => {
      state.data.shareStats = e.target.checked;
      saveLocalData();
      logAudit('audit_share_stats', { state: t(e.target.checked ? 'state_on' : 'state_off') });
      renderAuditLog();
    };
  }

  // Parent Lock listeners
  const parentLockCb = document.getElementById('parent-lock-checkbox');
  if (parentLockCb) {
    parentLockCb.onchange = (e) => {
      if (e.target.checked) {
        // Enabling: quiz mode by default (zero-setup); keeps a previously set
        // PIN mode if one exists. Parents pick the mode with the radios below.
        const prev = state.data.parentLock || {};
        state.data.parentLock = {
          enabled: true,
          mode: prev.pinHash ? (prev.mode || 'pin') : 'quiz',
          pinHash: prev.pinHash || null
        };
        saveLocalData();
        logAudit('audit_parent_lock', { state: t('state_on') });
        renderAuditLog();
        updateParentLockUI();
      } else {
        // Disabling requires passing the current gate (reverts if cancelled)
        verifyParentGate(
          () => {
            state.data.parentLock = { ...state.data.parentLock, enabled: false };
            saveLocalData();
            logAudit('audit_parent_lock', { state: t('state_off') });
            renderAuditLog();
            updateParentLockUI();
          },
          () => updateParentLockUI()
        );
      }
    };
  }

  // Lock mode radios (quiz ⇄ pin)
  document.querySelectorAll('input[name="lock-mode"]').forEach(radio => {
    radio.onchange = () => {
      const lock = state.data.parentLock || {};
      const target = radio.value;
      if (!lock.enabled || target === (lock.mode || 'pin')) return;

      if (target === 'pin') {
        // Strengthening the lock — set (or reuse) a PIN
        if (lock.pinHash) {
          state.data.parentLock = { ...lock, mode: 'pin' };
          saveLocalData();
          logAudit('audit_lock_mode', { mode: t('lock_mode_pin') });
          renderAuditLog();
          updateParentLockUI();
        } else {
          startSetPin(
            () => {
              logAudit('audit_lock_mode', { mode: t('lock_mode_pin') });
              renderAuditLog();
              updateParentLockUI();
            },
            () => updateParentLockUI()
          );
        }
      } else {
        // Weakening pin → quiz requires the current PIN first
        verifyParentPin(
          () => {
            state.data.parentLock = { ...state.data.parentLock, mode: 'quiz' };
            saveLocalData();
            logAudit('audit_lock_mode', { mode: t('lock_mode_quiz') });
            renderAuditLog();
            updateParentLockUI();
          },
          () => updateParentLockUI()
        );
      }
    };
  });

  const changePinBtn = document.getElementById('change-pin-btn');
  if (changePinBtn) {
    changePinBtn.onclick = () => {
      verifyParentPin(() => {
        startSetPin(() => {
          logAudit('audit_pin_changed');
          renderAuditLog();
          updateParentLockUI();
        }, () => updateParentLockUI());
      });
    };
  }

  // Email Magic-Link Login
  const emailLoginBtn = document.getElementById('email-login-btn');
  if (emailLoginBtn) {
    emailLoginBtn.onclick = async () => {
      const input = document.getElementById('email-login-input');
      const email = (input?.value || '').trim();
      if (!email || !email.includes('@')) {
        showSyncToast(t('email_login_invalid'), 'warning');
        return;
      }
      emailLoginBtn.disabled = true;
      try {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin + window.location.pathname }
        });
        if (error) throw error;
        showSyncToast(t('email_login_sent'));
      } catch (err) {
        showSyncToast(t('save_drive_failed', { message: err.message }), 'warning');
      } finally {
        emailLoginBtn.disabled = false;
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
      if (state.data.apiKey) logAudit('audit_mode_changed', { mode: t('lite_mode') });
      state.data.apiKey = '';
      saveLocalData();

      apiStatus.textContent = t('status_lite_active');
      apiStatus.classList.add('success', 'show');

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

      if (state.data.apiKey !== key) logAudit('audit_mode_changed', { mode: t('pro_mode') });
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

  // Profile Listeners
  addProfileBtn.onclick = () => {
    addProfile(newProfileNameInput.value.trim());
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Close every dismissable overlay (the onboarding wizard is intentionally
      // NOT dismissable — removing it would leave the app in a blank state).
      closePlayer();
      closeSettings();
      closeHistoryPanel();
      document.getElementById('add-channel-modal')?.remove();
      document.getElementById('profile-pick-overlay')?.remove();
      document.getElementById('playlist-modal')?.remove();
      document.getElementById('avatar-picker-overlay')?.classList.add('hidden');
      document.querySelector('.pin-overlay .pin-cancel')?.click(); // triggers onCancel cleanup
      toggleBodyScroll(false);
    }

    if (e.key === 'Enter') {
      if (e.target.id === 'api-key-input') {
        const btn = document.getElementById('save-api-key');
        if (btn) btn.click();
      }
      if (e.target.id === 'new-profile-name') {
        addProfileBtn.click();
      }
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

      <!-- Branding header -->
      <div class="wizard-branding">
        <img src="logo-static.svg" class="wizard-logo" alt="KiddoLens" />
        <div class="wizard-step-dots">
          <span class="wizard-dot active" id="wizard-dot-0"></span>
          <span class="wizard-dot" id="wizard-dot-1"></span>
          <span class="wizard-dot" id="wizard-dot-2"></span>
        </div>
      </div>

      <!-- Step 0: Welcome — what is this & how do I get in? -->
      <div class="wizard-step" id="wizard-step-0">
        <h2 class="wizard-step-title">${t('welcome_title')}</h2>
        <p class="wizard-desc">${t('welcome_intro')}</p>

        <div class="wizard-feature-list">
          <div class="wizard-feature"><span class="wizard-feature-icon">✅</span>${t('feature_whitelist')}</div>
          <div class="wizard-feature"><span class="wizard-feature-icon">⏱️</span>${t('feature_timer')}</div>
          <div class="wizard-feature"><span class="wizard-feature-icon">☁️</span>${t('feature_sync')}</div>
        </div>

        <button class="wizard-btn-primary" id="wizard-start-btn">${t('wizard_start_new')}</button>

        <div class="wizard-divider"><span>${t('wizard_already_have')}</span></div>
        <div id="wizard-google-container"></div>
        <div class="wizard-email-row">
          <input type="email" id="wizard-email-input" placeholder="${t('email_login_placeholder')}"
            autocomplete="email" />
          <button id="wizard-email-btn" class="secondary-btn">${t('email_login_btn')}</button>
        </div>
        <p id="wizard-email-status" class="wizard-email-status"></p>
      </div>

      <!-- Step 1: Enter child's name -->
      <div class="wizard-step" id="wizard-step-1" style="display:none;">
        <h2 class="wizard-step-title">${t('step1_title')}</h2>
        <p class="wizard-desc">${t('welcome_desc')}</p>

        <div class="wizard-input-group">
          <label>${t('step1_label')}</label>
          <input type="text" id="wizard-child-name" placeholder="${t('step1_placeholder')}" autocomplete="off" />
        </div>

        <button class="wizard-btn-primary" id="wizard-next-btn" disabled>${t('next_step')}</button>
      </div>

      <!-- Step 2: Pick channels -->
      <div class="wizard-step" id="wizard-step-2" style="display:none;">
        <h2 class="wizard-step-title" id="wizard-step2-title">${t('step2_label', { name: '...' })}</h2>

        <div id="channel-loading" class="channel-loading-area">${t('loading_recommendations')}</div>
        <div class="wizard-channel-grid" id="wizard-channel-grid"></div>

        <button class="wizard-btn-primary" id="wizard-finish-btn">${t('finish_setup')}</button>
        <p class="wizard-skip-note">${t('setup_login_note')}</p>
      </div>

    </div>
  `;
  document.body.appendChild(modal);

  // Step Logic
  const nameInput = modal.querySelector('#wizard-child-name');
  const nextBtn = modal.querySelector('#wizard-next-btn');
  const step0 = modal.querySelector('#wizard-step-0');
  const step1 = modal.querySelector('#wizard-step-1');
  const step2 = modal.querySelector('#wizard-step-2');
  const googleContainer = modal.querySelector('#wizard-google-container');

  // Step 0 → Step 1 (new user path)
  modal.querySelector('#wizard-start-btn').onclick = () => {
    step0.style.display = 'none';
    step1.style.display = 'block';
    modal.querySelector('#wizard-dot-1').classList.add('active');
    setTimeout(() => nameInput.focus(), 100);
  };

  // Step 0: Email magic-link login (returning user path)
  const wizardEmailBtn = modal.querySelector('#wizard-email-btn');
  wizardEmailBtn.onclick = async () => {
    const email = (modal.querySelector('#wizard-email-input')?.value || '').trim();
    const statusEl = modal.querySelector('#wizard-email-status');
    if (!email || !email.includes('@')) {
      statusEl.textContent = t('email_login_invalid');
      statusEl.classList.add('error');
      return;
    }
    wizardEmailBtn.disabled = true;
    statusEl.classList.remove('error');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + window.location.pathname }
      });
      if (error) throw error;
      statusEl.textContent = t('email_login_sent');
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.classList.add('error');
    } finally {
      wizardEmailBtn.disabled = false;
    }
  };

  // Pre-fetch channel data NOW (during Step 1, while user types name)
  // Uses shared cache so other UI panels (settings search, recommendation modal) won't re-fetch
  let prefetchedChannels = null;
  const prefetchPromise = fetchRankingsRaw()
    .then(channels => {
      if (channels && channels.length > 0) {
        prefetchedChannels = channels.slice(0, 16);
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

    // Save name to profile
    state.data.profiles[0].name = name;

    // Personalize step 2 title and advance step dot
    const step2Title = modal.querySelector('#wizard-step2-title');
    if (step2Title) step2Title.textContent = t('step2_label', { name });
    const dot2 = modal.querySelector('#wizard-dot-2');
    if (dot2) dot2.classList.add('active');

    // Switch to Step 2
    step1.style.display = 'none';
    step2.style.display = 'block';

    // Use pre-fetched data if available
    await loadWizardRecommendations(modal, prefetchedChannels, prefetchPromise);
  };

  // Cloud Login/Sync Logic (Directly Visible)
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
    handleLogin(); // Using Supabase OAuth handler
  };

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

    // Show Login Nudge
    setTimeout(showLoginNudge, 1500);
  };
}

// Helper: Danger Zone Listener
function setupDangerZoneListener() {
  const resetBtn = document.getElementById('reset-app-btn');
  if (!resetBtn) return;
  resetBtn.onclick = async () => {
    if (!confirm(t('reset_confirm_1'))) return;
    if (!confirm(t('reset_confirm_2'))) return;

    // Clear every KiddoLens-related key (settings, caches, history, watch time)
    const PREFIXES = ['safetube_', 'yt_api_cache_', 'kiddolens_', 'onboarding_'];
    Object.keys(localStorage)
      .filter(k => PREFIXES.some(p => k.startsWith(p)))
      .forEach(k => localStorage.removeItem(k));

    // Sign out — otherwise the active cloud session silently restores
    // everything again on reload, making the reset appear to do nothing.
    try { await supabase.auth.signOut(); } catch (e) { /* ignore */ }

    location.reload();
  };
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

    const fallback = avatarFallbackUrl(channel.name);
    const thumbSrc = channel.thumbnail || fallback;

    card.innerHTML = `
          <img src="${esc(thumbSrc)}" class="channel-option-img" onerror="this.onerror=null;this.src='${fallback}'" loading="lazy"/>
          <span class="channel-check-badge">✔</span>
          <div class="channel-option-label">${esc(channel.name)}</div>
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

    // Strategy 3: Use shared cache (no extra network call)
    const channels = await fetchRankingsRaw();

    if (channels && channels.length > 0) {
      renderAll(channels.slice(0, 16));
    } else {
      if (loader) loader.style.display = 'none';
    }
  } catch (e) {
    console.warn('Failed to load dynamic rankings:', e);
    if (loader) loader.style.display = 'none';
    // Curated fallback is already visible - that's fine
  }
}



async function showAddChannelModal() {
  // Toggle: close if already open
  const existing = document.getElementById('add-channel-modal');
  if (existing) { existing.remove(); return; }

  const hasApiKey = !!state.data.apiKey;

  const modal = document.createElement('div');
  modal.id = 'add-channel-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content glass add-channel-content">
      <button class="close-btn-corner" id="close-add-channel">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <div class="modal-header" style="margin-bottom:12px;">
        <h2 style="font-size:1.2rem; margin:0;">📺 管理頻道</h2>
      </div>

      <!-- Prominent Add Channel CTA -->
      <button id="add-channel-toggle-btn" class="add-channel-btn-cta">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span class="add-channel-btn-label">新增頻道</span>
      </button>

      <!-- Expandable add panel -->
      <div id="add-channel-panel" class="add-channel-panel" style="display:none;">
        ${hasApiKey ? `
        <div style="position:relative;">
          <input id="modal-channel-search" class="manage-search-input" type="text"
            placeholder="輸入頻道名稱搜尋…" autocomplete="off" autofocus />
          <ul id="modal-search-results" class="search-dropdown hidden"
            style="position:absolute;width:100%;z-index:10;top:calc(100% + 4px);left:0;"></ul>
        </div>
        ` : `
        <div class="api-guide-box">
          <div class="api-guide-title">🔑 搜尋頻道需要 YouTube API Key</div>
          <p class="api-guide-desc">目前為 <strong>Lite Mode</strong>，只能從人氣榜點擊新增頻道。若要搜尋並加入任意 YouTube 頻道，請先切換到 Pro Mode 並設定 API Key。</p>

          <div class="api-guide-steps">
            <div class="api-step">
              <span class="api-step-num">1</span>
              <span>點擊右上角 <strong>⚙️ 設定</strong>，關閉此視窗後可找到</span>
            </div>
            <div class="api-step">
              <span class="api-step-num">2</span>
              <span>在「連線模式」中切換到 <strong>🚀 Pro Mode</strong></span>
            </div>
            <div class="api-step">
              <span class="api-step-num">3</span>
              <span>取得 YouTube API Key（步驟如下），貼上後儲存</span>
            </div>
          </div>

          <details class="api-how-to-get">
            <summary>如何取得免費的 API Key？</summary>
            <ol class="api-how-steps">
              <li>前往 <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console</a></li>
              <li>點選右上角「選取專案」→「新增專案」，建立一個專案</li>
              <li>在搜尋欄輸入 <strong>YouTube Data API v3</strong>，進入後點擊「啟用」</li>
              <li>左側選單前往「憑證」→「建立憑證」→「API 金鑰」</li>
              <li>複製產生的金鑰，回到 KiddoLens 設定的 Pro Mode 欄位貼上並儲存</li>
            </ol>
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" class="api-guide-link">
              前往 Google Cloud Console ↗
            </a>
          </details>
        </div>
        `}
      </div>

      <div class="rec-tabs">
        <button class="rec-tab active" data-tab="popular">🏆 人氣榜</button>
        <button class="rec-tab" data-tab="manage">↕ 頻道排序</button>
      </div>
      <div id="manage-content-popular" class="rec-content">
        <div class="wizard-channel-grid" id="manage-grid-popular"></div>
      </div>
      <div id="manage-content-manage" class="rec-content" style="display:none;">
        <ul id="manage-channel-list" class="manage-channel-list"></ul>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Tab switching
  function switchTab(tabName) {
    modal.querySelectorAll('.rec-tab').forEach(t => t.classList.remove('active'));
    modal.querySelector(`.rec-tab[data-tab="${tabName}"]`).classList.add('active');
    ['popular', 'manage'].forEach(name => {
      const el = document.getElementById(`manage-content-${name}`);
      if (el) el.style.display = name === tabName ? '' : 'none';
    });
    if (tabName === 'manage') {
      renderManageChannelList(document.getElementById('manage-channel-list'));
    }
  }
  modal.querySelectorAll('.rec-tab').forEach(tab => {
    tab.onclick = () => switchTab(tab.dataset.tab);
  });

  // Close
  document.getElementById('close-add-channel').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  // Toggle add channel panel
  const addToggleBtn = document.getElementById('add-channel-toggle-btn');
  const addPanel = document.getElementById('add-channel-panel');
  addToggleBtn.onclick = () => {
    const isOpen = addPanel.style.display !== 'none';
    addPanel.style.display = isOpen ? 'none' : '';
    addToggleBtn.classList.toggle('open', !isOpen);
    if (!isOpen && hasApiKey) {
      const si = document.getElementById('modal-channel-search');
      if (si) si.focus();
    }
  };

  // In-modal YouTube search (only when API key is set)
  if (hasApiKey) {
    const searchInput = document.getElementById('modal-channel-search');
    const searchResults = document.getElementById('modal-search-results');
    let modalSearchDebounce;

    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      clearTimeout(modalSearchDebounce);
      if (query.length < 2) { searchResults.classList.add('hidden'); return; }
      modalSearchDebounce = setTimeout(() => searchChannelsInModal(query, searchResults, modal), 800);
    });

    // Hide dropdown when clicking outside search area
    modal.querySelector('.modal-content').addEventListener('click', (e) => {
      if (!e.target.closest('#modal-channel-search') && !e.target.closest('#modal-search-results')) {
        searchResults.classList.add('hidden');
      }
    });
  }

  // Helper: re-render popular grid
  function renderBothGrids(channels) {
    if (!document.getElementById('add-channel-modal')) return;
    const addedIds = new Set(getCurrentProfile().channels.map(c => c.id));
    renderRecGrid(document.getElementById('manage-grid-popular'), channels, addedIds);
  }

  // Expose on modal element so handleChannelAdd can refresh grids without re-opening
  modal._renderBothGrids = renderBothGrids;
  modal._channelsCache = null;

  // Show CURATED_CHANNELS immediately (sync fallback)
  renderBothGrids([...CURATED_CHANNELS]);

  // Fetch real community rankings, enrich thumbnails, then re-render
  fetchRankingsRaw()
    .then(async channels => {
      if (!document.getElementById('add-channel-modal')) return;

      const missing = channels.filter(ch => !ch.thumbnail);
      if (missing.length > 0 && state.data.apiKey) {
        try {
          const ids = missing.map(ch => ch.id).join(',');
          const data = await ytFetch(
            `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${ids}&key=${state.data.apiKey}`
          );
          if (data.items) {
            data.items.forEach(item => {
              const ch = channels.find(c => c.id === item.id);
              if (ch) ch.thumbnail = item.snippet.thumbnails.default?.url || '';
            });
          }
        } catch (e) { /* thumbnails remain empty, ui-avatars fallback handles it */ }
      }

      if (!document.getElementById('add-channel-modal')) return;
      modal._channelsCache = channels;
      renderBothGrids(channels);
    })
    .catch(() => { /* curated fallback already visible */ });
}

// Format subscriber count with natural zh units: 123000000 → "1.2億",
// 1200000 → "120萬", 45000 → "4.5萬", 800 → "800"
function fmtSubs(n) {
  if (!n || n < 0) return null;
  if (n >= 100000000) return `${(n / 100000000).toFixed(1).replace(/\.0$/, '')}億`;
  if (n >= 100000) return `${Math.round(n / 10000)}萬`;
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}萬`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}千`;
  return String(n);
}

// Search YouTube channels inside the manage-channel modal
async function searchChannelsInModal(query, resultsEl, modal) {
  if (!state.data.apiKey || !modal.isConnected) return;
  resultsEl.innerHTML = '<li style="padding:10px;color:#aaa;">搜尋中…</li>';
  resultsEl.classList.remove('hidden');

  try {
    // 1. Search for channels
    const searchData = await ytFetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(query)}&maxResults=6&key=${state.data.apiKey}`
    );
    if (!modal.isConnected) return;

    const items = searchData.items || [];
    if (items.length === 0) {
      resultsEl.innerHTML = '<li style="padding:10px;color:#aaa;">找不到符合的頻道</li>';
      return;
    }

    // 2. Batch-fetch subscriber counts (statistics)
    const ids = items.map(i => i.snippet.channelId).join(',');
    let statsMap = {};
    try {
      const statsData = await ytFetch(
        `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${ids}&key=${state.data.apiKey}`
      );
      (statsData.items || []).forEach(ch => {
        statsMap[ch.id] = parseInt(ch.statistics?.subscriberCount || '0', 10);
      });
    } catch (_) { /* subscriber counts unavailable — degrade gracefully */ }

    if (!modal.isConnected) return;

    // 3. Build KiddoLens count lookup from cache
    const kiddoMap = {};
    (_rankingsCache || []).forEach(ch => { if (ch.count) kiddoMap[ch.id] = ch.count; });

    // 4. Render results
    resultsEl.innerHTML = '';
    const profile = getCurrentProfile();
    items.forEach(item => {
      const channelData = {
        id: item.snippet.channelId,
        name: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || ''
      };
      const isAdded = profile.channels.some(c => c.id === channelData.id);
      const fallback = avatarFallbackUrl(channelData.name, 88);

      const ytSubs = fmtSubs(statsMap[channelData.id]);
      const kiddoCount = kiddoMap[channelData.id];

      const statsHtml = [
        ytSubs ? `<span class="search-stat yt-stat">▶ ${ytSubs} 訂閱</span>` : '',
        kiddoCount ? `<span class="search-stat kiddo-stat">🐣 ${kiddoCount} 家庭使用</span>` : ''
      ].filter(Boolean).join('');

      const li = document.createElement('li');
      li.className = 'search-result-item';
      li.style.opacity = isAdded ? '0.6' : '1';
      li.innerHTML = `
        <img src="${esc(channelData.thumbnail || fallback)}" class="search-avatar"
          onerror="this.onerror=null;this.src='${fallback}'" />
        <div class="search-info">
          <span class="search-name">${esc(channelData.name)}</span>
          <div class="search-stats-row">
            ${statsHtml}
            ${isAdded ? '<span class="search-stat added-stat">✓ 已加入</span>' : ''}
          </div>
        </div>
      `;
      if (!isAdded) {
        li.onclick = () => {
          resultsEl.classList.add('hidden');
          const searchInput = document.getElementById('modal-channel-search');
          if (searchInput) searchInput.value = '';
          handleChannelAdd(channelData);
        };
      }
      resultsEl.appendChild(li);
    });
  } catch (e) {
    if (modal.isConnected) {
      resultsEl.innerHTML = '<li style="padding:10px;color:#e55;">搜尋失敗，請稍後再試</li>';
    }
  }
}

// Render the "已加入" tab channel list with drag-to-reorder and delete
function renderManageChannelList(listEl) {
  if (!listEl) return;
  const profile = getCurrentProfile();
  listEl.innerHTML = '';

  if (profile.channels.length === 0) {
    listEl.innerHTML = '<li style="padding:20px;text-align:center;color:#aaa;">還沒有加入頻道。</li>';
    return;
  }

  // ── Render items ──
  profile.channels.forEach((channel) => {
    const li = document.createElement('li');
    li.className = 'manage-channel-item';
    li.dataset.id = channel.id;
    const fallback = avatarFallbackUrl(channel.name, 64);
    li.innerHTML = `
      <span class="drag-handle" title="拖曳排序">⠿</span>
      <img src="${esc(channel.thumbnail || fallback)}" class="manage-channel-thumb"
        onerror="this.onerror=null;this.src='${fallback}'" />
      <span class="manage-channel-name">${esc(channel.name)}</span>
      <button class="manage-channel-delete" title="移除頻道">✕</button>
    `;
    li.querySelector('.manage-channel-delete').onclick = (e) => {
      e.stopPropagation();
      profile.channels = profile.channels.filter(c => c.id !== channel.id);
      saveLocalData();
      logAudit('audit_channel_removed', { channel: channel.name, profile: profile.name });
      renderChannelNav();
      fetchAllVideos();
      renderManageChannelList(listEl);
      const modal = document.getElementById('add-channel-modal');
      if (modal?._renderBothGrids) modal._renderBothGrids(modal._channelsCache || [...CURATED_CHANNELS]);
    };
    listEl.appendChild(li);
  });

  // ── Pointer Events drag-to-sort: works on both mouse and touch ──
  let dragEl = null;

  function saveDomOrder() {
    const newOrder = [];
    listEl.querySelectorAll('.manage-channel-item[data-id]').forEach(item => {
      const ch = profile.channels.find(c => c.id === item.dataset.id);
      if (ch) newOrder.push(ch);
    });
    profile.channels = newOrder;
    saveLocalData();
    renderChannelNav();
  }

  listEl.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.drag-handle')) return;
    const li = e.target.closest('.manage-channel-item');
    if (!li) return;
    e.preventDefault();
    dragEl = li;
    // Capture on the list so pointermove keeps firing even when finger leaves an item
    listEl.setPointerCapture(e.pointerId);
    li.classList.add('dragging');
  });

  listEl.addEventListener('pointermove', (e) => {
    if (!dragEl) return;
    e.preventDefault();
    // Temporarily disable pointer-events on dragEl so elementFromPoint looks through it
    dragEl.style.pointerEvents = 'none';
    const below = document.elementFromPoint(e.clientX, e.clientY);
    dragEl.style.pointerEvents = '';
    const target = below?.closest('.manage-channel-item');
    if (!target || target === dragEl) return;
    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      target.before(dragEl);
    } else {
      target.after(dragEl);
    }
  });

  const endDrag = () => {
    if (!dragEl) return;
    dragEl.classList.remove('dragging');
    dragEl = null;
    saveDomOrder();
  };
  listEl.addEventListener('pointerup', endDrag);
  listEl.addEventListener('pointercancel', endDrag);
}

function renderRecGrid(grid, channels, addedIds) {
  if (!grid) return;
  grid.innerHTML = '';

  if (!channels || channels.length === 0) {
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#aaa;padding:20px 0;">沒有更多建議頻道</p>';
    return;
  }

  channels.forEach(channel => {
    const isAdded = addedIds.has(channel.id);
    const card = document.createElement('div');
    card.className = `channel-option-card${isAdded ? ' rec-already-added' : ''}`;

    const fallback = avatarFallbackUrl(channel.name);
    const thumbSrc = channel.thumbnail || fallback;

    card.innerHTML = `
      <img src="${esc(thumbSrc)}" class="channel-option-img" onerror="this.onerror=null;this.src='${fallback}'" loading="lazy"/>
      <span class="channel-check-badge${isAdded ? ' badge-added' : ''}">
        ${isAdded ? '✓' : '✔'}
      </span>
      <div class="channel-option-label">${esc(channel.name)}</div>
      ${isAdded ? '<div class="rec-added-label">已加入</div>' : ''}
    `;

    if (!isAdded) {
      card.onclick = () => handleChannelAdd(channel);
    }
    grid.appendChild(card);
  });
}

function handleChannelAdd(channel) {
  const profiles = state.data.profiles;

  // Single profile: add and stay in modal, refresh grids
  if (profiles.length <= 1) {
    const profile = getCurrentProfile();
    if (!profile.channels.some(c => c.id === channel.id)) {
      profile.channels.push({ id: channel.id, name: channel.name, thumbnail: channel.thumbnail || '' });
      saveLocalData();
      logAudit('audit_channel_added', { channel: channel.name, profile: profile.name });
      renderChannelNav();
      fetchAllVideos();
    }
    _refreshAddChannelModal();
    return;
  }

  // Multiple profiles: show profile picker
  showProfilePickerForChannel(channel);
}

// Refresh grids and manage list inside the open add-channel modal (without closing it)
function _refreshAddChannelModal() {
  const modal = document.getElementById('add-channel-modal');
  if (!modal) return;
  if (modal._renderBothGrids) modal._renderBothGrids(modal._channelsCache || [...CURATED_CHANNELS]);
  const manageList = document.getElementById('manage-channel-list');
  if (manageList) renderManageChannelList(manageList);
}

function showProfilePickerForChannel(channel) {
  const currentProfile = getCurrentProfile();
  const otherProfiles = state.data.profiles.filter(p => p.id !== currentProfile.id);

  const overlay = document.createElement('div');
  overlay.id = 'profile-pick-overlay';
  overlay.className = 'profile-pick-overlay';
  overlay.innerHTML = `
    <div class="profile-pick-content glass">
      <h3 style="margin:0 0 6px;font-size:1.05rem;">加入「${esc(channel.name)}」</h3>
      <p style="margin:0 0 16px;font-size:0.85rem;color:#666;">同時加入其他孩子的清單？</p>
      <div class="profile-pick-list">
        ${otherProfiles.map(p => `
          <label class="profile-pick-item">
            <input type="checkbox" value="${esc(p.id)}">
            <span>${p.avatar || '👤'} ${esc(p.name)}</span>
          </label>
        `).join('')}
      </div>
      <div class="profile-pick-actions">
        <button id="profile-pick-cancel" class="secondary-btn" style="flex:1;">取消</button>
        <button id="profile-pick-confirm" class="primary-btn" style="flex:1;">加入頻道</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('profile-pick-cancel').onclick = () => overlay.remove();
  document.getElementById('profile-pick-confirm').onclick = () => {
    const newChannel = { id: channel.id, name: channel.name, thumbnail: channel.thumbnail || '' };

    // Always add to current profile
    if (!currentProfile.channels.some(c => c.id === channel.id)) {
      currentProfile.channels.push({ ...newChannel });
      logAudit('audit_channel_added', { channel: channel.name, profile: currentProfile.name });
    }

    // Add to each checked additional profile
    overlay.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
      const p = state.data.profiles.find(pr => pr.id === cb.value);
      if (p && !p.channels.some(c => c.id === channel.id)) {
        p.channels.push({ ...newChannel });
        logAudit('audit_channel_added', { channel: channel.name, profile: p.name });
      }
    });

    saveLocalData();
    renderChannelNav();
    fetchAllVideos();
    overlay.remove();
    _refreshAddChannelModal();
  };
}

// Start
init();
