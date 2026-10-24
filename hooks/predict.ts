import type { History, Learned, Lexicon, Prediction } from '../types'

const START = '<s>'
const WORD = /^[a-z][a-z']*$/
const STARTERS = ['I', 'Can', 'Please', 'The', 'What', 'How']
const MAX_WORDS = 5000
const MAX_PAIRS = 3000
const MAX_NEXT = 12

// Web words that follow almost anything on a web page and nothing in a prompt.
const FILLER = new Set(
  'click page site home online search contact posted comments reviews rss login http www com print reply cart shipping'.split(' '),
)

/** What predictions are made from: the word list and, when imported, past prompts. */
export type Model = {
  vocab: string[]
  inVocab: Set<string>
  next: Map<string, string[]>
  mine: Map<string, string[]>
  mine2: Map<string, string[]>
}

const table = (packed: string): Map<string, string[]> => {
  const map = new Map<string, string[]>()
  for (const entry of packed ? packed.split('|') : []) {
    const at = entry.lastIndexOf(':')
    if (at > 0) map.set(entry.slice(0, at), entry.slice(at + 1).split(','))
  }
  return map
}

export const buildModel = (lexicon?: Lexicon, history?: History): Model => {
  const vocab = lexicon?.words ? lexicon.words.split(' ') : []
  return {
    vocab,
    inVocab: new Set(vocab),
    next: table(lexicon?.next ?? ''),
    mine: table(history?.next ?? ''),
    mine2: table(history?.next2 ?? ''),
  }
}

export const empty = (): Learned => ({ words: {}, pairs: {} })

const byCount = (counts: Record<string, number> | undefined): string[] =>
  Object.entries(counts ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)

/** Writes `word` in the case the person used for `like`: `Pre` -> `Prediction`. */
const cased = (word: string, like: string): string => {
  if (word === 'i' || word.startsWith("i'")) return 'I' + word.slice(1)
  if (like.length > 1 && like === like.toUpperCase()) return word.toUpperCase()
  if (like[0] && like[0] !== like[0].toLowerCase()) return word[0]!.toUpperCase() + word.slice(1)
  return word
}

const capital = (word: string): string => word[0]!.toUpperCase() + word.slice(1)

const unique = (words: string[], limit: number): string[] => [...new Set(words)].slice(0, limit)

/** The bare lowercase word of a whitespace token, or undefined for code, paths and the like. */
const bare = (token: string): string | undefined => {
  const word = token.toLowerCase().replace(/^["'(\[]+|[.,!?;:"')\]]+$/g, '')
  return WORD.test(word) && word.length <= 24 ? word : undefined
}

/** True where a new sentence starts after `before`: an empty draft, a full stop, a new line. */
const isSentenceStart = (before: string): boolean => {
  const trimmed = before.trimEnd()
  return trimmed === '' || /[.!?]["')]*$/.test(trimmed) || /\n\s*$/.test(before)
}

/** Words likely after `previous` (and `earlier` before it), best first: the person's own, then the web's. */
const candidates = (model: Model, learned: Learned, previous: string, earlier?: string): string[] =>
  [
    ...(earlier ? (model.mine2.get(`${earlier} ${previous}`) ?? []) : []),
    ...byCount(learned.pairs[previous]),
    ...(model.mine.get(previous) ?? []),
    ...(model.next.get(previous) ?? []).filter(word => !FILLER.has(word)),
  ].filter(word => word !== previous)

/** Ways to finish `prefix`, given the words before it. */
export const complete = (
  model: Model,
  learned: Learned,
  prefix: string,
  previous: string | undefined,
  limit: number,
  earlier?: string,
): string[] => {
  const lower = prefix.toLowerCase()
  const fits = (word: string) => word.startsWith(lower) && word !== lower
  const known = (word: string) => (learned.words[word] ?? 0) >= 2 || model.inVocab.has(word) || model.mine.has(word)

  const found: string[] = []
  if (previous) found.push(...candidates(model, learned, previous, earlier).filter(fits).filter(known))
  found.push(...byCount(learned.words).filter(word => fits(word) && (learned.words[word] ?? 0) >= 2))
  for (const word of model.vocab) {
    if (found.length >= limit * 4) break
    if (fits(word)) found.push(word)
  }

  return unique(found, limit).map(word => cased(word, prefix))
}

/** Likely next words after `previous`, or sentence starters where `previous` is undefined. */
export const following = (
  model: Model,
  learned: Learned,
  previous: string | undefined,
  limit: number,
  earlier?: string,
): string[] => {
  if (!previous) {
    const starts = [...byCount(learned.pairs[START]), ...(model.mine.get(START) ?? [])].map(capital)
    return unique([...starts, ...STARTERS], limit).map(word => cased(word.toLowerCase(), word))
  }
  const found = candidates(model, learned, previous, earlier)

  return unique(found.length > 0 ? found : model.vocab.slice(0, limit), limit).map(word => cased(word, word))
}

/** What the strip offers for a draft with the caret at `cursor`. */
export const predict = (model: Model, learned: Learned, text: string, cursor: number, limit = 3): Prediction => {
  const before = text.slice(0, cursor)
  const tokens = before.split(/\s+/)
  const current = tokens[tokens.length - 1] ?? ''
  const head = before.slice(0, before.length - current.length)
  const previousToken = tokens[tokens.length - 2] ?? ''
  const previous = isSentenceStart(head) ? undefined : bare(previousToken)
  const lead = head.slice(0, head.trimEnd().length - previousToken.length)
  const earlier = previous && !isSentenceStart(lead) ? bare(tokens[tokens.length - 3] ?? '') : undefined

  if (current === '') {
    if (text.trim() === '') return { prefix: '', words: [] }
    return { prefix: '', words: following(model, learned, previous, limit, earlier) }
  }
  if (!/^[A-Za-z][A-Za-z']*$/.test(current)) return { prefix: current, words: [] }

  return { prefix: current, words: complete(model, learned, current, previous, limit, earlier) }
}

/** What taking `word` after `before` adds: the rest of the word being typed, or a whole next word, then a space. */
export const addition = (before: string, word: string): string => {
  const typed = before.match(/[A-Za-z']*$/)?.[0] ?? ''
  const rest = typed && word.toLowerCase().startsWith(typed.toLowerCase()) ? word.slice(typed.length) : word
  const lead = !typed && before !== '' && !/\s$/.test(before) ? ' ' : ''
  return lead + rest + ' '
}

/** The draft with `word` taken at the cursor. */
export const accept = (text: string, cursor: number, word: string): { text: string; cursor: number } => {
  const added = addition(text.slice(0, cursor), word)
  return { text: text.slice(0, cursor) + added + text.slice(cursor), cursor: cursor + added.length }
}

/** Counts the words and word pairs of a sent prompt, leaving out code blocks, inline code and paths. */
export const learn = (learned: Learned, text: string): Learned => {
  const words = { ...learned.words }
  const pairs = { ...learned.pairs }
  const prose = text.replace(/```[\s\S]*?```/g, '\n').replace(/`[^`]*`/g, ' ')

  for (const sentence of prose.split(/(?<=[.!?])\s+|\n+/)) {
    let previous = START
    for (const token of sentence.split(/\s+/)) {
      const word = bare(token)
      if (!word) {
        previous = ''
        continue
      }
      words[word] = (words[word] ?? 0) + 1
      if (previous) pairs[previous] = { ...pairs[previous], [word]: (pairs[previous]?.[word] ?? 0) + 1 }
      previous = /[.!?,;:]$/.test(token) ? '' : word
    }
  }

  return { words: keepTop(words, MAX_WORDS), pairs: prunePairs(pairs) }
}

const keepTop = (counts: Record<string, number>, limit: number): Record<string, number> => {
  const entries = Object.entries(counts)
  if (entries.length <= limit) return counts
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, limit))
}

const prunePairs = (pairs: Record<string, Record<string, number>>): Record<string, Record<string, number>> => {
  let entries = Object.entries(pairs).map(([word, nexts]) => [word, keepTop(nexts, MAX_NEXT)] as const)
  if (entries.length > MAX_PAIRS) {
    const total = (nexts: Record<string, number>) => Object.values(nexts).reduce((a, b) => a + b, 0)
    entries = entries.sort((a, b) => total(b[1]) - total(a[1])).slice(0, MAX_PAIRS)
  }
  return Object.fromEntries(entries)
}
