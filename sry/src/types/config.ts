/**
 * Configuration Types
 *
 * Types for the sry CLI configuration file.
 */

export type SryConfig = {
  auth?: {
    token?: string;
    refreshToken?: string;
    expiresAt?: number;
  };
  defaults?: {
    organization?: string;
    project?: string;
  };
};
