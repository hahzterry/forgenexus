<script lang="ts">
  import { auth } from '$lib/stores/auth.svelte';

  let {
    canPostThread = true,
    canReply = true,
    canAttach = true,
    canEdit = true,
    isLocked = false,
    editTimeLimit = 60
  }: {
    canPostThread?: boolean;
    canReply?: boolean;
    canAttach?: boolean;
    canEdit?: boolean;
    isLocked?: boolean;
    editTimeLimit?: number;
  } = $props();

  let mayPostThread = $derived(auth.isLoggedIn && canPostThread);
  let mayReply = $derived(auth.isLoggedIn && !isLocked && canReply);
  let mayAttach = $derived(auth.isLoggedIn && canAttach);
  let mayEdit = $derived(auth.isLoggedIn && canEdit);
</script>

<div class="posting-rules-card">
  <div class="rules-header">
    <span class="rules-icon">&#128220;</span>
    <span class="rules-title">Posting Rules</span>
  </div>
  <div class="rules-body">
    <ul class="rules-column">
      <li class="rule-item" class:allowed={mayPostThread} class:disallowed={!mayPostThread}>
        <span class="rule-bullet">{mayPostThread ? '✔' : '✖'}</span>
        You <strong>{mayPostThread ? 'MAY' : 'MAY NOT'}</strong> post new threads
      </li>
      <li class="rule-item" class:allowed={mayReply} class:disallowed={!mayReply}>
        <span class="rule-bullet">{mayReply ? '✔' : '✖'}</span>
        You <strong>{mayReply ? 'MAY' : 'MAY NOT'}</strong> post replies
      </li>
      <li class="rule-item" class:allowed={mayAttach} class:disallowed={!mayAttach}>
        <span class="rule-bullet">{mayAttach ? '✔' : '✖'}</span>
        You <strong>{mayAttach ? 'MAY' : 'MAY NOT'}</strong> post attachments
      </li>
      <li class="rule-item" class:allowed={mayEdit} class:disallowed={!mayEdit}>
        <span class="rule-bullet">{mayEdit ? '✔' : '✖'}</span>
        You <strong>{mayEdit ? 'MAY' : 'MAY NOT'}</strong> edit your posts {editTimeLimit > 0 ? `(${editTimeLimit}m)` : ''}
      </li>
    </ul>

    <ul class="rules-column">
      <li class="rule-item allowed">
        <span class="rule-bullet">✔</span>
        <a href="/help/bbcode" class="rule-link">BB code</a> is <strong>ON</strong>
      </li>
      <li class="rule-item allowed">
        <span class="rule-bullet">✔</span>
        <span class="rule-link">Smilies</span> are <strong>ON</strong>
      </li>
      <li class="rule-item allowed">
        <span class="rule-bullet">✔</span>
        <span class="rule-link">[IMG] code</span> is <strong>ON</strong>
      </li>
      <li class="rule-item disallowed">
        <span class="rule-bullet">✖</span>
        <span>HTML code</span> is <strong>OFF</strong>
      </li>
    </ul>
  </div>
</div>

<style>
  .posting-rules-card {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: var(--radius);
    overflow: hidden;
    font-size: 11px;
    color: var(--text-secondary);
  }

  .rules-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--bg-tertiary);
    border-bottom: 1px solid var(--border-color);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 11px;
    color: var(--text-muted);
  }

  .rules-icon {
    font-size: 12px;
  }

  .rules-body {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    padding: 10px 14px;
    line-height: 1.6;
  }

  .rules-column {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .rule-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
  }

  .rule-bullet {
    font-weight: 800;
    font-size: 11px;
    display: inline-block;
    width: 12px;
    text-align: center;
  }

  .rule-item.allowed .rule-bullet {
    color: var(--online, #10b981);
  }

  .rule-item.disallowed .rule-bullet {
    color: var(--danger, #ef4444);
  }

  .rule-item.allowed strong {
    color: var(--text-primary);
  }

  .rule-item.disallowed strong {
    color: var(--danger, #ef4444);
  }

  .rule-link {
    color: var(--accent);
    text-decoration: none;
  }
  .rule-link:hover {
    text-decoration: underline;
  }

  @media (max-width: 600px) {
    .rules-body {
      grid-template-columns: 1fr;
      gap: 6px;
    }
  }
</style>
