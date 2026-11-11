# Motion graphics authoring rules (for Motion Studio)

Paste this into the `CLAUDE.md` of a project where Claude Code makes HTML motion graphics.
Following it makes every animation importable as layers + keyframes in Motion Studio.

## Format
- One self-contained `.html` file. Fix the frame size on `html, body` (e.g. `width:1920px;height:1080px;overflow:hidden`)
  or add `<meta name="motion:size" content="1920x1080">`.
- Images and fonts: data URIs or absolute URLs (Google Fonts `<link>` is fine). No relative paths.
- The piece starts at t = 0 on page load and should finish (or loop cleanly) within its intended duration.

## Animation (pick these — they import as editable keyframes)
- CSS `@keyframes` + `animation` (any timing function, delays, `infinite`, `alternate`).
- `element.animate(...)` (Web Animations API).
- GSAP 3 (`gsap.to/from/fromTo`, `gsap.timeline()`, `stagger`, `repeat`, `yoyo`, standard eases).
- Animate `transform` (translate/rotate/scale), `opacity`, and plain CSS properties (colors, sizes, `filter`, `clip-path`,
  `stroke-dashoffset`, …).

## Make it pleasant to edit
- Give every animated element a meaningful `id` or first class name (it becomes the layer name).
- One animated thing per element; wrap in a parent element for a second, independent motion (that becomes parenting).
- Don't animate the same property of the same element from two systems at once.
- Static centring like `transform: translate(-50%, -50%)` is fine.

## Script-driven parts (allowed)
- `<canvas>`, WebGL/Three.js, particles: drive them from the `requestAnimationFrame` timestamp or `performance.now()`.
  They run frame-exactly on Motion Studio's virtual clock (`Math.random` is seeded, so results are repeatable).
- Avoid `setInterval` loops that write DOM styles every frame — they play back but cannot be edited as keyframes.
