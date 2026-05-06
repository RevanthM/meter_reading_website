import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ReadingsProvider } from './context/ReadingsContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import ReadingsList from './components/ReadingsList';
import ReadingDetail from './components/ReadingDetail';
import ActivityLog from './components/ActivityLog';
import UploadsTable from './components/UploadsTable';
import MFASettings from './components/MFASettings';
import ModelAnalytics from './components/ModelAnalytics';
import UsageSummary from './components/UsageSummary';
import Navbar from './components/Navbar';
import PortalWelcomeModal from './components/PortalWelcomeModal';
import './App.css';

function AppContent() {
  const location = useLocation();
  const isLoginPage = location.pathname === '/login';

  return (
    <div className="app">
      {!isLoginPage && (
        <ProtectedRoute>
          <Navbar />
          <PortalWelcomeModal />
        </ProtectedRoute>
      )}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
        <Route path="/readings/:status" element={
          <ProtectedRoute>
            <ReadingsList />
          </ProtectedRoute>
        } />
        <Route path="/reading/:id" element={
          <ProtectedRoute>
            <ReadingDetail />
          </ProtectedRoute>
        } />
        <Route path="/activity" element={
          <ProtectedRoute>
            <ActivityLog />
          </ProtectedRoute>
        } />
        <Route path="/uploads" element={
          <ProtectedRoute>
            <UploadsTable />
          </ProtectedRoute>
        } />
        <Route path="/mfa" element={
          <ProtectedRoute>
            <MFASettings />
          </ProtectedRoute>
        } />
        <Route path="/models" element={
          <ProtectedRoute>
            <ModelAnalytics />
          </ProtectedRoute>
        } />
        <Route path="/usage" element={
          <ProtectedRoute>
            <UsageSummary />
          </ProtectedRoute>
        } />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <ReadingsProvider>
            <AppContent />
          </ReadingsProvider>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
