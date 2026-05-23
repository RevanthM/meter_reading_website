import { useState, useEffect, useCallback, useMemo, type FC, type ReactNode } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  ListTree,
  CheckCircle2,
  HelpCircle,
  LogOut,
  Menu,
  X,
  Gauge,
  Inbox,
  GraduationCap,
  PanelLeft,
  PanelLeftClose,
  Sparkles,
  Layers,
  Factory,
  Upload,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import type { PortalOutletWorkContext, PortalWorkMode } from '../utils/portalWorkMode';
import {
  PORTAL_ROLE_LABELS,
  isPortalWorkMode,
  setStoredPortalWorkMode,
} from '../utils/portalWorkMode';
import { statusLabels } from '../types';

type NavLeaf = {
  path: string;
  label: string;
  icon: ReactNode;
  /** Short second line under the label (sidebar). */
  description?: string;
  /** Extra context on hover (full status name, etc.). */
  hint?: string;
  /** Navigate target (defaults to `path`). Use for links that need query params. */
  to?: string;
  /** When set, item is active only if the current search string matches these params (path must still match). */
  activeWhenSearch?: Record<string, string>;
};

function navLeafActive(pathname: string, search: string, item: NavLeaf): boolean {
  if (item.path === '/') return pathname === '/';
  if (pathname.startsWith('/reading/')) return false;
  if (pathname !== item.path) return false;
  if (!item.activeWhenSearch) return true;
  const sp = new URLSearchParams(search);
  for (const [k, v] of Object.entries(item.activeWhenSearch)) {
    if (sp.get(k) !== v) return false;
  }
  return true;
}

const STORAGE_SIDEBAR_COLLAPSED = 'portal_sidebar_collapsed';

const PortalLayout: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const { userEmail, logout, portalWorkMode: authWorkMode, canSwitchPortalRoles } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [workMode, setWorkMode] = useState<PortalWorkMode>(authWorkMode);

  useEffect(() => {
    setWorkMode(authWorkMode);
  }, [authWorkMode]);

  const onWorkModeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (!canSwitchPortalRoles) return;
      const next = e.target.value;
      if (!isPortalWorkMode(next) || next === workMode) return;
      setWorkMode(next);
      setStoredPortalWorkMode(next);
      setMobileNavOpen(false);
      if (pathname !== '/') {
        navigate('/', { replace: true });
      }
    },
    [canSwitchPortalRoles, navigate, pathname, workMode],
  );

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_SIDEBAR_COLLAPSED);
      if (v === '0' || v === '1') return v === '1';
    } catch {
      /* ignore */
    }
    return false;
  });

  const { mainLinks, roleHint, navSectionTitle, navSectionSub } = useMemo((): {
    mainLinks: NavLeaf[];
    roleHint: string;
    navSectionTitle: string;
    navSectionSub: string;
  } => {
    const dash: NavLeaf = { path: '/', label: 'Home', icon: <LayoutDashboard size={17} /> };

    const manualUploadNav: NavLeaf[] = [
      {
        path: '/manual-upload',
        label: 'Bulk upload',
        description: 'Many images at once',
        hint: 'Upload now, label readings on the next screen',
        icon: <Upload size={17} strokeWidth={2} />,
      },
      {
        path: '/manual-upload/label',
        label: 'Label uploads',
        description: '4-digit reading per image',
        hint: 'Simple grid — type reading and save',
        icon: <Inbox size={17} strokeWidth={2} />,
      },
    ];

    if (workMode === 'test_data_reviewer') {
      return {
        roleHint: 'Approve sessions reviewers marked for unit test; browse existing unit test images.',
        navSectionTitle: 'Test data',
        navSectionSub: 'Pending approvals and unit test images',
        mainLinks: [
          {
            ...dash,
            label: 'Dashboard',
            description: 'Charts & KPIs',
            hint: 'Session counts and trends',
          },
          ...manualUploadNav,
          {
            path: '/test-data/pending',
            label: 'Pending test data',
            description: 'Reviewer → test dataset',
            hint: 'Sessions marked send to test dataset, not yet approved',
            icon: <Inbox size={17} strokeWidth={2} />,
          },
          {
            path: '/test-data/images',
            label: 'Unit test images',
            description: 'unittestng_manifest.json',
            hint: 'Flat images under unit_test_images/',
            icon: <ListTree size={17} />,
          },
        ],
      };
    }

    if (workMode === 'reviewer') {
      return {
        roleHint: 'Awaiting review = not human-reviewed yet. Other lists = reviewed outcomes.',
        navSectionTitle: 'Review',
        navSectionSub: 'See new captures, then reviewed outcomes',
        mainLinks: [
          {
            ...dash,
            label: 'Dashboard',
            description: 'Charts & KPIs',
            hint: 'Session counts, trends, exports',
          },
          {
            path: '/readings/incorrect_new',
            label: 'Awaiting review',
            description: 'New captures, not reviewed',
            hint: 'Same folder as today; use is_manually_reviewed in metadata (legacy is_human_reviewed still read)',
            icon: <Inbox size={17} strokeWidth={2} />,
          },
          ...manualUploadNav,
          {
            path: '/readings/incorrect-queues',
            label: 'Incorrect',
            description: 'Incorrect pipeline',
            hint: 'Analyzed → labeled → training and related incorrect queues',
            icon: <ListTree size={17} />,
          },
          {
            path: '/readings/correct',
            label: 'Correct',
            description: 'Reviewed · good read',
            hint: statusLabels.correct,
            icon: <CheckCircle2 size={17} />,
          },
        ],
      };
    }

    if (workMode === 'admin') {
      return {
        roleHint: 'Iteration registry, Model Training Center, manual uploads, and full lists.',
        navSectionTitle: 'Admin',
        navSectionSub: 'Dashboard · registry · lists',
        mainLinks: [
          {
            ...dash,
            label: 'Dashboard',
            description: 'Charts & KPIs',
            hint: 'Session counts, trends, exports',
          },
          ...manualUploadNav,
          {
            path: '/factory',
            label: 'Model factory',
            description: 'Assembly line · ship',
            hint: 'Planning → data → label → train → test → deployed',
            icon: <Factory size={17} strokeWidth={2} />,
          },
          {
            path: '/pipeline-iterations',
            label: 'Iterations table',
            description: 'Spreadsheet · charts',
            hint: 'Same registry as factory (detailed edit)',
            icon: <Layers size={17} strokeWidth={2} />,
          },
          {
            path: '/readings/all',
            label: 'All readings',
            description: 'Full session list',
            hint: 'Filter by cohort, version, date',
            icon: <ListTree size={17} />,
          },
        ],
      };
    }

    return {
      roleHint: 'Model Training Center = all pipelines. Training picks = send to training dataset.',
      navSectionTitle: 'Model Training',
      navSectionSub: 'Overview & reviewer picks',
      mainLinks: [
        {
          ...dash,
          label: 'Metrics',
          description: 'Pipeline charts',
          hint: 'Images, accuracy & confidence by iteration',
        },
        {
          path: '/readings/all',
          to: '/readings/all?cohort=training',
          label: 'Training picks',
          description: 'Send to training dataset',
          hint: 'Sessions reviewer marked for training',
          icon: <Sparkles size={17} strokeWidth={2} />,
          activeWhenSearch: { cohort: 'training' },
        },
        {
          path: '/factory',
          label: 'Model factory',
          description: 'Assembly line · ship',
          hint: 'Planning → data → label → train → test → deployed',
          icon: <Factory size={17} strokeWidth={2} />,
        },
      ],
    };
  }, [workMode]);

  const trainingNavActive = pathname.startsWith('/training');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SIDEBAR_COLLAPSED, sidebarCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const openPortalHelp = () => {
    try {
      sessionStorage.removeItem('meter_portal_welcome_dismissed_session');
      localStorage.removeItem('meter_portal_welcome_never_v1');
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('portal-welcome-open'));
  };

  const goNav = useCallback(
    (path: string) => {
      navigate(path);
      setMobileNavOpen(false);
    },
    [navigate],
  );

  const renderLeaf = (item: NavLeaf) => {
    const active = navLeafActive(pathname, location.search, item);
    const dest = item.to ?? item.path;
    return (
      <li key={dest}>
        <button
          type="button"
          className={`portal-nav-leaf${active ? ' portal-nav-leaf--active' : ''}`}
          onClick={() => goNav(dest)}
          aria-current={active ? 'page' : undefined}
          title={item.hint}
        >
          <span className="portal-nav-leaf-icon" aria-hidden>
            {item.icon}
          </span>
          <span className="portal-nav-leaf-body">
            <span className="portal-nav-leaf-label">{item.label}</span>
            {item.description ? <span className="portal-nav-leaf-desc">{item.description}</span> : null}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div
      className={`portal-shell${mobileNavOpen ? ' portal-shell--nav-open' : ''}${
        sidebarCollapsed ? ' portal-shell--sidebar-collapsed' : ''
      }`}
    >
      {mobileNavOpen ? (
        <button
          type="button"
          className="portal-sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside className="portal-sidebar" aria-label="Main navigation">
        <div className="portal-sidebar-header">
          <button type="button" className="portal-sidebar-brand" onClick={() => goNav('/')} aria-label="Go to dashboard">
            <div className="portal-sidebar-logo" aria-hidden>
              <Gauge size={21} strokeWidth={1.85} />
            </div>
            <div className="portal-sidebar-titles">
              <span className="portal-sidebar-title">AMR Portal</span>
              <span className="portal-sidebar-subtitle">Meter photos</span>
            </div>
          </button>
        </div>

        <nav id="portal-sidebar-nav" className="portal-sidebar-nav">
          <div className="portal-role-bar">
            <label htmlFor="portal-work-mode">Role</label>
            {canSwitchPortalRoles ? (
              <select
                id="portal-work-mode"
                className="portal-role-select"
                value={workMode}
                onChange={onWorkModeChange}
              >
                {(Object.keys(PORTAL_ROLE_LABELS) as PortalWorkMode[]).map((id) => (
                  <option key={id} value={id}>
                    {PORTAL_ROLE_LABELS[id]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="portal-role-value">{PORTAL_ROLE_LABELS[workMode]}</span>
            )}
            <p className="portal-role-hint">
              {canSwitchPortalRoles
                ? `${roleHint} Switch role to view reviewer, test data, trainer, or admin dashboards.`
                : roleHint}
            </p>
          </div>

          {workMode === 'labeler' || workMode === 'admin' ? (
            <>
              <div className="portal-nav-block">
                <button
                  type="button"
                  className={`portal-nav-primary${trainingNavActive ? ' portal-nav-primary--active' : ''}`}
                  onClick={() => goNav('/training')}
                  aria-current={trainingNavActive ? 'page' : undefined}
                >
                  <span className="portal-nav-primary-row">
                    <GraduationCap size={18} strokeWidth={2} aria-hidden />
                    <span className="portal-nav-primary-label">Model Training</span>
                  </span>
                  <span className="portal-nav-primary-note">
                    {workMode === 'admin'
                      ? 'Pipelines · copy · ZIP · weights'
                      : 'All pipelines · copy · ZIP · weights'}
                  </span>
                </button>
              </div>

              <div className="portal-nav-section">
                <div className="portal-nav-section-head">
                  <span className="portal-nav-section-title">{navSectionTitle}</span>
                  <span className="portal-nav-section-sub">{navSectionSub}</span>
                </div>
                <ul className="portal-nav-nested portal-nav-nested--sections">
                  {mainLinks.map((item) => renderLeaf(item))}
                </ul>
              </div>
            </>
          ) : (
            <div className="portal-nav-section">
              <div className="portal-nav-section-head">
                <span className="portal-nav-section-title">{navSectionTitle}</span>
                <span className="portal-nav-section-sub">{navSectionSub}</span>
              </div>
              <ul className="portal-nav-nested portal-nav-nested--sections">{mainLinks.map((item) => renderLeaf(item))}</ul>
            </div>
          )}

          <div className="portal-nav-spacer" aria-hidden />
        </nav>

        <div className="portal-sidebar-footer">
          <span className="portal-sidebar-footnote">
            {canSwitchPortalRoles
              ? 'Role switch saved on this device.'
              : 'Role is assigned by your administrator.'}
          </span>
        </div>
      </aside>

      <div className="portal-main">
        <header className="portal-topbar">
          <button
            type="button"
            className="portal-topbar-menu-btn"
            onClick={() => setMobileNavOpen((o) => !o)}
            aria-expanded={mobileNavOpen}
            aria-controls="portal-sidebar-nav"
          >
            {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
            <span className="portal-topbar-menu-label">Menu</span>
          </button>

          <button
            type="button"
            className="portal-sidebar-toggle"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-pressed={sidebarCollapsed}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            {sidebarCollapsed ? <PanelLeft size={20} strokeWidth={2} aria-hidden /> : <PanelLeftClose size={20} strokeWidth={2} aria-hidden />}
            <span className="portal-sidebar-toggle-label">{sidebarCollapsed ? 'Show' : 'Hide'}</span>
          </button>

          <div className="portal-topbar-spacer" />

          <div className="portal-topbar-actions">
            <button
              type="button"
              className="portal-topbar-btn"
              onClick={openPortalHelp}
              title="Short guide for this website"
            >
              <HelpCircle size={18} />
              <span>Help</span>
            </button>
            <ThemeToggle />
            <span className="portal-topbar-email" title={userEmail || undefined}>
              {userEmail}
            </span>
            <button type="button" className="portal-topbar-icon-btn" onClick={handleLogout} title="Log out">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <div className="portal-outlet">
          <Outlet context={{ workMode } satisfies PortalOutletWorkContext} />
        </div>
      </div>
    </div>
  );
};

export default PortalLayout;
