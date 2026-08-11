import { z } from 'zod';

export const streamIdempotencySchema = z.string().uuid();
export const streamMediaNameSchema = z.string().regex(/^(?:index\.m3u8|segment-[0-9]{1,8}\.ts)$/);
