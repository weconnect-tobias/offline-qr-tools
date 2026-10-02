# Swish symbol — third-party trademark

`swish-symbol.svg` is the Swish symbol (app icon without wordmark) as published by Swish for
creating your own Swish QR codes. `swish-symbol-grayscale.svg` is the same artwork with its
colours converted to grayscale, matching how Swish's own QR generator shows the symbol in black
and white. Only editor metadata (a comment, title and description) was removed.

- Swish and the Swish symbol are trademarks of **Getswish AB**.
- These files are **not** covered by this project's MIT license.
- They are included solely so that Swish payment codes made with this app can follow Swish's
  guidelines for own QR codes: the symbol without wordmark in the middle of the code, 25 % of
  the code width, on its white background, together with the word "Swish" in text
  (see swish.nu → Marketing material → Logotype, "Icon").
- Use them only for Swish payment codes, according to Swish's guidelines. If you fork this
  project for other purposes, remove `assets/swish/` and `js/assets/swish-symbols.js`.

`js/assets/swish-symbols.js` embeds both files as data URLs and is checked against them by
`tests/unit/swish-symbols.test.js`.
