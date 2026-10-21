// Registered by background.js for sites the user added in the popup, so strict pop-up protection
// starts at document_start, before any page script, just like for the built-in sites.
// (Chrome won't inject nopopup.js a second time into the same frame, so instead of re-running it
// we call the hook it leaves behind; if this happens to run first, we leave a flag for it.)
(() => {
  const key = Symbol.for('pab.protect');
  if (typeof self[key] === 'function') self[key]();
  else self.__PAB_FORCE__ = true;
})();
