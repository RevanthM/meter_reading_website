import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ReadingsProvider } from './context/ReadingsContext';
import ProtectedRoute from './components/ProtectedRoute';
import PortalLayout from './components/PortalLayout';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import ReadingsList from './components/ReadingsList';
import ReadingDetail from './components/ReadingDetail';
import ActivityLog from './components/ActivityLog';
import UploadsTable from './components/UploadsTable';
import MFASettings from './components/MFASettings';
import ModelAnalytics from './components/ModelAnalytics';
import UsageSummary from './components/UsageSummary';
import DatasetsPage from './components/DatasetsPage';
import TrainingHubPage from './components/TrainingHubPage';
import TrainingPipelinePage from './components/TrainingPipelinePage';
import PipelineIterationsPage from './components/PipelineIterationsPage';
import ModelFactoryPage from './components/ModelFactoryPage';
import TestDataPendingPage from './components/TestDataPendingPage';
import UnitTestImagesPage from './components/UnitTestImagesPage';
import UnitTestImageEditPage from './components/UnitTestImageEditPage';
import ManualUploadPage from './components/ManualUploadPage';
import ManualUploadLabelPage from './components/ManualUploadLabelPage';
import PortalWelcomeModal from './components/PortalWelcomeModal';
import './App.css';

function AppContent() {
  const location = useLocation();
  const isLoginPage = location.pathname === '/login';

  return (
    <div className="app">
      {!isLoginPage && (
        <ProtectedRoute>
          <PortalWelcomeModal />
        </ProtectedRoute>
      )}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <PortalLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/readings/:status" element={<ReadingsList />} />
          <Route path="/reading/:id" element={<ReadingDetail />} />
          <Route path="/activity" element={<ActivityLog />} />
          <Route path="/uploads" element={<UploadsTable />} />
          <Route path="/mfa" element={<MFASettings />} />
          <Route path="/models" element={<ModelAnalytics />} />
          <Route path="/usage" element={<UsageSummary />} />
          <Route path="/datasets" element={<DatasetsPage />} />
          <Route path="/training/pipeline/:segment" element={<TrainingPipelinePage />} />
          <Route path="/training" element={<TrainingHubPage />} />
          <Route path="/factory" element={<ModelFactoryPage />} />
          <Route path="/pipeline-iterations" element={<PipelineIterationsPage />} />
          <Route path="/test-data/pending" element={<TestDataPendingPage />} />
          <Route path="/test-data/images" element={<UnitTestImagesPage />} />
          <Route path="/test-data/images/edit/:fileName" element={<UnitTestImageEditPage />} />
          <Route path="/manual-upload" element={<ManualUploadPage />} />
          <Route path="/manual-upload/label" element={<ManualUploadLabelPage />} />
        </Route>
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
