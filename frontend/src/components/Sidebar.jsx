import { NavLink, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import styles from "./Sidebar.module.css";

const links = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/calendar", label: "Calendar" },
  { to: "/assignments", label: "Assignments" },
  { to: "/progress", label: "Progress" },
  { to: "/settings", label: "Settings" },
];

export default function Sidebar() {
  const navigate = useNavigate();

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate("/");
  }

  return (
    <nav className={styles.sidebar}>
      <div className={styles.brand}>ScholarAgent</div>
      <ul className={styles.links}>
        {links.map(({ to, label }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.active}` : styles.link
              }
            >
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
      <button className={styles.signOut} onClick={handleSignOut}>
        Sign Out
      </button>
    </nav>
  );
}
