import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import heroNamesData from '../../../data/hero_names.json';
import { cdnImage } from '../utils/cdn';
import LoadingSkeleton from "../components/LoadingSkeleton";

function HeroesList() {
  const [heroes, setHeroes] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchHeroes();
  }, []);

  const fetchHeroes = async () => {
    try {
      setLoading(true);
      setHeroes(heroNamesData.heroes);
    } catch (err) {
      console.error('Failed to load heroes:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingSkeleton variant="card" />;
  }

  // Convert heroes object to array and filter by search term and released status
  const heroesArray = Object.entries(heroes)
    .map(([id, data]) => ({ id, name: data.name, released: data.released }))
    .filter(hero => hero.released) // Only show released heroes
    .sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically by name
  
  const filteredHeroes = heroesArray.filter(hero =>
    hero.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="w-full p-8">
      <h1 className="text-white text-3xl font-bold mb-6">Heroes</h1>

      {/* Search Bar */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search heroes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full md:w-96 px-4 py-2 text-gray-400 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Hero Count */}
      <div className="mb-4">
        <p className="text-gray-600">
          Showing {filteredHeroes.length} of {heroesArray.length} heroes
        </p>
      </div>

      {/* Heroes Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-12 gap-4">
        {filteredHeroes.map((hero) => (
          <Link
            key={hero.id}
            to={`/hero/${hero.id}`}
            className="shadow rounded-lg overflow-hidden hover:shadow-lg transition-shadow"
          >
            {/* Hero Portrait */}
            <div className="relative overflow-hidden">
              <img
                src={cdnImage('vertical/card_backer_psd.png')}
                alt=""
                className="w-full h-full object-cover opacity-30"
              />
              <img 
                src={cdnImage(`vertical/${hero.name.toLowerCase().replace(/\s+/g, '_')}_vertical_psd.png`)}
                alt={hero.name}
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
              <h3 className="absolute bottom-0 left-0 right-0 text-md font-bold text-center text-white py-2" style={{textShadow: '2px 2px 4px rgba(0,0,0,0.8), -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000'}}>{hero.name}</h3>
            </div>
            
          </Link>
        ))}
      </div>

      {/* No Results */}
      {filteredHeroes.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-xl">No heroes found matching "{searchTerm}"</p>
        </div>
      )}
    </div>
  );
}

export default HeroesList;
