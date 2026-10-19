import { test, expect, type Page } from '@playwright/test';

// Deterministic route and socket fixtures. These tests never write to a backend
// or request a real microphone. Fail when a feature is absent rather than skip.
const cors = { 'access-control-allow-origin': 'http://localhost:5173', 'access-control-allow-credentials': 'true' };
const member = { id: 'member', username: 'Builder', slug: 'builder', email: 'builder@example.test', email_verified: true, inserted_at: '2026-10-17T00:00:00Z', post_count: 3, thread_count: 1, reputation: 2 };
const author = { ...member, id: 'author', username: 'Author', slug: 'author' };
const forum = { id: 'forum', name: 'Workshop', slug: 'workshop', thread_count: 2, post_count: 27, children: [], rules: [], is_locked: false };
const thread = { id: 'thread', slug: 'review-thread', title: 'Review thread', user: author, forum, reply_count: 25, view_count: 10, is_locked: false, is_pinned: false, tags: [], inserted_at: '2026-10-17T00:00:00Z' };
const post = (id: string, body: string, body_html = body) => ({ id, body, body_html, user: author, inserted_at: '2026-10-17T00:00:00Z', like_count: 0, ratings: [], attachments: [] });
const pages = [
  [post('p1', 'Alpha collaboration'), post('p2', 'Beta discussion')],
  [post('p26', 'Page two')]
];

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => localStorage.setItem('fn_cookie_consent', 'accepted'));
  // Forum behavior must not wait for third-party font servers.
  await context.route(/^https:\/\/(fonts\.cdnfonts\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort());
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname.replace(/^\/api/, '');
    let data: unknown = {};
    if (path === '/auth/me') data = { user: member };
    else if (path === '/auth/refresh') data = { token: 'fixture-token' };
    else if (path === '/settings/public') data = { settings: { chat_bar_enabled: false, shoutbox_enabled: false } };
    else if (path === '/forums') data = { categories: [{ id: 'category', name: 'Community', forums: [forum] }], unread_counts: {} };
    else if (path === '/threads/review-thread') data = { thread, posts: pages[Number(url.searchParams.get('page') || 1) - 1] || [], total_pages: 2 };
    else if (path === '/threads/second-thread') data = { thread: { ...thread, id: 'second', slug: 'second-thread', title: 'Second thread' }, posts: [post('second-post', 'Second thread body')] };
    else if (path === '/threads/thread/rating') data = { rating: { average: 3, count: 2 }, user_rating: 3 };
    else if (path === '/threads/second/rating') data = { rating: { average: 0, count: 0 }, user_rating: null };
    else if (path === '/voice/rooms') data = { rooms: [{ id: 'room-id', name: 'Named lounge', participant_count: 3, participants: [] }] };
    else if (path === '/themes') data = { themes: [] };
    else if (path === '/onboarding') data = { onboarding: { status: 'not_started', reviewed_steps: [], navigation_mode: 'full' } };
    else if (path === '/preferences') data = { preferences: {} };
    else if (path === '/users/online') data = { users: [], stats: { total: 0, members: 0, guests: 0 }, groups: [] };
    else if (path === '/notifications') data = { notifications: [], unread_count: 0 };
    else if (path === '/bookmarks') data = { bookmarks: [] };
    else if (path === '/search') data = { threads: [], results: [] };
    await route.fulfill({ headers: cors, json: data });
  });
  await context.routeWebSocket('**/socket/**', ws => ws.onMessage(raw => {
    const [join, ref, topic, event] = JSON.parse(String(raw));
    if (event === 'phx_join' || event === 'heartbeat') ws.send(JSON.stringify([join, ref, topic, 'phx_reply', { status: topic.startsWith('voice:') ? 'error' : 'ok', response: { reason: 'Fixture room unavailable' } }]));
  }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  (page as Page & { fixtureErrors: string[] }).fixtureErrors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as Page & { fixtureErrors: string[] }).fixtureErrors).toEqual([]);
});

async function openThread(page: Page) {
  await page.goto('/threads/review-thread');
  await expect(page.locator('.post-body').first()).toContainText('Alpha');
  await expect(page.locator('.btn-voice-lounge')).toBeVisible();
}

test('board categories collapse and expand with the keyboard', async ({ page }) => {
  await page.goto('/forums');
  await expect(page.getByRole('link', { name: 'Workshop', exact: true })).toBeVisible();
  const collapse = page.getByRole('button', { name: 'Collapse Category' });
  await collapse.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Workshop', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand Category' }).press('Enter');
  await expect(page.getByRole('link', { name: 'Workshop', exact: true })).toBeVisible();
});

test('thread filtering and page jumping use actual controls', async ({ page }) => {
  await openThread(page);
  await page.locator('.btn-thread-search').click();
  const filter = page.getByRole('textbox', { name: 'Filter posts on this page by text or author' });
  await filter.fill('Beta');
  await expect(page.locator('.post-box')).toHaveCount(1);
  await expect(page.locator('.post-body')).toHaveText('Beta discussion');
  await page.locator('.search-clear-btn').click();
  await expect(page.locator('.post-box')).toHaveCount(2);
  await page.locator('#jump-pg-top').fill('2');
  await page.locator('.page-jump-go, .jump-pg-go').first().click();
  await expect(page.locator('.post-body')).toHaveText('Page two');
});

test('rating buttons submit their value and expose selection', async ({ page }) => {
  await openThread(page);
  await expect(page.getByRole('button', { name: 'Rate 3 out of 5 stars' })).toHaveAttribute('aria-pressed', 'true');
  let submitted: unknown;
  await page.route('**/api/threads/thread/rating', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ headers: cors, json: { rating: { average: 4, count: 3 } } });
  });
  await page.getByRole('button', { name: 'Rate 4 out of 5 stars' }).click();
  await expect(page.locator('.user-rated-pill')).toContainText('4');
  expect(submitted).toEqual({ rating: 4 });
});

test('closing a reputation dialog during submission preserves the recipient', async ({ page }) => {
  await openThread(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => release = resolve);
  let payload: unknown;
  await page.route('**/api/reputation', async route => {
    payload = route.request().postDataJSON();
    await gate;
    await route.fulfill({ headers: cors, json: { ok: true } });
  });
  await page.locator('.rep-action-btn').first().click();
  const dialog = page.getByRole('dialog', { name: 'Award Reputation to Author' });
  await dialog.getByRole('button', { name: /Add Reputation/ }).click();
  await expect.poll(() => payload).toMatchObject({ user_id: 'author', amount: 1 });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  release();
  await expect(page.getByRole('alert')).toContainText('reputation given to Author');
  await expect(page.locator('.stat-line').filter({ hasText: /^Rep:/ }).first()).toContainText('3');
});

test('smilies preserve link attributes and code; quote authors are keyboard controls', async ({ page }) => {
  await page.route('**/api/threads/review-thread?*', route => route.fulfill({ headers: cors, json: { thread, posts: [post('p1', 'Alpha :smile:', '<p>Alpha :smile: <a href="/search?q=:smile:">Link</a></p><pre><code>:smile:</code></pre><blockquote class="bbcode-quote"><cite>Author</cite>Quote</blockquote>')] } }));
  await openThread(page);
  await expect(page.locator('.post-body .forum-smilie')).toHaveText('😊');
  await expect(page.locator('.post-body a')).toHaveAttribute('href', '/search?q=:smile:');
  await expect(page.locator('.post-body code')).toHaveText(':smile:');
  await expect(page.locator('cite').getByRole('button', { name: 'Author' })).toBeVisible();
  await page.getByRole('button', { name: 'Smile (:smile:)', exact: true }).click();
  await expect(page.locator('.reply-textarea')).toHaveValue(' :smile: ');
});

test('presence is labelled community-wide and muting does not revoke posting', async ({ page }) => {
  await openThread(page);
  await expect(page.locator('.active-viewers-title')).toHaveText('Currently Active Users Across the Community');
  await expect(page.locator('.active-viewers-card')).not.toContainText('guests are reading');
  await expect(page.locator('.active-viewers-count')).not.toContainText('guest');
  await page.locator('.btn-mute').click();
  await expect(page.locator('.btn-mute')).toHaveText('Unmute');
  await expect(page.locator('.posting-rules-card')).toContainText('MAY post replies');
});

test('voice uses room IDs and participant counts and reports join failure', async ({ page }) => {
  const topics: string[] = [];
  await page.context().routeWebSocket('**/socket/**', ws => ws.onMessage(raw => {
    const [join, ref, topic, event] = JSON.parse(String(raw));
    if (event === 'phx_join') topics.push(topic);
    if (event === 'phx_join' || event === 'heartbeat') ws.send(JSON.stringify([join, ref, topic, 'phx_reply', { status: topic.startsWith('voice:') ? 'error' : 'ok', response: {} }]));
  }));
  await openThread(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { const context = new AudioContext(); return context.createMediaStreamDestination().stream; } });
  });
  await expect(page.locator('.btn-voice-lounge')).toBeVisible();
  await page.locator('.btn-voice-lounge').click();
  const room = page.getByRole('button', { name: 'Named lounge 3 participants' });
  await expect(room).toBeVisible();
  await room.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Join room', exact: true }).click();
  await expect.poll(() => topics).toContain('voice:room-id');
  await expect(page.getByRole('alert')).toContainText('Unable to join voice room');
  await expect(page.getByRole('alert')).not.toContainText('Connected to Voice Lounge!');
});

test('empty voice room list never offers an invalid general room', async ({ page }) => {
  await page.route('**/api/voice/rooms', route => route.fulfill({ headers: cors, json: { rooms: [] } }));
  await openThread(page);
  await page.locator('.btn-voice-lounge').click();
  await expect(page.getByRole('link', { name: 'Browse community chat' })).toHaveAttribute('href', '/chat');
  await expect(page.getByRole('button', { name: 'Start General Lounge' })).toHaveCount(0);
});
