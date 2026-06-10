# BloomBridge command line tool

Command-line interface for converting PDF and markdown documents to Bloom books.

> For how the conversion pipeline actually works — OCR, LLM enrichment, vision
> formatting, image metadata, master pages, the complex-page tradeoff — see the
> [`@bloombridge/lib` README](../lib/README.md). This README covers only how to drive
> that pipeline from the command line.

## Normal Usage

### Environment Variables

First, create these accounts and put their keys in your Environment Variables. On Microsoft Windows, you will need to restart any terminals in or for them to see changes to Environment Variables.

- `OPENROUTER_KEY`
- `MISTRAL_API_KEY` — only needed for `--ocr mistral`

### Run

The recommended way to use the tool is with the `--collection` option, though if you don't specify either `--collection` or `--output`, it will automatically use your most recently opened Bloom collection. You can use either a simple collection name or a full path:

```bash

# Default behavior - automatically uses most recently opened Bloom collection
bloombridge Ebida.pdf

# When --collection is used, the languages specified in the .bloomCollection will be fed to the llm as a hint of what languages to expect
# use the most recently opened Bloom collection (release, alpha, beta, or betainternal)

bloombridge Ebida.pdf --collection recent

# Simple collection name (recommended) - expands to ~/Documents/Bloom/<collection-name>
bloombridge Ebida.pdf --collection "Edolo Books"

# Full path to collection folder
bloombridge Ebida.pdf --collection "C:\Users\MudMan\Documents\Bloom\Edolo Books"

```

Then run or restart Bloom to see the book.

Alternatively, you can use the `--output` option to specify a custom output directory:

```bash
bloombridge Ebida.pdf --output "path/to/create/the/output/folder"
```

## The `--collection` option

Pointing the tool at a Bloom Collection lets it pick up that collection's language
settings as hints for the LLM (see [Language hints in the lib
README](../lib/README.md#language-hints-from-bloom-collections)). You can specify the
collection in two ways:

1. **Simple collection name** - Just provide the collection name, and it will automatically expand to `~/Documents/Bloom/CollectionName`
2. **Full path** - Provide the complete path to either:
   - A Bloom collection folder (containing a `.bloomCollection` file)
   - A `.bloomCollection` file directly

`--collection recent` uses your most recently opened Bloom collection.

### Example Bloom Collection Structure

For example, if we have:

```
C:\Users\Diadi\Documents\Bloom\Edolo Books\
├── EdoloBooks.bloomCollection  # Contains language settings
└── nulu/
```

and we run

```bash
bloombridge Ebida.pdf --collection "C:\Users\MudMan\Documents\Bloom\Edolo Books"
```

The tool will find `EdoloBooks.bloomCollection` and use its language settings (L1, L2, L3) to help the LLM process the content more accurately.

Then, if all goes well, we will have:

```
Edolo Books/
├── EdoloBooks.bloomCollection  # Contains language settings
└── nulu/
└── Ebida/                      # Output directory for converted book
    ├── index.html
    ├── Ebida.ocr.md
    └── Ebida.llm.md
```

## Setting the starting stage

The conversion is a [four stage process](../lib/README.md#the-conversion-pipeline). If
you want, you can start at any of those stages, and end at three of them.

This tool determines the starting stage by looking at the file name you give it:

- `*.PDF` Start with PDF
- `*.md` or `*.ocr.md` Start with raw markdown
- `*.llm.md` Start with the markdown that has been tagged by an LLM
- `*.bloom.md` Start with markdown that is ready for the last stage of conversion to Bloom HTML

## Setting the ending stage

To specify the end stage, add the `--target` option using one of these values:

- `ocr` or `markdown` - raw markdown from the OCR system (includes images as `img-*.jpeg`)
- `images` - extract images only in `image-{page}-{imageIndex}.png` format
- `tagged` - markdown annotated by an LLM, with comments that identify text blocks, languages, and metadata fields
- `bloom` - Bloom HTML

For example, to convert PDF to markdown only:

`bloombridge mybook.pdf --target=markdown`

To extract only images from a PDF:

`bloombridge mybook.pdf --target=images`

## Choosing the OCR engine and model

The [default OCR path](../lib/README.md#ocr) renders each page and reads it with a
capable LLM. Use `--ocr` to pick a different engine or model:

```bash
bloombridge mybook.pdf --ocr google/gemini-2.5-pro   # use a specific LLM for OCR
bloombridge mybook.pdf --ocr mistral                 # use Mistral OCR (needs MISTRAL_API_KEY)
```

## Vision-formatting options

[Vision formatting](../lib/README.md#vision-formatting) is **on by default**. Disable it
with `--no-vision-formatting`, and override the model it uses (independently of the
`--model` used for LLM enrichment) with `--vision-model`:

```bash
bloombridge mybook.pdf --collection recent                          # vision-formatting runs
bloombridge mybook.pdf --collection recent --no-vision-formatting   # skip it
bloombridge mybook.pdf --vision-model "openai/gpt-5.4"              # use a specific vision model
```

## Building a master book (`--emit-source-hashes`)

To set up [master-page substitution](../lib/README.md#master-page-substitution-shared-boilerplate-pages):

1. Convert a representative book with `--emit-source-hashes`. This tags every page in
   the output HTML with a `data-import-source-hash` (and skips substitution).

   ```bash
   bloombridge sample.pdf --collection "My Collection" --emit-source-hashes
   ```

2. Open the book in Bloom, perfect the complex pages, delete the rest, and **rename the
   book's folder so it ends in `master`** (e.g. `LFA Vanuatu Master`).

**Then just convert normally.** Any book sent to a collection that contains a `*master`
folder will have its matching pages substituted automatically. No extra flag needed.

## Importing complex pages as images (`--complex-becomes-image`)

Selects which pages are snapshotted to full-page images rather than rebuilt as editable
text — the [translatability-vs-fidelity tradeoff](../lib/README.md#importing-complex-pages-as-images).
The values are additive (each snapshots strictly more than the one above):

```bash
bloombridge mybook.pdf --collection recent --complex-becomes-image anyCanvas
```

| value            | behavior                                                                             |
| ---------------- | ------------------------------------------------------------------------------------ |
| `covers`         | only image covers — rebuild every interior page as editable text                     |
| `busy` (default) | also snapshot canvas pages too busy to convert well (≥ `BUSY_THRESHOLD` text blocks) |
| `anyCanvas`      | also snapshot any page with text over a picture (every canvas page)                  |
| `all`            | snapshot **every** page (maximum fidelity; nothing editable/translatable)            |

Legacy values are still accepted: `off` → `covers`, `0` → `anyCanvas`, `1`–`5` map to
the old numeric thresholds, `always` → `all`.

```bash
bloombridge mybook.pdf --collection recent --complex-becomes-image all
```

`all` imports every page as a full-page image (see the lib README for what it skips and
why it's a distinct mode).
