// Shared DOM components. Device data must be assigned through textContent.
const paths = {
  monitor: 'M3 4h18v12H3z M8 21h8 M12 16v5',
  sliders: 'M6 3v6m0 4v8M12 3v10m0 4v4M18 3v2m0 4v12M3 9h6m0 4h6m0-8h6',
  chip: 'M6 6h12v12H6z M9 9h6v6H9z M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4',
  terminal: 'm4 6 5 6-5 6 M12 18h8',
  download: 'M12 3v12m-5-5 5 5 5-5 M4 16v5h16v-5',
  upload: 'M12 16V4m-5 5 5-5 5 5 M4 16v5h16v-5',
  refresh: 'M20 7V3l-3 3a8 8 0 1 0 3 8 M16 7h4',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
  wrap: 'M3 5h18M3 10h14a4 4 0 0 1 0 8h-5m3-3-3 3 3 3M3 15h4',
  follow: 'M5 4h14M5 8h14M12 11v10m-4-4 4 4 4-4',
  folder: 'M3 6h7l2 3h9v12H3z',
  file: 'M6 3h8l4 4v14H6z M14 3v5h4M9 12h6m-6 4h6',
  shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z M8 12l3 3 5-6',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  close: 'm6 6 12 12M6 18 18 6'
};
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', 'stroke-width':'1.7', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true', focusable:'false', class:'icon'})) svg.setAttribute(key,value);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name] ?? paths.file);svg.append(path);return svg;
}
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (!el.querySelector('svg')) el.prepend(icon(el.dataset.icon));
  }
}
// Each instance owns exactly one tablist, including nested tab groups.
export function bindTabs(list, {onSelect = () => {}} = {}) {
  const tabs = [...list.querySelectorAll('[role="tab"]')].filter(t => t.closest('[role="tablist"]') === list);
  function select(tab, focus = false) {
    if (!tabs.includes(tab)) return;
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));item.tabIndex = active ? 0 : -1;
      item.classList.toggle('active', active);
      const panel = document.getElementById(item.getAttribute('aria-controls'));
      if (panel) panel.hidden = !active;
    }
    if (focus) tab.focus();onSelect(tab);
    window.dispatchEvent(new Event('resize'));
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      const vertical = list.getAttribute('aria-orientation') === 'vertical';
      const next = vertical ? 'ArrowDown' : 'ArrowRight', prev = vertical ? 'ArrowUp' : 'ArrowLeft';
      let index = tabs.indexOf(tab);
      if (event.key === next) index++;
      else if (event.key === prev) index--;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else return;
      event.preventDefault();select(tabs[(index + tabs.length) % tabs.length], true);
    });
  }
  select(tabs.find(t => t.getAttribute('aria-selected') === 'true') ?? tabs[0]);
  return select;
}
export class LogView {
  constructor(root, {limit = 500, maxLine = 2048} = {}) {
    this.root = root;this.output = root.querySelector('pre');this.limit = limit;this.maxLine = maxLine;
    this.lines = [];this.follow = true;
    this.followButton = root.querySelector('[data-log-follow]');
    this.wrapButton = root.querySelector('[data-log-wrap]');
    this.followButton?.addEventListener('click', () => this.setFollow(!this.follow));
    this.wrapButton?.addEventListener('click', () => {
      const wrap = this.output.classList.toggle('log-wrap');this.wrapButton.setAttribute('aria-pressed', String(wrap));
    });
    this.output.addEventListener('scroll', () => {
      if (this.output.scrollTop + this.output.clientHeight < this.output.scrollHeight - 24) this.setFollow(false);
    });
  }
  setFollow(value) {
    this.follow = value;this.followButton?.setAttribute('aria-pressed', String(value));
    if (value) this.output.scrollTop = this.output.scrollHeight;
  }
  append(line) {
    for (const part of String(line).split('\n')) this.lines.push(part.length > this.maxLine ? part.slice(0, this.maxLine) + '… [truncated]' : part);
    if (this.lines.length > this.limit) this.lines.splice(0, this.lines.length - this.limit);
    this.render();
  }
  render() {
    const top = this.output.scrollTop;
    this.output.textContent = this.lines.join('\n') || 'No log entries.';
    const count = this.root.querySelector('[data-log-count]');if (count) count.textContent = `${this.lines.length} / ${this.limit}`;
    this.output.scrollTop = this.follow ? this.output.scrollHeight : top;
  }
  clear() {this.lines = [];this.render();}
  text() {return this.lines.join('\n') + '\n';}
}
