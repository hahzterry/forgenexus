// Start the isolated fixture using tests/fixtures/accessibility/vite.config.mjs on port 5174.
// No real backend writes: requests below use local, explicit fixtures.
const { chromium, expect: baseExpect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const expect = baseExpect.configure({ timeout: 15000 });
const BASE = process.env.FN_A11Y_URL || 'http://localhost:5174';
if (!['localhost', '127.0.0.1'].includes(new URL(BASE).hostname)) throw new Error('Use a local fixture server');
const out = process.env.FN_A11Y_REPORT_DIR || path.resolve(__dirname, '../test-results/accessibility');
fs.mkdirSync(out, { recursive: true });
const results = [];
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors = [], requests = [];
  try {
    await context.addInitScript(() => localStorage.setItem('fn_chat_themes', JSON.stringify({
      'conv-a': { nickname: 'Alpha', accentColor: '#00d4aa', bubbleStyle: 'classic', fontSize: 'normal' },
      'conv-b': { nickname: 'Beta', accentColor: '#112233', bubbleStyle: 'bubble', fontSize: 'large' }
    })));
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith('/api/')) return route.continue();
      requests.push(url.pathname);
      let data = { ok: true };
      if (url.pathname.endsWith('/activity-heatmap')) data = { heatmap: [{ date: new Date().toISOString().slice(0, 10), count: 4 }] };
      if (url.pathname.endsWith('/edits')) data = { edits: [{ id: 'edit-a', previous_body: 'Earlier message text', edited_by: null, inserted_at: '2026-10-17T00:00:00Z' }] };
      await route.fulfill({ json: data, headers: { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' } });
    });
    const page = await context.newPage();
    page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR', error.message); });
    await page.goto(BASE);
    await expect(page.getByRole('heading', { name: 'Accessibility regression fixture' })).toBeVisible();
    await expect(page.getByLabel('Nickname for conv-a')).toHaveValue('Alpha');
    expect(await page.locator('label[for]').evaluateAll(labels => labels.every(label => !!label.control))).toBe(true);
    expect(await page.locator('[id]').evaluateAll(nodes => nodes.map(n => n.id).filter((id, i, all) => all.indexOf(id) !== i))).toEqual([]);
    await page.locator('label').filter({ hasText: /^Body font$/ }).click();
    await expect(page.getByLabel('Body font', { exact: true })).toBeFocused();
    await expect(page.getByLabel('Accent', { exact: true })).toHaveCount(2);
    await expect(page.getByLabel('Accent hexadecimal value', { exact: true })).toHaveCount(2);
    await page.getByLabel('Biography', { exact: true }).fill('Accessible editing');
    results.push('associated labels, unique instance IDs, and accessible editor/color controls');

    await page.getByRole('button', { name: 'Switch conversation', exact: true }).click();
    await expect(page.getByLabel('Nickname for conv-b')).toHaveValue('Beta');
    await expect(page.getByRole('button', { name: 'bubble', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Nickname for conv-b').fill('Changed Beta');
    await page.getByRole('button', { name: 'Switch conversation', exact: true }).click();
    await expect(page.getByLabel('Nickname for conv-a')).toHaveValue('Alpha');
    await page.getByRole('button', { name: 'Switch conversation', exact: true }).click();
    await expect(page.getByLabel('Nickname for conv-b')).toHaveValue('Changed Beta');
    results.push('conversation changes reload their own settings without losing edits');

    const moderation = page.getByRole('region', { name: 'Moderation', exact: true });
    await moderation.getByRole('button', { name: 'Switch moderation state', exact: true }).click();
    await expect(moderation.getByRole('button', { name: 'Unlock', exact: true })).toBeVisible();
    await expect(moderation.getByRole('button', { name: 'Unpin', exact: true })).toBeVisible();
    await expect(moderation.getByRole('button', { name: 'Unhide', exact: true })).toHaveCount(2);
    await moderation.getByRole('button', { name: 'Unlock', exact: true }).click();
    await expect(moderation.getByRole('button', { name: 'Lock', exact: true })).toBeVisible();
    expect(requests.some(p => p.includes('thread-b') && p.endsWith('/unlock'))).toBe(true);
    results.push('moderation labels and API targets follow updated thread/post props');

    const history = page.getByRole('button', { name: 'Open history', exact: true });
    await history.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Edit History', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Earlier message text');
    for (let i = 0; i < 4; i++) { await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab'); expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true); }
    await dialog.getByText('Earlier message text', { exact: true }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(history).toBeFocused();
    await history.press('Enter'); await expect(dialog).toBeVisible(); await dialog.click({ position: { x: 5, y: 5 } }); await expect(dialog).toHaveCount(0);
    results.push('native dialog focus trap, Escape, backdrop dismissal, and focus restoration');

    const trigger = page.getByRole('button', { name: 'Enlarge Green rectangle', exact: true });
    await trigger.focus(); await page.keyboard.press('Space');
    await expect(page.getByRole('dialog', { name: 'Green rectangle', exact: true })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    results.push('keyboard image enlargement and return focus');

    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Command search', exact: true })).toBeVisible();
    const search = page.getByRole('combobox', { name: 'Search commands', exact: true });
    await expect(search).toBeFocused();
    await page.keyboard.press('Tab'); await expect(search).toBeFocused();
    await search.fill('Forums');
    await expect(page.getByRole('listbox', { name: 'Commands' }).getByRole('option')).toHaveCount(1);
    const activeId = await search.getAttribute('aria-activedescendant');
    await expect(page.locator(`[id="${activeId}"]`)).toHaveRole('option');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Toggle palette component', exact: true }).click();
    await page.keyboard.press('Control+k'); await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Toggle palette component', exact: true }).click();
    await page.keyboard.press('Control+k'); await expect(page.getByRole('dialog', { name: 'Command search', exact: true })).toHaveCount(1); await page.keyboard.press('Escape');
    results.push('command combobox semantics and keyboard listener cleanup on unmount');

    const author = page.getByRole('link', { name: 'Builder profile', exact: true });
    await author.focus(); await expect(page.getByRole('link', { name: 'View Profile', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'View Profile', exact: true }).focus();
    await expect(page.getByRole('link', { name: 'View Profile', exact: true })).toBeFocused();
    await page.keyboard.press('Escape'); await expect(page.getByRole('link', { name: 'View Profile', exact: true })).toHaveCount(0); await expect(author).toBeFocused();
    results.push('profile preview supports focus, internal navigation, and Escape');

    const heatmap = page.getByRole('group', { name: 'Daily posting activity', exact: true });
    const firstDay = heatmap.locator('button').first(); await firstDay.focus(); await page.keyboard.press('ArrowDown');
    await expect(heatmap.locator('button').nth(1)).toBeFocused();
    await expect(heatmap.locator('button[tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('Home'); await expect(firstDay).toBeFocused();
    results.push('activity heatmap uses one tab stop and arrow/Home navigation');

    await page.getByRole('combobox', { name: 'Select flow node', exact: true }).selectOption('node-a');
    const flow = page.getByRole('region', { name: 'Flow editor', exact: true });
    await expect(flow.locator('output')).toContainText('100, 100');
    await flow.getByRole('button', { name: 'Move right', exact: true }).focus(); await page.keyboard.press('Space');
    await expect(flow.locator('output')).toContainText('105, 100');
    await page.keyboard.press('ArrowDown'); await expect(flow.locator('output')).toContainText('105, 105');
    await expect(page.getByLabel('max count', { exact: true })).toHaveValue('2');
    await expect(page.getByLabel('note', { exact: true })).toHaveValue('Fixture note');
    expect(await page.locator('label[for]').evaluateAll(labels => labels.every(label => !!label.control))).toBe(true);
    expect(await page.locator('[id]').evaluateAll(nodes => nodes.map(n => n.id).filter((id, i, all) => all.indexOf(id) !== i))).toEqual([]);
    const ordinary = page.getByLabel('Ordinary typing field', { exact: true }); await ordinary.fill(''); await ordinary.pressSequentially('two words'); await expect(ordinary).toHaveValue('two words'); await ordinary.press('Backspace'); await expect(ordinary).toHaveValue('two word');
    results.push('flow selection/movement, dynamic field labels, and ordinary typing shortcuts');

    await page.getByRole('button', { name: 'Pen color #ef4444', exact: true }).focus(); await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Pen color #ef4444', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('slider', { name: 'Brush size', exact: true })).toBeVisible();
    results.push('drawing palette names, selected state, and keyboard activation');

    await page.getByRole('button', { name: 'Show notification', exact: true }).click();
    const dismiss = page.getByRole('button', { name: 'Dismiss notification', exact: true }); await dismiss.focus(); await page.keyboard.press('Space'); await expect(dismiss).toHaveCount(0);
    expect(page.url()).not.toContain('#notification');
    expect(await page.locator('button button').count()).toBe(0);
    results.push('notification dismissal is independent of opening and has no nested buttons');
    expect(errors).toEqual([]);
    await page.screenshot({ path: path.join(out, 'components-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await history.click(); await expect(dialog).toBeVisible(); expect(await dialog.evaluate(node => { const r = node.getBoundingClientRect(); return r.width <= innerWidth && r.height <= innerHeight; })).toBe(true); await page.keyboard.press('Escape');
    results.push('native overlay stays within the phone viewport');
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ results, errors }, null, 2));
    console.log('PASSED', results.length, 'accessibility/functionality scenarios');
  } finally { await browser.close(); }
})().catch(error => { fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ results, error: error.stack }, null, 2)); console.error(error); process.exitCode = 1; });
