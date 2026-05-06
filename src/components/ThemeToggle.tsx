import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

type ThemeToggleProps = {
  /** Navbar icon vs fixed corner on auth screens */
  variant?: 'navbar' | 'floating';
};

const ThemeToggle: React.FC<ThemeToggleProps> = ({ variant = 'navbar' }) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? 'Use light background' : 'Use dark background';

  return (
    <button
      type="button"
      className={`theme-toggle ${variant === 'floating' ? 'theme-toggle--floating' : ''}`}
      onClick={toggleTheme}
      title={label}
      aria-label={label}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
};

export default ThemeToggle;
