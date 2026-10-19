<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  let { channelSlug, messageIds, onclose, oncreated }: {
    channelSlug: string; messageIds: string[]; onclose: () => void; oncreated: (slug: string) => void;
  } = $props();
  let dialog: HTMLDialogElement;
  let preview = $state<any>(null);
  let title = $state('');
  let forumId = $state('');
  let error = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let requestId = '';
  onMount(() => {
    dialog.showModal();
    requestId = crypto.randomUUID();
    let active = true;
    api.request(`/channels/${encodeURIComponent(channelSlug)}/forum-topic/preview`, {
      method: 'POST', body: JSON.stringify({message_ids: messageIds})
    }).then(data => { if (active) { preview = data; forumId = data.forums[0]?.id || ''; } })
      .catch(e => { if (active) error = e?.error || 'Unable to load preview.'; })
      .finally(() => { if (active) loading = false; });
    return () => { active = false; };
  });
  async function createTopic() {
    if (saving || !preview) return;
    saving = true; error = '';
    try {
      const data = await api.request(`/channels/${encodeURIComponent(channelSlug)}/forum-topic`, {
        method: 'POST', body: JSON.stringify({title: title.trim(), forum_id: forumId,
          message_ids: messageIds, revision: preview.revision, request_id: requestId})
      });
      oncreated(data.thread.slug);
    } catch (e: any) { error = e?.error || 'Unable to create topic. You can retry safely.'; }
    finally { saving = false; }
  }
</script>

<dialog bind:this={dialog} aria-labelledby="chat-forum-title" oncancel={(e) => { if (saving) e.preventDefault(); }} onclose={onclose}>
  <h2 id="chat-forum-title">Create forum topic from chat</h2>
  <p>The selected text will be copied into a public forum with each author's name, timestamp, and a link to the original message. Attachments are not copied.</p>
  {#if loading}<p role="status">Loading preview…</p>{/if}
  {#if error}<p role="alert">{error}</p>{/if}
  {#if preview}
    <form onsubmit={(e) => { e.preventDefault(); void createTopic(); }}>
      <label>Topic title <input bind:value={title} minlength="3" maxlength="200" required disabled={saving} /></label>
      <label>Destination forum <select bind:value={forumId} required disabled={saving}>
        {#each preview.forums as forum}<option value={forum.id}>{forum.name}</option>{/each}
      </select></label>
      {#if !preview.forums.length}<p role="status">No public forums are available for this topic. Restricted, locked, and approval-only forums are excluded.</p>{/if}
      <h3>Preview · #{preview.channel.name}</h3>
      {#each preview.messages as message (message.id)}
        <blockquote><p><strong>{message.username}</strong> · {new Date(message.inserted_at).toLocaleString()} · <a href={message.url} target="_blank" rel="noopener noreferrer">View original message</a></p><p class="quoted-text">{message.body}</p></blockquote>
      {/each}
      <button type="submit" disabled={saving || !forumId || title.trim().length < 3}>{saving ? 'Creating topic…' : 'Create topic'}</button>
      <button type="button" disabled={saving} onclick={onclose}>Cancel</button>
    </form>
  {:else}<button type="button" onclick={onclose}>Close</button>{/if}
</dialog>

<style>
  dialog { color: var(--text-primary); background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius); padding: 24px; width: min(680px, 94vw); max-height: 85vh; overflow-y: auto; }
  dialog::backdrop { background: #0009; }
  p, h3 { margin: 12px 0; }
  label { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; }
  input, select { padding: 8px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color); }
  blockquote { border-left: 3px solid var(--accent); padding-left: 12px; margin: 16px 0; }
  .quoted-text { white-space: pre-wrap; overflow-wrap: anywhere; }
  button { padding: 8px 12px; margin: 6px 8px 0 0; cursor: pointer; }
</style>
