import type { PromptBox, PromptEditInput } from 'claude-code'

import { accept, predict } from './predict'
import type { Model } from './predict'

import type { Learned } from '../types'

// What Option+1, Option+2 and Option+3 type, per place, on the US, Danish,
// German and British Mac layouts. The desktop app keeps Tab, the arrows and
// Ctrl chords for itself, but sends an Option key as the character it types,
// with `meta`.
export const PICKS = [['¡'], ['™', '“', '€'], ['£', '§', '¶']]

/** The box with a suggestion taken, where the edit is an Option+1..3 that offers one; else undefined. */
export const pickByKey = (model: Model, learned: Learned, e: PromptEditInput): PromptBox | undefined => {
  const char = e.key?.meta ? e.inputText.slice(-1) : ''
  const place = char ? PICKS.findIndex(chars => chars.includes(char)) : -1
  if (place < 0) return undefined

  // The desktop may send the key as replacing the space before it: keep the
  // draft as it was then, plus whatever else the edit typed.
  const typed = e.inputText.slice(0, -1)
  const text = typed ? e.text.slice(0, e.start) + typed + e.text.slice(e.end) : e.text
  const cursor = typed ? e.start + typed.length : e.cursor
  const word = predict(model, learned, text, cursor).words[place]

  return word ? accept(text, cursor, word) : undefined
}
