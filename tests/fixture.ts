import type { On, PromptEditInput } from 'claude-code'

import { buildLexicon } from '../hooks/lexicon'

// A small stand-in for the downloaded counts, so results do not depend on the web.
const WORD_COUNTS = `the\t100
to\t90
i\t80
want\t70
be\t60
a\t55
it\t50
wanted\t40
wants\t30
make\t25
prediction\t20
predicted\t19
predict\t18
click\t10
here\t9
is\t8
upskirts\t7
upstream\t6
cocktail\t5
dont\t4
know\t3`

const PAIR_COUNTS = `i want\t50
want to\t40
want a\t20
want it\t10
to be\t30
to click\t25
to make\t20
to a\t10
click here\t10
here is\t5
dont know\t9`

export const LEXICON = buildLexicon(WORD_COUNTS, PAIR_COUNTS)
export const HISTORY = { prompts: 2, next: 'you:make,do|<s>:fix,can', next2: 'can you:help,make|<s> can:you' }

/** One composer edit: `inputText` typed at the end of `text`, or over `start`..`end`. */
export const edit = (
  text: string,
  inputText: string,
  { key, start = text.length, end = start }: { key?: PromptEditInput['key']; start?: number; end?: number } = {},
): PromptEditInput => ({ origin: { kind: 'composer' }, key, text, cursor: text.length, start, end, inputText })

/** An Option chord as the desktop sends it: the character typed, with `meta`. */
export const option = (char: string) => ({ key: char, meta: true }) as const

/** Answers `$.store` from `entries`, which the test can read and change between calls. */
export const fakeStore = (on: On, entries: Map<string, unknown>) => {
  on('store.get', (_, e) => ({ value: entries.get(e.key) }))
  on('store.set', (_, e) => {
    entries.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    entries.delete(e.key)
    return { value: undefined }
  })
}
