#!/bin/bash

# Test script for children-come.pdf with all OCR and parser combinations
# This script tests all combinations of:
# - OCR options: gemini, 4o
# - Parser engines: pdf-text, native, mistral-ocr

set -e  # Exit on any error

# Base directory setup
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
INPUT_FILE="$SCRIPT_DIR/children-come.pdf"
OUTPUT_BASE="$ROOT_DIR/test-outputs"

echo "Starting comprehensive PDF OCR testing..."
echo "Input file: $INPUT_FILE"
echo "Output base: $OUTPUT_BASE"
echo ""

# Check if input file exists
if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: Input file $INPUT_FILE not found!"
    exit 1
fi

# Array of OCR methods and parser engines
OCR_METHODS=("gemini" "gpt")
PARSER_ENGINES=("pdf-text" "native" "mistral-ocr")

# Counter for progress
TOTAL_COMBINATIONS=$((${#OCR_METHODS[@]} * ${#PARSER_ENGINES[@]}))
CURRENT=0

# Loop through all combinations
for ocr in "${OCR_METHODS[@]}"; do
    for parser in "${PARSER_ENGINES[@]}"; do
        CURRENT=$((CURRENT + 1))
        
        # Create output directory name
        OUTPUT_DIR="children-${parser}-${ocr}"
        FULL_OUTPUT_PATH="$OUTPUT_BASE/$OUTPUT_DIR"
        
        echo "[$CURRENT/$TOTAL_COMBINATIONS] Testing: --ocr $ocr --parser $parser"
        echo "Output directory: $OUTPUT_DIR"
        
        # Run the conversion
        cd "$ROOT_DIR"
        pnpm cli "$INPUT_FILE" \
            --output "$OUTPUT_BASE/$OUTPUT_DIR" \
            --target ocr \
            --ocr "$ocr" \
            --parser "$parser" \
            --verbose
        
        if [ $? -eq 0 ]; then
            echo "✅ Success: $OUTPUT_DIR"
        else
            echo "❌ Failed: $OUTPUT_DIR"
        fi
        
        echo ""
    done
done

echo "Testing completed!"
echo ""
echo "Results summary:"
echo "=================="

# Check which outputs were created
for ocr in "${OCR_METHODS[@]}"; do
    for parser in "${PARSER_ENGINES[@]}"; do
        OUTPUT_DIR="children-${parser}-${ocr}"
        RESULT_FILE="$OUTPUT_BASE/$OUTPUT_DIR/children-come/children-come.ocr.md"
        
        if [ -f "$RESULT_FILE" ]; then
            FILE_SIZE=$(wc -c < "$RESULT_FILE")
            echo "✅ $OUTPUT_DIR: $FILE_SIZE bytes"
        else
            echo "❌ $OUTPUT_DIR: FAILED"
        fi
    done
done

echo ""
echo "All output directories are in: $OUTPUT_BASE"
