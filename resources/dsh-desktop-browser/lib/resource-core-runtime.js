// Runtime ABI shim for @dfy-plugins/resource-core. The embedded browser plugin
// ships outside the Harness Profile, so it cannot resolve Profile node_modules;
// both copies converge on the same Symbol.for process registry.
export const RESOURCE_PROTOCOL_VERSION = 1
export const RESOURCE_REFERENCE_PREFIX = 'dfyr1_'
export const PROCESS_RESOURCE_REGISTRY_SYMBOL_KEY = '@dfy-plugins/resource-core/process-registry/v1'

const PROVIDER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/
const KIND_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{8,256}$/

export function encodeResourceReference(reference) {
  if (reference?.version !== RESOURCE_PROTOCOL_VERSION
    || typeof reference.provider !== 'string' || !PROVIDER_PATTERN.test(reference.provider)
    || typeof reference.kind !== 'string' || !KIND_PATTERN.test(reference.kind)
    || typeof reference.id !== 'string' || !RESOURCE_ID_PATTERN.test(reference.id)) {
    throw new Error('resource reference is invalid')
  }
  const payload = Buffer.from(JSON.stringify({
    v: RESOURCE_PROTOCOL_VERSION,
    p: reference.provider,
    k: reference.kind,
    i: reference.id,
  }), 'utf8').toString('base64url')
  return `${RESOURCE_REFERENCE_PREFIX}${payload}`
}

function decodeResourceReference(token) {
  const value = String(token ?? '').trim()
  if (value.length <= RESOURCE_REFERENCE_PREFIX.length || value.length > 2_048 || !value.startsWith(RESOURCE_REFERENCE_PREFIX)) {
    throw new Error('resource reference is invalid')
  }
  const encoded = value.slice(RESOURCE_REFERENCE_PREFIX.length)
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('resource reference is invalid')
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw new Error('resource reference is invalid')
  }
  if (parsed?.v !== RESOURCE_PROTOCOL_VERSION
    || typeof parsed.p !== 'string' || !PROVIDER_PATTERN.test(parsed.p)
    || typeof parsed.k !== 'string' || !KIND_PATTERN.test(parsed.k)
    || typeof parsed.i !== 'string' || !RESOURCE_ID_PATTERN.test(parsed.i)
    || Object.keys(parsed).some((key) => !['v', 'p', 'k', 'i'].includes(key))) {
    throw new Error('resource reference is invalid')
  }
  return { version: RESOURCE_PROTOCOL_VERSION, provider: parsed.p, kind: parsed.k, id: parsed.i }
}

function createRegistry() {
  const providers = new Map()
  return Object.freeze({
    version: RESOURCE_PROTOCOL_VERSION,
    registerProvider(provider) {
      if (!provider || typeof provider.id !== 'string' || !PROVIDER_PATTERN.test(provider.id) || typeof provider.resolve !== 'function') {
        throw new Error('resource provider id is invalid')
      }
      if (providers.has(provider.id)) throw new Error(`resource provider already registered: ${provider.id}`)
      providers.set(provider.id, provider)
      return () => { if (providers.get(provider.id) === provider) providers.delete(provider.id) }
    },
    hasProvider(id) { return providers.has(id) },
    listProviders() { return [...providers.keys()].sort() },
    async resolve(token, expectedKind, signal) {
      signal?.throwIfAborted()
      const reference = decodeResourceReference(token)
      if (expectedKind !== undefined && reference.kind !== expectedKind) {
        throw new Error(`resource kind mismatch: expected ${expectedKind}, received ${reference.kind}`)
      }
      const provider = providers.get(reference.provider)
      if (provider === undefined) throw new Error(`resource provider is unavailable: ${reference.provider}`)
      const resource = await provider.resolve(reference, signal)
      signal?.throwIfAborted()
      if (resource === undefined) throw new Error('resource is unavailable or expired')
      if (resource.kind !== reference.kind) throw new Error('resource provider returned a mismatched kind')
      if (resource.data !== undefined && resource.bytes !== undefined && resource.data.byteLength !== resource.bytes) {
        throw new Error('resource provider returned inconsistent byte metadata')
      }
      return resource
    },
  })
}

export function getProcessResourceRegistry() {
  const key = Symbol.for(PROCESS_RESOURCE_REGISTRY_SYMBOL_KEY)
  const existing = globalThis[key]
  if (existing !== undefined) {
    if (existing?.version !== RESOURCE_PROTOCOL_VERSION || typeof existing.registerProvider !== 'function' || typeof existing.resolve !== 'function') {
      throw new Error('process resource registry version conflict')
    }
    return existing
  }
  const registry = createRegistry()
  Object.defineProperty(globalThis, key, { value: registry, configurable: false, writable: false })
  return registry
}
