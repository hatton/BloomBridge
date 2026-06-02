# Openai 4o

## Good:

- gondi text looks right
- handled embedded italics in gondi
- children (with barred i's) looks right
- is currently gathering up text into paragraphs, but once it did not
- is handling the embedded italisized portion
- is putting the the images in the right place

## Bad

## pnpm cli test-inputs/tiger.pdf --target ocr --ocr 4o --output test-outputs/4o-tiger

- Tiger (images only) basically fails. Like, it can do it, but it is quiet resistant.
- tiger gave: "If you need more pages or specific sections, let me know!"
