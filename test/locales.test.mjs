/**
 * Dictionary parity, checked against the sources under tsx.
 *
 * TypeScript already forces every locale to carry the same keys as `en` — the
 * `satisfies Record<VersionInventoryLocaleKey, string>` on each dictionary sees
 * to that. What it cannot see is the inside of a string: a `{placeholder}` the
 * translator dropped or misspelled compiles fine and renders as literal braces
 * in front of the user. That is what these assert.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { en, zh } from '../src/locales.ts'

/** Every locale this package ships, by tag. */
const DICTS = { en, zh }

/**
 * The `{name}` placeholders one template declares.
 * @param template - a dictionary value.
 * @returns the placeholder names, sorted and deduplicated.
 */
function placeholders(template) {
  return [...new Set([...template.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort()
}

describe('dictionaries', () => {
  it('ship the same keys in every locale', () => {
    const expected = Object.keys(en).sort()
    for (const [tag, dict] of Object.entries(DICTS)) {
      assert.deepEqual(Object.keys(dict).sort(), expected, `${tag} does not match en`)
    }
  })

  it('declare the same placeholders in every locale', () => {
    for (const key of Object.keys(en)) {
      const expected = placeholders(en[key])
      for (const [tag, dict] of Object.entries(DICTS)) {
        assert.deepEqual(placeholders(dict[key]), expected, `${tag}.${key} placeholders differ from en`)
      }
    }
  })

  it('leaves no value blank', () => {
    for (const [tag, dict] of Object.entries(DICTS)) {
      for (const [key, value] of Object.entries(dict)) {
        assert.ok(value.trim().length > 0, `${tag}.${key} is empty`)
      }
    }
  })
})
