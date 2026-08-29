const ATTRS = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"`;

export const ICON_PLAY = `<svg ${ATTRS} width="20" height="20" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>`;
export const ICON_PAUSE = `<svg ${ATTRS} width="20" height="20" aria-hidden="true"><path d="M8.5 5.5v13M15.5 5.5v13"/></svg>`;

export const ICON_CLOSE = `<svg ${ATTRS} width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

export const ICON_SIGIL = `<svg viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">
<circle cx="100" cy="100" r="86" opacity="0.55"/>
<circle cx="100" cy="100" r="64" opacity="0.35"/>
<circle cx="100" cy="100" r="42" opacity="0.25"/>
<path d="M100 6v14M100 180v14M6 100h14M180 100h14"/>
<path d="M33 33l9 9M167 33l-9 9M33 167l9-9M167 167l-9-9"/>
<path d="M100 58l9.6 32.4L142 100l-32.4 9.6L100 142l-9.6-32.4L58 100l32.4-9.6z" opacity="0.9"/>
</svg>`;

export const ICON_DIAMOND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" width="26" height="26" aria-hidden="true"><path d="M12 3l7 9-7 9-7-9z"/><path d="M12 8l3.5 4-3.5 4-3.5-4z"/></svg>`;

export const ICON_SETTINGS = `<svg ${ATTRS} width="17" height="17" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .66.39 1.26 1 1.51.64.26 1.36.11 1.85-.38l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9"/></svg>`;

export const ICON_SEARCH = `<svg ${ATTRS} width="15" height="15" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M15.6 15.6L20 20"/></svg>`;

export const ICON_BACK = `<svg ${ATTRS} width="16" height="16" aria-hidden="true"><path d="M14.5 5l-7 7 7 7"/></svg>`;

export const ICON_NOTE = `<svg ${ATTRS} width="17" height="17" aria-hidden="true"><path d="M9.5 17.5V5.5l9-1.8v11.8"/><circle cx="7" cy="17.5" r="2.5"/><circle cx="16" cy="15.5" r="2.5"/></svg>`;

export const ICON_PREV = `<svg ${ATTRS} width="16" height="16" aria-hidden="true"><path d="M16.5 5.5L9 12l7.5 6.5"/><path d="M7 5.5v13"/></svg>`;

export const ICON_NEXT = `<svg ${ATTRS} width="16" height="16" aria-hidden="true"><path d="M7.5 5.5L15 12l-7.5 6.5"/><path d="M17 5.5v13"/></svg>`;

export const ICON_VOLUME = `<svg ${ATTRS} width="16" height="16" aria-hidden="true"><path d="M11 5.5L7 9H4v6h3l4 3.5z" fill="currentColor" stroke="none"/><path d="M15 9.3a4 4 0 0 1 0 5.4"/><path d="M17.6 7a7.6 7.6 0 0 1 0 10"/></svg>`;
export const ICON_VOLUME_MUTE = `<svg ${ATTRS} width="16" height="16" aria-hidden="true"><path d="M11 5.5L7 9H4v6h3l4 3.5z" fill="currentColor" stroke="none"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/></svg>`;
export const ICON_MINIMIZE = `<svg ${ATTRS} width="15" height="15" aria-hidden="true"><path d="M5.5 12h13"/></svg>`;

export const ICON_MAXIMIZE = `<svg ${ATTRS} width="15" height="15" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>`;

export const ICON_LYRIC_FOCUS = `<svg ${ATTRS} width="17" height="17" aria-hidden="true"><path d="M5 6.5h14M5 12h9.5M5 17.5h12"/><circle cx="19.2" cy="12" r="1.1" fill="currentColor" stroke="none"/></svg>`;

export const ICON_ART_FOCUS = `<svg ${ATTRS} width="17" height="17" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9.2" cy="9.8" r="1.5"/><path d="M5.5 16.5l4-4 2.8 2.8 3.2-3.2 3 3"/></svg>`;

export const ICON_SHUFFLE = `<svg ${ATTRS} width="17" height="17" aria-hidden="true"><path d="M4.5 7h2.2c2.8 0 3.8 5.8 6.6 5.8h2.2"/><path d="M13.5 4.5h2.8v2.8M13.5 15.5h2.8v-2.8"/><path d="M4.5 15.5h2.2c1 0 1.8-.6 2.4-1.5M11 8.5c.8-1 1.3-1.5 2.3-1.5h2.2"/></svg>`;

export const ICON_TRASH = `<svg ${ATTRS} width="17" height="17" aria-hidden="true"><path d="M5 7.5v10.2c0 .7.6 1.3 1.3 1.3h11.4c.7 0 1.3-.6 1.3-1.3V7.5M3.5 5h16M9 5V3.5h5V5M9 9.5v6M14 9.5v6"/></svg>`;
