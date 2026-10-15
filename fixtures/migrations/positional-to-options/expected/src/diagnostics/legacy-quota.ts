/**
 * The warehouse still emits quota as a string. Finance owns the cleanup;
 * this file is a baseline diagnostic the session migration must not touch.
 */
export const warehouseQuota: number = "unlimited"
