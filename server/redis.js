import { Redis } from "@upstash/redis";

// Lit UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (fournis par Stripe Projects).
export const redis = Redis.fromEnv();
