[@rapidrest/service-core](../README.md) / [Exports](../modules.md) / ApiErrorMessages

# Enumeration: ApiErrorMessages

Defines the default message of all common API errors.

## Table of contents

### Enumeration Members

- [AUTH_FAILED](ApiErrorMessages.md#auth_failed)
- [AUTH_PERMISSION_FAILURE](ApiErrorMessages.md#auth_permission_failure)
- [AUTH_REQUIRED](ApiErrorMessages.md#auth_required)
- [BULK_UPDATE_FAILURE](ApiErrorMessages.md#bulk_update_failure)
- [IDENTIFIER_EXISTS](ApiErrorMessages.md#identifier_exists)
- [INTERNAL_ERROR](ApiErrorMessages.md#internal_error)
- [INVALID_OBJECT_VERSION](ApiErrorMessages.md#invalid_object_version)
- [INVALID_REQUEST](ApiErrorMessages.md#invalid_request)
- [NOT_FOUND](ApiErrorMessages.md#not_found)
- [OBJECT_ID_MISMATCH](ApiErrorMessages.md#object_id_mismatch)
- [SEARCH_INVALID_ME_REFERENCE](ApiErrorMessages.md#search_invalid_me_reference)
- [SEARCH_INVALID_RANGE](ApiErrorMessages.md#search_invalid_range)
- [UNKNOWN](ApiErrorMessages.md#unknown)

## Enumeration Members

### AUTH_FAILED

• **AUTH_FAILED** = `"Invalid or missing authentication token."`

#### Defined in

composer-service-core/src/ApiErrors.ts:35

---

### AUTH_PERMISSION_FAILURE

• **AUTH_PERMISSION_FAILURE** = `"User does not have permission to perform this action."`

#### Defined in

composer-service-core/src/ApiErrors.ts:36

---

### AUTH_REQUIRED

• **AUTH_REQUIRED** = `"Authorization is required to access this resource."`

#### Defined in

composer-service-core/src/ApiErrors.ts:34

---

### BULK_UPDATE_FAILURE

• **BULK_UPDATE_FAILURE** = `"Failed to update one or more objects."`

#### Defined in

composer-service-core/src/ApiErrors.ts:33

---

### IDENTIFIER_EXISTS

• **IDENTIFIER_EXISTS** = `"A resource with that identifier already exists."`

#### Defined in

composer-service-core/src/ApiErrors.ts:28

---

### INTERNAL_ERROR

• **INTERNAL_ERROR** = `"An internal error has occurred. Please contact the adminstrator."`

#### Defined in

composer-service-core/src/ApiErrors.ts:25

---

### INVALID_OBJECT_VERSION

• **INVALID_OBJECT_VERSION** = `"Invalid object version. Do you have the latest version?"`

#### Defined in

composer-service-core/src/ApiErrors.ts:29

---

### INVALID_REQUEST

• **INVALID_REQUEST** = `"Invalid message or request."`

#### Defined in

composer-service-core/src/ApiErrors.ts:26

---

### NOT_FOUND

• **NOT_FOUND** = `"No resource could be found with the specified identifier."`

#### Defined in

composer-service-core/src/ApiErrors.ts:27

---

### OBJECT_ID_MISMATCH

• **OBJECT_ID_MISMATCH** = `"The object provided does not match the identifier given."`

#### Defined in

composer-service-core/src/ApiErrors.ts:30

---

### SEARCH_INVALID_ME_REFERENCE

• **SEARCH_INVALID_ME_REFERENCE** = ``"Use of the `me` reference requires authentication."``

#### Defined in

composer-service-core/src/ApiErrors.ts:32

---

### SEARCH_INVALID_RANGE

• **SEARCH_INVALID_RANGE** = `"Invalid range value: '{{value}}'. Expected 2 arguments, got {{length}}"`

#### Defined in

composer-service-core/src/ApiErrors.ts:31

---

### UNKNOWN

• **UNKNOWN** = `"An unknown error has occurred. Please try again."`

#### Defined in

composer-service-core/src/ApiErrors.ts:24
