export function AppFooter() {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="community-footer">
      <p className="footer-tagline">Build things. Ship fast. Learn always.</p>
      <p className="footer-copyright">
        <span>© {currentYear} Ria &amp; Seoa PaPa</span>
        <a href="/privacy">개인정보처리방침</a>
      </p>
    </footer>
  )
}
