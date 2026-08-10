import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { LanguageProvider } from './context/LanguageContext'
import { RequireAuth, RequireRole } from './components/RequireAuth'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { ProductsPage } from './pages/ProductsPage'
import { ProductFormPage } from './pages/ProductFormPage'
import { ProductMovementsPage } from './pages/ProductMovementsPage'
import { UsersPage } from './pages/UsersPage'
import { ReportsPage } from './pages/ReportsPage'
import { AccountPage } from './pages/AccountPage'
import { SuppliersPage } from './pages/SuppliersPage'
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage'
import { PurchaseOrderFormPage } from './pages/PurchaseOrderFormPage'
import { PurchaseOrderDetailPage } from './pages/PurchaseOrderDetailPage'
import { LocationsPage } from './pages/LocationsPage'
import { SettingsPage } from './pages/SettingsPage'
import { TrashPage } from './pages/TrashPage'
import { ActivityLogPage } from './pages/ActivityLogPage'
import { PosPage } from './pages/PosPage'
import { SalesHistoryPage } from './pages/SalesHistoryPage'
import { ShiftsPage } from './pages/ShiftsPage'
import { SaleDetailPage } from './pages/SaleDetailPage'

function App() {
  return (
    <BrowserRouter>
      <LanguageProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            <Route element={<RequireAuth />}>
              <Route element={<Layout />}>
                <Route path="/" element={<ProductsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/products/:id/movements" element={<ProductMovementsPage />} />
                <Route path="/pos" element={<PosPage />} />
                <Route path="/sales" element={<SalesHistoryPage />} />
                <Route path="/shifts" element={<ShiftsPage />} />
                <Route path="/sales/:id" element={<SaleDetailPage />} />

                <Route element={<RequireRole roles={['admin']} />}>
                  <Route path="/products/new" element={<ProductFormPage />} />
                  <Route path="/products/:id/edit" element={<ProductFormPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/suppliers" element={<SuppliersPage />} />
                  <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
                  <Route path="/purchase-orders/new" element={<PurchaseOrderFormPage />} />
                  <Route path="/purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
                  <Route path="/locations" element={<LocationsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
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
