# Multi-Timer PWA

A poolside stopwatch with a separate independent timer for every swimmer.

## Included

- Independent start, stop, resume, lap and reset controls for every swimmer
- Dense two-column Grid mode and larger one-column List mode
- Latest split, lap count and elapsed time for every swimmer
- Global All Start, All Stop and All Reset controls
- Tap any swimmer name to edit it
- Add or remove timers for groups of 1–30 swimmers
- Offline PWA support, vibration feedback and screen wake lock
- Data stored only in the browser on the current device

## Run locally

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

The project includes a GitHub Pages workflow. Pushes to `main` build and publish automatically after Pages is set to **GitHub Actions**. The prebuilt `docs/` folder can also be used with the **Deploy from a branch → main /docs** option.

On iPhone, open the published site in Safari, tap Share, then **Add to Home Screen**.
