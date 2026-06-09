# Using master books with BloomBridge

A **master book** lets you set up the shared look and the reusable pages of a
publisher's books just once, by hand, and have BloomBridge apply them to every
book you import into the same collection.

## The problem it solves

A publisher's books usually share the same hand-built, complex pages — a
license/credits page, a "You're reading Level 4" page, a "Did you enjoy this
book?" page — that the conversion can't reproduce well on its own. They also
share an overall look: the same cover color, page size, theme, and so on.

Rather than fixing all of that up on every book, you set up **one** book in your
collection — the master — and BloomBridge reuses it from then on.

<!-- TODO: screenshot — a master book sitting alongside imported books in a Bloom collection -->

## How BloomBridge finds the master

The master is simply the book in your collection whose name **ends in the word
"master"** — for example, "LFA Vanuatu Master".

You only need one master per collection, and it's used automatically. There's
nothing to turn on.

## What a master gives every import

Each book you import into the collection gets two things from the master:

- **A matching look.** The master's cover color, page size and layout, and Book
  Settings (theme, page-number location, and so on) are copied onto each import,
  so all the books in the collection match the master.

- **Reused pages.** The boilerplate pages you built in the master are dropped
  into each import in place of the converted version of those pages.

## Creating a master book

1. In the destination collection, create a book whose name ends in "master" —
   for example, "LFA Vanuatu Master".

2. Set its **cover color**, **page size and layout**, and **Book Settings**
   (theme, page-number location, and so on). These are what get matched onto
   every import.

   <!-- TODO: screenshot — setting cover color, page size/layout, and Book Settings -->

3. Build any **boilerplate pages** you want reused across all imports.

   > **Tip:** It's often easiest to copy a finished page out of an early
   > conversion and paste it into the master, then fix it up there. To get at
   > that converted book, click the button in BloomBridge that puts the
   > converted book into the collection. After copying the pages you want into
   > the master, you can delete that book from the collection.

   <!-- TODO: screenshot — the "put converted book into collection" button in BloomBridge -->
   <!-- TODO: screenshot — copying a page from one book and pasting it into the master -->

## Choosing which pages come from the master

Use BloomBridge's **page picker** to point a page in your imported book at the
master page that should replace it.

Once you've made that choice, every future import of a book that has that same
page gets the master's version automatically — you don't have to pick it again.

<!-- TODO: screenshot — the page picker, choosing a master page for an imported page -->
