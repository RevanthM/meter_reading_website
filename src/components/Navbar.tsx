import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  Clock,
  Upload,
  Shield,
  LogOut,
  Cpu,
  HelpCircle,
  Users,
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';

const baseNavItems = [
  { path: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { path: '/activity', label: 'Activity Log', icon: <Clock size={18} /> },
  { path: '/uploads', label: 'Uploads', icon: <Upload size={18} /> },
  { path: '/usage', label: 'Usage', icon: <Users size={18} /> },
  { path: '/mfa', label: 'MFA Settings', icon: <Shield size={18} />, requiresFirebase: true },
  /** Version-level analytics — useful after labeling volume is healthy; kept at end of the rail. */
  { path: '/models', label: 'Models', icon: <Cpu size={18} /> },
] as const;

const Navbar: React.FC = () => {
  const { userEmail, logout, user } = useAuth();
  const navItems = user
    ? baseNavItems
    : baseNavItems.filter((i) => !('requiresFirebase' in i && i.requiresFirebase));
  const navigate = useNavigate();
  const location = useLocation();

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

  return (
    <nav className="app-navbar">
      <div className="navbar-links">
        {navItems.map((item) => (
          <button
            key={item.path}
            className={`navbar-link ${location.pathname === item.path ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <div className="navbar-user">
        <button
          type="button"
          className="navbar-help-btn"
          onClick={openPortalHelp}
          title="Portal overview and status glossary"
        >
          <HelpCircle size={18} />
          <span>Help</span>
        </button>
        <ThemeToggle />
        <span className="navbar-email">{userEmail}</span>
        <button className="navbar-logout" onClick={handleLogout} title="Sign Out">
          <LogOut size={18} />
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
