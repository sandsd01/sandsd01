import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div className="layout">
      <nav className="navbar">
        <Link to="/">Products</Link>
        <Link to="/reports">Reports</Link>
        {user?.role === 'admin' && <Link to="/users">Users</Link>}
        <span className="spacer" />
        {user && (
          <>
            <span className="user-badge">
              {user.email} ({user.role})
            </span>
            <button onClick={handleLogout}>Logout</button>
          </>
        )}
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
