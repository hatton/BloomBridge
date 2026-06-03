const path = require("path");
const os = require("os");

// Import the function we want to test (assuming it's built)
const { validateAndResolveCollectionPath } = require("./packages/cli/dist/index.js");

async function testCollectionPaths() {
  console.log("Testing collection path resolution...\n");

  const homeDir = os.homedir();
  console.log(`Home directory: ${homeDir}\n`);

  // Test cases
  const testCases = [
    {
      input: "palɨ Books",
      description: "Simple collection name with special characters",
    },
    {
      input: "My Collection",
      description: "Simple collection name with spaces",
    },
    {
      input: "SimpleCollection",
      description: "Simple collection name without spaces",
    },
  ];

  for (const testCase of testCases) {
    console.log(`Test: ${testCase.description}`);
    console.log(`Input: "${testCase.input}"`);

    try {
      // Note: This will fail because the path doesn't exist, but we can see what path it tried
      await validateAndResolveCollectionPath(testCase.input);
    } catch (error) {
      // Extract the attempted path from the error message
      const match = error.message.match(/Collection path does not exist: (.+)/);
      if (match) {
        const attemptedPath = match[1];
        console.log(`Resolved to: ${attemptedPath}`);

        // Check if it matches our expected pattern
        const expectedPath = path.join(homeDir, "Documents", "Bloom", testCase.input);
        const normalizedAttempted = path.normalize(attemptedPath);
        const normalizedExpected = path.normalize(expectedPath);

        if (normalizedAttempted === normalizedExpected) {
          console.log("✅ Path resolution correct!");
        } else {
          console.log("❌ Path resolution incorrect!");
          console.log(`Expected: ${normalizedExpected}`);
          console.log(`Got: ${normalizedAttempted}`);
        }
      } else {
        console.log(`Unexpected error: ${error.message}`);
      }
    }
    console.log("---\n");
  }
}

// Also test a full path to make sure we don't break existing functionality
async function testFullPath() {
  console.log("Testing full path (should not be expanded)...\n");

  const fullPath = "C:\\Users\\SomeUser\\Documents\\Bloom\\ExistingCollection";
  console.log(`Input: "${fullPath}"`);

  try {
    await validateAndResolveCollectionPath(fullPath);
  } catch (error) {
    const match = error.message.match(/Collection path does not exist: (.+)/);
    if (match) {
      const attemptedPath = match[1];
      console.log(`Resolved to: ${attemptedPath}`);

      // For full paths, it should resolve to the same path (normalized)
      const normalizedInput = path.normalize(path.resolve(fullPath));
      const normalizedAttempted = path.normalize(attemptedPath);

      if (normalizedAttempted === normalizedInput) {
        console.log("✅ Full path handling correct!");
      } else {
        console.log("❌ Full path handling incorrect!");
        console.log(`Expected: ${normalizedInput}`);
        console.log(`Got: ${normalizedAttempted}`);
      }
    } else {
      console.log(`Unexpected error: ${error.message}`);
    }
  }
  console.log("---\n");
}

async function main() {
  await testCollectionPaths();
  await testFullPath();
  console.log("Testing complete!");
}

main().catch(console.error);
