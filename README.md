---
title: Video Briefs – paste a YouTube link, read the brief in a minute
tags: [video-briefs, youtube, gemini, pwa, offline-first, google-drive-sync, apps-script, upnote]
last_verified: 2026-11-22
---

# Video Briefs

**TL;DR:** Open <https://3dfung-ai.github.io/video-briefs/> in Brave and bookmark it. Paste a YouTube link (or press Ctrl+V anywhere, or click the **Brief it** bookmark on a YouTube page). Gemini watches the video and writes a brief: the claim, a verdict with % confidence, which parts are worth watching, key moments you can click to play, and a prediction with odds. Ask follow-up questions, send it to UpNote, search it later. Works offline; syncs through your own Google Drive via your own Apps Script. Replaces Flow's Video Briefs page.

## How a brief is made
| Step | What happens | Calls to Gemini |
|---|---|---|
| Add | Link pasted, dropped, or sent by Brief it. The same video twice opens the existing brief | none |
| Look up | Title and channel from YouTube; length from the player | none |
| Watch | Gemini watches the public video in 20-minute parts (low resolution, 1 frame every 2 s) and returns a timestamped transcript plus on-screen text | 1 per 20 min |
| Write | Gemini writes the card and the brief from the transcript, streamed onto the page | 1 |
| Check | Times past the end of the video, a missing card or an over-long brief become notes under "Checks". A brief is never thrown away | none |

Fallbacks: if Gemini can't open a video (private, unlisted, age-restricted), the transcript that Brief it grabbed from the YouTube page is used instead. A recording (MP4, MP3, M4A…) is uploaded to Gemini's Files API and deleted after; a transcript file (VTT, SRT, TXT) skips watching entirely.

## Limits that matter
| What | Value |
|---|---|
| Free tier | Gemini 3.8 Flash; up to 8 hours of YouTube a day; daily quota resets at midnight Pacific (3–4 pm Brunei) |
| Privacy | Free-tier requests may be used by Google to improve its models. Fine for public videos; don't upload confidential recordings |
| Fact-checks | From Gemini's own knowledge; no live web search on the free tier |
| Processing | Runs in the open tab. Anything added on another device is made by whichever device has the app open |

## Drive layout (My Drive › 00_Apps › Video Briefs)
| Item | Purpose |
|---|---|
| `index.json` | List of briefs with revision numbers |
| `_data/` | One JSON file per brief (card, brief, transcript, questions). Leave alone |
| `Briefs/` | Readable Markdown copy of each finished brief, with YAML front matter and clickable times |
| `backups/` | Daily copies of `index.json`, newest 40 |

## Files
| File | Purpose |
|---|---|
| `index.html` | The whole app (no external code, no tracking) |
| `sw.js`, `manifest.webmanifest`, icons | Offline start |
| `videobriefs-sync.gs` | The Apps Script, for reference; Settings › Drive sync has a Copy button |

No briefs, keys or personal data are stored in this repository.
