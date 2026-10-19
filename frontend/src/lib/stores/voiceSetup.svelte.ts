import type { VoiceJoinOptions } from './voice.svelte';

let roomId = $state<string | null>(null);
let name = $state('');
let trigger: HTMLElement | null = null;
let resolveChoice: ((choice: VoiceJoinOptions | null) => void) | null = null;
export const voiceSetup = {
  get roomId() { return roomId; },
  get name() { return name; },
  choose(id: string, roomName = ''): Promise<VoiceJoinOptions | null> {
    this.finish(null);
    trigger = document.activeElement as HTMLElement | null;
    roomId = id;
    name = roomName;
    return new Promise(resolve => { resolveChoice = resolve; });
  },
  finish(choice: VoiceJoinOptions | null) {
    const resolve = resolveChoice;
    const previous = trigger;
    trigger = null;
    resolveChoice = null;
    roomId = null;
    name = '';
    resolve?.(choice);
    if (!choice && previous) requestAnimationFrame(() => { if (previous.isConnected) previous.focus(); });
  }
};
