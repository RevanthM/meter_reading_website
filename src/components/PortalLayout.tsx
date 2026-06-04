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
  ClipboardList,
  ImageIcon,
  MapPin,
  ChevronDown,
  ScrollText,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import type { PortalOutletWorkContext, PortalWorkMode } from '../utils/portalWorkMode';
import {
  PORTAL_ROLE_LABELS,
  isPortalWorkMode,
  setStoredPortalWorkMode,
} from '../utils/portalWorkMode';
import { PRODUCT_NAME, PRODUCT_SIDEBAR_SUBTITLE } from '../constants/productBrand';
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

type NavGroup = {
  id: string;
  label: string;
  hint?: string;
  items: NavLeaf[];
};

type NavEntry = { kind: 'leaf'; item: NavLeaf } | { kind: 'group'; group: NavGroup };

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

function navGroupActive(pathname: string, search: string, group: NavGroup): boolean {
  return group.items.some((item) => navLeafActive(pathname, search, item));
}

function navGroup(id: string, label: string, hint: string | undefined, items: NavLeaf[]): NavEntry {
  return { kind: 'group', group: { id, label, hint, items } };
}

const STORAGE_SIDEBAR_COLLAPSED = 'portal_sidebar_collapsed';

const UNIT_TEST_IMAGES_NAV: NavLeaf = {
  path: '/test-data/images',
  label: 'Images',
  description: 'Image library',
  hint: 'Browse images with difficulty tags',
  icon: <ImageIcon size={17} strokeWidth={2} />,
};

const UNIT_TEST_RUNS_NAV: NavLeaf = {
  path: '/unit-test/results',
  label: 'Results',
  description: 'Accuracy · confidence',
  hint: 'Download unit test files',
  icon: <ClipboardList size={17} strokeWidth={2} />,
};

const TEST_DATA_PENDING_NAV: NavLeaf = {
  path: '/test-data/pending',
  label: 'Pending approval',
  description: 'Awaiting approval',
  hint: 'Approve into the unit test image library',
  icon: <Inbox size={17} strokeWidth={2} />,
};

const MANUAL_UPLOAD_NAV: NavLeaf[] = [
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

const UNIT_TEST_GROUP = navGroup(
  'unit-test',
  'Unit test',
  'Image library and accuracy runs',
  [UNIT_TEST_IMAGES_NAV, UNIT_TEST_RUNS_NAV],
);

const FIELD_TEST_LIST_NAV: NavLeaf = {
  path: '/field-test',
  label: 'Field test',
  description: 'Field capture review list',
  hint: 'Review outcome, difficulty, and location',
  icon: <MapPin size={17} strokeWidth={2} />,
};

const FIELD_TEST_IMAGES_NAV: NavLeaf = {
  path: '/field-test/images',
  label: 'Images',
  description: 'Field captures in cycle',
  hint: 'Map or grid · filter by cycle, user, difficulty',
  icon: <ImageIcon size={17} strokeWidth={2} />,
};

const FIELD_TEST_RESULTS_NAV: NavLeaf = {
  path: '/field-test/results',
  label: 'Results',
  description: 'Cycle analytics',
  hint: 'Reads, corrections, confusion matrix',
  icon: <ClipboardList size={17} strokeWidth={2} />,
};

const FIELD_TEST_GROUP = navGroup('field-test', 'Field test', 'Field captures and cycle metrics', [
  FIELD_TEST_IMAGES_NAV,
  FIELD_TEST_RESULTS_NAV,
]);

const UPLOADS_GROUP = navGroup('uploads', 'Uploads', 'Bulk upload and label sessions', MANUAL_UPLOAD_NAV);

const PortalLayout: FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const search = location.search;
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

  const { navEntries, roleHint } = useMemo((): { navEntries: NavEntry[]; roleHint: string } => {
    const homeDash: NavLeaf = {
      path: '/',
      label: 'Home',
      description: 'Charts & KPIs',
      hint: 'Session counts and trends',
      icon: <LayoutDashboard size={17} />,
    };

    if (workMode === 'test_data_reviewer') {
      return {
        roleHint: 'Approve sessions for unit test; browse and upload test images.',
        navEntries: [
          { kind: 'leaf', item: { ...homeDash, label: 'Dashboard' } },
          UPLOADS_GROUP,
          navGroup('test-data', 'Test data', 'Unit test library and pending approvals', [
            UNIT_TEST_IMAGES_NAV,
            TEST_DATA_PENDING_NAV,
          ]),
          { kind: 'leaf', item: FIELD_TEST_LIST_NAV },
        ],
      };
    }

    if (workMode === 'reviewer') {
      return {
        roleHint: 'Review new captures, then browse outcomes and upload sessions.',
        navEntries: [
          { kind: 'leaf', item: { ...homeDash, label: 'Dashboard', hint: 'Session counts, trends, exports' } },
          navGroup('review', 'Review', 'Queues by review outcome', [
            {
              path: '/readings/incorrect_new',
              label: 'Awaiting review',
              description: 'New captures, not reviewed',
              hint: 'New captures not yet reviewed',
              icon: <Inbox size={17} strokeWidth={2} />,
            },
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
          ]),
          { kind: 'leaf', item: FIELD_TEST_LIST_NAV },
          UPLOADS_GROUP,
        ],
      };
    }

    if (workMode === 'admin') {
      return {
        roleHint: 'Iterations, training center, uploads, and full session lists.',
        navEntries: [
          { kind: 'leaf', item: { ...homeDash, label: 'Dashboard', hint: 'Session counts, trends, exports' } },
          navGroup('model-pipeline', 'Model & pipeline', 'Factory assembly line and iteration registry', [
            {
              path: '/factory',
              label: 'Model factory',
              description: 'Assembly line · ship',
              hint: 'Planning → data → label → train → test → deployed',
              icon: <Factory size={17} strokeWidth={2} />,
            },
            {
              path: '/pipeline-iterations',
              label: 'Pipeline',
              description: 'Iterations · metrics',
              hint: 'Manage iteration details',
              icon: <Layers size={17} strokeWidth={2} />,
            },
          ]),
          UNIT_TEST_GROUP,
          FIELD_TEST_GROUP,
          UPLOADS_GROUP,
          navGroup('data', 'Data', 'All sessions and test-data queue', [
            {
              path: '/readings/all',
              label: 'All data',
              description: 'Full session list',
              hint: 'Filter by cohort, version, date',
              icon: <ListTree size={17} />,
            },
            TEST_DATA_PENDING_NAV,
          ]),
          {
            kind: 'leaf',
            item: {
              path: '/admin/review-assignments',
              label: 'Assignments',
              description: 'Reviewer work batches',
              hint: 'Assign field test & awaiting review by date or count',
              icon: <ClipboardList size={17} strokeWidth={2} />,
            },
          },
          {
            kind: 'leaf',
            item: {
              path: '/admin/audit-logs',
              label: 'Audit logs',
              description: 'Device & admin events',
              hint: 'Capture, upload, and portal audit trail',
              icon: <ScrollText size={17} strokeWidth={2} />,
            },
          },
        ],
      };
    }

    return {
      roleHint: 'Pipeline metrics, training picks, factory, and unit test tools.',
      navEntries: [
        {
          kind: 'leaf',
          item: {
            ...homeDash,
            label: 'Metrics',
            description: 'Pipeline charts',
            hint: 'Images, accuracy & confidence by iteration',
          },
        },
        { kind: 'leaf', item: {
          path: '/readings/all',
          to: '/readings/all?cohort=training',
          label: 'Training picks',
          description: 'Send to training dataset',
          hint: 'Sessions reviewer marked for training',
          icon: <Sparkles size={17} strokeWidth={2} />,
          activeWhenSearch: { cohort: 'training' },
        } },
        navGroup('model-pipeline', 'Model & pipeline', 'Factory and iteration registry', [
          {
            path: '/factory',
            label: 'Model factory',
            description: 'Assembly line · ship',
            hint: 'Planning → data → label → train → test → deployed',
            icon: <Factory size={17} strokeWidth={2} />,
          },
          {
            path: '/pipeline-iterations',
            label: 'Pipeline',
            description: 'Iterations · metrics',
            hint: 'Same registry as factory (detailed edit)',
            icon: <Layers size={17} strokeWidth={2} />,
          },
        ]),
        UNIT_TEST_GROUP,
        FIELD_TEST_GROUP,
        { kind: 'leaf', item: TEST_DATA_PENDING_NAV },
      ],
    };
  }, [workMode]);

  const trainingNavActive = pathname.startsWith('/training');

  const expandNavGroupsByDefault =
    workMode === 'reviewer' || workMode === 'test_data_reviewer';

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!expandNavGroupsByDefault) return;
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const entry of navEntries) {
        if (entry.kind === 'group') next[entry.group.id] = true;
      }
      return next;
    });
  }, [expandNavGroupsByDefault, navEntries]);

  useEffect(() => {
    if (expandNavGroupsByDefault) return;
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const entry of navEntries) {
        if (entry.kind === 'group' && navGroupActive(pathname, search, entry.group)) {
          next[entry.group.id] = true;
        }
      }
      return next;
    });
  }, [expandNavGroupsByDefault, pathname, search, navEntries]);

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

  const toggleGroup = useCallback((id: string) => {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const renderLeaf = (item: NavLeaf) => {
    const active = navLeafActive(pathname, search, item);
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

  const renderGroup = (group: NavGroup) => {
    const childActive = navGroupActive(pathname, search, group);
    const open = openGroups[group.id] ?? (expandNavGroupsByDefault ? true : childActive);
    const panelId = `portal-nav-group-${group.id}`;

    return (
      <div
        key={group.id}
        className={`portal-nav-disclosure${childActive ? ' portal-nav-disclosure--child-active' : ''}`}
      >
        <button
          type="button"
          className="portal-nav-disclosure-trigger"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => toggleGroup(group.id)}
          title={group.hint}
        >
          <span className="portal-nav-disclosure-title">
            <span className="portal-nav-disclosure-heading">{group.label}</span>
            {group.hint ? <span className="portal-nav-disclosure-hint">{group.hint}</span> : null}
          </span>
          <ChevronDown
            size={16}
            strokeWidth={2}
            className={`portal-nav-disclosure-chevron${open ? ' portal-nav-disclosure-chevron--open' : ''}`}
            aria-hidden
          />
        </button>
        {open ? (
          <div id={panelId} className="portal-nav-disclosure-panel">
            <ul className="portal-nav-nested portal-nav-nested--tight">{group.items.map((item) => renderLeaf(item))}</ul>
          </div>
        ) : null}
      </div>
    );
  };

  const renderNavMenu = () => (
    <div className="portal-nav-menu">
      {navEntries.map((entry) =>
        entry.kind === 'leaf' ? (
          <ul key={entry.item.path + (entry.item.to ?? '')} className="portal-nav-standalone">
            {renderLeaf(entry.item)}
          </ul>
        ) : (
          renderGroup(entry.group)
        ),
      )}
    </div>
  );

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
              <span className="portal-sidebar-title">{PRODUCT_NAME}</span>
              <span className="portal-sidebar-subtitle">{PRODUCT_SIDEBAR_SUBTITLE}</span>
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
            <p className="portal-role-hint">{roleHint}</p>
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
              {renderNavMenu()}
            </>
          ) : (
            renderNavMenu()
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
