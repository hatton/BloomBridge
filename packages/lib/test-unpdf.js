const path = require("path");
const { pdfToMarkdownWithUnpdf } = require("./dist/index.cjs");
const fs = require("fs");

async function test() {
  try {
    const pdfPath = path.resolve(__dirname, "../../test-inputs/bilingual-sample.pdf");
    const outputDir = path.resolve(__dirname, "./test-unpdf-output");

    console.log("Testing PDF:", pdfPath);
    console.log("PDF exists:", fs.existsSync(pdfPath));

    const result = await pdfToMarkdownWithUnpdf(pdfPath, outputDir, (log) => {
      console.log(`[${log.level.toUpperCase()}] ${log.message}`);
    });

    console.log("\n=== RESULT ===");
    console.log("Result length:", result.length);
    console.log("\nFirst 800 characters:");
    console.log(result.substring(0, 800));
    console.log("\n=== END ===");

    // Check if images were extracted
    if (fs.existsSync(outputDir)) {
      const files = fs.readdirSync(outputDir);
      console.log("\nExtracted files:", files);
    }
  } catch (error) {
    console.error("Error:", error.message);
    console.error(error.stack);
  }
}

test();
