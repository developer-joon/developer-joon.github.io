export function AppFooter() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="community-footer">
      <div>
        <a className="footer-title" href="/">Ria &amp; Seoa PaPa</a>
        <p>Build things. Ship fast. Learn always.</p>
      </div>
      <p className="footer-copyright">
        <span>© {currentYear} Ria &amp; Seoa PaPa</span>
        <a href="/privacy">개인정보처리방침</a>
      </p>
    </footer>
  )
}
