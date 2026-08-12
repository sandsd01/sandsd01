import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { useChat } from '../context/ChatContext'

export function Layout() {
  const { user, logout } = useAuth()
  const { language, setLanguage, t } = useLanguage()
  const { unreadTotal } = useChat()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="layout">
      <nav className="navbar">
        <NavLink to="/" end className={({isActive}) => isActive ? "active" : undefined}>{t('nav.products')}</NavLink>
        <NavLink to="/pos" className={({isActive}) => isActive ? "active" : undefined}>{t('nav.pos')}</NavLink>
        <NavLink to="/sales" className={({isActive}) => isActive ? "active" : undefined}>{t('nav.sales')}</NavLink>
        <NavLink to="/shifts" className={({isActive}) => isActive ? "active" : undefined}>{t('nav.shifts')}</NavLink>
        <NavLink to="/reports" className={({isActive}) => isActive ? "active" : undefined}>{t('nav.reports')}</NavLink>
        <NavLink to="/chat" className={({isActive}) => isActive ? "active" : undefined}>
          {t('nav.chat')}
          {unreadTotal > 0 && <span className="chat-nav-badge">{unreadTotal > 99 ? '99+' : unreadTotal}</span>}
        </NavLink>
        {user?.role === 'admin' && (
          <>
            <NavLink to="/users" className={({isActive}) => isActive ? "active" : undefined}>{t('nav.users')}</NavLink>
            <NavLink to="/suppliers" className={({isActive}) => isActive ? "active" : undefined}>{t('nav.suppliers')}</NavLink>
            <NavLink to="/purchase-orders" className={({isActive}) => isActive ? "active" : undefined}>{t('nav.purchaseOrders')}</NavLink>
            <NavLink to="/locations" className={({isActive}) => isActive ? "active" : undefined}>{t('nav.locations')}</NavLink>
            <NavLink to="/settings" className={({isActive}) => isActive ? "active" : undefined}>{t('nav.settings')}</NavLink>
            <NavLink to="/trash" className={({isActive}) => isActive ? "active" : undefined}>{t('nav.trash')}</NavLink>
            <NavLink to="/activity-log" className={({isActive}) => isActive ? "active" : undefined}>{t('nav.activityLog')}</NavLink>
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
            <NavLink to="/account" className="user-badge">
              {user.email} ({user.role})
            </NavLink>
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
