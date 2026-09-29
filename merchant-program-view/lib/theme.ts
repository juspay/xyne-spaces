/**
 * Spaces Design System tokens (Classic, with Midnight for dark), mapped onto the short names the
 * components use, plus the few hover/animation rules inline styles can't express. Injected once by
 * App as a <style> tag (the host owns index.css).
 *
 * Mapping: --bg background · --bg2 muted/50 (row hover) · --bg3 muted/secondary/accent · --bd border ·
 * --t1 foreground · --t3 muted-foreground · --primary coral · status: red = status-failure,
 * amber = warning, green = status-success, --blue = status-scheduled; age buckets use the yellow and
 * orange foundation scales.
 */

const LIGHT = `
  --bg:#ffffff; --bg2:#fafafa; --bg3:#f4f4f5; --bg4:#e4e4e7;
  --bd:#e4e4e7; --bd2:#ececef; --input:#e4e4e7; --ring:#cbcbd1;
  --t1:#23222a; --t2:#3f3f46; --t3:#71717a; --t4:#83838c; --t5:#a1a1aa; --t6:#c4c4cb; --t7:#d9d9de;
  --inv:#23222a; --invT:#ffffff;
  --primary:#fd6b6b; --primaryT:#ffffff;
  --red:#dc2626; --redT:#c10007; --redBg:#fef2f2; --redBd:#ffc9c9;
  --green:#16a34a; --greenT:#008236; --greenBg:#f0fdf4; --greenBd:#b9f8cf;
  --dec:#efb100; --decT:#a65f00; --decBg:#fefce8; --decBd:#fff085;
  --act:#ff6900; --actT:#ca3500; --actBg:#fff7ed; --actBd:#ffd6a8;
  --amber:#d97706; --amberT:#a65f00; --amberBg:#fff7ed; --amberBd:#ffd6a8;
  --blue:#2563eb; --tip:#23222a; --desk:#6276be; --deskBg:#eef0fb;
  --shadowMd:0px 2px 8px 1px rgba(5,5,6,.07); --shadowXl:0px 12px 32px rgba(5,5,6,.14);
`;

const DARK = `
  --bg:#1a1b20; --bg2:#212228; --bg3:#2b2e32; --bg4:#34373c;
  --bd:#34363f; --bd2:#2b2d34; --input:#3d3f45; --ring:#43474d;
  --t1:#e1e4ea; --t2:#cfd3d9; --t3:#b3b5ba; --t4:#9a9ca2; --t5:#7d8086; --t6:#5d6066; --t7:#46494f;
  --inv:#e1e4ea; --invT:#1a1b20;
  --red:#f87171; --redT:#ffa2a2; --redBg:#460809; --redBd:#82181a;
  --green:#4ade80; --greenT:#7bf1a8; --greenBg:#052e16; --greenBd:#0d542b;
  --dec:#fcc800; --decT:#ffdf20; --decBg:#432004; --decBd:#733e0a;
  --act:#ff8904; --actT:#ffb86a; --actBg:#441306; --actBd:#7e2a0c;
  --amber:#fbbf24; --amberT:#ffdf20; --amberBg:#432004; --amberBd:#733e0a;
  --blue:#60a5fa; --tip:#e1e4ea; --desk:#9ab0f0; --deskBg:rgba(98,118,190,.2);
  --shadowMd:0px 2px 8px 1px rgba(0,0,0,.35); --shadowXl:0px 12px 32px rgba(0,0,0,.5);
`;

export const THEME_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap');
.mpv{${LIGHT}}
.dark .mpv,[data-theme="midnight"] .mpv,[data-oats-theme="dark"] .mpv{${DARK}}
.mpv{min-height:100vh;background:var(--bg);color:var(--t1);font-family:Inter,system-ui,sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
.mpv *{box-sizing:border-box}
.mpv .mono{font-family:'Geist Mono',ui-monospace,monospace}
.mpv .hov:hover{background:var(--bg3)!important}
.mpv .editable:hover{background:color-mix(in srgb,var(--bg3) 70%,transparent)}
.mpv .ghost:hover{background:var(--bg3)!important;color:var(--t1)!important}
.mpv .row:hover{background:var(--bg2)!important}
.mpv .kpi:hover{border-color:var(--t6)!important}
.mpv .solid:hover{opacity:.9}
.mpv .outline:hover{background:var(--bg3)!important}
.mpv .tabp:hover{background:color-mix(in srgb,var(--bg3) 60%,transparent)}
.mpv input::placeholder{color:var(--t5)}
.mpv .page{max-width:1200px;margin:0 auto;padding:32px 40px 72px;display:flex;flex-direction:column}
.mpv .mv-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:20px;align-items:start}
@media (max-width:900px){.mpv .mv-grid{grid-template-columns:minmax(0,1fr)}}
@media (max-width:640px){.mpv .page{padding-left:16px;padding-right:16px}}
@keyframes mpvIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:none}}
@keyframes mpvUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes mpvPulse{0%,100%{opacity:1}50%{opacity:.35}}
.mpv .sorth .sorti{opacity:0;transition:opacity .12s}
.mpv .sorth:hover .sorti{opacity:1}
.mpv :focus-visible{outline:none!important;box-shadow:0 0 0 3px color-mix(in srgb,var(--ring) 70%,transparent)!important}
.mpv .row:focus-visible{box-shadow:inset 0 0 0 2px var(--ring)!important}
.mpv .field:focus-within{border-color:var(--ring)!important;box-shadow:0 0 0 2px color-mix(in srgb,var(--ring) 35%,transparent)}
.mpv [role=dialog]:focus-visible{box-shadow:var(--shadowXl)!important}
.mpv input:focus-visible{box-shadow:none!important}
@keyframes mpvSkPulse{50%{opacity:.5}}
.mpv .sk{background:var(--bg3);animation:mpvSkPulse 2s cubic-bezier(.4,0,.6,1) infinite;border-radius:6px;max-width:100%}
@media (prefers-reduced-motion:reduce){.mpv .sk{animation:none}}
`;
