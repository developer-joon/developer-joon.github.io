import { useCallback, useEffect, useState } from 'react'
import type { CommunityRepository } from '../data/communityRepository'
import { AppHeader } from '../components/AppHeader'
import { PostList } from '../components/PostList'
import { SearchBar } from '../components/SearchBar'
import { SortTabs } from '../components/SortTabs'
import { StatePanel } from '../components/StatePanel'
import { TagFilter } from '../components/TagFilter'
import { parseCommunityQuery, serializeCommunityQuery, type CommunityQueryState } from '../lib/queryState'
import type { CommunityError, CommunityTag, PostListItem } from '../types/community'

interface CommunityHomePageProps {
  repository: CommunityRepository
  initialSearch?: string
  onQueryChange?: (search: string) => void
}

export function CommunityHomePage({ repository, initialSearch = window.location.search, onQueryChange }: CommunityHomePageProps) {
  const [query, setQuery] = useState<CommunityQueryState>(() => parseCommunityQuery(initialSearch))
  const [tags, setTags] = useState<CommunityTag[]>([])
  const [posts, setPosts] = useState<PostListItem[]>([])
  const [error, setError] = useState<CommunityError | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  const applyQuery = useCallback((next: CommunityQueryState) => {
    const search = serializeCommunityQuery(next)
    setQuery(next)
    if (onQueryChange) onQueryChange(search)
    else window.history.pushState({}, '', `${window.location.pathname}${search}`)
  }, [onQueryChange])

  useEffect(() => {
    let active = true
    void repository.listTags().then((result) => {
      if (active && result.ok) setTags(result.data)
    })
    return () => { active = false }
  }, [repository])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void repository.listPosts({
      limit: 21,
      sort: query.sort,
      search: query.search || undefined,
      tagId: query.tagId || undefined,
    }).then((result) => {
      if (!active) return
      if (result.ok) setPosts(result.data.items)
      else setError(result.error)
      setLoading(false)
    })
    return () => { active = false }
  }, [attempt, query, repository])

  return (
    <div className="community-page">
      <AppHeader />
      <main>
        <section className="community-hero" aria-labelledby="community-heading">
          <p className="community-kicker">BREADLAB COMMUNITY · 공개 개발 기록</p>
          <div>
            <h1 id="community-heading">개발자가 쓰고 <span>답하는 공간</span></h1>
            <p>질문보다 오래 남는 경험, 답변보다 구체적인 시행착오를 나눕니다. 모든 공개 글은 로그인 없이 읽을 수 있습니다.</p>
          </div>
          <a className="primary-action" href="/community/write/">글쓰기</a>
        </section>

        <section className="community-tools" aria-label="게시글 탐색">
          <SearchBar value={query.search} onSubmit={(search) => applyQuery({ ...query, search })} />
          <TagFilter tags={tags} selected={query.tagId} onChange={(tagId) => applyQuery({ ...query, tagId })} />
          <div className="list-heading">
            <div><span>PUBLIC DESK</span><h2>커뮤니티 글</h2></div>
            <SortTabs value={query.sort} onChange={(sort) => applyQuery({ ...query, sort })} />
          </div>
        </section>

        {loading && <StatePanel title="글을 불러오고 있습니다" role="status" />}
        {!loading && error && (
          <StatePanel title={error.message} role="alert">
            <button className="secondary-action" type="button" onClick={() => setAttempt((value) => value + 1)}>다시 시도</button>
          </StatePanel>
        )}
        {!loading && !error && posts.length === 0 && (
          <StatePanel title="조건에 맞는 글이 없습니다"><p>검색어를 바꾸거나 전체 태그를 확인해 보세요.</p></StatePanel>
        )}
        {!loading && !error && posts.length > 0 && <PostList posts={posts} />}
      </main>
      <footer className="community-footer"><span>BREADLAB · 개발 기록과 열린 대화</span><a href="/privacy/">개인정보 처리방침</a></footer>
    </div>
  )
}
