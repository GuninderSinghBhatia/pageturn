# PageTurn website

The landing page for PageTurn: Next.js 16, Tailwind 4, one page plus Privacy, Terms and a 404.

```
cd site
npm install
npm run dev      # http://localhost:3000
npm run build
```

## Deploy on Vercel

1. Import the `pageturn` GitHub repo in Vercel.
2. Set **Root Directory** to `site`. Vercel detects Next.js; no other settings are needed.
3. Optional: set `NEXT_PUBLIC_SITE_URL` to the final domain (used for social preview links).

## Download link

Every download button points at
`https://github.com/GuninderSinghBhatia/pageturn/releases/latest/download/PageTurn-Setup.exe`,
which the release script uploads with each release. New versions need no site change, and the
version number on the page is read from GitHub at most once an hour.

## Videos

`public/video/` holds `demo.mp4` (the tour), `hero.mp4` (the hero loop) and their posters. They are
filmed from the real app; see `scripts/demo-video/README.md` to film them again.
