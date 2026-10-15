import type { Book } from '@shared/types'

/** PDF metadata title, else the filename without extension. */
export function displayTitle(book: Book): string {
  if (book.title) return book.title
  const file = book.path.split(/[\\/]/).pop() ?? book.path
  return file.replace(/\.pdf$/i, '')
}
