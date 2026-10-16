/** 18px line icons for the reader toolbar (stroke = currentColor). */
const svg = (children: React.ReactNode): React.JSX.Element => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const Icons = {
  back: svg(
    <>
      <path d="M15 18l-6-6 6-6" />
    </>
  ),
  highlighter: svg(
    <>
      <path d="M9 11l-5 5v4h4l5-5" />
      <path d="M14 6l4 4-6 6-4-4z" />
      <path d="M14 6l2-2 4 4-2 2" />
    </>
  ),
  underline: svg(
    <>
      <path d="M7 4v6a5 5 0 0 0 10 0V4" />
      <path d="M5 20h14" />
    </>
  ),
  pen: svg(
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  eraser: svg(
    <>
      <path d="M20 20H8l-5-5a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8" />
      <path d="M7 10l7 7" />
    </>
  ),
  bookmark: svg(
    <>
      <path d="M6 3h12v18l-6-4-6 4z" />
    </>
  ),
  contents: svg(
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </>
  ),
  search: svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  display: svg(
    <>
      <path d="M4 19l5-14h1l5 14" />
      <path d="M6 14h7" />
      <path d="M17 19v-6a2.5 2.5 0 0 1 5 0v6" />
      <path d="M17 16h5" />
    </>
  ),
  fullscreen: svg(
    <>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </>
  ),
  undo: svg(
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </>
  ),
  redo: svg(
    <>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9a5 5 0 0 0 0 10h3" />
    </>
  )
}
