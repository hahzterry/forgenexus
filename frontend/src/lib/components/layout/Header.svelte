<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/stores';
  import { afterNavigate } from '$app/navigation';
  import { onboarding } from '$lib/stores/onboarding.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import NotificationBell from '$lib/components/layout/NotificationBell.svelte';
  import StatusSelector from '$lib/components/layout/StatusSelector.svelte';
  import { notificationStore } from '$lib/stores/notifications.svelte';
  import { api } from '$lib/api/client';

  let moreOpen = $state(false);
  let mobileMoreOpen = $state(false);
  let simpleNav = $derived(!auth.isLoggedIn || onboarding.owner !== auth.user?.id || onboarding.state?.navigation_mode !== 'full');
  let primary = $derived([{href:auth.isLoggedIn ? '/home' : '/',label:'Home'},{href:'/forums',label:'Forums'},{href:'/chat',label:'Chat'},{href:'/live',label:'Live'},{href:'/search',label:'Search'}]);
  let extra = $derived([
    {href:'/discover',label:'Discover'},{href:'/trending',label:'Trending'},
    {href:'/new-posts',label:'New posts'},{href:'/members',label:'Members'},
    {href:'/marketplace',label:'Market'},{href:'/stats',label:'Stats'},
    ...(auth.isLoggedIn ? [{href:'/messages',label:'Messages'},{href:'/following',label:'Following'},{href:'/creator',label:'Creator'},{href:'/settings',label:'Settings'},{href:'/get-started',label:'Get started'}] : []),
    ...(auth.isStaff ? [{href:'/mod',label:'Mod'},{href:'/admin',label:'Admin'},{href:'/admin/plugins',label:'Plugins'}] : [])
  ]);
  function current(href: string) { return $page.url.pathname === href || (href !== '/' && $page.url.pathname.startsWith(href + '/')); }
  $effect(() => { const id = auth.user?.id; if (id) untrack(() => { void onboarding.load(id); }); else if (!auth.loading) onboarding.reset(); });
  afterNavigate(() => closeMobileMenu());
  async function toggleNavigation() {
    if (!auth.user) return;
    try { await onboarding.change(auth.user.id, {action:'navigation',mode:simpleNav?'full':'simple'}); }
    catch { /* guide store displays save errors */ }
  }
  let mobileMenuOpen = $state(false);
  let liveCount = $state(0);
  let liveUserCount = $state(0);
  let livePollTimer: ReturnType<typeof setInterval> | null = null;

  async function refreshLive() {
    try {
      const data = await api.getVoiceRooms();
      const rooms = data.rooms || [];
      liveCount = rooms.filter((r: any) => (r.participant_count ?? 0) > 0).length;
      liveUserCount = rooms.reduce((n: number, r: any) => n + (r.participant_count ?? 0), 0);
    } catch { /* silent */ }
  }

  $effect(() => {
    if (auth.isLoggedIn) {
      refreshLive();
      livePollTimer = setInterval(refreshLive, 20000);
    }
    return () => {
      if (livePollTimer) clearInterval(livePollTimer);
      livePollTimer = null;
    };
  });
  let lightMode = $state(typeof localStorage !== 'undefined' && localStorage.getItem('fn-light-mode') === '1');

  $effect(() => {
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('light-mode', lightMode);
      localStorage.setItem('fn-light-mode', lightMode ? '1' : '0');
    }
  });

  function toggleTheme() {
    lightMode = !lightMode;
  }

  $effect(() => {
    if (auth.isLoggedIn) {
      notificationStore.startPolling();
    }
    return () => notificationStore.stopPolling();
  });

  function closeMobileMenu() {
    mobileMenuOpen = false; moreOpen = false; mobileMoreOpen = false;
  }
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') closeMobileMenu(); }} />

<header class="site-header">
  {#if onboarding.error && auth.isLoggedIn && $page.url.pathname !== '/get-started'}<p class="navigation-error" role="alert">{onboarding.error} <a href="/get-started">Open guide to retry</a></p>{/if}
  <div class="header-inner">
    <a href={auth.isLoggedIn ? "/home" : "/"} class="logo">
      <span class="logo-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="m12 2.8 8 4.6v9.2l-8 4.6-8-4.6V7.4l8-4.6Z" />
          <path d="m8.5 14.8 2.2-5.6 2.2 5.6m-3.4-1.8h2.5m3-3.8v5.6" />
        </svg>
      </span>
      <span class="logo-text">Forge<span class="accent">Nexus</span></span>
    </a>

    <nav class="main-nav" class:compact={simpleNav} aria-label="Main navigation">
      {#each primary as item}
        <a href={item.href} aria-current={current(item.href) ? 'page' : undefined} class:live-link={item.href === '/live'} class:active={item.href === '/live' && liveCount > 0}>
          {item.label}{#if item.href === '/live' && liveCount > 0}<span class="live-dot"></span><strong>{liveUserCount}</strong>{/if}
        </a>
      {/each}
      {#if !simpleNav}
        {#each extra as item}<a href={item.href} aria-current={current(item.href) ? 'page' : undefined}>{item.label}</a>{/each}
        <button class="navigation-switch" disabled={onboarding.saving} onclick={toggleNavigation}>Use simpler navigation</button>
      {:else}
        <details class="nav-more" bind:open={moreOpen}>
          <summary>More</summary><div class="more-links">
            {#each extra as item}<a href={item.href} aria-current={current(item.href) ? 'page' : undefined}>{item.label}</a>{/each}
            {#if auth.isLoggedIn}<button disabled={onboarding.loading || onboarding.saving || !onboarding.state} onclick={toggleNavigation}>Show full navigation</button>{/if}
          </div>
        </details>
      {/if}
    </nav>

    <div class="header-right">
      <button class="theme-toggle" onclick={toggleTheme} aria-label="Toggle theme" title={lightMode ? 'Switch to dark mode' : 'Switch to light mode'}>
        {#if lightMode}&#9788;{:else}&#9790;{/if}
      </button>
      {#if auth.isLoggedIn}
        <div class="user-menu" aria-label="User menu">
          <NotificationBell />
          <StatusSelector />
          <a href="/profile/{auth.user?.slug}" class="user-link">
            <span class="username">{auth.user?.username}</span>
          </a>
          <button class="btn" onclick={() => auth.logout()}>Logout</button>
        </div>
      {:else}
        <a href="/auth/login" class="btn">Login</a>
        <a href="/auth/register" class="btn btn-primary">Register</a>
      {/if}
    </div>

    <button
      class="mobile-toggle"
      aria-label="Toggle menu"
      aria-controls="site-navigation-menu"
      aria-expanded={mobileMenuOpen}
      onclick={() => mobileMenuOpen = !mobileMenuOpen}
    >
      <span class="hamburger-line"></span>
      <span class="hamburger-line"></span>
      <span class="hamburger-line"></span>
    </button>
  </div>

  {#if mobileMenuOpen}
    <button class="mobile-backdrop" onclick={closeMobileMenu} aria-hidden="true"></button>
  {/if}

  <nav
    class="mobile-menu"
    id="site-navigation-menu"
    class:open={mobileMenuOpen}
    aria-label="Mobile navigation"
  >
    {#each primary as item}<a href={item.href} onclick={closeMobileMenu} aria-current={current(item.href) ? 'page' : undefined}>{item.label}</a>{/each}
    <details class="mobile-more" bind:open={mobileMoreOpen}>
      <summary>More destinations</summary>
      {#each extra as item}<a href={item.href} onclick={closeMobileMenu} aria-current={current(item.href) ? 'page' : undefined}>{item.label}</a>{/each}
      {#if auth.isLoggedIn}<button class="mobile-menu-btn" disabled={onboarding.loading || onboarding.saving || !onboarding.state} onclick={toggleNavigation}>{simpleNav ? 'Show full navigation' : 'Use simpler navigation'}</button>{/if}
    </details>

    <div class="mobile-menu-divider"></div>

    <button class="mobile-menu-btn" onclick={toggleTheme}>
      <span class="mobile-user-icon">{lightMode ? '☀' : '☾'}</span> {lightMode ? 'Dark Mode' : 'Light Mode'}
    </button>

    {#if auth.isLoggedIn}
      <a href="/profile/{auth.user?.slug}" onclick={closeMobileMenu}>
        <span class="mobile-user-icon">👤</span> {auth.user?.username}
      </a>
      <button class="mobile-menu-btn" onclick={() => { auth.logout(); closeMobileMenu(); }}>
        <span class="mobile-user-icon">➜</span> Logout
      </button>
    {:else}
      <a href="/auth/login" onclick={closeMobileMenu}>Login</a>
      <a href="/auth/register" onclick={closeMobileMenu}>Register</a>
    {/if}
  </nav>
</header>

<style>
  .navigation-error { padding: 8px 16px; font-size: 12px; }
  .main-nav.compact { overflow: visible; }
  .nav-more { position: relative; align-self: center; }
  .nav-more summary, .navigation-switch { padding: 8px 11px; color: var(--text-secondary); font-size: 12px; cursor: pointer; border: none; background: transparent; white-space: nowrap; }
  .more-links { position: absolute; top: 100%; right: 0; width: 220px; max-height: 70vh; overflow-y: auto; display: grid; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius); padding: 8px; box-shadow: 0 8px 24px #0004; }
  .more-links button { padding: 8px; cursor: pointer; }
  .mobile-more { width: 100%; } .mobile-more summary { padding: 14px 20px; cursor: pointer; color: var(--text-secondary); }
  .main-nav a[aria-current="page"], .mobile-menu a[aria-current="page"] { color: var(--accent); background: var(--bg-hover); }

  .site-header {
    background: var(--glass-bg);
    border-bottom: 1px solid var(--border-color);
    position: sticky;
    top: 0;
    z-index: 100;
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  .header-inner {
    max-width: 1420px;
    margin: 0 auto;
    padding: 0 28px;
    height: 68px;
    display: flex;
    align-items: center;
    gap: 22px;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 17px;
    font-weight: 800;
    letter-spacing: -.04em;
    color: var(--text-primary);
    text-decoration: none;
  }
  .logo .accent {
    color: var(--accent);
  }
  .logo-icon {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border-radius: 11px;
    background: linear-gradient(145deg, #72efca, #29b99c);
    color: #07130f;
    box-shadow: 0 5px 20px rgba(44, 170, 142, .2);
  }
  .logo-icon svg { width: 20px; height: 20px; }

  .main-nav {
    min-width: 0;
    overflow-x: auto;
    white-space: nowrap;
    display: flex;
    gap: 3px;
  }
  .main-nav a {
    padding: 8px 11px;
    border-radius: 9px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-decoration: none;
    transition: all 0.15s;
  }
  .main-nav a:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .main-nav a[href="/"] { position: relative; }
  .main-nav a[href="/"]:hover::after { content: ''; position: absolute; left: 11px; right: 11px; bottom: 2px; height: 2px; border-radius: 2px; background: var(--accent); }
  .main-nav :global(.mod-link) {
    color: #fbbf24;
    font-weight: 600;
  }
  .main-nav :global(.live-link) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .main-nav :global(.live-link.active) {
    color: #f87171;
    background: rgba(248, 113, 113, 0.08);
    font-weight: 700;
  }
  .main-nav :global(.live-link.active strong) {
    font-variant-numeric: tabular-nums;
  }
  :global(.live-dot) {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #f87171;
    box-shadow: 0 0 0 0 rgba(248, 113, 113, 0.6);
    animation: header-live-pulse 1.6s ease-out infinite;
    display: inline-block;
  }
  @keyframes header-live-pulse {
    0% { box-shadow: 0 0 0 0 rgba(248, 113, 113, 0.7); }
    70% { box-shadow: 0 0 0 6px rgba(248, 113, 113, 0); }
    100% { box-shadow: 0 0 0 0 rgba(248, 113, 113, 0); }
  }

  .header-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-right :global(.btn) { min-height: 36px; padding: 0 13px; border-radius: 9px; font-size: 12px; font-weight: 700; }
  .header-right :global(.btn-primary) { color: var(--on-accent); background: var(--accent); border-color: transparent; }
  .header-right :global(.btn-primary:hover) { background: var(--accent-hover); color: var(--on-accent); }

  .user-menu {
    display: flex;
    align-items: center;
    gap: 12px;
  }


  .theme-toggle {
    background: none;
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    cursor: pointer;
    color: var(--text-secondary);
    transition: all 0.15s;
  }
  .theme-toggle:hover {
    background: var(--bg-tertiary);
    color: var(--accent);
    border-color: var(--accent);
  }

  .user-link {
    font-weight: 600;
    font-size: 13px;
  }

  /* Mobile toggle button */
  .mobile-toggle {
    display: none;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 8px;
    margin-left: auto;
  }

  .hamburger-line {
    display: block;
    width: 20px;
    height: 2px;
    background: var(--text-primary);
    border-radius: 1px;
    transition: transform 0.2s, opacity 0.2s;
  }

  /* Mobile backdrop overlay */
  .mobile-backdrop {
    display: none;
    position: fixed;
    inset: 0;
    top: 68px;
    background: rgba(0, 0, 0, 0.5);
    border: none;
    z-index: 98;
    cursor: default;
  }

  /* Mobile dropdown menu */
  .mobile-menu {
    display: none;
    flex-direction: column;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-color);
    overflow: hidden;
    max-height: 0;
    transition: max-height 0.3s ease;
  }

  .mobile-menu.open {
    /* Cap to viewport height so a long staff menu (Forums/Chat/Messages/Live/
       New Posts/Trending/Members/Stats/Search/Following/Mod/Plugins +
       theme/profile/logout) doesn't clip — scroll inside the menu instead. */
    max-height: calc(100dvh - 62px);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .mobile-menu a,
  .mobile-menu-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 48px;
    padding: 0 20px;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-secondary);
    text-decoration: none;
    border: none;
    background: none;
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }

  .mobile-menu a:hover,
  .mobile-menu-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .mobile-menu :global(.mod-link) {
    color: #fbbf24;
    font-weight: 600;
  }

  .mobile-menu-divider {
    height: 1px;
    background: var(--border-color);
    margin: 4px 16px;
  }

  .mobile-user-icon {
    font-size: 16px;
    width: 20px;
    flex-shrink: 0;
    text-align: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  @media (max-width: 1280px) {
    .main-nav {
      display: none;
    }

    .header-right {
      display: none;
    }

    .mobile-toggle {
      display: flex;
    }

    .mobile-backdrop {
      display: block;
    }

    .mobile-menu {
      display: flex;
      position: absolute;
      top: 68px;
      left: 0;
      right: 0;
      z-index: 99;
      border-bottom: 1px solid var(--border-color);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    }
  }

  @media (max-width: 1280px) {
    .header-inner { height: 62px; padding: 0 14px; }
    .mobile-backdrop { top: 62px; }
    .mobile-menu { top: 62px; }
  }
</style>
