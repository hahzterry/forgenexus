<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  let wrapper = $state<HTMLSpanElement>();
  let { children, username, slug, avatarUrl, postCount = 0, reputation = 0, customTitle, isOnline = false }: {
    children: Snippet; username: string; slug: string; avatarUrl?: string | null;
    postCount?: number; reputation?: number; customTitle?: string | null; isOnline?: boolean;
  } = $props();

  let show = $state(false);
  let timeout: ReturnType<typeof setTimeout>;

  function enter() { clearTimeout(timeout); timeout = setTimeout(() => show = true, 400); }
  function leave() { clearTimeout(timeout); if (!wrapper?.contains(document.activeElement)) show = false; }
  onDestroy(() => clearTimeout(timeout));
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape' && show) { clearTimeout(timeout); wrapper?.querySelector('a')?.focus(); show = false; } }} />

<span bind:this={wrapper} role="group" aria-label={`${username} profile preview`} onfocusin={() => { clearTimeout(timeout); show = true; }} onfocusout={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { clearTimeout(timeout); show = false; } }} class="hover-card-wrapper" onmouseenter={enter} onmouseleave={leave}>
  {@render children()}

  {#if show}
    <div class="hover-card">
      <div class="hc-header">
        <div class="hc-avatar">
          {#if avatarUrl}<img src={avatarUrl} alt={username} />{:else}<span>{username.charAt(0).toUpperCase()}</span>{/if}
        </div>
        <div class="hc-info">
          <a href="/profile/{slug}" class="hc-name">{username}</a>
          {#if customTitle}<div class="hc-title">{customTitle}</div>{/if}
          <div class="hc-status">
            <span class="hc-dot" class:online={isOnline}></span>
            {isOnline ? 'Online' : 'Offline'}
          </div>
        </div>
      </div>
      <div class="hc-stats">
        <div class="hc-stat"><strong>{postCount}</strong> posts</div>
        <div class="hc-stat"><strong>{reputation}</strong> rep</div>
      </div>
      <a href="/profile/{slug}" class="hc-link">View Profile</a>
    </div>
  {/if}
</span>

<style>
  .hover-card-wrapper { position: relative; display: inline; }
  .hover-card {
    position: absolute; bottom: 100%; left: 0; z-index: 60;
    background: var(--bg-card); border: 1px solid var(--border-color);
    border-radius: var(--radius-lg); box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    padding: 12px; min-width: 220px; margin-bottom: 8px;
  }
  .hc-header { display: flex; gap: 10px; margin-bottom: 8px; }
  .hc-avatar {
    width: 40px; height: 40px; border-radius: var(--radius); background: var(--bg-tertiary);
    display: flex; align-items: center; justify-content: center; overflow: hidden;
    font-size: 16px; font-weight: 700; color: var(--text-muted); flex-shrink: 0;
  }
  .hc-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .hc-name { font-size: 14px; font-weight: 700; color: var(--text-link); }
  .hc-title { font-size: 11px; color: var(--accent); }
  .hc-status { font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 4px; }
  .hc-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--offline); }
  .hc-dot.online { background: var(--online); }
  .hc-stats { display: flex; gap: 12px; padding: 6px 0; border-top: 1px solid var(--border-color); font-size: 12px; color: var(--text-secondary); }
  .hc-stat strong { color: var(--text-primary); }
  .hc-link { display: block; text-align: center; font-size: 12px; color: var(--accent); margin-top: 6px; }
</style>
