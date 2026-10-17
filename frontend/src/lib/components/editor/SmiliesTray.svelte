<script lang="ts">
  let { onSelect }: { onSelect: (code: string) => void } = $props();

  let expanded = $state(false);

  const classicSmilies = [
    { code: ':smile:', emoji: '😊', label: 'Smile' },
    { code: ':biggrin:', emoji: '😀', label: 'Big Grin' },
    { code: ':wink:', emoji: '😉', label: 'Wink' },
    { code: ':tongue:', emoji: '😛', label: 'Stick Out Tongue' },
    { code: ':cool:', emoji: '😎', label: 'Cool' },
    { code: ':rolleyes:', emoji: '🙄', label: 'Roll Eyes' },
    { code: ':mad:', emoji: '😡', label: 'Mad / Angry' },
    { code: ':eek:', emoji: '😲', label: 'Eek / Shocked' },
    { code: ':confused:', emoji: '😕', label: 'Confused' },
    { code: ':oops:', emoji: '😳', label: 'Embarrassed' },
    { code: ':cry:', emoji: '😢', label: 'Crying' },
    { code: ':lol:', emoji: '🤣', label: 'Laugh Out Loud' },
    { code: ':thumbsup:', emoji: '👍', label: 'Thumbs Up' },
    { code: ':thumbsdown:', emoji: '👎', label: 'Thumbs Down' },
    { code: ':beer:', emoji: '🍻', label: 'Cheers / Beer' },
    { code: ':heart:', emoji: '❤️', label: 'Heart' },
    { code: ':fire:', emoji: '🔥', label: 'Fire' },
    { code: ':ninja:', emoji: '🥷', label: 'Ninja' },
    { code: ':facepalm:', emoji: '🤦', label: 'Facepalm' },
    { code: ':shrug:', emoji: '🤷', label: 'Shrug' }
  ];

  // Top 10 quick smilies shown inline; all 20 shown when expanded
  let displayedSmilies = $derived(expanded ? classicSmilies : classicSmilies.slice(0, 10));
</script>

<div class="smilies-tray">
  <div class="smilies-bar">
    <span class="smilies-title" title="Click to insert BBCode smilie code">&#128512; Smilies:</span>
    <div class="smilies-list">
      {#each displayedSmilies as smilie}
        <button
          type="button"
          class="smilie-btn" aria-label={`${smilie.label} (${smilie.code})`}
          title={`${smilie.label} (${smilie.code})`}
          onclick={(e) => {
            e.preventDefault();
            onSelect(` ${smilie.code} `);
          }}
        >
          <span class="smilie-icon">{smilie.emoji}</span>
        </button>
      {/each}
    </div>
    <button
      type="button"
      class="smilies-toggle" aria-expanded={expanded}
      onclick={() => expanded = !expanded}
      title={expanded ? 'Show fewer smilies' : 'View all classic smilies'}
    >
      {expanded ? '« Less' : 'More »'}
    </button>
  </div>
</div>

<style>
  .smilies-tray {
    padding: 4px 8px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-top: none;
    border-radius: 0 0 var(--radius) var(--radius);
    font-size: 11px;
  }

  .smilies-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .smilies-title {
    font-weight: 700;
    color: var(--text-muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    user-select: none;
    flex-shrink: 0;
  }

  .smilies-list {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-wrap: wrap;
  }

  .smilie-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    padding: 0;
    line-height: 1;
    transition: transform 0.1s, border-color 0.15s, background 0.15s;
  }

  .smilie-btn:hover {
    transform: scale(1.18);
    border-color: var(--accent);
    background: var(--bg-hover);
    z-index: 2;
  }

  .smilie-icon {
    display: inline-block;
  }

  .smilies-toggle {
    margin-left: auto;
    background: none;
    border: none;
    font-size: 11px;
    color: var(--accent);
    cursor: pointer;
    padding: 2px 6px;
    font-weight: 600;
  }

  .smilies-toggle:hover {
    text-decoration: underline;
  }
</style>
