/** The page under a client point, with the point normalized to it, or null. */
export function pageAt(
  root: HTMLElement,
  clientX: number,
  clientY: number
): { page: number; point: { x: number; y: number } } | null {
  for (const el of root.querySelectorAll<HTMLElement>('[data-page-overlay]')) {
    const b = el.getBoundingClientRect()
    if (clientX < b.left || clientX > b.right || clientY < b.top || clientY > b.bottom) continue
    if (el.closest('[style*="visibility: hidden"]')) continue
    return {
      page: Number(el.dataset.pageOverlay),
      point: { x: (clientX - b.left) / b.width, y: (clientY - b.top) / b.height }
    }
  }
  return null
}
