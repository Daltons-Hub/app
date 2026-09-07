import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Rigs from "@/pages/Rigs";
import Documents from "@/pages/Documents";
import WeighStation from "@/pages/WeighStation";
import Drivers from "@/pages/Drivers";
import Tools from "@/pages/Tools";
import Trip from "@/pages/Trip";

function Protected({ children, ownerOnly }) {
  const { user, loading, isOwner } = useAuth();
  if (loading) return <div className="min-h-screen bg-[#0F1115] flex items-center justify-center text-slate-500">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (ownerOnly && !isOwner) return <Navigate to="/" replace />;
  return children;
}

function Shell({ children }) {
  return <Layout>{children}</Layout>;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Protected><Shell><Dashboard /></Shell></Protected>} />
            <Route path="/rigs" element={<Protected><Shell><Rigs /></Shell></Protected>} />
            <Route path="/documents" element={<Protected><Shell><Documents /></Shell></Protected>} />
            <Route path="/tools" element={<Protected><Shell><Tools /></Shell></Protected>} />
            <Route path="/trip" element={<Protected><Shell><Trip /></Shell></Protected>} />
            <Route path="/drivers" element={<Protected ownerOnly><Shell><Drivers /></Shell></Protected>} />
            <Route path="/weigh-station" element={<Protected><WeighStation /></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-center" theme="dark" richColors />
      </AuthProvider>
    </div>
  );
}

export default App;
