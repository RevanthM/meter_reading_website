import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Database, Cloud, Boxes, FileJson, Link2 } from 'lucide-react';

/**
 * In-app summary of how the portal reads data today and how DynamoDB fits later.
 * The canonical spec lives in the repo at docs/ARCHITECTURE.md.
 */
const DataArchitecture: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="detail-page data-arch-page">
      <header className="page-header">
        <div className="header-content">
          <button type="button" className="back-button" onClick={() => navigate('/')}>
            <ArrowLeft size={20} />
            <span>Back to Dashboard</span>
          </button>
          <div className="page-title">
            <Database size={32} strokeWidth={1.5} />
            <div>
              <h1>Data architecture</h1>
              <p>S3 today · DynamoDB index next</p>
            </div>
          </div>
        </div>
      </header>

      <main className="detail-content data-arch-content">
        <section className="metadata-section">
          <h2>
            <Cloud size={20} /> Current: S3 is the source of truth
          </h2>
          <p className="data-arch-lead">
            The iOS app uploads <code>original.jpg</code>, optional <code>dial_*.jpg</code>, and{' '}
            <code>metadata.json</code> per session. This portal lists prefixes, parses metadata, signs image URLs,
            and moves whole session folders when you change review status.
          </p>
          <ul className="data-arch-list">
            <li>
              <strong>session_id</strong> in <code>metadata.json</code> is the stable id (shown as Reading ID).
            </li>
            <li>
              <strong>s3SessionPrefix</strong> is stored on each reading so status moves target the exact folder
              (e.g. <code>METR/s_correct/…/</code>), including iOS short work-type codes.
            </li>
            <li>
              Portal work types <code>1000</code>–<code>5000</code> map to both numeric folders and iOS codes
              (e.g. meter reading scans <code>1000/</code> and <code>METR/</code>).
            </li>
          </ul>
        </section>

        <section className="metadata-section">
          <h2>
            <FileJson size={20} /> Metadata contract
          </h2>
          <p className="data-arch-lead">
            Treat <code>metadata.json</code> fields as authoritative for display and for a future DynamoDB row.
            Prefer metadata over inferring meaning from the path alone.
          </p>
          <ul className="data-arch-list">
            <li>Timestamps, <code>work_type</code>, <code>upload_mode</code>, <code>image_source</code></li>
            <li>
              <code>ml_prediction</code>, <code>ml_raw_prediction</code>, <code>user_correction</code>,{' '}
              <code>feedback_type</code>
            </li>
            <li>
              <code>dial_count</code>, <code>confidence</code>, <code>processing_time_ms</code>,{' '}
              <code>dial_details</code>
            </li>
          </ul>
        </section>

        <section className="metadata-section">
          <h2>
            <Boxes size={20} /> Next: DynamoDB as index
          </h2>
          <p className="data-arch-lead">
            Later, DynamoDB will hold queryable rows keyed by <code>session_id</code>, with GSIs for filters.
            S3 stays the blob store; each item references keys or <code>s3SessionPrefix</code>. Sync via Lambda on
            S3 events, backfill jobs, or dual-write from the app.
          </p>
        </section>

        <section className="metadata-section">
          <h2>
            <Link2 size={20} /> Developer reference
          </h2>
          <p className="data-arch-lead">
            Full write-up (folder layout, migration notes, Roboflow):{' '}
            <code className="data-arch-code-inline">meter_reading_website/docs/ARCHITECTURE.md</code>
          </p>
        </section>
      </main>
    </div>
  );
};

export default DataArchitecture;
