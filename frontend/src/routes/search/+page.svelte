<script lang="ts">
  const a11yId = $props.id();
  import { untrack } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client';

  let query = $state('');
  let searchType = $state<'threads' | 'posts'>('threads');
  let authorFilter = $state('');
  let results = $state<any[]>([]);
  let total = $state(0);
  let currentPage = $state(1);
  let totalPages = $state(1);
  let fallback = $state(false);
  let resultType = $state('threads');
  let requestId = 0;
  let loading = $state(false);
  let searched = $state(false);
  let error = $state('');

  $effect(() => {
    const signature = $page.url.searchParams.toString();
    untrack(() => {
      const params = new URLSearchParams(signature);
      query = params.get('q') || '';
      searchType = params.get('type') === 'posts' ? 'posts' : 'threads';
      authorFilter = params.get('author') || '';
      currentPage = Math.max(1, Number(params.get('page')) || 1);
      void doSearch(params);
    });
  });

  async function doSearch(params: URLSearchParams) {
    const id = ++requestId;
    const q = (params.get('q') || '').trim();
    error = '';
    fallback = false;
    results = [];
    total = 0;
    totalPages = 1;
    searched = q.length >= 2;
    loading = searched;
    if (!searched) return;
    try {
      const data = await api.search(q, {
        type: params.get('type') || 'threads',
        page: Number(params.get('page')) || 1,
        author: params.get('author') || undefined,
        forum_id: params.get('forum_id') || undefined
      });
      if (id !== requestId) return;
      results = data.results || [];
      total = data.total || 0;
      totalPages = data.total_pages || 1;
      currentPage = data.page || 1;
      resultType = data.type || 'threads';
      fallback = data.fallback === true;
    } catch (err: any) {
      if (id !== requestId) return;
      error = err?.error || 'Search failed. Please try again.';
    } finally {
      if (id === requestId) loading = false;
    }
  }

  function goToPage(pg: number) {
    const params = new URLSearchParams($page.url.searchParams);
    params.set('page', String(pg));
    void goto(`/search?${params}`);
  }

  function handleSubmit() {
    const params = new URLSearchParams({ q: query.trim(), type: searchType });
    if (authorFilter.trim()) params.set('author', authorFilter.trim());
    const forum = $page.url.searchParams.get('forum_id');
    if (forum) params.set('forum_id', forum);
    if (params.toString() === $page.url.searchParams.toString()) void doSearch(params);
    else void goto(`/search?${params}`);
  }

  function timeAgo(dateStr: string | null): string {
    if (!dateStr) return '';
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(dateStr).toLocaleDateString();
  }
</script>

<div class="search-page">
  <h1 class="page-title">Search</h1>

  <form class="search-form" onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
    <div class="search-bar">
      <input
        type="text"
        bind:value={query}
        placeholder="Search threads, posts..."
        class="search-input"
        aria-label="Search query"
        maxlength="200"
        minlength="2"
      />
      <button type="submit" class="btn btn-primary" disabled={loading || query.length < 2}>
        {loading ? 'Searching...' : 'Search'}
      </button>
    </div>
    <div class="search-filters">
      <div class="filter-group">
        <label for={`${a11yId}-field-1`} class="filter-label">Type:</label>
        <select id={`${a11yId}-field-1`} bind:value={searchType} class="filter-select">
          <option value="threads">Threads</option>
          <option value="posts">Posts</option>
        </select>
      </div>
      <div class="filter-group">
        <label for={`${a11yId}-field-2`} class="filter-label">Author:</label>
        <input id={`${a11yId}-field-2`} type="text" bind:value={authorFilter} placeholder="username" class="filter-input" />
      </div>
    </div>
  </form>

  {#if fallback && !loading && !error}
    <p role="status">Showing basic search results.</p>
  {/if}

  {#if loading}
    <div class="loading">Searching...</div>
  {:else if error}
    <div class="error-box" role="alert">{error}</div>
  {:else if searched && results.length === 0}
    <div class="no-results">No results found for "{query}"</div>
  {:else if results.length > 0}
    <div class="results-header">
      <span class="results-count">{total} result{total !== 1 ? 's' : ''}</span>
    </div>

    <div class="results-list">
      {#each results as result (result.id)}
        <div class="result-item">
          <a href={result.url || `/threads/${result.slug}`} class="result-title">{result.title}</a>
          {#if resultType === 'posts'}<p class="result-excerpt">{result.excerpt}</p>{/if}
          <div class="result-meta">
            {#if result.forum}
              in <a href="/forums/{result.forum.slug}" class="result-forum">{result.forum.name}</a>
            {/if}
            {#if result.user}
              &middot; by <a href="/profile/{result.user.slug}" class="result-author">{result.user.username}</a>
            {/if}
            {#if resultType === 'threads'}&middot; {result.reply_count} replies &middot; {result.view_count} views{/if}
            &middot; {timeAgo(result.inserted_at)}
          </div>
        </div>
      {/each}
    </div>

    {#if totalPages > 1}
      <div class="pagination">
        <button class="pg-btn" disabled={currentPage <= 1} onclick={() => goToPage(currentPage - 1)}>&laquo; Prev</button>
        {#each Array.from({length: Math.min(totalPages, 10)}, (_, i) => {
          if (totalPages <= 10) return i + 1;
          const start = Math.max(1, Math.min(currentPage - 4, totalPages - 9));
          return start + i;
        }) as pg}
          <button class="pg-btn" class:active={pg === currentPage} onclick={() => goToPage(pg)}>{pg}</button>
        {/each}
        <button class="pg-btn" disabled={currentPage >= totalPages} onclick={() => goToPage(currentPage + 1)}>Next &raquo;</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .search-page { display: flex; flex-direction: column; gap: 16px; }
  .page-title { font-size: 20px; font-weight: 800; color: var(--text-primary); }

  .search-form { display: flex; flex-direction: column; gap: 10px; }
  .search-bar { display: flex; gap: 8px; }
  .search-input {
    flex: 1; padding: 10px 14px; border: 1px solid var(--border-color);
    border-radius: var(--radius); background: var(--bg-input); color: var(--text-primary);
    font-size: 14px;
  }
  .search-input:focus { border-color: var(--accent); outline: none; }

  .search-filters { display: flex; gap: 16px; align-items: center; }
  .filter-group { display: flex; align-items: center; gap: 6px; }
  .filter-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
  .filter-select, .filter-input {
    padding: 4px 8px; border: 1px solid var(--border-color); border-radius: var(--radius);
    background: var(--bg-input); color: var(--text-primary); font-size: 12px;
  }
  .filter-input { width: 120px; }

  .btn { padding: 8px 20px; border-radius: var(--radius); font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
  .btn-primary { background: var(--accent); color: var(--bg-primary); }
  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn:disabled { opacity: 0.5; cursor: default; }

  .results-header { font-size: 13px; color: var(--text-secondary); }
  .results-count { font-weight: 600; }

  .results-list { display: flex; flex-direction: column; gap: 4px; }
  .result-item {
    padding: 10px 14px; background: var(--bg-card);
    border: 1px solid var(--border-color); border-radius: var(--radius);
  }
  .result-title { font-size: 14px; font-weight: 700; color: var(--text-link); display: block; }
  .result-excerpt { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 6px; }
  .result-meta { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
  .result-forum { color: var(--text-secondary); }
  .result-author { color: var(--text-secondary); }

  .no-results, .loading { text-align: center; padding: 40px 0; color: var(--text-muted); font-size: 14px; }

  .pagination { display: flex; gap: 4px; justify-content: center; padding: 12px 0; }
  .pg-btn { padding: 6px 12px; border: 1px solid var(--border-color); border-radius: var(--radius); background: var(--bg-card); color: var(--text-secondary); font-size: 12px; cursor: pointer; }
  .pg-btn.active { background: var(--accent); color: var(--bg-primary); border-color: var(--accent); }
  .pg-btn:disabled { opacity: 0.4; cursor: default; }
  .pg-btn:hover:not(:disabled):not(.active) { background: var(--bg-hover); }
</style>
