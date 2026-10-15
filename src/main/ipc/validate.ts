import type { z } from 'zod'

/** Parses an IPC payload; any mismatch is rejected without echoing the input. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error('Invalid payload')
  return result.data
}
