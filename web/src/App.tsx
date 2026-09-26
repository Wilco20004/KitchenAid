import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Recipes from './pages/Recipes';
import RecipeDetail from './pages/RecipeDetail';
import RecipeEdit from './pages/RecipeEdit';
import ImportRecipe from './pages/ImportRecipe';
import MealPlan from './pages/MealPlan';
import ShoppingList from './pages/ShoppingList';
import Settings from './pages/Settings';
import Pantry from './pages/Pantry';
import Prices from './pages/Prices';
import Icon from './components/Icon';

const NAV = [
  { to: '/', label: 'Recipes', icon: 'book', end: false, match: (p: string) => p === '/' || p.startsWith('/recipes') },
  { to: '/plan', label: 'Meal plan', icon: 'calendar' },
  { to: '/shopping', label: 'Shopping', icon: 'cart' },
  { to: '/pantry', label: 'Pantry', icon: 'box' },
  { to: '/prices', label: 'Prices', icon: 'tag' },
  { to: '/settings', label: 'Settings', icon: 'settings', desktopOnly: true },
];

export default function App() {
  const { pathname } = useLocation();
  // Braces matter: newer browsers make scrollTo return a Promise, which React
  // would otherwise take for a cleanup function and crash calling it.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">🍳</span> KitchenAid
        </NavLink>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to !== '/'}
              className={({ isActive }) => `${(n.match ? n.match(pathname) : isActive) ? 'active' : ''}${n.desktopOnly ? ' hide-mobile' : ''}`}
            >
              <Icon name={n.icon} size={20} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <NavLink to="/settings" className="icon-button show-mobile header-settings" aria-label="Settings">
          <Icon name="settings" size={20} />
        </NavLink>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Recipes />} />
          <Route path="/recipes/new" element={<RecipeEdit />} />
          <Route path="/recipes/import" element={<ImportRecipe />} />
          <Route path="/recipes/:id" element={<RecipeDetail />} />
          <Route path="/recipes/:id/edit" element={<RecipeEdit />} />
          <Route path="/plan" element={<MealPlan />} />
          <Route path="/shopping" element={<ShoppingList />} />
          <Route path="/pantry" element={<Pantry />} />
          <Route path="/prices" element={<Prices />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
