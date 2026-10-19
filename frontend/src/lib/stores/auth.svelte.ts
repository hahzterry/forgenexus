import { api } from '$lib/api/client';
import { notificationStore } from './notifications.svelte';

interface User {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  slug: string;
  avatar_url: string | null;
  post_count: number;
  thread_count: number;
  reputation: number;
  points: number;
  trust_level: number;
  status: string;
  theme: string;
  inserted_at: string;
  // Profile customization
  custom_title: string | null;
  nameplate_color: string | null;
  nameplate_image_url: string | null;
  avatar_frame: string | null;
  avatar_frame_color: string | null;
  profile_font: string | null;
  // Theme overrides
  theme_id: string | null;
  color_override_accent: string | null;
  color_override_bg_primary: string | null;
  color_override_bg_secondary: string | null;
  color_override_text_primary: string | null;
  // Username styling
  username_color: string | null;
  username_effect: string | null;
  // Presence
  presence_status: string | null;
  custom_status_text: string | null;
  custom_status_emoji: string | null;
  // Staff
  is_staff: boolean;
  // Email verification
  email_verified: boolean;
  // 2FA
  totp_enabled: boolean;
  // Subscription
  subscription_tier: {
    name: string;
    slug: string;
    tier_level: number;
    color: string;
    badge_text: string;
  } | null;
}

interface BanInfo {
  reason: string;
  type: string;
  expires_at: string | null;
  banned_by: string;
}

let sessionVersion = 0;
let user = $state<User | null>(null);
let loading = $state(true);
let banInfo = $state<BanInfo | null>(null);

export const auth = {
  get user() { return user; },
  get loading() { return loading; },
  get isLoggedIn() { return !!user; },
  get isStaff() { return user?.is_staff ?? false; },
  get banInfo() { return banInfo; },
  get isBanned() { return !!banInfo; },

  async init() {
    const version = sessionVersion;
    api.loadToken();
    try {
      const data = await api.me();
      if (version !== sessionVersion) return;
      user = data.user;
      banInfo = null;
      if (user && !api.getWsToken()) {
        try {
          const refreshData = await api.request('/auth/refresh', {method: 'POST'});
          if (version === sessionVersion && refreshData?.token) api.setToken(refreshData.token);
        } catch { /* best effort */ }
      }
    } catch (err: any) {
      if (version !== sessionVersion) return;
      user = null;
      if (err?.status === 403 && err?.ban) banInfo = err.ban;
    }
    if (version === sessionVersion) loading = false;
  },

  async login(email: string, password: string) {
    ++sessionVersion;
    try {
      const data = await api.login(email, password);
      ++sessionVersion;
      if (!data.requires_2fa) { api.setToken(data.token); user = data.user; }
      loading = false;
      return data;
    } catch (error) { loading = false; throw error; }
  },

  async register(username: string, email: string, password: string) {
    ++sessionVersion;
    try {
      const data = await api.register({ username, email, password });
      ++sessionVersion;
      api.setToken(data.token);
      user = data.user;
      loading = false;
      return data;
    } catch (error) { loading = false; throw error; }
  },

  setUser(u: User) {
    ++sessionVersion; loading = false;
    user = u;
  },

  async logout() {
    ++sessionVersion; loading = false;
    notificationStore.stopPolling();
    try { await api.logout(); } catch { /* best effort */ }
    api.setToken(null);
    user = null;
  }
};
