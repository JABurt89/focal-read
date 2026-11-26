# FocalRead — RSVP Speed Reader

**[Launch Live App on GitHub Pages →](https://jaburt89.github.io/focal-read/)**

A sleek, distraction-free **Rapid Serial Visual Presentation (RSVP)** speed reader inspired by 300 → 900 WPM focal-point speed reading trainers.

Paste text or drop in any **PDF**, **EPUB**, **TXT**, or **Markdown** file and read directly in your browser with a pixel-locked **Optimal Recognition Point (ORP)** focal letter.

## Features

- **Pixel-Locked ORP Focal Point** — Computes the Optimal Recognition Point for every word (slightly left of center, skipping leading punctuation) and anchors that highlighted letter dead-center beneath vertical reticle ticks so your eyes never need to scan left-to-right.
- **Adjustable Speed (100 – 1,200+ WPM)** — Smooth slider, ±25 WPM stepper, keyboard shortcuts (`↑` / `↓`), and quick presets (`250`, `300`, `450`, `600`, `900`).
- **Ramp Training Mode (300 → 900 WPM)** — Gradually accelerates from your start WPM to your target WPM across the passage, recreating the 300→900 WPM speed-reading challenge.
- **Paste Text or Upload PDF / EPUB / TXT / MD** — 100% client-side parsing using self-hosted `pdf.js` and `JSZip`. Your documents never leave your device.
- **Chapter & Page Navigation** — Automatically extracts EPUB chapters (OPF spine + TOC), PDF pages, and Markdown headings into a quick-jump dropdown and scrubber ticks.
- **Smart Punctuation Pacing** — Optional brief pauses on commas, sentence endings, paragraph breaks, and long words for better comprehension.
- **Context Peek & Click-to-Jump** — Pause anytime to inspect the surrounding paragraphs and click any word to jump straight there.
- **Focus Mode & Themes** — OLED Black (default), Graphite, Warm Sepia, and Paper Light themes, customizable focal colors, font sizes, font families, 3-2-1 focus countdown, and automatic position saving via `localStorage`.

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / Pause |
| `↑` / `↓` | Increase / decrease speed by 25 WPM |
| `←` / `→` | Step backward / forward 1 word |
| `Shift` + `←` / `→` | Jump to previous / next sentence |
| `R` | Restart from beginning |
| `O` | Open Paste / Upload modal |
| `C` | Toggle surrounding Context View |
| `S` | Open Settings |
| `F` | Toggle Fullscreen |
| `Esc` | Close modal or pause playback |

## Local Development & Tests

No build step is required to serve the app — it uses standard ES modules and self-hosted vendor libraries in `vendor/`.

```bash
npm install
npm run sync-vendor
npm test
```

Then serve the repository root with any static HTTP server (or enable GitHub Pages directly on `main` / root).
