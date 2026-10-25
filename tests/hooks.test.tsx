import type { On, PromptBox, PromptEditInput } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { HISTORY, LEXICON, edit, fakeStore, option } from './fixture'

const strip = (isWorking = false) =>
  ({
    plugin: 'word-predict',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  }) as const

// `prompt.edit` is raised by the composer, not called on `$`, so its call is
// untyped in the kit; the kit raises it all the same.
const type = ($: unknown, e: PromptEditInput) =>
  ($ as { prompt: { edit: (e: PromptEditInput) => Promise<PromptBox> } }).prompt.edit(e)

const predict = (args: string) => ({
  command: 'predict',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 80 },
})

const submit = (text: string) => ({ text, origin: { kind: 'composer' as const }, wait: false })

/** The engine beneath the mod: a composer that applies edits as given, a store, a session. */
const engine = (on: On, entries: Map<string, unknown>) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'predict' } }))
  on('prompt.edit', (_, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  // What the band shows when the mod draws nothing.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  fakeStore(on, entries)
}

const start = ($: { session: { start: (e: { cwd: string; surface: 'desktop'; isInteractive: boolean }) => Promise<unknown> } }) =>
  $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

test('a held space shows next words; a click adds the word with its space', async ($, on) => {
  const entries = new Map<string, unknown>([['lexicon', LEXICON]])
  engine(on, entries)
  // The desktop holds the space back: the box is still 'i want' when the strip is pressed.
  on('prompt.read', () => ({ value: { text: 'i want', cursor: 6 } }))
  const filled: string[] = []
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true, text: 'i want to ', cursor: 10 }
  })
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    await type($, edit('i want', '', { key: { key: 'space' } }))
    const ui = await $.ui.mount({ ...strip(), surface })
    expect((await ui.find({ key: 'w0' }))?.text).toBe('to')
    await ui.press({ key: 'w0' })
    expect(filled.pop()).toBe(' to ')
    // A click is no keystroke: the strip moves on to the words after it.
    expect((await ui.find({ key: 'w0' }))?.text).toBe('be')
    await ui.unmount()
  }
})

test('Option+1 takes a word only while the strip is drawn, and pressed again types its character', async ($, on) => {
  const entries = new Map<string, unknown>([['lexicon', LEXICON], ['settings', { isOn: true, layout: 'danish' }]])
  engine(on, entries)
  await start($)

  await type($, edit('i want', '', { key: { key: 'space' } }))
  const ui = await $.ui.mount({ ...strip(), surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Danish/ }))?.text).toBe('Danish')
  const picked = await type($, edit('i want', ' ¡', { key: option('¡') }))
  expect(picked).toEqual({ text: 'i want to ', cursor: 10 })
  expect(await type($, edit(picked.text, '¡', { key: option('¡'), start: 9, end: 10 }))).toEqual({
    text: 'i want ¡',
    cursor: 8,
  })
  await ui.unmount()

  // While Claude works the strip is hidden, so the key types its character.
  const hidden = await $.ui.mount({ ...strip(true), surface: 'desktop' })
  expect((await type($, edit('i want', ' ¡', { key: option('¡') }))).text).toBe('i want ¡')
  await hidden.unmount()
})

test('learning merges with what other sessions stored, and a forget elsewhere sticks', async ($, on) => {
  const entries = new Map<string, unknown>([['lexicon', LEXICON]])
  engine(on, entries)
  await start($)

  // Another session learned 'spaceship' after this one started.
  entries.set('learned', { words: { spaceship: 3 }, pairs: {} })
  await $.prompt.submit(submit('fix the build'))
  expect(entries.get('learned')).toMatchObject({ words: { spaceship: 3, fix: 1, build: 1 } })

  // Another session ran /predict forget: this session's next prompt must not bring it back.
  entries.delete('learned')
  await $.prompt.submit(submit('ship it'))
  expect(entries.get('learned')).toMatchObject({ words: { ship: 1, it: 1 } })
  expect((entries.get('learned') as { words: Record<string, number> }).words.spaceship).toBeUndefined()
})

test('a prompt refused beneath is not learned', async ($, on) => {
  const entries = new Map<string, unknown>([['lexicon', LEXICON]])
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'predict' } }))
  on('prompt.submit', () => ({ drop: 'blocked by a guard' }))
  fakeStore(on, entries)
  await start($)

  await $.prompt.submit(submit('the password is swordfish'))
  expect(entries.get('learned')).toBeUndefined()
})

test('/predict off and layout are kept for the next session', async ($, on) => {
  const entries = new Map<string, unknown>([['lexicon', LEXICON], ['history', HISTORY]])
  engine(on, entries)
  await start($)

  expect((await $.command.run(predict(''))).text).toContain('2 past prompts imported')
  await $.command.run(predict('layout danish'))
  await $.command.run(predict('off'))
  expect(entries.get('settings')).toEqual({ isOn: false, layout: 'danish' })
  expect((await $.command.run(predict('layout dvorak'))).text).toContain('Pick one of')
  await $.prompt.submit(submit('nothing to learn while off'))
  expect(entries.get('learned')).toBeUndefined()

  await $.command.run(predict('forget'))
  expect(entries.has('history')).toBe(false)
  expect((await $.command.run(predict(''))).text).toContain('not imported')
})

test('a word list from an older version is downloaded again, in ranges under the fetch limit', async ($, on) => {
  const entries = new Map<string, unknown>([['lexicon', { words: 'the', next: '' }]])
  engine(on, entries)
  const ranges: string[] = []
  on('http.fetch', (_, e) => {
    ranges.push(e.init?.headers?.Range ?? 'none')
    return { value: { status: 206, ok: true, headers: {}, text: 'not the real file' } }
  })
  await start($)

  expect(ranges.length).toBeGreaterThan(0)
  expect(ranges.every(range => /^bytes=\d+-\d+$/.test(range))).toBe(true)
  // The tampered body fails the hash check, so nothing is stored over the old list.
  expect(entries.get('lexicon')).toEqual({ words: 'the', next: '' })
})

test('an import too large to keep is refused, and nothing changes', async ($, on) => {
  const entries = new Map<string, unknown>([['lexicon', LEXICON]])
  engine(on, entries)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '{"prompts":', stderr: '', isStdoutTruncated: true, isStderrTruncated: false } }))
  await start($)

  expect((await $.command.run(predict('import'))).text).toContain('too large')
  expect(entries.has('history')).toBe(false)
  expect((await $.command.run(predict(''))).text).toContain('not imported')
})
