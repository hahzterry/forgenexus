<script lang="ts">
  import { voiceStore } from '$lib/stores/voice.svelte';
  let blocked = $state(false);
  const players = new Set<HTMLAudioElement>();
  function play(node: HTMLAudioElement) {
    void node.play().catch(error => {
      if (error?.name === 'NotAllowedError') blocked = true;
    });
  }
  function attach(node: HTMLAudioElement, stream: MediaStream) {
    players.add(node);
    node.srcObject = stream;
    play(node);
    return {
      update(next: MediaStream) {
        if (node.srcObject !== next) { node.srcObject = next; play(node); }
      },
      destroy() { players.delete(node); node.pause(); node.srcObject = null; if (!players.size) blocked = false; }
    };
  }
  function resume() { blocked = false; for (const node of players) play(node); }
</script>

{#each [...voiceStore.remoteStreams.entries()] as [userId, stream] (userId)}
  <audio data-voice-user={userId} aria-label="Voice participant audio" autoplay use:attach={stream}></audio>
{/each}
{#if voiceStore.isReconnecting}
  <div class="voice-reconnecting" role="status">Reconnecting to voice…</div>
{/if}
{#if blocked}
  <button type="button" class="enable-voice-audio" onclick={resume}>Enable voice audio</button>
{/if}

<style>
  .voice-reconnecting { position: fixed; bottom: 125px; left: 16px; z-index: 200; padding: 10px 16px; background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius); }
  .enable-voice-audio { position: fixed; bottom: 80px; left: 16px; z-index: 200; padding: 10px 16px; border: 1px solid var(--border-color); border-radius: var(--radius); background: var(--bg-card); color: var(--text-primary); cursor: pointer; }
</style>
