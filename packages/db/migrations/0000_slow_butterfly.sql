CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('processing', 'rendering', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."video_step" AS ENUM('create-scenes', 'create-vocal', 'create-images', 'create-captions', 'render');--> statement-breakpoint
CREATE TABLE "api_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hash" text NOT NULL,
	"prefix" text NOT NULL,
	"last_used_at" timestamptz,
	"revoked_at" timestamptz
);
--> statement-breakpoint
CREATE TABLE "art_style" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"formats" text[] DEFAULT '{}' NOT NULL,
	"profile" jsonb NOT NULL,
	"preview_url" text,
	"portrait_preview_url" text,
	"sample_video_urls" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'building' NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"mime" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balance_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"meta" jsonb,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caption_tpl" (
	"id" integer PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"spec" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caption_track" (
	"video_id" uuid PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"cues" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"video_id" uuid,
	"action" text NOT NULL,
	"units" numeric(12, 2) DEFAULT 0 NOT NULL,
	"unit_cost" numeric(12, 4) DEFAULT 0 NOT NULL,
	"delta" numeric(12, 2) NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_lock" (
	"video_id" uuid NOT NULL,
	"step" "video_step" NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"started_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "job_lock_video_id_step_pk" PRIMARY KEY("video_id","step")
);
--> statement-breakpoint
CREATE TABLE "member" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'editor' NOT NULL,
	CONSTRAINT "member_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "narration" (
	"video_id" uuid PRIMARY KEY NOT NULL,
	"asset_id" uuid NOT NULL,
	"duration_ms" integer NOT NULL,
	"word_timings" jsonb NOT NULL,
	"voice_plan" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "render" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"resolution" integer NOT NULL,
	"fps" integer NOT NULL,
	"format" text DEFAULT 'standard' NOT NULL,
	"asset_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scene" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"text" text NOT NULL,
	"image_asset_id" uuid,
	"motion" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "video" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" "video_status" DEFAULT 'processing' NOT NULL,
	"step" "video_step",
	"error" jsonb,
	"request" jsonb NOT NULL,
	"plan" jsonb,
	"webhook_url" text,
	"duration_ms" integer,
	"video_url" text,
	"editor_seen_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"engine" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"languages" text[] DEFAULT '{}' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"event" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_at" timestamptz DEFAULT now() NOT NULL,
	"delivered_at" timestamptz,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"plan_id" text DEFAULT 'selfhost' NOT NULL,
	"credits" numeric(12, 2),
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "art_style" ADD CONSTRAINT "art_style_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_ledger" ADD CONSTRAINT "balance_ledger_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caption_tpl" ADD CONSTRAINT "caption_tpl_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caption_track" ADD CONSTRAINT "caption_track_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_lock" ADD CONSTRAINT "job_lock_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration" ADD CONSTRAINT "narration_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narration" ADD CONSTRAINT "narration_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render" ADD CONSTRAINT "render_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render" ADD CONSTRAINT "render_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene" ADD CONSTRAINT "scene_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene" ADD CONSTRAINT "scene_image_asset_id_asset_id_fk" FOREIGN KEY ("image_asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video" ADD CONSTRAINT "video_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice" ADD CONSTRAINT "voice_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_hash_idx" ON "api_key" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "asset_workspace_kind_idx" ON "asset" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE INDEX "balance_ledger_workspace_created_idx" ON "balance_ledger" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_workspace_created_idx" ON "credit_ledger" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "render_video_idx" ON "render" USING btree ("video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scene_video_idx_unique" ON "scene" USING btree ("video_id","idx");--> statement-breakpoint
CREATE INDEX "video_workspace_status_idx" ON "video" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "webhook_event_due_idx" ON "webhook_event" USING btree ("delivered_at","next_at");