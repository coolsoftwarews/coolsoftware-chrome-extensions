/**
 * Offscreen document — the only reason it exists is that MV3 service workers
 * have no DOM, and `navigator.clipboard.writeText` needs a document context.
 * This is how the keyboard-shortcut "quick copy" path writes to the clipboard
 * without ever opening the popup.
 */

interface CopyMessage {
  target: 'offscreen';
  action: 'COPY';
  text: string;
}

chrome.runtime.onMessage.addListener((message: CopyMessage, _sender, sendResponse) => {
  if (message?.target !== 'offscreen' || message.action !== 'COPY') return false;

  navigator.clipboard
    .writeText(message.text)
    .then(() => sendResponse({ ok: true }))
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return true; // keep the message channel open for the async response
});
