import { useCallback, useEffect, useState } from 'react'
import type { CommunityRepository } from '../data/communityRepository'
import { AppHeader } from '../components/AppHeader'
import { AppFooter } from '../components/AppFooter'
import { PostList } from '../components/PostList'
import { SearchBar } from '../components/SearchBar'
import { SortTabs } from '../components/SortTabs'
import { StatePanel } from '../components/StatePanel'
import { TagFilter } from '../components/TagFilter'
import { SessionRecoveryNotice, useSessionRecoveryNotice } from '../components/SessionRecoveryNotice'
import { useAuth } from '../auth/AuthProvider'
import { isValidPostCursor, parseCommunityQuery, serializeCommunityQuery, type CommunityQueryState } from '../lib/queryState'
import type { CommunityError, CommunityTag, PostCursor, PostListItem } from '../types/community'

interface CommunityHomePageProps {
  repository: CommunityRepository
  initialSearch?: string
  onQueryChange?: (search: string) => void
}

const historyStateKey = 'communityListing'
const pageSize = 21

interface CommunityHistorySnapshot {
  version: 2
  query: string
  posts: PostListItem[]
  nextCursor: PostCursor | null
  hasPreviousListing: boolean
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPostListItem(value: unknown): value is PostListItem {
  if (typeof value !== 'object' || value === null) return false
  const post = value as Record<string, unknown>
  const author = post.author
  if (typeof author !== 'object' || author === null) return false
  const authorFields = author as Record<string, unknown>
  if (!Array.isArray(post.tags)) return false

  return isNonEmptyString(post.id)
    && typeof post.title === 'string'
    && typeof post.excerpt === 'string'
    && isNonEmptyString(post.createdAt)
    && !Number.isNaN(Date.parse(post.createdAt))
    && isNonEmptyString(post.updatedAt)
    && !Number.isNaN(Date.parse(post.updatedAt))
    && typeof post.isLocked === 'boolean'
    && typeof post.isPinned === 'boolean'
    && isFiniteNumber(post.commentCount)
    && isFiniteNumber(post.reactionCount)
    && isFiniteNumber(post.popularityScore)
    && isNonEmptyString(authorFields.id)
    && isNonEmptyString(authorFields.login)
    && isNullableString(authorFields.displayName)
    && isNullableString(authorFields.avatarUrl)
    && post.tags.every((tag) => {
      if (typeof tag !== 'object' || tag === null) return false
      const fields = tag as Record<string, unknown>
      return isNonEmptyString(fields.id)
        && isNonEmptyString(fields.slug)
        && typeof fields.label === 'string'
    })
}

function snapshotFromHistoryState(state: unknown, query: CommunityQueryState): Pick<CommunityHistorySnapshot, 'posts' | 'nextCursor' | 'hasPreviousListing'> {
  const empty = { posts: [], nextCursor: null, hasPreviousListing: false }
  if (typeof state !== 'object' || state === null) return empty
  const snapshot = (state as Record<string, unknown>)[historyStateKey]
  if (typeof snapshot !== 'object' || snapshot === null) return empty
  const candidate = snapshot as Partial<CommunityHistorySnapshot>
  const serializedQuery = serializeCommunityQuery(query)
  return candidate.version === 2
    && candidate.query === serializedQuery
    && Array.isArray(candidate.posts)
    && candidate.posts.length <= pageSize
    && candidate.posts.every(isPostListItem)
    && (candidate.nextCursor === null || isValidPostCursor(candidate.nextCursor, query.sort))
    ? { posts: candidate.posts, nextCursor: candidate.nextCursor, hasPreviousListing: candidate.hasPreviousListing === true }
    : empty
}

function withPostsSnapshot(
  state: unknown,
  query: string,
  posts: PostListItem[],
  nextCursor: PostCursor | null,
  hasPreviousListing: boolean,
) {
  const current = typeof state === 'object' && state !== null ? state : {}
  return {
    ...current,
    [historyStateKey]: {
      version: 2,
      query,
      posts: posts.slice(0, pageSize),
      nextCursor,
      hasPreviousListing,
    } satisfies CommunityHistorySnapshot,
  }
}

function safeHistoryWrite(method: 'pushState' | 'replaceState', state: unknown, url?: string) {
  try {
    window.history[method](state, '', url)
    return true
  } catch {
    try {
      window.history[method]({}, '', url)
      return true
    } catch {
      // Browsing still works in-memory when a browser rejects all History API writes.
      return false
    }
  }
}

function appendUniquePosts(current: PostListItem[], incoming: PostListItem[]) {
  const result = [...current]
  const knownIds = new Set(current.map((post) => post.id))
  for (const post of incoming) {
    if (knownIds.has(post.id)) continue
    knownIds.add(post.id)
    result.push(post)
  }
  return result
}

export function CommunityHomePage({ repository, initialSearch, onQueryChange }: CommunityHomePageProps) {
  const auth = useAuth()
  const [usesCurrentLocation] = useState(() => initialSearch === undefined || initialSearch === window.location.search)
  const [query, setQuery] = useState<CommunityQueryState>(() => parseCommunityQuery(initialSearch ?? window.location.search))
  const [initialSnapshot] = useState(() => usesCurrentLocation
    ? snapshotFromHistoryState(window.history.state, parseCommunityQuery(window.location.search))
    : { posts: [], nextCursor: null, hasPreviousListing: false })
  const [tags, setTags] = useState<CommunityTag[]>([])
  const [posts, setPosts] = useState<PostListItem[]>(initialSnapshot.posts)
  const [postsQuery, setPostsQuery] = useState(() => initialSnapshot.posts.length > 0 ? serializeCommunityQuery(query) : '')
  const [nextCursor, setNextCursor] = useState<PostCursor | null>(initialSnapshot.nextCursor)
  const [hasPreviousListing, setHasPreviousListing] = useState(initialSnapshot.hasPreviousListing)
  const [error, setError] = useState<CommunityError | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [tagError, setTagError] = useState<CommunityError | null>(null)
  const [tagAttempt, setTagAttempt] = useState(0)
  const [recovery, consumeRecovery] = useSessionRecoveryNotice()

  const applyQuery = useCallback((next: CommunityQueryState, ownsPreviousListing = false) => {
    const search = serializeCommunityQuery(next)
    const normalized = parseCommunityQuery(search)
    setQuery(normalized)
    if (onQueryChange) {
      onQueryChange(search)
      setHasPreviousListing(false)
    } else {
      const wroteHistory = safeHistoryWrite(
        'pushState',
        withPostsSnapshot(window.history.state, search, [], null, ownsPreviousListing),
        `${window.location.pathname}${search}`,
      )
      setHasPreviousListing(ownsPreviousListing && wroteHistory)
    }
  }, [onQueryChange])

  const applyFilters = useCallback((next: CommunityQueryState) => {
    setPosts([])
    setPostsQuery('')
    setNextCursor(null)
    applyQuery({ ...next, cursor: null })
  }, [applyQuery])

  useEffect(() => {
    function restoreQueryFromHistory(event: PopStateEvent) {
      const restoredQuery = parseCommunityQuery(window.location.search)
      const snapshot = snapshotFromHistoryState(event.state, restoredQuery)
      setPosts(snapshot.posts)
      setPostsQuery(snapshot.posts.length > 0 ? serializeCommunityQuery(restoredQuery) : '')
      setNextCursor(snapshot.nextCursor)
      setHasPreviousListing(snapshot.hasPreviousListing)
      setError(null)
      setQuery(restoredQuery)
    }
    window.addEventListener('popstate', restoreQueryFromHistory)
    return () => window.removeEventListener('popstate', restoreQueryFromHistory)
  }, [])

  useEffect(() => {
    if (onQueryChange || !usesCurrentLocation) return
    const search = serializeCommunityQuery(query)
    const snapshotPosts = postsQuery === search ? posts : []
    safeHistoryWrite(
      'replaceState',
      withPostsSnapshot(
        window.history.state,
        search,
        snapshotPosts,
        postsQuery === search ? nextCursor : null,
        hasPreviousListing,
      ),
      `${window.location.pathname}${search}`,
    )
  }, [hasPreviousListing, nextCursor, onQueryChange, posts, postsQuery, query, usesCurrentLocation])

  useEffect(() => {
    let active = true
    const requestSession = auth.session
    setTagError(null)
    void repository.listTags().then((result) => {
      if (!active) return
      if (result.ok) {
        consumeRecovery(result.recovery, requestSession)
        setTags(result.data)
      }
      else setTagError(result.error)
    })
    return () => { active = false }
  }, [auth.session, consumeRecovery, repository, tagAttempt])

  useEffect(() => {
    let active = true
    const requestSession = auth.session
    setLoading(true)
    setError(null)
    void repository.listPosts({
      limit: pageSize,
      sort: query.sort,
      search: query.search || undefined,
      tagId: query.tagId || undefined,
      cursor: query.cursor || undefined,
    }).then((result) => {
      if (!active) return
      if (result.ok) {
        consumeRecovery(result.recovery, requestSession)
        setPosts(appendUniquePosts([], result.data.items).slice(0, pageSize))
        setPostsQuery(serializeCommunityQuery(query))
        setNextCursor(result.data.nextCursor)
      } else {
        setError(result.error)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [attempt, auth.session, consumeRecovery, query, repository])

  return (
    <div className="community-page">
      <AppHeader />
      <main>
        <section className="community-hero community-board-hero" aria-labelledby="community-heading">
          <h1 id="community-heading">자유게시판</h1>
        </section>
        <SessionRecoveryNotice recovery={recovery} />

        <section className="community-tools" aria-label="게시글 탐색">
          <SearchBar value={query.search} onSubmit={(search) => applyFilters({ ...query, search })} />
          <TagFilter tags={tags} selected={query.tagId} onChange={(tagId) => applyFilters({ ...query, tagId })} />
          {tagError && (
            <div className="tag-load-error" role="alert" aria-label="태그를 불러오지 못했습니다">
              <span>{tagError.message}</span>
              <button type="button" onClick={() => setTagAttempt((value) => value + 1)}>태그 다시 시도</button>
            </div>
          )}
          <div className="list-heading">
            <div><span>PUBLIC DESK</span><h2>커뮤니티 글</h2></div>
            <SortTabs value={query.sort} onChange={(sort) => applyFilters({ ...query, sort })} />
          </div>
        </section>

        {loading && posts.length === 0 && <StatePanel title="글을 불러오고 있습니다" role="status" />}
        {!loading && error && posts.length === 0 && (
          <StatePanel title={error.message} role="alert">
            <button className="secondary-action" type="button" onClick={() => setAttempt((value) => value + 1)}>다시 시도</button>
          </StatePanel>
        )}
        {!loading && !error && posts.length === 0 && (
          query.search || query.tagId
            ? <StatePanel title="검색 결과가 없습니다"><p>검색어를 지우거나 다른 태그를 선택해 보세요.</p></StatePanel>
            : <StatePanel title="아직 공개된 글이 없습니다"><p>첫 번째 경험과 질문을 공유해 보세요.</p></StatePanel>
        )}
        {posts.length > 0 && <PostList posts={posts} />}
        {loading && posts.length > 0 && query.cursor && (
          <p role="status" aria-live="polite" aria-label="다음 페이지를 불러오고 있습니다">다음 페이지를 불러오고 있습니다.</p>
        )}
        {error && posts.length > 0 && (
          <div className="load-more-state" role="alert">
            <p>{error.message}</p>
            <button className="secondary-action" type="button" onClick={() => setAttempt((value) => value + 1)}>다시 시도</button>
          </div>
        )}
        {!error && (query.cursor || nextCursor) && (
          <div className="load-more-state">
            {query.cursor && (
              <button
                className="secondary-action"
                type="button"
                disabled={loading}
                onClick={() => {
                  if (hasPreviousListing) window.history.back()
                  else applyQuery({ ...query, cursor: null })
                }}
              >
                {hasPreviousListing ? '이전 페이지' : '첫 페이지'}
              </button>
            )}
            {nextCursor && (
            <button
              className="secondary-action"
              type="button"
              disabled={loading}
              onClick={() => {
                setNextCursor(null)
                applyQuery({ ...query, cursor: nextCursor }, true)
              }}
            >
              {loading ? '불러오는 중' : '다음 페이지'}
            </button>
            )}
          </div>
        )}
      </main>
      <AppFooter />
    </div>
  )
}
