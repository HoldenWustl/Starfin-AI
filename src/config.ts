import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  STARFIN_TARGET_REPOSITORY: z
    .string()
    .default("https://github.com/HoldenWustl/Starfin-AI.git"),
  STARFIN_TARGET_BRANCH: z.string().default("develop"),
  STARFIN_KEEP_WORKSPACES: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export const config = envSchema.parse(process.env);
