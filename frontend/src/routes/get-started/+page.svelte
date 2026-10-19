<script lang="ts">
  import { untrack } from 'svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { onboarding } from '$lib/stores/onboarding.svelte';
  import { api } from '$lib/api/client';
  let forums = $state<any[]>([]);
  let selectedForum = $state('');
  let threads = $state<any[]>([]);
  let resourceError = $state('');
  let resourceLoading = $state(false);
  let loadedFor = '';
  let resourceId = 0;
  const steps = [
    {id: 'explore', title: 'Find your first discussion', description: 'Choose a forum below and open a topic that interests you. You can browse before posting.'},
    {id: 'follow', title: 'Keep a discussion close', description: 'Open a topic and use its notification controls to watch or track replies. You can change this at any time.'},
    {id: 'introduce', title: 'Say hello when you are ready', description: 'Add a display name or avatar to your profile, then introduce yourself in a suitable forum. Posting is optional.'},
    {id: 'live', title: 'Explore a live room', description: 'See who is around. Preview your microphone and camera before joining; you can join muted. Joining a call is optional.'}
  ];
  let reviewed = $derived(onboarding.owner === auth.user?.id ? onboarding.state?.reviewed_steps || [] : []);
  let current = $derived(steps.find(step => !reviewed.includes(step.id)) || steps[3]);
  $effect(() => {
    const id = auth.user?.id;
    if (id) untrack(() => { void onboarding.load(id); if (loadedFor !== id) { loadedFor = id; void loadForums(); } });
  });
  async function change(action: Record<string, string>) { if (auth.user) { try { await onboarding.change(auth.user.id, action); } catch { /* store presents error */ } } }
  async function loadForums() {
    const id = ++resourceId; resourceLoading = true; resourceError = '';
    try {
      const data = await api.getForums();
      if (id !== resourceId) return;
      forums = (data.categories || []).flatMap((category: any) => category.forums || []);
      selectedForum = forums[0]?.slug || '';
      await loadThreads(selectedForum);
    } catch { if (id === resourceId) resourceError = 'Discussions could not be loaded. You can still open Forums or retry.'; }
    finally { if (id === resourceId) resourceLoading = false; }
  }
  let threadRequest = 0;
  async function loadThreads(slug: string) {
    const id = ++threadRequest; threads = [];
    if (!slug) return;
    try { const data = await api.getForumThreads(slug); if (id === threadRequest) threads = data.threads || []; }
    catch { if (id === threadRequest) resourceError = 'Topics are unavailable. Open the forum or try again.'; }
  }
</script>

<section class="guide" aria-labelledby="guide-title">
  <h1 id="guide-title">Find your place in ForgeNexus</h1>
  <p>A short, optional guide to discussions, introductions, and live rooms. Your reviewed steps save to your account.</p>
  {#if auth.loading}<p role="status">Loading your account…</p>
  {:else if !auth.isLoggedIn}<p><a href="/auth/login">Sign in</a> or <a href="/auth/register">create an account</a> to save your progress. You can also <a href="/forums">browse forums</a> now.</p>
  {:else if onboarding.loading}<p role="status">Loading your guide…</p>
  {:else}
    {#if onboarding.error}<p role="alert">{onboarding.error}</p><button onclick={() => auth.user && onboarding.load(auth.user.id, true)}>Retry loading guide</button>{/if}
    {#if onboarding.state && onboarding.owner === auth.user?.id}
      {#if !auth.user?.email_verified}<p class="notice">Check your verification email before posting, following discussions, or joining live rooms. You can explore and review this guide now.</p>{/if}
      {#if onboarding.state.status === 'not_started' || onboarding.state.status === 'paused'}
        <h2>{onboarding.state.status === 'paused' ? 'Welcome back' : 'Start with the basics'}</h2>
        <button disabled={onboarding.saving} onclick={() => change({action: 'start'})}>{onboarding.state.status === 'paused' ? 'Resume guide' : 'Start guide'}</button>
      {:else if onboarding.state.status === 'completed'}
        <h2>Guide reviewed — you are ready to explore</h2>
        <p>You can return here any time. Your profile, posts, and call participation are always your choice.</p>
        <a href="/forums">Explore discussions</a> · <a href="/chat">Open chat</a>
        <button disabled={onboarding.saving} onclick={() => change({action: 'restart'})}>Review guide again</button>
      {:else}
        <p role="status">{reviewed.length} of 4 steps reviewed</p>
        <progress value={reviewed.length} max="4" aria-label="Guide steps reviewed"></progress>
        <ol class="steps">
          {#each steps as step}<li class:reviewed={reviewed.includes(step.id)} aria-current={current.id === step.id && !reviewed.includes(step.id) ? 'step' : undefined}>{reviewed.includes(step.id) ? '✓ ' : ''}{step.title}</li>{/each}
        </ol>
        {#if reviewed.length < 4}
          <article><h2>{current.title}</h2><p>{current.description}</p>
            {#if current.id === 'explore' || current.id === 'follow' || current.id === 'introduce'}
              {#if resourceLoading}<p role="status">Loading discussions…</p>{/if}
              {#if resourceError}<p role="alert">{resourceError}</p><button onclick={loadForums}>Retry discussions</button>{/if}
              {#if forums.length}
                <label>Choose a forum <select bind:value={selectedForum} onchange={() => { resourceError = ''; void loadThreads(selectedForum); }}>{#each forums as forum}<option value={forum.slug}>{forum.name}</option>{/each}</select></label>
                <a href={`/forums/${selectedForum}`}>Open selected forum</a>
                {#if current.id === 'introduce'} · <a href={`/forums/${selectedForum}/new`}>Write an introduction</a>{/if}
                <ul>{#each threads.slice(0, 5) as thread}<li><a href={`/threads/${thread.slug}`}>{thread.title}</a></li>{/each}</ul>
                {#if !threads.length && !resourceLoading}<p>No topics to suggest here yet. Explore the forum or choose another.</p>{/if}
              {:else if !resourceLoading}<p>No forums are available yet. You can continue with the guide.</p>{/if}
            {/if}
            {#if current.id === 'introduce'}<p><a href="/settings/profile">Personalize your profile</a></p>{/if}
            {#if current.id === 'live'}<p><a href="/live">Explore live rooms</a> · <a href="/chat">Prefer text? Open chat</a></p>{/if}
            <button disabled={onboarding.saving} onclick={() => change({action: 'review', step: current.id})}>Mark this step reviewed</button>
          </article>
        {:else}<button disabled={onboarding.saving} onclick={() => change({action: 'complete'})}>Finish guide</button>{/if}
      {/if}
      <div class="options">
        <label>Navigation view <select value={onboarding.state.navigation_mode} disabled={onboarding.saving} onchange={(e) => change({action: 'navigation', mode: e.currentTarget.value})}><option value="simple">Simple</option><option value="full">Full</option></select></label>
        {#if onboarding.state.status !== 'paused' && onboarding.state.status !== 'completed'}<button disabled={onboarding.saving} onclick={() => change({action: 'pause'})}>Do this later</button>{/if}
        <a href="/home">Go to community home</a>
      </div>
    {/if}
  {/if}
</section>
<style>
  .guide { max-width: 850px; margin: 24px auto; padding: 24px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius); }
  h1 { font-size: 28px; } h2 { font-size: 20px; margin: 16px 0 8px; } p { margin: 12px 0; line-height: 1.6; }
  .steps { display: grid; gap: 10px; padding-left: 24px; margin: 20px 0; } .reviewed { color: var(--text-secondary); }
  article { border-top: 1px solid var(--border-color); padding: 16px 0; }
  button, select { margin: 8px 8px 8px 0; padding: 10px; border: 1px solid var(--border-color); border-radius: var(--radius); background: var(--bg-input); color: var(--text-primary); }
  button { cursor: pointer; } button:disabled { opacity: .6; cursor: default; } label { display: block; } ul { padding-left: 24px; line-height: 2; }
  progress { width: 100%; accent-color: var(--accent); } .options { border-top: 1px solid var(--border-color); margin-top: 20px; } .notice { padding: 12px; background: var(--bg-secondary); }
  @media (max-width: 600px) { .guide { margin: 12px 0; padding: 16px; } h1 { font-size: 23px; } }
</style>
