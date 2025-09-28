# DLNS Stats Website 🎮

A comprehensive web application for tracking and analyzing Deadlock Night Shift (DLNS) game statistics. This project provides match data ingestion, player statistics, and a modern web interface for exploring game history.

## ✨ Features

### 🎯 Core Functionality
- **Match Data Ingestion**: Automated processing of Deadlock match data via external APIs
- **Player Statistics**: Comprehensive player performance tracking and analytics
- **Match History**: Detailed match records with team composition and outcomes
- **Hero Analytics**: Hero-specific statistics and performance metrics
- **Real-time Updates**: Live data processing and caching for optimal performance

### 🌐 Web Interface
- **Modern Responsive Design**: Clean, mobile-friendly interface using Pico CSS
- **Advanced Search**: Find matches and players with intelligent suggestions
- **Statistics Dashboard**: Comprehensive overview of game statistics and trends
- **Match Details**: In-depth match analysis with player performance breakdowns
- **Export Tools**: CSV/TSV export functionality for data analysis

### 🔧 Technical Features
- **RESTful API**: Comprehensive API endpoints for accessing all data
- **Intelligent Caching**: Multi-layer caching system for optimal performance
- **SEO Optimized**: Proper meta tags, sitemaps, and Open Graph support
- **Compression**: Built-in response compression (Brotli/Gzip)
- **Environment Configuration**: Flexible configuration via environment variables

## 🚀 Quick Start

### Prerequisites
- Python 3.8+
- Steam API Key (for player name resolution)
- Internet connection (for fetching match data)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd dlns-stats-site
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your Steam API key and other configuration
   ```

4. **Initialize the database**
   ```bash
   python main.py -matchfile matches.txt
   ```

5. **Initialize the Hero Cache**
   ```bash
   python main.py -herofetch true -herostart 0 -herostart 100
   ```

6. **Start the web server**
   ```bash
   python serve_db.py
   ```

Visit `http://localhost:5000` to access the application.

## 📊 Data Processing

### Match Data Ingestion
The system processes match data from external APIs:

```bash
# Process matches from a file
python main.py -matchfile matches.txt

# Refresh user cache only
python main.py -userfetch true
```

### Data Sources
- **Deadlock API**: Match metadata and game statistics
- **Steam API**: Player names and profile information
- **Hero Data**: Character information and assets

## 🛠️ Configuration

### Environment Variables
```bash
# Required
STEAM_API_KEY=your_steam_api_key_here

# Database
DB_PATH=./data/dlns.sqlite3

# API Configuration
API_LATEST_LIMIT=50
HERO_API_VERSION=5902

# Caching
CACHE_TYPE=SimpleCache
CACHE_DEFAULT_TIMEOUT=60

# External Links
YOUTUBE_URL=https://www.youtube.com/@your_channel
TWITCH_URL=https://www.twitch.tv/your_channel
KOFI_URL=https://ko-fi.com/your_username
```

## 📁 Project Structure

```
├── main.py              # Data ingestion and processing
├── serve_db.py          # Web server and main application
├── db_api.py           # Database API endpoints
├── stats_bp.py         # Statistics blueprint
├── expo.py             # Export functionality
├── heroes.py           # Hero name resolution
├── sitemap.py          # SEO sitemap generation
├── cache.py            # Caching configuration
├── requirements.txt    # Python dependencies
├── .env.example       # Environment configuration template
├── data/              # Database and cache files
│   ├── dlns.sqlite3   # Main database
│   ├── hero_names.json # Hero name cache
│   └── user_cache.json # Player name cache
├── static/            # Static assets (CSS, JS, images)
├── templates/         # HTML templates
└── matches.txt        # Match IDs for processing
```

## 🔌 API Endpoints

### Match Data
- `GET /db/matches/latest` - Latest matches
- `GET /db/matches/<id>/players` - Match player details
- `GET /db/matches/latest/paged` - Paginated match list

### Player Data
- `GET /db/users/<account_id>/matches` - Player match history
- `GET /db/users/<account_id>/matches/paged` - Paginated player matches
- `GET /db/users/<account_id>/stats` - Player statistics

### Search & Utilities
- `GET /db/search/suggest` - Search suggestions
- `GET /db/heroes` - Hero name mappings
- `GET /sitemap.xml` - SEO sitemap

## 🎨 Features in Detail

### Statistics Dashboard
Comprehensive analytics including:
- Total matches and players
- Win/loss ratios
- Hero performance metrics
- Player damage and healing statistics
- Accuracy and objective damage tracking

### Export Tools
Located at `/dlns/`:
- Single match export
- Batch processing for multiple matches
- CSV and TSV formats
- Real-time processing updates

### Search Functionality
- Intelligent match ID suggestions
- Player name autocomplete
- Historical match lookup
- Advanced filtering options

## 🗄️ Database Schema

The application uses SQLite with the following main tables:
- **matches**: Game metadata and outcomes
- **players**: Individual player performance data
- **users**: Player profiles and aggregate statistics

## 🚀 Deployment

### Production Considerations
1. **Environment**: Set production environment variables
2. **Database**: Consider PostgreSQL for larger datasets
3. **Caching**: Redis/Memcached for distributed caching
4. **Web Server**: Use Gunicorn + Nginx for production
5. **SSL**: Enable HTTPS with proper certificates

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is currently unlicensed. Please contact the repository owner for usage permissions and licensing information.

## 🙏 Acknowledgments

- **Deadlock Night Shift Community** - For the amazing games and community
- **Deadlock API** - For providing match data access
- **Steam API** - For player information
- **Pico CSS** - For the beautiful, lightweight styling

## 📞 Support

- 🐛 **Issues**: Report bugs via GitHub Issues
- 💬 **Community**: Join the DLNS community discussions
- 📧 **Contact**: Reach out through the configured social links

---

**Made with ❤️ for the Deadlock Night Shift community**