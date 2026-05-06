import { useState, useEffect, useCallback, useMemo, type FC, type ReactNode } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  ClipboardList,
  ListTree,
  CheckCircle2,
  Activity,
  BarChart3,
  Cpu,
  History,
  Shield,
  HelpCircle,
  LogOut,
  Menu,
  X,
  Gauge,
  Upload,
  Users,
  CircleHelp,
  ChevronDown,
  Inbox,
  GraduationCap,
  PanelLeft,
  PanelLeftClose,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import type { PortalWorkMode, PortalOutletWorkContext } from '../utils/portalWorkMode';
import { getStoredPortalWorkMode, setStoredPortalWorkMode } from '../utils/portalWorkMode';

type NavLeaf = {
  path: string;
  label: string;
  icon: ReactNode;
  requiresFirebase?: boolean;
};

/** Extra queues under **more** for reviewer (short folder-style names). */
const STATUS_QUEUES: NavLeaf[] = [
  { path: '/readings/incorrect_analyzed', label: 'analyzed', icon: <Activity size={17} /> },
  { path: '/readings/incorrect_labeled', label: 'labeled', icon: <ClipboardList size={17} /> },
  { path: '/readings/incorrect_training', label: 'train', icon: <BarChart3 size={17} /> },
  { path: '/readings/no_dials', label: 'nodials', icon: <Gauge size={17} /> },
  { path: '/readings/not_sure', label: 'unsure', icon: <CircleHelp size={17} /> },
];

function leafActive(pathname: string, path: string): boolean {
  if (path === '/') return pathname === '/';
  if (pathname.startsWith('/reading/')) return false;
  return pathname === path;
}

function anyLeafActive(pathname: string, leaves: NavLeaf[]): boolean {
  return leaves.some((l) => leafActive(pathname, l.path));
}

function pathIsReadings(pathname: string): boolean {
  return pathname.startsWith('/readings') || pathname.startsWith('/reading/');
}

const STORAGE_MORE = 'portal_nav_more_open';
const STORAGE_ACCOUNT = 'portal_nav_account_open';
const STORAGE_SIDEBAR_COLLAPSED = 'portal_sidebar_collapsed';

const PortalLayout: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const { userEmail, logout, user } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_SIDEBAR_COLLAPSED);
      if (v === '0' || v === '1') return v === '1';
    } catch {
      /* ignore */
    }
    return false;
  });

  const [workMode, setWorkMode] = useState<PortalWorkMode>(() => getStoredPortalWorkMode());

  const [moreOpen, setMoreOpen] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_MORE);
      if (v === '0' || v === '1') return v === '1';
    } catch {
      /* ignore */
    }
    return false;
  });
  const [accountOpen, setAccountOpen] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_ACCOUNT);
      if (v === '0' || v === '1') return v === '1';
    } catch {
      /* ignore */
    }
    return false;
  });

  const onWorkModeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as PortalWorkMode;
    setWorkMode(next);
    setStoredPortalWorkMode(next);
  }, []);

  const { mainLinks, moreLinks, modeHint } = useMemo(() => {
    const dash: NavLeaf = { path: '/', label: 'Home', icon: <LayoutDashboard size={17} /> };

    if (workMode === 'reviewer') {
      return {
        modeHint: 'Review photos and move sessions between queues.',
        mainLinks: [
          dash,
          {
            path: '/readings/incorrect_new',
            label: 'new',
            icon: <Inbox size={17} strokeWidth={2} />,
          },
          {
            path: '/readings/incorrect-queues',
            label: 'wrong',
            icon: <ListTree size={17} />,
          },
          {
            path: '/readings/correct',
            label: 'correct',
            icon: <CheckCircle2 size={17} />,
          },
        ],
        moreLinks: [
          { path: '/uploads', label: 'uploads', icon: <Upload size={17} /> },
          { path: '/usage', label: 'usage', icon: <Users size={17} /> },
          { path: '/models', label: 'models', icon: <Cpu size={17} /> },
        ],
      };
    }

    return {
      modeHint: 'Sidebar: Training only. Open lists from a pipeline (add images). Logo → dashboard.',
      mainLinks: [
        dash,
        {
          path: '/readings/incorrect_labeled',
          label: 'labeled',
          icon: <ClipboardList size={17} />,
        },
        {
          path: '/readings/incorrect_training',
          label: 'train',
          icon: <BarChart3 size={17} />,
        },
        {
          path: '/readings/incorrect_new',
          label: 'new',
          icon: <Inbox size={17} strokeWidth={2} />,
        },
        { path: '/uploads', label: 'uploads', icon: <Upload size={17} /> },
      ],
      moreLinks: [
        {
          path: '/readings/incorrect-queues',
          label: 'wrong',
          icon: <ListTree size={17} />,
        },
        { path: '/usage', label: 'usage', icon: <Users size={17} /> },
        { path: '/models', label: 'models', icon: <Cpu size={17} /> },
      ],
    };
  }, [workMode]);

  const accountLinks = useMemo(
    () =>
      [
        { path: '/activity', label: 'log', icon: <History size={17} /> },
        { path: '/mfa', label: 'sign-in', icon: <Shield size={17} />, requiresFirebase: true },
      ].filter((l) => !(l.requiresFirebase && !user)) as NavLeaf[],
    [user],
  );

  const moreHasQueues = workMode === 'reviewer';
  const moreHasActive =
    anyLeafActive(pathname, moreLinks) ||
    (moreHasQueues && anyLeafActive(pathname, STATUS_QUEUES)) ||
    (moreHasQueues && pathIsReadings(pathname) && !anyLeafActive(pathname, mainLinks));
  const accountHasActive = anyLeafActive(pathname, accountLinks);
  const trainingNavActive = pathname.startsWith('/training');

  useEffect(() => {
    if (moreHasActive) setMoreOpen(true);
  }, [moreHasActive, pathname]);

  useEffect(() => {
    if (accountHasActive) setAccountOpen(true);
  }, [accountHasActive, pathname]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_MORE, moreOpen ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [moreOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ACCOUNT, accountOpen ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [accountOpen]);

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
    const active = leafActive(pathname, item.path);
    return (
      <li key={item.path}>
        <button
          type="button"
          className={`portal-nav-leaf${active ? ' portal-nav-leaf--active' : ''}`}
          onClick={() => goNav(item.path)}
          aria-current={active ? 'page' : undefined}
        >
          <span className="portal-nav-leaf-icon" aria-hidden>
            {item.icon}
          </span>
          <span className="portal-nav-leaf-body">
            <span className="portal-nav-leaf-label">{item.label}</span>
          </span>
        </button>
      </li>
    );
  };

  const mainAfterDash = mainLinks.filter((l) => l.path !== '/');

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
          <button type="button" className="portal-sidebar-brand" onClick={() => goNav('/')} aria-label="Go to home page">
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
            <label htmlFor="portal-work-mode">Mode</label>
            <select
              id="portal-work-mode"
              className="portal-role-select"
              value={workMode}
              onChange={onWorkModeChange}
            >
              <option value="reviewer">reviewer</option>
              <option value="labeler">labeler</option>
            </select>
            <p className="portal-role-hint">{modeHint}</p>
          </div>

          {workMode === 'labeler' ? (
            <div className="portal-nav-block">
              <button
                type="button"
                className={`portal-nav-primary${trainingNavActive ? ' portal-nav-primary--active' : ''}`}
                onClick={() => goNav('/training')}
                aria-current={trainingNavActive ? 'page' : undefined}
              >
                <GraduationCap size={18} strokeWidth={2} aria-hidden />
                <span>Training</span>
              </button>
            </div>
          ) : (
            <>
              <div className="portal-nav-block">
                <button
                  type="button"
                  className={`portal-nav-primary${pathname === '/' ? ' portal-nav-primary--active' : ''}`}
                  onClick={() => goNav('/')}
                  aria-current={pathname === '/' ? 'page' : undefined}
                >
                  <LayoutDashboard size={18} strokeWidth={2} aria-hidden />
                  <span>Home</span>
                </button>
              </div>

              <div className="portal-nav-divider" role="presentation" />

              <ul className="portal-nav-nested portal-nav-nested--tight">{mainAfterDash.map((item) => renderLeaf(item))}</ul>

              <div className={`portal-nav-disclosure${moreHasActive ? ' portal-nav-disclosure--child-active' : ''}`}>
                <button
                  type="button"
                  id="portal-disclosure-more"
                  className="portal-nav-disclosure-trigger"
                  aria-expanded={moreOpen}
                  aria-controls="portal-disclosure-more-panel"
                  onClick={() => setMoreOpen((o) => !o)}
                >
                  <span className="portal-nav-disclosure-title">
                    <span className="portal-nav-disclosure-heading">more</span>
                    <span className="portal-nav-disclosure-hint">extra folders</span>
                  </span>
                  <ChevronDown
                    size={16}
                    className={`portal-nav-disclosure-chevron${moreOpen ? ' portal-nav-disclosure-chevron--open' : ''}`}
                    aria-hidden
                  />
                </button>
                {moreOpen ? (
                  <div id="portal-disclosure-more-panel" className="portal-nav-disclosure-panel" role="region" aria-labelledby="portal-disclosure-more">
                    <ul className="portal-nav-nested portal-nav-nested--tight">{moreLinks.map((item) => renderLeaf(item))}</ul>
                    {moreHasQueues ? (
                      <>
                        <div className="portal-nav-sublabel">by-status</div>
                        <ul className="portal-nav-nested">{STATUS_QUEUES.map((item) => renderLeaf(item))}</ul>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          )}

          {workMode !== 'labeler' ? (
            <>
              <div className="portal-nav-spacer" aria-hidden />

              <div className={`portal-nav-disclosure portal-nav-disclosure--footer${accountHasActive ? ' portal-nav-disclosure--child-active' : ''}`}>
                <button
                  type="button"
                  id="portal-disclosure-account"
                  className="portal-nav-disclosure-trigger"
                  aria-expanded={accountOpen}
                  aria-controls="portal-disclosure-account-panel"
                  onClick={() => setAccountOpen((o) => !o)}
                >
                  <span className="portal-nav-disclosure-title">
                    <span className="portal-nav-disclosure-heading">account</span>
                    <span className="portal-nav-disclosure-hint">log · sign-in</span>
                  </span>
                  <ChevronDown
                    size={16}
                    className={`portal-nav-disclosure-chevron${accountOpen ? ' portal-nav-disclosure-chevron--open' : ''}`}
                    aria-hidden
                  />
                </button>
                {accountOpen ? (
                  <div id="portal-disclosure-account-panel" className="portal-nav-disclosure-panel" role="region" aria-labelledby="portal-disclosure-account">
                    <ul className="portal-nav-nested">{accountLinks.map((item) => renderLeaf(item))}</ul>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="portal-nav-spacer" aria-hidden />
          )}
        </nav>

        <div className="portal-sidebar-footer">
          <span className="portal-sidebar-footnote">Mode is saved on this device only.</span>
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
