import { useNavigate } from 'react-router-dom';
import { useReadings, type DataSource } from '../context/ReadingsContext';
import { 
  Camera, 
  CheckCircle, 
  AlertCircle, 
  Search, 
  Tag, 
  Database,
  ChevronRight,
  Gauge,
  RefreshCw,
  Cloud,
  HardDrive,
  Loader2,
  Radio,
  Monitor,
  Layers,
  ChevronDown,
  Briefcase
} from 'lucide-react';
import type { ReadingStatus, WorkType } from '../types';
import { workTypeLabels } from '../types';

interface StatCardProps {
  title: string;
  count: number;
  icon: React.ReactNode;
  color: string;
  onClick?: () => void;
  isClickable?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ 
  title, 
  count, 
  icon, 
  color, 
  onClick,
  isClickable = true 
}) => (
  <div 
    className={`stat-card ${isClickable ? 'clickable' : ''}`}
    style={{ '--accent-color': color } as React.CSSProperties}
    onClick={isClickable ? onClick : undefined}
  >
    <div className="stat-card-header">
      <div className="stat-icon" style={{ backgroundColor: `${color}20`, color }}>
        {icon}
      </div>
      {isClickable && (
        <ChevronRight className="chevron" size={20} />
      )}
    </div>
    <div className="stat-count">{count.toLocaleString()}</div>
    <div className="stat-title">{title}</div>
  </div>
);

const Dashboard: React.FC = () => {
  const { counts, loading, error, isUsingRealData, refreshData, dataSource, setDataSource, workType, setWorkType } = useReadings();
  const navigate = useNavigate();

  const handleCardClick = (status: ReadingStatus | 'all') => {
    navigate(`/readings/${status}`);
  };

  const totalReadings = counts.correctCount + counts.incorrectNewCount + 
    counts.incorrectAnalyzedCount + counts.incorrectLabeledCount + counts.incorrectTrainingCount;

  const sourceOptions: { value: DataSource; label: string; icon: React.ReactNode }[] = [
    { value: 'all', label: 'All Sources', icon: <Layers size={14} /> },
    { value: 'field', label: 'Field', icon: <Radio size={14} /> },
    { value: 'simulator', label: 'Simulator', icon: <Monitor size={14} /> },
  ];

  const workTypeOptions: WorkType[] = ['1000', '2000', '3000', '4000', '5000'];

  if (loading) {
    return (
      <div className="dashboard">
        <header className="dashboard-header">
          <div className="header-content">
            <div className="logo">
              <Gauge size={40} strokeWidth={1.5} />
              <div>
                <h1>Meter Reading Analytics</h1>
                <p>Image Classification Dashboard</p>
              </div>
            </div>
          </div>
        </header>
        <main className="dashboard-content">
          <div className="loading-state">
            <Loader2 size={48} className="spin" />
            <p>Loading data from S3...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-content">
          <div className="logo">
            <Gauge size={40} strokeWidth={1.5} />
            <div>
              <h1>Meter Reading Analytics</h1>
              <p>Image Classification Dashboard</p>
            </div>
          </div>
          <div className="header-actions">
            {/* Data Source Toggle */}
            <div className="source-toggle">
              {sourceOptions.map((option) => (
                <button
                  key={option.value}
                  className={`source-btn ${dataSource === option.value ? 'active' : ''}`}
                  onClick={() => setDataSource(option.value)}
                  title={option.label}
                >
                  {option.icon}
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
            <div className={`data-source ${isUsingRealData ? 'real' : 'mock'}`}>
              {isUsingRealData ? <Cloud size={16} /> : <HardDrive size={16} />}
              <span>{isUsingRealData ? 'S3 Data' : 'Mock Data'}</span>
            </div>
            <button className="refresh-button" onClick={refreshData} title="Refresh data">
              <RefreshCw size={18} />
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <span className="hint">Start the API server with: npm run server</span>
        </div>
      )}

      {/* Work Type Selector */}
      <div className="work-type-section">
        <div className="work-type-label">
          <Briefcase size={16} />
          <span>WORK TYPE</span>
        </div>
        <div className="work-type-dropdown">
          <select
            value={workType}
            onChange={(e) => setWorkType(e.target.value as WorkType)}
            className="work-type-select"
          >
            {workTypeOptions.map((wt) => (
              <option key={wt} value={wt}>
                {wt.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <ChevronDown size={16} className="dropdown-icon" />
        </div>
        <div className="work-type-name">
          {workTypeLabels[workType]}
        </div>
      </div>

      <main className="dashboard-content">
        <section className="stats-section">
          <h2 className="section-title">Overview</h2>
          <div className="stats-grid overview">
            <StatCard
              title="Total Pictures"
              count={counts.totalPictures}
              icon={<Camera size={24} />}
              color="#64748b"
              isClickable={false}
            />
            <StatCard
              title="Correct Readings"
              count={counts.correctCount}
              icon={<CheckCircle size={24} />}
              color="#10b981"
              onClick={() => handleCardClick('correct')}
            />
          </div>
        </section>

        <section className="stats-section">
          <h2 className="section-title">Incorrect Readings by Status</h2>
          <div className="stats-grid incorrect">
            <StatCard
              title="New"
              count={counts.incorrectNewCount}
              icon={<AlertCircle size={24} />}
              color="#ef4444"
              onClick={() => handleCardClick('incorrect_new')}
            />
            <StatCard
              title="Analyzed"
              count={counts.incorrectAnalyzedCount}
              icon={<Search size={24} />}
              color="#f59e0b"
              onClick={() => handleCardClick('incorrect_analyzed')}
            />
            <StatCard
              title="Labeled"
              count={counts.incorrectLabeledCount}
              icon={<Tag size={24} />}
              color="#8b5cf6"
              onClick={() => handleCardClick('incorrect_labeled')}
            />
            <StatCard
              title="Added to Training Dataset"
              count={counts.incorrectTrainingCount}
              icon={<Database size={24} />}
              color="#06b6d4"
              onClick={() => handleCardClick('incorrect_training')}
            />
          </div>
        </section>

        {totalReadings > 0 && (
          <section className="quick-stats">
            <div className="quick-stat-bar">
              <div className="bar-segment correct" style={{ 
                width: `${(counts.correctCount / totalReadings) * 100}%` 
              }} />
              <div className="bar-segment new" style={{ 
                width: `${(counts.incorrectNewCount / totalReadings) * 100}%` 
              }} />
              <div className="bar-segment analyzed" style={{ 
                width: `${(counts.incorrectAnalyzedCount / totalReadings) * 100}%` 
              }} />
              <div className="bar-segment labeled" style={{ 
                width: `${(counts.incorrectLabeledCount / totalReadings) * 100}%` 
              }} />
              <div className="bar-segment training" style={{ 
                width: `${(counts.incorrectTrainingCount / totalReadings) * 100}%` 
              }} />
            </div>
            <div className="bar-legend">
              <span className="legend-item"><span className="dot correct"></span> Correct</span>
              <span className="legend-item"><span className="dot new"></span> New</span>
              <span className="legend-item"><span className="dot analyzed"></span> Analyzed</span>
              <span className="legend-item"><span className="dot labeled"></span> Labeled</span>
              <span className="legend-item"><span className="dot training"></span> Training</span>
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
