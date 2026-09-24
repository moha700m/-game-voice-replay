# Game Voice Replay

Local-first web app for capturing game voice chat, trimming precise moments, cleaning audio, visualizing waveforms, and building a session soundboard.

## Features

- Selectable audio input such as VB-CABLE
- Record / stop / replay workflow
- Recent clips list
- Precision in/out trimming
- Real waveform visualization
- Automatic edge-silence cleanup
- Normalize + limiter/compressor playback
- Session soundboard with rename/delete controls
- Arabic RTL interface
- Responsive desktop/mobile UI
- Audio stays local in the browser session

## Shortcuts

- `Ctrl + Shift + 1` — start/stop recording
- `Ctrl + Shift + 2` — replay latest clip
- `Ctrl + Shift + 3` — download latest clip

Shortcuts work while the web page is the active window.

## Run locally

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

## Deployment

Configured for Vercel. Import this GitHub repository into Vercel and deploy the `main` branch. Future pushes to `main` will deploy automatically once Git integration is connected.

## Stack

React 19, TypeScript, Vite, Tailwind CSS, Lucide React, MediaRecorder API, Web Audio API.
