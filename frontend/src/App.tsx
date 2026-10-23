import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { StoreProvider, useStore } from './lib/store.tsx';
import { Login } from './screens/Login.tsx';
import { MapScreen } from './screens/MapScreen.tsx';

function Routed() {
  const { loading, error, content, view } = useStore();
  if (loading) return <p className="center muted">Wird geladen …</p>;
  if (error && !content) {
    return (
      <div className="center">
        <p className="error">{error}</p>
        <button className="btn secondary" onClick={() => location.reload()}>Neu laden</button>
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/" element={view ? <Navigate to="/karte" replace /> : <Login />} />
      <Route path="/karte" element={<MapScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Routed />
      </BrowserRouter>
    </StoreProvider>
  );
}
