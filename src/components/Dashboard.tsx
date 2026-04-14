import { useMemo } from 'react';
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
  Briefcase,
  CircleSlash,
  HelpCircle,
  TrendingUp,
  BarChart3,
} from 'lucide-react';
import type { ReadingStatus, WorkType } from '../types';
import { workTypeLabels } from '../types';
import type { S3MeterReading } from '../services/api';

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

function computeChartData(readings: S3MeterReading[]) {
  const now = new Date();
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split('T')[0]);
  }

  const dayMap = new Map<string, { total: number; correct: number; field: number; simulator: number }>();
  for (const day of days) {
    dayMap.set(day, { total: 0, correct: 0, field: 0, simulator: 0 });
  }

  for (const r of readings) {
    const day = r.dateOfReading?.split('T')[0];
    if (!day) continue;
    const entry = dayMap.get(day);
    if (entry) {
      entry.total++;
      if (r.status === 'correct') entry.correct++;
      if (r.type === 'field') entry.field++;
      else entry.simulator++;
    }
  }

  const dailyData = days.map(day => {
    const d = dayMap.get(day)!;
    return { date: day, ...d, accuracy: d.total > 0 ? Math.round((d.correct / d.total) * 100) : null };
  });

  const activeDays = dailyData.filter(d => d.total > 0);

  return { dailyData, activeDays };
}

const DailyVolumeChart: React.FC<{ data: ReturnType<typeof computeChartData>['dailyData'] }> = ({ data }) => {
  const maxCount = Math.max(...data.map(d => d.total), 1);
  const recentData = data.slice(-14);

  return (
    <div className="chart-card">
      <div className="chart-header">
        <BarChart3 size={18} />
        <h3>Daily Upload Volume</h3>
        <span className="chart-subtitle">Last 14 days</span>
      </div>
      <div className="chart-bar-area">
        {recentData.map((day) => (
          <div key={day.date} className="chart-bar-col">
            <div className="chart-bar-track">
              {day.total > 0 && (
                <div className="chart-bar-tooltip">{day.total}</div>
              )}
              <div
                className="chart-bar-fill"
                style={{ height: `${(day.total / maxCount) * 100}%` }}
              >
                {day.field > 0 && (
                  <div
                    className="chart-bar-segment field"
                    style={{ height: `${(day.field / day.total) * 100}%` }}
                  />
                )}
                {day.simulator > 0 && (
                  <div
                    className="chart-bar-segment simulator"
                    style={{ height: `${(day.simulator / day.total) * 100}%` }}
                  />
                )}
              </div>
            </div>
            <span className="chart-bar-label">
              {new Date(day.date + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        ))}
      </div>
      <div className="chart-legend-row">
        <span className="chart-legend-item"><span className="chart-dot" style={{ background: 'var(--accent-amber)' }} /> Field</span>
        <span className="chart-legend-item"><span className="chart-dot" style={{ background: '#06b6d4' }} /> Simulator</span>
      </div>
    </div>
  );
};

const AccuracyChart: React.FC<{ data: ReturnType<typeof computeChartData>['activeDays'] }> = ({ data }) => {
  const recentDays = data.slice(-10);

  if (recentDays.length === 0) {
    return (
      <div className="chart-card">
        <div className="chart-header">
          <TrendingUp size={18} />
          <h3>Accuracy Trend</h3>
        </div>
        <div className="chart-empty">No data with readings available</div>
      </div>
    );
  }

  const points = recentDays.map((d, i) => ({
    x: (i / Math.max(recentDays.length - 1, 1)) * 100,
    y: d.accuracy ?? 0,
    date: d.date,
    total: d.total,
    correct: d.correct,
  }));

  const polyline = points.map(p => `${p.x},${100 - p.y}`).join(' ');
  const areaPath = `M ${points[0].x},100 ` + points.map(p => `L ${p.x},${100 - p.y}`).join(' ') + ` L ${points[points.length - 1].x},100 Z`;

  const overallCorrect = recentDays.reduce((s, d) => s + d.correct, 0);
  const overallTotal = recentDays.reduce((s, d) => s + d.total, 0);
  const overallAccuracy = overallTotal > 0 ? ((overallCorrect / overallTotal) * 100).toFixed(1) : '0';

  return (
    <div className="chart-card">
      <div className="chart-header">
        <TrendingUp size={18} />
        <h3>Accuracy Trend</h3>
        <span className="chart-accuracy-badge">{overallAccuracy}%</span>
      </div>
      <div className="chart-svg-area">
        <svg viewBox="-2 -5 104 115" preserveAspectRatio="none" className="accuracy-svg">
          {[0, 25, 50, 75, 100].map(y => (
            <line key={y} x1="0" y1={100 - y} x2="100" y2={100 - y} stroke="var(--border-color)" strokeWidth="0.5" />
          ))}
          <path d={areaPath} fill="url(#accuracyGradient)" />
          <polyline points={polyline} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={100 - p.y} r="2.5" fill="#10b981" stroke="var(--bg-tertiary)" strokeWidth="1" />
          ))}
          <defs>
            <linearGradient id="accuracyGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
            </linearGradient>
          </defs>
        </svg>
        <div className="chart-y-labels">
          <span>100%</span>
          <span>75%</span>
          <span>50%</span>
          <span>25%</span>
          <span>0%</span>
        </div>
      </div>
      <div className="chart-x-labels">
        {recentDays.length > 0 && (
          <>
            <span>{new Date(recentDays[0].date + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
            <span>{new Date(recentDays[recentDays.length - 1].date + 'T12:00:00').toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
          </>
        )}
      </div>
    </div>
  );
};

const Dashboard: React.FC = () => {
  const { counts, loading, error, isUsingRealData, refreshData, dataSource, setDataSource, workType, setWorkType, filteredReadings } = useReadings();

  const chartData = useMemo(() => computeChartData(filteredReadings), [filteredReadings]);
  const navigate = useNavigate();

  const handleCardClick = (status: ReadingStatus | 'all') => {
    navigate(`/readings/${status}`);
  };

  const totalReadings = counts.totalPictures;

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

        <section className="stats-section">
          <h2 className="section-title">Other</h2>
          <div className="stats-grid incorrect">
            <StatCard
              title="No Dials Detected"
              count={counts.noDialsCount}
              icon={<CircleSlash size={24} />}
              color="#6b7280"
              onClick={() => handleCardClick('no_dials')}
            />
            <StatCard
              title="Not Sure"
              count={counts.notSureCount}
              icon={<HelpCircle size={24} />}
              color="#d97706"
              onClick={() => handleCardClick('not_sure')}
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
              <div className="bar-segment" style={{ 
                width: `${(counts.noDialsCount / totalReadings) * 100}%`,
                backgroundColor: '#6b7280'
              }} />
              <div className="bar-segment" style={{ 
                width: `${(counts.notSureCount / totalReadings) * 100}%`,
                backgroundColor: '#d97706'
              }} />
            </div>
            <div className="bar-legend">
              <span className="legend-item"><span className="dot correct"></span> Correct</span>
              <span className="legend-item"><span className="dot new"></span> New</span>
              <span className="legend-item"><span className="dot analyzed"></span> Analyzed</span>
              <span className="legend-item"><span className="dot labeled"></span> Labeled</span>
              <span className="legend-item"><span className="dot training"></span> Training</span>
              <span className="legend-item"><span className="dot" style={{backgroundColor: '#6b7280'}}></span> No Dials</span>
              <span className="legend-item"><span className="dot" style={{backgroundColor: '#d97706'}}></span> Not Sure</span>
            </div>
          </section>
        )}

        {filteredReadings.length > 0 && (
          <section className="stats-section">
            <h2 className="section-title">Trends</h2>
            <div className="charts-grid">
              <DailyVolumeChart data={chartData.dailyData} />
              <AccuracyChart data={chartData.activeDays} />
            </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default Dashboard;
