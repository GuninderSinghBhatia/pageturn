// Copies pdf.js standard font data into the renderer's public dir (served at ./standard_fonts/).
import { cpSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
cpSync(
  join(root, 'node_modules', 'pdfjs-dist', 'standard_fonts'),
  join(root, 'src', 'renderer', 'public', 'standard_fonts'),
  { recursive: true }
)
