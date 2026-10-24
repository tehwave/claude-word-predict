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
is\t8`

const PAIR_COUNTS = `i want\t50
want to\t40
want a\t20
want it\t10
to be\t30
to click\t25
to make\t20
to a\t10
click here\t10
here is\t5`

export const LEXICON = buildLexicon(WORD_COUNTS, PAIR_COUNTS)
export const HISTORY = { prompts: 2, next: 'you:make,do|<s>:fix,can', next2: 'can you:help,make' }
