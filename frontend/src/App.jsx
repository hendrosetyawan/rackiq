import { Route, Routes } from 'react-router-dom'
import { api } from './api/client.js'
import { Sidebar } from './components/common.jsx'
import { useApi } from './lib/ui.js'
import CommandCenter from './pages/CommandCenter.jsx'
import Operations from './pages/Operations.jsx'
import Maintenance from './pages/Maintenance.jsx'
import EventLog from './pages/EventLog.jsx'
import Inventory from './pages/Inventory.jsx'
import AssetDetail from './pages/AssetDetail.jsx'
import LiveFloor from './pages/LiveFloor.jsx'

export default function App() {
  const { data: overview } = useApi(api.overview)
  return (
    <div className="shell">
      <Sidebar overview={overview} />
      <main className="main">
        <Routes>
          <Route path="/" element={<CommandCenter overview={overview} />} />
          <Route path="/operations" element={<Operations overview={overview} />} />
          <Route path="/maintenance" element={<Maintenance overview={overview} />} />
          <Route path="/logs" element={<EventLog overview={overview} />} />
          <Route path="/live" element={<LiveFloor overview={overview} />} />
          <Route path="/inventory" element={<Inventory overview={overview} />} />
          <Route path="/asset/:assetId" element={<AssetDetail overview={overview} />} />
        </Routes>
      </main>
    </div>
  )
}
