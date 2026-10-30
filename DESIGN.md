# MeetEffects design

Reading this as a playful, camera-first effects instrument for friends on calls,
with the immediacy of a live production switcher. The studio borrows OBS's large
program-monitor / adjacent-controls arrangement, not its desktop chrome.

- Ink `#202622`, fog `#f1f3ef`, paper `#ffffff`, muted `#606b63`, line `#d8ded7`,
  signal `#deef91`. Signal marks actions; the camera and effect carry the color.
- Humanist sans headings/body: locally available Trebuchet MS with sans fallback.
  Condensed Impact is reserved for the actual meme typography in video.
- A large 16:9 monitor sits beside a compact, vertically stacked effect deck.
  Buttons have explicit keyboard hints. The Meet panel uses the same visual rules.
- Signature: a cut-paper "Make an exit." title over a quiet production workspace;
  no decorative dashboards, idle animation, or fabricated stream statistics.
- Motion belongs inside the video and follows explicit user actions. Control
  transitions respect reduced-motion preferences.

Self-review: a dark neon streaming dashboard would be a generic default here.
Use a pale utility surface so the user's camera stays the focus. No card grid,
gradient background, or decorative status dots. Native canvas animation avoids
adding GSAP to a media pipeline that already has a frame clock.
