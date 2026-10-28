import { Building2, Settings, Tags, Users } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const items = [
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/organizations', label: 'Organizations', icon: Building2 },
  { to: '/admin/categories', label: 'Categories', icon: Tags },
  { to: '/admin/settings', label: 'Platform settings', icon: Settings },
];

export function AdminTabs() {
  return (
    <nav className="admin-tabs" aria-label="Administration sections">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => `admin-tabs__link${isActive ? ' admin-tabs__link--active' : ''}`}>
          <Icon size={15} aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
