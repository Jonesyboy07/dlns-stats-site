import React, { Suspense, lazy } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  useLocation,
} from "react-router-dom";
import MatchList from "./pages/MatchList";
import HomePage from "./pages/HomePage";
import DLNS_Header from "./components/DLNS_Header";
import { cdnImage } from "./utils/cdn";
import "./App.css";

const MatchDetail = lazy(() => import("./pages/MatchDetail"));
const SeriesDetail = lazy(() => import("./pages/SeriesDetail"));
const PlayersList = lazy(() => import("./pages/PlayersList"));
const PlayerDetail = lazy(() => import("./pages/PlayerDetail"));
const HeroesList = lazy(() => import("./pages/HeroesList"));
const HeroDetail = lazy(() => import("./pages/HeroDetail"));
const ItemsList = lazy(() => import("./pages/ItemsList"));
const PlayerHeroDetail = lazy(() => import("./pages/PlayerHeroDetail"));
const Stats = lazy(() => import("./pages/Stats"));
const TeamsList = lazy(() => import("./pages/TeamsList"));
const TeamDetail = lazy(() => import("./pages/TeamDetail"));
const WeekList = lazy(() => import("./pages/WeekList"));
const WeekDetail = lazy(() => import("./pages/WeekDetail"));
const ReactAdmin = lazy(() => import("./pages/ReactAdmin"));
const SiteBannerAdmin = lazy(() => import("./pages/SiteBannerAdmin"));
const Community = lazy(() => import("./pages/Community"));
const Help = lazy(() => import("./pages/Help"));
const Search = lazy(() => import("./pages/Search"));
const Updates = lazy(() => import("./pages/Updates"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Navigation() {
  const location = useLocation();

  const navItems = [
    { path: "/", label: "Matches" },
    { path: "/players", label: "Players" },
    { path: "/teams", label: "Teams" },
    { path: "/heroes", label: "Heroes" },
    { path: "/items", label: "Items" },
    { path: "/stats", label: "Stats" },
    { path: "/weeks", label: "Night Shift" },
  ];

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="container mx-auto px-4">
        <div className="flex items-center space-x-8 h-14">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`text-sm font-medium transition-colors hover:text-purple-600 ${
                location.pathname === item.path
                  ? "text-purple-600 border-b-2 border-purple-600"
                  : "text-gray-600"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div className="relative min-h-screen flex flex-col bg-base">
        {/* Background image, black & white, fades to bg colour toward bottom */}
        <div
          aria-hidden="true"
          className="absolute top-0 left-0 right-0 h-[600px] bg-cover bg-top bg-no-repeat grayscale opacity-[0.1] pointer-events-none z-0 [mask-image:linear-gradient(to_bottom,black_0%,black_30%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,black_30%,transparent_100%)]"
          style={{ backgroundImage: `url("${cdnImage("background/background_gothic_jpg.jpeg")}")` }}
        />

        <div className="relative z-10 flex flex-col flex-1">
          <DLNS_Header />

          <main className="w-full max-w-7xl mx-auto flex-1 py-8">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/home" element={<HomePage />} />
              <Route path="/matchlist" element={<MatchList />} />
              <Route path="/match/:matchId" element={<MatchDetail />} />
              <Route path="/matches/:matchId" element={<MatchDetail />} />
              <Route path="/series/:matchId" element={<SeriesDetail />} />
              <Route path="/players" element={<PlayersList />} />
              <Route path="/player/:accountId" element={<PlayerDetail />} />
              <Route path="/users/:accountId" element={<PlayerDetail />} />
              <Route path="/heroes" element={<HeroesList />} />
              <Route path="/hero/:heroId" element={<HeroDetail />} />
              <Route path="/items" element={<ItemsList />} />
              <Route
                path="/player/:accountId/hero/:heroId"
                element={<PlayerHeroDetail />}
              />
              <Route path="/stats" element={<Stats />} />
              <Route path="/stats/" element={<Stats />} />
              <Route path="/teams" element={<TeamsList />} />
              <Route path="/team/:teamName" element={<TeamDetail />} />
              <Route path="/week" element={<WeekList />} />
              <Route path="/week/:week" element={<WeekDetail />} />
              <Route path="/react-admin" element={<ReactAdmin />} />
              <Route path="/react-admin/help-config" element={<SiteBannerAdmin />} />
              <Route path="/react-admin/site-banner" element={<SiteBannerAdmin />} />
              <Route path="/community" element={<Community />} />
              <Route path="/help" element={<Help />} />
              <Route path="/search" element={<Search />} />
              <Route path="/updates" element={<Updates />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>

          <footer className="border-t border-gray-700/50 text-gray-400 mt-16">
            <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col sm:flex-row justify-between gap-6">
              <div>
                <p className="text-gray-200 font-semibold text-sm mb-1">
                  DLNS Stats
                </p>
                <p className="text-xs">
                  Deadlock Night Shift match statistics.
                </p>
              </div>
              <div className="flex gap-8 text-sm">
                <div className="flex flex-col gap-2">
                  <span className="text-gray-200 font-semibold text-xs uppercase tracking-wider mb-1">
                    Browse
                  </span>
                  <Link to="/" className="hover:text-white transition-colors">
                    Matches
                  </Link>
                  <Link
                    to="/players"
                    className="hover:text-white transition-colors"
                  >
                    Players
                  </Link>
                  <Link
                    to="/heroes"
                    className="hover:text-white transition-colors"
                  >
                    Heroes
                  </Link>
                  <Link
                    to="/stats"
                    className="hover:text-white transition-colors"
                  >
                    Stats
                  </Link>
                  <Link
                    to="/community"
                    className="hover:text-white transition-colors"
                  >
                    Community
                  </Link>
                </div>
              </div>
            </div>
            <div className="border-t border-gray-700/50 text-center text-xs py-4 text-gray-600">
              Built with React + Flask + Tailwind CSS
              <p>v0.0.1</p>
            </div>
          </footer>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
