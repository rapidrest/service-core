///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Defines the unique codes for all common API errors.
 */
export enum ApiErrors {
    UNKNOWN = "api-001",
    INTERNAL_ERROR = "api-002",
    INVALID_REQUEST = "api-003",
    PAYLOAD_TOO_LARGE = "api-004",
    NOT_FOUND = "api-010",
    IDENTIFIER_EXISTS = "api-011",
    INVALID_OBJECT_VERSION = "api-012",
    OBJECT_ID_MISMATCH = "api-013",
    SEARCH_INVALID_RANGE = "api-014",
    SEARCH_INVALID_ME_REFERENCE = "api-015",
    BULK_CREATE_FAILURE = "api-021",
    BULK_UPDATE_FAILURE = "api-022",
    AUTH_REQUIRED = "api-100",
    AUTH_FAILED = "api-101",
    AUTH_PERMISSION_FAILURE = "api-102",
    AUTH_REQUIRES_TRUSTED_ROLE = "api-103",
    AUTH_REQUIRES_ELEVATION = "api-104",
}

/**
 * Defines the default message of all common API errors.
 */
export enum ApiErrorMessages {
    UNKNOWN = "An unknown error has occurred. Please try again.",
    INTERNAL_ERROR = "An internal error has occurred. Please contact the adminstrator.",
    INVALID_REQUEST = "Invalid message or request.",
    PAYLOAD_TOO_LARGE = "The request body exceeds the maximum allowed size.",
    NOT_FOUND = "No resource could be found with the specified identifier.",
    IDENTIFIER_EXISTS = "A resource with that identifier already exists.",
    INVALID_OBJECT_VERSION = "Invalid object version. Do you have the latest version?",
    OBJECT_ID_MISMATCH = "The object provided does not match the identifier given.",
    SEARCH_INVALID_RANGE = "Invalid range value: '{{value}}'. Expected 2 arguments, got {{length}}",
    SEARCH_INVALID_ME_REFERENCE = "Use of the `me` reference requires authentication.",
    BULK_CREATE_FAILURE = "Failed to create one or more objects.",
    BULK_UPDATE_FAILURE = "Failed to update one or more objects.",
    AUTH_REQUIRED = "Authorization is required to access this resource.",
    AUTH_FAILED = "Invalid or missing authentication token.",
    AUTH_PERMISSION_FAILURE = "User does not have permission to perform this action.",
    AUTH_REQUIRES_TRUSTED_ROLE = "User does not have permission to perform this action.",
    AUTH_REQUIRES_ELEVATION = "This operation requires elevation.",
}
