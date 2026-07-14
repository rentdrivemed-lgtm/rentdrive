// Shared inline line-icon set (Lucide-style, stroke 1.8). Exposed as window.Icons.
(function () {
  const s = (paths, extra = {}) => (props = {}) => {
    const { size = 22, ...rest } = props;
    return React.createElement(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: extra.fill || "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", ...rest },
      paths.map((d, i) => React.createElement("path", { key: i, d }))
    );
  };
  const raw = (children) => (props = {}) => {
    const { size = 22, ...rest } = props;
    return React.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", dangerouslySetInnerHTML: { __html: children }, ...rest });
  };

  window.Icons = {
    Search: raw('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    Pin: raw('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
    Calendar: raw('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    Chat: raw('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    User: raw('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/>'),
    Car: raw('<path d="M19 17h2v-3.3a2 2 0 0 0-.4-1.2L18 9h-3l-1.5-3.5A2 2 0 0 0 11.7 4H7.3a2 2 0 0 0-1.8 1.1L3.4 9 1.4 12.5a2 2 0 0 0-.4 1.2V17h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>'),
    Shield: raw('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>'),
    Camera: raw('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/>'),
    FileSign: raw('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>'),
    Star: raw('<path d="m12 2 3 6.5 7 .9-5 4.8 1.3 7L12 18l-6.6 3.2L6.7 14l-5-4.8 7-.9Z"/>'),
    Heart: raw('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/>'),
    Bell: raw('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    Arrow: raw('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    Check: raw('<path d="M20 6 9 17l-5-5"/>'),
    Gas: raw('<path d="M3 22V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v18"/><path d="M3 12h10"/><path d="M13 8h3l3 3v6a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.5L19 6"/>'),
    Gear: raw('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M5 5l2 2M17 17l2 2M2 12h3M19 12h3M5 19l2-2M17 7l2-2"/>'),
    Users: raw('<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 12 0v1"/><path d="M17 4.5a4 4 0 0 1 0 7M22 21v-1a6 6 0 0 0-4-5.6"/>'),
    Wallet: raw('<path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v0H5"/><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 11v3h-4a2 2 0 0 1 0-4h4Z"/>'),
    Grid: raw('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
    Plus: raw('<path d="M12 5v14M5 12h14"/>'),
    Filter: raw('<path d="M3 5h18l-7 8v6l-4-2v-4Z"/>'),
    Doc: raw('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>'),
    Send: raw('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'),
    Plug: raw('<path d="M12 22v-5M9 8V2M15 8V2M7 8h10v3a5 5 0 0 1-10 0Z"/>'),
    ChevL: raw('<path d="m15 18-6-6 6-6"/>'),
    Clock: raw('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    Logout: raw('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  };
})();
