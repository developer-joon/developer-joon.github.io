export type AccountLifecycle = {
  readonly actorId: string | null
  readonly session: object | null
  readonly generation: symbol
}

export type AccountState<T> = {
  readonly lifecycle: AccountLifecycle
  readonly value: T
}

export function accountLifecycle(
  previous: AccountLifecycle | undefined,
  actorId: string | null,
  session: object | null,
): AccountLifecycle {
  if (previous?.actorId === actorId && previous.session === session) return previous
  return { actorId, session, generation: Symbol('account lifecycle') }
}

export function visibleAccountState<T>(state: AccountState<T> | null, current: AccountLifecycle): T | null {
  return isAccountStateVisible(state?.lifecycle ?? null, current) ? state!.value : null
}

export function isAccountStateVisible(state: AccountLifecycle | null, current: AccountLifecycle): boolean {
  return state === current
}
