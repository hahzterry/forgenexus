<script lang="ts">
  import { api } from '$lib/api/client';
  import Breadcrumb from '$lib/components/layout/Breadcrumb.svelte';
  import UsernameDisplay from '$lib/components/common/UsernameDisplay.svelte';
  import Skeleton from '$lib/components/common/Skeleton.svelte';
  import WhosOnline from '$lib/components/home/WhosOnline.svelte';
  import TodaysStats from '$lib/components/home/TodaysStats.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { socketStore } from '$lib/stores/socket.svelte';
  import { onDestroy } from 'svelte';

  interface Forum {
    id: string;
    name: string;
    slug: string;
    description: string;
    icon: string;
    thread_count: number;
    post_count: number;
    last_post_at: string | null;
    last_post_thread_title?: string | null;
    last_post_thread_slug?: string | null;
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
  let loading = $state(true);
  let collapsedCategories = $state<Record<string, boolean>>({});
  let markingAllRead = $state(false);

  // Current system clock
  let currentTime = $state(new Date().toUTCString());

  $effect(() => {
    loadData();
    const clockInterval = setInterval(() => {
      currentTime = new Date().toUTCString();
    }, 1000);
    return () => clearInterval(clockInterval);
  });

  async function loadData() {
    loading = true;
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
    }

    loading = false;
  }

  // --- Realtime forum index updates ---
  let forumIndexChannel: any = null;
  $effect(() => {
    if (!socketStore.connected) return;
    const phoenixSocket = socketStore.getSocket();
    if (!phoenixSocket || forumIndexChannel) return;

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

  let hasUnread = $derived(Object.values(unreadCounts).some((c) => c > 0));

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

  function toggleCategory(catId: string) {
    collapsedCategories[catId] = !collapsedCategories[catId];
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

<div class="board-container">
  <Breadcrumb crumbs={[{ label: 'Board Index' }]} />

  <div class="board-header">
    <h1 class="board-title">Community Forums</h1>
  </div>

  <!-- Classic Forum Header Info Bar -->
  <div class="board-top-bar glass">
    <div class="server-time">
      <span class="clock-icon">🕒</span> It is currently <strong>{currentTime}</strong>
    </div>
    <div class="quick-nav-links">
      {#if auth.isLoggedIn}
        <a href="/new-posts" class="quick-link">View unread posts</a>
        <span class="sep">•</span>
        <a href="/search?filter=my_posts" class="quick-link">View your posts</a>
        {#if hasUnread}
          <span class="sep">•</span>
          <button class="btn-link" onclick={markAllForumsRead} disabled={markingAllRead}>
            {markingAllRead ? 'Marking...' : 'Mark all forums read'}
          </button>
        {/if}
      {:else}
        <a href="/new-posts" class="quick-link">View latest posts</a>
      {/if}
    </div>
  </div>

  {#if loading}
    <div class="skeleton-loading">
      {#each [1, 2, 3] as _}
        <div class="skeleton-category">
          <Skeleton width="220px" height="26px" rounded />
          <div class="skeleton-table">
            {#each [1, 2, 3] as __}
              <div class="skeleton-row">
                <Skeleton width="55%" height="16px" />
                <Skeleton width="40%" height="12px" />
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <!-- Structured Category & Forum Blocks -->
    <div class="categories-list">
      {#each categories as category (category.id)}
        <div class="category-block">
          <div class="category-header" style="border-left-color: {category.color || 'var(--primary-color)'}">
            <div class="category-title-group">
              <span class="cat-icon">{category.icon || '📂'}</span>
              <h2 class="category-name">{category.name}</h2>
              {#if category.description}
                <span class="category-desc">{category.description}</span>
              {/if}
            </div>
            <button
              class="cat-collapse-btn" aria-label={collapsedCategories[category.id] ? 'Expand Category' : 'Collapse Category'} aria-expanded={!collapsedCategories[category.id]}
              onclick={() => toggleCategory(category.id)}
              title={collapsedCategories[category.id] ? 'Expand Category' : 'Collapse Category'}
            >
              {collapsedCategories[category.id] ? '[+]' : '[-]'}
            </button>
          </div>

          {#if !collapsedCategories[category.id]}
            <table class="forum-table">
              <thead>
                <tr class="forum-table-header">
                  <th style="width: 52%">Forum</th>
                  <th class="stat-col">Topics</th>
                  <th class="stat-col">Posts</th>
                  <th style="width: 28%">Last Post</th>
                </tr>
              </thead>
              <tbody>
                {#each category.forums as forum (forum.id)}
                  {@const isUnread = (unreadCounts[forum.id] ?? 0) > 0}
                  <tr class="forum-table-row" class:has-unread={isUnread}>
                    <!-- Forum Info Column -->
                    <td class="forum-info-cell">
                      <div class="forum-info">
                        <div
                          class="forum-icon"
                          class:unread-folder={isUnread}
                          title={isUnread ? 'Unread posts in this board' : 'No unread posts'}
                          style="color: {isUnread ? (category.color || 'var(--primary-color)') : 'var(--text-muted)'}"
                        >
                          {isUnread ? '📁' : '📂'}
                        </div>
                        <div class="forum-details">
                          <a href="/forums/{forum.slug}" class="forum-title-link">
                            {forum.name}
                            {#if isUnread}
                              <span class="unread-pill">{unreadCounts[forum.id]} new</span>
                            {/if}
                          </a>
                          {#if forum.description}
                            <p class="forum-desc-text">{forum.description}</p>
                          {/if}
                          {#if forum.children?.length}
                            <div class="subforums-box">
                              <span class="subforums-title">Sub-forums:</span>
                              {#each forum.children as child, i}
                                <a href="/forums/{child.slug}" class="subforum-link">
                                  <span class="subforum-bullet">↳</span> {child.name}
                                </a>{#if i < forum.children.length - 1}<span class="subforum-comma">, </span>{/if}
                              {/each}
                            </div>
                          {/if}
                        </div>
                      </div>
                    </td>

                    <!-- Statistics Columns -->
                    <td class="stat-cell">
                      <div class="count-value">{forum.thread_count.toLocaleString()}</div>
                      <div class="count-label">Topics</div>
                    </td>
                    <td class="stat-cell">
                      <div class="count-value">{forum.post_count.toLocaleString()}</div>
                      <div class="count-label">Posts</div>
                    </td>

                    <!-- Last Post Column -->
                    <td class="lastpost-cell">
                      {#if forum.last_post_at}
                        <div class="lastpost-container">
                          {#if forum.last_post_thread_title}
                            <a
                              href="/threads/{forum.last_post_thread_slug || forum.slug}"
                              class="lastpost-thread-title"
                              title={forum.last_post_thread_title}
                            >
                              {forum.last_post_thread_title}
                            </a>
                          {/if}
                          <div class="lastpost-meta">
                            <span class="lastpost-time">{timeAgo(forum.last_post_at)}</span>
                            {#if forum.last_post_user}
                              <span class="lastpost-author">
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
                        </div>
                      {:else}
                        <span class="no-posts-text">No posts yet</span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Bottom phpBB/vBulletin Board Statistics & Who Is Online -->
    <div class="board-footer-sections">
      <!-- Who is Online Section -->
      <div class="classic-box">
        <div class="classic-box-header">
          <span class="box-icon">👥</span> Who is Online
        </div>
        <div class="classic-box-body">
          <WhosOnline />
        </div>
      </div>

      <!-- Today's Board Statistics -->
      <div class="classic-box">
        <div class="classic-box-header">
          <span class="box-icon">📊</span> Board Statistics
        </div>
        <div class="classic-box-body">
          <TodaysStats stats={welcomeStats} />
        </div>
      </div>

      <!-- Classic Icon Legend -->
      <div class="icon-legend-bar glass">
        <div class="legend-item">
          <span class="legend-icon" style="color: var(--primary-color)">📁</span> New posts
        </div>
        <div class="legend-item">
          <span class="legend-icon" style="color: var(--text-muted)">📂</span> No new posts
        </div>
        <div class="legend-item">
          <span class="legend-icon">🔒</span> Forum is locked
        </div>
        <div class="all-times-note">
          All times are UTC
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .board-container {
    max-width: 1300px;
    margin: 0 auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .board-header {
    margin: 4px 0 2px 0;
  }
  .board-title {
    font-size: 24px;
    font-weight: 800;
    color: var(--text-heading);
    letter-spacing: -0.02em;
    margin: 0;
  }

  .board-top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
  }

  .clock-icon {
    margin-right: 4px;
  }

  .quick-nav-links {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .quick-link {
    color: var(--primary-color);
    text-decoration: none;
    font-weight: 500;
  }

  .quick-link:hover {
    text-decoration: underline;
  }

  .btn-link {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
    padding: 0;
  }

  .btn-link:hover {
    color: var(--primary-color);
    text-decoration: underline;
  }

  .sep {
    color: var(--border-color);
  }

  .categories-list {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .category-block {
    background: var(--bg-card, #1a1d24);
    border-radius: 8px;
    border: 1px solid var(--border-color, #2b303c);
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .category-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: linear-gradient(180deg, var(--bg-card-header, #242935) 0%, var(--bg-card, #1c202a) 100%);
    border-left: 4px solid var(--primary-color);
    border-bottom: 1px solid var(--border-color);
  }

  .category-title-group {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .cat-icon {
    font-size: 18px;
  }

  .category-name {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: var(--text-primary, #ffffff);
    letter-spacing: 0.3px;
  }

  .category-desc {
    font-size: 12px;
    color: var(--text-secondary, #94a3b8);
    font-weight: 400;
    margin-left: 8px;
  }

  .cat-collapse-btn {
    background: none;
    border: none;
    color: var(--text-muted, #64748b);
    font-family: monospace;
    font-size: 14px;
    font-weight: bold;
    cursor: pointer;
    padding: 2px 6px;
  }

  .cat-collapse-btn:hover {
    color: var(--text-primary);
  }

  /* Forum Table */
  .forum-table {
    width: 100%;
    border-collapse: collapse;
  }

  .forum-table-header th {
    background: var(--bg-dark, #13161c);
    padding: 8px 14px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 700;
    color: var(--text-secondary, #94a3b8);
    border-bottom: 1px solid var(--border-color);
    text-align: left;
  }

  .stat-col {
    width: 85px;
    text-align: center !important;
  }

  .forum-table-row {
    border-bottom: 1px solid var(--border-color, #232834);
    transition: background 0.15s ease;
  }

  .forum-table-row:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.03));
  }

  .forum-table-row.has-unread {
    background: rgba(var(--primary-rgb, 99, 102, 241), 0.04);
  }

  .forum-info-cell {
    padding: 12px 16px;
  }

  .forum-info {
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }

  .forum-icon {
    font-size: 26px;
    line-height: 1;
    margin-top: 2px;
    user-select: none;
  }

  .forum-icon.unread-folder {
    filter: drop-shadow(0 0 6px var(--primary-color));
  }

  .forum-details {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .forum-title-link {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary, #ffffff);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .forum-title-link:hover {
    color: var(--primary-color, #6366f1);
    text-decoration: underline;
  }

  .unread-pill {
    background: var(--primary-color, #6366f1);
    color: #ffffff;
    font-size: 10px;
    font-weight: bold;
    padding: 2px 7px;
    border-radius: 10px;
    text-transform: uppercase;
  }

  .forum-desc-text {
    margin: 0;
    font-size: 13px;
    color: var(--text-secondary, #94a3b8);
    line-height: 1.4;
  }

  .subforums-box {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .subforums-title {
    font-weight: 700;
    color: var(--text-primary);
    margin-right: 4px;
  }

  .subforum-bullet {
    color: var(--primary-color);
  }

  .subforum-link {
    color: var(--text-secondary);
    text-decoration: none;
  }

  .subforum-link:hover {
    color: var(--primary-color);
    text-decoration: underline;
  }

  .stat-cell {
    padding: 12px 10px;
    text-align: center;
    vertical-align: middle;
  }

  .count-value {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .count-label {
    font-size: 11px;
    color: var(--text-muted, #64748b);
    text-transform: uppercase;
  }

  .lastpost-cell {
    padding: 12px 16px;
    vertical-align: middle;
  }

  .lastpost-container {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .lastpost-thread-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--primary-color, #6366f1);
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 280px;
  }

  .lastpost-thread-title:hover {
    text-decoration: underline;
  }

  .lastpost-meta {
    font-size: 12px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .no-posts-text {
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
  }

  /* Board Footer Sections */
  .board-footer-sections {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-top: 10px;
  }

  .classic-box {
    background: var(--bg-card, #1a1d24);
    border-radius: 8px;
    border: 1px solid var(--border-color);
    overflow: hidden;
  }

  .classic-box-header {
    padding: 10px 16px;
    background: var(--bg-card-header, #242935);
    border-bottom: 1px solid var(--border-color);
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .classic-box-body {
    padding: 16px;
  }

  .icon-legend-bar {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .legend-icon {
    font-size: 16px;
  }

  .all-times-note {
    margin-left: auto;
    font-style: italic;
    color: var(--text-muted);
  }

  /* Skeleton Loading */
  .skeleton-loading {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .skeleton-category {
    background: var(--bg-card);
    border-radius: 8px;
    border: 1px solid var(--border-color);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .skeleton-table {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .skeleton-row {
    display: flex;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid var(--border-color);
  }

  @media (max-width: 768px) {
    .board-top-bar {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }

    .stat-col, .stat-cell {
      display: none;
    }

    .icon-legend-bar {
      flex-wrap: wrap;
      gap: 12px;
    }

    .all-times-note {
      margin-left: 0;
      width: 100%;
    }
  }
</style>
