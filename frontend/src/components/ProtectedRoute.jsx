import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Sidebar from "./Sidebar";
import styles from "./ProtectedRoute.module.css";

export default function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className={styles.layout}>
      <Sidebar />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
