import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  Clock,
  Upload,
  User,
  Shield,
  LogOut,
} from 'lucide-react';

const navItems = [
  { path: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { path: '/activity', label: 'Activity Log', icon: <Clock size={18} /> },
  { path: '/uploads', label: 'All Uploads', icon: <Upload size={18} /> },
  { path: '/my-uploads', label: 'My Uploads', icon: <User size={18} /> },
  { path: '/mfa', label: 'MFA Settings', icon: <Shield size={18} /> },
];

const Navbar: React.FC = () => {
  const { userEmail, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
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
        <span className="navbar-email">{userEmail}</span>
        <button className="navbar-logout" onClick={handleLogout} title="Sign Out">
          <LogOut size={18} />
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
