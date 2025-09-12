[![License](https://img.shields.io/badge/license-BSD--2--Clause-blue.svg)](LICENSE)
[![ENiGMA½ Version](https://img.shields.io/badge/enigma-1%2F2-brightgreen.svg)](https://github.com/NuSkooler/enigma-bbs)

# Day in History - ENiGMA½ Module
![Day in History Screenshot](assets/screenshot1.png)

An ENiGMA½ BBS module that displays historical events that occurred on the current day, with multiple variety strategies for event selection. The inspiration, and design, comes from Smooth of PHEN0M, who originally created this as a Mystic BBS mod. I've re-worked this concept as an ENiGMA½ Module, adapting the data source to Wikimedia's API.

## Features

- **⚡ Cached Data**: Add `fetch_daily_events.js` to your cron or timed events
- **Multiple Selection Strategies**: Era-based, oldest-first, source-balanced, and random event selection
- **Word Wrapping**: Text wrapping with proper alignment
- **Classic BBS Styling**: Authentic retro terminal aesthetics

## Installation

### 1. Create Module Directory
```bash
mkdir -p /path/to/enigma-bbs/mods/ja_day_in_history
```

### 2. Install Module Files
Save the files as:
```
/path/to/enigma-bbs/mods/ja_day_in_history/ja_day_in_history.js
/path/to/enigma-bbs/mods/ja_day_in_history/fetch_daily_events.js
```

### 3. Set Up ENiGMA½ Event Scheduler (Recommended)
For instant display performance, use ENiGMA½'s built-in event scheduler.

Add this to your `config.hjson` under `eventScheduler.events`:

#### Option A: Hourly Updates (Freshest Data)
```hjson
eventScheduler: {
    events: {
        dayInHistoryFetch: {
            schedule: "every 1 hour"
            action: "@method:mods/ja_day_in_history/fetch_daily_events.js:fetchDailyEvents"
        }
    }
}
```

#### Option B: Daily Updates (Efficient)
```hjson
eventScheduler: {
    events: {
        dayInHistoryFetch: {
            schedule: "at 6:00 am"
            action: "@method:mods/ja_day_in_history/fetch_daily_events.js:fetchDailyEvents"
        }
    }
}
```

### 4. Alternative: External Cron Job
If you prefer using system cron instead of ENiGMA½'s scheduler:

#### Hourly Updates:
```bash
# Add to crontab (run every hour)
0 * * * * /usr/bin/node /path/to/enigma-bbs/mods/ja_day_in_history/fetch_daily_events.js >> /var/log/enigma-day-in-history.log 2>&1
```

#### Daily Updates:
```bash
# Add to crontab (run daily at 6:00 AM)
0 6 * * * /usr/bin/node /path/to/enigma-bbs/mods/ja_day_in_history/fetch_daily_events.js >> /var/log/enigma-day-in-history.log 2>&1
```

### 5. Initial Cache Setup
Run the fetch script once to create the initial cache:
```bash
cd /path/to/enigma-bbs/mods/ja_day_in_history
node fetch_daily_events.js
```

## Adding to Login Menu

To integrate the Day in History module into your login sequence, you need to modify your login menu configuration file (typically located in `config/menus/`).

### Step 1: Locate Your Login Menu Configuration

Find your login menu configuration file, such as:
- `config/menus/theme-name_login.hjson`

### Step 2: Add the Module to Your Login Sequence

Insert the Day in History module into your login flow. Here's a typical example showing where to place it:

```hjson
{
  "menus": {
    // ... other login sequence menus ...
    
    "fullLoginSequenceLastCallers": {
      "desc": "Last Callers",
      "module": "last_callers",
      "art": "LASTCALL",
      "config": {
        "pause": true,
        "font": "cp437"
      },
      "next": "fullLoginSequenceWhosOnline"
    },
    "fullLoginSequenceWhosOnline": {
      "desc": "Who's Online",
      "module": "whos_online",
      "art": "WHOSON",
      "config": {
        "pause": true
      },
      "next": "fullLoginSequenceDayInHistory"
    },
    
    // ADD THIS ENTRY:
    "fullLoginSequenceDayInHistory": {
      "desc": "Day In History",
      "module": "@userModule:ja_day_in_history",
      "next": "fullLoginSequenceOnelinerz"
    },
    
    "fullLoginSequenceOnelinerz": {
      "desc": "Onelinerz",
      "module": "onelinerz",
      "next": [
        {
          "acs": "NC2",
          "next": "fullLoginSequenceNewScanConfirm"
        },
        {
          "next": "fullLoginSequenceUserStats"
        }
      ],
      "config": {
        "cls": true,
        "art": {
          "view": "ONELINER",
          "add": "ONEADD"
        }
      }
    }
    
    // ... rest of login sequence ...
  }
}
```

### Step 3: Update the Previous Menu's "next" Property

Make sure the menu that comes before Day in History points to it. In the example above, `fullLoginSequenceWhosOnline` has:

```hjson
"next": "fullLoginSequenceDayInHistory"
```

### Step 4: Restart ENiGMA½

```bash
# Stop ENiGMA½
# Start ENiGMA½
```

## Selection Strategies

The module supports different event selection strategies:

- **Era-based (Default)**: Balanced across historical periods
- **Oldest-first**: Focuses on ancient history  
- **Source-balanced**: Balanced across different types of events
- **Random**: Random selection from available events

## Requirements

- ENiGMA½ BBS v0.0.12-beta or later
- Internet connection for daily data fetching (Wikimedia API access)
- Terminal program supporting ANSI color codes (e.g. SyncTerm)
- ENiGMA½ event scheduler or external cron job for cache updates

## License

This project is licensed under the BSD 2-Clause License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Thanks to [NuSkooler](https://github.com/NuSkooler) for ENiGMA½ BBS
- Original version by Smooth provided inspiration and layout
- Wikimedia Foundation for the historical events API
