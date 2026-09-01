import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  // Wait for the session-restore check on mount to finish before deciding
  // whether to redirect — otherwise a page refresh with a still-valid
  // token briefly renders as logged-out and bounces to /login before the
  // restored session lands.
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
