# DLNS Stats Updates

Welcome to the updates page! Here you'll find the latest changes and improvements to the DLNS Stats system.

## Recent Updates

### September 30, 2025 - Small UI Changes

Just some smaller changes currently. 

- Fixed the search bar being cut off ( can still use /search page as intended)
- Nicer padding on the buttons ( base.html seen on all screens)

20:11 PM - Fixed the installer, didnt put it in the right directory ( placed one folder to high )

## Old Updates

### September 29, 2025 - OneLane Mod Installer!

We've launched a brand new OneLane mod distribution system! Now you can easily install the popular ARAM OneLane mod created by **jakciechan**.

**What's New:**

- **Automatic Installer**: One-click .exe that finds your Steam/Deadlock folders automatically
- **Python Script Option**: For users who prefer to run the Python source directly  
- **Manual Installation**: Traditional zip download with clear instructions
- **Full Transparency**: Complete source code available for review
- **Security Notice**: Clear explanation about PyInstaller false positives with VirusTotal scan

**Features:**

- Smart Steam path detection via Windows registry
- Safe installation that never overwrites existing files
- Conflict reporting for existing mod files
- Clean temporary file management
- Built with PyInstaller for easy distribution

**Important:** All credit for the OneLane mod goes to the original creator **jakciechan** (Discord: jakciechan). We're simply providing an easy installer tool for the community. Original mod available on [GameBanana](https://gamebanana.com/wips/95034).

Visit `/onelane` to try out the new installer system!

### September 28, 2025 - Made it open source!

Due to some friends and people in the community asking, i have made the project open source!

What does this mean?

- The community can better help with adding features
- People can add issues onto the github page
- People can see the amount of chaos behind the scenes!

This does also mean people can run the website entirely themselves, which i hope they dont but i do hope they take inspiration!

### September 27, 2025 - Added Statistics Page

Its here! A nice statistics page with details on:

- Total Matches
- Total Players
- Total Kills
And More!

I was silly and forgot to push the stats page. Added now! - 1:37pm UK Time.

3:38 PM :

Added in hero names to all pages it was broken. Took me a while but we *should* now be working!

18:32 PM:

Fixed the next/prev buttons, User page not properly registering the multiple pages, Other backend changes.

20:40 PM:

Added a cache to the match search. Helps with preventing needing to research the same match multiple times.

21:20 PM:

Added a Community Tab - If you feel you fit in to the community as a creator or provider of something key to the game, reach out on discord! My username is `j0nesy_`, where I can be found in the Deadlock, Deadlock Modding, and DLNS servers.



### September 26, 2025 - Shot Statistics Added
Added shot hit/missed data to all matches from DLNS games. This data is now visible on:
- Match detail pages
- Player profile pages 
- Match history tables

Shot accuracy percentages are calculated and displayed on user profiles.

**Note**: Shot data is currently only available for DLNS matches. It may eventually be added to custom search functionality.

### Plans:
- Adding in Item buy progression throughout the match
- Showing final build in a match
- Better UX over whole site!


## Feedback & Suggestions

Have ideas for new features or improvements? Reach out to me on **Discord** ( j0nesy_ ) with the idea and I will see what i can do!

---

*More updates will be posted here as new features are added.*