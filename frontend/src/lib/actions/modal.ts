/** Native modality supplies focus trapping, inert background content, and Escape. */
export function modal(node: HTMLDialogElement, close: () => void) {
  let onClose = close;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const heading = node.querySelector<HTMLElement>('h1, h2, h3');
  if (!node.hasAttribute('aria-label') && !node.hasAttribute('aria-labelledby') && heading) {
    heading.id ||= `dialog-title-${crypto.randomUUID()}`;
    node.setAttribute('aria-labelledby', heading.id);
  }
  const cancel = (event: Event) => { event.preventDefault(); onClose(); };
  const backdrop = (event: MouseEvent) => { if (event.target === node) onClose(); };
  const trapTab = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const controls = [...node.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.matches(':disabled') && !element.closest('[inert]'));
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); node.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  };
  node.addEventListener('keydown', trapTab);
  node.addEventListener('cancel', cancel);
  node.addEventListener('click', backdrop);
  if (!node.open) node.showModal();
  return {
    update(nextClose: () => void) { onClose = nextClose; },
    destroy() {
      node.removeEventListener('keydown', trapTab);
      node.removeEventListener('cancel', cancel);
      node.removeEventListener('click', backdrop);
      if (node.open) node.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    }
  };
}
