// Loaded synchronously in <head>, before the stylesheet paints, so a saved
// light theme never flashes the dark default first. Dark is the default and
// needs no attribute; only an explicit choice of light switches it.
(function () {
  try {
    if (localStorage.getItem('theme') === 'light') {
      document.documentElement.dataset.theme = 'light';
    }
  } catch (e) {
    // Storage blocked (private mode, file://): stay on the dark default.
  }
})();
