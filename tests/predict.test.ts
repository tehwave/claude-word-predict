import { expect, test } from 'claude-code/testing'

import { pickByKey } from '../hooks/keys'
import { accept, buildModel, complete, empty, following, learn, predict } from '../hooks/predict'
import { HISTORY, LEXICON } from './fixture'

const web = buildModel(LEXICON)
const mine = buildModel(LEXICON, HISTORY)

test('the word list keeps words by frequency, and each word its likeliest followers', async () => {
  expect(LEXICON.words.startsWith('the to i want')).toBe(true)
  expect(following(web, empty(), 'want', 3)).toEqual(['to', 'a', 'it'])
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
})

test('offers nothing in an empty box, and leaves commands, mentions and paths alone', async () => {
  expect(predict(web, empty(), '', 0).words).toEqual([])
  expect(predict(web, empty(), '/comp', 5).words).toEqual([])
  expect(predict(web, empty(), 'see @src/ma', 11).words).toEqual([])
})

test('learns the words and pairs of sent prompts, not their code', async () => {
  let learned = learn(empty(), 'refactor the spaceship component. ```const x = 1```')
  learned = learn(learned, 'refactor the spaceship tests `npm run test`')

  expect(learned.words.spaceship).toBe(2)
  expect(learned.words.const).toBeUndefined()
  expect(learned.words.npm).toBeUndefined()
  expect(following(web, learned, 'the', 1)).toEqual(['spaceship'])
  expect(complete(web, learned, 'spa', 'the', 1)).toEqual(['spaceship'])
  expect(following(web, learned, undefined, 1)).toEqual(['Refactor'])
})

test('a word seen once is not offered unless the word list knows it', async () => {
  expect(complete(web, learn(empty(), 'zxqfoo bar'), 'zxq', undefined, 3)).toEqual([])
})

test('accept finishes a word mid-draft and keeps what follows', async () => {
  expect(accept('see the predic here', 14, 'prediction')).toEqual({ text: 'see the prediction  here', cursor: 19 })
  expect(accept('hello ', 6, 'world')).toEqual({ text: 'hello world ', cursor: 12 })
})

const edit = (key: string, text: string, start: number, end: number, inputText: string) => ({
  origin: { kind: 'composer' as const },
  key: { key, meta: true as const },
  text,
  cursor: text.length,
  start,
  end,
  inputText,
})

test('Option+1..3 take a suggestion on US and Danish layouts', async () => {
  // Option+1 as the desktop sends it after a held space: ' ¡' typed after 'i want'.
  expect(pickByKey(web, empty(), edit('¡', 'i want', 6, 6, ' ¡'))).toEqual({ text: 'i want to ', cursor: 10 })
  expect(pickByKey(web, empty(), edit('™', 'i want', 6, 6, ' ™'))?.text).toBe('i want a ')
  // Danish Option+2 and +3, sent as replacing the space after the last word.
  expect(pickByKey(web, empty(), edit('“', 'i want to ', 9, 10, '“'))?.text).toBe('i want to make ')
  expect(pickByKey(web, empty(), edit('§', 'i want to ', 9, 10, '§'))?.text).toBe('i want to a ')
})

test('other keys, and a pick with nothing on offer, are left to the box', async () => {
  expect(pickByKey(web, empty(), edit('x', 'i want', 6, 6, 'x'))).toBeUndefined()
  expect(pickByKey(buildModel(), empty(), edit('¡', 'i want', 6, 6, ' ¡'))).toBeUndefined()
})
