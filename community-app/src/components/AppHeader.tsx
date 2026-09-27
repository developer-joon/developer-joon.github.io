export function AppHeader() {
  return (
    <header className="community-header">
      <a className="community-brand" href="/" aria-label="Breadlab 홈">BREADLAB</a>
      <nav aria-label="커뮤니티 메뉴">
        <a href="/blog/">블로그</a>
        <a className="header-write" href="/community/write/">글쓰기</a>
      </nav>
    </header>
  )
}
