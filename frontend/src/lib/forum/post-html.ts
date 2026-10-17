const smilies: Record<string, string> = {
  ':smile:': '😊', ':biggrin:': '😀', ':wink:': '😉', ':tongue:': '😛',
  ':cool:': '😎', ':rolleyes:': '🙄', ':roll:': '🙄', ':mad:': '😡',
  ':eek:': '😲', ':confused:': '😕', ':oops:': '😳', ':embarrassed:': '😳',
  ':cry:': '😢', ':lol:': '🤣', ':rofl:': '🤣', ':thumbsup:': '👍',
  ':thumbsdown:': '👎', ':beer:': '🍻', ':cheers:': '🍻', ':heart:': '❤️',
  ':fire:': '🔥', ':ninja:': '🥷', ':facepalm:': '🤦', ':shrug:': '🤷'
};

/** Decorate server-sanitized post HTML without replacing text inside attributes or code. */
export function decoratePostHtml(html: string): string {
  if (typeof document === 'undefined') return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const text of texts) {
    if (text.parentElement?.closest('pre, code, script, style')) continue;
    const value = text.data;
    const matches = [...value.matchAll(/:[a-z]+:/g)].filter(match => smilies[match[0]]);
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      fragment.append(value.slice(offset, match.index));
      const span = document.createElement('span');
      span.className = 'forum-smilie';
      span.title = match[0];
      span.textContent = smilies[match[0]];
      fragment.append(span);
      offset = match.index! + match[0].length;
    }
    fragment.append(value.slice(offset));
    text.replaceWith(fragment);
  }
  for (const cite of template.content.querySelectorAll('.bbcode-quote cite')) {
    if (cite.querySelector('a, button, input, select, textarea')) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quote-author-link';
    button.append(...cite.childNodes);
    cite.append(button);
  }
  return template.innerHTML;
}
