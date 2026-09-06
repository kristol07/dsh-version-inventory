import type { VersionInventory } from '../types.js'

/** Exact route and custom header the host half registers; kept in sync by hand. */
const API_PATH = '/dsh-version-inventory/api/list'
const API_HEADER = 'X-DSH-Version-Inventory'

/**
 * Read one inventory snapshot from the host half.
 * @param signal - abort signal from the caller's effect.
 * @returns the snapshot.
 * @throws when the route answers non-2xx or the body is not JSON.
 */
export async function fetchInventory(signal?: AbortSignal): Promise<VersionInventory> {
  const response = await fetch(API_PATH, { headers: { [API_HEADER]: '1' }, signal })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body
      ? String((body as { error: unknown }).error)
      : 'HTTP ' + String(response.status)
    throw new Error(message)
  }
  return body as VersionInventory
}
