import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { LanguageProvider } from './context/LanguageContext'
import { RequireAuth, RequireRole } from './components/RequireAuth'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { ProductsPage } from './pages/ProductsPage'
import { ProductFormPage } from './pages/ProductFormPage'
import { ProductMovementsPage } from './pages/ProductMovementsPage'
import { UsersPage } from './pages/UsersPage'
import { ReportsPage } from './pages/ReportsPage'
import { AccountPage } from './pages/AccountPage'
import { SuppliersPage } from './pages/SuppliersPage'
import { TrashPage } from './pages/TrashPage'
import { ActivityLogPage } from './pages/ActivityLogPage'

function App() {
  return (
    <BrowserRouter>
      <LanguageProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route path="/" element={<ProductsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/products/:id/movements" element={<ProductMovementsPage />} />

                <Route element={<RequireRole roles={['admin']} />}>
                  <Route path="/products/new" element={<ProductFormPage />} />
                  <Route path="/products/:id/edit" element={<ProductFormPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/suppliers" element={<SuppliersPage />} />
                  <Route path="/trash" element={<TrashPage />} />
                  <Route path="/activity-log" element={<ActivityLogPage />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  )
}

export default App
