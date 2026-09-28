import { BrowserRouter, Routes, Route, Outlet, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import { TopBar } from "./components/TopBar";
import { AppShell } from "./components/shell/AppShell";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Notifications } from "./pages/Notifications";
import { ClassDetail } from "./pages/academician/ClassDetail";
import { SubmissionViewer } from "./pages/SubmissionViewer";
import { MyAssignments } from "./pages/student/MyAssignments";
import { Profile } from "./pages/Profile";
import { CommunityList } from "./pages/community/CommunityList";
import { CommunityDetail } from "./pages/community/CommunityDetail";
import { PostDetail } from "./pages/community/PostDetail";
import { FounderSetup } from "./pages/FounderSetup";
import { ForcePasswordChange } from "./pages/ForcePasswordChange";
import { AdminPanel } from "./pages/admin/AdminPanel";
import { Privacy } from "./pages/Privacy";
import { ADMIN_LOGIN_PATH } from "./config";

/** Herkese acik sayfalar (ust bar + icerik). */
function PublicLayout() {
  return (
    <>
      <TopBar />
      <main>
        <Outlet />
      </main>
    </>
  );
}

/** Giris gerektiren sayfalar — sidebar kabuk icinde. */
function ProtectedShell() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="container" style={{ padding: 40 }}>
        <span className="muted">Yükleniyor…</span>
      </div>
    );
  if (!user) return <Navigate to="/giris" replace />;
  // Geçici şifreyle girildiyse önce yeni şifre (sunucu da diğer istekleri reddeder)
  if (user.must_change_password) return <ForcePasswordChange />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<PublicLayout />}>
              <Route path="/" element={<Landing />} />
              <Route path="/giris" element={<Login />} />
              {ADMIN_LOGIN_PATH && <Route path={ADMIN_LOGIN_PATH} element={<Login admin />} />}
              <Route path="/kurulum" element={<FounderSetup />} />
              <Route path="/aydinlatma" element={<Privacy />} />
            </Route>

            <Route element={<ProtectedShell />}>
              <Route path="/panel" element={<Home />} />
              <Route path="/bildirimler" element={<Notifications />} />
              <Route path="/odevlerim" element={<MyAssignments />} />
              <Route path="/profil" element={<Profile />} />
              <Route path="/topluluk" element={<CommunityList />} />
              <Route path="/topluluk/:communityId" element={<CommunityDetail />} />
              <Route path="/gonderi/:postId" element={<PostDetail />} />
              <Route path="/gonderim/:submissionId" element={<SubmissionViewer />} />
              <Route path="/sinif/:classId" element={<ClassDetail />} />
              <Route path="/yonetim" element={<AdminPanel />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
