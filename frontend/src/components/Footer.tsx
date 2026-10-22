export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer">
      <div className="page-wrap">
        <span>&copy; {year} Mnemora</span>
        <a href="https://github.com/Operator-Syn/mnemora" target="_blank" rel="noreferrer">
          How this page is built
        </a>
      </div>
    </footer>
  )
}
