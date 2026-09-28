import { useAuth } from "../auth/AuthContext";
import { AcademicianDashboard } from "./academician/AcademicianDashboard";
import { StudentDashboard } from "./student/StudentDashboard";

/** Role gore dogru paneli gosterir. */
export function Home() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === "student") return <StudentDashboard />;
  return <AcademicianDashboard />; // academician + admin
}
