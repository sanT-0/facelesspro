ALTER TABLE "api_key" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "created_at" timestamptz DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;