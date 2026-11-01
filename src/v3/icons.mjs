// A small authored icon set: 16px grid, 1.6 stroke, round joins, drawn in currentColor so icons take
// the colour of the text beside them. Decorative by default (aria-hidden); pair each with visible text.

const PATHS = {
  home: '<path d="M2.5 7 8 2.5 13.5 7v6a1 1 0 0 1-1 1h-3v-4h-3v4h-3a1 1 0 0 1-1-1Z"/>',
  layers: '<path d="m8 2 6 3.2-6 3.2-6-3.2Z"/><path d="m2 8.4 6 3.2 6-3.2"/><path d="m2 11.2 6 3.2 6-3.2"/>',
  shield: '<path d="M8 1.8 13 3.6v4.2c0 3.1-2.1 5.4-5 6.4-2.9-1-5-3.3-5-6.4V3.6Z"/><path d="m5.8 8 1.5 1.5L10.4 6.4"/>',
  play: '<path d="M4.5 2.8v10.4L13 8Z"/>',
  spark: '<path d="M8 1.5 9.4 6.6 14.5 8l-5.1 1.4L8 14.5 6.6 9.4 1.5 8l5.1-1.4Z"/>',
  upload: '<path d="M8 10.5V2.5"/><path d="m4.8 5.6 3.2-3.1 3.2 3.1"/><path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2"/>',
  file: '<path d="M9.5 1.8H4.2a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.1Z"/><path d="M9.5 1.8v3.3h3.3"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  check: '<path d="m3.2 8.4 3 3 6.6-6.8"/>',
  x: '<path d="m4 4 8 8M12 4l-8 8"/>',
  alert: '<path d="M8 2.2 14.2 13H1.8Z"/><path d="M8 6.5v3"/><path d="M8 11.4v.1"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4"/>',
  arrow: '<path d="M3 8h10"/><path d="m9 4 4 4-4 4"/>',
  logout: '<path d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6"/><path d="M10.5 11 13.5 8l-3-3"/><path d="M13.5 8H6"/>',
  building: '<path d="M3 14V3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v11"/><path d="M10 6.5h2a1 1 0 0 1 1 1V14"/><path d="M2 14h12M5.5 5h2M5.5 8h2M5.5 11h2"/>',
  inbox: '<path d="M2 9.2 3.8 3.6a1 1 0 0 1 .9-.6h6.6a1 1 0 0 1 .9.6L14 9.2V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z"/><path d="M2 9.2h3.4l1 1.6h3.2l1-1.6H14"/>',
  card: '<rect x="1.8" y="3.5" width="12.4" height="9" rx="1.5"/><path d="M1.8 6.5h12.4M4.5 10h2.5"/>',
  settings: '<path d="M2.5 4.5h7M12 4.5h1.5M2.5 11.5H4M6.5 11.5h7"/><circle cx="10.5" cy="4.5" r="1.5"/><circle cx="5" cy="11.5" r="1.5"/>',
};

export function icon(name, { size = 16, label } = {}) {
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${PATHS[name] ?? ''}</svg>`;
}
