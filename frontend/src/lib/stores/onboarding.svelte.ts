import { api } from '$lib/api/client';
export type GuideState = { status: 'not_started' | 'active' | 'paused' | 'completed'; reviewed_steps: string[]; navigation_mode: 'simple' | 'full' };
let state = $state<GuideState | null>(null);
let owner = $state<string | null>(null);
let loading = $state(false);
let saving = $state(false);
let error = $state('');
let generation = 0;
export const onboarding = {
  get state() { return state; }, get owner() { return owner; },
  get loading() { return loading; }, get saving() { return saving; }, get error() { return error; },
  reset() { ++generation; owner = null; state = null; loading = false; saving = false; error = ''; },
  async load(userId: string, force = false) {
    if (owner === userId && (loading || (!force && state))) return;
    const request = ++generation;
    owner = userId; state = null; error = ''; loading = true; saving = false;
    try {
      const data = await api.request('/onboarding');
      if (request === generation) state = data.onboarding;
    } catch { if (request === generation) error = 'Your guide could not be loaded. Please retry.'; }
    finally { if (request === generation) loading = false; }
  },
  async change(userId: string, action: Record<string, string>) {
    if (saving || owner !== userId) return;
    const request = generation;
    saving = true; error = '';
    try {
      const data = await api.request('/onboarding', {method: 'PUT', body: JSON.stringify(action)});
      if (request === generation) state = data.onboarding;
    } catch (e: any) { if (request === generation) error = e?.error || 'Changes could not be saved. Please retry.'; throw e; }
    finally { if (request === generation) saving = false; }
  }
};
