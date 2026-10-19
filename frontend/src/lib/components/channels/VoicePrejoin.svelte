<script lang="ts">
  import { untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { voiceSetup } from '$lib/stores/voiceSetup.svelte';
  import { voiceStore } from '$lib/stores/voice.svelte';

  let microphones = $state<MediaDeviceInfo[]>([]);
  let cameras = $state<MediaDeviceInfo[]>([]);
  let microphoneId = $state('');
  let cameraId = $state('');
  let camera = $state(false);
  let muted = $state(false);
  let stream = $state<MediaStream | null>(null);
  let busy = $state(false);
  let error = $state('');
  let level = $state(0);
  let generation = 0;
  let audio: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const roomName = $derived(voiceSetup.name || voiceStore.rooms.find(room => room.id === voiceSetup.roomId)?.name || 'Live room');

  function release() {
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    if (timer) clearInterval(timer);
    timer = null;
    if (audio) void audio.close();
    audio = null;
    level = 0;
  }
  function stop() { generation++; release(); busy = false; }
  async function devices() {
    const list = await navigator.mediaDevices.enumerateDevices();
    microphones = list.filter(device => device.kind === 'audioinput');
    cameras = list.filter(device => device.kind === 'videoinput');
  }
  async function preview() {
    const current = ++generation;
    release(); busy = true; error = '';
    try {
      const captured = await navigator.mediaDevices.getUserMedia({
        audio: { ...(microphoneId ? { deviceId: { exact: microphoneId } } : {}), echoCancellation: true, noiseSuppression: true },
        video: camera ? (cameraId ? { deviceId: { exact: cameraId } } : true) : false
      });
      if (current !== generation || !voiceSetup.roomId) { captured.getTracks().forEach(track => track.stop()); return; }
      stream = captured;
      captured.getTracks().forEach(track => track.addEventListener('ended', () => {
        if (current === generation && voiceSetup.roomId) { stop(); error = 'A preview device disconnected. Choose an available device and retry.'; }
      }, { once: true }));
      audio = new AudioContext();
      const analyser = audio.createAnalyser(); analyser.fftSize = 512;
      audio.createMediaStreamSource(captured).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      timer = setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
        level = Math.min(100, Math.round(rms * 300));
      }, 80);
      await devices();
    } catch (cause: any) {
      if (current === generation) { release(); error = cause?.message || 'Unable to preview devices. Check your browser permissions.'; }
    } finally { if (current === generation) busy = false; }
  }
  function confirm() {
    const choice = { microphoneId, cameraId, camera, muted };
    try { localStorage.setItem('fn-voice-devices', JSON.stringify({ microphoneId, cameraId })); } catch { /* Storage can be unavailable. */ }
    stop(); voiceSetup.finish(choice);
  }
  function openDialog(node: HTMLDialogElement) {
    node.showModal();
    const changed = () => { void devices().catch(() => {}); };
    navigator.mediaDevices.addEventListener('devicechange', changed);
    return { destroy() { node.close(); navigator.mediaDevices.removeEventListener('devicechange', changed); } };
  }
  $effect(() => {
    const id = voiceSetup.roomId;
    untrack(() => {
      if (!id) { stop(); return; }
      camera = false; muted = false; error = '';
      try { const saved = JSON.parse(localStorage.getItem('fn-voice-devices') || '{}'); microphoneId = saved.microphoneId || ''; cameraId = saved.cameraId || ''; } catch { microphoneId = ''; cameraId = ''; }
      void preview();
    });
    return () => { stop(); };
  });
  beforeNavigate(() => voiceSetup.finish(null));
</script>

{#if voiceSetup.roomId}
  <dialog use:openDialog aria-labelledby="voice-setup-title" aria-describedby="voice-setup-description" oncancel={(event) => { event.preventDefault(); voiceSetup.finish(null); }}>
    <h2 id="voice-setup-title">Join {roomName}</h2>
    <p id="voice-setup-description">Check your devices. Your preview stays on this device until you join.</p>
    <div class="preview">
      {#if camera && stream?.getVideoTracks().length}
        <video aria-label="Camera preview" autoplay muted playsinline srcObject={stream}></video>
      {:else}<p>Camera is off</p>{/if}
    </div>
    <label for="voice-microphone">Microphone</label>
    <select id="voice-microphone" bind:value={microphoneId} onchange={() => void preview()}>
      <option value="">System default microphone</option>
      {#each microphones as device, index}<option value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>{/each}
    </select>
    <label for="voice-mic-meter">Microphone level</label>
    <meter id="voice-mic-meter" min="0" max="100" value={level}></meter>
    <p class="hint">Speak to test your microphone. You will not hear this preview.</p>
    <label for="voice-camera">Camera</label>
    <select id="voice-camera" bind:value={cameraId} onchange={() => { if (camera) void preview(); }}>
      <option value="">System default camera</option>
      {#each cameras as device, index}<option value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>{/each}
    </select>
    <label class="choice"><input type="checkbox" bind:checked={camera} onchange={() => void preview()} />Turn on camera</label>
    <label class="choice"><input type="checkbox" bind:checked={muted} />Join with microphone muted</label>
    {#if error}<p role="alert">{error}</p><button onclick={() => void preview()}>Retry preview</button>{/if}
    <div class="actions"><button onclick={() => voiceSetup.finish(null)}>Cancel</button><button class="btn-primary" disabled={busy || !stream || !!error} onclick={confirm}>{busy ? 'Preparing devices…' : 'Join room'}</button></div>
  </dialog>
{/if}

<style>
  dialog { width: min(480px, calc(100vw - 32px)); max-height: 90dvh; overflow: auto; box-sizing: border-box; padding: 24px; border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg-secondary, #171923); color: var(--text-primary); }
  dialog::backdrop { background: #000a; }
  h2 { margin-top: 0; } p { line-height: 1.5; }
  .preview { aspect-ratio: 16/9; background: #000; display: grid; place-items: center; border-radius: 8px; overflow: hidden; }
  video { width: 100%; height: 100%; object-fit: contain; transform: scaleX(-1); }
  label { display: block; margin-top: 14px; margin-bottom: 5px; }
  select, meter { width: 100%; } select { padding: 8px; background: var(--bg-primary); color: inherit; border: 1px solid var(--border-color); border-radius: 5px; }
  .choice { display: flex; gap: 8px; align-items: center; }
  .choice input { width: 18px; height: 18px; flex: 0 0 auto; margin: 0; }
  .hint { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
  .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
  button { padding: 8px 14px; cursor: pointer; border: 1px solid var(--border-color); border-radius: 5px; background: var(--bg-primary); color: inherit; }
  button.btn-primary { background: var(--accent); color: #081410; } button:disabled { cursor: wait; opacity: .6; }
  [role='alert'] { color: var(--danger, #ff8585); }
</style>
