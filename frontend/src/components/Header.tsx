import { Link } from '@tanstack/react-router'
import ThemeToggle from './ThemeToggle'

export default function Header() {
  return (
    <header className="masthead">
      <div className="page-wrap masthead-inner">
        <Link to="/" className="mark">
          Mne<span>mora</span>
        </Link>

        <div className="issue">Collected hourly</div>

        <nav aria-label="Primary">
          <Link to="/" activeProps={{ 'data-status': 'active' }}>
            Repositories
          </Link>
          <Link to="/about" activeProps={{ 'data-status': 'active' }}>
            About
          </Link>
          <a href="https://github.com/Operator-Syn" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>

        <ThemeToggle />
      </div>
    </header>
  )
}
