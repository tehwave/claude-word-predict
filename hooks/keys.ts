import type { PromptBox, PromptEditInput } from 'claude-code'

import { accept, predict } from './predict'
import type { Model } from './predict'

import type { Layout, Learned } from '../types'

// What Option+1, Option+2 and Option+3 type on each Mac layout. The desktop app
// keeps Tab, the arrows and Ctrl chords for itself, but sends an Option key as
// the character it types, with `meta`. Only the person's own layout counts, so
// another layout's Option characters are never taken.
export const LAYOUTS: Record<Layout, readonly string[]> = {
  us: ['¡', '™', '£'],
  danish: ['¡', '“', '§'],
  german: ['¡', '“', '¶'],
  british: ['¡', '€', '#'],
}

/** An Option+1..3 press: which place it takes, its character, and the draft as the person sees it. */
export type Press = { place: number; char: string; text: string; cursor: number }

/** Reads an edit as an Option+1..3 press on `layout`, or undefined for any other edit. */
export const readPress = (layout: Layout, e: PromptEditInput): Press | undefined => {
  const char = e.key?.meta && !e.key.ctrl ? e.key.key : ''
  const place = char ? LAYOUTS[layout].indexOf(char) : -1
  // Only the key itself, after the space the desktop may hold back: not an
  // undo or a paste that happens to end in the same character.
  const typed = e.inputText.slice(0, -char.length)
  if (place < 0 || !e.inputText.endsWith(char) || typed.trim() !== '') return undefined

  // The desktop may send the key as replacing the space before it: then keep
  // the draft as it was, else add the held space it carried.
  const text = typed ? e.text.slice(0, e.start) + typed + e.text.slice(e.end) : e.text
  const cursor = typed ? e.start + typed.length : e.cursor

  return { place, char, text, cursor }
}

/** The box with the suggestion at the press's place taken, or undefined when there is none. */
export const take = (model: Model, learned: Learned, press: Press): PromptBox | undefined => {
  const { prefix, words } = predict(model, learned, press.text, press.cursor)
  const word = words[press.place]

  return word ? accept(press.text, press.cursor, word, prefix) : undefined
}

/** The press's own character typed into its draft, for when the person wanted the character. */
export const literal = (press: Press): PromptBox => ({
  text: press.text.slice(0, press.cursor) + press.char + press.text.slice(press.cursor),
  cursor: press.cursor + press.char.length,
})
