import {flashRegions, FLASH_SIZE, hexOffset, regionSize} from './flash-layout.js';
import {bindTabs, hydrateIcons, icon} from './ui.js';
const $ = id => document.getElementById(id);
export function setupFlashMap() {
  const tabs = $('flashTabs'), panels = $('flashPanels');
  for (const region of flashRegions) {
    const button = document.createElement('button');
    button.type = 'button';button.id = `region-${region.id}`;button.className = 'nav-link flash-node';
    button.setAttribute('role', 'tab');button.setAttribute('aria-controls', `region-panel-${region.id}`);
    button.setAttribute('aria-selected', 'false');button.tabIndex = -1;
    button.style.setProperty('--region-color', region.color);
    const label = document.createElement('span');label.textContent = region.name;
    const address = document.createElement('small');address.textContent = hexOffset(region.offset);
    button.append(icon(region.kind === 'Application' ? 'chip' : 'file'), label, address);tabs.append(button);
    const panel = document.createElement('section');panel.id = `region-panel-${region.id}`;panel.hidden = true;
    panel.setAttribute('role', 'tabpanel');panel.setAttribute('aria-labelledby', button.id);panel.tabIndex = 0;
    // Only fixed, repository-owned layout metadata is used in this template.
    panel.innerHTML = `<div class="pane-heading"><div><p class="eyebrow">${region.kind} / ${region.partition}</p><h3>${region.name}</h3></div><span class="capacity">${regionSize(region.size)}</span></div>
      <p class="region-description">${region.description}</p>
      <dl class="region-facts"><div><dt>Start</dt><dd>${hexOffset(region.offset)}</dd></div><div><dt>End · inclusive</dt><dd>${hexOffset(region.offset + region.size - 1)}</dd></div><div><dt>Flash allocation</dt><dd>${(region.size / FLASH_SIZE * 100).toFixed(2)}%</dd></div></dl>
      <div class="region-actions"><button class="btn btn-secondary icon-action" data-region-backup="${region.id}" data-icon="download" aria-label="${region.backup ? 'Download NVS and OTA metadata backup' : 'Image backup unavailable'}" title="${region.backup ? 'Download NVS and OTA metadata backup' : 'Image backup unavailable'}" disabled></button><button class="btn btn-primary icon-action" data-region-write="${region.id}" data-icon="upload" aria-label="Open full release update for ${region.name}" title="Open full release update" ${region.write ? '' : 'disabled'}></button></div>
      <p class="muted action-note">${region.backup ? 'Backup: NVS + OTA metadata in one JSON. Prepare a release first. Raw restore is unavailable.' : 'Write: included in a full release update. Individual writes and image backup are unavailable.'}</p>`;
    panels.append(panel);
    const segment = document.createElement('span');segment.style.flexGrow = region.size;
    segment.style.background = region.color;segment.title = `${region.name} · ${regionSize(region.size)}`;
    $('flashStrip').append(segment);
  }
  const select = bindTabs(tabs, {onSelect: tab => {
    $('flashSelection').textContent = tab.id === 'region-full' ? 'Full flash' : flashRegions.find(r => `region-${r.id}` === tab.id).name;
  }});
  for (const button of panels.querySelectorAll('[data-region-write]')) button.addEventListener('click', () => {
    select($('region-full'));$('updateFlow').open = true;$('firmwareFile').focus();
  });
  for (const button of panels.querySelectorAll('[data-region-backup]')) button.addEventListener('click', () => $('downloadBackup').click());
  hydrateIcons(panels);
}
export function updateFlashActions({backupReady, busy}) {
  for (const button of document.querySelectorAll('[data-region-backup]')) {
    const region = flashRegions.find(r => r.id === button.dataset.regionBackup);
    button.disabled = busy || !backupReady || !region.backup;
  }
  for (const button of document.querySelectorAll('[data-region-write]')) {
    button.disabled = busy || !flashRegions.find(r => r.id === button.dataset.regionWrite).write;
  }
}
