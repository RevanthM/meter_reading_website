import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ReadingsProvider } from './context/ReadingsContext';
import Dashboard from './components/Dashboard';
import ReadingsList from './components/ReadingsList';
import ReadingDetail from './components/ReadingDetail';
import './App.css';

function App() {
  return (
    <ReadingsProvider>
      <Router>
        <div className="app">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/readings/:status" element={<ReadingsList />} />
            <Route path="/reading/:id" element={<ReadingDetail />} />
          </Routes>
        </div>
      </Router>
    </ReadingsProvider>
  );
}

export default App;
