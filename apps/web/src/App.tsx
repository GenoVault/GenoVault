import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { AppStateProvider } from '@/lib/appState'
import BalancePage from '@/routes/balance/BalancePage'
import CatalogPage from '@/routes/catalog/CatalogPage'
import DatasetPage from '@/routes/dataset/DatasetPage'
import NotFoundPage from '@/routes/NotFoundPage'
import RegisterPage from '@/routes/register/RegisterPage'
import OrderRunPage from '@/routes/run/OrderRunPage'
import RunPage from '@/routes/run/RunPage'

const App = () => (
  <AppStateProvider>
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/datasets" replace />} />
        <Route path="/datasets" element={<CatalogPage />} />
        <Route path="/datasets/new" element={<RegisterPage />} />
        <Route path="/datasets/:owner/:datasetId" element={<DatasetPage />} />
        <Route path="/runs/new" element={<OrderRunPage />} />
        {/* Прогін адресується парою «покупець + нонс»: саме з них деривується
            його PDA, і третього поля, обчислюваного з двох інших, тут не треба. */}
        <Route path="/runs/:buyer/:nonce" element={<RunPage />} />
        <Route path="/balance" element={<BalancePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  </AppStateProvider>
)

export default App
