import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { cdnImage } from "../utils/cdn";

export default function ItemsList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all"); // all, weapon, vitality, spirit
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    try {
      setLoading(true);
      const response = await fetch("/dlns/items");
      if (!response.ok) throw new Error("Failed to fetch items");
      const data = await response.json();
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err.message);
      console.error("Error fetching items:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = items
    .filter((item) => {
      // Only show shopable items
      if (!item.shopable && !(item.cost && item.cost > 0)) return false;

      // Filter by slot type
      if (filter !== "all" && item.item_slot_type !== filter) return false;

      // Filter by search term
      if (
        searchTerm &&
        !item.name.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        return false;
      }

      return true;
    })
    .sort((a, b) => (a.item_tier ?? 0) - (b.item_tier ?? 0));

  const itemTypes = [
    { value: "all", label: "All" },
    { value: "weapon", label: "Weapon" },
    { value: "vitality", label: "Vitality" },
    { value: "spirit", label: "Spirit" },
  ];

  const getLocalImage = (item) => {
    const filename = item.name.toLowerCase().replace(/ /g, "_") + "_psd.png";
    const folder = item.item_tier === 5 ? "legendaries" : item.item_slot_type;
    return folder ? cdnImage(`items/${folder}/${filename}`) : null;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-20">
            <div className="text-2xl">Loading items...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-500/20 border border-red-500 rounded-lg p-6">
            <h2 className="text-xl font-bold mb-2">Error Loading Items</h2>
            <p>{error}</p>
            <button
              onClick={fetchItems}
              className="mt-4 px-4 py-2 bg-red-500 hover:bg-red-600 rounded"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-panel text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Deadlock Items</h1>
          <p className="text-gray-300">
            Browse {filteredItems.length} items from the Deadlock API
          </p>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-col md:flex-row gap-4">
          {/* Search */}
          <input
            type="text"
            placeholder="Search items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-lg 
                     focus:outline-none focus:border-purple-500"
          />

          {/* Type filter */}
          <div className="flex gap-2">
            {itemTypes.map((type) => (
              <button
                key={type.value}
                onClick={() => setFilter(type.value)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  filter === type.value
                    ? "bg-purple-600 text-white"
                    : "bg-slate-800/50 text-gray-300 hover:bg-slate-700/50"
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
            <div className="text-gray-400 text-sm">Total Items</div>
            <div className="text-2xl font-bold">{items.length}</div>
          </div>
          <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
            <div className="text-gray-400 text-sm">Weapon</div>
            <div className="text-2xl font-bold text-orange-400">
              {
                items.filter((i) => i.item_slot_type === "weapon" && i.shopable)
                  .length
              }
            </div>
          </div>
          <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
            <div className="text-gray-400 text-sm">Vitality</div>
            <div className="text-2xl font-bold text-green-400">
              {
                items.filter(
                  (i) => i.item_slot_type === "vitality" && i.shopable,
                ).length
              }
            </div>
          </div>
          <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
            <div className="text-gray-400 text-sm">Spirit</div>
            <div className="text-2xl font-bold text-purple-400">
              {
                items.filter((i) => i.item_slot_type === "spirit" && i.shopable)
                  .length
              }
            </div>
          </div>
        </div>

        {/* Items Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredItems.map((item) => (
            <div
              key={item.id}
              className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50 
                       hover:border-purple-500/50 transition-all hover:scale-105 cursor-pointer"
            >
              {/* Item Image */}
              {(() => {
                const src = getLocalImage(item);
                return src ? (
                  <div className="aspect-square mb-3 rounded-lg overflow-hidden bg-slate-700/50 flex items-center justify-center">
                    <img
                      src={src}
                      alt={item.name}
                      className="w-full h-full object-contain p-1"
                      onError={(e) => {
                        e.target.parentElement.style.display = "none";
                      }}
                    />
                  </div>
                ) : null;
              })()}

              {/* Item Info */}
              <div className="space-y-1">
                <h3 className="font-medium text-sm truncate" title={item.name}>
                  {item.name.replace(/_/g, " ")}
                </h3>

                <div className="flex items-center justify-between text-xs">
                  <span
                    className={`px-2 py-0.5 rounded ${
                      item.item_slot_type === "weapon"
                        ? "bg-orange-500/20 text-orange-300"
                        : item.item_slot_type === "vitality"
                          ? "bg-green-500/20 text-green-300"
                          : item.item_slot_type === "spirit"
                            ? "bg-purple-500/20 text-purple-300"
                            : "bg-gray-500/20 text-gray-300"
                    }`}
                  >
                    {item.item_slot_type}
                  </span>

                  {item.cost && (
                    <span className="text-yellow-400 font-bold">
                      ${item.cost}
                    </span>
                  )}
                </div>

                {item.item_tier && (
                  <div className="text-xs text-gray-400">
                    Tier {item.item_tier}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {filteredItems.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <p className="text-xl">No items found</p>
            <p className="text-sm mt-2">Try adjusting your filters</p>
          </div>
        )}
      </div>
    </div>
  );
}
