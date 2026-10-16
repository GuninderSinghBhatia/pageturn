const ZONE_PX = 40 // pointer within this many px of the top edge reveals the toolbar
const HIDE_MS = 800 // after the pointer leaves the zone and the toolbar

/**
 * When the hidden top toolbar is shown. It appears when the pointer reaches the top edge and
 * hides 800 ms after it leaves, unless it is held open: by `T` (sticky), by an active tool
 * (pinned) or by keyboard focus inside it.
 */
export class ToolbarReveal {
  visible = false
  private sticky = false
  private pinned = false
  private focused = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private onChange: (visible: boolean) => void) {}

  pointer(clientY: number, overToolbar: boolean): void {
    if (clientY <= ZONE_PX || overToolbar) {
      this.cancelHide()
      this.set(true)
    } else if (this.visible && !this.held()) this.scheduleHide()
  }

  toggle(): void {
    if (this.pinned) return // an active tool keeps it open until Esc
    if (this.visible) this.hide()
    else {
      this.sticky = true
      this.set(true)
    }
  }

  setPinned(pinned: boolean): void {
    this.pinned = pinned
    if (pinned) {
      this.cancelHide()
      this.set(true)
    }
  }

  setFocused(focused: boolean): void {
    this.focused = focused
  }

  /** The pointer has been still for a while. */
  idle(): void {
    if (!this.pinned && !this.focused) this.hide()
  }

  hide(): void {
    this.sticky = false
    this.cancelHide()
    this.set(false)
  }

  dispose(): void {
    this.cancelHide()
  }

  private held(): boolean {
    return this.pinned || this.sticky || this.focused
  }

  private scheduleHide(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      if (!this.held()) this.set(false)
    }, HIDE_MS)
  }

  private cancelHide(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private set(v: boolean): void {
    if (v === this.visible) return
    this.visible = v
    this.onChange(v)
  }
}
