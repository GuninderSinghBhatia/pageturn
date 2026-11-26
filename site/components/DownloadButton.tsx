import { WindowsLogo } from '@phosphor-icons/react/dist/ssr'
import { DOWNLOAD_URL } from '@/lib/site'

/** The one primary action: a blue key with a lit top edge and a soft drop shadow. */
export const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-[11px] bg-brand font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(0,0,0,0.1),0_1px_2px_rgba(0,0,0,0.3),0_4px_12px_-4px_rgba(0,0,0,0.35)] transition-[background-color,transform] duration-300 ease-fluid hover:bg-brand-hover active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

/** Quiet partner to the primary button: white, hairline border, small shadow. */
export const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-[11px] border border-ink/10 bg-white font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-[background-color,transform] duration-300 ease-fluid hover:bg-canvas-2 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand'

export function DownloadButton({ size = 'main' }: { size?: 'main' | 'small' }): React.JSX.Element {
  const small = size === 'small'
  return (
    <a href={DOWNLOAD_URL} className={`${primaryButton} ${small ? 'px-3 py-1.5 text-sm' : 'px-5 py-3 text-base'}`}>
      <WindowsLogo size={small ? 14 : 18} weight="fill" aria-hidden />
      {small ? 'Download' : 'Download for Windows'}
    </a>
  )
}
