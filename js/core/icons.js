'use strict';
CG.icons = {
  square:    '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  landscape: '<rect x="3" y="7" width="18" height="10" rx="2"/>',
  portrait:  '<rect x="7" y="3" width="10" height="18" rx="2"/>',
  more:      '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="12" r="0.9" fill="currentColor"/><circle cx="12" cy="12" r="0.9" fill="currentColor"/><circle cx="16" cy="12" r="0.9" fill="currentColor"/>',
  lock:      '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock:    '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.6-1.7"/>',
  swap:      '<path d="M7 20V4M4 7l3-3 3 3M17 4v16M14 17l3 3 3-3"/>',
  refresh:   '<path d="M19.5 9A8 8 0 0 0 5.3 7.2L4 8.5"/><path d="M4 4.5v4h4"/><path d="M4.5 15a8 8 0 0 0 14.2 1.8l1.3-1.3"/><path d="M20 19.5v-4h-4"/>',
  shuffle:   '<path d="M4 7h3c5 0 5 10 10 10h3M4 17h3c1.8 0 2.9-1.3 3.8-3M13.2 10c.9-1.7 2-3 3.8-3h3"/><path d="M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  reset:     '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
  download:  '<path d="M12 3.5v10.5M8 10l4 4 4-4"/><path d="M4.5 14.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
  upload:    '<path d="M12 14V3.5M8 7.5l4-4 4 4"/><path d="M4.5 14.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
  play:      '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  pause:     '<rect x="7" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none"/>',
  plus:      '<path d="M12 5v14M5 12h14"/>',
  trash:     '<path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7"/>',
  chevron:   '<path d="M9 6l6 6-6 6"/>',
  record:    '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
  x:         '<path d="M6 6l12 12M18 6L6 18"/>',
  copy:      '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  undo:      '<path d="M9 14L4.5 9.5 9 5"/><path d="M4.5 9.5H15a4.5 4.5 0 0 1 0 9h-3"/>',
  arrow:     '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
CG.icon = (name, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CG.icons[name] || ''}</svg>`;
