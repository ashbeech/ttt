import { NavLink, Outlet } from "react-router-dom";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/metrics", label: "Metrics" },
  { to: "/lineage", label: "Lineage" },
  { to: "/wallets", label: "Wallets" },
];

export function Layout() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <span className="brand">mini-terminal</span>
          <nav className="nav">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  isActive ? "nav__link nav__link--active" : "nav__link"
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        mini-terminal &middot; on-chain analytics demo
      </footer>
    </div>
  );
}
