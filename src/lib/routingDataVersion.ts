/**
 * Immutable routing artifact deployed with the application.
 *
 * Updating this value and adding the matching public/routing-v2 directory in
 * one commit makes the code/data switch atomic on Lovable previews and publish.
 */
export const ROUTING_DATA_VERSION = "dmv-core-2026-07-18";
export const ROUTING_DATA_PUBLIC_PATH = `/routing-v2/${ROUTING_DATA_VERSION}/manifest.json`;
