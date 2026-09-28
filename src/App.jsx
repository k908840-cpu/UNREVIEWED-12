import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import { GameProvider } from '@/game/GameContext';
import Layout from '@/components/Layout';
import Landing from '@/pages/Landing';
import CreateJoin from '@/pages/CreateJoin';
import HostConfig from '@/pages/HostConfig';
import ProfileSetup from '@/pages/ProfileSetup';
import Lobby from '@/pages/Lobby';
import SubjectReveal from '@/pages/SubjectReveal';
import Writing from '@/pages/Writing';
import Prediction from '@/pages/Prediction';
import Rating from '@/pages/Rating';
import RoundResults from '@/pages/RoundResults';
import Leaderboard from '@/pages/Leaderboard';
import FinalResults from '@/pages/FinalResults';
// Add page imports here

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      {/* Add your page Route elements here */}
      <Route element={<Layout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/create" element={<CreateJoin />} />
        <Route path="/config" element={<HostConfig />} />
        <Route path="/profile" element={<ProfileSetup />} />
        <Route path="/lobby" element={<Lobby />} />
        <Route path="/reveal" element={<SubjectReveal />} />
        <Route path="/write" element={<Writing />} />
        <Route path="/predict" element={<Prediction />} />
        <Route path="/rate" element={<Rating />} />
        <Route path="/results" element={<RoundResults />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/final" element={<FinalResults />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <GameProvider>
            <AuthenticatedApp />
          </GameProvider>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App