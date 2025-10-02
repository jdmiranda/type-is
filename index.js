/*!
 * type-is
 * Copyright(c) 2014 Jonathan Ong
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict'

/**
 * Module dependencies.
 * @private
 */

var contentType = require('content-type')
var mime = require('mime-types')
var typer = require('media-typer')

/**
 * Optimization: Caches
 * @private
 */

// Cache for normalized types (max 500 entries)
var normalizeCache = Object.create(null)
var normalizeCacheSize = 0
var MAX_NORMALIZE_CACHE = 500

// Cache for mime match results (max 1000 entries)
var mimeMatchCache = Object.create(null)
var mimeMatchCacheSize = 0
var MAX_MIME_MATCH_CACHE = 1000

// Cache for parsed split types
var splitCache = Object.create(null)
var splitCacheSize = 0
var MAX_SPLIT_CACHE = 200

// Fast path for common content types
var COMMON_TYPES = {
  'application/json': 'application/json',
  'application/x-www-form-urlencoded': 'application/x-www-form-urlencoded',
  'text/html': 'text/html',
  'text/plain': 'text/plain',
  'multipart/form-data': 'multipart/form-data',
  'application/octet-stream': 'application/octet-stream',
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'application/xml': 'application/xml',
  'text/xml': 'text/xml'
}

// Common normalized shortcuts
var COMMON_SHORTCUTS = {
  'json': 'application/json',
  'html': 'text/html',
  'xml': 'application/xml',
  'text': 'text/plain',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg'
}

/**
 * Module exports.
 * @public
 */

module.exports = typeofrequest
module.exports.is = typeis
module.exports.hasBody = hasbody
module.exports.normalize = normalize
module.exports.match = mimeMatch

/**
 * Compare a `value` content-type with `types`.
 * Each `type` can be an extension like `html`,
 * a special shortcut like `multipart` or `urlencoded`,
 * or a mime type.
 *
 * If no types match, `false` is returned.
 * Otherwise, the first `type` that matches is returned.
 *
 * @param {String} value
 * @param {Array} types
 * @public
 */

function typeis (value, types_) {
  var i
  var types = types_

  // remove parameters and normalize
  var val = tryNormalizeType(value)

  // no type or invalid
  if (!val) {
    return false
  }

  // support flattened arguments
  if (types && !Array.isArray(types)) {
    types = new Array(arguments.length - 1)
    for (i = 0; i < types.length; i++) {
      types[i] = arguments[i + 1]
    }
  }

  // no types, return the content type
  if (!types || !types.length) {
    return val
  }

  var type
  for (i = 0; i < types.length; i++) {
    if (mimeMatch(normalize(type = types[i]), val)) {
      return type[0] === '+' || type.indexOf('*') !== -1
        ? val
        : type
    }
  }

  // no matches
  return false
}

/**
 * Check if a request has a request body.
 * A request with a body __must__ either have `transfer-encoding`
 * or `content-length` headers set.
 * http://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html#sec4.3
 *
 * @param {Object} request
 * @return {Boolean}
 * @public
 */

function hasbody (req) {
  // Fast path: check transfer-encoding first (most common in chunked uploads)
  var headers = req.headers
  if (headers['transfer-encoding'] !== undefined) {
    return true
  }

  // Check content-length
  var contentLength = headers['content-length']
  return contentLength !== undefined && !isNaN(contentLength)
}

/**
 * Check if the incoming request contains the "Content-Type"
 * header field, and it contains any of the give mime `type`s.
 * If there is no request body, `null` is returned.
 * If there is no content type, `false` is returned.
 * Otherwise, it returns the first `type` that matches.
 *
 * Examples:
 *
 *     // With Content-Type: text/html; charset=utf-8
 *     this.is('html'); // => 'html'
 *     this.is('text/html'); // => 'text/html'
 *     this.is('text/*', 'application/json'); // => 'text/html'
 *
 *     // When Content-Type is application/json
 *     this.is('json', 'urlencoded'); // => 'json'
 *     this.is('application/json'); // => 'application/json'
 *     this.is('html', 'application/*'); // => 'application/json'
 *
 *     this.is('html'); // => false
 *
 * @param {Object} req
 * @param {(String|Array)} types...
 * @return {(String|false|null)}
 * @public
 */

function typeofrequest (req, types_) {
  // no body
  if (!hasbody(req)) return null
  // support flattened arguments
  var types = arguments.length > 2
    ? Array.prototype.slice.call(arguments, 1)
    : types_
  // request content type
  var value = req.headers['content-type']

  return typeis(value, types)
}

/**
 * Normalize a mime type.
 * If it's a shorthand, expand it to a valid mime type.
 *
 * In general, you probably want:
 *
 *   var type = is(req, ['urlencoded', 'json', 'multipart']);
 *
 * Then use the appropriate body parsers.
 * These three are the most common request body types
 * and are thus ensured to work.
 *
 * @param {String} type
 * @return {String|false|null}
 * @public
 */

function normalize (type) {
  if (typeof type !== 'string') {
    // invalid type
    return false
  }

  // Check cache first
  if (normalizeCache[type] !== undefined) {
    return normalizeCache[type]
  }

  var result

  // Fast path for common shortcuts
  if (COMMON_SHORTCUTS[type]) {
    result = COMMON_SHORTCUTS[type]
  } else {
    switch (type) {
      case 'urlencoded':
        result = 'application/x-www-form-urlencoded'
        break
      case 'multipart':
        result = 'multipart/*'
        break
      default:
        if (type[0] === '+') {
          // "+json" -> "*/*+json" expando
          result = '*/*' + type
        } else {
          result = type.indexOf('/') === -1
            ? mime.lookup(type)
            : type
        }
    }
  }

  // Cache the result if cache not full
  if (normalizeCacheSize < MAX_NORMALIZE_CACHE) {
    normalizeCache[type] = result
    normalizeCacheSize++
  }

  return result
}

/**
 * Check if `expected` mime type
 * matches `actual` mime type with
 * wildcard and +suffix support.
 *
 * @param {String} expected
 * @param {String} actual
 * @return {Boolean}
 * @public
 */

function mimeMatch (expected, actual) {
  // invalid type
  if (expected === false) {
    return false
  }

  // Create cache key
  var cacheKey = expected + '|' + actual

  // Check cache first
  if (mimeMatchCache[cacheKey] !== undefined) {
    return mimeMatchCache[cacheKey]
  }

  var result

  // Fast path: exact match
  if (expected === actual) {
    result = true
  } else if (expected === '*/*') {
    // Fast path: wildcard match
    result = actual.indexOf('/') !== -1
  } else {
    // Split types with caching
    var actualParts = splitCache[actual]
    if (!actualParts) {
      actualParts = actual.split('/')
      if (splitCacheSize < MAX_SPLIT_CACHE) {
        splitCache[actual] = actualParts
        splitCacheSize++
      }
    }

    var expectedParts = splitCache[expected]
    if (!expectedParts) {
      expectedParts = expected.split('/')
      if (splitCacheSize < MAX_SPLIT_CACHE) {
        splitCache[expected] = expectedParts
        splitCacheSize++
      }
    }

    // invalid format
    if (actualParts.length !== 2 || expectedParts.length !== 2) {
      result = false
    } else if (expectedParts[0] !== '*' && expectedParts[0] !== actualParts[0]) {
      // validate type
      result = false
    } else if (expectedParts[1].slice(0, 2) === '*+') {
      // validate suffix wildcard
      result = expectedParts[1].length <= actualParts[1].length + 1 &&
        expectedParts[1].slice(1) === actualParts[1].slice(1 - expectedParts[1].length)
    } else if (expectedParts[1] !== '*' && expectedParts[1] !== actualParts[1]) {
      // validate subtype
      result = false
    } else {
      result = true
    }
  }

  // Cache the result if cache not full
  if (mimeMatchCacheSize < MAX_MIME_MATCH_CACHE) {
    mimeMatchCache[cacheKey] = result
    mimeMatchCacheSize++
  }

  return result
}

/**
 * Normalize a type and remove parameters.
 *
 * @param {string} value
 * @return {(string|null)}
 * @private
 */
function normalizeType (value) {
  // Fast path: check if it's a common type without params
  if (COMMON_TYPES[value]) {
    return value
  }

  // Parse the type
  var type = contentType.parse(value).type

  return typer.test(type) ? type : null
}

/**
 * Try to normalize a type and remove parameters.
 *
 * @param {string} value
 * @return {(string|null)}
 * @private
 */
function tryNormalizeType (value) {
  if (!value) {
    return null
  }

  // Handle request objects
  if (typeof value === 'object' && value.headers) {
    value = value.headers['content-type']
    if (!value) {
      return null
    }
  }

  // Fast path: check if it's a common type
  if (COMMON_TYPES[value]) {
    return value
  }

  // Fast path: if no semicolon, no params to parse
  if (value.indexOf(';') === -1) {
    // Check if it's a valid common type without parsing
    var lowerValue = value.toLowerCase()
    if (COMMON_TYPES[lowerValue]) {
      return lowerValue
    }
  }

  try {
    return normalizeType(value)
  } catch (err) {
    return null
  }
}
