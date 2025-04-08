# Task: Fix Speech Recognition and Real-time Text Display

## Problem:

After successful calibration, the system transitions to the "Listening..." state, but:
- The running text of recognized speech is not displayed
- Replies don't appear in either column ("Owner's Messages" / "Guest's Messages")
- The user speaks, but no text appears at all

## Expected Behavior:

1. After calibration, a running text of speech recognition (interim results) appears
2. Recognized phrases (final results) are added to the appropriate column:
   - Owner - left column
   - Guest - right column
3. If the text is not finalized, it remains in the running text
4. Delay between speech and text is no more than 1.5 seconds

## What to Check and Fix:

### Client-side (frontend):
- Verify that WebSocket is actually receiving interim and final results
- Ensure that interimTranscript is displayed in the DOM (in the top line)
- Final replies are added to the appropriate column
- Texts are cleared correctly (after moving to the column)

### Server-side (backend):
- Check that Google STT is working with interimResults: true
- Ensure that the audio stream is being passed to recognizeStream without errors
- If compareEmbeddings() is not being called or gives an error - log this
- Add console output: what specific data is coming from STT (for debugging)

## Completion Criteria (Done):
- User speaks - text appears at the top in real-time
- After a pause, the text is fixed in the column (owner or guest)
- The system works stably for at least 30 seconds without freezing
- No recalibration on each launch 