import type { History, Learned, Lexicon, Prediction } from '../types'

// Stands for "the start of a sentence" as a previous word.
export const START = '<s>'
const WORD = /^[a-z][a-z']*$/
const STARTERS = ['i', 'can', 'please', 'the', 'what', 'how']
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

// Learned counts are plain objects read back from JSON, so a word such as
// `constructor` must be read as an own property, never through the prototype.
const count = (counts: Record<string, number> | undefined, word: string): number => {
  const value = counts && Object.hasOwn(counts, word) ? counts[word] : undefined
  return typeof value === 'number' ? value : 0
}

const followersOf = (learned: Learned, word: string): Record<string, number> | undefined =>
  Object.hasOwn(learned.pairs, word) ? learned.pairs[word] : undefined

const byCount = (counts: Record<string, number> | undefined): string[] =>
  Object.keys(counts ?? {})
    .map(word => [word, count(counts, word)] as const)
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)

/** Writes `word` in the case the person used for `like`: `Pre` -> `Prediction`. */
const cased = (word: string, like: string): string => {
  if (word === 'i' || word.startsWith("i'")) return capital(word)
  if (like.length > 1 && like === like.toUpperCase()) return word.toUpperCase()
  if (like[0] && like[0] !== like[0].toLowerCase()) return capital(word)
  return word
}

const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

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

/** True for a word worth offering: in the word list or past prompts, or sent at least twice. */
const isKnown = (model: Model, learned: Learned, word: string): boolean =>
  model.inVocab.has(word) || model.mine.has(word) || count(learned.words, word) >= 2

/** Words likely after `previous` (and `earlier` before it), best first: the person's own, then the web's. */
const candidates = (model: Model, learned: Learned, previous: string, earlier?: string): string[] =>
  [
    ...(earlier ? (model.mine2.get(`${earlier} ${previous}`) ?? []) : []),
    ...byCount(followersOf(learned, previous)).filter(word => isKnown(model, learned, word)),
    ...(model.mine.get(previous) ?? []),
    ...(model.next.get(previous) ?? []).filter(word => !FILLER.has(word)),
    ...(previous === START ? STARTERS : []),
  ].filter(word => word !== previous)

/** Ways to finish `prefix`, given the words before it (`START` at a sentence start). */
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

  const found: string[] = []
  if (previous) found.push(...candidates(model, learned, previous, earlier).filter(fits))
  found.push(...byCount(learned.words).filter(word => fits(word) && count(learned.words, word) >= 2))
  for (const word of model.vocab) {
    if (found.length >= limit * 4) break
    if (fits(word)) found.push(word)
  }

  return unique(found, limit).map(word => cased(word, prefix))
}

/** Likely next words after `previous`; sentence starters, capitalised, after `START`. */
export const following = (model: Model, learned: Learned, previous: string, limit: number, earlier?: string): string[] => {
  const found = unique(candidates(model, learned, previous, earlier), limit)
  return previous === START ? found.map(capital) : found.map(word => cased(word, word))
}

/** What the strip offers for a draft with the caret at `cursor`. */
export const predict = (model: Model, learned: Learned, text: string, cursor: number, limit = 3): Prediction => {
  const before = text.slice(0, cursor)
  const tokens = before.split(/\s+/)
  const current = tokens[tokens.length - 1] ?? ''
  const head = before.slice(0, before.length - current.length)
  const previousToken = tokens[tokens.length - 2] ?? ''
  // START at a sentence start; undefined after a token that isn't a word (a path, a number).
  const previous = isSentenceStart(head) ? START : bare(previousToken)
  const lead = head.slice(0, head.trimEnd().length - previousToken.length)
  const earlier = previous && previous !== START ? (isSentenceStart(lead) ? START : bare(tokens[tokens.length - 3] ?? '')) : undefined

  if (current === '') {
    if (text.trim() === '' || !previous) return { prefix: '', words: [] }
    return { prefix: '', words: following(model, learned, previous, limit, earlier) }
  }
  if (!/^[A-Za-z][A-Za-z']*$/.test(current)) return { prefix: current, words: [] }

  return { prefix: current, words: complete(model, learned, current, previous, limit, earlier) }
}

/**
 * What taking `word` adds after `before`: for a completion (`prefix` set), the
 * rest of the word being typed; for a next word, the word with a space in
 * front where `before` doesn't end in one. Then a space.
 */
export const addition = (before: string, word: string, prefix: string): string => {
  if (prefix) {
    const typed = before.match(/[A-Za-z']+$/)?.[0] ?? ''
    const rest = typed && word.toLowerCase().startsWith(typed.toLowerCase()) ? word.slice(typed.length) : word
    return rest + ' '
  }
  return (before === '' || /\s$/.test(before) ? '' : ' ') + word + ' '
}

/** The draft with `word` taken at the cursor. */
export const accept = (text: string, cursor: number, word: string, prefix: string): { text: string; cursor: number } => {
  const added = addition(text.slice(0, cursor), word, prefix)
  return { text: text.slice(0, cursor) + added + text.slice(cursor), cursor: cursor + added.length }
}

/** Adds `n` to `word` in `counts`, moving it to the end so insertion order is recency. */
const bump = (counts: Record<string, number>, word: string, n: number): void => {
  const total = count(counts, word) + n
  delete counts[word]
  counts[word] = total
}

/** Counts the words and word pairs of a sent prompt into `learned`, leaving out code and paths. */
export const learn = (learned: Learned, text: string): Learned => {
  const words: Record<string, number> = Object.assign(Object.create(null), learned.words)
  const pairs: Record<string, Record<string, number>> = Object.assign(Object.create(null), learned.pairs)
  // Closed code fences, then an unclosed one to the end, then inline code.
  const prose = text
    .replace(/(```|~~~)[\s\S]*?\1/g, '\n')
    .replace(/(```|~~~)[\s\S]*$/, '\n')
    .replace(/`[^`\n]*`/g, ' ')

  for (const sentence of prose.split(/(?<=[.!?]["')]*)\s+|\n+/)) {
    let previous = START
    for (const token of sentence.trim().split(/\s+/)) {
      const word = bare(token)
      if (!word) {
        previous = ''
        continue
      }
      bump(words, word, 1)
      if (previous) {
        const nexts: Record<string, number> = Object.assign(Object.create(null), followersOf({ words, pairs }, previous))
        bump(nexts, word, 1)
        delete pairs[previous]
        pairs[previous] = nexts
      }
      previous = /[.!?,;:]["')]*$/.test(token) ? '' : word
    }
  }

  return { words: keepTop(words, MAX_WORDS), pairs: prunePairs(pairs) }
}

/** Keeps the `limit` highest counts; on a tie the more recent entry stays, so new words get a chance. */
const keepTop = (counts: Record<string, number>, limit: number): Record<string, number> => {
  const entries = Object.keys(counts).map((word, at) => ({ word, n: count(counts, word), at }))
  if (entries.length <= limit) return counts
  const kept = entries.sort((a, b) => b.n - a.n || b.at - a.at).slice(0, limit).sort((a, b) => a.at - b.at)
  const result: Record<string, number> = Object.create(null)
  for (const { word, n } of kept) result[word] = n
  return result
}

const prunePairs = (pairs: Record<string, Record<string, number>>): Record<string, Record<string, number>> => {
  const entries = Object.keys(pairs).map((word, at) => {
    const nexts = keepTop(pairs[word] ?? {}, MAX_NEXT)
    const total = Object.keys(nexts).reduce((sum, next) => sum + count(nexts, next), 0)
    return { word, nexts, total, at }
  })
  const kept = entries.length > MAX_PAIRS ? entries.sort((a, b) => b.total - a.total || b.at - a.at).slice(0, MAX_PAIRS) : entries
  const result: Record<string, Record<string, number>> = Object.create(null)
  for (const { word, nexts } of kept.sort((a, b) => a.at - b.at)) result[word] = nexts
  return result
}
