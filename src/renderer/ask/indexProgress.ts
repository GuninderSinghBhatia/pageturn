import type { RagIndexStatus } from '@shared/ipc'

type IndexProgress = Extract<RagIndexStatus, { ok: true }>

/** The line above the progress bar while the open book waits for (or is in) indexing. The
 *  download step only happens if the models were deleted from the install folder. */
export function progressText(
  state: IndexProgress['state'],
  step: IndexProgress['step'],
  pct: number
): string {
  if (state !== 'indexing') {
    return 'Waiting to index this book for Ask (another book is being indexed first)…'
  }
  if (step === 'download') return `Downloading the Ask model (one time, about 90 MB)… ${pct}%`
  if (step === 'read') return 'Reading this book for Ask…'
  return `Indexing this book for Ask… ${pct}%`
}
