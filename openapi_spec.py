"""
OpenAPI specification for DLNS Stats API
"""

def get_openapi_spec():
    """Get the OpenAPI specification as a dictionary"""
    return {
        "openapi": "3.0.2",
        "info": {
            "title": "DLNS Stats API",
            "version": "1.0.0",
            "description": """# DLNS Stats API

The DLNS (Deadlock Night Shift) Stats API provides comprehensive access to Deadlock match data, 
player statistics, and community information. This API allows developers to integrate DLNS data 
into their own applications, websites, and tools.

## Features

- **Match Data**: Access detailed match information including players, outcomes, and statistics  
- **Player Statistics**: Retrieve individual player performance data and match history
- **Community Information**: Get community links and resources
- **Search Functionality**: Search for matches and players
- **Hero Information**: Access hero names and identifiers
- **Statistics Aggregation**: View comprehensive statistics across all matches

## Rate Limiting

The API includes built-in caching to ensure optimal performance. Most endpoints are cached 
between 20-300 seconds depending on the data volatility.

## Data Sources

All match data comes from official Deadlock game logs and is regularly updated with new matches 
from the DLNS community.""",
            "contact": {
                "name": "DLNS Stats",
                "url": "https://dlns-stats.co.uk"
            },
            "license": {
                "name": "MIT",
                "url": "https://opensource.org/licenses/MIT"
            }
        },
        "servers": [
            {
                "url": "https://dlns-stats.co.uk",
                "description": "Production server"
            },
            {
                "url": "http://localhost:5050",
                "description": "Development server"
            }
        ],
        "tags": [
            {
                "name": "Matches",
                "description": "Match-related endpoints"
            },
            {
                "name": "Users",
                "description": "User and player-related endpoints"
            },
            {
                "name": "Search",
                "description": "Search functionality"
            },
            {
                "name": "Heroes",
                "description": "Hero information"
            },
            {
                "name": "Community",
                "description": "Community links and information"
            },
            {
                "name": "OneLane",
                "description": "OneLane mod related endpoints"
            },
            {
                "name": "Gluten",
                "description": "Gluten mod related endpoints"
            }
        ],
        "components": {
            "schemas": {
                "Match": {
                    "type": "object",
                    "properties": {
                        "match_id": {"type": "integer", "description": "Unique match identifier"},
                        "duration_s": {"type": "integer", "description": "Match duration in seconds"},
                        "winning_team": {"type": "integer", "description": "Winning team (0=Amber, 1=Sapphire)"},
                        "match_outcome": {"type": "string", "description": "Match outcome description"},
                        "game_mode": {"type": "string", "description": "Game mode"},
                        "match_mode": {"type": "string", "description": "Match mode"},
                        "start_time": {"type": "string", "format": "date-time", "description": "Match start time"},
                        "created_at": {"type": "string", "format": "date-time", "description": "Record creation time"}
                    }
                },
                "Player": {
                    "type": "object",
                    "properties": {
                        "account_id": {"type": "integer", "description": "Steam account ID"},
                        "persona_name": {"type": "string", "description": "Player's display name"},
                        "match_id": {"type": "integer", "description": "Match identifier"},
                        "team": {"type": "integer", "description": "Team number (0=Amber, 1=Sapphire)"},
                        "player_slot": {"type": "integer", "description": "Player slot in team"},
                        "hero_id": {"type": "integer", "description": "Hero identifier"},
                        "hero_name": {"type": "string", "description": "Hero name"},
                        "result": {"type": "string", "description": "Win/Loss result"},
                        "kills": {"type": "integer", "description": "Number of kills"},
                        "deaths": {"type": "integer", "description": "Number of deaths"},
                        "assists": {"type": "integer", "description": "Number of assists"},
                        "last_hits": {"type": "integer", "description": "Number of last hits"},
                        "denies": {"type": "integer", "description": "Number of denies"},
                        "creep_kills": {"type": "integer", "description": "Number of creep kills"},
                        "shots_hit": {"type": "integer", "description": "Number of shots hit"},
                        "shots_missed": {"type": "integer", "description": "Number of shots missed"},
                        "player_damage": {"type": "integer", "description": "Damage dealt to players"},
                        "obj_damage": {"type": "integer", "description": "Damage dealt to objectives"},
                        "player_healing": {"type": "integer", "description": "Healing done to players"},
                        "pings_count": {"type": "integer", "description": "Number of pings made"},
                        "net_worth": {"type": "integer", "description": "Net worth at end of match"}
                    }
                },
                "User": {
                    "type": "object",
                    "properties": {
                        "account_id": {"type": "integer", "description": "Steam account ID"},
                        "persona_name": {"type": "string", "description": "Player's display name"},
                        "updated_at": {"type": "string", "format": "date-time", "description": "Last update time"}
                    }
                },
                "UserStats": {
                    "type": "object",
                    "properties": {
                        "account_id": {"type": "integer", "description": "Steam account ID"},
                        "total_matches": {"type": "integer", "description": "Total matches played"},
                        "wins": {"type": "integer", "description": "Total wins"},
                        "losses": {"type": "integer", "description": "Total losses"},
                        "win_rate": {"type": "number", "format": "float", "description": "Win rate as decimal"},
                        "avg_kills": {"type": "number", "format": "float", "description": "Average kills per match"},
                        "avg_deaths": {"type": "number", "format": "float", "description": "Average deaths per match"},
                        "avg_assists": {"type": "number", "format": "float", "description": "Average assists per match"},
                        "total_damage": {"type": "integer", "description": "Total damage dealt"},
                        "total_healing": {"type": "integer", "description": "Total healing done"}
                    }
                },
                "SearchResult": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": ["match", "user"], "description": "Type of search result"},
                        "text": {"type": "string", "description": "Display text for result"},
                        "url": {"type": "string", "description": "URL to navigate to"}
                    }
                },
                "CommunityGroup": {
                    "type": "object",
                    "properties": {
                        "group": {"type": "string", "description": "Group name"},
                        "items": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "name": {"type": "string", "description": "Link name"},
                                    "url": {"type": "string", "description": "Link URL"},
                                    "description": {"type": "string", "description": "Link description"}
                                }
                            }
                        }
                    }
                },
                "PaginatedResponse": {
                    "type": "object",
                    "properties": {
                        "page": {"type": "integer", "description": "Current page number"},
                        "per_page": {"type": "integer", "description": "Items per page"},
                        "total": {"type": "integer", "description": "Total number of items"},
                        "total_pages": {"type": "integer", "description": "Total number of pages"}
                    }
                },
                "Error": {
                    "type": "object", 
                    "properties": {
                        "error": {"type": "string", "description": "Error message"}
                    }
                }
            }
        },
        "paths": {
            "/db/matches/latest": {
                "get": {
                    "tags": ["Matches"],
                    "summary": "Get latest matches",
                    "description": "Retrieve the most recent matches",
                    "responses": {
                        "200": {
                            "description": "List of latest matches",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "matches": {
                                                "type": "array",
                                                "items": {"$ref": "#/components/schemas/Match"}
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/db/matches/latest/paged": {
                "get": {
                    "tags": ["Matches"],
                    "summary": "Get paginated latest matches",
                    "description": "Retrieve latest matches with pagination and filtering",
                    "parameters": [
                        {
                            "name": "page",
                            "in": "query",
                            "description": "Page number",
                            "schema": {"type": "integer", "default": 1, "minimum": 1}
                        },
                        {
                            "name": "per_page",
                            "in": "query",
                            "description": "Items per page",
                            "schema": {"type": "integer", "default": 20, "minimum": 1, "maximum": 20}
                        },
                        {
                            "name": "order",
                            "in": "query",
                            "description": "Sort order",
                            "schema": {"type": "string", "enum": ["asc", "desc"], "default": "desc"}
                        },
                        {
                            "name": "team",
                            "in": "query",
                            "description": "Filter by winning team",
                            "schema": {"type": "string", "enum": ["0", "1"]}
                        },
                        {
                            "name": "game_mode",
                            "in": "query",
                            "description": "Filter by game mode",
                            "schema": {"type": "string"}
                        },
                        {
                            "name": "match_mode",
                            "in": "query",
                            "description": "Filter by match mode",
                            "schema": {"type": "string"}
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "Paginated list of matches",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "allOf": [
                                            {"$ref": "#/components/schemas/PaginatedResponse"},
                                            {
                                                "type": "object",
                                                "properties": {
                                                    "matches": {
                                                        "type": "array",
                                                        "items": {"$ref": "#/components/schemas/Match"}
                                                    }
                                                }
                                            }
                                        ]
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/db/matches/{match_id}/players": {
                "get": {
                    "tags": ["Matches"],
                    "summary": "Get match players",
                    "description": "Retrieve all players from a specific match",
                    "parameters": [
                        {
                            "name": "match_id",
                            "in": "path",
                            "required": True,
                            "description": "Match ID",
                            "schema": {"type": "integer"}
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "List of players in the match",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "players": {
                                                "type": "array",
                                                "items": {"$ref": "#/components/schemas/Player"}
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/db/matches/{match_id}/users/{account_id}": {
                "get": {
                    "tags": ["Matches"],
                    "summary": "Get specific player stats from match",
                    "description": "Retrieve specific player's statistics from a match",
                    "parameters": [
                        {
                            "name": "match_id",
                            "in": "path",
                            "required": True,
                            "description": "Match ID",
                            "schema": {"type": "integer"}
                        },
                        {
                            "name": "account_id",
                            "in": "path",
                            "required": True,
                            "description": "Player's Steam account ID",
                            "schema": {"type": "integer"}
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "Player statistics for the match",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "player": {"$ref": "#/components/schemas/Player"}
                                        }
                                    }
                                }
                            }
                        },
                        "404": {
                            "description": "Player not found in match",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/Error"}
                                }
                            }
                        }
                    }
                }
            },
            "/db/users/{account_id}": {
                "get": {
                    "tags": ["Users"],
                    "summary": "Get user information",
                    "description": "Retrieve basic user information",
                    "parameters": [
                        {
                            "name": "account_id",
                            "in": "path",
                            "required": True,
                            "description": "Player's Steam account ID",
                            "schema": {"type": "integer"}
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "User information",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "user": {"$ref": "#/components/schemas/User"}
                                        }
                                    }
                                }
                            }
                        },
                        "404": {
                            "description": "User not found",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/Error"}
                                }
                            }
                        }
                    }
                }
            },
            "/db/users/{account_id}/stats": {
                "get": {
                    "tags": ["Users"],
                    "summary": "Get user statistics",
                    "description": "Retrieve aggregated user statistics",
                    "parameters": [
                        {
                            "name": "account_id",
                            "in": "path",
                            "required": True,
                            "description": "Player's Steam account ID",
                            "schema": {"type": "integer"}
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "User statistics",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "stats": {
                                                "oneOf": [
                                                    {"$ref": "#/components/schemas/UserStats"},
                                                    {"type": "null"}
                                                ]
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/db/users/{account_id}/matches": {
                "get": {
                    "tags": ["Users"],
                    "summary": "Get user matches",
                    "description": "Retrieve all matches for a specific user",
                    "parameters": [
                        {
                            "name": "account_id",
                            "in": "path",
                            "required": True,
                            "description": "Player's Steam account ID",
                            "schema": {"type": "integer"}
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "User's match history",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "matches": {
                                                "type": "array",
                                                "items": {"$ref": "#/components/schemas/Player"}
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/db/users/{account_id}/matches/paged": {
                "get": {
                    "tags": ["Users"],
                    "summary": "Get paginated user matches",
                    "description": "Retrieve user matches with pagination and filtering",
                    "parameters": [
                        {
                            "name": "account_id",
                            "in": "path",
                            "required": True,
                            "description": "Player's Steam account ID",
                            "schema": {"type": "integer"}
                        },
                        {
                            "name": "page",
                            "in": "query",
                            "description": "Page number",
                            "schema": {"type": "integer", "default": 1, "minimum": 1}
                        },
                        {
                            "name": "per_page",
                            "in": "query",
                            "description": "Items per page",
                            "schema": {"type": "integer", "default": 20, "minimum": 1, "maximum": 20}
                        },
                        {
                            "name": "order",
                            "in": "query",
                            "description": "Sort order",
                            "schema": {"type": "string", "enum": ["asc", "desc"], "default": "desc"}
                        },
                        {
                            "name": "res",
                            "in": "query",
                            "description": "Filter by result",
                            "schema": {"type": "string", "enum": ["win", "loss"]}
                        },
                        {
                            "name": "team",
                            "in": "query",
                            "description": "Filter by team",
                            "schema": {"type": "string", "enum": ["0", "1"]}
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "Paginated user match history",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "allOf": [
                                            {"$ref": "#/components/schemas/PaginatedResponse"},
                                            {
                                                "type": "object",
                                                "properties": {
                                                    "matches": {
                                                        "type": "array",
                                                        "items": {"$ref": "#/components/schemas/Player"}
                                                    }
                                                }
                                            }
                                        ]
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/db/search/suggest": {
                "get": {
                    "tags": ["Search"],
                    "summary": "Search suggestions",
                    "description": "Get search suggestions for matches and users",
                    "parameters": [
                        {
                            "name": "q",
                            "in": "query",
                            "required": True,
                            "description": "Search query",
                            "schema": {"type": "string"}
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "Search suggestions",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "results": {
                                                "type": "array",
                                                "items": {"$ref": "#/components/schemas/SearchResult"}
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/db/heroes": {
                "get": {
                    "tags": ["Heroes"],
                    "summary": "Get hero information",
                    "description": "Retrieve hero ID to name mapping",
                    "responses": {
                        "200": {
                            "description": "Hero ID to name mapping",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "additionalProperties": {"type": "string"},
                                        "description": "Object with hero IDs as keys and hero names as values"
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/api/community": {
                "get": {
                    "tags": ["Community"],
                    "summary": "Get community information",
                    "description": "Retrieve community links and information",
                    "responses": {
                        "200": {
                            "description": "Community information",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "groups": {
                                                "type": "array",
                                                "items": {"$ref": "#/components/schemas/CommunityGroup"}
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/community.json": {
                "get": {
                    "tags": ["Community"],
                    "summary": "Get community information (cached)",
                    "description": "Retrieve community links with caching headers",
                    "responses": {
                        "200": {
                            "description": "Community information",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "groups": {
                                                "type": "array",
                                                "items": {"$ref": "#/components/schemas/CommunityGroup"}
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        "304": {
                            "description": "Not modified"
                        }
                    }
                }
            },
            "/onelane/api/check": {
                "get": {
                    "tags": ["OneLane"],
                    "summary": "Check OneLane version",
                    "description": "Check the latest OneLane version information",
                    "responses": {
                        "200": {
                            "description": "Version information",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "version": {"type": "string", "description": "Current version"},
                                            "download_url": {"type": "string", "description": "Download URL"}
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            "/gluten/api/check": {
                "get": {
                    "tags": ["Gluten"],
                    "summary": "Check Gluten mod availability",
                    "description": "Check if Gluten mod files are available for download",
                    "responses": {
                        "200": {
                            "description": "File availability status",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {
                                            "zip_available": {"type": "boolean", "description": "Whether Gluten_Zip.zip is available"},
                                            "installer_available": {"type": "boolean", "description": "Whether Python installer is available"},
                                            "exe_available": {"type": "boolean", "description": "Whether Gluten_Video.exe is available"}
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }