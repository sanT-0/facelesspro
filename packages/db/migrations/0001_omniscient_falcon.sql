CREATE TABLE "job_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"step" "video_step" NOT NULL,
	"attempt" integer,
	"outcome" text NOT NULL,
	"error" jsonb,
	"duration_ms" integer NOT NULL,
	"adapter" text,
	"items" integer,
	"ok" integer,
	"failed" integer,
	"bytes" integer,
	"cost_units" numeric(12, 2),
	"degraded_from" text,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_event" ADD CONSTRAINT "job_event_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_event_video_idx" ON "job_event" USING btree ("video_id","created_at");