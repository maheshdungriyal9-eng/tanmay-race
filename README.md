# Tanmay Race

Two-player Android/browser racing with private room codes and opt-in live room voice.

- Create a room and share its eight-character code with a friend.
- Both players tap READY. Highest score in a 60-second race wins.
- Touch steering, nitro, coins, live opponent progress, rematches and solo practice.
- Mic is OFF by default. Tap MIC and grant permission to talk; mute/leave stops capture.
- Audio is relayed through the game server over TLS on public hosting, without recording or persistent storage. It is not end-to-end encrypted. Headphones are recommended.
- The server runs race physics and validates inputs. Room codes are invitation secrets; anyone with the code can take the second slot.
- One Node process stores active rooms in memory. Rooms disappear after a server restart. This casual two-player server is not designed for multi-instance scaling.

## Run

Node 22+, `npm ci`, then `npm start`. Open http://localhost:8787.
Use HTTPS in production for microphone access. Render supplies HTTPS and secure WebSockets.
Deploy the included render.yaml as a free web service in Singapore.
A free Render service may sleep when inactive, so the first connection can take about a minute.

## Validation

The source project includes tests for simulation, room isolation, voice opt-in, server-authoritative inputs, disconnects and rematches. Two separate browser contexts test synthetic microphone audio delivery both ways, mute cleanup, synchronized racing and lifecycle cleanup.

Physical Android device and real mobile-network microphone quality still require device testing.
