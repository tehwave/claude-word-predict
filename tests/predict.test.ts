import { expect, test } from 'claude-code/testing'

import { literal, readPress, take } from '../hooks/keys'
import { isBlocked } from '../hooks/lexicon'
import { START, accept, addition, buildModel, complete, empty, following, learn, predict } from '../hooks/predict'
import { HISTORY, LEXICON, edit, option } from './fixture'

const web = buildModel(LEXICON)
const mine = buildModel(LEXICON, HISTORY)

test('the word list keeps words by frequency, and each word its likeliest followers', async () => {
  expect(LEXICON.words.startsWith('the to i want')).toBe(true)
  expect(following(web, empty(), 'want', 3)).toEqual(['to', 'a', 'it'])
})

test('a contraction takes over the followers of its apostrophe-less spelling', async () => {
  expect(LEXICON.words.split(' ')).toContain("don't")
  expect(LEXICON.words.split(' ')).not.toContain('dont')
  expect(predict(web, empty(), "I don't ", 8).words[0]).toBe('know')
})

test('blocked words are kept out with their inflections, harmless neighbours are not', async () => {
  expect(isBlocked('upskirts')).toBe(true)
  expect(isBlocked('cocks')).toBe(true)
  expect(isBlocked('upstream')).toBe(false)
  expect(isBlocked('cocktail')).toBe(false)
  expect(LEXICON.words.split(' ')).not.toContain('upskirts')
  expect(complete(web, empty(), 'ups', undefined, 3)).toEqual(['upstream'])
})

test('completes the word being typed, in the case it was typed', async () => {
  expect(complete(web, empty(), 'predic', undefined, 3)).toEqual(['prediction', 'predicted', 'predict'])
  expect(complete(web, empty(), 'Predic', undefined, 1)).toEqual(['Prediction'])
  expect(complete(web, empty(), 'wan', 'i', 1)).toEqual(['want'])
})

test('suggests next words, without web filler', async () => {
  expect(predict(web, empty(), 'i want to ', 10).words).toEqual(['be', 'make', 'a'])
})

test('your past prompts come first, and two words of context beat one', async () => {
  expect(following(mine, empty(), 'you', 2)).toEqual(['make', 'do'])
  expect(predict(mine, empty(), 'can you ', 8).words.slice(0, 2)).toEqual(['help', 'make'])
  expect(predict(mine, empty(), 'Done. ', 6).words.slice(0, 2)).toEqual(['Fix', 'Can'])
  // A sentence's second word uses the two-word table keyed by its start.
  expect(predict(mine, empty(), 'Done. Can ', 10).words[0]).toBe('you')
})

test('sentence starters also complete the first word of a sentence', async () => {
  expect(predict(mine, empty(), 'Done. F', 7).words[0]).toBe('Fix')
})

test('after a token that is not a word, nothing is offered rather than sentence starters', async () => {
  expect(predict(web, empty(), 'wait 30 ', 8).words).toEqual([])
  expect(predict(web, empty(), 'open src/app.ts ', 16).words).toEqual([])
})

test('offers nothing in an empty box, and leaves commands, mentions and paths alone', async () => {
  expect(predict(web, empty(), '', 0).words).toEqual([])
  expect(predict(web, empty(), '/comp', 5).words).toEqual([])
  expect(predict(web, empty(), 'see @src/ma', 11).words).toEqual([])
})

test('learns the words and pairs of sent prompts, not their code', async () => {
  let learned = learn(empty(), 'refactor the spaceship component. ```const x = 1```')
  learned = learn(learned, 'refactor the spaceship tests `npm run test`')
  learned = learn(learned, 'why does this fail\n```\nconst server = await thing\n')

  expect(learned.words.spaceship).toBe(2)
  expect(learned.words.const).toBeUndefined()
  expect(learned.words.npm).toBeUndefined()
  expect(learned.words.server).toBeUndefined()
  expect(following(web, learned, 'the', 1)).toEqual(['spaceship'])
  expect(complete(web, learned, 'spa', 'the', 1)).toEqual(['spaceship'])
  expect(following(web, learned, START, 1)).toEqual(['Refactor'])
})

test('a word seen once is offered neither as a completion nor as a next word', async () => {
  const learned = learn(empty(), 'i want teh file')
  expect(complete(web, learned, 'te', undefined, 3)).toEqual([])
  expect(following(web, learned, 'want', 3)).not.toContain('teh')
})

test('a full table still learns new words: ties go to the most recent', async () => {
  let learned = empty()
  for (const next of 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'.split(' ')) {
    learned = learn(learned, `the ${next}`)
  }
  learned = learn(learned, 'the spaceship')
  learned = learn(learned, 'the spaceship')
  expect(learned.pairs.the?.spaceship).toBe(2)
  expect(following(web, learned, 'the', 1)).toEqual(['spaceship'])
})

test('words that are names on Object.prototype count like any other', async () => {
  let learned = learn(empty(), 'fix the constructor')
  learned = learn(JSON.parse(JSON.stringify(learned)), 'the constructor is fine')
  const word: string = 'constructor'
  expect(learned.words[word]).toBe(2)
  expect(learned.pairs.the?.[word]).toBe(2)
  expect(learned.pairs[word]?.is).toBe(1)
})

test('a next word gets a space in front when the box has none, a completion does not', async () => {
  expect(addition('i want', 'to', '')).toBe(' to ')
  expect(addition('i want ', 'to', '')).toBe('to ')
  expect(addition('i wa', 'want', 'wa')).toBe('nt ')
  expect(accept('see the predic here', 14, 'prediction', 'predic')).toEqual({ text: 'see the prediction  here', cursor: 19 })
})

test('Option+1..3 follow the chosen layout only', async () => {
  // Option+1 as the desktop sends it after a held space: ' ¡' typed after 'i want'.
  const one = readPress('danish', edit('i want', ' ¡', { key: option('¡') }))
  expect(one && take(web, empty(), one)).toEqual({ text: 'i want to ', cursor: 10 })
  // Danish Option+2 and +3, sent as replacing the space after the last word.
  const two = readPress('danish', edit('i want to ', '“', { key: option('“'), start: 9, end: 10 }))
  expect(two && take(web, empty(), two)?.text).toBe('i want to make ')
  const three = readPress('danish', edit('i want to ', '§', { key: option('§'), start: 9, end: 10 }))
  expect(three && take(web, empty(), three)?.text).toBe('i want to a ')
  // Another layout's characters, and Danish Option+4 (£), are typed as written.
  expect(readPress('danish', edit('i want', '™', { key: option('™') }))).toBeUndefined()
  expect(readPress('danish', edit('i want', '£', { key: option('£') }))).toBeUndefined()
  expect(readPress('us', edit('the price in ', '€', { key: option('€') }))).toBeUndefined()
  expect(readPress('british', edit('i want', ' #', { key: option('#') }))?.place).toBe(2)
})

test('an undo or paste that ends in a pick character is not a pick', async () => {
  expect(readPress('danish', edit('i want', 'quote “', { key: { key: 'z', meta: true } }))).toBeUndefined()
  expect(readPress('danish', edit('i want', 'x¡', { key: option('¡') }))).toBeUndefined()
})

test('a pick with nothing on offer leaves the key to the box; literal types the character', async () => {
  const press = readPress('us', edit('i want', ' ¡', { key: option('¡') }))
  expect(press && take(buildModel(), empty(), press)).toBeUndefined()
  expect(press && literal(press)).toEqual({ text: 'i want ¡', cursor: 8 })
})
