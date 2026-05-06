import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Boxes, ExternalLink, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import {
  fetchRoboflowStatus,
  fetchRoboflowProjects,
  type RoboflowProject,
} from '../services/roboflowApi';

const RoboflowHub: React.FC = () => {
  const navigate = useNavigate();
  const [statusLoading, setStatusLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projects, setProjects] = useState<RoboflowProject[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const loadStatus = async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const s = await fetchRoboflowStatus();
      setConfigured(s.configured);
      setWorkspace(s.workspace);
      if (s.error) setStatusError(s.error);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : 'Status failed');
      setConfigured(false);
    } finally {
      setStatusLoading(false);
    }
  };

  const loadProjects = async () => {
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const data = await fetchRoboflowProjects();
      setProjects(data.projects || []);
    } catch (e) {
      setProjectsError(e instanceof Error ? e.message : 'Failed to load projects');
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    if (configured) loadProjects();
  }, [configured]);

  return (
    <div className="uploads-page roboflow-hub">
      <header className="page-header">
        <div className="header-content">
          <button type="button" className="back-button" onClick={() => navigate('/')}>
            <ArrowLeft size={20} />
            <span>Back</span>
          </button>
          <div className="page-title">
            <Boxes size={32} strokeWidth={1.5} />
            <div>
              <h1>Roboflow</h1>
              <p>Sync S3 captures to projects and open the annotator</p>
            </div>
          </div>
        </div>
      </header>

      <main className="uploads-content roboflow-hub-main">
        <section className="roboflow-hub-intro">
          <h2>End-to-end flow</h2>
          <ol className="roboflow-hub-steps">
            <li>Mobile app uploads meter sessions to S3 (already ingested in this portal).</li>
            <li>
              From a <strong>reading detail</strong> page, push images to a Roboflow project (server uses your API key;
              images are never sent to the browser for upload).
            </li>
            <li>
              Images appear under <strong>Annotate</strong> in Roboflow (see{' '}
              <a href="https://docs.roboflow.com/developer/rest-api/manage-images/upload-an-image" target="_blank" rel="noreferrer">
                Upload an Image
              </a>
              ).
            </li>
            <li>Use the links below to open <strong>Annotate</strong> in Roboflow in a new tab.</li>
          </ol>
          <p className="roboflow-hub-docs">
            Developer overview:{' '}
            <a href="https://docs.roboflow.com/developer" target="_blank" rel="noreferrer">
              docs.roboflow.com/developer
            </a>
          </p>
        </section>

        <section className="roboflow-hub-status">
          <div className="roboflow-hub-status-row">
            <h2>Connection</h2>
            <button type="button" className="roboflow-hub-refresh" onClick={() => { loadStatus(); if (configured) loadProjects(); }} disabled={statusLoading || projectsLoading}>
              <RefreshCw size={16} className={statusLoading || projectsLoading ? 'spin' : ''} />
              Refresh
            </button>
          </div>
          {statusLoading ? (
            <p className="roboflow-hub-muted"><Loader2 size={16} className="spin" style={{ display: 'inline', verticalAlign: 'middle' }} /> Checking…</p>
          ) : statusError ? (
            <div className="roboflow-hub-alert">
              <AlertCircle size={18} />
              <span>{statusError}</span>
            </div>
          ) : configured ? (
            <p>
              <strong>Roboflow API key</strong> is configured on the server. Workspace:{' '}
              <code className="roboflow-hub-code">{workspace || '—'}</code>
            </p>
          ) : (
            <div className="roboflow-hub-alert">
              <AlertCircle size={18} />
              <span>
                Set <code className="roboflow-hub-code">ROBOFLOW_API_KEY</code> (and optionally{' '}
                <code className="roboflow-hub-code">ROBOFLOW_WORKSPACE</code>) on the Node server, then restart.
              </span>
            </div>
          )}
        </section>

        {configured && (
          <section className="roboflow-hub-projects">
            <h2>Projects</h2>
            {projectsLoading ? (
              <p className="roboflow-hub-muted"><Loader2 size={16} className="spin" style={{ display: 'inline', verticalAlign: 'middle' }} /> Loading projects…</p>
            ) : projectsError ? (
              <div className="roboflow-hub-alert">
                <AlertCircle size={18} />
                <span>{projectsError}</span>
              </div>
            ) : projects.length === 0 ? (
              <p className="roboflow-hub-muted">No projects returned for this workspace.</p>
            ) : (
              <div className="roboflow-hub-table-wrap">
                <table className="roboflow-hub-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Dataset slug</th>
                      <th>Type</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr key={p.datasetSlug}>
                        <td>{p.name}</td>
                        <td><code className="roboflow-hub-code">{p.datasetSlug}</code></td>
                        <td>{p.type || '—'}</td>
                        <td className="roboflow-hub-actions">
                          {p.annotateUrl && (
                            <a href={p.annotateUrl} target="_blank" rel="noreferrer" className="roboflow-hub-link">
                              Annotate <ExternalLink size={14} />
                            </a>
                          )}
                          {p.url && (
                            <a href={p.url} target="_blank" rel="noreferrer" className="roboflow-hub-link">
                              Project <ExternalLink size={14} />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
};

export default RoboflowHub;
