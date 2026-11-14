# Jable image finder

Send an image to the Feishu bot. The bot downloads the image, uses the configured vision model to read catalogue codes, searches Jable by each code, and replies with every exact match. If no match is found, it replies with the OCR title and any recognized catalogue codes.

## Configuration

The existing \`URL\`, \`KEY\`, and \`MODEL\` settings are reused. \`MODEL\` must support image input. To use a separate vision model, set \`VISION_MODEL\` in the environment vault; if omitted, it falls back to \`MODEL\`.

## Run independently

This module has no Feishu dependency. Its OCR and Jable search functions can be injected in tests.

\`\`\`sh
npm run test:jable
\`\`\`

The tests use stub OCR and search responses, so they do not require Feishu credentials, network access, or a live Jable account. To test real OCR and search separately, call \`findByImage(imageBuffer, { ocr: { apiUrl, apiKey, model } })\` from a local Node.js script.
