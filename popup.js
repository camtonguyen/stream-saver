'use strict';
// Settings: file-name template and a per-site off switch (read by overlay.js and background.js).
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = '';
  try { host = new URL(tab.url).hostname; } catch {}
  const cfg = await chrome.storage.sync.get({ tpl: '{title}', off: [] });
  $('#tpl').value = cfg.tpl;
  $('#host').textContent = host || 'this page';
  $('#on').disabled = !host;
  $('#on').checked = !siteOff(cfg.off, host);

  const preview = () => ($('#preview').textContent = 'Preview: ' + fileNameFromTemplate($('#tpl').value, { title: tab.title, host }) + '.mp4');
  preview();
  $('#tpl').oninput = () => { preview(); chrome.storage.sync.set({ tpl: $('#tpl').value }); };
  $('#on').onchange = async () => {
    const { off } = await chrome.storage.sync.get({ off: [] });
    const rest = off.filter((d) => d !== host); // an exact entry; a parent-domain entry still applies
    await chrome.storage.sync.set({ off: $('#on').checked ? rest : [...rest, host] });
  };
})();
