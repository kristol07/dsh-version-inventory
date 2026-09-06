import type { RouteError, VersionInventory } from '../types.js'

/** Exact route and custom header the host half registers; kept in sync by hand. */
const API_PATH = '/dsh-version-inventory/api/list'
const API_HEADER = 'X-DSH-Version-Inventory'

/**
 * Why a read failed, as a fact the panel phrases.
 *
 * The route's own failures arrive already in this shape. `transport` covers
 * everything that never reached the route's own handling — the fetch itself
 * rejecting, a body that is not JSON, or an `error` whose `kind` this build
 * does not know, which is what a newer host would produce against an older
 * bundle.
 */
export type ReadFailure = RouteError | { readonly kind: 'transport', readonly reason: string }

/** The kinds this build can phrase; anything else degrades to its raw text. */
const KNOWN_KINDS = new Set<string>(['forbidden', 'method', 'collect'])

/**
 * Read the structured failure out of a non-2xx body.
 * @param body - the parsed response body, or null when it did not parse.
 * @param status - the HTTP status, the only fact left when the body says nothing.
 * @returns the failure to render.
 */
function readFailure(body: unknown, status: number): ReadFailure {
  const error = typeof body === 'object' && body !== null && 'error' in body
    ? (body as { error: unknown }).error
    : undefined
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    const kind = (error as { kind: unknown }).kind
    if (typeof kind === 'string' && KNOWN_KINDS.has(kind)) return error as RouteError
  }
  // A host that answers something this build cannot name still gets shown: the
  // raw text beats an invented sentence, and beats silence.
  return {
    kind: 'transport',
    reason: error === undefined ? 'HTTP ' + String(status) : String(error),
  }
}

/** A read that failed, carrying the fact the panel renders. */
export class InventoryReadError extends Error {
  /** Why the read failed. */
  readonly failure: ReadFailure

  /**
   * @param failure - the structured reason.
   */
  constructor(failure: ReadFailure) {
    // The message is a diagnostic label, never panel copy — the panel renders
    // `failure` through the dictionary instead.
    super('dsh-version-inventory: read failed (' + failure.kind + ')')
    this.name = 'InventoryReadError'
    this.failure = failure
  }
}

/**
 * The failure behind any thrown value.
 *
 * The panel calls this rather than testing types itself: a throw that did not
 * come from here — a bug in the effect, a rejected promise from somewhere else
 * — still has to reach the reader as something, and `transport` with the raw
 * message is the honest something.
 * @param error - any thrown value.
 * @returns the failure to render.
 */
export function asReadFailure(error: unknown): ReadFailure {
  if (error instanceof InventoryReadError) return error.failure
  return { kind: 'transport', reason: error instanceof Error ? error.message : String(error) }
}

/**
 * Read one inventory snapshot from the host half.
 * @param signal - abort signal from the caller's effect.
 * @returns the snapshot.
 * @throws {InventoryReadError} when the route answers non-2xx, or the read never reached it.
 */
export async function fetchInventory(signal?: AbortSignal): Promise<VersionInventory> {
  let response: Response
  try {
    response = await fetch(API_PATH, { headers: { [API_HEADER]: '1' }, signal })
  } catch (error) {
    // An abort is the caller's own doing and stays an AbortError, so the
    // effect can still tell a cancelled read from a failed one.
    if (signal?.aborted === true) throw error
    throw new InventoryReadError({
      kind: 'transport',
      reason: error instanceof Error ? error.message : String(error),
    })
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new InventoryReadError(readFailure(body, response.status))
  return body as VersionInventory
}
