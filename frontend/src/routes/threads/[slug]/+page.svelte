<script lang="ts">
  import { voiceSetup } from '$lib/stores/voiceSetup.svelte';
  import { modal } from '$lib/actions/modal';
  import { decoratePostHtml } from '$lib/forum/post-html';
  import { page } from '$app/stores';
  import { api } from '$lib/api/client';
  import Breadcrumb from '$lib/components/layout/Breadcrumb.svelte';
  import UsernameDisplay from '$lib/components/common/UsernameDisplay.svelte';
  import AvatarFrame from '$lib/components/common/AvatarFrame.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import ThreadModToolbar from '$lib/components/moderation/ThreadModToolbar.svelte';
  import PostModToolbar from '$lib/components/moderation/PostModToolbar.svelte';
  import ReportButton from '$lib/components/moderation/ReportButton.svelte';
  import FormattingToolbar from '$lib/components/editor/FormattingToolbar.svelte';
  import EmojiPicker from '$lib/components/editor/EmojiPicker.svelte';
  import SmiliesTray from '$lib/components/editor/SmiliesTray.svelte';
  import MentionAutocomplete from '$lib/components/editor/MentionAutocomplete.svelte';
  import UserHoverCard from '$lib/components/common/UserHoverCard.svelte';
  import { toast } from '$lib/stores/toast.svelte';
  import { socketStore } from '$lib/stores/socket.svelte';
  import { onDestroy } from 'svelte';
  import LinkPreview from "$lib/components/common/LinkPreview.svelte";
  import ForumPostingRules from '$lib/components/forum/ForumPostingRules.svelte';
  import { voiceStore } from '$lib/stores/voice.svelte';

  let currentThreadId: string | null = null;

  let thread = $state<any>(null);
  let posts = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let replyBody = $state('');
  let replying = $state(false);
  let subscription = $state<string | null>(null);
  let isMuted = $state(false);
  let currentPage = $state(1);
  let totalPages = $state(1);
  let allForums = $state<any[]>([]);

  // === Feature 4: Thread Search & Quick Page Jump ===
  let showThreadSearch = $state(false);
  let threadSearchQuery = $state('');
  let jumpPageVal = $state<number | string>('');

  let displayedPosts = $derived(
    threadSearchQuery.trim()
      ? posts.filter(p =>
          p.body?.toLowerCase().includes(threadSearchQuery.toLowerCase()) ||
          p.user?.username?.toLowerCase().includes(threadSearchQuery.toLowerCase())
        )
      : posts
  );

  function handlePageJump(targetPg?: number) {
    const pg = targetPg !== undefined ? targetPg : Number(jumpPageVal);
    if (!pg || isNaN(pg)) return;
    const clamped = Math.max(1, Math.min(totalPages, Math.floor(pg)));
    goToPage(clamped);
    jumpPageVal = '';
  }

  function clearThreadSearch() {
    threadSearchQuery = '';
    showThreadSearch = false;
  }

  // === Feature 2: Reputation / Karma System ===
  let repModalPost = $state<any>(null);
  let repAmount = $state(1);
  let repReason = $state('');
  let submittingRep = $state(false);

  function openRepModal(post: any) {
    repModalPost = post;
    repAmount = 1;
    repReason = '';
  }

  function getReputationMeta(rep: number): { count: number; color: string; label: string } {
    if (rep < 0) return { count: 1, color: '#ef4444', label: 'User has made a questionable impression' };
    if (rep < 10) return { count: 1, color: '#64748b', label: 'User is an unknown quantity' };
    if (rep < 50) return { count: 1, color: '#10b981', label: 'User is on a distinguished road' };
    if (rep < 100) return { count: 2, color: '#10b981', label: 'User will become famous soon enough' };
    if (rep < 250) return { count: 3, color: '#10b981', label: 'User has a spectacular aura' };
    if (rep < 500) return { count: 4, color: '#06b6d4', label: 'User is a beacon of light' };
    if (rep < 1000) return { count: 5, color: '#06b6d4', label: 'User is a legend of the community' };
    return { count: 5, color: '#f59e0b', label: 'Supreme Community Contributor' };
  }

  async function submitReputation() {
    if (!repModalPost || submittingRep) return;
    const recipient = repModalPost.user;
    const amount = repAmount;
    const reason = repReason;
    submittingRep = true;
    try {
      await api.request('/reputation', {
        method: 'POST',
        body: JSON.stringify({
          user_id: recipient.id,
          amount,
          reason: reason || 'Reputation for post'
        })
      });
      toast.success(`+${amount} reputation given to ${recipient.username}!`);
      posts = posts.map(p =>
        p.user.id === recipient.id
          ? { ...p, user: { ...p.user, reputation: (p.user.reputation || 0) + amount } }
          : p
      );
      if (repModalPost?.user.id === recipient.id) repModalPost = null;
    } catch (err: any) {
      toast.error(err?.error || 'Failed to give reputation');
    }
    submittingRep = false;
  }

  // Presence is community-wide; thread-specific guest counts are unavailable.
  let activeMembers = $derived(socketStore.onlineUsers || []);

  // === Feature 1: Thread Voice Lounge (Discord SFU WebRTC) ===
  let showVoiceDrawer = $state(false);
  let voiceRooms = $state<any[]>([]);
  let voiceConnecting = $state(false);
  let isVoiceConnected = $derived(voiceStore.isInRoom);

  async function toggleVoiceLounge() {
    if (!auth.isLoggedIn) {
      toast.error('Log in to join the voice lounge');
      return;
    }
    showVoiceDrawer = !showVoiceDrawer;
    if (showVoiceDrawer && voiceRooms.length === 0) {
      try {
        await voiceStore.loadRooms();
        voiceRooms = voiceStore.rooms;
      } catch { voiceRooms = []; }
    }
  }

  async function connectToVoiceRoom(roomId: string) {
    const socket = socketStore.getSocket();
    if (!socket || !socketStore.connected) {
      toast.error('Socket not connected');
      return;
    }
    if (voiceConnecting) return;
    voiceConnecting = true;
    try {
      const choice = await voiceSetup.choose(roomId);
      if (!choice) { voiceConnecting = false; return; }
      await voiceStore.joinRoom(roomId, socket, choice);
      if (voiceStore.activeRoom?.id !== roomId || !voiceStore.localStream) {
        await voiceStore.leaveRoom();
        throw new Error('Unable to join this voice room');
      }
      toast.success('Connected to Voice Lounge!');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to join voice lounge');
    }
    voiceConnecting = false;
  }

  function disconnectVoice() {
    voiceStore.leaveRoom();
    toast.success('Disconnected from voice lounge');
  }

  // Edit state
  let editingPostId = $state<string | null>(null);
  let editBody = $state('');
  let saving = $state(false);

  // Multi-quote
  let selectedQuotes = $state<Set<string>>(new Set());

  // Edit history
  let historyPostId = $state<string | null>(null);
  let editHistory = $state<any[]>([]);
  let loadingHistory = $state(false);

  // Textarea ref
  let replyTextarea = $state<HTMLTextAreaElement | null>(null);

  // Post preview
  let showPreview = $state(false);
  let previewHtml = $state('');
  let previewTimer: ReturnType<typeof setTimeout> | null = null;

  // Re-render the BBCode preview via the server whenever the user pauses
  // typing for 300ms. Single-source-of-truth with stored body_html.
  $effect(() => {
    if (!showPreview) return;
    const body = replyBody;
    if (previewTimer) clearTimeout(previewTimer);
    if (!body.trim()) { previewHtml = ''; return; }
    previewTimer = setTimeout(async () => {
      try {
        const data = await api.renderBbcode(body);
        previewHtml = data.html || '';
      } catch {
        previewHtml = escapeHtml(body);
      }
    }, 300);
  });

  // Post bookmarks
  let bookmarkedPostIds = $state<Set<string>>(new Set());

  // Post edit time limit (minutes, 0 = unlimited)
  let postEditTimeLimit = $state(60);

  // Draft auto-save
  let draftStatus = $state<'idle' | 'saving' | 'saved'>('idle');
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  let draftFadeTimer: ReturnType<typeof setTimeout> | null = null;
  // Thread rating state (Feature 4)
  let ratingStats = $state<{ average: number; count: number }>({ average: 0, count: 0 });
  let userRating = $state<number | null>(null);
  let ratingHover = $state<number | null>(null);
  let isRating = $state(false);

  async function loadThreadRating(threadId: string) {
    try {
      const data = await api.getThreadRating(threadId);
      if (thread?.id !== threadId) return;
      if (data?.rating) {
        ratingStats = data.rating;
      }
      if (data?.user_rating !== undefined) {
        userRating = data.user_rating;
      }
    } catch { /* ignore */ }
  }

  async function submitThreadRating(rating: number) {
    if (!auth.isLoggedIn) {
      toast.error('You must be logged in to rate threads');
      return;
    }
    if (!thread || isRating) return;
    const threadId = thread.id;
    isRating = true;
    try {
      const data = await api.rateThread(threadId, rating);
      if (thread?.id !== threadId) return;
      if (data?.rating) {
        ratingStats = data.rating;
      }
      userRating = rating;
      toast.success(`Rated this thread ${rating} star${rating > 1 ? 's' : ''}!`);
    } catch (err: any) {
      toast.error(err?.error || 'Failed to submit rating');
    }
    finally { isRating = false; }
  }


  $effect(() => {
    const slug = $page.params.slug;
    const pageParam = $page.url.searchParams.get('page');
    const pg = pageParam ? parseInt(pageParam, 10) : 1;
    if (slug) loadThread(slug, pg);
  });

  async function loadThread(slug: string, pg = 1) {
    loading = true;
    try {
      const [data, settingsData] = await Promise.all([
        api.getThread(slug, pg),
        api.getPublicSettings().catch(() => null)
      ]);
      const changedThread = thread?.id !== data.thread?.id;
      thread = data.thread;
      if (changedThread) {
        ratingStats = { average: 0, count: 0 };
        userRating = null;
        ratingHover = null;
        clearThreadSearch();
        repModalPost = null;
      }
      posts = data.posts || [];
      subscription = data.subscription?.notification_level || null;
      currentPage = pg;

      if (settingsData?.settings?.post_edit_time_limit !== undefined) {
        postEditTimeLimit = settingsData.settings.post_edit_time_limit;
      }

      // Estimate total pages
      if (thread) {
        totalPages = Math.max(1, Math.ceil((thread.reply_count + 1) / 25));
        loadSimilarThreads(thread.title);
        loadBookmarkIds();
        loadDraft(thread.id);
        loadThreadRating(thread.id);
        if (allForums.length === 0) {
          try {
            const fData = await api.getForums();
            const cats = fData.categories || [];
            allForums = cats.flatMap((c: any) => c.forums || []);
          } catch { /* ignore */ }
        }

        // Join real-time thread channel for live post updates
        if (currentThreadId && currentThreadId !== thread.id) {
          socketStore.leaveThreadChannel(currentThreadId);
        }
        currentThreadId = thread.id;
        socketStore.joinThreadChannel(
          thread.id,
          (newPost: any) => {
            // Only add if we're on the last page and post isn't already present
            if (currentPage === totalPages && !posts.find((p: any) => p.id === newPost.id)) {
              posts = [...posts, newPost];
              if (thread) thread.reply_count = (thread.reply_count || 0) + 1;
            }
          },
          (updatedPost: any) => {
            // Live-replace any post the user is viewing when its author edits it.
            posts = posts.map((p: any) => p.id === updatedPost.id ? updatedPost : p);
          }
        );
      }
    } catch (err: any) {
      error = err?.status === 404 ? 'Thread not found' : (err?.error || 'Failed to load thread');
    }
    loading = false;
  }

  function canEditPost(post: any): boolean {
    if (!auth.user || auth.user.id !== post.user.id) return false;
    if (auth.isStaff) return true;
    if (postEditTimeLimit <= 0) return true;
    const postAge = (Date.now() - new Date(post.inserted_at).getTime()) / 1000 / 60;
    return postAge <= postEditTimeLimit;
  }

  function editWindowExpired(post: any): boolean {
    if (postEditTimeLimit <= 0) return false;
    if (auth.isStaff) return false;
    const postAge = (Date.now() - new Date(post.inserted_at).getTime()) / 1000 / 60;
    return postAge > postEditTimeLimit;
  }

  // Bookmark helpers
  async function loadBookmarkIds() {
    if (!auth.isLoggedIn) return;
    try {
      const data = await api.getPostBookmarkIds();
      bookmarkedPostIds = new Set(data.post_ids || []);
    } catch { /* ignore */ }
  }

  async function toggleBookmark(postId: string) {
    if (!auth.isLoggedIn) return;
    try {
      const data = await api.togglePostBookmark(postId);
      const newSet = new Set(bookmarkedPostIds);
      if (data.bookmarked) {
        newSet.add(postId);
        toast.success('Post bookmarked');
      } else {
        newSet.delete(postId);
        toast.success('Bookmark removed');
      }
      bookmarkedPostIds = newSet;
    } catch { toast.error('Failed to toggle bookmark'); }
  }

  // Draft auto-save
  async function loadDraft(threadId: string) {
    if (!auth.isLoggedIn) return;
    try {
      const data = await api.getDraft('thread_reply', threadId);
      if (data.draft?.body && !replyBody) {
        replyBody = data.draft.body;
      }
    } catch { /* ignore */ }
  }

  onDestroy(() => {
    if (currentThreadId) socketStore.leaveThreadChannel(currentThreadId);
  });

  function scheduleDraftSave() {
    if (draftTimer) clearTimeout(draftTimer);
    if (draftFadeTimer) clearTimeout(draftFadeTimer);
    draftStatus = 'idle';

    if (!thread || !replyBody.trim()) return;

    draftTimer = setTimeout(async () => {
      if (!thread || !replyBody.trim()) return;
      draftStatus = 'saving';
      try {
        await api.saveDraft('thread_reply', thread.id, replyBody);
        draftStatus = 'saved';
        draftFadeTimer = setTimeout(() => { draftStatus = 'idle'; }, 2000);
      } catch {
        draftStatus = 'idle';
      }
    }, 2000);
  }

  async function clearDraft() {
    if (!thread) return;
    try { await api.deleteDraft('thread_reply', thread.id); } catch { /* ignore */ }
  }

  async function goToPage(pg: number) {
    if (!thread || pg < 1 || pg > totalPages) return;
    await loadThread(thread.slug, pg);
    window.scrollTo(0, 0);
  }

  async function setSubscription(level: string) {
    if (!thread) return;
    try {
      if (level === 'none') {
        await api.deleteThreadSubscription(thread.slug);
        subscription = null;
      } else {
        const data = await api.updateThreadSubscription(thread.slug, level);
        subscription = data.subscription?.notification_level || level;
      }
    } catch (err) { console.error('Failed to update subscription:', err); }
  }

  async function toggleMuteThread() {
    if (!thread) return;
    try {
      if (isMuted) { await api.unignoreThread(thread.id); isMuted = false; }
      else { await api.ignoreThread(thread.id); isMuted = true; }
    } catch (err) { console.error('Failed to toggle mute:', err); }
  }

  async function shareThread() {
    if (!thread) return;
    const url = `${window.location.origin}/threads/${thread.slug}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: thread.title, url });
        toast.success('Shared!');
      } catch {
        // User cancelled share — ignore
      } finally {
        // Web Share sheet dismissal sometimes leaves the page horizontally
        // scrolled on iOS Safari. Reset the scroll anchor explicitly.
        window.scrollTo({ left: 0, top: window.scrollY, behavior: 'instant' as ScrollBehavior });
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied!');
      } catch {
        toast.error('Failed to copy link');
      }
    }
  }

  async function submitReply() {
    if (!replyBody.trim() || !thread) return;
    replying = true;
    try {
      const data = await api.replyToThread(thread.slug, replyBody);
      // Append only if the realtime broadcast hasn't already inserted it
      if (!posts.find((p: any) => p.id === data.post.id)) {
        posts = [...posts, data.post];
      }
      replyBody = '';
      draftStatus = 'idle';
      if (draftTimer) clearTimeout(draftTimer);
      clearDraft();
      toast.success('Reply posted!');
    } catch (err) { console.error('Reply failed:', err); toast.error('Failed to post reply'); }
    replying = false;
  }

  // Quote
  function quotePost(post: any) {
    const quoted = `[quote="${post.user.username}"]\n${post.body}\n[/quote]\n\n`;
    replyBody = quoted + replyBody;
    // Scroll to reply box
    (document.querySelector('.reply-textarea') as HTMLTextAreaElement)?.focus();
  }

  // Like/Rate
  async function toggleLike(post: any) {
    if (!auth.isLoggedIn) return;
    try {
      const data = await api.ratePost(post.id, 'like');
      // Update the post's like count in-place
      posts = posts.map(p => p.id === post.id ? { ...p, like_count: (data.ratings || []).find((r: any) => r.type === 'like')?.count || p.like_count } : p);
    } catch (err) { console.error('Rate failed:', err); }
  }

  // Edit
  function startEdit(post: any) {
    editingPostId = post.id;
    editBody = post.body;
  }

  function cancelEdit() {
    editingPostId = null;
    editBody = '';
  }

  async function saveEdit() {
    if (!editingPostId || !editBody.trim()) return;
    saving = true;
    try {
      const data = await api.editPost(editingPostId, editBody);
      posts = posts.map(p => p.id === editingPostId ? data.post : p);
      editingPostId = null;
      editBody = '';
    } catch (err) { console.error('Edit failed:', err); }
    saving = false;
  }

  // Multi-quote
  function toggleQuoteSelect(post: any) {
    const newSet = new Set(selectedQuotes);
    if (newSet.has(post.id)) newSet.delete(post.id);
    else newSet.add(post.id);
    selectedQuotes = newSet;
  }

  function insertMultiQuotes() {
    const quoted = posts
      .filter(p => selectedQuotes.has(p.id))
      .map(p => `[quote="${p.user.username}"]\n${p.body}\n[/quote]`)
      .join('\n\n');
    replyBody = quoted + '\n\n' + replyBody;
    selectedQuotes = new Set();
    replyTextarea?.focus();
  }

  // Header "Reply" button — scroll to composer + focus the textarea.
  function jumpToReply() {
    if (replyTextarea) {
      replyTextarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Focus after scroll settles so the keyboard doesn't fight the scroll on iOS.
      setTimeout(() => replyTextarea?.focus(), 250);
    }
  }

  // Edit history
  async function showEditHistory(postId: string) {
    historyPostId = postId;
    loadingHistory = true;
    try {
      const data = await api.getPostHistory(postId);
      editHistory = data.edits || [];
    } catch { editHistory = []; }
    loadingHistory = false;
  }

  // Emoji insert
  function insertEmoji(emoji: string) {
    if (!replyTextarea) return;
    const start = replyTextarea.selectionStart;
    const before = replyTextarea.value.substring(0, start);
    const after = replyTextarea.value.substring(replyTextarea.selectionEnd);
    replyTextarea.value = before + emoji + after;
    replyTextarea.dispatchEvent(new Event('input'));
    replyBody = replyTextarea.value;
    replyTextarea.focus();
  }

  // Classic smilies insert (Feature 1)
  function insertSmilie(code: string) {
    if (!replyTextarea) return;
    const start = replyTextarea.selectionStart;
    const before = replyTextarea.value.substring(0, start);
    const after = replyTextarea.value.substring(replyTextarea.selectionEnd);
    replyTextarea.value = before + code + after;
    replyTextarea.dispatchEvent(new Event('input'));
    replyBody = replyTextarea.value;
    const newPos = start + code.length;
    replyTextarea.setSelectionRange(newPos, newPos);
    replyTextarea.focus();
  }

  // Convert media URLs to embeds & classic smilies
  function renderPostHtml(html: string | null, body: string): string {
    let content = html || escapeHtml(body);
    // Auto-embed YouTube
    content = content.replace(
      /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/g,
      '<div class="embed-video"><iframe src="https://www.youtube.com/embed/$1" frameborder="0" allowfullscreen loading="lazy"></iframe></div>'
    );
    // Auto-link bare URLs (that aren't already in tags)
    content = content.replace(
      /(?<![="'])(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    return decoratePostHtml(content);
  }


  // Extract standalone URLs from post body for link previews (max 3)
  function extractPreviewUrls(body: string): string[] {
    if (!body) return [];
    const urlRegex = /(?:^|\n)\s*(https?:\/\/[^\s<\[\]]+)\s*(?:\n|$)/gm;
    const urls: string[] = [];
    let match;
    while ((match = urlRegex.exec(body)) !== null && urls.length < 3) {
      const url = match[1];
      // Skip YouTube URLs (already embedded)
      if (/(?:youtube\.com\/watch|youtu\.be\/)/.test(url)) continue;
      // Skip image URLs
      if (/\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?.*)?$/i.test(url)) continue;
      if (!urls.includes(url)) urls.push(url);
    }
    return urls;
  }

  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br />');
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString();
  }

  function getInitial(username: string): string {
    return username?.charAt(0)?.toUpperCase() || '?';
  }

  function getRankInfo(user: any): { title: string; stars: number; color?: string } {
    if (!user) return { title: 'Member', stars: 1, color: '#94a3b8' };
    const group = (user.group_name || '').toLowerCase();
    if (group.includes('admin') || user.is_admin) {
      return { title: 'Administrator', stars: 5, color: '#ef4444' };
    }
    if (group.includes('mod') || user.is_moderator) {
      return { title: 'Moderator', stars: 4, color: '#10b981' };
    }
    const count = user.post_count || 0;
    if (count >= 1000) return { title: 'Grandmaster', stars: 5, color: '#f59e0b' };
    if (count >= 500) return { title: 'Veteran', stars: 4, color: '#f59e0b' };
    if (count >= 100) return { title: 'Senior Member', stars: 3, color: '#38bdf8' };
    if (count >= 25) return { title: 'Member', stars: 2, color: '#a78bfa' };
    return { title: 'Junior Member', stars: 1, color: '#94a3b8' };
  }

  // === Quote Scroll & Highlight ===
  function quoteNavigation(node: HTMLElement) {
    node.addEventListener('click', handleQuoteClick);
    return { destroy() { node.removeEventListener('click', handleQuoteClick); } };
  }

  function handleQuoteClick(event: MouseEvent) {
    const target = (event.target as HTMLElement).closest('cite');
    if (!target) return;
    const blockquote = target.closest('.bbcode-quote');
    if (!blockquote) return;

    // Extract username from "username wrote:" text
    const citeText = target.textContent || '';
    const match = citeText.match(/^(.+?)\s+wrote:/);
    if (!match) return;
    const quotedUsername = match[1].trim();

    // Find the most recent post by that username in the current page
    const matchingPost = [...posts].reverse().find(p => p.user.username === quotedUsername);
    if (!matchingPost) return;

    const el = document.getElementById(`post-${matchingPost.id}`);
    if (!el) return;

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('post-highlight');
    setTimeout(() => el.classList.remove('post-highlight'), 2000);
  }

  // === Quoted Post Navigator ===
  // Build a map: postIndex -> array of {username, postId} of posts that quote it
  let quotedByMap = $derived.by(() => {
    const map = new Map<number, Array<{ username: string; postId: string; postIndex: number }>>();
    if (!posts.length) return map;

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const body = post.body || '';
      // Find all [quote="USERNAME"] patterns in this post's body
      const quoteRegex = /\[quote="([^"]+)"\]/gi;
      let m;
      while ((m = quoteRegex.exec(body)) !== null) {
        const quotedUsername = m[1];
        // Find the most recent earlier post by that username
        for (let j = i - 1; j >= 0; j--) {
          if (posts[j].user.username === quotedUsername) {
            if (!map.has(j)) map.set(j, []);
            // Avoid duplicates (same quoting post)
            const existing = map.get(j)!;
            if (!existing.some(e => e.postId === post.id)) {
              existing.push({ username: post.user.username, postId: post.id, postIndex: i });
            }
            break;
          }
        }
      }
    }
    return map;
  });

  function scrollToPost(postId: string) {
    const el = document.getElementById(`post-${postId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('post-highlight');
    setTimeout(() => el.classList.remove('post-highlight'), 2000);
  }

  // === Image Paste Upload ===
  let pasteUploading = $state(false);

  async function handlePaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const file = item.getAsFile();
        if (!file) return;

        pasteUploading = true;
        try {
          const data = await api.uploadFile(file, 'post', thread?.id || 'draft');
          const url = data.url || data.attachment?.url;
          if (url && replyTextarea) {
            const start = replyTextarea.selectionStart;
            const before = replyTextarea.value.substring(0, start);
            const after = replyTextarea.value.substring(replyTextarea.selectionEnd);
            const tag = `[img]${url}[/img]`;
            replyTextarea.value = before + tag + after;
            replyTextarea.dispatchEvent(new Event('input'));
            replyBody = replyTextarea.value;
            const newPos = start + tag.length;
            replyTextarea.setSelectionRange(newPos, newPos);
            replyTextarea.focus();
            toast.success('Image uploaded!');
          }
        } catch (err: any) {
          toast.error(err?.error || 'Failed to upload image');
        }
        pasteUploading = false;
        return;
      }
    }
  }

  // === Similar Threads ===
  let similarThreads = $state<any[]>([]);
  let loadingSimilar = $state(false);

  async function loadSimilarThreads(title: string) {
    loadingSimilar = true;
    try {
      const data = await api.getSimilarThreads(title);
      similarThreads = (data.threads || []).slice(0, 5);
    } catch { similarThreads = []; }
    loadingSimilar = false;
  }

  function timeAgo(dateStr: string): string {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(dateStr).toLocaleDateString();
  }
</script>

<svelte:head>
  <title>{thread ? `${thread.title} - ForgeNexus` : 'ForgeNexus'}</title>
  {#if thread}
    <meta property="og:title" content={thread.title} />
    <meta property="og:type" content="article" />
    <meta property="og:url" content={`http://localhost:5173/threads/${thread.slug}`} />
    <meta property="og:description" content={`${thread.reply_count} replies, ${thread.view_count} views - ${thread.forum.name}`} />
    <meta property="og:site_name" content="ForgeNexus" />
    <meta name="description" content={`${thread.title} - Discussion in ${thread.forum.name}`} />
  {/if}
</svelte:head>

{#if thread}
  <Breadcrumb crumbs={[
    { label: thread.forum.name, href: `/forums/${thread.forum.slug}` },
    { label: thread.title }
  ]} />
{/if}

<div class="thread-view thread-layout">
  {#if loading}
    <div class="loading">Loading thread...</div>
  {:else if error}
    <div class="error-box">{error}</div>
  {:else if thread}
    <div class="thread-main">
    <div class="thread-header">
      <h1 class="thread-title">
        {#if thread.is_pinned}<span class="badge pin">Pinned</span>{/if}
        {#if thread.is_locked}<span class="badge lock">Locked</span>{/if}
        {#if thread.is_hidden}<span class="badge hidden" title="Hidden — only staff can see this thread">Hidden</span>{/if}
        {thread.title}
      </h1>
      <div class="thread-controls">
        <div class="thread-stats">
          <span>{thread.view_count} views</span>
          <span>&middot;</span>
          <span>{thread.reply_count} replies</span>
          <span class="stat-sep">&middot;</span>
          <!-- Classic phpBB/vBulletin Thread Rating Widget (Feature 4) -->
          <div class="thread-rating-box">
            <span class="rating-label">Rating:</span>
            <div class="stars-picker" role="group" aria-label="Rate this thread">
              {#each [1, 2, 3, 4, 5] as star}
                <button
                  type="button"
                  aria-label={`Rate ${star} out of 5 stars`}
                  aria-pressed={userRating === star}
                  class="star-btn"
                  class:active={(ratingHover ?? userRating ?? Math.round(ratingStats.average)) >= star}
                  class:user-picked={userRating !== null && userRating >= star}
                  onmouseenter={() => { if (auth.isLoggedIn) ratingHover = star; }}
                  onmouseleave={() => { ratingHover = null; }}
                  onclick={() => submitThreadRating(star)}
                  disabled={isRating || !auth.isLoggedIn}
                  title={auth.isLoggedIn ? `Rate ${star} / 5` : 'Log in to rate'}
                >
                  &#9733;
                </button>
              {/each}
            </div>
            {#if ratingStats.count > 0}
              <span class="rating-score">({ratingStats.average} / 5 &middot; {ratingStats.count} vote{ratingStats.count === 1 ? '' : 's'})</span>
            {:else}
              <span class="rating-score">(No votes)</span>
            {/if}
            {#if userRating}
              <span class="user-rated-pill">You: {userRating}&#9733;</span>
            {/if}
          </div>
        </div>
        <div class="thread-actions">
          <button
            class="btn-thread-search"
            class:active={showThreadSearch}
            onclick={() => { showThreadSearch = !showThreadSearch; }}
            title="Search this thread"
          >
            🔍 Search
          </button>
          {#if auth.isLoggedIn}
            <button
              class="btn-voice-lounge"
              class:connected={isVoiceConnected}
              onclick={toggleVoiceLounge}
              title={isVoiceConnected ? 'Connected to Voice Lounge' : 'Join or open Thread Voice Lounge'}
            >
              <span class="voice-icon">&#127911;</span> {voiceStore.isReconnecting ? 'Voice (Reconnecting)' : isVoiceConnected ? 'Voice (Live)' : 'Voice Lounge'}
            </button>
            {#if !thread.is_locked}
              <button class="btn-jump-reply" onclick={jumpToReply} title="Jump to reply box">↓ Reply</button>
            {/if}
            <select class="sub-select" value={subscription || 'none'} onchange={(e) => setSubscription(e.currentTarget.value)}>
              <option value="none">Not Subscribed</option>
              <option value="watching">Watching</option>
              <option value="tracking">Tracking</option>
              <option value="muted">Muted</option>
            </select>
            <button class="btn-mute" class:muted={isMuted} onclick={toggleMuteThread}>
              {isMuted ? 'Unmute' : 'Mute'}
            </button>
            <button class="btn-share" onclick={shareThread}>Share</button>
          {/if}
        </div>
      </div>
    </div>

    <!-- In-Thread Search Drawer (Feature 4) -->
    {#if showThreadSearch}
      <div class="in-thread-search-bar">
        <div class="search-input-wrap">
          <span class="search-icon">🔍</span>
          <input
            type="text"
            aria-label="Filter posts on this page by text or author"
            placeholder="Filter posts on this page by text or author..."
            bind:value={threadSearchQuery}
            class="thread-search-input"
          />
          {#if threadSearchQuery}
            <button class="search-clear-btn" onclick={clearThreadSearch} title="Clear filter">&times;</button>
          {/if}
        </div>
        <div class="search-results-count">
          {#if threadSearchQuery.trim()}
            Showing <strong>{displayedPosts.length}</strong> of <strong>{posts.length}</strong> posts on this page
          {:else}
            Type to filter posts in real-time
          {/if}
        </div>
      </div>
    {/if}

    <!-- Voice Lounge Drawer (Feature 1) -->
    {#if showVoiceDrawer}
      <div class="thread-voice-stage">
        <div class="voice-stage-header">
          <div class="voice-stage-title">
            <span class="live-pulse"></span>
            <strong>Thread Voice Lounge</strong>
            {#if isVoiceConnected}
              <span class="badge-live">{voiceStore.isReconnecting ? 'RECONNECTING' : 'LIVE'} ({voiceStore.participants.length} connected)</span>
            {/if}
          </div>
          <button class="stage-close-btn" onclick={() => showVoiceDrawer = false} title="Close drawer">&times;</button>
        </div>

        <div class="voice-stage-body">
          {#if !isVoiceConnected}
            <div class="voice-rooms-picker">
              <p class="voice-hint">Join an open voice room for live discussion with fellow thread participants:</p>
              {#if voiceRooms.length === 0}
                <div class="voice-empty-state">
                  <span>No general voice rooms open right now.</span>
                  <a class="btn-sm btn-primary" href="/chat">Browse community chat</a>
                </div>
              {:else}
                <div class="voice-rooms-grid">
                  {#each voiceRooms as room}
                    <button class="voice-room-card" onclick={() => connectToVoiceRoom(room.id)} disabled={voiceConnecting}>
                      <div class="room-name">🔊 {room.name || room.id}</div>
                      <div class="room-meta">{room.participant_count || 0} participants</div>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {:else}
            <div class="voice-active-panel">
              <div class="voice-peers-list">
                {#each voiceStore.participants as participant (participant.user_id)}
                  <div class="voice-peer-pill" class:self={participant.user_id === auth.user?.id}>
                    <span class="peer-avatar">{getInitial(participant.username || 'User')}</span>
                    <span class="peer-name">{participant.username}{participant.user_id === auth.user?.id ? ' (You)' : ''}</span>
                    {#if participant.muted}<span class="peer-muted-icon">🔇</span>{/if}
                    {#if participant.deafened}<span class="peer-muted-icon">🔕</span>{/if}
                  </div>
                {/each}
              </div>

              <div class="voice-controls-bar">
                <button class="voice-ctrl-btn" class:muted={voiceStore.isMuted} onclick={() => voiceStore.toggleMute()}>
                  {voiceStore.isMuted ? '🔇 Unmute' : '🎙️ Mute'}
                </button>
                <button class="voice-ctrl-btn" class:muted={voiceStore.isDeafened} onclick={() => voiceStore.toggleDeafen()}>
                  {voiceStore.isDeafened ? '🔕 Undeafen' : '🎧 Deafen'}
                </button>
                <button class="voice-ctrl-btn btn-disconnect" onclick={disconnectVoice}>
                  📞 Disconnect
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Pagination (top) -->
    {#if totalPages > 1}
      <div class="pagination">
        <button class="pg-btn" disabled={currentPage <= 1} onclick={() => goToPage(currentPage - 1)}>&laquo; Prev</button>
        {#each Array.from({length: Math.min(totalPages, 10)}, (_, i) => i + 1) as pg}
          <button class="pg-btn" class:active={pg === currentPage} onclick={() => goToPage(pg)}>{pg}</button>
        {/each}
        {#if totalPages > 10}
          <span class="pg-ellipsis">...</span>
          <button class="pg-btn" class:active={currentPage === totalPages} onclick={() => goToPage(totalPages)}>{totalPages}</button>
        {/if}
        <button class="pg-btn" disabled={currentPage >= totalPages} onclick={() => goToPage(currentPage + 1)}>Next &raquo;</button>
        <form class="page-jump-form" onsubmit={(e) => { e.preventDefault(); handlePageJump(); }}>
          <label for="jump-pg-top" class="jump-pg-label">Jump to:</label>
          <input
            id="jump-pg-top"
            type="number"
            min="1"
            max={totalPages}
            placeholder="#"
            bind:value={jumpPageVal}
            class="jump-pg-input"
          />
          <button type="submit" class="jump-pg-go">Go</button>
        </form>
      </div>
    {/if}

    <ThreadModToolbar threadId={thread.id} isLocked={thread.is_locked} isPinned={thread.is_pinned} isHidden={thread.is_hidden ?? false} onUpdate={() => loadThread(thread.slug)} />

    <!-- Posts -->
    <div class="posts-list" use:quoteNavigation role="list">
      {#each displayedPosts as post, idx (post.id)}
        {@const repMeta = getReputationMeta(post.user.reputation || 0)}
        <div class="post-box" role="listitem" id="post-{post.id}">
          <div class="post-user-panel" style:position="relative">
            {#if post.user.postbit_background_url}
              <div class="custom-bg" style="background-image: url({post.user.postbit_background_url}); opacity: {post.user.postbit_background_opacity ?? 0.15};"></div>
            {/if}
            <AvatarFrame frame={post.user.avatar_frame} frameColor={post.user.avatar_frame_color} size={100}>
              <div class="avatar">
                {#if post.user.avatar_url}
                  <img src={post.user.avatar_url} alt={post.user.username} />
                {:else}
                  {getInitial(post.user.username)}
                {/if}
              </div>
            </AvatarFrame>
            <UserHoverCard username={post.user.username} slug={post.user.slug} avatarUrl={post.user.avatar_url} postCount={post.user.post_count} reputation={post.user.reputation} customTitle={post.user.display_title || post.user.custom_title}>
              <UsernameDisplay username={post.user.username} color={post.user.username_color} effect={post.user.username_effect} href="/profile/{post.user.slug}" customTitle={post.user.display_title || post.user.custom_title} nameplateColor={post.user.nameplate_color} nameplateImageUrl={post.user.nameplate_image_url} />
            </UserHoverCard>
            {#if post.user.group_name}
              <div class="user-title" style:color={post.user.username_color || undefined}>{post.user.group_name}</div>
            {/if}
            {#if post.user}
              {@const rank = getRankInfo(post.user)}
              <div class="rank-stars" title="{rank.title} ({rank.stars} / 5 stars)" style:color={rank.color || 'var(--accent)'}>
                {#each Array.from({ length: rank.stars }) as _}
                  <span class="rank-star">&#9733;</span>
                {/each}
              </div>
            {/if}
            <div class="user-stats">
              <div class="stat-line">Posts: <strong>{post.user.post_count}</strong></div>
              <div class="stat-line">Threads: <strong>{post.user.thread_count || 0}</strong></div>
              <div class="stat-line">Rep: <strong>{post.user.reputation}</strong></div>
              {#if post.user.location}
                <div class="stat-line loc">{post.user.location}</div>
              {/if}
              <div class="stat-line joined">Joined {new Date(post.user.inserted_at).toLocaleDateString()}</div>
            </div>
            <!-- Classic vBulletin/phpBB Reputation Bar & Level (Feature 2) -->
            <div class="rep-bar-wrap" title="{repMeta.label} ({post.user.reputation || 0} reputation)">
              <div class="rep-blocks">
                {#each Array.from({ length: repMeta.count }) as _}
                  <span class="rep-block" style:background-color={repMeta.color} style:box-shadow="0 0 5px {repMeta.color}88"></span>
                {/each}
              </div>
              <span class="rep-level-text" style:color={repMeta.color}>{repMeta.label}</span>
            </div>
            <div class="user-online-status">
              <span class="online-dot" class:online={post.user.is_online}></span>
              {post.user.is_online ? 'Online' : 'Offline'}
              {#if post.user.custom_status_text}
                <span class="custom-status">{post.user.custom_status_emoji || ''} {post.user.custom_status_text}</span>
              {/if}
            </div>
          </div>

          <div class="post-content-panel" style:position="relative">
            {#if post.user.post_background_url}
              <div class="custom-bg" style="background-image: url({post.user.post_background_url}); opacity: {post.user.post_background_opacity ?? 0.15};"></div>
            {/if}
            <div class="post-header">
              <span class="post-date">{formatDate(post.inserted_at)}</span>
              <span class="post-num">#{(currentPage - 1) * 25 + idx + 1}</span>
            </div>

            {#if editingPostId === post.id}
              <!-- Edit mode -->
              <div class="post-edit">
                <textarea bind:value={editBody} class="edit-textarea" rows="6"></textarea>
                <div class="edit-actions">
                  <button class="btn-sm" onclick={cancelEdit}>Cancel</button>
                  <button class="btn-sm btn-primary" onclick={saveEdit} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                </div>
              </div>
            {:else}
              <div class="post-body">{@html renderPostHtml(post.body_html, post.body)}</div>
              {#each extractPreviewUrls(post.body) as previewUrl (previewUrl)}
                <LinkPreview url={previewUrl} />
              {/each}
            {/if}

            {#if (post.user.signature || post.user.signature_html) && editingPostId !== post.id}
              <div class="post-signature" style:position="relative">
                {#if post.user.signature_background_url}
                  <div class="custom-bg" style="background-image: url({post.user.signature_background_url}); opacity: 0.15;"></div>
                {/if}
                <div class="sig-divider"></div>
                <div class="sig-content">
                  {#if post.user.signature_html}{@html post.user.signature_html}{:else}{post.user.signature}{/if}
                </div>
              </div>
            {/if}

            {#if quotedByMap.has(idx)}
              <div class="quoted-by-links">
                {#each quotedByMap.get(idx)! as qb}
                  <button class="quoted-by-link" onclick={() => scrollToPost(qb.postId)}>
                    Quoted by {qb.username} <span class="quoted-by-arrow">&#8595;</span>
                  </button>
                {/each}
              </div>
            {/if}

            <div class="post-footer">
              <button class="action-btn" class:liked={false} onclick={() => toggleLike(post)}>&#128077; Like ({post.like_count})</button>
              {#if auth.isLoggedIn && auth.user?.id !== post.user.id}
                <button class="action-btn rep-action-btn" onclick={() => openRepModal(post)} title="Give reputation to {post.user.username}">
                  &#9733; +Rep
                </button>
              {/if}
              {#if auth.isLoggedIn}
                <button class="action-btn" class:bookmarked={bookmarkedPostIds.has(post.id)} onclick={() => toggleBookmark(post.id)} title={bookmarkedPostIds.has(post.id) ? 'Remove bookmark' : 'Bookmark post'}>
                  {bookmarkedPostIds.has(post.id) ? '🔖' : '🔖'} {bookmarkedPostIds.has(post.id) ? 'Saved' : 'Save'}
                </button>
                <button class="action-btn" onclick={() => quotePost(post)}>&#x21A9; Quote</button>
                <label class="action-btn mq-check" title="Add to multi-quote">
                  <input type="checkbox" checked={selectedQuotes.has(post.id)} onchange={() => toggleQuoteSelect(post)} /> +Q
                </label>
                {#if auth.user?.id === post.user.id}
                  {#if canEditPost(post)}
                    <button class="action-btn" onclick={() => startEdit(post)}>&#9998; Edit</button>
                  {:else if editWindowExpired(post)}
                    <span class="action-btn expired" title="Edit window expired">&#9998; Edit window expired</span>
                  {/if}
                {/if}
              {/if}
              <ReportButton reportableType="post" reportableId={post.id} />
              {#if post.is_edited}
                <button class="action-btn edited-notice" onclick={() => showEditHistory(post.id)}>Edited ({post.edit_count}x)</button>
              {/if}
              <PostModToolbar postId={post.id} userId={post.user.id} isHidden={post.is_hidden ?? false} />
            </div>
          </div>
        </div>
      {/each}
      {#if displayedPosts.length === 0}
        <div class="no-thread-matches">
          <p>No posts matching "<strong>{threadSearchQuery}</strong>" found on page {currentPage}.</p>
          <button class="btn-sm btn-primary" onclick={clearThreadSearch}>Clear Search</button>
        </div>
      {/if}
    </div>

    <!-- Pagination (bottom) -->
    {#if totalPages > 1}
      <div class="pagination">
        <button class="pg-btn" disabled={currentPage <= 1} onclick={() => goToPage(currentPage - 1)}>&laquo; Prev</button>
        {#each Array.from({length: Math.min(totalPages, 10)}, (_, i) => i + 1) as pg}
          <button class="pg-btn" class:active={pg === currentPage} onclick={() => goToPage(pg)}>{pg}</button>
        {/each}
        {#if totalPages > 10}
          <span class="pg-ellipsis">...</span>
          <button class="pg-btn" class:active={currentPage === totalPages} onclick={() => goToPage(totalPages)}>{totalPages}</button>
        {/if}
        <button class="pg-btn" disabled={currentPage >= totalPages} onclick={() => goToPage(currentPage + 1)}>Next &raquo;</button>
        <form class="page-jump-form" onsubmit={(e) => { e.preventDefault(); handlePageJump(); }}>
          <label for="jump-pg-bottom" class="jump-pg-label">Jump to:</label>
          <input
            id="jump-pg-bottom"
            type="number"
            min="1"
            max={totalPages}
            placeholder="#"
            bind:value={jumpPageVal}
            class="jump-pg-input"
          />
          <button type="submit" class="jump-pg-go">Go</button>
        </form>
      </div>
    {/if}

    <!-- Edit History Modal -->
    {#if historyPostId}
      <dialog class="modal-overlay" data-modal="overlay" use:modal={() => historyPostId = null}  >
        <div class="modal-content"   >
          <div class="modal-header">
            <h3>Edit History</h3>
            <button aria-label="Close" class="modal-close" onclick={() => historyPostId = null}>&times;</button>
          </div>
          {#if loadingHistory}
            <p class="loading-text">Loading...</p>
          {:else if editHistory.length === 0}
            <p class="loading-text">No edit history available.</p>
          {:else}
            <div class="history-list">
              {#each editHistory as edit (edit.id)}
                <div class="history-item">
                  <div class="history-meta">
                    Edited by <strong>{edit.editor?.username || 'Unknown'}</strong> &middot; {formatDate(edit.inserted_at)}
                    {#if edit.edit_reason}<span class="edit-reason">({edit.edit_reason})</span>{/if}
                  </div>
                  <div class="history-diff">
                    <div class="diff-before"><strong>Before:</strong><pre>{edit.body_before}</pre></div>
                    <div class="diff-after"><strong>After:</strong><pre>{edit.body_after}</pre></div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </dialog>
    {/if}

    <!-- Reputation Award Modal (Feature 2) -->
    {#if repModalPost}
      <dialog class="modal-overlay" data-modal="overlay" use:modal={() => repModalPost = null}  >
        <div class="modal-content rep-modal-content"   >
          <div class="modal-header">
            <h3>Award Reputation to {repModalPost.user.username}</h3>
            <button aria-label="Close" class="modal-close" onclick={() => repModalPost = null}>&times;</button>
          </div>
          <div class="rep-modal-body">
            <p class="rep-modal-desc">
              What do you think of <strong>{repModalPost.user.username}</strong>'s post?
            </p>
            <div class="rep-amount-picker">
              <label class="rep-radio-label">
                <input type="radio" bind:group={repAmount} value={1} />
                <span>+1 Rep (Approve / Helpful)</span>
              </label>
              <label class="rep-radio-label">
                <input type="radio" bind:group={repAmount} value={2} />
                <span>+2 Rep (Exceptional Contribution)</span>
              </label>
              <label class="rep-radio-label">
                <input type="radio" bind:group={repAmount} value={5} />
                <span>+5 Rep (Masterpiece / Essential Guide)</span>
              </label>
            </div>
            <div class="rep-comment-field">
              <label for="rep-reason-input" class="rep-input-label">Comment / Note (optional):</label>
              <input
                id="rep-reason-input"
                type="text"
                maxlength="150"
                placeholder="e.g. Great advice, thank you!"
                bind:value={repReason}
                class="rep-input"
              />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-sm" onclick={() => repModalPost = null}>Cancel</button>
            <button class="btn-sm btn-primary" onclick={submitReputation} disabled={submittingRep}>
              {submittingRep ? 'Submitting...' : 'Add Reputation'}
            </button>
          </div>
        </div>
      </dialog>
    {/if}

    <!-- Reply box -->
    {#if auth.isLoggedIn && !thread.is_locked && auth.user && !auth.user.email_verified}
      <div class="email-verify-banner">
        <span class="verify-icon">&#9888;</span>
        <span>Please verify your email to post replies. Check your inbox or <a href="/settings/account">resend verification</a>.</span>
      </div>
    {:else if auth.isLoggedIn && !thread.is_locked}
      <div class="reply-box">
        <h3>Reply to this thread</h3>

        {#if selectedQuotes.size > 0}
          <div class="mq-bar">
            <span>{selectedQuotes.size} post{selectedQuotes.size > 1 ? 's' : ''} selected</span>
            <button class="btn-sm" onclick={insertMultiQuotes}>Insert Quotes</button>
            <button class="btn-sm" onclick={() => selectedQuotes = new Set()}>Clear</button>
          </div>
        {/if}

        <FormattingToolbar bind:textarea={replyTextarea} />
        <div class="reply-editor" style="position: relative;">
          <textarea bind:value={replyBody} bind:this={replyTextarea} placeholder="Write your reply... Use @ to mention users, paste images from clipboard" rows="6" class="reply-textarea" oninput={scheduleDraftSave} onpaste={handlePaste}></textarea>
          <MentionAutocomplete bind:textarea={replyTextarea} />
        </div>
        <SmiliesTray onSelect={insertSmilie} />
        {#if pasteUploading}
          <div class="draft-indicator saving">Uploading image...</div>
        {:else if draftStatus === 'saving'}
          <div class="draft-indicator saving">Saving draft...</div>
        {:else if draftStatus === 'saved'}
          <div class="draft-indicator saved">Draft saved</div>
        {/if}
        {#if showPreview && replyBody}
          <div class="preview-box">
            <div class="preview-header">Preview</div>
            <div class="preview-body post-body">{@html renderPostHtml(previewHtml, replyBody)}</div>
          </div>
        {/if}

        <div class="reply-actions">
          <div class="reply-tools">
            <EmojiPicker onSelect={insertEmoji} />
            <button type="button" class="tb-btn" class:active={showPreview} onclick={() => showPreview = !showPreview} title="Preview">&#128065;</button>
          </div>
          <button class="btn btn-primary" onclick={submitReply} disabled={replying || !replyBody.trim()}>
            {replying ? 'Posting...' : 'Post Reply'}
          </button>
        </div>
      </div>
    {:else if !auth.isLoggedIn}
      <div class="login-prompt">
        <a href="/auth/login">Login</a> or <a href="/auth/register">Register</a> to reply
      </div>
    {/if}

    <!-- Classic phpBB/vBulletin Forum Jump -->
    {#if allForums.length > 0}
      <div class="thread-jump-bar">
        <label for="thread-jump-select" class="jump-label">Forum Jump:</label>
        <select id="thread-jump-select" class="sub-select jump-select" onchange={(e) => {
          const val = (e.target as HTMLSelectElement).value;
          if (val) window.location.href = `/forums/${val}`;
        }}>
          <option value="">-- Jump to a Forum --</option>
          {#each allForums as f}
            <option value={f.slug} selected={f.id === thread?.forum?.id}>{f.name}</option>
          {/each}
        </select>
      </div>
    {/if}

    <!-- Currently Active Users Across the Community (Feature 3) -->
    <div class="active-viewers-card">
      <div class="active-viewers-header">
        <span class="active-viewers-icon">&#128101;</span>
        <span class="active-viewers-title">Currently Active Users Across the Community</span>
        <span class="active-viewers-count">({activeMembers.length} member{activeMembers.length === 1 ? '' : 's'})</span>
      </div>
      <div class="active-viewers-list">
        {#if activeMembers.length === 0}
          <span class="viewer-guest-only">No member presence is available right now.</span>
        {:else}
          {#each activeMembers as member, idx}
            <a
              href="/profile/{member.slug || member.username}"
              class="active-viewer-link"
              style:color={member.username_color || 'var(--accent)'}
            >
              {member.username}
            </a>{#if idx < activeMembers.length - 1}<span class="viewer-comma">, </span>{/if}
          {/each}
        {/if}
      </div>
    </div>

    <!-- Classic Posting Rules Box (phpBB/vBulletin style - Feature 3) -->
    <div class="thread-posting-rules-wrap">
      <ForumPostingRules
        canPostThread={!thread.forum?.is_locked}
        canReply={!thread.is_locked}
        canAttach={true}
        canEdit={true}
        isLocked={thread.is_locked}
        editTimeLimit={postEditTimeLimit}
      />
    </div>

    </div><!-- end thread-main -->

    <!-- Sticky Sidebar (desktop only) -->
    <aside class="thread-sidebar">
      <div class="sidebar-sticky">
        <!-- Thread Info -->
        <div class="sidebar-card">
          <h3 class="sidebar-heading">Thread Info</h3>
          <div class="sidebar-info">
            <div class="info-row"><span class="info-label">Author</span><a href="/profile/{thread.user.slug}" class="info-value accent">{thread.user.username}</a></div>
            <div class="info-row"><span class="info-label">Created</span><span class="info-value">{new Date(thread.inserted_at).toLocaleDateString()}</span></div>
            <div class="info-row"><span class="info-label">Views</span><span class="info-value">{thread.view_count.toLocaleString()}</span></div>
            <div class="info-row"><span class="info-label">Replies</span><span class="info-value">{thread.reply_count.toLocaleString()}</span></div>
            <div class="info-row"><span class="info-label">Forum</span><a href="/forums/{thread.forum.slug}" class="info-value accent">{thread.forum.name}</a></div>
          </div>
        </div>

        <!-- Thread Actions -->
        {#if auth.isLoggedIn}
          <div class="sidebar-card">
            <h3 class="sidebar-heading">Actions</h3>
            <div class="sidebar-actions">
              <select class="sidebar-select" value={subscription || 'none'} onchange={(e) => setSubscription(e.currentTarget.value)}>
                <option value="none">Not Watching</option>
                <option value="watching">Watching</option>
                <option value="tracking">Tracking</option>
                <option value="muted">Muted</option>
              </select>
              <button class="sidebar-btn" class:active={isMuted} onclick={toggleMuteThread}>
                {isMuted ? 'Unmute Thread' : 'Mute Thread'}
              </button>
              <button class="sidebar-btn" onclick={shareThread}>
                Share Link
              </button>
            </div>
          </div>
        {/if}

        <!-- Similar Threads -->
        {#if similarThreads.length > 0}
          <div class="sidebar-card">
            <h3 class="sidebar-heading">Similar Threads</h3>
            <div class="similar-list">
              {#each similarThreads as st (st.id)}
                <a href="/threads/{st.slug}" class="similar-item">
                  <div class="similar-title">{st.title}</div>
                  <div class="similar-meta">
                    <span>{st.reply_count} {st.reply_count === 1 ? 'reply' : 'replies'}</span>
                    <span>&middot; {timeAgo(st.inserted_at)}</span>
                  </div>
                </a>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </aside>
  {/if}
</div>

<style>
  :global(.quote-author-link) { padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; text-decoration: underline; }
  .thread-view { display: flex; flex-direction: column; gap: 8px; }
  .thread-layout { flex-direction: row; flex-wrap: wrap; }
  .thread-main { flex: 1; min-width: 0; max-width: 100%; display: flex; flex-direction: column; gap: 8px; }

  /* Sticky Sidebar */
  .thread-sidebar { width: 280px; flex-shrink: 0; display: none; }
  .sidebar-sticky { position: sticky; top: 80px; display: flex; flex-direction: column; gap: 10px; max-height: calc(100vh - 100px); overflow-y: auto; }
  .sidebar-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 12px 14px; }
  .sidebar-heading { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 8px; }
  .sidebar-info { display: flex; flex-direction: column; gap: 6px; }
  .info-row { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
  .info-label { color: var(--text-muted); }
  .info-value { color: var(--text-secondary); font-weight: 600; }
  .info-value.accent { color: var(--accent); text-decoration: none; }
  .info-value.accent:hover { text-decoration: underline; }
  .sidebar-actions { display: flex; flex-direction: column; gap: 6px; }
  .sidebar-select { width: 100%; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: var(--radius); padding: 6px 8px; font-size: 12px; color: var(--text-primary); cursor: pointer; }
  .sidebar-select:focus { border-color: var(--accent); outline: none; }
  .sidebar-btn { width: 100%; padding: 6px 10px; font-size: 12px; font-weight: 600; border-radius: var(--radius); background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border-color); cursor: pointer; transition: all 0.15s; }
  .sidebar-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .sidebar-btn.active { background: var(--danger); color: white; border-color: var(--danger); }

  @media (min-width: 1024px) {
    .thread-sidebar { display: block; }
    .thread-main { max-width: calc(100% - 292px); }
  }
  .thread-header {
    padding: 16px 0;
    border-bottom: 1px solid var(--border-color);
    margin-bottom: 8px;
  }
  .thread-title {
    font-size: 22px; font-weight: 800; display: flex; align-items: center; gap: 10px;
    color: var(--text-heading);
    letter-spacing: -0.02em;
  }

  .badge { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 8px; border-radius: var(--radius); letter-spacing: 0.03em; }
  .badge.pin { background: var(--accent-glow); color: var(--accent); border: 1px solid var(--border-accent); }
  .badge.lock { background: rgba(239, 68, 68, 0.1); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
  .badge.hidden { background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); }

  /* "Reply" button in the thread header — scroll to composer */
  .btn-jump-reply {
    font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: var(--radius);
    background: var(--accent); color: var(--bg-primary); border: 1px solid var(--accent);
    cursor: pointer;
  }
  .btn-jump-reply:hover { filter: brightness(1.08); }

  .thread-controls { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
  .thread-stats { font-size: 12px; color: var(--text-muted); display: flex; gap: 6px; }
  .thread-actions { display: flex; gap: 6px; align-items: center; }

  .sub-select { background: var(--bg-input); border: 1px solid var(--border-color); border-radius: var(--radius); padding: 4px 8px; font-size: 11px; color: var(--text-primary); cursor: pointer; }
  .sub-select:focus { border-color: var(--accent); outline: none; }
  .btn-mute { font-size: 11px; padding: 4px 10px; border-radius: var(--radius); background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border-color); cursor: pointer; }
  .btn-mute:hover { background: var(--bg-hover); }
  .btn-mute.muted { background: var(--danger); color: white; border-color: var(--danger); }
  .btn-share { font-size: 11px; padding: 4px 10px; border-radius: var(--radius); background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border-color); cursor: pointer; }
  .btn-share:hover { background: var(--bg-hover); color: var(--text-primary); }

  /* Pagination */
  .pagination { display: flex; gap: 4px; justify-content: center; padding: 8px 0; flex-wrap: wrap; }
  .pg-btn { padding: 4px 10px; border: 1px solid var(--border-color); border-radius: var(--radius); background: var(--bg-card); color: var(--text-secondary); font-size: 12px; cursor: pointer; }
  .pg-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
  .pg-btn.active { background: var(--accent); color: var(--bg-primary); border-color: var(--accent); font-weight: 700; }
  .pg-btn:disabled { opacity: 0.4; cursor: default; }
  .pg-ellipsis { color: var(--text-muted); padding: 4px; font-size: 12px; }

  .posts-list { display: flex; flex-direction: column; gap: 10px; }

  /* Modern post cards with glass effect */
  :global(.post-box) {
    background: var(--glass-bg);
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    transition: all var(--transition-base);
  }

  :global(.post-box:hover) {
    border-color: var(--border-hover);
    box-shadow: var(--shadow-md);
  }

  :global(.post-box:first-child) {
    border-color: var(--border-accent);
    box-shadow: var(--shadow-sm), inset 0 0 30px rgba(0, 229, 184, 0.02);
  }

  .avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: var(--radius-lg); }
  .post-date { color: var(--text-muted); font-size: 12px; }
  .post-num { color: var(--text-muted); font-weight: 700; font-size: 12px; }

  .action-btn { background: none; border: none; color: var(--text-secondary); font-size: 12px; cursor: pointer; padding: 4px 8px; border-radius: var(--radius); transition: all 0.15s; }
  .action-btn:hover { background: var(--bg-hover); color: var(--accent); }
  .action-btn.expired { cursor: default; opacity: 0.5; font-style: italic; }
  .action-btn.expired:hover { background: none; color: var(--text-secondary); }

  .edited-notice { color: var(--text-muted); font-style: italic; font-size: 11px; margin-left: auto; }

  /* Edit mode */
  .post-edit { padding: 12px 16px; }
  .edit-textarea { width: 100%; resize: vertical; min-height: 100px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: var(--radius); padding: 8px; color: var(--text-primary); font-size: 13px; font-family: inherit; }
  .edit-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; }
  .btn-sm { padding: 4px 12px; border-radius: var(--radius); font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-secondary); }
  .btn-sm.btn-primary { background: var(--accent); color: var(--bg-primary); border-color: var(--accent); }

  .reply-box { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; margin-top: 8px; }
  .reply-box h3 { font-size: 14px; font-weight: 700; margin-bottom: 8px; color: var(--text-primary); }
  .reply-textarea { resize: vertical; min-height: 100px; margin-bottom: 8px; }
  .reply-actions { display: flex; justify-content: flex-end; }

  .login-prompt { text-align: center; padding: 16px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); color: var(--text-secondary); font-size: 13px; }

  .email-verify-banner { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: var(--radius-lg); color: var(--text-secondary); font-size: 13px; margin-top: 8px; }
  .email-verify-banner a { color: var(--accent); text-decoration: underline; }
  .verify-icon { font-size: 18px; }
  .loading { text-align: center; padding: 60px 0; color: var(--text-muted); }

  .custom-bg { position: absolute; inset: 0; background-size: cover; background-position: center; background-repeat: no-repeat; pointer-events: none; z-index: 0; }
  .post-user-panel > :not(.custom-bg), .post-content-panel > :not(.custom-bg) { position: relative; z-index: 1; }

  .post-signature { padding: 10px 16px 14px; overflow: hidden; margin-top: auto; }
  .sig-divider {
    width: 200px;
    max-width: 40%;
    border-top: 1px dashed var(--border-color);
    margin: 14px 0 8px;
    opacity: 0.75;
    position: relative;
  }
  .sig-divider::before {
    content: "_________________";
    display: block;
    font-size: 10px;
    line-height: 0;
    color: var(--text-muted);
    letter-spacing: -1px;
    margin-top: -5px;
    margin-bottom: 5px;
    opacity: 0.6;
    font-family: monospace;
  }
  .sig-content { font-size: 11px; color: var(--text-muted); line-height: 1.5; max-height: 140px; overflow: hidden; }
  .post-signature > :not(.custom-bg) { position: relative; z-index: 1; }

  /* Postbit */
  .user-stats { font-size: 11px; color: var(--text-muted); line-height: 1.6; }
  .stat-line strong { color: var(--text-secondary); }
  .stat-line.loc { color: var(--text-secondary); font-style: italic; }
  .stat-line.joined { font-size: 10px; }
  .user-online-status { font-size: 10px; color: var(--text-muted); display: flex; align-items: center; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
  .online-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--offline); flex-shrink: 0; }
  .online-dot.online { background: var(--online); }
  .custom-status { color: var(--text-muted); font-style: italic; }

  /* Multi-quote */
  .mq-check { display: flex; align-items: center; gap: 3px; font-size: 11px; }
  .mq-check input { width: auto; margin: 0; }
  .mq-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--accent-glow); border: 1px solid var(--border-accent); border-radius: var(--radius); margin-bottom: 8px; font-size: 12px; color: var(--accent); }

  /* Preview */
  .preview-box { background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: var(--radius); margin-top: 8px; }
  .preview-header { padding: 6px 10px; font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; border-bottom: 1px solid var(--border-color); }
  .preview-body { padding: 10px; font-size: 14px; color: var(--text-primary); line-height: 1.6; }
  .tb-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: none; background: none; color: var(--text-secondary); font-size: 14px; cursor: pointer; border-radius: 3px; }
  .tb-btn:hover, .tb-btn.active { background: var(--bg-hover); color: var(--accent); }

  /* Reply editor */
  .reply-editor { position: relative; }
  .reply-textarea { border-radius: 0 0 var(--radius) var(--radius) !important; }
  .reply-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
  .reply-tools { display: flex; gap: 4px; }

  /* Embed video */
  :global(.embed-video) { position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; margin: 8px 0; border-radius: var(--radius); }
  :global(.embed-video iframe) { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }

  /* Post body links and images */
  :global(.post-body a) { color: var(--accent); }
  :global(.post-body img) { max-width: 100%; height: auto; border-radius: var(--radius); cursor: zoom-in; }

  /* Edit history modal */
  .modal-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; }
  .modal-content { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto; }
  .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--border-color); }
  .modal-header h3 { font-size: 16px; font-weight: 700; }
  .modal-close { background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer; }
  .loading-text { padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px; }
  .history-list { padding: 12px 16px; }
  .history-item { margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; }
  .history-meta { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
  .edit-reason { color: var(--text-muted); font-style: italic; }
  .diff-before, .diff-after { margin-bottom: 4px; }
  .diff-before strong, .diff-after strong { font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 2px; }
  .diff-before pre, .diff-after pre { font-size: 12px; color: var(--text-secondary); background: var(--bg-tertiary); padding: 6px 8px; border-radius: var(--radius); white-space: pre-wrap; word-wrap: break-word; margin: 0; }

  /* Quote scroll & highlight */
  :global(.bbcode-quote cite) { cursor: pointer; }
  :global(.bbcode-quote cite:hover) { color: var(--accent); text-decoration: underline; }
  :global(.post-highlight) { animation: highlightFade 2s ease; }
  @keyframes highlightFade { 0% { background: rgba(0, 212, 170, 0.15); } 100% { background: transparent; } }

  /* Similar Threads */
  .similar-list { display: flex; flex-direction: column; gap: 6px; }
  .similar-item { display: block; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: var(--radius); text-decoration: none; transition: background 0.15s, border-color 0.15s; }
  .similar-item:hover { background: var(--bg-hover); border-color: var(--accent); }
  .similar-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .similar-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; display: flex; gap: 4px; }

  /* Quoted-by navigator */
  .quoted-by-links { padding: 4px 16px 0; display: flex; flex-wrap: wrap; gap: 6px; }
  .quoted-by-link { background: none; border: none; color: var(--text-muted); font-size: 11px; cursor: pointer; padding: 2px 6px; border-radius: var(--radius); transition: color 0.15s, background 0.15s; }
  .quoted-by-link:hover { color: var(--accent); background: var(--bg-hover); }
  .quoted-by-arrow { font-size: 10px; }

  /* Bookmark button */
  .action-btn.bookmarked { color: var(--accent); font-weight: 600; }

  /* Draft auto-save indicator */
  .draft-indicator { font-size: 11px; color: var(--text-muted); margin-top: 4px; transition: opacity 0.3s; }
  .draft-indicator.saving { color: var(--text-secondary); }
  .draft-indicator.saved { color: var(--accent); }

  /* === Mobile === */
  @media (max-width: 768px) {
    .thread-header { padding: 10px 0; margin-bottom: 4px; }
    .thread-title { font-size: 18px; line-height: 1.25; flex-wrap: wrap; gap: 6px; }
    .thread-controls { flex-direction: column; align-items: stretch; gap: 8px; }
    .thread-stats { flex-wrap: wrap; gap: 4px 8px; font-size: 11px; }
    .thread-actions { flex-wrap: wrap; gap: 4px 6px; }
    .thread-actions :global(button), .thread-actions :global(select) { min-height: 36px; }
    .sub-select, .btn-mute, .btn-share { font-size: 12px; padding: 6px 10px; min-height: 36px; }

    /* Post boxes: avatar + name as a slim row above content. user-panel is
       already flipped to row by app.css; just shrink internals here. */
    :global(.post-user-panel .avatar) { width: 36px !important; height: 36px !important; font-size: 16px; margin: 0 !important; border-width: 1px; }
    :global(.post-user-panel .user-title), :global(.post-user-panel .user-stats) { display: none; }
    :global(.post-user-panel .username) { font-size: 14px; margin: 0; }
    :global(.post-header) { padding: 6px 10px; font-size: 11px; flex-wrap: wrap; }
    :global(.post-body) { padding: 10px 12px !important; font-size: 14px; }
    :global(.post-footer) { flex-wrap: wrap; gap: 4px 6px !important; padding: 6px 10px !important; }
    :global(.action-btn) { font-size: 12px; padding: 6px 8px; min-height: 36px; }

    /* Reply composer */
    .reply-textarea { min-height: 90px; font-size: 14px; }
    :global(.tb-btn) { width: 36px !important; height: 36px !important; font-size: 16px; }

    /* Pagination buttons big enough for thumbs */
    .pg-btn { min-height: 36px; min-width: 36px; padding: 6px 10px; font-size: 13px; }

    /* Post date / num collapse onto one line */
    .post-date, .post-num { font-size: 11px; }

    /* Edit history / spoiler modals don't dwarf viewport */
    .modal-content { width: 96vw !important; max-width: 96vw; max-height: 90vh; }
  }

  @media (max-width: 480px) {
    .thread-title { font-size: 16px; }
    :global(.post-body) { font-size: 13px; }
  }

  /* === phpBB/vBulletin Classic Rank Stars / Pips === */
  .rank-stars {
    display: flex;
    justify-content: center;
    gap: 2px;
    font-size: 12px;
    margin: 2px 0 5px;
    text-shadow: 0 0 6px currentColor;
    cursor: default;
    user-select: none;
  }
  .rank-star {
    display: inline-block;
    line-height: 1;
  }

  /* === Thread Bottom Forum Jump === */
  .thread-jump-bar {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    margin-top: 10px;
  }
  .jump-label {
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 600;
  }
  .jump-select {
    max-width: 240px;
  }

  /* === Thread Rating Widget (Feature 4) === */
  .thread-rating-box {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    background: var(--bg-tertiary);
    padding: 3px 8px;
    border-radius: var(--radius);
    border: 1px solid var(--border-color);
  }
  .rating-label {
    color: var(--text-muted);
    font-weight: 600;
  }
  .stars-picker {
    display: inline-flex;
    align-items: center;
    gap: 1px;
  }
  .star-btn {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    color: var(--text-muted);
    font-size: 13px;
    cursor: pointer;
    line-height: 1;
    transition: color 0.15s, transform 0.1s;
  }
  .star-btn:hover:not(:disabled) {
    transform: scale(1.2);
  }
  .star-btn.active {
    color: #f59e0b;
    text-shadow: 0 0 4px rgba(245, 158, 11, 0.4);
  }
  .star-btn.user-picked {
    color: #eab308;
  }
  .star-btn:disabled {
    cursor: default;
  }
  .rating-score {
    color: var(--text-secondary);
    font-size: 11px;
  }
  .user-rated-pill {
    background: rgba(245, 158, 11, 0.15);
    border: 1px solid rgba(245, 158, 11, 0.3);
    color: #f59e0b;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 8px;
    margin-left: 2px;
  }

  .thread-posting-rules-wrap {
    margin-top: 12px;
    max-width: 520px;
  }

  :global(.forum-smilie) {
    display: inline-block;
    font-size: 1.15em;
    vertical-align: -0.15em;
    margin: 0 1px;
    line-height: 1;
  }

  /* === Feature 4: Thread Search & Quick Page Jump Styles === */
  .btn-thread-search {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: var(--radius);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-thread-search:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .btn-thread-search.active {
    background: var(--accent-glow);
    color: var(--accent);
    border-color: var(--border-accent);
  }

  .in-thread-search-bar {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 10px 14px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .search-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 240px;
  }
  .search-icon {
    position: absolute;
    left: 10px;
    font-size: 13px;
    pointer-events: none;
    opacity: 0.6;
  }
  .thread-search-input {
    width: 100%;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    padding: 7px 32px 7px 30px;
    font-size: 12px;
    color: var(--text-primary);
  }
  .thread-search-input:focus {
    border-color: var(--accent);
    outline: none;
  }
  .search-clear-btn {
    position: absolute;
    right: 8px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 16px;
    cursor: pointer;
    line-height: 1;
  }
  .search-results-count {
    font-size: 11px;
    color: var(--text-muted);
  }
  .no-thread-matches {
    padding: 32px;
    text-align: center;
    background: var(--bg-card);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-lg);
    color: var(--text-muted);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .page-jump-form {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 8px;
  }
  .jump-pg-label {
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 600;
  }
  .jump-pg-input {
    width: 44px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    padding: 3px 6px;
    font-size: 11px;
    color: var(--text-primary);
    text-align: center;
  }
  .jump-pg-input:focus {
    border-color: var(--accent);
    outline: none;
  }
  .jump-pg-go {
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 600;
    border-radius: var(--radius);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }
  .jump-pg-go:hover {
    background: var(--accent);
    color: var(--bg-primary);
    border-color: var(--accent);
  }

  /* === Feature 1: Thread Voice Lounge (Discord WebRTC) Styles === */
  .btn-voice-lounge {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: var(--radius);
    background: rgba(99, 102, 241, 0.15);
    border: 1px solid rgba(99, 102, 241, 0.35);
    color: #818cf8;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: all 0.15s;
  }
  .btn-voice-lounge:hover {
    background: rgba(99, 102, 241, 0.25);
    color: #a5b4fc;
  }
  .btn-voice-lounge.connected {
    background: rgba(16, 185, 129, 0.2);
    border-color: #10b981;
    color: #10b981;
  }

  .thread-voice-stage {
    background: linear-gradient(180deg, rgba(30, 27, 75, 0.45) 0%, var(--bg-card) 100%);
    border: 1px solid rgba(99, 102, 241, 0.35);
    border-radius: var(--radius-lg);
    padding: 14px;
    margin-bottom: 12px;
  }
  .voice-stage-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  .voice-stage-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-primary);
  }
  .live-pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #10b981;
    box-shadow: 0 0 8px #10b981;
  }
  .badge-live {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.4);
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 8px;
  }
  .stage-close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 18px;
    cursor: pointer;
    line-height: 1;
  }
  .voice-hint {
    color: var(--text-secondary);
    font-size: 12px;
    margin-bottom: 8px;
  }
  .voice-empty-state {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    color: var(--text-muted);
    font-size: 12px;
  }
  .voice-rooms-grid {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .voice-room-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    padding: 8px 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .voice-room-card:hover {
    border-color: #818cf8;
    background: rgba(99, 102, 241, 0.1);
  }
  .room-name {
    font-weight: 700;
    font-size: 12px;
    color: var(--text-primary);
  }
  .room-meta {
    font-size: 11px;
    color: var(--text-muted);
  }
  .voice-active-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .voice-peers-list {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .voice-peer-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 16px;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--text-secondary);
  }
  .voice-peer-pill.self {
    border-color: #818cf8;
    background: rgba(99, 102, 241, 0.15);
    color: var(--text-primary);
  }
  .peer-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--bg-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 9px;
  }
  .peer-name {
    font-weight: 600;
  }
  .peer-muted-icon {
    font-size: 10px;
  }
  .voice-controls-bar {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 4px;
  }
  .voice-ctrl-btn {
    padding: 5px 12px;
    font-size: 11px;
    font-weight: 600;
    border-radius: var(--radius);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }
  .voice-ctrl-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .voice-ctrl-btn.muted {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.4);
    color: var(--danger);
  }
  .btn-disconnect {
    background: rgba(239, 68, 68, 0.2);
    border-color: var(--danger);
    color: #f87171;
  }
  .btn-disconnect:hover {
    background: var(--danger);
    color: white;
  }

  /* === Feature 2: Classic vBulletin/phpBB Reputation Bar & Modal === */
  .rep-bar-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    margin: 6px 0 2px 0;
    width: 100%;
    cursor: help;
  }
  .rep-blocks {
    display: flex;
    gap: 3px;
    justify-content: center;
    align-items: center;
  }
  .rep-block {
    width: 12px;
    height: 7px;
    border-radius: 1px;
    display: inline-block;
    border: 1px solid rgba(0, 0, 0, 0.3);
  }
  .rep-level-text {
    font-size: 9px;
    font-weight: 600;
    text-align: center;
    line-height: 1.1;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rep-action-btn {
    color: #10b981;
    font-weight: 700;
  }
  .rep-action-btn:hover {
    background: rgba(16, 185, 129, 0.15);
    border-color: #10b981;
  }
  .rep-modal-content {
    max-width: 440px;
  }
  .rep-modal-body {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .rep-modal-desc {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0;
  }
  .rep-amount-picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--bg-tertiary);
    padding: 10px;
    border-radius: var(--radius);
    border: 1px solid var(--border-color);
  }
  .rep-radio-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-primary);
    cursor: pointer;
  }
  .rep-comment-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rep-input-label {
    font-size: 11px;
    color: var(--text-muted);
    font-weight: 600;
  }
  .rep-input {
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text-primary);
    width: 100%;
  }
  .rep-input:focus {
    border-color: var(--accent);
    outline: none;
  }

  /* === Feature 3: Currently Active Users Viewing Thread Styles === */
  .active-viewers-card {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 10px 14px;
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .active-viewers-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    color: var(--text-heading);
  }
  .active-viewers-icon {
    font-size: 14px;
  }
  .active-viewers-count {
    font-weight: 400;
    color: var(--text-muted);
    font-size: 11px;
    margin-left: 4px;
  }
  .active-viewers-list {
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .viewer-guest-only {
    color: var(--text-muted);
    font-style: italic;
  }
  .active-viewer-link {
    font-weight: 600;
    text-decoration: none;
  }
  .active-viewer-link:hover {
    text-decoration: underline;
  }
  .viewer-comma {
    color: var(--text-muted);
  }
</style>
