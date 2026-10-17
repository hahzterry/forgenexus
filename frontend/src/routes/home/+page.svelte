<script lang="ts">
  import { api } from '$lib/api/client';
  import Shoutbox from '$lib/components/chat/Shoutbox.svelte';
  import SocialFeed from '$lib/components/home/SocialFeed.svelte';
  import WelcomeCenter from '$lib/components/home/WelcomeCenter.svelte';
  import WhosOnline from '$lib/components/home/WhosOnline.svelte';
  import TodaysStats from '$lib/components/home/TodaysStats.svelte';
  import UsernameDisplay from '$lib/components/common/UsernameDisplay.svelte';
  import Skeleton from '$lib/components/common/Skeleton.svelte';
  import { siteSettings } from '$lib/stores/settings.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { socketStore } from '$lib/stores/socket.svelte';
  import { onDestroy } from 'svelte';

  let viewMode = $state<'forums' | 'feed'>(
    typeof localStorage !== 'undefined'
      ? ((localStorage.getItem('home:viewMode') as 'forums' | 'feed') || 'forums')
      : 'forums'
  );

  $effect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('home:viewMode', viewMode);
    }
  });

  interface Forum {
    id: string;
    name: string;
    slug: string;
    description: string;
    icon: string;
    thread_count: number;
    post_count: number;
    last_post_at: string | null;
    last_post_user: {
      username: string;
      slug: string;
      username_color: string | null;
      username_effect: string | null;
    } | null;
    viewers_count: number;
    parent_id: string | null;
    children?: Forum[];
  }

  interface Category {
    id: string;
    name: string;
    slug: string;
    description: string;
    icon: string;
    color: string;
    forums: Forum[];
  }

  let categories = $state<Category[]>([]);
  let unreadCounts = $state<Record<string, number>>({});
  let welcomeStats = $state<any>(null);
  let presenceState = $state<'loading' | 'ready' | 'error'>('loading');
  let onlineCount = $derived(welcomeStats?.online_count);
  let loading = $state(true);

  $effect(() => {
    loadData();
  });

  async function loadData() {
    // Load forums and welcome stats in parallel
    const [forumsData, statsData] = await Promise.allSettled([
      api.getForums(),
      api.getWelcomeStats()
    ]);

    if (forumsData.status === 'fulfilled') {
      categories = forumsData.value.categories || [];
      unreadCounts = forumsData.value.unread_counts || {};
    }
    if (statsData.status === 'fulfilled') {
      welcomeStats = statsData.value;
      presenceState = Number.isInteger(statsData.value?.online_count) && statsData.value.online_count >= 0 ? 'ready' : 'error';
    } else {
      presenceState = 'error';
    }

    loading = false;
  }

  // --- Realtime forum index updates ---
  // Listens for `forum_updated` broadcasts from the backend and applies the
  // delta to the loaded categories so counters refresh without a hard reload.
  let forumIndexChannel: any = null;
  $effect(() => {
    if (!socketStore.connected) return;
    const phoenixSocket = socketStore.getSocket();
    if (!phoenixSocket) return;
    if (forumIndexChannel) return;
    forumIndexChannel = phoenixSocket.channel('forums:index', {});
    forumIndexChannel.on('forum_updated', (payload: any) => {
      const { forum_id, delta, last_post_at, last_post_user_id } = payload;
      categories = categories.map((cat) => ({
        ...cat,
        forums: cat.forums.map((f) => applyDelta(f, forum_id, delta, last_post_at, last_post_user_id))
      }));
    });
    forumIndexChannel.join();
    return () => {
      forumIndexChannel?.leave();
      forumIndexChannel = null;
    };
  });

  function applyDelta(forum: Forum, forumId: string, delta: any, lastPostAt: string, lastPostUserId: string | null): Forum {
    if (forum.id !== forumId) {
      if (forum.children?.length) {
        return { ...forum, children: forum.children.map((c) => applyDelta(c, forumId, delta, lastPostAt, lastPostUserId)) };
      }
      return forum;
    }
    return {
      ...forum,
      thread_count: forum.thread_count + (delta.thread_count ?? 0),
      post_count: forum.post_count + (delta.post_count ?? 0),
      last_post_at: lastPostAt
    };
  }

  onDestroy(() => {
    if (forumIndexChannel) {
      forumIndexChannel.leave();
      forumIndexChannel = null;
    }
  });

  let hasUnread = $derived(Object.values(unreadCounts).some(c => c > 0));
  let markingAllRead = $state(false);

  async function markAllForumsRead() {
    markingAllRead = true;
    try {
      await api.markAllForumsRead();
      unreadCounts = {};
    } catch (err) {
      console.error('Failed to mark all forums read:', err);
    }
    markingAllRead = false;
  }

  function timeAgo(dateStr: string | null): string {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
  }
</script>

<div class="home-layout">
  <section class="nexus-hero" aria-labelledby="nexus-hero-title">
    <div class="hero-copy">
      <div class="hero-kicker"><span class="hero-kicker-line"></span> A COMMUNITY BUILT TO CREATE</div>
      <h1 id="nexus-hero-title">
        {#if auth.isLoggedIn}
          Your people. <span>Your next idea.</span>
        {:else}
          Find your people.<br /><span>Make something great.</span>
        {/if}
      </h1>
      <p>Ideas, projects, and good conversations start here.</p>
      <div class="hero-actions">
        <a class="hero-primary" href={auth.isLoggedIn ? '/forums' : '/auth/register'}>
          {auth.isLoggedIn ? 'Explore the forums' : 'Join the community'} <span aria-hidden="true">↗</span>
        </a>
        <a class="hero-secondary" href="/trending">See what’s happening</a>
      </div>
    </div>
    <div class="hero-presence" role="status" aria-live="polite" aria-busy={presenceState === 'loading'}>
      {#if presenceState === 'loading'}
        <span class="presence-label">COMMUNITY PRESENCE</span>
        <strong class="presence-message">Checking activity…</strong>
        <span>Loading the online count</span>
      {:else if presenceState === 'error'}
        <span class="presence-label">COMMUNITY PRESENCE</span>
        <strong class="presence-message">Activity unavailable</strong>
        <span>You can still explore the forums</span>
      {:else}
        <span class="presence-label">{#if onlineCount > 0}<i></i>{/if} COMMUNITY PRESENCE</span>
        <strong>{onlineCount.toLocaleString()} <small>online</small></strong>
        <span>{onlineCount === 0 ? 'Be the first to start a conversation' : onlineCount === 1 ? 'One member is online now' : 'Members are online now'}</span>
      {/if}
    </div>
    <div class="hero-orbit" aria-hidden="true"></div>
  </section>

  <!-- View toggle -->
  <div class="view-toggle glass">
    <button class="toggle-btn" class:active={viewMode === 'feed'} onclick={() => viewMode = 'feed'}>
      <span>🏠</span> Feed
    </button>
    <button class="toggle-btn" class:active={viewMode === 'forums'} onclick={() => viewMode = 'forums'}>
      <span>💬</span> Forums
    </button>
  </div>

  <div class="home-content">
    <div class="home-main">
      {#if viewMode === 'feed'}
        <!-- Social Feed View -->
        <SocialFeed />
      {:else}
        <!-- Forum View -->
        <div class="forum-index" id="forum-index">
          <!-- Welcome Center -->
          <WelcomeCenter communityHero />

          <!-- Shoutbox -->
          {#if siteSettings.shoutboxEnabled}
            <Shoutbox />
          {/if}

          {#if !loading && auth.isLoggedIn && hasUnread}
            <div class="index-toolbar">
              <button class="btn-mark-all-read" onclick={markAllForumsRead} disabled={markingAllRead}>
                {markingAllRead ? 'Marking...' : 'Mark All Read'}
              </button>
            </div>
          {/if}

  {#if loading}
    <div class="skeleton-loading">
      {#each [1, 2] as _}
        <div class="skeleton-category">
          <Skeleton width="200px" height="24px" rounded />
          <div class="skeleton-table">
            {#each [1, 2, 3] as __}
              <div class="skeleton-row">
                <Skeleton width="60%" height="14px" />
                <Skeleton width="40%" height="11px" />
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {:else}
    {#each categories as category (category.id)}
      <!-- Category block -->
      <div class="category-block">
        <div class="category-header" style="border-left-color: {category.color}">
          <h2>{category.name}</h2>
          {#if category.description}
            <span class="category-desc">{category.description}</span>
          {/if}
        </div>

        <table class="forum-table">
          <thead>
            <tr class="forum-table-header">
              <th style="width: 50%">Forum</th>
              <th class="stat-col">Threads</th>
              <th class="stat-col">Posts</th>
              <th>Last Post</th>
            </tr>
          </thead>
          <tbody>
            {#each category.forums as forum (forum.id)}
              <tr class="forum-table-row">
                <td>
                  <div class="forum-info">
                    <div class="forum-icon" style="color: {category.color}">
                      &#128172;
                    </div>
                    <div>
                      <a href="/forums/{forum.slug}" class="forum-name">
                        {forum.name}
                        {#if unreadCounts[forum.id]}
                          <span class="unread-badge">{unreadCounts[forum.id]}</span>
                        {/if}
                      </a>
                      {#if forum.description}
                        <div class="forum-desc">{forum.description}</div>
                      {/if}
                      {#if forum.children?.length}
                        <div class="subforum-links">
                          <span class="subforum-label">Sub-forums:</span>
                          {#each forum.children as child, i}
                            <a href="/forums/{child.slug}" class="subforum-link">{child.name}</a>{#if i < forum.children.length - 1}<span class="subforum-sep">,</span>{/if}
                          {/each}
                        </div>
                      {/if}
                    </div>
                  </div>
                </td>
                <td class="stat-cell">
                  <div class="count">{forum.thread_count}</div>
                  <div class="label">Threads</div>
                </td>
                <td class="stat-cell">
                  <div class="count">{forum.post_count}</div>
                  <div class="label">Posts</div>
                </td>
                <td class="lastpost-cell">
                  {#if forum.last_post_at}
                    <div class="last-post-info">
                      <span class="post-time">{timeAgo(forum.last_post_at)}</span>
                      {#if forum.last_post_user}
                        <span class="last-post-by">
                          by <UsernameDisplay
                            username={forum.last_post_user.username}
                            color={forum.last_post_user.username_color}
                            effect={forum.last_post_user.username_effect}
                            href="/profile/{forum.last_post_user.slug}"
                            size="small"
                          />
                        </span>
                      {/if}
                    </div>
                  {:else}
                    <span class="no-posts">No posts yet</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/each}
  {/if}

          <!-- Today's Stats Bar -->
          <TodaysStats stats={welcomeStats} />
        </div>
      {/if}
    </div>

    <!-- Sidebar -->
    <aside class="home-sidebar">
      <WhosOnline />

      <div class="sidebar-card glass">
        <h3 class="sidebar-heading">Quick Links</h3>
        <a href="/search" class="sidebar-link">🔍 Search</a>
        <a href="/members" class="sidebar-link">👥 Members</a>
        <a href="/trending" class="sidebar-link">🔥 Trending</a>
        <a href="/new-posts" class="sidebar-link">📰 New Posts</a>
        <a href="/live" class="sidebar-link">🎙 Voice Rooms</a>
        <a href="/stats" class="sidebar-link">📊 Statistics</a>
      </div>

      {#if auth.isLoggedIn}
        <div class="sidebar-card glass">
          <h3 class="sidebar-heading">Your Activity</h3>
          <div class="sidebar-stat">
            <span>Posts</span>
            <strong>{auth.user?.post_count || 0}</strong>
          </div>
          <div class="sidebar-stat">
            <span>Threads</span>
            <strong>{auth.user?.thread_count || 0}</strong>
          </div>
          <div class="sidebar-stat">
            <span>Points</span>
            <strong>{auth.user?.points || 0}</strong>
          </div>
          <div class="sidebar-stat">
            <span>Rep</span>
            <strong>{auth.user?.reputation || 0}</strong>
          </div>
        </div>
      {/if}
    </aside>
  </div>
</div>

<style>
  .home-layout { max-width: 1360px; margin: 0 auto; padding: 28px 28px 48px; }

  .nexus-hero {
    min-height: 222px; position: relative; overflow: hidden; isolation: isolate;
    display: flex; align-items: center; justify-content: space-between; gap: 24px;
    padding: 34px 38px; margin-bottom: 24px;
    border: 1px solid var(--border-color); border-radius: 20px;
    background: linear-gradient(112deg, var(--accent-muted), var(--bg-card) 58%, var(--bg-secondary));
    box-shadow: 0 20px 50px rgba(0,0,0,.16);
  }
  .hero-copy { position: relative; z-index: 2; }
  .hero-kicker { display:flex; align-items:center; gap:9px; color:var(--accent); font-size:10px; font-weight:800; letter-spacing:.17em; }
  .hero-kicker-line { width:24px; height:1px; background:var(--accent); }
  .nexus-hero h1 { margin:12px 0 8px; font-size:clamp(32px,4vw,48px); line-height:1.04; letter-spacing:-.055em; font-weight:800; }
  .nexus-hero h1 span { color:var(--accent); }
  .nexus-hero p { margin:0; color:var(--text-secondary); font-size:14px; }
  .hero-actions { display:flex; align-items:center; gap:10px; margin-top:20px; }
  .hero-primary,.hero-secondary { min-height:40px; display:inline-flex; align-items:center; justify-content:center; gap:9px; padding:0 15px; border-radius:9px; text-decoration:none; font-size:12px; font-weight:750; transition:transform var(--transition-fast),background var(--transition-fast); }
  .hero-primary { color:var(--on-accent); background:var(--accent); }
  .hero-primary:hover { color:var(--on-accent); background:var(--accent-hover); transform:translateY(-1px); }
  .hero-secondary { color:var(--text-primary); background:rgba(255,255,255,.06); border:1px solid var(--border-color); }
  .hero-secondary:hover { background:rgba(255,255,255,.1); }
  .hero-presence { z-index:2; width:218px; flex:none; padding:16px 17px; border:1px solid var(--border-color); border-radius:13px; background:var(--bg-secondary); backdrop-filter:blur(12px); }
  .presence-label { display:flex; align-items:center; gap:8px; color:var(--text-secondary); font-size:9px; font-weight:800; letter-spacing:.1em; }
  .presence-label i { width:7px; height:7px; border-radius:50%; background:#72dfa7; box-shadow:0 0 0 5px rgba(114,223,167,.12); }
  .hero-presence .presence-message { font-size: 18px; line-height: 1.3; }
  .hero-presence strong { display:block; margin:8px 0 0; font-size:29px; letter-spacing:-.04em; font-variant-numeric:tabular-nums; }
  .hero-presence small { color:var(--text-secondary); font-size:12px; font-weight:550; letter-spacing:0; }
  .hero-presence > span:last-child { color:var(--text-secondary); font-size:10px; }
  .hero-orbit { pointer-events:none; position:absolute; z-index:1; width:330px; height:330px; right:12%; top:-200px; border:1px solid rgba(0,229,184,.16); border-radius:50%; box-shadow:0 0 0 35px rgba(0,229,184,.045),0 0 0 70px rgba(0,229,184,.025); }

  .view-toggle {
    display: flex; gap: 4px; margin-bottom: 16px;
    padding: 4px; border-radius: var(--radius-lg);
    width: fit-content;
  }

  .toggle-btn {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 20px; border-radius: var(--radius-md);
    border: none; background: transparent; color: var(--text-muted);
    font-size: 14px; font-weight: 600; cursor: pointer;
    transition: all var(--transition-fast);
  }

  .toggle-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .toggle-btn.active {
    background: var(--accent-gradient); color: var(--bg-primary);
    box-shadow: 0 2px 8px var(--accent-glow);
  }

  .home-content { display: flex; gap: 20px; }
  .home-main { flex: 1; min-width: 0; }

  .home-sidebar {
    width: 280px; flex-shrink: 0;
    display: flex; flex-direction: column; gap: 12px;
  }

  .sidebar-card { padding: 14px; }

  .sidebar-heading {
    font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: var(--accent); margin-bottom: 10px;
  }

  .sidebar-link {
    display: block; padding: 6px 0;
    font-size: 13px; color: var(--text-secondary);
    text-decoration: none; transition: color var(--transition-fast);
  }

  .sidebar-link:hover { color: var(--accent); }

  .sidebar-stat {
    display: flex; justify-content: space-between; padding: 4px 0;
    font-size: 13px; color: var(--text-secondary);
  }

  .sidebar-stat strong { color: var(--text-primary); }

  @media (max-width: 900px) {
    .home-content { flex-direction: column; gap: 12px; }
    .home-sidebar { width: 100%; }
  }

  @media (max-width: 768px) {
    .home-content { gap: 10px; }
    .toggle-btn { padding: 8px 14px; font-size: 13px; }
    .sidebar-card { padding: 10px; }
    .sidebar-heading { font-size: 11px; margin-bottom: 6px; }
    .sidebar-link, .sidebar-stat { font-size: 12px; }
    .forum-icon { font-size: 18px; }
    .forum-name { font-size: 13px; }
    .category-desc { margin-left: 0; font-size: 11px; }
  }

  @media (max-width: 600px) {
    .home-content { gap: 8px; }
    .home-main { padding: 0; }
  }

  .forum-index {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .category-block {
    margin-bottom: 8px;
  }

  .category-desc {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 400;
    margin-left: 12px;
  }

  .stat-col {
    width: 80px;
    text-align: center;
  }

  .forum-info {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }

  .forum-icon {
    font-size: 24px;
    margin-top: 2px;
  }

  .forum-name {
    font-size: 14px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }

  .unread-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--accent);
    color: var(--bg-primary);
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
  }

  .forum-desc {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .subforum-links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    margin-top: 3px;
    font-size: 11px;
  }

  .subforum-label {
    color: var(--text-muted);
    font-weight: 600;
    margin-right: 2px;
  }

  .subforum-link {
    color: var(--text-secondary);
    font-weight: 500;
  }

  .subforum-link:hover {
    color: var(--accent);
  }

  .subforum-sep {
    color: var(--text-muted);
    margin-right: 2px;
  }

  .no-posts {
    color: var(--text-muted);
    font-style: italic;
    font-size: 12px;
  }

  .post-time {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .last-post-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .last-post-by {
    font-size: 11px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 3px;
  }


  .index-toolbar {
    display: flex;
    justify-content: flex-end;
  }

  .btn-mark-all-read {
    padding: 4px 12px;
    border-radius: var(--radius, 6px);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--border-color);
    background: var(--bg-tertiary);
    color: var(--accent);
    transition: all 0.15s;
  }
  .btn-mark-all-read:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--accent);
  }
  .btn-mark-all-read:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .skeleton-loading {
    display: flex;
    flex-direction: column;
    gap: 24px;
    padding: 16px 0;
  }

  .skeleton-category {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .skeleton-table {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 12px 16px;
    background: var(--bg-secondary);
    border-radius: var(--radius, 6px);
    border: 1px solid var(--border-color);
  }

  .skeleton-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .category-block {
    margin: 0 0 2px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 15px;
    background: var(--bg-card);
    box-shadow: 0 12px 28px rgba(0,0,0,.11);
  }
  .category-header {
    min-height: 56px;
    margin: 0;
    padding: 10px 17px;
    border: 0;
    border-left: 3px solid var(--accent);
    border-radius: 0;
    background: rgba(255,255,255,.018);
  }
  .category-header h2 { font-size: 12px; letter-spacing: .09em; }
  .forum-table { border-spacing: 0; table-layout: fixed; }
  .forum-table-header {
    position: static;
    background: rgba(255,255,255,.025);
    border: 0;
    color: var(--text-muted);
    font-size: 9px;
    letter-spacing: .1em;
  }
  .forum-table-header th { padding: 9px 12px; }
  .forum-table-row { background: transparent; border-bottom: 1px solid var(--border-color); }
  .forum-table-row:hover { background: rgba(255,255,255,.035); }
  .forum-table-row td { padding: 14px 12px; }
  .forum-info { align-items: center; gap: 13px; }
  .forum-icon {
    display: grid; place-items: center; width: 42px; height: 42px; flex: 0 0 42px;
    margin: 0; border: 1px solid var(--border-color); border-radius: 12px;
    background: rgba(255,255,255,.035); font-size: 19px;
  }
  .forum-name { font-size: 13px; letter-spacing: -.01em; }
  .forum-desc { color: var(--text-secondary); line-height: 1.45; }
  .stat-cell .count { font-size: 13px; font-variant-numeric: tabular-nums; }
  .stat-cell .label { color: var(--text-muted); font-size: 9px; letter-spacing: .04em; text-transform: uppercase; }
  .lastpost-cell { min-width: 150px; }
  .post-time { color: var(--text-secondary); font-size: 11px; }
  .last-post-by { font-size: 10px; }
  .view-toggle { border: 1px solid var(--border-color); background: rgba(255,255,255,.025); }
  .toggle-btn { min-height: 36px; padding: 7px 15px; border-radius: 8px; font-size: 12px; }
  .toggle-btn.active { color: var(--on-accent); background: var(--accent); }

  @media (max-width: 900px) {
    .home-layout { padding: 20px 18px 36px; }
    .nexus-hero { padding: 28px; }
    .hero-presence { width: 190px; }
  }
  @media (max-width: 680px) {
    .home-layout { padding: 14px 12px 30px; }
    .nexus-hero { min-height:0; padding:24px 20px; border-radius:15px; margin-bottom:16px; }
    .nexus-hero { flex-direction:column; align-items:stretch; }
    .hero-presence { width:auto; }
    .nexus-hero h1 { font-size:34px; }
    .nexus-hero p { max-width:32ch; font-size:13px; }
    .hero-actions { flex-wrap:wrap; margin-top:16px; }
    .hero-primary,.hero-secondary { padding:0 12px; font-size:11px; }
  }
  @media (max-width: 768px) {
    .category-block { border-radius: 12px; }
    .category-header { min-height: 0; padding: 12px 14px; }
    .forum-table tr.forum-table-row { border: 0; border-bottom: 1px solid var(--border-color); border-radius: 0; }
    .forum-table tr.forum-table-row:last-child { border-bottom: 0; }
    .forum-table tr.forum-table-row > td { background: transparent; }
    .forum-table tr.forum-table-row > td:first-child { padding-top: 13px; }
    .forum-table tr.forum-table-row > td.stat-cell { border: 0; }
    .forum-icon { width: 38px; height: 38px; flex-basis: 38px; font-size: 17px; }
    .lastpost-cell { min-width: 0; }
  }
</style>
