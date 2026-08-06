import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export function Layout() {
  const { user, logout } = useAuth()
  const { language, setLanguage, t } = useLanguage()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="layout">
      <nav className="navbar">
        <Link to="/">{t('nav.products')}</Link>
        <Link to="/reports">{t('nav.reports')}</Link>
        {user?.role === 'admin' && (
          <>
            <Link to="/users">{t('nav.users')}</Link>
            <Link to="/suppliers">{t('nav.suppliers')}</Link>
            <Link to="/purchase-orders">{t('nav.purchaseOrders')}</Link>
            <Link to="/locations">{t('nav.locations')}</Link>
            <Link to="/trash">{t('nav.trash')}</Link>
            <Link to="/activity-log">{t('nav.activityLog')}</Link>
          </>
        )}
        <span className="spacer" />
        <select
          className="language-select"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          aria-label="Language"
        >
          <option value="en">EN</option>
          <option value="th">ไทย</option>
        </select>
        {user && (
          <>
            <Link to="/account" className="user-badge">
              {user.email} ({user.role})
            </Link>
            <button onClick={handleLogout}>{t('nav.logout')}</button>
          </>
        )}
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
