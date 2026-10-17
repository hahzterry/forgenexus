<script lang="ts">
  import { onMount } from 'svelte';
  import '../../../src/app.css';
  import ColorPicker from '$lib/components/settings/ColorPicker.svelte';
  import FontPicker from '$lib/components/settings/FontPicker.svelte';
  import BBCodeEditor from '$lib/components/settings/BBCodeEditor.svelte';
  import ChatSettings from '$lib/components/chat/ChatSettings.svelte';
  import PostModToolbar from '$lib/components/moderation/PostModToolbar.svelte';
  import ThreadModToolbar from '$lib/components/moderation/ThreadModToolbar.svelte';
  import EditHistoryModal from '$lib/components/channels/EditHistoryModal.svelte';
  import CommandPalette from '$lib/components/common/CommandPalette.svelte';
  import ImageLightbox from '$lib/components/common/ImageLightbox.svelte';
  import UserHoverCard from '$lib/components/common/UserHoverCard.svelte';
  import ActivityHeatmap from '$lib/components/profile/ActivityHeatmap.svelte';
  import NodeConfigPanel from '$lib/components/flow-editor/NodeConfigPanel.svelte';
  import Canvas from '$lib/components/flow-editor/Canvas.svelte';
  import DrawCanvas from '$lib/components/chat/DrawCanvas.svelte';
  import NotificationToaster from '$lib/components/layout/NotificationToaster.svelte';
  import { notificationStore } from '$lib/stores/notifications.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { canvasState } from '$lib/components/flow-editor/canvas-state.svelte';
  let colorA = $state('#112233'), colorB = $state('#445566'), fontA = $state('Inter'), fontB = $state('Georgia'), biography = $state('');
  let conversation = $state('conv-a');
  let moderation = $state(false);
  let showHistory = $state(false);
  let showPalette = $state(true);
  onMount(() => {
    auth.setUser({ id: 'fixture-user', username: 'Fixture', is_staff: true } as any);
    canvasState.init({ id: 'fixture-flow', name: 'Fixture flow', status: 'draft', nodes: [{ id: 'node-a', type: 'fixture', category: 'action', label: 'First node', position_x: 100, position_y: 100, config: {} }], edges: [] } as any, [{ type: 'fixture', label: 'Fixture', category: 'action', inputs: [], outputs: [], config_fields: [{ name: 'max_count', type: 'number', default: 2 }, { name: 'enabled', type: 'boolean', default: true }, { name: 'note', type: 'text', default: 'Fixture note' }] }] as any);
  });
</script>
<main>
  <h1>Accessibility regression fixture</h1>
  <section aria-label="Form controls"><h2>Form controls</h2><ColorPicker label="Accent" bind:value={colorA} /><ColorPicker label="Accent" bind:value={colorB} /><FontPicker label="Body font" bind:value={fontA}/><FontPicker label="Heading font" bind:value={fontB}/><BBCodeEditor label="Biography" bind:value={biography}/></section>
  <section aria-label="Chat settings"><h2>Chat settings</h2><button type="button" onclick={() => conversation = conversation === 'conv-a' ? 'conv-b' : 'conv-a'}>Switch conversation</button><ChatSettings conversationId={conversation} recipientName={conversation} onClose={() => {}} onThemeChange={() => {}} /></section>
  <section aria-label="Moderation"><h2>Moderation</h2><button type="button" onclick={() => moderation = !moderation}>Switch moderation state</button><ThreadModToolbar threadId={moderation ? 'thread-b' : 'thread-a'} isLocked={moderation} isPinned={moderation} isHidden={moderation}/><PostModToolbar postId={moderation ? 'post-b' : 'post-a'} userId="fixture-user" isHidden={moderation}/></section>
  <section aria-label="Dialogs"><h2>Dialogs</h2><button type="button" onclick={() => showHistory = true}>Open history</button>{#if showHistory}<EditHistoryModal channelSlug="fixture" messageId="message-a" onClose={() => showHistory = false}/>{/if}<ImageLightbox src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='60'%3E%3Crect width='80' height='60' fill='green'/%3E%3C/svg%3E" alt="Green rectangle"/><button type="button" onclick={() => showPalette = !showPalette}>Toggle palette component</button>{#if showPalette}<CommandPalette/>{/if}</section>
  <section aria-label="Profile previews"><h2>Profile previews</h2><UserHoverCard username="Builder" slug="builder" postCount={4} reputation={2}><a href="#builder">Builder profile</a></UserHoverCard><ActivityHeatmap slug="builder"/></section>
  <section aria-label="Flow editor"><h2>Flow editor</h2><div style="height:400px"><Canvas/></div><NodeConfigPanel/><input aria-label="Ordinary typing field" placeholder="Spaces and Backspace must keep working"/></section>
  <section aria-label="Drawing"><h2>Drawing</h2><DrawCanvas onSend={() => {}} onClose={() => {}}/></section>
  <button type="button" onclick={() => notificationStore.onNewNotification({ id: 'notif-a', type: 'mention', title: 'Fixture notification', body: 'Keyboard notification test', is_read: false, url: '#notification', inserted_at: new Date().toISOString() } as any)}>Show notification</button>
  <NotificationToaster/>
</main>
<style>main{max-width:1000px;margin:auto;padding:24px}section{margin:20px 0;padding:16px;border:1px solid var(--border-color)}h2{margin-bottom:12px}button{padding:6px 10px}section :global(.chat-settings){max-height:none}section :global(.draw-canvas){position:relative}</style>
