/**
 * Prepares a safe S3 key by either encoding or sanitizing.
 * @param {string} key - The original S3 key.
 * @param {object} options - Options to customize the transformation.
 * @param {boolean} options.base64 - If true, base64 encodes the key.
 * @param {boolean} options.sanitize - If true, replaces special characters (:, /) with safe alternatives.
 * @param {boolean} options.partialEncode - If true, encodes only problematic segments.
 * @returns {string} - The transformed key.
 */
function prepareS3Key(key, options = { base64: false, sanitize: false, partialEncode: false }) {
  if (options.base64) {
    // Base64 encode the entire key
    return Buffer.from(key).toString('base64');
  }
  
  if (options.sanitize) {
    // Replace special characters with safe alternatives
    return key.replace(/:/g, "_").replace(/\//g, "_").replace(/\(/g, '-').replace(/\)/g, '-');;
  }
  
  if (options.partialEncode) {
    // Encode only problematic parts like "filters:format(webp)"
    const encodeURIComponent = require('querystring').escape; // Querystring's escape method is URL-safe
    return key.replace(/filters:format\([^)]+\)/g, (match) => encodeURIComponent(match));
  }
  
  // Default: Return the original key if no options are selected
  return key;
}

function splitPathAndFilename(input) {
  // Find the last '/' and split into path and filename
  const lastSlashIndex = input.lastIndexOf('/');
  
  if (lastSlashIndex === -1) {
    // No slashes found, entire input is treated as filename
    return { path: '', filename: input };
  }

  const path = input.substring(0, lastSlashIndex); // Everything before the last '/'
  const filename = input.substring(lastSlashIndex + 1); // Everything after the last '/'

  return { path, filename };
}