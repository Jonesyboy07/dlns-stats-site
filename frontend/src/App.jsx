import React from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
} from "react-router-dom";
import MatchList from "./pages/MatchList";
import MatchDetail from "./pages/MatchDetail";
import PlayerDetail from "./pages/PlayerDetail";
import PlayersList from "./pages/PlayersList";
import HeroDetail from "./pages/HeroDetail";
import HeroesList from "./pages/HeroesList";
import PlayerHeroDetail from "./pages/PlayerHeroDetail";
import ItemsList from "./pages/ItemsList";
import Stats from "./pages/Stats";
import SeriesDetail from "./pages/SeriesDetail";
import TeamsList from "./pages/TeamsList";
import TeamDetail from "./pages/TeamDetail";
import WeekDetail from "./pages/WeekDetail";
import WeekList from "./pages/WeekList";
import ReactAdmin from "./pages/ReactAdmin";
import { SoundLibrary } from "./pages/sounds.jsx";
import { SoundsDev } from "./pages/dev.jsx";
import { VoHub } from "./pages/vo.jsx";
import { VoAdmin } from "./pages/vo_admin.jsx";
import DLNS_Header from "./components/DLNS_Header";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <div className="relative min-h-screen flex flex-col bg-base">
        {/* Background image, black & white, fades to bg colour toward bottom */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[url(/static/images/background/background_gothic_jpg.jpeg)] bg-cover bg-center bg-no-repeat grayscale opacity-[0.1] pointer-events-none z-0 [mask-image:linear-gradient(to_bottom,black_0%,black_5%,transparent_95%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,black_5%,transparent_95%)]"
        />

        <div className="relative z-10 flex flex-col flex-1">
          <DLNS_Header />

          <main className="w-full max-w-7xl mx-auto flex-1 py-4 sm:py-8">
            <Routes>
              <Route path="/" element={<MatchList />} />
              <Route path="/matchlist" element={<MatchList />} />
              <Route path="/match/:matchId" element={<MatchDetail />} />
              <Route path="/series/:matchId" element={<SeriesDetail />} />
              <Route path="/players" element={<PlayersList />} />
              <Route path="/player/:accountId" element={<PlayerDetail />} />
              <Route path="/heroes" element={<HeroesList />} />
              <Route path="/hero/:heroId" element={<HeroDetail />} />
              <Route path="/items" element={<ItemsList />} />
              <Route
                path="/player/:accountId/hero/:heroId"
                element={<PlayerHeroDetail />}
              />
              <Route path="/stats" element={<Stats />} />
              <Route path="/teams" element={<TeamsList />} />
              <Route path="/team/:teamName" element={<TeamDetail />} />
              <Route path="/week" element={<WeekList />} />
              <Route path="/week/:week" element={<WeekDetail />} />
              <Route path="/react-admin" element={<ReactAdmin />} />
              <Route path="/sounds" element={<SoundLibrary />} />
              <Route path="/sounds-dev" element={<SoundsDev />} />
              <Route path="/vo" element={<VoHub />} />
              <Route path="/vo-admin" element={<VoAdmin />} />
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
