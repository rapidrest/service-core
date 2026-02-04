import { ApiError } from "@rapidrest/core";

/**
 * An error take that takes an array of other errors.
 */
export class BulkError extends ApiError {
    /**
     * The list of errors that have been thrown.
     */
    public readonly errors: (Error | null)[] = [];

    constructor(errs: (Error | null)[], code: string, defaultStatus: number, message?: string) {
        super(code, defaultStatus, message);
        // Per: https://github.com/microsoft/TypeScript-wiki/blob/81fe7b91664de43c02ea209492ec1cea7f3661d0/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
        Object.setPrototypeOf(this, BulkError.prototype);
        this.errors = errs;
        // Override default from the first valid status code
        for (const err of errs) {
            if (err && "status" in err) {
                this.status = (err as any).status;
                break;
            }
        }
    }
}