<script lang="ts">
  import { modal } from '$lib/actions/modal';
  let { src = '', alt = '' }: { src: string; alt?: string } = $props();
  let open = $state(false);
</script>
<button type="button" class="lightbox-trigger" aria-label={alt ? `Enlarge ${alt}` : 'Enlarge image'} onclick={() => open = true}>
  <img {src} {alt} class="lightbox-thumb" loading="lazy" />
</button>

{#if open}
  <dialog aria-label={alt || 'Image preview'} class="lightbox-overlay" data-modal="overlay" use:modal={() => open = false}  >
    <button class="lightbox-close" aria-label="Close image preview" onclick={() => open = false}>&times;</button>
    <img {src} {alt} class="lightbox-full" />
  </dialog>
{/if}

<style>
  .lightbox-trigger { display: inline-block; padding: 0; border: 0; background: none; max-width: 100%; cursor: zoom-in; }
  .lightbox-thumb { cursor: zoom-in; max-width: 100%; height: auto; border-radius: var(--radius); }
  .lightbox-overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0,0,0,0.9); display: flex; align-items: center; justify-content: center;
    cursor: zoom-out;
  }
  .lightbox-full { max-width: 90vw; max-height: 90vh; object-fit: contain; border-radius: var(--radius-lg); }
  .lightbox-close {
    position: absolute; top: 16px; right: 16px;
    background: none; border: none; color: white; font-size: 32px; cursor: pointer;
    width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;
  }
</style>
