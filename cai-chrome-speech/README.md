# CAI Chrome Speech Controller

**Requirements:** Windows, Chrome, Node.js 22+ (no npm packages).

1. Run `start.bat` (opens Chrome with a separate debug profile and controller page).
2. Sign in to Character.AI in that Chrome profile and open a chat.
3. On the controller tab click **Start listening** and grant microphone permission.
4. Speak; recognized words are inserted into the CAI textbox.

**First-stage build:** it inserts recognized speech only; it does not send messages or toggle CAI Voice yet. We need verify Chrome recognition + CDP first. Recognition needs internet. Login persists in `chrome-profile`.
